from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
W, H = 1280, 800
BG = (11, 19, 32)
PAPER = (214, 222, 231)
MUTED = (136, 149, 165)
FAINT = (96, 110, 126)
NET = (102, 115, 131)
LINE = (42, 57, 73)
INK = (17, 25, 35)
EMERALD = (56, 217, 192)
STEEL = (125, 211, 252)
MID = (109, 195, 234)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)


def font(size):
    return ImageFont.truetype("C:/Windows/Fonts/arial.ttf", size)


def fontb(size):
    return ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", size)


def fontm(size):
    return ImageFont.truetype("C:/Windows/Fonts/consola.ttf", size)


def tw(text, f):
    b = d.textbbox((0, 0), text, font=f)
    return b[2] - b[0], b[3] - b[1]


def text_at(x, y, text, f, fill, anchor_center_x=False):
    w, h = tw(text, f)
    if anchor_center_x:
        x = x - w // 2
    d.text((x, y), text, font=f, fill=fill)
    return w, h


# ---- Background: faint network geometry (landing-page hero concept) ----
net_lines = [
    [(40, 700), (150, 620), (300, 640), (420, 560)],
    [(40, 120), (170, 200), (320, 170), (450, 250)],
    [(1230, 130), (1120, 210), (970, 180), (850, 260)],
    [(1230, 680), (1110, 600), (960, 630), (840, 550)],
]
for seg in net_lines:
    for i in range(len(seg) - 1):
        d.line((seg[i], seg[i + 1]), fill=NET, width=1)
for pts in net_lines:
    for (x, y) in pts:
        d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(136, 149, 165, 255))

# ---- Header ----
d.ellipse((80, 48, 100, 68), fill=EMERALD)
text_at(118, 45, "AEGIS / CANTON WALLET", fontb(18), STEEL)
w, _ = tw("Canton testnet · chain 30337 · EIP-1193 / EIP-6963", font(18))
text_at(1280 - 80 - w, 45, "Canton testnet · chain 30337 · EIP-1193 / EIP-6963", font(18), FAINT)

title = [("Sign. ", EMERALD), ("Verify. ", MID), ("Settle.", STEEL)]
x = 80
for text, color in title:
    w, _ = text_at(x, 128, text, fontb(52), color)
    x += w
text_at(80, 196, "Non-custodial Canton funding inside every deal — Aegis never holds your key.", font(22), MUTED)

