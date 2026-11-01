---
name: turul-doi
description: Drive the Turul Doi game from a script or terminal — inspect state, play a party, run actions, advance the clock, fire events, run elections. Use when asked to check, test or script the turul-doi game, or to verify a game change end-to-end.
---

# turul-doi ctl

The game is a browser app in `C:\Users\Octavian\Documents\turul-doi`. Everything the UI can
do, the ctl can do from a terminal, so a change can be verified without clicking.

## Start it

```bash
npm run start:ctl      # server on http://127.0.0.1:4173 with /ctl enabled
npm run ctl -- state
```

`start:ctl` writes `.turul-doi/ctl.json` (port + token, 127.0.0.1 only). The CLI reads it
from the current directory, so run commands from the repo root. If the file is missing, the
game is not running with the ctl.

## Commands

| Command | What it does |
| --- | --- |
| `state` | day, date, days to election, party played, funds, capital, speed |
| `parties` | every party: poll share, seats, funds, government flag |
| `poll` | national poll, sorted |
| `counties [filter]` | who leads each county (filter by id or name) |
| `play <party> [name]` | take control of a party |
| `speed <0\|1\|2\|4>` | clock speed (0 = paused) |
| `pause` / `resume` | stop or restart the clock |
| `act <type> [county] [rival] [law]` | run an action |
| `actions` | action ids, costs, cooldowns, targets |
| `laws` | laws and their capital cost |
| `politicians [party]` | profiles and key stats, optionally one party |
| `event <id>` | fire a specific event (decision events open a decision) |
| `decisions` | pending decisions for the played party, with choice numbers |
| `decide <id> <choice>` | answer a decision (choices start at 0) |
| `tick <days>` | advance the clock |
| `election` | run an election now |
| `coalition <from> <to>` | send a coalition offer |
| `accept <to> <from>` | accept an offer |
| `events` | recent events and elections |
| `help` | the list above |

Action types: `rally` (county), `tv`, `online`, `deal` (county), `attack` (county + rival),
`promise`, `law` (law id; only if in government).

## Typical verification run

```bash
npm run ctl -- play psd
npm run ctl -- "act rally cluj"
npm run ctl -- "act online"
npm run ctl -- "tick 30"
npm run ctl -- poll
npm run ctl -- parties
npm run ctl -- "event austeritate-invatamant"
npm run ctl -- counties
npm run ctl -- "tick 100"          # reaches the election, forms a government
npm run ctl -- state
```

Batch from a file: `npm run ctl -- script.txt` (lines, `#` comments). From stdin:
`echo "state" | npm run ctl -- -`.

## Notes

- The ctl drives a separate in-memory room; it does not touch a browser session or a
  multiplayer room.
- Exit code is 1 if any line returned `error`.
- Anything the UI shows that the ctl cannot read (map colours, toasts, modals) still needs a
  browser check. Use `?party=<id>&day=<n>` to jump a solo game to a given day, and
  `&event=<id>` to fire one event at the start (e.g. `&event=d-greva-medici` to see a decision).
- Tests: `npm test` (engine + one full ctl turn).
