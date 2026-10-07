"""Aegis pitch deck -> PDF. Run from the repo root: python build_deck.py"""
import os
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

W, H = 960.0, 540.0
OUT = "aegis-pitch.pdf"

BG = HexColor("#0A0E14")
PANEL = HexColor("#121821")
LINE = HexColor("#1E2733")
EMERALD = HexColor("#34D399")
STEEL = HexColor("#94A3B8")
DIM = HexColor("#64748B")
WHITE = HexColor("#F1F5F9")
AMBER = HexColor("#FBBF24")

MEDIA = "docs/media"


def cover(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    for i, (cx, cy, r, a) in enumerate([(760, 430, 210, 0.05), (830, 300, 150, 0.04), (700, 150, 120, 0.03)]):
        c.setStrokeColor(Color(EMERALD.red, EMERALD.green, EMERALD.blue, alpha=a * 3))
        c.setLineWidth(1)
        c.circle(cx, cy, r, stroke=1, fill=0)
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(70, 452, "AEGIS")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 46)
    c.drawString(70, 372, "Proof, not promises.")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 17)
    c.drawString(70, 336, "Institutional settlement accountability on Canton.")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 13)
    c.drawString(70, 300, "Every transfer verified against the ledger and filed to one durable record.")
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.line(70, 250, 300, 250)
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 11)
    c.drawString(70, 224, "Mobolaji Opeyemi Bolatito")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 10)
    c.drawString(70, 206, "github.com/opeblow/AEGIS  -  MIT License")
    c.showPage()


def eyebrow(c, text, y=496):
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(60, y, text.upper())


def title(c, text, y=462, size=30):
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", size)
    c.drawString(60, y, text)


def wrap(text, font, size, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if c_width(font, size, t) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


_state = {"c": None}


def c_width(font, size, text):
    return _state["c"].stringWidth(text, font, size)


def bullets(c, items, x, y, width=820, size=12.5, lead=None, gap=None, color=STEEL):
    # `y` is always the baseline of the next line to draw. Spacing is derived
    # from the font size so ascenders/descenders of adjacent lines never touch.
    if lead is None:
        lead = round(size * 1.42, 1)
    if gap is None:
        gap = round(size * 0.72, 1)
    bullet_x = x + 16
    for it in items:
        if isinstance(it, tuple):
            head, rest = it
            hw = c_width("Helvetica-Bold", size, head)
            c.setFillColor(EMERALD)
            c.circle(x + 3, y + size * 0.3, 2.4, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", size)
            c.drawString(bullet_x, y, head)
            lines = wrap(rest, "Helvetica", size, width - 16 - hw)
            c.setFillColor(color)
            c.setFont("Helvetica", size)
            for i, ln in enumerate(lines):
                if i == 0:
                    c.drawString(bullet_x + hw, y, ln)
                else:
                    y -= lead
                    c.drawString(bullet_x, y, ln)
        else:
            c.setFillColor(EMERALD)
            c.circle(x + 3, y + size * 0.3, 2.4, stroke=0, fill=1)
            c.setFillColor(color)
            c.setFont("Helvetica", size)
            for i, ln in enumerate(wrap(it, "Helvetica", size, width - 16)):
                if i:
                    y -= lead
                c.drawString(bullet_x, y, ln)
        y -= lead + gap
    return y


def panel(c, x, y, w, h, fill=PANEL):
    c.setFillColor(fill)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.rect(x, y, w, h, stroke=1, fill=0)


def page(c, kicker, head):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    eyebrow(c, kicker)
    title(c, head)
    c.setFillColor(DIM)
    c.setFont("Helvetica", 8.5)
    c.drawRightString(W - 60, 28, "Aegis  -  github.com/opeblow/AEGIS")


def note(c, text, y=44):
    c.setFillColor(AMBER)
    c.setFont("Helvetica-Oblique", 8.5)
    c.drawString(60, y, text)


def slide_problem(c):
    page(c, "The problem", "Nobody can prove the money arrived")
    bullets(c, [
        ("Today: ", "a spreadsheet for terms, email for approvals, a wallet funded from the main treasury account, and a counterparty who confirms receipt over Slack."),
        ("The gap: ", "an approval that cannot be reconstructed six months later, a transfer nobody can confirm landed, a counterparty doing diligence and receiving a chat screenshot."),
        ("Why it is not merely slow: ", "the expensive part is the exposure. The audit trail is a side effect of work, so when someone asks for it, it is slow, manual, and sometimes simply gone."),
        ("Who feels it: ", "the treasury operations analyst who has to answer 'was this authorized, by whom, and did it settle?' on a Tuesday afternoon."),
    ], 60, 400)
    panel(c, 60, 96, 840, 118)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(84, 182, "The problem, in one sentence")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 11.5)
    c.drawString(84, 158, "Treasury and settlement operations teams cannot prove that an on-chain transfer was authorized and actually landed -- the approval")
    c.drawString(84, 142, "happens over email while the confirmation happens by someone watching a wallet and reporting back.")
    c.setFillColor(DIM)
    c.setFont("Helvetica-Oblique", 9.5)
    c.drawString(84, 116, "That costs a multi-day, multi-team ritual per settlement, and an audit trail that must be rebuilt by hand.")
    c.showPage()


def slide_whynow(c):
    page(c, "Why now", "Custody left the flow. The record did not.")
    bullets(c, [
        ("Canton made private settlement usable. ", "Selective disclosure lets a counterparty verify a trade without the ledger exposing the rest of the firm's book -- the property that makes institutional assets viable on-chain at all."),
        ("Liquidity became programmatic. ", "OneSwap provides quotes, pool data, and swap execution, so settlement no longer queues behind a market maker's desk."),
        ("Non-custodial signing removed the middle. ", "Users sign in their own wallet via Metatarz. Aegis never holds a private key."),
    ], 60, 400)
    panel(c, 60, 128, 840, 150, HexColor("#0F1A18"))
    c.setStrokeColor(EMERALD)
    c.setLineWidth(1.5)
    c.rect(60, 128, 840, 150, stroke=1, fill=0)
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(84, 250, "THE OPENING")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 12.5)
    c.drawString(84, 224, "Custody used to sit in the middle of this flow -- and the custodian, or the ops person holding the keys, was the de facto audit log.")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 12.5)
    c.drawString(84, 204, "We removed that operator. Nothing replaced it.")
    c.setFillColor(DIM)
    c.setFont("Helvetica", 11)
    c.drawString(84, 178, "Whoever builds the durable record of what was authorized and what settled is filling a gap that did not exist five years ago.")
    c.showPage()


