# OmniPost — UI/UX Audit (deep pass)

**Date:** 2026-11-19 · **Scope:** the customer app in `frontend/src` (pages, layouts, components, styles, routing). The `/admin` staff console is out of scope: its users are platform staff, not the café/gym/agency persona.

**Lens:** a café owner, a gym manager, or an agency account manager. Not technical, often on a 13" laptop or a tablet, doing this between other jobs, and wanting to finish a post and leave.

## How this audit was done

1. **Every frontend file was read**: all 10 pages, the Post Studio sub-components, the shell, the theme, the shared UI primitives and the data hooks (~7,000 lines).
2. **The app was run and clicked through** against the local stack (Vite dev server on the current commit, API + Postgres from the Docker project) as the seeded owner account in the "Demo Agency" workspace: 2 brands (FitZone Gym, Aura Coffee), 3 test social accounts, 15 posts.
3. **Three viewports were measured**: 1366×768 (common laptop), 768×1024 (tablet), 375×812 (phone). For each key screen I recorded fold position, page height, hit-target sizes, font sizes and live colour contrast with a script run in the page.
4. **Contrast ratios** come from the rendered page (computed styles), not only from the tokens.

**What this pass could not verify**
- Light mode across navigation: the theme is saved per account (`lib/auth.tsx:98-106`), so a local override reverted on the next page load. Light-mode numbers below come from the tokens in `index.css`.
- Real photo upload, the real Facebook connection, and a completed schedule: the demo workspace cannot schedule anything (see P0-1). The Calendar journey is therefore traced in code, not clicked end to end.

**Side effects of the walkthrough** (demo data only): the seeded post "Weekend yoga" was approved; a test draft was created and then deleted.

**Correction to the brief:** the app is not dark-only. Dark is the default (`lib/theme.tsx:18`); Light and "Match my device" exist but live inside the avatar menu (`app/AppShell.tsx:108-119`). Dark-by-default is the owner's design choice (`docs/design/post-studio.html`), so changing it is listed as a decision, not a defect.

---

## Executive Summary — the 5 things making the app feel least friendly

1. **The approve → schedule hand-off is broken in practice.** After "Approve", the header has **no next action**. The scheduling panel starts at 796 px on a 768 px-tall laptop screen and its "Schedule post" button is at 1,198 px: a full screen below the fold. On a tablet it is 2,270 px down a 3,444 px page. In the demo workspace every account then says "Needs a fix" ("Facebook publishing isn't included in your plan", "LinkedIn publishing is temporarily unavailable", "Instagram requires at least one image"), so the user has just approved a post they cannot send anywhere, with no link to fix any of it.

2. **Work is lost without warning and photos come too late.** Verified live: type a caption on a new post, click any sidebar link, come back: the caption is gone, no prompt. Photos cannot be added until the draft is saved ("Save the draft first, then add photos"), and that notice sits at 1,027 px, below the fold. After "Save draft" the whole editor blanks into skeletons for ~2 seconds before it comes back.

3. **An agency can send one client's post to another client's pages.** Accounts belong to the workspace, not to a brand. On the FitZone Gym post, all three accounts were pre-ticked, including "Instagram · auracoffee" and "Facebook · Aura Coffee (Page)". Nothing in the panel or the "Post it now?" dialog names the brand.

4. **The product talks like its engineers.** Live strings: `v1 · df48…c45`, `not sealed`, "approved and sealed", "Fingerprint", "SHA-256", `46d`, `written · 30d`, "Arrives in Phase 2", "Platform default", `3×`, and server field names in error toasts. The same role is "Manager" on one screen and "Admin" on the next.

5. **Dense, dim, and the same weight everywhere.** On Home, 24 of 39 clickable things are under 40 px tall; there is 10–11 px text; card borders measure 1.24:1 and input borders 1.63:1 against their background (field edges need 3:1). On a tablet, Home's tile titles collide ("Coming up" runs into "Calendar"). The sidebar is six unlabeled icons, and once a brand filter is on, nothing on any page says so.

---

## Journey audit (measured)

Clicks counted from Home with "All brands" selected and two brands set up. "Scroll" means the target was below the fold at 1366×768.

