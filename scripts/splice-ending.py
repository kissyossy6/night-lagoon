"""
Join the show's music to the piece's real ending (2026-10-27).

The old background.mp3 was the first 3 minutes of the US Marine Band's
Rhapsody in Blue (Commons "US Marine Band Rhapsody in Blue.oga", from 2.6 s,
loudness-levelled). This keeps that file up to src_cut and joins the full
recording from dest_at to the last chord (applause cut), at the old file's
gain, with a 40 ms crossfade in a quiet spot. The current file was made with:
  python3 scripts/splice-ending.py full.oga backups/2026-10-27-3min-music/background.mp3 public/music/background.mp3 176.5 1046.0
"""
import numpy as np, sys, subprocess
# usage: splice-ending.py full.oga old3min.mp3 out src_cut(show s) dest_at(full s) [preview_from]
full, cur, out = sys.argv[1:4]
S, Dt = float(sys.argv[4]), float(sys.argv[5]); pf = float(sys.argv[6]) if len(sys.argv) > 6 else 0
SR = 44100; XF = 0.04; END = 1076.3; TAIL = 0.45
G0, G1, RAMP = 3.57, 2.2, (1046.6, 1047.9)  # the old file's gain near 176 s -> the ending at tutti level
dec = lambda f: np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout, np.float32).reshape(-1, 2)
x, c = dec(full), dec(cur)
i = lambda t: int(round(t * SR))
a = c[:i(S + XF)].copy()
b = x[i(Dt):i(END + TAIL)].copy()
tb = Dt + np.arange(len(b)) / SR
g = np.interp(tb, RAMP, (G0, G1)) if Dt < RAMP[1] else np.full(len(b), G1)
b *= g[:, None]
n = i(XF); r = np.linspace(0, 1, n)[:, None]
a[-n:] *= np.cos(r * np.pi / 2); b[:n] *= np.sin(r * np.pi / 2)
a[-n:] += b[:n]
y = np.concatenate([a, b[n:]])
t = i(TAIL); y[-t:] *= np.linspace(1, 0, t)[:, None] ** 2
# The recording's last chord is short and the applause follows at once, so
# the chord rings out in a synthetic hall instead (2026-10-27: the user found
# the dry end abrupt): decaying stereo noise, darker as it decays, from the
# chord's attack, so the sound blooms and fades over a few seconds.
CHORD = 1075.49  # the final chord in the full recording
RT60 = 5.0
ir_n = i(RT60 * 1.4)
rng = np.random.default_rng(1924)
tt = np.arange(ir_n) / SR
ir = rng.standard_normal((ir_n, 2)) * np.exp(-6.9 * tt / RT60)[:, None]
for ch in range(2):  # one-pole lowpass whose cutoff falls with time
    a_ = np.exp(-2 * np.pi * (6000 * np.exp(-tt / 1.2) + 800) / SR)
    z = 0.0
    col = ir[:, ch]
    for k in range(ir_n):
        z = (1 - a_[k]) * col[k] + a_[k] * z
        col[k] = z
ir[: i(0.02)] = 0  # pre-delay
c0 = len(a) - n + i(CHORD - Dt)
seg = y[c0:]
L = len(seg) + ir_n
F = 1 << int(np.ceil(np.log2(L)))
wet = np.stack([np.fft.irfft(np.fft.rfft(seg[:, ch], F) * np.fft.rfft(ir[:, ch], F), F)[:L] for ch in range(2)], 1)
dry_rms = np.sqrt(np.mean(seg[: i(0.4)] ** 2))
wet *= (dry_rms * 0.7) / np.sqrt(np.mean(wet[i(0.4): i(0.8)] ** 2))  # the tail starts ~3 dB under the chord
y = np.concatenate([y, np.zeros((L - len(seg), 2), np.float32)])
y[c0:] += wet.astype(np.float32)
y[-i(0.5):] *= np.linspace(1, 0, i(0.5))[:, None]
print('length %.2f s, peak before limiter %.2f' % (len(y) / SR, np.abs(y).max()))
y = y[i(pf):]
args = ['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-af','alimiter=limit=0.95:level=disabled:attack=2:release=80']
args += ['-b:a','192k'] if out.endswith('.mp3') else []
subprocess.run(args + [out], input=y.astype(np.float32).tobytes())
