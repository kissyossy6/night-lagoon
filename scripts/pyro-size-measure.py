"""Measure the fireworks shots of pyro-size-check.mjs: the stars' width against the table.
   python3 scripts/pyro-size-measure.py shots/stage2/size"""
import json, sys
import numpy as np
from PIL import Image

d = sys.argv[1]
for r in json.load(open(f'{d}/expected.json')):
    im = np.asarray(Image.open(r['file']).convert('L'), dtype=np.float32)
    cx, cy, R = r['cx'], r['cy'], r['rPx']
    # a band through the centre, the stars (bright) against the sky
    y0, y1 = int(cy - R * 0.25), int(cy + R * 0.25)
    x0, x1 = int(max(0, cx - R * 1.6)), int(min(im.shape[1], cx + R * 1.6))
    band = im[max(0, y0):y1, x0:x1]
    sky = np.median(im[: im.shape[0] // 6])
    cols = np.where((band > sky + 40).any(axis=0))[0]
    width = (cols.max() - cols.min()) if len(cols) else 0
    print(f"{r['label']}: table {r['diameter']:.0f} m = {2 * R:.0f} px, measured {width} px -> {width / (2 * R) * r['diameter']:.0f} m ({width / (2 * R) * 100:.0f} %)")