### Journey 1 — Create a post from scratch
| Step | What happens | Friction |
|---|---|---|
| 1. New post | "Which brand is this post for?" dialog | Fine, but each brand button shows the raw industry key ("fitness", "restaurant") |
| 2. Pick brand | Post Studio opens, 55/45 split, two separately scrolling columns | The **right half is a preview** of an empty post: 45% of the screen shows "Your caption will appear here" |
| 3. Type caption | "Unsaved changes" in 12 px grey appears in the header | No autosave; leaving the page loses the text (verified) |
| 4. **Save draft** (forced) | Editor disappears into skeletons for ~2 s, URL changes, "Draft saved." toast | A visible flash the user did not ask for |
| 5. Scroll to Photos | "Add photo" tile now active at ~1,027 px | Photos are usually the first thing a café owner has |
| 6. Add photo → choose file | Upload, refetch | Fine |
| 7. Send for approval | Reviewer picker (Managers / Any manager / Clients) | Picker lists **yourself** (Demo User · Owner) as a reviewer even though self-approval is off |
| 8. Send | Locked, "Waiting for approval" | OK |

**Today: 8 clicks + 1 forced save + 1 scroll.** If the user edits anything after saving, "Send for approval" greys out; its explanation (`title="Save your changes first"`) **never appears**, because the Button has `disabled:pointer-events-none` (verified: hovered 2 s, no tooltip).
**Target: 5 clicks.** Autosave, photos from the start, Send saves first.

### Journey 1b — Create from a Smart Template
- From the **Templates page** with "All brands" selected, "Use this template" opens Post Studio for whichever brand matches the template's industry, else the **first brand**, without asking (`TemplatesPage.tsx:40-47`). An agency can start a post under the wrong client.
- Inside Post Studio there are **two** template entry points (the "Smart Template" toolbar button and a "Start from a template" section at the bottom, which is below the fold).
- The fill dialog is good (live preview). After "Use this text" the user still has to Save draft, so the template path is **9 clicks**.

### Journey 2 — Review and approve
- From Home: "Review" → "Approve" = **2 clicks** (from the bell: 3). Good.
- On the pending post, the "Review — Assigned to Ramesh Patel" panel starts at **772 px** (below the 768 px fold) and the Approval record at 1,120 px. The approver cannot see who it is assigned to, or the client links, without scrolling the right column.
- The manager can approve while the Instagram channel says **"Needs a photo"**; nothing warns that the approved version cannot go to Instagram.
- After approval the toast says "Approved and sealed. It's ready to schedule." — with **no button**, and the header goes from three actions to none.
- Three client links stayed live after approval (Opened / Not opened · "expires in 7 days" · Revoke), which reads as if something is still waiting.

### Journey 3 — Schedule an approved post
| Step | What happens |
|---|---|
| 1. Open the post | Header: status pill and bin icon only |
| 2. Scroll the right column past the preview | Publish panel at 796 px; "Schedule post" at 1,198 px (laptop), 2,270 px (tablet) |
| 3. Accounts | All 3 pre-ticked, two belong to the other brand; all 3 "Needs a fix" |
| 4. Date/time | Browser `datetime-local`, default tomorrow 10:00 |
| 5. Schedule post | Disabled until every ticked account passes |

**Today: 4+ clicks and a long scroll, and in the demo workspace a dead end.** The Calendar cannot schedule: day cells have no click handler (verified: 0 of 42 cells), and "Not on the calendar yet" only links to the post.
**Target: 3 clicks from the Calendar** (click a day → pick an approved post → confirm) or 2 from the post (Approve → "Schedule now").

---

## Prioritized Issues

Severity: **P0** = users lose work, post to the wrong place, or reach a dead end · **P1** = high-impact usability and clarity · **P2** = visual polish, accessibility and responsiveness.

### P0 — Critical UX friction

