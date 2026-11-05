# Design prompt — Login, Home, Calendar

Paste the PRODUCT BRIEF plus ONE screen block per run. Generate one screen at a time; keep the same style across runs.

---

## PRODUCT BRIEF (paste every time)

Design a web app for a B2B SaaS product that helps small businesses and marketing agencies run their social media.

WHAT THE PRODUCT DOES
A team signs up and gets a workspace. Inside it they set up one or more brands (a small business has one brand; an agency has one per client, each with its own name, logo, industry, audience and tone of voice). For each brand they write posts, attach photos or a video, choose which social accounts the post goes to (Facebook pages, Instagram business accounts, LinkedIn pages), send the post for approval, and once approved either schedule it for a date and time or publish it right away. The system publishes in the background and reports exactly what happened for each account.

WHAT MAKES IT DIFFERENT
1. Approval you can prove. A post can only be published after someone with the right role approves it. The approval is tied to the exact words and photo; if anything changes afterwards, the post goes back for approval. The app can show who approved what and when, and give a certificate for it. Agencies use this to protect themselves with clients.
2. It never fails silently. Social platforms make you reconnect every 60 days or so, and posts can fail for many reasons. The app warns you days before a connection expires, tells you in plain words when a post did not go out and why, lets you retry safely, and never posts the same thing twice.
3. Smart Templates. Ready-made caption templates by industry (restaurant, fitness, salon, e-commerce, real estate, software) with blanks to fill in, so a non-writer can produce a good post in a minute.

WHO USES IT
Business owners, agency staff and their approvers in India. Not designers, not engineers. Mixed English comfort; many on budget laptops and phones. They open the app a few times a day for a few minutes: check what needs them, write or approve something, leave.

THINGS THE APP KNOWS ABOUT (use in every screen)
- Post statuses: draft → waiting for approval → approved → scheduled → publishing → published (or partly published, or didn't publish).
- Roles: owner, admin (can approve and connect accounts), member (can write and submit).
- Each connected account has a health: working, needs a refresh soon (days left), expired, or disconnected.
- A brand filter: the user can look at all brands or one brand at a time.

DESIGN GOALS
- Calm and trustworthy, not flashy. This handles customers' brand reputations.
- The one thing the user should do next must be the most obvious element on each screen.
- Plain language in the interface (e.g. "Didn't publish", "Needs a refresh in 6 days", "Who approved this?"); no technical terms like token, job, OAuth.
- Status must be readable at a glance: things that need action look different from things that are fine. Never use alarm colours for a zero count.
- Must work well on a phone as well as a desktop. Provide a light and a dark version. Show empty, loading and error states where relevant.
- Use the sample data below; no lorem ipsum; no stock photos; no invented impressive numbers. Product name is a placeholder: [PRODUCT NAME].

SAMPLE DATA
- Workspace "Demo Agency", user "Demo User" (owner). Brands: Aura Coffee (restaurant), FitZone Gym (fitness).
- Accounts: Facebook · Aura Coffee (Page), 52 days left; Instagram · @auracoffee, 6 days left (needs a refresh soon); LinkedIn · FitZone Gym, test account.
- Posts: "Barista workshop" (scheduled Sat 7 Nov 10:00), "Monsoon menu teaser" (scheduled Fri 6 Nov 10:00), "Weekend brunch" (waiting for approval), "Loyalty card launch" (approved, not scheduled yet), "New opening hours" (published 1 Nov), "New year, new routine" (published 26 Oct, FitZone Gym), "Yoga timings update" (didn't publish on 3 Nov: "Facebook said the connection had expired").

Deliver each screen at desktop and phone width, light and dark, with notes on components and spacing.

---

## SCREEN 1 — Sign in

Goal: a returning user signs in within seconds; a first-time visitor understands what the product is and can create a workspace.

Must include:
- Product name/mark and a one-line description of what the product does, written for a business owner.
- The two differentiators ("approval you can prove", "never fails silently") stated briefly, as reassurance, not as marketing noise.
- Sign-in form: email, password (with show/hide), primary "Sign in" action, link to create a free workspace.
- A short trust note that social account credentials are stored encrypted and never shown in the browser.
- States: inline error for wrong email/password; loading state on the button; disabled button until both fields are filled.
- No social login, no "remember me", no password reset link yet (not built).
- Phone: form reaches the user without scrolling past marketing.

---

## SCREEN 2 — Home

Goal: answer "what needs me today?" in five seconds and make the next action one click away. This is the screen people see most.

Must include:
1. Greeting with today's date and a one-sentence summary of the situation (e.g. "1 post didn't publish · 1 waiting for approval · 2 going out this week."). Primary action: start a new post. Secondary: browse templates.
2. Key numbers, each opening the matching filtered list: waiting for approval, scheduled, published this month, didn't publish. Zero must look neutral.
3. "Needs your attention": a prioritised list — posts that didn't publish first (with "Try again"), then posts waiting for approval ("Review"), then approved posts not yet scheduled ("Schedule"). Each row: thumbnail or brand initials, title, brand, one line of the caption, status, one action. An "all caught up" empty state.
4. "Coming up": what goes out in the next 7 days, by day and time, with brand. Link to the calendar.
5. Connected accounts health: each account with how many days until it needs a refresh, visibly different when it is 7 days or fewer, and a way to manage accounts.
6. A small activity view: posts published per day over the last two weeks, plus simple 30-day totals (written, published, photos uploaded).
7. Your brands: one card per brand with counts (scheduled, in progress) and a shortcut to start a post for that brand.
8. Ideas: three or four Smart Templates relevant to the selected brand's industry, each opening the editor.
9. Recently published: the last few published posts with thumbnail, brand, date and a link to view the live post.
10. A first-run variant for a new workspace: a getting-started checklist (add a brand → connect an account → write a post → get it approved) that replaces the attention list until done.

The brand filter in the navigation changes every number and list on this screen.

---

## SCREEN 3 — Calendar

Goal: see what goes out when, spot empty days, and reach any post in one click.

Must include:
1. Month view, Monday-first, with previous/next/today controls and a clear "today" marker. Each day shows its posts as compact items with time and title, visually distinguished by status: scheduled, published, didn't publish. Handle overflow ("+2 more").
2. A legend for the status colours.
3. Clicking or hovering a post shows a quick summary: title, brand, which accounts, status, and an "Open post" action.
4. A side panel "Not on the calendar yet": drafts, posts waiting for approval, and approved posts without a date, each with its status, so the user can see work that still needs a time slot. A "Create a post" action.
5. A short note that times are shown in the user's time zone and that posts go out from the server, so the user's computer can be off.
6. Phone: either a horizontally scrollable month inside its container or a list-by-day view; do not shrink the grid until it is unreadable.
7. Empty state for a month with nothing in it.
The brand filter in the navigation applies here too.
