# TaskiT — Personal Kanban

A zero-dependency web app for personal task tracking. It runs entirely in your
browser — no server, no account, no build step. Data is stored locally in your
browser's `localStorage`.

## Features

- **Kanban board** with four columns: **Backlog → In Progress → Done**, plus
  **Not Done** for things you missed outright. Drag & drop cards between
  columns on desktop, or use the ◀ / ▶ buttons on each card (handy on phones).
  On small screens the columns become swipeable. Open columns are sorted by
  urgency — overdue first, then nearest deadline, then no-deadline tasks;
  Done and Not Done show the most recent first.
- **Not Done** — the ⊘ button on any open card marks it missed, for work you
  couldn't do and won't carry over. A missed recurring task releases its next
  occurrence exactly like completing it does, so tomorrow's card still shows
  up. The ↩ button puts a card back in the backlog if you change your mind.
- **Edit in place** — the ✎ button (or double-click) opens an edit dialog to
  rename a task, change or clear its due date, and add, change, or remove its
  recurrence — including turning an existing task into a recurring one.
- **Creation & completion dates** — every task records when it was created;
  moving a card to *Done* stamps its completion time. Done cards show how long
  they took (✓ 3.2 d, ✓ 45 min, …).
- **Auto-archive** — done and not-done cards leave the board 7 days after they
  were finished or missed, keeping those columns tidy. Nothing is deleted:
  archived tasks stay in your data, sync, exports, and all statistics; the
  column shows a "🗄 N archived" note and the Stats tab counts them.
- **Categories** — tag tasks with a category (e.g. Fitness, Savings,
  Intellectual growth). Type anything in the Category field; previously used
  names are suggested. Cards show a color-coded category badge, recurring
  tasks pass their category to every spawned card, and each category keeps a
  stable color (9th and later fold to gray in charts).
- **Stats view** — see how your pace changes over time:
  - Average time-to-done, with a trend vs. the previous 4 weeks.
  - A weekly chart of average completion time (hover a bar for details).
  - A weekly chart of tasks completed **by category**, one bar per category,
    with legend and per-week tooltips.
  - **Not done, week over week** — a table of how many times each task was
    missed in each of the last 6 weeks, most-missed first, with per-week and
    per-task totals, plus a "Missed this week" tile comparing to last week.
  - Your 5 slowest and 5 fastest tasks.
- **Voice input** — tap the microphone, say your task, and it's added to the
  backlog. Uses the browser's built-in speech recognition.
- **Deadlines with color coding** — give a task a due date and its card is
  edged and badged from **green** (plenty of time) through **yellow** and
  **orange** (under 24 h or less than 20 % of the time left) to **red**
  (overdue). The colors always come with a text label ("Due tomorrow",
  "Overdue 2.0 d"), so meaning never relies on color alone.
- **Recurring tasks** — set a task to repeat daily, weekly, monthly,
  quarterly, half-yearly, yearly, or on **custom weekdays** ("Custom days…"
  reveals Mon–Sun toggles, so "every Monday" or "Mon + Thu" both work). A
  fresh card appears in the backlog each period — due by the next occurrence,
  or by the end of the day for weekday-based repeats. If the previous card is still open, no
  duplicate is spawned; after a long absence, missed periods are skipped
  rather than piled up. Manage or stop recurrences in the ↻ panel under the
  board.
- **Deadline notifications (optional)** — click the 🔕 bell in the header and
  allow notifications; the app then pings you once when a task is due within
  24 hours and once more if the deadline is breached. Works while TaskiT is
  open in a tab or installed as a PWA — no server involved. Each task
  notifies at most once per level, even across reloads (and across devices,
  when sync is on).
- **Cloud sync across devices (optional)** — connect a free Firebase project
  (see [SETUP-SYNC.md](SETUP-SYNC.md)) and sign in with Google to sync your
  board between phone and laptop in real time, with offline support. Without
  it, TaskiT stays fully local.
- **Robust data** — versioned storage with validation, automatic daily
  rolling backups (last 3 days kept), automatic recovery from backup if the
  main store is ever corrupted, and **Export / Import JSON** (Stats tab) for
  keeping backups outside the browser or moving to another device.
- **Mobile-friendly** — responsive layout, dark mode, and a web app manifest so
  you can *Add to Home Screen* and use it like a native app.

## Running it

Voice input requires a **secure context** (HTTPS or localhost), so serve the
folder rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host (GitHub Pages, Netlify, etc.) works too — there is no backend.

## Browser notes

- Speech recognition works in Chrome, Edge, and Safari. In Firefox the mic
  button is disabled (everything else works).
- Data lives in `localStorage` under the key `taskit.data.v2`, per browser and
  per device (older `taskit.tasks.v1` data is migrated automatically). Daily
  backups are kept under `taskit.backup.*`.
- Recurring tasks spawn while the app is open (checked every minute) and on
  every launch — the app doesn't need to be running at the exact moment a
  period rolls over.

## Tips

- Double-click (or double-tap) a card to rename it.
- Moving a card *out* of Done clears its completion time — the clock keeps
  running until it lands in Done again.