| # | Screen / Component · file | Problem (client's view) · evidence | Recommended fix |
|---|---|---|---|
| P0-1 | Publish panel · `pages/posts/PublishPanel.tsx:40-50, 84-93, 123-137, 191-193` | **Dead end after approval.** "I approved it and now every account says Needs a fix." Seen live: "Facebook publishing isn't included in your plan." / "LinkedIn publishing is temporarily unavailable." / "Instagram requires at least one image." None has a link or a next step, and the same accounts show **"Working"** on the Accounts page. | Make every check result actionable: plan limits → "Not in your plan · **See plans**"; temporary outage → "LinkedIn is paused on our side · **Status**"; missing image → "**Add a photo**" scrolls to the media section. Show the same health on the Accounts page so "Working" is never contradicted. Explain plan gating **before** approval (on the channel cards), not after. |
| P0-2 | Publish panel defaults · `PublishPanel.tsx:40-42, 167-176` | **Wrong client's page.** FitZone Gym post opened with Instagram · auracoffee, Facebook · Aura Coffee (Page) and LinkedIn · FitZone Gym all ticked. The "Post it now?" dialog lists accounts but not the brand. | Short term: nothing pre-ticked, or only the accounts last used for this brand; group accounts under a brand-coloured heading; "Post it now?" says "**FitZone Gym** → …". Proper fix (backend): link each social account to a brand and show only that brand's accounts. |
| P0-3 | Approve → schedule hand-off · `pages/posts/ApprovalPanel.tsx:216-223`; `pages/posts/PostStudioPage.tsx:395-424, 693` | After Approve the header has no primary action; the "Where should it go?" panel is at 796 px (laptop) / 2,270 px (tablet). | After approval: scroll to and highlight the publish panel, and give the toast a **Schedule now** action. Better: when status is `approved`, render the publish panel **above** the preview and put a **Schedule** button in the header. Consider "Approve & schedule" for managers. |
| P0-4 | Unsaved changes · `PostStudioPage.tsx:161, 392` | Verified: typed caption → clicked Posts → no prompt → Back → empty. No `useBlocker`/`beforeunload` anywhere in the app. | Autosave drafts (debounced ~1.5 s) while status is `draft`. For approved/scheduled posts keep explicit save but add a `useBlocker` + `beforeunload` "Leave without saving?" dialog. |
| P0-5 | Photos blocked on new posts · `PostStudioPage.tsx:811-812` | "Save the draft first, then add photos." at 1,027 px, below the fold. Photos are usually the first thing a café owner has ready. | Create the draft silently on the first upload (or first keystroke with autosave), then upload. Move Photos above Hashtags/Button text. |
| P0-6 | "Send for approval" disabled with a hidden reason · `PostStudioPage.tsx:406-415`; `components/ui/button.tsx:7` | Disabled button carries `title="Save your changes first"` but `disabled:pointer-events-none` means the tooltip never shows (verified). Users see a grey button and no reason. | Keep the button enabled: clicking it saves first, then opens the reviewer picker; if the caption is empty, show an inline error under the caption ("Write a caption first") and focus it. |
| P0-7 | Save → page blanks · `PostStudioPage.tsx:212-220, 313-321` | After "Save draft" the app navigates to `/posts/:id`; `post.isLoading` renders full-page skeletons for ~2 s, so the editor the user was just in vanishes and reappears. | Seed the query cache with the created post (`qc.setQueryData(keys.post(p.id), p)`) before `navigate`, so the editor stays on screen. |
| P0-8 | Calendar cannot schedule · `pages/CalendarPage.tsx:159-201, 210-230` | 0 of 42 day cells are interactive. "Not on the calendar yet" lists drafts and pending posts too, each only a link to the post. | Click an empty day → "Schedule an approved post here" (list approved posts, default 10:00, confirm) or "New post for this day". Add a **Schedule** button to approved items in the side list; hide drafts/pending from it or label them "needs approval first". Drag-and-drop later. |
| P0-9 | Template → wrong brand · `pages/TemplatesPage.tsx:40-47` | With "All brands", "Use this template" guesses the brand silently. | Reuse the "Which brand is this post for?" dialog from `NewPostButton` (`PostsPage.tsx:44-64`) whenever the brand is not certain; show the chosen brand in the fill dialog title. |
| P0-10 | "Pick a brand first" dead end · `PostStudioPage.tsx:333-343` | Tells phone users to use "the brand button in the left rail", which does not exist on phones; no button in the box. | Render the brand list as buttons right there. |
| P0-11 | Images with no fallback (13 `<img>`, 0 `onError`) · `HomePage.tsx:280, 386, 442`; `PostsPage.tsx:148`; `PostStudioPage.tsx:680, 821`; `parts.tsx:198, 250`; `BrandsPage.tsx:95, 272`; `ClientApprovalPage.tsx:233, 343`; `Seal.tsx:130` | Seen live: a media file returned 404 and Home showed a broken-image icon. The same would happen in the preview and on the **client's approval page**. | One `<SafeImage>` component: brand-initials tile fallback in lists; a soft "Photo couldn't load · Retry" box in the preview and client page. |

