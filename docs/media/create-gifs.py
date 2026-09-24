from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).parent
POINTS = {
    "landing-page": [(720, 320), (720, 430), (400, 780), (1040, 780), (720, 1100), (520, 1500), (920, 1500), (720, 1840)],
    "deal-flow": [(140, 130), (300, 130), (470, 130), (620, 130), (700, 200)],
    "sign-in": [(480, 540), (720, 580), (960, 540), (720, 500)],
    "sign-up": [(480, 540), (720, 580), (960, 540), (720, 500)],
    "onboarding": [(720, 500), (520, 380), (900, 640), (720, 720)],
    "canton-wallet": [(360, 500), (1060, 500), (1060, 700), (720, 900), (720, 1350), (720, 1750)],
}

for name, points in POINTS.items():
    base = Image.open(ROOT / f"{name}.png").convert("RGB")
    rgb_frames = []
    for x, y in points:
        frame = base.copy().convert("RGBA")
        glow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(glow)
        draw.ellipse((x - 14, y - 14, x + 14, y + 14), fill=(52, 211, 153, 130))
        glow = glow.filter(ImageFilter.GaussianBlur(7))
        frame = Image.alpha_composite(frame, glow)
        ImageDraw.Draw(frame).ellipse((x - 4, y - 4, x + 4, y + 4), fill=(110, 255, 211, 255))
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