def slide_solution(c):
    page(c, "The product", "One record, from first offer to verified outcome")
    steps = [
        ("1", "Quote", "OneSwap returns a route and a deposit party."),
        ("2", "Approve", "A permission-scoped workflow persists who decided, when, under what rule."),
        ("3", "Sign", "The user signs one Canton transfer in their own wallet. No key touches our servers."),
        ("4", "Verify", "The backend checks the update_id against the Canton ledger before recording anything."),
        ("5", "Record", "The deal, the approval, and the verified settlement become one permanent history."),
    ]
    x = 60.0
    bw = 160.0
    gap = 12.0
    for i, (num, head, body) in enumerate(steps):
        bx = x + i * (bw + gap)
        panel(c, bx, 236, bw, 168)
        c.setFillColor(EMERALD)
        c.setFont("Helvetica-Bold", 26)
        c.drawString(bx + 18, 368, num)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(bx + 18, 332, head)
        c.setFillColor(STEEL)
        c.setFont("Helvetica", 9.6)
        yy = 310
        for ln in wrap(body, "Helvetica", 9.6, bw - 32):
            c.drawString(bx + 18, yy, ln)
            yy -= 14
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(60, 186, "The distinction that matters")
    bullets(c, [
        ("A confirmation is evidence, not testimony. ", "We do not record that a transfer happened because someone said so. We check the ledger, and only then does the settlement exist in the record."),
        ("Advisory output never commits state. ", "AI analysis and route optimization inform decisions. A model response is not an approval -- the authority boundary is explicit in the data model."),
        ("Retries cannot double-execute. ", "Idempotency keys, payload fingerprints, and database constraints guard every write."),
    ], 60, 158, size=11.5)
    c.showPage()


