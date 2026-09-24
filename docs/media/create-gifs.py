from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).parent
POINTS = {
    "deal-flow": [(610, 676), (626, 654), (758, 653), (881, 660), (940, 680)],
    "sign-in": [(214, 492), (341, 448), (472, 523), (584, 443), (672, 492)],
    "sign-up": [(214, 492), (341, 448), (472, 523), (584, 443), (672, 492)],
    "onboarding": [(204, 602), (321, 550), (444, 644), (556, 550), (660, 602), (204, 602)],
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