# ---- Integration flow row (landing "integration flow" icon-chip concept) ----
BOX, GAP, LABEL_Y, ROW_Y = 116, 84, 462, 348
n = 5
row_w = n * BOX + (n - 1) * GAP
x0 = (W - row_w) // 2 + 8
boxes = [x0 + i * (BOX + GAP) for i in range(n)]
for i in range(n - 1):
    ax = boxes[i] + BOX + 14
    d.line((ax, ROW_Y + BOX // 2, ax + GAP - 40, ROW_Y + BOX // 2), fill=LINE, width=2)
    d.polygon(
        [(ax + GAP - 44, ROW_Y + BOX // 2 - 6), (ax + GAP - 30, ROW_Y + BOX // 2), (ax + GAP - 44, ROW_Y + BOX // 2 + 6)],
        fill=LINE,
    )

steps = [
    ("Deal room", 0),
    ("OneSwap quote", 1),
    ("Metatarz sign", 0),
    ("Update-id verify", 1),
    ("Settlement", 0),
]


def icon(bx, by, kind, color):
    cx, cy = bx + BOX // 2, by + BOX // 2 - 6
    if kind == "deal":  # building
        d.rectangle((cx - 22, cy - 14, cx + 22, cy + 18), outline=color, width=3)
        d.rectangle((cx - 10, cy + 2, cx + 10, cy + 18), fill=color)
        d.rectangle((cx - 22, cy - 22, cx + 22, cy - 14), fill=color)
    elif kind == "quote":  # trend line
        d.line((cx - 22, cy + 16, cx - 8, cy + 2), fill=color, width=3)
        d.line((cx - 8, cy + 2, cx + 6, cy + 10), fill=color, width=3)
        d.line((cx + 6, cy + 10, cx + 22, cy - 10), fill=color, width=3)
        d.polygon([(cx + 22, cy - 18), (cx + 14, cy - 14), (cx + 22, cy - 10)], fill=color)
    elif kind == "wallet":  # wallet
        d.rounded_rectangle((cx - 24, cy - 14, cx + 24, cy + 14), radius=4, outline=color, width=3)
        d.rounded_rectangle((cx - 10, cy - 14, cx + 24, cy + 14), radius=4, fill=color)
        d.ellipse((cx + 14, cy - 2, cx + 20, cy + 4), fill=BG)
    elif kind == "verify":  # check in circle
        d.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), outline=color, width=3)
        d.line((cx - 10, cy, cx - 2, cy + 8), fill=color, width=4)
        d.line((cx - 2, cy + 8, cx + 12, cy - 8), fill=color, width=4)
    elif kind == "settle":  # check + ledger line
        d.rounded_rectangle((cx - 24, cy - 14, cx + 24, cy + 14), radius=4, outline=color, width=3)
        d.line((cx - 12, cy, cx - 3, cy + 9), fill=color, width=4)
        d.line((cx - 3, cy + 9, cx + 12, cy - 8), fill=color, width=4)


colors = [EMERALD, STEEL, EMERALD, STEEL, EMERALD]
kinds = ["deal", "quote", "wallet", "verify", "settle"]
for i, bx in enumerate(boxes):
    d.rounded_rectangle((bx, ROW_Y, bx + BOX, ROW_Y + BOX), radius=14, fill=INK, outline=LINE, width=2)
    icon(bx, ROW_Y, kinds[i], colors[i])
    label, txt_color = (steps[i][0], MUTED)
    wl, _ = tw(label, font(19))
    text_at(bx + BOX // 2 - wl // 2, LABEL_Y, label, font(19), txt_color)

# ---- Ledger bar ----
led_y = 556
led_h = 140
d.rounded_rectangle((80, led_y, 1200, led_y + led_h), radius=16, fill=INK, outline=LINE, width=2)
d.line((80, led_y + 34, 1200, led_y + 34), fill=(28, 40, 54), width=1)
text_at(104, led_y + 10, "THE TRANSACTION RECORD", fontb(16), (96, 110, 126))

lx = 104
for text, col in [
    ("update_id ", MUTED),
    ("0x9c41…e2b1", EMERALD),
    ("  →  ", FAINT),
    ("receipt status 0x1", STEEL),
]:
    w, _ = text_at(lx, led_y + 52, text, fontm(22), col)
    lx += w

right_edge = 1196
chip1, _ = tw("DEPOSIT RECORDED", fontb(17))
chip2, _ = tw("SETTLEMENT VERIFIED", fontb(17))
c1w, c2w = chip1 + 40, chip2 + 40
c1x, c2x = right_edge - c1w, right_edge - c2w
d.rounded_rectangle((c1x, led_y + 40, c1x + c1w, led_y + 82), radius=21, fill=(14, 48, 36))
text_at(c1x + 20, led_y + 49, "DEPOSIT RECORDED", fontb(17), EMERALD)
d.rounded_rectangle((c2x, led_y + 84, c2x + c2w, led_y + 126), radius=21, fill=(14, 42, 58))
text_at(c2x + 20, led_y + 93, "SETTLEMENT VERIFIED", fontb(17), STEEL)

# ---- Footer ----
text_at(80, 706, "Goes live with a OneSwap API key and whitelisted Metatarz target parties.", font(19), FAINT)
w, _ = tw("NON-CUSTODIAL", fontb(16))
text_at(1280 - 80 - w, 706, "NON-CUSTODIAL", fontb(16), STEEL)

img.save(ROOT / "canton-wallet.png")
print("Saved canton-wallet.png", img.size)