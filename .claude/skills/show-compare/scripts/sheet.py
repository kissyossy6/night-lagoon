#!/usr/bin/env python3
"""今｜案 sheets, motion strips, brightness steps and a toggle viewer from
the frames capture.mjs wrote (<dir>/<name>_t<sec.2>.png).

  python3 sheet.py compare <dir> <out.jpg> [--srcs=now,new] [--labels=今,案] [--t=62.53,66.5] [--title=...]
      one row per time, one column per source, label + time + brightness on each tile
  python3 sheet.py strip <dir> <out.jpg> --src=new [--cols=5] [--title=...]
      every frame of one source in time order (motion strip)
  python3 sheet.py pair-strip <dir> <out.jpg> [--srcs=now,new] [--labels=今,案] [--title=...]
      two strips, one above the other (motion now vs proposal)
  python3 sheet.py bright <dir> [--srcs=now,new]
      mean brightness 0-255 of every frame, per source; writes <dir>/bright.json
  python3 sheet.py diff <dir> [--srcs=now,new]
      pixel difference of two sources at each time; exit 0 only if all 0 px
      (use it to prove other versions did not change)
  python3 sheet.py ab <dir> [--srcs=now,new] [--labels=今,案] [--title=...]
      writes <dir>/ab.html: switch 今/案 with a button or the space key,
      or show them side by side (open through the dev server:
      http://localhost:5199/<dir>/ab.html)

Needs Pillow and numpy.
"""
import glob
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONTS = [
    '/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc',
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
]
TILE_W, TILE_H = 640, 360
NAME_RE = re.compile(r'^(?P<name>[^_]+)_t(?P<t>-?\d+\.\d\d)\.png$')


def font(size):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def opts(argv):
    o, pos = {}, []
    for a in argv:
        if a.startswith('--'):
            k, _, v = a[2:].partition('=')
            o[k] = v
        else:
            pos.append(a)
    return o, pos


def frames(d):
    out = {}
    for p in glob.glob(os.path.join(d, '*_t*.png')):
        m = NAME_RE.match(os.path.basename(p))
        if m:
            out.setdefault(m['name'], {})[float(m['t'])] = p
    return out


def brightness(path):
    """Mean luminance 0-255 (Rec.709) of the whole frame."""
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
    return float((a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722).mean())


