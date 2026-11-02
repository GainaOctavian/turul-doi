---
name: turul-doi
description: Drive the Turul Doi game from a script or terminal — pick a scenario (2017/2026), play a party, run campaign actions, change the budget and taxes, adopt policies, appoint ministers, advance the clock, read indicators and EU comparisons, fire events, run elections. Use when asked to check, test or script the turul-doi game, or to verify a game change end-to-end.
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
game is not running with the ctl. If port 4173 is busy, stop the old server first.

## Commands

| Command | What it does |
| --- | --- |
| `scenario <2017\|2026>` | start a fresh game on a scenario |
| `state` / `gov` | date, party played, funds (M€) / PM, coalition, confidence, rating |
| `parties` / `poll` / `counties [filter]` | party table, national poll, county winners |
| `play <party>` | take control of a party of the scenario (2017 has alde/pmp, 2026 has aur/sos/pot) |
| `speed <0\|1\|2\|4>`, `pause`, `resume` | clock speed (0 = paused) |
| `actions`, `act <type> [county] [rival]` | campaign actions and their M€ cost |
| `budget` | revenue and spending lines in M€ and % of GDP, balance, taxes |
| `spend <line> <M€/yr>` | set a spending line (pensions, social, health, education, defense, order, infra, agri, admin) |
| `tax <vat\|income\|corp> <rate>` | set a tax rate |
| `policies [ministry]`, `policy <id>`, `repeal <id>` | list / adopt / repeal policies |
| `metrics`, `sol`, `world [indicator]` | country indicators with EU averages, standard of living, comparison table |
| `cabinet`, `appoint <ministry> <politician>` | ministries and ministers; reshuffle (PM's party only) |
| `proposals`, `answer <id> <accept\|reject>` | cross-ministry proposals |
| `motion`, `support <on\|off>` | opposition motion of no confidence; supporting party withdraws/renews support |
| `politicians [party]` | profiles and key stats |
| `event <id>`, `decisions`, `decide <id> <choice>` | fire an event; pending decisions and answers |
| `tick <days>`, `month [n]` | advance the clock (month = 30 days) |
| `election` | run an election now |
| `coalition <from> <to>`, `accept <to> <from>` | coalition offers during negotiations |
| `events` | recent events, elections, rating moves, world news |
| `help` | the list above |

Budget changes follow ownership: a ministry's party sets its lines and policies; other
government parties send a proposal; the opposition can only file a motion.

## Typical verification run

```bash
npm run ctl -- "scenario 2026"
npm run ctl -- "play psd"
npm run ctl -- budget
npm run ctl -- "policy indexare-pensii"
npm run ctl -- "month 6"
npm run ctl -- metrics
npm run ctl -- sol
npm run ctl -- "world deficit"
npm run ctl -- "tick 760"          # reaches the election, forms a government
npm run ctl -- gov
```

Batch from a file: `npm run ctl -- script.txt` (lines, `#` comments). From stdin:
`echo "state" | npm run ctl -- -`.

## Notes

- The ctl drives a separate in-memory room; it does not touch a browser session or a
  multiplayer room.
- Exit code is 1 if any line returned `error`.
- Anything the UI shows that the ctl cannot read (map colours, toasts, modals) still needs a
  browser check. Use `?scenario=2017&party=psd&day=40` to start a solo game on a given scenario
  and day, and `&event=<id>` to fire one event at the start.
- `node tools/sim.mjs <scenario> <years>` runs an AI-only game and prints macro numbers; use it
  after changing the economy model.
- Tests: `npm test` (engine, data integrity, scenarios, government, ctl).
