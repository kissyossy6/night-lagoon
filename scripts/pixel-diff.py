"""
Compare same-named images in two folders, pixel by pixel.

    python3 scripts/pixel-diff.py <dirA> <dirB> [--heat=<outDir>]

For every image name found in both folders prints the number of differing
pixels, their share and the largest per-channel difference (0-255). With
--heat, writes a picture per differing pair that shows where they differ.
Exit code 0 when every pair is identical, 1 otherwise.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

EXT = {'.png', '.jpg', '.jpeg', '.webp'}


def load(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    if len(args) != 2:
        print(__doc__)
        return 2
    a, b = Path(args[0]), Path(args[1])
    heat = Path(opts['heat']) if 'heat' in opts else None
    names_a = {p.name for p in a.iterdir() if p.suffix.lower() in EXT}
    names_b = {p.name for p in b.iterdir() if p.suffix.lower() in EXT}
    common = sorted(names_a & names_b)
    for n in sorted(names_a ^ names_b):
        print(f'  only in {"A" if n in names_a else "B"}: {n}')
    worst = 0
    changed = 0
    print(f'{"image":34} {"pixels":>9} {"share":>8} {"max":>4}')
    for n in common:
        x, y = load(a / n), load(b / n)
        if x.shape != y.shape:
            print(f'{n:34} size differs {x.shape} vs {y.shape}')
            changed += 1
            continue
        d = np.abs(x - y).max(axis=2)
        count = int((d > 0).sum())
        mx = int(d.max())
        worst = max(worst, mx)
        changed += count > 0
        print(f'{n:34} {count:9d} {count / d.size:8.4%} {mx:4d}')
        if heat and count:
            heat.mkdir(parents=True, exist_ok=True)
            # differing pixels in red over a dimmed copy of A
            img = (x * 0.35).astype(np.uint8)
            img[d > 0] = [255, 40, 40]
            Image.fromarray(img).save(heat / n)
    print(f'{len(common)} pairs, {changed} differ, largest difference {worst}')
    return 0 if changed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