def mmss(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


def tile(path, label):
    im = Image.open(path).convert('RGB').resize((TILE_W, TILE_H), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    f = font(20)
    box = d.textbbox((0, 0), label, font=f)
    d.rectangle((0, 0, box[2] + 16, box[3] + 12), fill=(0, 0, 0))
    d.text((8, 5), label, font=f, fill=(255, 255, 255))
    return im


def sheet(rows, out, title):
    cols = max(len(r) for r in rows)
    head = 48 if title else 0
    W, H = cols * TILE_W + (cols + 1) * 6, len(rows) * TILE_H + (len(rows) + 1) * 6 + head
    canvas = Image.new('RGB', (W, H), (24, 24, 24))
    if title:
        ImageDraw.Draw(canvas).text((12, 10), title, font=font(26), fill=(240, 240, 240))
    for r, row in enumerate(rows):
        for c, im in enumerate(row):
            canvas.paste(im, (6 + c * (TILE_W + 6), head + 6 + r * (TILE_H + 6)))
    canvas.save(out, quality=88)
    print(out, f'{W}x{H}')


def capture_order(d, fr):
    """Sources in the order capture.mjs shot them (the first is 今), else sorted."""
    try:
        with open(os.path.join(d, 'capture.json')) as f:
            names = [s['name'] for s in json.load(f)['sources']]
        return [n for n in names if n in fr] + sorted(n for n in fr if n not in names)
    except (OSError, KeyError, ValueError):
        return sorted(fr)


def pick(fr, o, d, default_labels=('今', '案')):
    srcs = o.get('srcs', '').split(',') if o.get('srcs') else capture_order(d, fr)
    labels = o.get('labels', '').split(',') if o.get('labels') else list(default_labels[: len(srcs)]) + srcs[len(default_labels):]
    missing = [s for s in srcs if s not in fr]
    if missing:
        sys.exit(f'no frames for {missing}; found {sorted(fr)}')
    return srcs, labels


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    o, pos = opts(sys.argv[2:])
    d = pos[0]
    fr = frames(d)
    if not fr:
        sys.exit(f'no <name>_t<sec>.png frames in {d}')
    title = o.get('title', '')

    if cmd == 'compare':
        srcs, labels = pick(fr, o, d)
        times = [float(t) for t in o['t'].split(',')] if o.get('t') else sorted(set.intersection(*(set(fr[s]) for s in srcs)))
        rows = []
        for t in times:
            row = []
            for s, lab in zip(srcs, labels):
                p = fr[s].get(round(t, 2))
                if p:
                    row.append(tile(p, f'{lab}  {t:.2f}秒 ({mmss(t)})  明るさ {brightness(p):.0f}'))
            rows.append(row)
        sheet(rows, pos[1], title)
    elif cmd == 'strip':
        s = o.get('src') or sorted(fr)[0]
        cols = int(o.get('cols', 5))
        ims = [tile(p, f'{t:.2f}秒  明るさ {brightness(p):.0f}') for t, p in sorted(fr[s].items())]
        sheet([ims[i:i + cols] for i in range(0, len(ims), cols)], pos[1], title)
    elif cmd == 'pair-strip':
        srcs, labels = pick(fr, o, d)
        rows = [[tile(p, f'{lab} {t:.2f}秒') for t, p in sorted(fr[s].items())] for s, lab in zip(srcs, labels)]
        sheet(rows, pos[1], title)
    elif cmd == 'bright':
        srcs, _ = pick(fr, o, d)
        table = {s: {f'{t:.2f}': round(brightness(p), 1) for t, p in sorted(fr[s].items())} for s in srcs}
        times = sorted({t for s in srcs for t in table[s]}, key=float)
        print('時刻    ' + '  '.join(f'{s:>6}' for s in srcs))
        for t in times:
            print(f'{float(t):7.2f} ' + '  '.join(f'{table[s].get(t, float("nan")):6.1f}' for s in srcs))
        with open(os.path.join(d, 'bright.json'), 'w') as f:
            json.dump(table, f, ensure_ascii=False, indent=1)
    elif cmd == 'diff':
        srcs, _ = pick(fr, o, d)
        a, b = srcs[:2]
        same = True
        print(f'時刻     違う画素   割合     最大の差   ({a} と {b})')
        for t in sorted(set(fr[a]) & set(fr[b])):
            x = np.asarray(Image.open(fr[a][t]).convert('RGB'), dtype=np.int16)
            y = np.asarray(Image.open(fr[b][t]).convert('RGB'), dtype=np.int16)
            if x.shape != y.shape:
                print(f'{t:7.2f}  大きさが違う {x.shape} {y.shape}')
                same = False
                continue
            dd = np.abs(x - y).max(axis=2)
            n = int((dd > 0).sum())
            same &= n == 0
            print(f'{t:7.2f}  {n:9d}  {n / dd.size:7.4%}  {int(dd.max()):4d}')
        print('全部同じ（0画素）' if same else '違いあり')
        sys.exit(0 if same else 1)
    elif cmd == 'ab':
        srcs, labels = pick(fr, o, d)
        times = sorted(set.intersection(*(set(fr[s]) for s in srcs)))
        data = [{'t': t, 'mmss': mmss(t), 'imgs': [os.path.basename(fr[s][t]) for s in srcs]} for t in times]
        html = AB_HTML.replace('__DATA__', json.dumps(data)).replace('__LABELS__', json.dumps(labels, ensure_ascii=False)).replace('__TITLE__', title or '今｜案')
        out = os.path.join(d, 'ab.html')
        with open(out, 'w') as f:
            f.write(html)
        print(out)
    else:
        sys.exit(__doc__)


AB_HTML = r"""<!doctype html><html lang="ja"><meta charset="utf-8"><title>__TITLE__</title>
<style>
body{margin:0;background:#111;color:#eee;font:15px -apple-system,'Hiragino Sans',sans-serif}
header{display:flex;gap:8px;align-items:center;padding:10px 16px;flex-wrap:wrap;position:sticky;top:0;background:#111;z-index:1}
button{background:#333;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer}
button[aria-pressed=true]{background:#eee;color:#111}
section{padding:8px 16px 24px}
h2{font-size:15px;margin:8px 0;font-weight:600}
.pair{display:grid;gap:8px}
.pair.side{grid-template-columns:1fr 1fr}
figure{margin:0;position:relative}
figure img{width:100%;display:block;border-radius:4px}
figcaption{position:absolute;top:6px;left:6px;background:#000c;padding:2px 8px;border-radius:4px}
.hint{opacity:.6;margin-left:auto}
</style>
<header><strong>__TITLE__</strong><span id="modes"></span><span class="hint">スペースキーで切り替え</span></header>
<main id="main"></main>
<script>
const DATA=__DATA__, LABELS=__LABELS__;
let mode='toggle', cur=0;
const modes=document.getElementById('modes'), main=document.getElementById('main');
function btn(text,on,fn){const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-pressed',on);b.onclick=fn;return b}
function render(){
  modes.replaceChildren(
    ...LABELS.map((l,i)=>btn(l,mode==='toggle'&&cur===i,()=>{mode='toggle';cur=i;render()})),
    btn('並べる',mode==='side',()=>{mode='side';render()}));
  main.replaceChildren(...DATA.map(d=>{
    const s=document.createElement('section');
    s.innerHTML=`<h2>${d.t.toFixed(2)}秒（${d.mmss}）</h2>`;
    const p=document.createElement('div');p.className='pair'+(mode==='side'?' side':'');
    const show=mode==='side'?d.imgs.map((_,i)=>i):[cur];
    for(const i of show){const f=document.createElement('figure');f.innerHTML=`<img src="${d.imgs[i]}" alt=""><figcaption>${LABELS[i]}</figcaption>`;p.append(f)}
    s.append(p);return s}));
}
addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();mode='toggle';cur=(cur+1)%LABELS.length;render()}});
render();
</script></html>
"""

if __name__ == '__main__':
    main()
