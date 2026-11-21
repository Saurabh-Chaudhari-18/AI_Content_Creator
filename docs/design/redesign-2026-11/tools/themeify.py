"""Convert Round 3/4 design files from hard-coded colours to theme tokens.

Usage: python -I themeify.py <project_dir>
"""
import re
import sys
from pathlib import Path

TOKENS = "bg side sunk panel panel2 panel3 line bd1 bd2 bd3 bd4 tx tx2 mut sub ac ac-tx ac-lab ac-pill ac-hi ac-soft g1 g2 rim on-ac inv-bg ok ok-tx bad bad2 bad-dk bad-tx info info2 on-inv".split()

THEMES = {
    "espresso": "#120D0A #17110D #1A130F #1D1511 #221913 #2A1F18 #2C2119 #33261D #3A2B21 #4A3727 #5A4433 #F4EADF #D9CBBB #BFAE9B #9C8A77 #EE8F35 #F5A65B #F0A04F #F5B371 #FBC48C #F5C89A #F6A24A #E2802A #B8601E #1F1208 #F4EADF #8BD3A0 #A8E0B8 #F3A08F #DC5A3C #9E3E2A #F3C3B8 #B5C9EE #9DB8E8 #1F1208",
    # The app's own themes, values from frontend/src/index.css (.dark and :root).
    "obsidian": "#0B0F17 #111722 #0E131D #151D2A #1B2536 #212E44 #1C2537 #232E42 #27334A #2B3850 #3A4864 #E8ECF4 #C3CBDA #A3AEC2 #8B97AD #6366F1 #A5B4FC #818CF8 #C7D2FE #E0E7FF #C7D2FE #6366F1 #4F46E5 #3730A3 #FFFFFF #E8ECF4 #34D399 #6EE7B7 #F87171 #E5484D #9B2C2F #FCA5A5 #93C5FD #60A5FA #0B0F17",
    "daylight": "#F5F7FA #FFFFFF #EEF1F6 #FFFFFF #F6F8FB #EEF1F6 #E9EDF3 #E3E7EE #DCE1EA #D5DBE5 #B8C1CF #111827 #374151 #4B5565 #6B7280 #4F46E5 #4338CA #4F46E5 #3730A3 #312E81 #3730A3 #5B54EA #4338CA #4F46E5 #FFFFFF #111827 #059669 #047857 #DC2626 #DC2626 #991B1B #991B1B #1D4ED8 #3B82F6 #FFFFFF",
    "amethyst": "#110C1A #150F21 #181125 #1C1429 #231933 #2C2040 #2A1F3A #31253F #392B4A #4A3860 #5C4878 #F3EEFA #D6CCE6 #B6A9CB #8E7FA6 #D9A93E #E8C46A #E2B550 #EBCB7E #F3D995 #E9D29A #EDC66A #C9962E #8A6418 #1E1405 #F3EEFA #8BD3A0 #A8E0B8 #F3A0A8 #D9506A #8E2A44 #F6C2CC #BFC8F2 #A0AEEA #1E1405",
    "sapphire": "#0A0F1E #0D1427 #0F172C #121B32 #17223D #1D2A4A #1C2843 #22304F #293A5E #364B76 #465E8E #EEF3FC #CAD5EC #A6B4D2 #7C8CB0 #6FA3FF #8DB6FF #7FAEFF #A3C4FF #C2D8FF #B8CFFF #9CC3FF #5E95F2 #2F5FC4 #08132E #EEF3FC #7FD8A8 #A3E6C1 #F5A3A3 #E05A5A #9A2F3A #F8C6C6 #C9B8F5 #B09AF0 #08132E",
    "emerald": "#08130F #0B1813 #0D1B16 #10201A #152821 #1B3229 #1A2B24 #20352C #273F35 #335244 #426654 #EEF6F1 #CBDDD3 #A6BFB2 #7C978A #D8B970 #E3C987 #DDBF77 #E8D39C #F0E0B5 #E6D5A6 #ECD493 #C8A552 #8A6E2A #1A1405 #EEF6F1 #8FD9B0 #AEE6C6 #F3A08F #D9553C #9A3A28 #F6C4B8 #B7CAF0 #98B2EA #1A1405",
    "burgundy": "#14080C #1A0B10 #1D0D13 #221016 #2A151C #331A23 #2E1820 #381E28 #422431 #573042 #6C3E54 #F8EDEF #E2CDD2 #C6A9B1 #9C7F88 #E8A07E #F0B497 #EBA585 #F3C0A6 #F8D3BF #F2C9B4 #F2B595 #D3845F #8E4A30 #24100A #F8EDEF #8BD3A0 #A8E0B8 #FF9FA8 #E0405A #9C2338 #FFC7CD #B9C6F0 #9DAEEA #24100A",
    "ivory": "#F6F1E7 #EFE7D8 #F3ECDF #FFFDF8 #FAF5EA #F1E8D6 #E4D9C4 #E0D3BB #D6C7AB #C2AF8C #A8936C #1B2340 #33405F #4E5B78 #6D7891 #1F3A8A #1F3A8A #7A5A12 #7A5A12 #12286A #7A5A12 #2B4DAA #1A3079 #B8902F #FFFBF2 #1B2340 #2E8B57 #1F6B42 #C2412D #D9553C #9E3E2A #8E2A1C #2F5DB8 #3D6BC4 #FFFBF2",
}

