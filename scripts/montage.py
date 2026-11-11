"""Tile lab screenshots into a labelled grid: montage.py out.jpg cols label1=path1 ..."""
import sys
from PIL import Image, ImageDraw, ImageFont

out, cols = sys.argv[1], int(sys.argv[2])
items = [a.split('=', 1) for a in sys.argv[3:]]
w, h = 640, 360
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (20, 20, 20))
try:
    font = ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', 22)
except OSError:
    font = ImageFont.load_default()
for i, (label, path) in enumerate(items):
    im = Image.open(path).convert('RGB').resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 12 + len(label) * 14, 32), fill=(0, 0, 0))
    d.text((6, 4), label, fill=(255, 255, 255), font=font)
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out, quality=88)
