"""Image metrics for lab shots: metrics.py shots/lab -> metrics.json

brightness  mean linear-ish luminance of water pixels
coverage    fraction of the frame covered by water
grain       high-frequency energy / signal inside the water (lower = smoother body)
flicker     high-frequency part of the frame-to-frame difference / signal
            (needs *_dt.png captured 1/60 s later; lower = calmer motion)
"""
import json, sys, glob, os
import numpy as np
from PIL import Image, ImageFilter

d = sys.argv[1]
out = {}
def lum(im):
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
def hp(im):
    return lum(im) - lum(im.filter(ImageFilter.GaussianBlur(2.0)))
for f in sorted(glob.glob(f'{d}/*_*_*.png')):
    if f.endswith('_dt.png'):
        continue
    name = os.path.basename(f)[:-4]
    im = Image.open(f)
    L = lum(im)
    bg = np.median(L[: L.shape[0] // 4])
    mask = L > bg + 0.04
    cov = float(mask.mean())
    sig = float(L[mask].mean() - bg) if mask.any() else 0.0
    h = np.abs(hp(im))
    grain = float(h[mask].mean() / max(sig, 1e-4)) if mask.any() else 0.0
    rec = {'brightness': round(sig, 4), 'coverage': round(cov, 4), 'grain': round(grain, 3)}
    f2 = f[:-4] + '_dt.png'
    if os.path.exists(f2):
        im2 = Image.open(f2)
        diff = np.abs(hp(im) - hp(im2))
        rec['flicker'] = round(float(diff[mask].mean() / max(sig, 1e-4)), 3) if mask.any() else 0.0
    out[name] = rec
json.dump(out, open(f'{d}/metrics.json', 'w'), indent=1)
for k, v in out.items():
    print(k, v)