HEX_TO_TOKEN = {
    "#120D0A": "bg", "#17110D": "side", "#1A130F": "sunk", "#1D1511": "panel",
    "#221913": "panel2", "#241A14": "panel2", "#2A1F18": "panel3", "#2C2119": "line",
    "#33261D": "bd1", "#3A2B21": "bd2", "#4A3727": "bd3", "#5A4433": "bd4",
    "#F4EADF": "tx", "#D9CBBB": "tx2", "#BFAE9B": "mut", "#9C8A77": "sub",
    "#8F7D6A": "sub", "#6B5644": "sub", "#EE8F35": "ac", "#F5A65B": "ac-tx",
    "#F0A04F": "ac-lab", "#F5B371": "ac-pill", "#FBC48C": "ac-hi", "#F5C89A": "ac-soft",
    "#F6A24A": "g1", "#E2802A": "g2", "#B8601E": "rim", "#1F1208": "on-ac",
    "#0F2416": "on-ac", "#8BD3A0": "ok", "#A8E0B8": "ok-tx", "#F3A08F": "bad",
    "#9E3E2A": "bad-dk", "#F3C3B8": "bad-tx", "#B5C9EE": "info", "#9DB8E8": "info2",
}

RGBA_TO_TOKEN = {
    (238, 143, 53): "ac", (240, 160, 79): "ac-lab", (243, 160, 143): "bad",
    (220, 90, 60): "bad2", (139, 211, 160): "ok", (157, 184, 232): "info2",
    (18, 13, 10): "panel", (31, 18, 8): "on-ac",
}

ESPRESSO = dict(zip(TOKENS, THEMES["espresso"].split()))


def theme_css() -> str:
    lines = []
    for name, values in THEMES.items():
        decl = ";".join(f"--{t}:{v}" for t, v in zip(TOKENS, values.split()))
        sel = ".th" if name == "espresso" else f'.th[data-theme="{name}"]'
        lines.append(f"{sel}{{{decl}}}")
    return "\n".join(lines)


def var(token: str, fallback: bool) -> str:
    return f"var(--{token}, {ESPRESSO[token]})" if fallback else f"var(--{token})"


def convert(text: str, fallback: bool) -> str:
    text = re.sub(r"background: #F4EADF", "background: " + var("inv-bg", fallback), text, flags=re.I)

    def rgba(m):
        key = (int(m[1]), int(m[2]), int(m[3]))
        token = RGBA_TO_TOKEN.get(key)
        if not token:
            return m[0]
        pct = round(float(m[4]) * 100)
        return f"color-mix(in srgb, {var(token, fallback)} {pct}%, transparent)"

    text = re.sub(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)", rgba, text)

    def hexsub(m):
        token = HEX_TO_TOKEN.get(m[0].upper())
        return var(token, fallback) if token else m[0]

    return re.sub(r"#[0-9A-Fa-f]{6}\b", hexsub, text)


THEME_OPTIONS = '["espresso","obsidian","daylight","amethyst","sapphire","emerald","burgundy","ivory"]'
THEME_PROP = '"theme":{"editor":"enum","options":' + THEME_OPTIONS + ',"default":"espresso"},'
OLD_OPTIONS = '["espresso","amethyst","sapphire","emerald","burgundy","ivory"]'


def refresh(path: Path) -> None:
    """Bring an already-converted file up to the current theme list."""
    src = path.read_text(encoding="utf-8")
    if path.name != "R3Sidebar.dc.html":
        lines = src.split("\n")
        kept = [ln for ln in lines if not ln.startswith(".th")]
        at = kept.index("<style>") + 1
        kept[at:at] = theme_css().split("\n")
        src = "\n".join(kept)
        src = src.replace(OLD_OPTIONS, THEME_OPTIONS)
    # Light-background buttons need their own text colour now that some themes use white on the accent.
    src = src.replace("background: var(--inv-bg); color: var(--on-ac)", "background: var(--inv-bg); color: var(--on-inv)")
    src = src.replace("background: var(--ok); color: var(--on-ac)", "background: var(--ok); color: var(--on-inv)")
    path.write_text(src, encoding="utf-8")
    print("refreshed", path.name)


def process(path: Path) -> None:
    src = path.read_text(encoding="utf-8")
    is_sidebar = path.name == "R3Sidebar.dc.html"
    head, sep, rest = src.partition("</helmet>")
    if not sep:
        raise SystemExit(f"{path.name}: no </helmet>")
    if is_sidebar:
        out = head + sep + convert(rest, fallback=True)
    else:
        head = convert(head, fallback=False).replace("<style>", "<style>\n" + theme_css(), 1)
        body = convert(rest, fallback=False)
        body = re.sub(r"<div style=\"", '<div class="th" data-theme="{{theme}}" style="', body, count=1)
        body = body.replace("data-props='{", "data-props='{" + THEME_PROP, 1)
        script_at = body.index("data-dc-script")
        before, after = body[:script_at], body[script_at:]
        if "return {" not in after:
            raise SystemExit(f"{path.name}: no return in renderVals")
        after = after.replace("return {", "return { theme: this.props.theme ?? 'espresso',", 1)
        out = head + sep + before + after
    path.write_text(out, encoding="utf-8")
    print("converted", path.name)


if __name__ == "__main__":
    root = Path(sys.argv[1])
    action = refresh if "--refresh" in sys.argv[2:] else process
    for p in sorted(root.glob("R[34]*.dc.html")):
        action(p)
