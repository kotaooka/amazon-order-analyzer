# アプリアイコンを作る（方眼の上に、段ボール箱と、伸びる棒グラフ）。python tools/make_icons.py（Pillow が必要）
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'icons'
BG, GRID, WHITE, BOX, TAPE, BAR = (29, 92, 150), (50, 112, 168), (255, 255, 255), (170, 205, 240), (240, 160, 122), (255, 255, 255)

def draw(size, maskable=False):
    s = 4 * size  # 4 倍で描いて縮小（縁を滑らかにする）
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)
        k = 0.72  # 円形に切り抜かれても収まる大きさ
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.2, fill=BG)
        k = 1.0
    step = s / 8
    for i in range(1, 8):
        d.line([i * step, 0, i * step, s], fill=GRID, width=max(1, s // 256))
        d.line([0, i * step, s, i * step], fill=GRID, width=max(1, s // 256))
    if not maskable:
        mask = Image.new('L', (s, s), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.2, fill=255)
        im.putalpha(mask)
        d = ImageDraw.Draw(im)
    c = s / 2
    u = s * k  # 図の大きさの単位
    # 段ボール箱（左下）
    bx0, by0, bx1, by1 = c - 0.34 * u, c - 0.02 * u, c + 0.06 * u, c + 0.32 * u
    d.rectangle([bx0, by0, bx1, by1], fill=BOX)
    d.polygon([(bx0, by0), (bx0 + 0.06 * u, by0 - 0.1 * u), (bx1 + 0.06 * u, by0 - 0.1 * u), (bx1, by0)], fill=(140, 182, 225))
    d.rectangle([(bx0 + bx1) / 2 - 0.035 * u, by0, (bx0 + bx1) / 2 + 0.035 * u, by0 + 0.16 * u], fill=TAPE)
    # 棒グラフ（右に伸びる 3 本）
    w = 0.09 * u
    base = c + 0.32 * u
    for i, h in enumerate([0.26, 0.42, 0.62]):
        x0 = c + 0.1 * u + i * (w + 0.03 * u)
        d.rounded_rectangle([x0, base - h * u, x0 + w, base], radius=w * 0.18, fill=BAR)
    return im.resize((size, size), Image.LANCZOS)

OUT.mkdir(exist_ok=True)
draw(512).save(OUT / 'icon-512.png')
draw(192).save(OUT / 'icon-192.png')
draw(512, maskable=True).save(OUT / 'icon-maskable-512.png')
im = draw(180)
bg = Image.new('RGBA', im.size, BG + (255,)); bg.alpha_composite(im); bg.convert('RGB').save(OUT / 'apple-touch-icon.png')
