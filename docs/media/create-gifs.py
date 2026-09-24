from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).parent
MAX_W = {"landing-page": 640}.get("landing-page", 1000)
POINTS = {
    "landing-page": [(480, 300), (480, 420), (320, 720), (680, 1100), (480, 1600)],
    "deal-flow": [(140, 130), (300, 130), (470, 130), (620, 130), (700, 200)],
    "sign-in": [(480, 540), (720, 580), (960, 540), (720, 500)],
    "sign-up": [(480, 540), (720, 580), (960, 540), (720, 500)],
    "onboarding": [(720, 500), (520, 380), (900, 640), (720, 720)],
    "canton-wallet": [(360, 500), (1060, 500), (1060, 700), (720, 900), (720, 1350), (720, 1750)],
}

for name, points in POINTS.items():
    base = Image.open(ROOT / f"{name}.png").convert("RGB")
    if base.width > MAX_W:
        scale = MAX_W / base.width
        base = base.resize((MAX_W, round(base.height * scale)), Image.LANCZOS)
    rgb_frames = []
    for fx, fy in points:
        frame = base.copy().convert("RGBA")
        glow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(glow)
        draw.ellipse((fx - 14, fy - 14, fx + 14, fy + 14), fill=(52, 211, 153, 130))
        glow = glow.filter(ImageFilter.GaussianBlur(7))
        frame = Image.alpha_composite(frame, glow)
        ImageDraw.Draw(frame).ellipse((fx - 4, fy - 4, fx + 4, fy + 4), fill=(110, 255, 211, 255))
        rgb_frames.append(frame.convert("RGB"))
    palette_source = Image.new("RGB", (base.width, base.height * len(rgb_frames)))
    for index, frame in enumerate(rgb_frames):
        palette_source.paste(frame, (0, index * base.height))
    palette = palette_source.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in rgb_frames]
    frames[0].save(
        ROOT / f"{name}.gif",
        save_all=True,
        append_images=frames[1:],
        duration=220,
        loop=0,
        disposal=2,
        optimize=True,
    )
    print(f"Created {name}.gif ({len(frames)} animated frames)")