def slide_why_canton(c):
    page(c, "Why Canton", "Only a privacy ledger closes this")
    half = 400.0
    panel(c, 60, 300, half, 156)
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(84, 430, "WHAT CANTON MAKES POSSIBLE")
    bullets(c, [
        "Selective disclosure: a counterparty verifies a settled trade without the ledger exposing the firm's other positions.",
        "A multi-party model that maps directly onto multi-party approval chains -- the parties are addressable parties.",
        "Settlement and its verification on the same ledger the trade was recorded against, so a confirmation can be checked rather than trusted.",
    ], 84, 404, width=352, size=10.5)
    panel(c, 500, 300, 400, 156)
    c.setFillColor(AMBER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(524, 430, "WHY NOT A PUBLIC CHAIN")
    bullets(c, [
        "A public chain publishes the transaction graph, so privacy-preserving settlement is off the table by construction.",
        "That is the precondition for this whole category, not a nice-to-have.",
    ], 524, 404, width=352, size=10.5, color=STEEL)
    panel(c, 60, 108, 840, 160, HexColor("#12100C"))
    c.setFillColor(AMBER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(84, 242, "WHY NOT A PLAIN DATABASE")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 11.5)
    c.drawString(84, 220, "A database can store a workflow, but it cannot be the settlement layer. It cannot be the thing both parties independently verify.")
    c.drawString(84, 204, "which is exactly what turns a confirmation into evidence rather than a claim.")
    c.drawString(84, 180, "The value lives in the seam between the workflow record and the ledger. Only a privacy ledger that also supports")
    c.drawString(84, 164, "institutional DeFi closes that seam.")
    c.setFillColor(DIM)
    c.setFont("Helvetica-Oblique", 9.5)
    c.drawString(84, 132, "What we do not claim yet: live Canton settlement is unverified against real infrastructure, and the OneSwap API is not yet configured.")
    c.showPage()


def slide_value(c):
    page(c, "Value", "From days of ritual to one verified confirmation")
    rows = [
        ("Today", "Email an approval, copy the thread, fund a wallet, wait for someone to confirm it arrived.", "Days per settlement. Manual handoff at every step. Audit evidence assembled by hand."),
        ("Aegis", "Approve in a permission-scoped workflow, sign one transfer, and let the system verify the on-ledger result.", "One signed transfer plus a verified confirmation, recorded permanently against the deal."),
    ]
    y = 404.0
    for label, act, cost in rows:
        panel(c, 60, y - 96, 840, 92)
        accent = DIM if label == "Today" else EMERALD
        c.setFillColor(accent)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(84, y - 26, label.upper())
        c.setFillColor(STEEL)
        c.setFont("Helvetica", 11)
        yy = y - 48
        for ln in wrap(act, "Helvetica", 11, 480):
            c.drawString(84, yy, ln)
            yy -= 15
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 11)
        yy = y - 48
        for ln in wrap(cost, "Helvetica", 11, 300):
            c.drawString(600, yy, ln)
            yy -= 15
        y -= 108
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 12.5)
    c.drawString(60, 176, "Why they would switch")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 11.5)
    c.drawString(60, 154, "The email thread is not only slower -- it is discoverable. Aegis produces exactly the evidence an auditor or counterparty asks for,")
    c.drawString(60, 138, "without anyone having to go find it. Today the audit trail is a side effect of work. Here it is the product.")
    note(c, "Add your own sourced number here: median time-to-settlement today, or hours per week ops spends assembling evidence.")
    c.showPage()


