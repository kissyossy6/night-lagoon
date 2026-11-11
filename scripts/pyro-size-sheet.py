"""Size sheet: each shot of pyro-size-check.mjs cropped round its shell, with
the table's diameter drawn as a circle.  python3 scripts/pyro-size-sheet.py shots/stage2/size"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1]
rows = json.load(open(f'{d}/expected.json'))
font = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', 20)
tiles = []
for r in rows:
    im = Image.open(r['file']).convert('RGB')
    cx, cy, R = r['cx'], r['cy'], r['rPx']
    half = max(R * 1.35, 60)
    crop = im.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half))).resize((420, 420), Image.LANCZOS)
    k = 420 / (2 * half)
    g = ImageDraw.Draw(crop)
    g.ellipse((210 - R * k, 210 - R * k, 210 + R * k, 210 + R * k), outline=(232, 163, 61), width=2)
    g.rectangle((0, 0, 420, 30), fill=(0, 0, 0))
    g.text((8, 4), f"{r['size']}号  表の直径 {r['diameter']:.0f} m（橙の円）", fill=(255, 255, 255), font=font)
    tiles.append(crop)
sheet = Image.new('RGB', (420 * len(tiles) + 10 * (len(tiles) - 1), 420), (20, 20, 20))
for i, t in enumerate(tiles):
    sheet.paste(t, (i * 430, 0))
sheet.save(f'{d}/sizes.jpg', quality=90)
print(f'{d}/sizes.jpg')
