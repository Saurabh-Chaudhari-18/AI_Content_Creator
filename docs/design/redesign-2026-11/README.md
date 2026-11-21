# UI redesign — November 2026

The client asked for a full redesign because the app felt hard to use. These are the design explorations, saved from the design canvas.

- **Live canvas (clickable, private until shared):** https://claude.ai/artifact/JPzUw5pPRpiWXJD4KAXRJr
- **Files here:** one `.dc.html` per screen plus `canvas.json` (the canvas layout). They are design sources for the canvas, not app code; open the canvas link to view them.
- **Status:** nothing is approved by the client yet. All names, posts and numbers are demo data; photos are coloured stand-ins.

## Royal colour themes

Every Round 3 and Round 4 screen has a **Theme** setting (select the screen on the canvas → Tweaks). The layout never changes, only the colours. Colours live as CSS variables (`--bg`, `--panel`, `--ac`, …) in each file's `<style>`; the values for all six themes are in `tools/themeify.py`, which is also the script that converted the screens.

| Theme | Look |
|---|---|
| `espresso` | Original Round 3: espresso brown with orange |
| `obsidian` | **Our app today, dark**: obsidian with indigo (values from `.dark` in `frontend/src/index.css`) |
| `daylight` | **Our app today, light**: soft grey with indigo (values from `:root` in `frontend/src/index.css`) |
| `amethyst` | Royal Amethyst: deep purple with gold |
| `sapphire` | Sapphire Night: midnight navy with ice blue |
| `emerald` | Emerald Crown: forest green with champagne gold |
| `burgundy` | Burgundy Velvet: wine red with rose gold |
| `ivory` | Ivory & Navy: light theme, royal navy with gold labels |

The "Royal colour themes" canvas page shows Home and Approval Studio in each theme, with our app's own two themes in the top rows (`Th*.dc.html` files, which just load the Round 3 screen with a theme).

## Round 4 — Easier options (ease of use first, Round 3 look)

| File | Screen | Idea |
|---|---|---|
| `R4TodayHome.dc.html` | Option 1 · Today list — Home | No sidebar. Today's to-do list, one button per item, progress bar. |
| `R4TodayApprove.dc.html` | Option 1 · Approve one at a time | Focus screen, two big buttons, "All done" at the end (clickable). |
| `R4Board.dc.html` | Option 2 · Posts board | Drafts → Waiting for OK → Scheduled → Posted columns; click a card to open it (clickable). |
| `R4TilesHome.dc.html` | Option 3 · Big buttons — Home | Four big buttons plus a plain-English "What happens next" list. |
| `R4TilesPhone.dc.html` | Option 3 · Big buttons — Phone | Same layout at 390 px. |

## Round 3 — The user's reference style (liked)

Warm espresso-dark, orange accent, Playfair Display headings, Plus Jakarta Sans body. Pages share `R3Sidebar.dc.html` and link to each other.

`R3Home`, `R3Review` (Approval Studio), `R3Posts`, `R3Calendar`, `R3Accounts`, `R3Compose` (New Post), `R3Sidebar`.

## Round 2 — Polished, owner's obsidian + indigo palette

`Home`, `HomeFirstDay`, `HomePhone`, `Review`, `Plan` (Calendar).

## Round 1 — Layout options (neutral, structure only)

`Main` (Spotlight review), `Inbox` (three panes), `Calendar` (calendar first), `Composer` (new post drawer).

## Rules every round follows

- One clear main action per screen; buttons and rows at least 44 px tall.
- A post only offers its own brand's social accounts.
- Broken accounts always come with a Reconnect button where the problem shows.
- Plain words, no engineering terms; times shown in India time (IST).
- No made-up metrics (reach, health score, sync lag) — the app doesn't measure them.