### P1 — High-impact usability & clarity

**Navigation and information architecture**

| # | Screen · file | Problem · evidence | Fix |
|---|---|---|---|
| P1-1 | Desktop rail · `app/AppShell.tsx:225-241` | Six icon-only items, tooltips on hover only; nothing on a touch tablet. | Rail with icons **and** 11 px labels (like the phone bar), or a collapsible 200 px sidebar. |
| P1-2 | Brand switcher · `AppShell.tsx:137-178` | A tile that shows a grid icon or initials; no label, no tooltip. It is the agency's main control. | "Showing: **FitZone Gym** ▾" as a labelled control; tooltip when collapsed. |
| P1-3 | Brand filter invisible on pages · `PostsPage.tsx:90`, `CalendarPage.tsx:88`, `HomePage.tsx` | Verified: with FitZone selected, Posts dropped from 15 to 6 rows and the only change on the page is the rail tile reading "FG". | A chip under each page title: "Only **FitZone Gym** · Show all brands". |
| P1-4 | Bell, avatar, workspace mark · `AppShell.tsx:181-215, 236-239`; `NotificationBell.tsx:45-58` | No tooltips (unlike nav links). The notification list opens from the bottom-left and covers the page. Appearance and Sign out are hidden behind initials. | Tooltips on all three. Put Appearance in Settings too. Open the notification list as a right-side panel or top-anchored popover. |
| P1-5 | Posts page · `pages/posts/PostsPage.tsx:15-23, 95-119` | No search (verified), no "Assigned to me", no "Partly published" filter even though Home links to it, no counts on tabs. 10 of 15 rows had a blank grey thumbnail square. | Search by title/caption; "Assigned to me" tab; counts on tabs; fold "partly published" into "Didn't publish"; text-post tile instead of a blank square. |
| P1-6 | Delete post in the header · `PostStudioPage.tsx:419-423` | 36 px icon-only bin next to the primary actions; after approval it is the **only** header button. | Move into a "⋯ More" menu with a labelled "Delete post". |
| P1-7 | Reviewer picker · `pages/posts/ReviewerDialogs.tsx:119-176` | Lists the signed-in user as a reviewer (seen: "Demo User · Owner") even when self-approval is off; "No client contacts saved yet. Add them on the Brands page." has no link. | Hide or disable yourself with "(you — someone else must approve)"; make "Add them on the Brands page" a link that returns here. |
| P1-8 | Review panel on pending posts · `ReviewerDialogs.tsx:504-581` | Assignee and client links live below the fold (772 px). Links remain listed with Revoke after approval. | Show "Waiting for **Ramesh Patel** · Change" in the header status area. After a decision, collapse links into "3 links · all closed". |
| P1-9 | Home brand row arrow · `HomePage.tsx:396-398` | Unlabeled "→" button (36×32 px). | Label it "New post", or make the whole card the link. |
| P1-10 | Notifications · `NotificationBell.tsx:36-40, 74-95` | "…link expired before they responded. **Resend it?**" asks a question but only opens the post. Loading is plain "Loading…"; a failed load shows as "Nothing yet". | Give notifications an action ("Resend link"). Skeleton rows while loading; error with Retry. |

**Microcopy and jargon** (current → replacement)

