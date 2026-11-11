"""Stack the frames of scripts/pyro-angle-shots.mjs (the brightest of each
pixel, like a long exposure) and lay the lean patterns side by side.
    python3 scripts/pyro-angle-sheet.py [shots/stage3/angles]
Writes <dir>/<case>_<view>.jpg, <dir>/sheet-patterns.jpg and <dir>/sheet-tilt.jpg.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFont

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'shots/stage3/angles')
font = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', 26)
small = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', 18)

PATTERNS = [
    ('none', 'なし（全部まっすぐ）'),
    ('fan', '扇（広さ 40°）'),
    ('v', 'V字'),
    ('x', 'X字（交差）'),
    ('sweep-lr', '順に振る 左→右（0.3 秒おき）'),
    ('sweep-out', '順に振る 中央から外'),
    ('run-rl', '1本から5連 右→左'),
]
TILT = [
    ('back_front', '奥へ 20°（よい）客席から'),
    ('back_side', '奥へ 20°（よい）真横から'),
    ('toward_front', '客席へ 15°（赤い警告）客席から'),
    ('toward_side', '客席へ 15°（赤い警告）真横から'),
]


def stack(name):
    frames = sorted((root / 'frames' / name).glob('*.png'))
    acc = Image.open(frames[0]).convert('RGB')
    for f in frames[1:]:
        acc = ImageChops.lighter(acc, Image.open(f).convert('RGB'))
    # a little lift so the dim risers read on a small tile
    acc = ImageEnhance.Brightness(acc).enhance(1.35)
    acc.save(root / f'{name}.jpg', quality=90)
    return acc


def tile(im, label, w=640, red=False, side=False):
    t = im.resize((w, w * 9 // 16), Image.LANCZOS)
    g = ImageDraw.Draw(t)
    g.text((12, 8), label, fill=(255, 120, 100) if red else (255, 255, 255), font=font)
    if side:
        g.text((w - 150, t.height - 32), '客席 →', fill=(200, 200, 200), font=small)
    return t


def sheet(tiles, cols, path, title):
    w, h = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    s = Image.new('RGB', (cols * w + (cols + 1) * 8, rows * h + (rows + 1) * 8 + 48), (24, 24, 26))
    ImageDraw.Draw(s).text((12, 10), title, fill=(232, 163, 61), font=font)
    for i, t in enumerate(tiles):
        s.paste(t, (8 + (i % cols) * (w + 8), 56 + (i // cols) * (h + 8)))
    s.save(path, quality=90)
    print(path)


pat = [tile(stack(f'{k}_front'), ja) for k, ja in PATTERNS]
sheet(pat, 2, root / 'sheet-patterns.jpg', '角度の型（4号 菊、奥の台の5本、客席の側から。打ち上げから開くまでを重ねた）')
tl = [tile(stack(k), ja, red='toward' in k, side='side' in k) for k, ja in TILT]
sheet(tl, 2, root / 'sheet-tilt.jpg', '前後の傾き（奥へはよい、客席へは赤い警告）')