def slide_icp(c):
    page(c, "ICP", "Who has this problem, specifically")
    left = [
        ("Segment: ", "Treasury and settlement ops at asset managers, family offices, and corporate treasuries."),
        ("Size: ", "100-2,000 employees, or $100M-$5B AUM. Frequent settlements, no internal settlement engineering team."),
        ("User: ", "The treasury operations analyst who initiates settlements and chases confirmations."),
        ("Buyer: ", "The Head of Treasury or CFO who owns the audit exposure. A different person from the user."),
        ("Geography: ", "UAE, Singapore, Switzerland, UK, Hong Kong -- where tokenized settlement is permitted or being piloted."),
    ]
    bullets(c, left, 60, 400, width=400, size=11)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 12.5)
    c.drawString(520, 430, "What would stop them")
    bullets(c, [
        ("Trust. ", "'Do you hold my keys?' -- showing that we never hold one is the single most important thing to demonstrate."),
        ("Counterparty adoption. ", "The flow is multi-party. If the other side is not on it, the value collapses. Our hardest constraint."),
        ("Compliance. ", "Whether tokenized settlement is permitted at all. Non-negotiable."),
        ("Integration effort. ", "If it requires re-plumbing their treasury systems, it dies in procurement."),
    ], 520, 400, width=380, size=10.5)
    panel(c, 60, 96, 840, 116)
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(84, 186, "WHO IS NOT OUR CUSTOMER, FOR NOW")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 11)
    c.drawString(84, 162, "Retail users -- no multi-party approval and no audit requirement, so the entire value proposition is absent.")
    c.drawString(84, 144, "Crypto-native protocols and DAOs -- they have their own multisig and governance machinery.")
    c.drawString(84, 126, "High-frequency trading firms optimizing for microsecond latency -- this is an accountability system, not an execution engine.")
    c.showPage()


def slide_proof(c):
    page(c, "Proof", "It runs, and the tests are public")
    stats = [
        ("329", "backend tests, 28 files"),
        ("81", "Python service tests"),
        ("19", "frontend routes building clean"),
        ("0", "type or lint errors"),
    ]
    x = 60.0
    for val, lab in stats:
        panel(c, x, 300, 200, 110)
        c.setFillColor(EMERALD)
        c.setFont("Helvetica-Bold", 34)
        c.drawString(x + 20, 356, val)
        c.setFillColor(STEEL)
        c.setFont("Helvetica", 10.5)
        yy = 332
        for ln in wrap(lab, "Helvetica", 10.5, 165):
            c.drawString(x + 20, yy, ln)
            yy -= 14
        x += 216.0
    bullets(c, [
        ("The full flow is exercised, not mocked. ", "Register, verify, invite a counterparty, negotiate, approve, sign, verify on-ledger, settle -- in integration tests against a real Postgres."),
        ("The verification path is the differentiator. ", "Each settlement's update_id is resolved against the Canton ledger before it is recorded, so a confirmation is checked rather than asserted."),
        ("CI runs on every push. ", "Frontend lint, typecheck and build; backend tests, typecheck, lint and build against a dedicated Postgres; both Python suites."),
    ], 60, 268, size=11.5)
    panel(c, 60, 96, 840, 104, HexColor("#12100C"))
    c.setFillColor(AMBER)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(84, 172, "WHAT WE HAVE NOT PROVEN")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 10.8)
    c.drawString(84, 150, "We have proven the mechanism works. We have not proven institutional demand -- no user interviews, no pricing evidence, no live settlement.")
    c.drawString(84, 132, "The AI provider and OneSwap API are unconfigured; demo mode substitutes offline stand-ins. The orchestration and the record are the contribution;")
    c.drawString(84, 116, "the provider integrations are the roadmap.")
    c.showPage()


def slide_gtm(c):
    page(c, "Go to market", "Ecosystem-first, because the flow is multi-party")
    bullets(c, [
        ("Wallet integration is the shortest path. ", "Our flow already depends on Metatarz for signing. Being inside a wallet a treasury lead already installed beats any outbound sequence. First action: ship a deep link, then approach Metatarz about listing it."),
        ("Canton community and validators. ", "Where institutional technical evaluators gather, and they can reach a treasury lead faster than outbound. First action: demo at the next ecosystem event and apply for Featured App status."),
        ("Warm outreach through the ecosystem. ", "Canton's institutional pilots, OneSwap's counterparties, and Metatarz's treasury users are this persona already. First action: ask for a 30-minute working session on a real settlement, not a product demo."),
        ("Content that answers the custody question first. ", "Publish the verification path. First action: document what update_id verification means and why we never hold a key."),
    ], 60, 410, size=11)
    panel(c, 60, 78, 840, 148)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(84, 200, "First 90 days")
    steps = [
        ("Weeks 1-4", "One live settlement between two counterparties on Canton DevNet, verified on-ledger with no team intervention."),
        ("Weeks 5-8", "Three desks running live flows. At least one counterparty added by a customer, not by us."),
        ("Weeks 9-12", "Unassisted operation. Five of the first ten settlements verified without us. A documented answer on which channel converts."),
    ]
    yy = 172
    for lab, body in steps:
        c.setFillColor(EMERALD)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(84, yy, lab)
        c.setFillColor(STEEL)
        c.setFont("Helvetica", 10.5)
        for i, ln in enumerate(wrap(body, "Helvetica", 10.5, 690)):
            c.drawString(180, yy - i * 15, ln)
        yy -= 32
    c.showPage()


