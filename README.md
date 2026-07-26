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
- Data lives in `localStorage` under the key `taskit.tasks.v1`, per browser and
  per device.

## Tips

- Double-click (or double-tap) a card to rename it.
- Moving a card *out* of Done clears its completion time — the clock keeps
  running until it lands in Done again.
