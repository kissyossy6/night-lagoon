"""The analysed profile (scripts/sound/analyse.py) as the data the synthesis plays (sound-design skill).

    python3 scripts/sound/fit.py <profile.json> <out.json> [--trim=<compare.json>]

Each band's curve is smoothed over 50 ms and, after its loudest moment, made
to only fall (the least-squares falling curve, not the running minimum, which
follows the noise's dips down): the echoes' lumps are added back by the synthesis as measured noise
(lump), not baked into the curve. 20 ms frames. --trim applies the per-band
corrections a comparison found (scripts/sound/compare.py), on top of the
ones already in out.json.
"""
import json
import sys

import numpy as np

src, out = sys.argv[1], sys.argv[2]
trim_from = next((a.split('=', 1)[1] for a in sys.argv[3:] if a.startswith('--trim=')), None)
p = json.load(open(src))
env = np.array(p['profile_db'])  # frames x bands, 10 ms
k = 5
pad = np.pad(env, ((k // 2, k // 2), (0, 0)), mode='edge')
smooth = np.stack([np.convolve(pad[:, b], np.ones(k) / k, mode='valid') for b in range(env.shape[1])], 1)


def falling(y):
    """The least-squares curve through y that never rises (pool adjacent violators)."""
    vals, counts = [], []
    for v in y:
        vals.append(float(v))
        counts.append(1)
        while len(vals) > 1 and vals[-2] < vals[-1]:
            c = counts[-2] + counts[-1]
            vals[-2] = (vals[-2] * counts[-2] + vals[-1] * counts[-1]) / c
            counts[-2] = c
            vals.pop()
            counts.pop()
    return np.repeat(vals, counts)


for b in range(smooth.shape[1]):
    pk = int(np.argmax(smooth[:, b]))
    smooth[pk:, b] = falling(smooth[pk:, b])
smooth -= smooth.max()
frames = smooth[::2]  # 20 ms
try:
    old = json.load(open(out))
    trim = np.array(old.get('trim_db', [0] * len(p['bands'])), float)
except FileNotFoundError:
    trim = np.zeros(len(p['bands']))
if trim_from:
    trim += np.array(json.load(open(trim_from))['correction_db'])
res = {
    'about': 'A fireworks burst heard from the shore: each band\'s level (dB) every 20 ms, the median of '
    f'{p["count"]} single booms in recordings from Wikimedia Commons (references/sounds/pyro/), background removed. '
    'Made by scripts/sound/fit.py; see .claude/skills/sound-design.',
    'bands': p['bands'],
    'frame_s': 0.02,
    'env_db': np.round(frames.T, 1).tolist(),  # bands x frames
    'trim_db': np.round(trim, 2).tolist(),
    'lump': {'db': 3.4, 'period_s': 0.16, 'from_s': 0.12},
}
json.dump(res, open(out, 'w'), indent=None, separators=(',', ':'))
print(out, 'bands', len(res['bands']), 'frames', len(frames), 'trim', res['trim_db'])
