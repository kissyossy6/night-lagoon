"""Measure rendered bursts the same way as the recordings and compare (sound-design skill).

    python3 scripts/sound/compare.py <reference profile.json> <rendered.wav> <out dir>

Writes <out>/compare.json (each band's level at the peak and time to -20 dB,
reference and ours, and the correction_db that would bring ours to the
reference) and <out>/bands.png (each band's curve, reference over ours).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import analyse as A  # noqa: E402

ref_path, wav, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
ref = json.load(open(ref_path))
booms = A.measure(wav)
ours = np.median(np.stack([b['own'] for b in booms]), 0)
theirs = np.array(ref['profile_db'])
fps = ref['fps']
peak = slice(0, int(0.3 * fps))
pow_db = lambda e: 10 * np.log10((10 ** (e[peak] / 10)).sum(0))  # each band's energy over the first 0.3 s
r_e, o_e = pow_db(theirs), pow_db(ours)
r_e -= r_e.max()
o_e -= o_e.max()
corr = r_e - o_e
fr, fo = A.figures(theirs), A.figures(ours)
res = {
    'booms': len(booms),
    'bands': ref['bands'],
    'peak_db_ref': np.round(r_e, 1).tolist(),
    'peak_db_ours': np.round(o_e, 1).tolist(),
    'correction_db': np.round(corr, 1).tolist(),
    'decay20_ref': [d[0] for d in fr['decay']],
    'decay20_ours': [d[0] for d in fo['decay']],
    'attack_ms': [fr['attack_ms'], fo['attack_ms']],
}
json.dump(res, open(f'{out}/compare.json', 'w'), indent=1)
print('band          ref   ours   corr   -20dB ref/ours')
for k, (a, b) in enumerate(ref['bands']):
    print(f'{a:5d}-{b:5d} {r_e[k]:6.1f} {o_e[k]:6.1f} {corr[k]:6.1f}   {res["decay20_ref"][k]} / {res["decay20_ours"][k]}')
print('attack ms ref/ours', res['attack_ms'], 'booms', len(booms))

import matplotlib  # noqa: E402

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402

plt.rcParams['font.family'] = 'Hiragino Sans'
fig, axs = plt.subplots(2, 5, figsize=(16, 6), sharex=True, sharey=True)
t = np.arange(theirs.shape[0]) / fps
for k, ax in enumerate(axs.flat):
    a, b = ref['bands'][k]
    ax.plot(t, theirs[:, k] - theirs.max(), color='#e8a33d', lw=2, label='録音（手本）')
    ax.plot(t[: len(ours)], ours[:, k] - ours.max(), color='#5aa9ff', lw=1.3, label='作った音')
    ax.set_title(f'{a}–{b} Hz', fontsize=11)
    ax.set_ylim(-70, 0)
    ax.grid(alpha=0.3)
axs[0, 0].legend(fontsize=9)
fig.supxlabel('ドーンからの秒')
fig.supylabel('音量 (dB、一番大きい所が 0)')
fig.suptitle('花火のドーン：帯域ごとの音量の時間変化（録音 25発の中央値｜作った音）')
fig.tight_layout()
fig.savefig(f'{out}/bands.png', dpi=90)
print(f'{out}/bands.png')
