"""
Cuts the item art sheets (5 x 2 grids on a cream background, numbered) into icons for the bag:
the background becomes transparent, each icon is trimmed, centred on a square and saved as WebP.

  python3 scripts/make-item-icons.py   → public/art/items/{bow,armor,helmet,boots,gloves,cape,belt}-{1..10}.webp
"""
import os
from PIL import Image

HOME = os.path.expanduser('~')
SHEETS = {
    # name: (file, row bands (top, bottom) above the numbers[, column edges if not an even grid])
    'bow': (f'{HOME}/Downloads/Ten colorful fantasy bow designs.png', [(0, 538), (568, 1132)]),
    'armor': (f'{HOME}/Downloads/Ten varied breastplate designs.png', [(40, 440), (470, 915)]),
    'helmet': (f'{HOME}/Downloads/Fantasy headwear lineup, ten designs.png', [(30, 420), (480, 905)]),
    'boots': (f'{HOME}/Downloads/Numbered sheet of ten matching boot pairs.png', [(20, 425), (500, 910)]),
    'gloves': (f'{HOME}/Downloads/Ten fantasy glove designs.png', [(40, 395), (470, 905)], [0, 300, 588, 882, 1188, 1536]),
    # Capes 9 and 10 overlap side to side: each cell is given as its own (left, right), overlapping;
    # the numbers and the neighbour's hem get dropped as small shapes.
    'belt': (f'{HOME}/Downloads/Ten fantasy belt designs.png', [(60, 420), (440, 745)]),
    'cape': (f'{HOME}/Downloads/Ten fantasy capes concept sheet.png', [(0, 450), (455, 990)],
             [[(0, 320), (330, 615), (640, 915), (925, 1210), (1215, 1536)], [(0, 305), (305, 600), (600, 895), (880, 1215), (1130, 1536)]]),
}
SIZE = 160
OUT = 'public/art/items'


def clear_background(cell, bg):
    """Background → transparent: everything cream joined to the cell's edges (inner highlights stay)."""
    px = cell.load()
    w, h = cell.size
    seen = bytearray(w * h)
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        p = px[x, y]
        if sum(abs(a - b) for a, b in zip(p[:3], bg)) > 60:
            continue
        px[x, y] = (0, 0, 0, 0)
        if x > 0: stack.append((x - 1, y))
        if x < w - 1: stack.append((x + 1, y))
        if y > 0: stack.append((x, y - 1))
        if y < h - 1: stack.append((x, y + 1))


def clear_enclosed(cell, bg, min_area=4000, tol=45):
    """Big cream areas shut in by the drawing (inside a bow, between limb and string) → transparent.
    Thin cream parts of the drawing itself (an ivory bow) are smaller, so they stay."""
    px = cell.load()
    w, h = cell.size
    seen = bytearray(w * h)
    near = lambda p: p[3] > 0 and sum(abs(a - b) for a, b in zip(p[:3], bg)) <= tol
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or not near(px[sx, sy]):
                continue
            region = []
            stack = [(sx, sy)]
            while stack:
                x, y = stack.pop()
                i = y * w + x
                if seen[i] or not near(px[x, y]):
                    continue
                seen[i] = 1
                region.append((x, y))
                if x > 0: stack.append((x - 1, y))
                if x < w - 1: stack.append((x + 1, y))
                if y > 0: stack.append((x, y - 1))
                if y < h - 1: stack.append((x, y + 1))
            if len(region) >= min_area:
                for x, y in region:
                    px[x, y] = (0, 0, 0, 0)


def keep_biggest(cell):
    """Drops slivers of the neighbouring drawings: only the big shapes stay (both boots of a pair)."""
    px = cell.load()
    w, h = cell.size
    label = [0] * (w * h)
    sizes = {}
    n = 0
    for sy in range(h):
        for sx in range(w):
            if label[sy * w + sx] or px[sx, sy][3] == 0:
                continue
            n += 1
            stack = [(sx, sy)]
            count = 0
            while stack:
                x, y = stack.pop()
                i = y * w + x
                if label[i] or px[x, y][3] == 0:
                    continue
                label[i] = n
                count += 1
                if x > 0: stack.append((x - 1, y))
                if x < w - 1: stack.append((x + 1, y))
                if y > 0: stack.append((x, y - 1))
                if y < h - 1: stack.append((x, y + 1))
            sizes[n] = count
    biggest = max(sizes.values())
    keep = {k for k, v in sizes.items() if v >= biggest * 0.2}
    for y in range(h):
        for x in range(w):
            if label[y * w + x] and label[y * w + x] not in keep:
                px[x, y] = (0, 0, 0, 0)


for name, (path, rows, *cols) in SHEETS.items():
    sheet = Image.open(path).convert('RGBA')
    w, _ = sheet.size
    bg = sheet.getpixel((5, 5))[:3]
    n = 0
    for r, (top, bottom) in enumerate(rows):
        for col in range(5):
            n += 1
            if cols and isinstance(cols[0][0], list):
                left, right = cols[0][r][col]  # explicit cells per row
            else:
                edges = cols[0] if cols else [c * w // 5 for c in range(6)]
                left, right = edges[col], edges[col + 1]
            cell = sheet.crop((left, top, right, bottom))
            clear_background(cell, bg)
            if name == 'bow':
                clear_enclosed(cell, bg)
            if name == 'belt':
                clear_enclosed(cell, bg, 1500, 18)  # inside the loop (tight: the ivory belt must stay)
            keep_biggest(cell)
            icon = cell.crop(cell.getbbox())
            if name == 'bow':
                icon = icon.rotate(-38, expand=True, resample=Image.BICUBIC)  # diagonal: fills the square
                icon = icon.crop(icon.getbbox())
            side = max(icon.width, icon.height) + 8
            square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
            square.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
            square.resize((SIZE, SIZE), Image.LANCZOS).save(f'{OUT}/{name}-{n}.webp', 'WEBP', quality=88)
    print(name, n, 'icons')