| # | Where · file | Current | Replacement |
|---|---|---|---|
| P1-11 | Post Studio header chip · `PostStudioPage.tsx:372-387` | `v1 · df48…c45` / `not sealed`, monospace, with a tooltip about fingerprints | Remove from the header. "Version 1 · Not approved yet" / "Version 2 · Approved ✓". Keep codes on the certificate only. |
| P1-12 | Banners, toasts, record · `PostStudioPage.tsx:456`, `ApprovalPanel.tsx:131, 219` | "approved and sealed", "with the seal of what was reviewed", "Approved and sealed. It's ready to schedule." | "This version is approved and locked." / "Every step is saved, so you can always see who approved what." / "Approved! **Schedule it** or post now." |
| P1-13 | Certificate, receipt, seal · `Seal.tsx:32-33, 145-153`, `ClientApprovalPage.tsx:143` | "Fingerprint", "SHA-256 of the caption…", ring text "APPROVED · V2 · DF48…C45 · OMNIPOST" | "Approval code" + "This code changes if a single word or photo changes. We check it again right before posting." |
| P1-14 | Not-yet features · `PostStudioPage.tsx:540-549`; `SettingsPage.tsx:166, 227` | "Rewrite with AI" (disabled) + "Arrives in Phase 2"; "AI writing arrives in the next phase"; "Removing people and changing roles comes next." | Hide until shipped. If kept: "Coming soon". Never "Phase 2". |
| P1-15 | Role names · `lib/format.ts:64` vs `SettingsPage.tsx:219, 227`, `AccountsPage.tsx:108`, `PostStudioPage.tsx:187` | "Manager" (badge) vs "Admin" (role picker, help text) vs "owner or admin" | **Manager** everywhere. |
| P1-16 | Home → Accounts tile · `HomePage.tsx:360` | `46d` / `OK` / `Expired` | "Reconnect in 46 days" / "Connected" / "Needs reconnecting" + a Reconnect link |
| P1-17 | Home → Activity · `HomePage.tsx:170, 200-208` | `written · 30d`, `published · 30d`, `photos · 30d`, `—` (11 px) | "Written (30 days)", "Published", "Photos added"; "0 published" instead of "—" |
| P1-18 | Server errors · `lib/api.ts:59-66` | `scheduled_at: Input should be a valid datetime` | Map field names to labels or say "Please check the highlighted field" and put the message under the field. |
| P1-19 | Validation labels · `PublishPanel.tsx:125` | "Check note" / "Needs a fix" | "Ready, with a tip" / "Can't post yet — see below" |
| P1-20 | Job statuses · `lib/format.ts:30-37` | "Waiting", "Check on the platform", "Sending…" | "Queued to post", "Not sure it posted — please check {Platform}", "Posting now…" |
| P1-21 | Accounts page · `AccountsPage.tsx:35, 138, 157` | "Working" (while publishing is plan-blocked), `Instagram · page`, "Needs a refresh in 46 days" on **test** accounts | "Ready to post" / "Can't post: not in your plan"; "Instagram Business"; hide the refresh countdown on test accounts. |
| P1-22 | Settings · `SettingsPage.tsx:140, 209` | "Platform default"; placeholder "They need an account first" | "Standard (3 days)" with the real value; "They'll need to sign up first — we add them once they do." Better: invite by email. |
| P1-23 | Template fill · `TemplateDialogs.tsx:84` | "2 blank(s) left — that's fine." | "2 blanks left. You can fill them in later." |
| P1-24 | Client link row · `ReviewerDialogs.tsx:482` | `3×` | "Opened 3 times" |
| P1-25 | Brand chooser · `PostsPage.tsx:59` | raw `fitness`, `restaurant` | `humanize()` them ("Fitness", "Restaurant") |
| P1-26 | Home count tiles · `HomePage.tsx:216-219` | lower-case labels under big numbers | Sentence case plus the action: "Waiting for approval → Review" |

**Empty, loading and error states**

