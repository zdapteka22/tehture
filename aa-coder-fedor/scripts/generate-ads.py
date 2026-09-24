#!/usr/bin/env python3
"""Strict cosmic-HUD installer slides. Real coder functions, no carnival stripes."""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "electron" / "ads"
W, H = 1280, 720

FONT_REG = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FONT_MONO = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")

SLIDES = [
    {
        "file": "ad-code.jpg",
        "kicker": "КОД",
        "title": "Сила в коде",
        "body": "Пишет и чинит как сильный инженер. Читает проект, правит файлы, запускает команды и смотрит вывод.",
        "hue": (8, 140, 220),
        "motif": "code",
    },
    {
        "file": "ad-both.jpg",
        "kicker": "ПК",
        "title": "Ваш компьютер",
        "body": "Работает с вами за ПК: папки, диск, программы, терминал. То, что вы сделали бы руками — только быстрее.",
        "hue": (40, 170, 210),
        "motif": "split",
    },
    {
        "file": "ad-parallel.jpg",
        "kicker": "БРАУЗЕР",
        "title": "Живой браузер",
        "body": "Открывает Chrome или Edge, заходит на сайты, смотрит страницы. Взаимодействие как у человека за компьютером.",
        "hue": (20, 190, 170),
        "motif": "lanes",
    },
    {
        "file": "ad-memory.jpg",
        "kicker": "СЕТИ",
        "title": "Блокчейн и нейросети",
        "body": "Контракты, кошельки, сети. Модели, пайплайны, ключи API. Силён там, где код встречается с цепью и с моделью.",
        "hue": (90, 120, 255),
        "motif": "orbit",
    },
    {
        "file": "ad-agents.jpg",
        "kicker": "РОССИЯ",
        "title": "Доступ из России без VPN",
        "body": "Кодер открывается из России без VPN. Домашний интернет, без обхода блокировок.",
        "hue": (220, 170, 70),
        "motif": "earth",
    },
    {
        "file": "ad-sbp.jpg",
        "kicker": "ОПЛАТА",
        "title": "ЮMoney и крипта",
        "body": "Платите через ЮMoney — зарубежная карта не нужна. Крипта USDT, BTC, TON.",
        "hue": (200, 150, 60),
        "motif": "earth",
    },
    {
        "file": "ad-crew.jpg",
        "kicker": "ЭКИПАЖ",
        "title": "Мозговой трест",
        "body": "Координатор, архитектор, кодер и критик думают вместе. Сложная задача — план, правки, проверка.",
        "hue": (160, 90, 220),
        "motif": "nodes",
    },
    {
        "file": "ad-free.jpg",
        "kicker": "ПАМЯТЬ",
        "title": "Super Memory",
        "body": "Помнит решения проекта. Новый чат не начинает с нуля. На столе ярлык: AA Coder Fedor 3.0.",
        "hue": (70, 200, 140),
        "motif": "nodes",
    },
]


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def mix(c0, c1, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(lerp(c0[i], c1[i], t)) for i in range(3))


def hash01(x: int, y: int, salt: int) -> float:
    n = (x * 374761393 + y * 668265263 + salt * 1274126177) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return (n & 0xFFFFFF) / 0xFFFFFF


def draw_stars(px, rng: random.Random, count: int = 420) -> None:
    w, h = px.size
    for i in range(count):
        x = rng.randrange(w)
        y = rng.randrange(h)
        bright = 90 + rng.randrange(165)
        size = 1 if rng.random() > 0.12 else 2
        col = (bright, bright, min(255, bright + 20))
        px.putpixel((x, y), col)
        if size == 2 and x + 1 < w:
            px.putpixel((x + 1, y), mix(col, (20, 30, 50), 0.4))


def draw_nebula(base: Image.Image, hue, seed: int) -> Image.Image:
    w, h = base.size
    overlay = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(overlay)
    rng = random.Random(seed)
    for _ in range(5):
        cx = int(w * rng.uniform(0.45, 0.95))
        cy = int(h * rng.uniform(0.05, 0.75))
        rw = int(w * rng.uniform(0.22, 0.48))
        rh = int(h * rng.uniform(0.18, 0.42))
        col = mix((4, 8, 18), hue, rng.uniform(0.35, 0.7))
        d.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=col)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=64))
    return Image.blend(base, overlay, 0.38)


def perspective_grid(draw: ImageDraw.ImageDraw, hue, y0: int = 430) -> None:
    vanishing = (int(W * 0.72), y0)
    color = mix(hue, (180, 220, 255), 0.45)
    for i in range(18):
        y = y0 + int((i * i) * 1.15)
        if y >= H:
            break
        a = int(40 + (1 - i / 18) * 90)
        draw.line([(0, y), (W, y)], fill=(*color, a) if False else color, width=1)
    for k in range(-16, 17):
        x = int(W * 0.72 + k * 70)
        draw.line([(x, H), vanishing], fill=color, width=1)
    draw.line([(0, y0), (W, y0)], fill=mix(hue, (255, 255, 255), 0.55), width=1)


def hud_corners(draw: ImageDraw.ImageDraw, hue, pad=28, arm=48) -> None:
    c = mix(hue, (230, 245, 255), 0.35)
    boxes = [
        (pad, pad, pad + arm, pad, pad, pad + arm),
        (W - pad, pad, W - pad - arm, pad, W - pad, pad + arm),
        (pad, H - pad, pad + arm, H - pad, pad, H - pad - arm),
        (W - pad, H - pad, W - pad - arm, H - pad, W - pad, H - pad - arm),
    ]
    for x, y, x2, y2, x3, y3 in boxes:
        draw.line([(x, y), (x2, y2)], fill=c, width=2)
        draw.line([(x, y), (x3, y3)], fill=c, width=2)


