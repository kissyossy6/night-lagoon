"""What a 180° eye image looks like in the headset, per export size.

    python3 scripts/vr180-analyse.py shots/vr180 res 63,130,174 2048,4096,5760,7680,8192

Reads vr180_<tag>_<eye>_left_t<t>.png (half-equirectangular, 180° x 180°)
and resamples a view of the stage the way a player does (bilinear) at the
headset's pixel density, so sizes above what the display resolves look alike.

headset_<t>_<ppd>_<eye>.png   the stage view at that density (48° x 27°)
detail_<t>_<area>.png         a fountain area, every size side by side
                              (top: at 34 px/deg, bottom: the file itself)
analysis-<tag>.json           sharpness against the largest size:
  psnr      dB, the view at that density vs the same view from the largest file
  detail    high-frequency energy relative to the largest file (1 = all of it)
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw

d, tag, times, eyes = sys.argv[1], sys.argv[2], sys.argv[3].split(','), [int(x) for x in sys.argv[4].split(',')]
PPDS = [34, 44]  # Vision Pro: ~34 average (iFixit), up to ~40+ in the centre (estimates)
VIEW = (48.0, 27.0)  # degrees, the stage from the seat
CENTRE = (0.0, 6.0)  # lon, lat of the view centre (deg)


def view(img, ppd, fov=VIEW, centre=CENTRE):
    """Perspective view out of a half-equirectangular image, bilinear."""
    W = img.shape[1]
    w, h = int(round(fov[0] * ppd)), int(round(fov[1] * ppd))
    f = (w / 2) / np.tan(np.radians(fov[0] / 2))
    x, y = np.meshgrid(np.arange(w) - w / 2 + 0.5, h / 2 - np.arange(h) - 0.5)
    lon0, lat0 = np.radians(centre[0]), np.radians(centre[1])
    # camera looking at (lon0, lat0): tilt up by lat0, then turn by lon0
    dz = f * np.cos(lat0) - y * np.sin(lat0)
    dy = f * np.sin(lat0) + y * np.cos(lat0)
    dx = x
    dx, dz = dx * np.cos(lon0) + dz * np.sin(lon0), -dx * np.sin(lon0) + dz * np.cos(lon0)
    n = np.sqrt(dx * dx + dy * dy + dz * dz)
    lon, lat = np.arctan2(dx, dz), np.arcsin(dy / n)
    u = (lon / np.pi + 0.5) * W - 0.5
    v = (0.5 - lat / np.pi) * W - 0.5
    u0, v0 = np.clip(np.floor(u).astype(int), 0, W - 2), np.clip(np.floor(v).astype(int), 0, W - 2)
    fu, fv = (u - u0)[..., None], (v - v0)[..., None]
    a = img[v0, u0] * (1 - fu) + img[v0, u0 + 1] * fu
    b = img[v0 + 1, u0] * (1 - fu) + img[v0 + 1, u0 + 1] * fu
    return a * (1 - fv) + b * fv


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def highpass(a):
    L = lum(a)
    k = np.array([1, 4, 6, 4, 1], np.float32) / 16
    blur = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, L)
    blur = np.apply_along_axis(lambda c: np.convolve(c, k, 'same'), 0, blur)
    return L - blur


def psnr(a, b):
    mse = np.mean((a - b) ** 2)
    return float(10 * np.log10(1.0 / max(mse, 1e-12)))


# (name, field of view, centre lon/lat), degrees
AREAS = [('spray', (7.0, 4.0), (-4.0, 3.5)), ('base', (7.0, 4.0), (-10.0, 0.0))]


def detail(imgs, t, area, area_fov, area_c):
    """One area, every size side by side: as seen at 34 px/deg (top row)
    and as stored in the file (bottom row), blown up to the same size."""
    tile_w = 420
    scale = tile_w / area_fov[0]
    tiles = []
    for e in eyes:
        row = []
        for ppd in (34, e / 180):
            im = Image.fromarray((np.clip(view(imgs[e], ppd, area_fov, area_c), 0, 1) * 255).astype(np.uint8))
            row.append(im.resize((tile_w, int(round(area_fov[1] * scale))), Image.NEAREST))
        tiles.append((e, row))
    th = tiles[0][1][0].height
    sheet = Image.new('RGB', (tile_w * len(eyes) + 8 * (len(eyes) - 1), th * 2 + 8 + 22), (20, 20, 24))
    dr = ImageDraw.Draw(sheet)
    for i, (e, row) in enumerate(tiles):
        x = i * (tile_w + 8)
        dr.text((x + 4, 4), f'{e} px/eye  ({e / 180:.0f} px/deg in file)', fill=(220, 230, 255))
        sheet.paste(row[0], (x, 22))
        sheet.paste(row[1], (x, 22 + th + 8))
    sheet.save(f'{d}/detail_t{t}_{area}.png')


report = {}
for t in times:
    imgs = {}
    for e in eyes:
        p = f'{d}/vr180_{tag}_{e}_left_t{t}.png'
        imgs[e] = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32) / 255.0
    ref = eyes[-1]
    report[t] = {}
    for ppd in PPDS:
        views = {e: view(imgs[e], ppd) for e in eyes}
        hp_ref = np.abs(highpass(views[ref])).mean()
        for e in eyes:
            Image.fromarray((np.clip(views[e], 0, 1) * 255).astype(np.uint8)).save(f'{d}/headset_t{t}_{ppd}ppd_{e}.png')
            report[t].setdefault(str(e), {})[f'{ppd}ppd'] = {
                'psnr': round(psnr(views[e], views[ref]), 2) if e != ref else None,
                'detail': round(float(np.abs(highpass(views[e])).mean() / hp_ref), 3),
            }
    for e in eyes:
        report[t][str(e)]['ppd_in_file'] = round(e / 180, 1)
    for area, area_fov, area_c in AREAS:
        detail(imgs, t, area, area_fov, area_c)

with open(f'{d}/analysis-{tag}.json', 'w') as fh:
    json.dump(report, fh, indent=2)
print(json.dumps(report, indent=1))