| # | Screen · file | Problem | Fix |
|---|---|---|---|
| P1-27 | Shared `EmptyState` · `components/common.tsx:39-46` | Title + text only; no icon, no action slot, so no empty box in the app has a button. | Add `icon` and `action` props and use them everywhere below. |
| P1-28 | Posts empty · `PostsPage.tsx:129-135` | Text only; the same message on a filtered tab ("Didn't publish") reads wrong. | **New post** + **Browse templates** buttons; per-filter copy ("Nothing failed. Nice!"). |
| P1-29 | Brands / Accounts empty · `BrandsPage.tsx:86-89`; `AccountsPage.tsx:120-126` | Buttons are up in the page header, not in the box; members see no way forward. | Put the primary action inside the empty box; for members: "Ask {owner} to connect your accounts." |
| P1-30 | Calendar empty month (desktop) · `CalendarPage.tsx:159-201` | 42 empty boxes, no message (phones do get one). | Overlay: "Nothing planned for November · **Schedule an approved post** · **Write a new one**". |
| P1-31 | Calendar busy days · `CalendarPage.tsx:183-196` | All items stack in the cell (3 on 7 Nov); titles truncate to "Mon…"; 12 px chips 20 px tall. | Max 3 then "+2 more" opening a day popover; 13 px chips ≥ 28 px tall. |
| P1-32 | Home "Coming up" / "Recently published" · `HomePage.tsx:310, 434` | Grey sentences only. | "Nothing scheduled this week — **Schedule a post**" / "**Write your first post**". |
| P1-33 | Template browser dialog · `TemplateDialogs.tsx:142-153` | No error state; "No templates match" has no reset; raw checkbox "Only Fitness". | Error + Retry; **Clear search**; styled toggle. |
| P1-34 | Publish panel, no accounts · `PublishPanel.tsx:84-93` | A text link at the most important moment. | **Connect an account** button plus "or add a test account". |
| P1-35 | Text-only posts · `PostsPage.tsx:150`, `HomePage.tsx:444` | Blank grey square reads as a broken image (10 of 15 rows). | Brand-initials tile with a small "Text" glyph, or a caption snippet tile. |

**Forms and feedback**

| # | Screen · file | Problem | Fix |
|---|---|---|---|
| P1-36 | Date & time · `PublishPanel.tsx:144-148` | Native `datetime-local`: looks different per OS, fiddly on tablets, no quick picks. | Chips ("Tomorrow 10 am", "Sat 11 am") + a friendly date picker and time select. |
| P1-37 | Validation pattern (app-wide) | No `aria-invalid` anywhere; errors are toasts that vanish, or buttons that just stay grey. | Inline field messages with `aria-invalid`/`aria-describedby`; keep buttons enabled and explain on click. |
| P1-38 | Approve with a blocked channel · `ApprovalPanel.tsx:251-259`; `PostStudioPage.tsx:488` | Approve is allowed while Instagram says "Needs a photo". | Warn in the Approve flow: "Instagram will be skipped (no photo). Approve anyway?" |
| P1-39 | Brand industry · `BrandsPage.tsx:212-230` | Free text + datalist; "Gym" vs "fitness" silently yields no templates. | Select of known industries + "Other". |
| P1-40 | Brand logo · `BrandsPage.tsx:269` | Only after the brand exists. | Allow the logo in the create dialog. |
| P1-41 | Channel cards double as tabs · `PostStudioPage.tsx:483-525` | Clicking "Instagram" switches the whole editor into "Instagram wording" mode; users expect it to toggle the channel. | Cards show status only; a small "Customize for Instagram" link opens per-channel text. |
| P1-42 | Hashtag input · `parts.tsx:86-152` | Space commits a tag, so multi-word attempts split; the 24 px "×" is tiny. | Commit on Enter/comma only; 32 px remove target; show "Press Enter to add". |

### P2 — Visual polish, accessibility, responsiveness

