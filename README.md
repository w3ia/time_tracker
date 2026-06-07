# Punchcard: Personal Time Ledger

A zero-dependency, single-page time tracker. Vanilla JS, no build step, no server-side anything. All data lives in your browser's `localStorage`.

## Run it

```sh
python3 -m http.server 4173
```

then open <http://localhost:4173>. (Any static file server works; opening `index.html` directly also works in most browsers.)

## How it works

- **Projects** group activities (e.g. *website* → *site updates*, *deploy*).
- **▶ start** an activity — starting one automatically pauses whatever else was running, so context switching is one click. **❚❚ pause** stops the clock; ▶ again resumes. **✓ finish** marks it done (reopenable).
- **Today's ledger** (right panel) shows total time, the per-project split, and top activities — your end-of-day overview.
- **History** tab: calendar of past days; click a day to see its ledger and full session log.
- **Export CSV** downloads every session (date, project, activity, start, end, duration) ready for Google Sheets import.

## Tests

```sh
node --test "tests/*.test.js"
```

Zero-dependency, using Node's built-in test runner. `tests/harness.js` loads `app.js` into a `vm` sandbox with stubbed `document`/`localStorage`, so the real app code is tested without a browser or any refactoring.

## Data

Stored under the `punchcard.v1` key in `localStorage`, keyed to the origin you serve from — use the same port consistently. Export CSV regularly if you want a backup.