def slide_model(c):
    page(c, "Business model", "They pay for proof, not for speed")
    bullets(c, [
        ("Who pays: ", "the treasury or operations function at the institution -- the buyer is usually the Head of Treasury who owns the audit exposure, not the analyst using it."),
        ("What they buy: ", "the ability to prove settlement. This is an assurance product priced as one, not a seat license."),
        ("Pricing hypothesis: ", "per-seat for the workspace with settlement verification included, plus a platform fee above a settlement volume threshold. Untested -- and if value anchors on assurance rather than throughput, that pushes toward a higher enterprise price."),
        ("Revenue on Canton: ", "B2B SaaS is the primary and honest model. Featured App rewards and validator sponsorship are secondary and non-deterministic. Worth pursuing, never worth building a plan around."),
    ], 60, 400, size=11.5)
    panel(c, 60, 132, 840, 132, HexColor("#0F1A18"))
    c.setStrokeColor(EMERALD)
    c.setLineWidth(1.5)
    c.rect(60, 132, 840, 132, stroke=1, fill=0)
    c.setFillColor(EMERALD)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(84, 236, "THE RISK WE ARE NOT HEDGING")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(84, 210, "Counterparty adoption, not the technology, is what will kill this.")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 11)
    c.drawString(84, 186, "A settlement flow is only as valuable as the parties on both ends. That is a consortium problem, not a product problem, and it")
    c.drawString(84, 170, "is why the first customers must already talk to each other. Our plan starts inside existing ecosystem relationships for that reason.")
    note(c, "Every acquisition and demand hypothesis in our GTM is currently untested. We label them as such rather than implying traction we do not have.", y=96)
    c.showPage()


def slide_ask(c):
    page(c, "The ask", "What we need to prove it")
    items = [
        ("Intros to treasury leads running live Canton pilots.", "The single highest-value thing anyone could hand us. Our ICP is narrow and warm, not cold outbound."),
        ("A Metatarz integration conversation and Featured App guidance.", "Distribution inside a wallet treasury teams already trust."),
        ("Ecosystem grant funding.", "For the settlement-verification work, with distribution attached."),
        ("Technical review from someone who has settled on Canton.", "Whitelisting and party mapping are unverified against live infrastructure."),
    ]
    bullets(c, items, 60, 410, size=11.5)
    panel(c, 60, 150, 840, 132)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(84, 250, "Proof, not promises.")
    c.setFillColor(STEEL)
    c.setFont("Helvetica", 12)
    c.drawString(84, 222, "Canton gave institutional settlement a privacy ledger. Non-custodial signing took the custodian out of the flow --")
    c.drawString(84, 204, "and took the de facto audit log with it. Aegis is the record that replaces it.")
    c.setFillColor(EMERALD)
    c.setFont("Helvetica", 11)
    c.drawString(84, 176, "github.com/opeblow/AEGIS")
    c.showPage()


def build():
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    c = canvas.Canvas(OUT, pagesize=(W, H))
    _state["c"] = c
    c.setTitle("Aegis -- Institutional settlement accountability on Canton")
    c.setAuthor("Mobolaji Opeyemi Bolatito")
    cover(c)
    slide_problem(c)
    slide_whynow(c)
    slide_solution(c)
    slide_why_canton(c)
    slide_value(c)
    slide_icp(c)
    slide_proof(c)
    slide_gtm(c)
    slide_model(c)
    slide_ask(c)
    c.save()
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    build()
