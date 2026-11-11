"""Sheets for the 花火版 from scripts/hanabi-shots.mjs.
    python3 scripts/hanabi-sheet.py compare <dir> <out.jpg> <title> t1,t2,...   今 (Night Lagoon) | 案 (花火版) rows
    python3 scripts/hanabi-sheet.py strip <dir> <out.jpg> <title> [cols]        every frame of a run, in order
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'
font = ImageFont.truetype(FONT, 24)
W, H = 640, 360


def label(im, text):
    t = im.convert('RGB').resize((W, H), Image.LANCZOS)
    g = ImageDraw.Draw(t)
    g.rectangle((0, 0, 14 + int(g.textlength(text, font=font)), 36), fill=(0, 0, 0))
    g.text((7, 4), text, fill=(255, 255, 255), font=font)
    return t


def sheet(tiles, cols, out, title):
    rows = (len(tiles) + cols - 1) // cols
    s = Image.new('RGB', (cols * W + (cols + 1) * 6, rows * H + (rows + 1) * 6 + 46), (24, 24, 26))
    ImageDraw.Draw(s).text((10, 8), title, fill=(232, 163, 61), font=font)
    for i, t in enumerate(tiles):
        s.paste(t, (6 + (i % cols) * (W + 6), 52 + (i // cols) * (H + 6)))
    s.save(out, quality=88)
    print(out)


def mmss(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


mode, d, out, title = sys.argv[1:5]
d = Path(d)
if mode == 'compare':
    tiles = []
    for t in [float(x) for x in sys.argv[5].split(',')]:
        tiles.append(label(Image.open(d / f'lagoon_t{t:.2f}.png'), f'今  {t:.2f} 秒 ({mmss(t)})'))
        tiles.append(label(Image.open(d / f'hanabi_t{t:.2f}.png'), f'案  {t:.2f} 秒 ({mmss(t)})'))
    sheet(tiles, 2, out, title)
else:
    cols = int(sys.argv[5]) if len(sys.argv) > 5 else 3
    files = sorted(d.glob('hanabi_t*.png'), key=lambda p: float(p.stem.split('_t')[1]))
    sheet([label(Image.open(f), f'{float(f.stem.split("_t")[1]):.2f} 秒') for f in files], cols, out, title)
