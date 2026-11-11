"""Find single booms in fireworks recordings and measure them (sound-design skill).

    python3 scripts/sound/analyse.py <out.json> [--min-snr=24] <recording> [<recording> ...]

Each recording is decoded with ffmpeg to mono 24 kHz. A boom is a sharp rise
in the low band (40-250 Hz) at least RISE_DB above the level just before it.
It is kept only if it stands alone: nothing else starts 1 s before or 2.5 s
after, so its tail is its own. For each kept boom the level of every band is
measured every 10 ms for 2.5 s, in dB against the boom's loudest moment.
Each band's background (the 0.5 s before) is taken away as power, so the
tail is the boom's own. Writes the median over all booms (the profile the
synthesis follows), each
boom's numbers, and a few figures (attack, decay to -20/-40 dB per band, the
echoes).
"""
import json
import subprocess
import sys

import numpy as np

SR = 24000
HOP = 240  # 10 ms
WIN = 1024
BANDS = [(25, 50), (50, 90), (90, 160), (160, 280), (280, 500), (500, 900), (900, 1600), (1600, 3000), (3000, 6000), (6000, 11000)]
LOW = (40, 250)
RISE_DB = 12
BEFORE, AFTER, LENGTH = 1.0, 2.5, 2.5


def decode(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def bands_db(x):
    """Level of each band every HOP samples (dB)."""
    n = (len(x) - WIN) // HOP
    win = np.hanning(WIN).astype(np.float32)
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    masks = [(freqs >= a) & (freqs < b) for a, b in BANDS]
    low = (freqs >= LOW[0]) & (freqs < LOW[1])
    out = np.zeros((n, len(BANDS)), np.float32)
    lowdb = np.zeros(n, np.float32)
    for s in range(0, n, 4096):
        idx = np.arange(s, min(n, s + 4096))
        frames = np.stack([x[i * HOP:i * HOP + WIN] for i in idx]) * win
        p = np.abs(np.fft.rfft(frames, axis=1)) ** 2
        for k, m in enumerate(masks):
            out[idx, k] = 10 * np.log10(p[:, m].sum(1) + 1e-12)
        lowdb[idx] = 10 * np.log10(p[:, low].sum(1) + 1e-12)
    return out, lowdb


def onsets(lowdb):
    """Frames where the low band jumps RISE_DB over the 0.3 s before it."""
    fps = SR / HOP
    found = []
    last = -1e9
    for i in range(30, len(lowdb) - 5):
        pre = np.median(lowdb[i - 30:i - 2])
        peak = lowdb[i:i + 5].max()
        if peak - pre >= RISE_DB and lowdb[i] - lowdb[i - 1] > 3 and i - last > 0.15 * fps:
            found.append(i)
            last = i
    return found


def measure(path):
    x = decode(path)
    bd, lowdb = bands_db(x)
    on = onsets(lowdb)
    fps = SR / HOP
    n = int(LENGTH * fps)
    booms = []
    for j, i in enumerate(on):
        prev = on[j - 1] if j else -1e9
        nxt = on[j + 1] if j + 1 < len(on) else 1e12
        if (i - prev) / fps < BEFORE or (nxt - i) / fps < AFTER or i + n >= len(bd):
            continue
        seg = bd[i - 2:i - 2 + n].copy()
        peak = seg.max(0)
        tot = 10 * np.log10((10 ** (seg / 10)).sum(1))
        floor = np.median(10 * np.log10((10 ** (bd[i - 60:i - 5] / 10)).sum(1)))
        if tot.max() - floor < 18:  # too faint against the crowd and the wind
            continue
        # the boom alone: each band's background (just before it) taken away as power
        bg = np.median(bd[i - 60:i - 5], 0)
        own = 10 * np.log10(np.maximum(10 ** (seg / 10) - 10 ** (bg / 10), 10 ** ((bg - 30) / 10)))
        booms.append({'t': round(i / fps, 2), 'seg': seg - tot.max(), 'own': own - tot.max(), 'bg': bg - tot.max(), 'snr': float(tot.max() - floor)})
    return booms


def figures(env):
    """Attack (ms, 10%->90% of the total), and decay to -20/-40 dB per band (s)."""
    fps = SR / HOP
    tot = 10 * np.log10((10 ** (env / 10)).sum(1))
    p = int(np.argmax(tot))
    lin = 10 ** (tot / 20)
    a10 = int(np.argmax(lin >= lin[p] * 0.1))
    a90 = int(np.argmax(lin >= lin[p] * 0.9))
    dec = []
    for k in range(env.shape[1]):
        e = env[:, k]
        pk = int(np.argmax(e))
        d = []
        for drop in (20, 40):
            below = np.where(e[pk:] < e[pk] - drop)[0]
            d.append(round(float(below[0] / fps), 2) if len(below) else None)
        dec.append(d)
    return {'attack_ms': round((a90 - a10) / fps * 1000), 'peak_s': round(p / fps, 3), 'decay': dec}


if __name__ == '__main__':
    out = sys.argv[1]
    paths = [a for a in sys.argv[2:] if not a.startswith('--')]
    # only the booms this far (dB) over the background: the nearest and clearest
    min_snr = float(next((a.split('=')[1] for a in sys.argv[2:] if a.startswith('--min-snr=')), 18))
    all_booms = []
    per = {}
    for path in paths:
        b = [bb for bb in measure(path) if bb['snr'] >= min_snr]
        per[path.rsplit('/', 1)[-1]] = len(b)
        all_booms += [dict(bb, src=path.rsplit('/', 1)[-1]) for bb in b]
        print(f'{path.rsplit("/", 1)[-1]}: {len(b)} single booms', flush=True)
    stack = np.stack([b['own'] for b in all_booms])
    profile = np.median(stack, 0)
    background = np.median(np.stack([b['bg'] for b in all_booms]), 0)
    res = {
        'bands': BANDS,
        'fps': SR / HOP,
        'min_snr': min_snr,
        'count': len(all_booms),
        'per_file': per,
        'profile_db': np.round(profile, 2).tolist(),
        'background_db': np.round(background, 2).tolist(),
        'spread_db': np.round(np.percentile(stack, 75, 0) - np.percentile(stack, 25, 0), 2).tolist(),
        'figures': figures(profile),
        'booms': [{'src': b['src'], 't': b['t'], 'snr': round(b['snr'], 1), **figures(b['own'])} for b in all_booms],
    }
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps({k: res[k] for k in ('count', 'per_file', 'figures')}, indent=1))
