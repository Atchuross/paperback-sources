#!/usr/bin/env python3
"""Génère les icônes 180x180 des sources (carré arrondi dégradé + initiale)."""
import pathlib
from PIL import Image, ImageDraw, ImageFont

SIZE = 180
RESAMPLE = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
SS = 4                      # supersampling pour des bords nets
W = SIZE * SS
RADIUS = int(W * 0.22)

SOURCES = {
    "bigsolo":     ("B", (99, 102, 241), (49, 46, 129)),    # indigo
    "fanfox":      ("F", (251, 146, 60), (194, 65, 12)),    # orange
    "weebcentral": ("W", (16, 185, 129), (6, 95, 70)),      # émeraude
}

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(px: int):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            try:
                return ImageFont.truetype(path, px, index=1 if path.endswith(".ttc") else 0)
            except Exception:
                try:
                    return ImageFont.truetype(path, px)
                except Exception:
                    continue
    return ImageFont.load_default()


def gradient(size: int, top, bottom) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / (size - 1) + y / (size - 1)) / 2  # diagonale
            px[x, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img


def make(initial: str, top, bottom) -> Image.Image:
    base = gradient(W, top, bottom).convert("RGBA")

    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=RADIUS, fill=255)
    base.putalpha(mask)

    draw = ImageDraw.Draw(base)
    font = load_font(int(W * 0.56))
    box = draw.textbbox((0, 0), initial, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(((W - tw) / 2 - box[0], (W - th) / 2 - box[1]), initial, font=font, fill=(255, 255, 255, 255))

    return base.resize((SIZE, SIZE), RESAMPLE)


def main() -> int:
    for name, (initial, top, bottom) in SOURCES.items():
        out = ROOT / "src" / {"bigsolo": "Bigsolo", "fanfox": "Fanfox", "weebcentral": "WeebCentral"}[name] / "includes" / "icon.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        make(initial, top, bottom).save(out, "PNG", optimize=True)
        print(f"  {out.relative_to(ROOT)}  {out.stat().st_size} o")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