def motif_code(draw: ImageDraw.ImageDraw, hue) -> None:
    x0, y0 = 720, 90
    for i, line in enumerate(
        ["fn patch(repo)", "  read files", "  apply diff", "  run cmd", "  check out"]
    ):
        draw.text((x0, y0 + i * 38), line, font=font(FONT_MONO, 22), fill=mix(hue, (220, 240, 255), 0.6))
    draw.rectangle([700, 70, 1180, 300], outline=mix(hue, (255, 255, 255), 0.4), width=1)


def motif_split(draw: ImageDraw.ImageDraw, hue) -> None:
    c = mix(hue, (200, 230, 255), 0.5)
    draw.rectangle([700, 80, 930, 340], outline=c, width=2)
    draw.rectangle([960, 80, 1190, 340], outline=c, width=2)
    draw.text((724, 96), "DISK", font=font(FONT_MONO, 16), fill=c)
    draw.text((984, 96), "APPS", font=font(FONT_MONO, 16), fill=c)
    for i in range(5):
        draw.line([(720, 150 + i * 32), (910, 150 + i * 32)], fill=c, width=1)
        draw.line([(980, 150 + i * 32), (1170, 150 + i * 32)], fill=c, width=1)


def motif_lanes(draw: ImageDraw.ImageDraw, hue) -> None:
    c = mix(hue, (200, 255, 240), 0.5)
    for i in range(3):
        y = 110 + i * 90
        draw.rounded_rectangle([700, y, 1180, y + 64], radius=6, outline=c, width=2)
        draw.text((720, y + 18), f"SITE {i + 1}  ·  browser open", font=font(FONT_MONO, 18), fill=c)


def motif_nodes(draw: ImageDraw.ImageDraw, hue) -> None:
    pts = [(780, 140), (980, 110), (1120, 210), (900, 280), (1060, 330), (820, 330)]
    c = mix(hue, (210, 210, 255), 0.55)
    for a, b in [(0, 1), (1, 2), (0, 3), (3, 4), (2, 4), (3, 5), (4, 5)]:
        draw.line([pts[a], pts[b]], fill=c, width=1)
    for x, y in pts:
        draw.ellipse([x - 8, y - 8, x + 8, y + 8], outline=c, width=2)


def motif_orbit(draw: ImageDraw.ImageDraw, hue) -> None:
    cx, cy = 960, 220
    c = mix(hue, (200, 255, 210), 0.5)
    for r in (50, 90, 140):
        draw.ellipse([cx - r, cy - r // 2, cx + r, cy + r // 2], outline=c, width=1)
    for ang, label in ((0, "chain"), (2.1, "model"), (4.2, "wallet")):
        x = cx + int(math.cos(ang) * 140)
        y = cy + int(math.sin(ang) * 70)
        draw.ellipse([x - 10, y - 10, x + 10, y + 10], outline=c, width=2)
        draw.text((x + 14, y - 8), label, font=font(FONT_MONO, 16), fill=c)


def motif_earth(draw: ImageDraw.ImageDraw, hue) -> None:
    cx, cy, r = 980, 230, 120
    c = mix(hue, (255, 230, 160), 0.45)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=2)
    draw.arc([cx - r + 30, cy - 40, cx + r - 30, cy + 40], 200, 340, fill=c, width=2)
    draw.text((cx - 70, cy + r + 16), "NO VPN  ·  SBP", font=font(FONT_MONO, 18), fill=c)


MOTIF = {
    "code": motif_code,
    "split": motif_split,
    "lanes": motif_lanes,
    "nodes": motif_nodes,
    "orbit": motif_orbit,
    "earth": motif_earth,
}


def wrap(text: str, fnt, max_w: int, draw: ImageDraw.ImageDraw) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=fnt) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render(slide: dict) -> bytes:
    hue = slide["hue"]
    rng = random.Random(sum(ord(ch) for ch in slide["file"]))
    img = Image.new("RGB", (W, H), (4, 8, 16))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        col = mix((3, 6, 14), (8, 18, 36), t)
        for x in range(W):
            px[x, y] = col
    img = draw_nebula(img, hue, rng.randint(1, 10_000))
    draw_stars(img, rng)
    draw = ImageDraw.Draw(img)
    perspective_grid(draw, hue)
    hud_corners(draw, hue)
    MOTIF[slide["motif"]](draw, hue)

    # left vignette for copy
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for x in range(0, 760):
        a = int(220 * (1 - x / 760) ** 1.15)
        sd.line([(x, 0), (x, H)], fill=a)
    black = Image.new("RGB", (W, H), (2, 4, 10))
    img = Image.composite(black, img, shade)
    draw = ImageDraw.Draw(img)

    # Left third stays dark for HTA/splash copy. Right side is the HUD motif.
    kicker_f = font(FONT_MONO, 16)
    brand_f = font(FONT_MONO, 14)
    draw.text((56, 36), "AA CODER FEDOR ULTIMA  v 1.03", font=brand_f, fill=mix(hue, (230, 240, 255), 0.55))
    draw.rectangle([56, 62, 140, 64], fill=hue)
    draw.text((700, 36), slide["kicker"], font=kicker_f, fill=mix(hue, (255, 255, 255), 0.45))

    buf = __import__("io").BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    return buf.getvalue()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    keep = {s["file"] for s in SLIDES}
    for old in OUT.glob("*.png"):
        if old.name not in keep:
            old.unlink()
            print(f"removed {old}")
    for slide in SLIDES:
        path = OUT / slide["file"]
        path.write_bytes(render(slide))
        print(f"wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