| # | Screen · file | Problem · measurement | Fix |
|---|---|---|---|
| P2-1 | Theme default · `lib/theme.tsx:18`, `index.css:113-149` | Dark obsidian by default feels like a developer tool to café/salon owners; photos read differently than on a feed. | **Owner decision:** default new accounts to "Match my device"; keep dark as an option; expose Appearance in Settings. |
| P2-2 | Field and card edges · `index.css:129-130, 90-91` | Measured live: card borders **1.24:1**, input borders **1.63:1** (dark). Tokens: light input `#d5dbe5` on white **1.39:1**. WCAG 1.4.11 wants 3:1 for field edges. | Dark `--input` ≈ `#4a5a78` with a slightly lighter field fill; light `--input` ≈ `#9aa3b2`. Cards can stay subtle but fields must not. |
| P2-3 | Indigo text on dark · `CalendarPage.tsx:132, 179`; `AppShell.tsx:161, 172, 269` | `#4f46e5` text on `#151d2a` = **2.69:1** ("today" number, selected ticks, active phone-tab icon). | Add `--primary-text` (dark `#a5b4fc`) for text/icons; keep `#4f46e5` for fills. |
| P2-4 | Small type · `index.css:160`; `HomePage.tsx:191, 200-208`; `AppShell.tsx:264` | Measured on Home: sizes 10, 11, 12, 13, 14 px in use; 14 px base. | Base 15 px; nothing under 12 px; muted text ≥ 13 px. |
| P2-5 | Hit targets · `components/ui/button.tsx:23-29` and callers | Measured: Home 24/39 targets < 40 px; Calendar 15/30; Post Studio on phone 19/35 under 44 px. Rail icons 36 px, "sm" buttons 32 px, hashtag "×" 24 px, text links 16–20 px tall. | Default 40 px, 44 px under `(pointer: coarse)`; icon buttons ≥ 40 px; media-card actions in one "⋯" menu. |
| P2-6 | Home density and equal weight · `HomePage.tsx:133-461` | Hero + 4 counts + up to 8 tiles, all the same border and radius; three similar "Manage / Calendar / See all" links; 1,199 px tall at 1366×768. | Order: hero with one CTA → "Needs your attention" full width → Coming up + Account health → the rest folded into "Your numbers". Make the chart secondary. |
| P2-7 | Home on tablet (768 px) · `HomePage.tsx:167-170, 300-303, 335-338`; `Tile.tsx:26-36` | Verified: "Last 14 days" wraps to two lines, "Coming up" runs into its "Calendar" link, "Accounts" into "Manage". 3-column tiles are too narrow at `md`. | At `md` use 2 columns for those tiles (`md:col-span-6`, `xl:col-span-3`); let tile headers wrap under the title. |
| P2-8 | Post Studio header actions · `PostStudioPage.tsx:395-424` | Up to five buttons in one sticky header; after approval, only a bin icon. | One primary per state; secondary actions in "⋯"; keep to one row at ≥1024 px. |
| P2-9 | Two scroll columns · `PostStudioPage.tsx:357, 427-429, 649` | At `lg` each half scrolls separately inside `h-svh`; users scroll the wrong side. The `preview-glow` adds noise. | Single page scroll with a sticky preview; tabs ("Write / Preview / Publish") under 1280 px. Tone down the glow. |
| P2-10 | Preview occupies 45% of a new post · `PostStudioPage.tsx:649-691` | Empty-post preview ("Your caption will appear here") takes nearly half the screen before anything is written. | Collapse the preview to a small card until there is content, or start on the composer full width with a "Preview" toggle. |
| P2-11 | Monospace for ordinary numbers · `PostStudioPage.tsx:514, 561, 673`; `ApprovalPanel.tsx:56` | Character counts, dates, "Not published yet" in a code font. | `tabular-nums` in the sans font (already set in `index.css:165-168`); monospace only for codes. |
| P2-12 | Status by colour alone · `CalendarPage.tsx:142, 191, 202-206` | Chips use colour only; legend lists 3 of 5 tones (publishing, partly published missing). | Small status icon per chip; complete legend. |
| P2-13 | Calendar on tablet · `CalendarPage.tsx:91, 160, 209` | Verified: grid fits (590 px) but cells are 104 px with 20 px chips; the "Not on the calendar yet" list falls to 986 px, under the month. | Week/agenda view by default at `md`, Month as a toggle; side list as a collapsible drawer. |
| P2-14 | Time-zone tile · `CalendarPage.tsx:231-234` | A whole tile for "Times are in IST". | One line under the month title. |
| P2-15 | Hover-only cues · `HomePage.tsx:484` (arrow `opacity-0`), activity bars with `title` only (`:187`) | Touch users never see them. | Always-visible faint arrow; tap tooltip on bars or drop the chart. |
| P2-16 | Text links styled as buttons · `BrandsPage.tsx:119-129`; `AccountsPage.tsx:171-177` | "Edit · Client contacts · Remove" as bare text, 16–20 px tall. | `Button variant="outline" size="sm"`; Remove in "⋯". |
| P2-17 | Instagram preview placeholder · `parts.tsx:200-205` | "Instagram needs a photo" measured **2.87:1** (white/60 on near-black). | white/80 or move the message out of the mock into the channel card. |
| P2-18 | Seal overlaps the record header · `ApprovalPanel.tsx:129-145` | 104 px seal sits over the "Approval record" title; header gets `pr-32` to dodge it. | Place the seal inside the card next to the title, 72 px. |
| P2-19 | Client approval page bar · `ClientApprovalPage.tsx:352-390` | Fixed bottom bar holds note box + name field + errors + two buttons; name field reads as a chore. | Prefill name as "Approving as **Riya** (change)"; put the note in a sheet. |
| P2-20 | Template cards · `TemplatesPage.tsx:107-118` | Raw `[Service name]` placeholders and emoji in previews; "Use this template" is an outline button with the same weight as the badges. | Render placeholders as soft chips; primary button per card. |

