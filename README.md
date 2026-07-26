# TaskiT — Personal Kanban

A zero-dependency web app for personal task tracking. It runs entirely in your
browser — no server, no account, no build step. Data is stored locally in your
browser's `localStorage`.

## Features

- **Kanban board** with three statuses: **Backlog → In Progress → Done**.
  Drag & drop cards between columns on desktop, or use the ◀ / ▶ buttons on
  each card (handy on phones). On small screens the columns become swipeable.
- **Creation & completion dates** — every task records when it was created;
  moving a card to *Done* stamps its completion time. Done cards show how long
  they took (✓ 3.2 d, ✓ 45 min, …).
- **Stats view** — see how your pace changes over time:
  - Average time-to-done, with a trend vs. the previous 4 weeks.
  - A weekly chart of average completion time (hover a bar for details).
  - Your 5 slowest and 5 fastest tasks.
- **Voice input** — tap the microphone, say your task, and it's added to the
  backlog. Uses the browser's built-in speech recognition.
- **Deadlines with color coding** — give a task a due date and its card is
  edged and badged from **green** (plenty of time) through **yellow** and
  **orange** (under 24 h or less than 20 % of the time left) to **red**
  (overdue). The colors always come with a text label ("Due tomorrow",
  "Overdue 2.0 d"), so meaning never relies on color alone.
- **Recurring tasks** — set a task to repeat daily, weekly, monthly,
  quarterly, half-yearly, or yearly. A fresh card appears in the backlog each
  period, due by the next occurrence. If the previous card is still open, no
  duplicate is spawned; after a long absence, missed periods are skipped
  rather than piled up. Manage or stop recurrences in the ↻ panel under the
  board.
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