---

## Implementation Plan

Three phases, ordered so behaviour fixes land before the visual refresh; Phase 3 then only touches tokens and layout. Each phase ships on its own.

### Phase 1 — Flow and safety (all P0) · ~1 sprint · no visual redesign
Goal: nobody loses work, nobody posts to the wrong client, every journey has a next step.
1. **Make blocked accounts actionable and consistent** (P0-1): link each check error to its fix; mirror plan/outage state on the Accounts page; show plan limits on the channel cards before approval.
2. **Publish defaults by brand** (P0-2): nothing pre-ticked / last-used-for-brand; brand named in the confirm dialog. Open the backend ticket to attach accounts to brands.
3. **Approve → schedule hand-off** (P0-3): publish panel above the preview when approved, Schedule button in the header, toast action.
4. **Autosave + leave guard** (P0-4), **photos before save** (P0-5), **Send saves first** (P0-6), **no blank after save** (P0-7).
5. **Schedule from the Calendar** (P0-8), **brand chooser for templates and the dead end** (P0-9, P0-10).
6. **`<SafeImage>` + text-post tile** (P0-11, P1-35).

Verify: re-run the three journeys at 1366×768 and 768×1024 and confirm the targets in the journey table (5 / 2 / 3 clicks, no scroll to the primary action).

### Phase 2 — Clarity: words, navigation, empty states, forms · ~1 sprint
1. **Copy pass** (P1-11 → P1-26): one glossary in `lib/format.ts` (statuses, roles, "approval code"); one word per idea; hide "Phase 2"/"next phase" UI.
2. **Navigation** (P1-1 → P1-10): labelled rail, labelled brand switcher, "Showing brand" chip, tooltips everywhere, delete behind "⋯", search + "Assigned to me" + counts on Posts, reviewer picker fixes, assignee in the header, notification actions.
3. **Empty/loading/error states** (P1-27 → P1-35): `EmptyState` with icon + action, applied to every list and widget.
4. **Forms** (P1-36 → P1-42): schedule chips, inline validation, approve-with-warning, industry select, logo on create, channel cards vs per-channel text, hashtag input.
5. Fold in the already-agreed **friendly error screen** so `ErrorBoundary` matches the new tone.

### Phase 3 — Visual and theme refresh · alongside the planned redesign
1. **Tokens first, `index.css` only** (P2-2, P2-3, P2-4): field-edge contrast, `--primary-text`, 15 px base with a 12 px floor; 40/44 px targets in `button.tsx` (P2-5).
2. **Theme default decision** with the owner (P2-1) and Appearance in Settings.
3. **Hierarchy**: Home order and tablet grid (P2-6, P2-7), one primary per Post Studio state (P2-8), single-scroll studio with sticky preview and a collapsed empty preview (P2-9, P2-10), monospace only for codes (P2-11).
4. **Calendar**: week/agenda at tablet widths, "+N more", status icons, legend, time-zone line (P2-12 → P2-14).
5. **Touch polish**: no hover-only cues, outline buttons for text links, preview placeholder contrast, seal placement, client bar, template cards (P2-15 → P2-20).

Verify: run the in-page contrast script again (all text ≥ 4.5:1, field edges ≥ 3:1); screenshots at 375, 768, 1024 and 1366 px in both themes; hit-target count under 40 px should be zero on Home, Posts and Calendar.

---

## What already works well (keep it)
- Human status labels ("Waiting for approval", "Didn't publish") and warm toasts ("Back to draft. You can edit it now.").
- Confirmation dialogs on every irreversible action, including the careful "I checked — it isn't on the page" retry.
- Load errors kept separate from empty states (`LoadError` vs `EmptyState`).
- The reviewer picker and client-link share flow are clear and well worded.
- Phone layout: bottom bar, agenda calendar, a single-column studio with no horizontal scroll (verified at 375 px).
- The client approval page: light theme, phone-first, countdown and receipt.
