# Turul Doi

Joc de browser, satiră politică românească: hartă de influență pe județe, segmente de
votanți care își schimbă mărimea, politicieni reali cu profiluri și un ceas în timp real.

## Cum rulează

```bash
npm start          # http://127.0.0.1:4173
npm run start:ctl  # același server + endpoint-ul de control (bin/turul-doi-ctl.mjs)
npm test           # node:test, fără dependențe
npm run ctl -- state
```

Fără build step și fără dependențe npm. Serverul e `node:http`; multiplayerul e Server-Sent
Events plus POST-uri, nu WebSocket. Solo rulează motorul direct în browser.

## Structură

- `shared/engine.mjs` — motorul pur (stare JSON, `createGame`, `tick`, `applyAction`,
  `computePoll`, `snapshot`). Rulează identic în browser și pe server.
- `shared/ctl.mjs` — limbajul de comenzi al ctl-ului, peste motor.
- `server.mjs` — fișiere statice, camere SSE, endpoint `/ctl` (doar 127.0.0.1, token).
- `bin/turul-doi-ctl.mjs` — CLI-ul; citește `.turul-doi/ctl.json`.
- `public/` — UI fără framework: `index.html`, `style.css`, `app.mjs`.
- `data/` — tot conținutul editabil: județe, segmente, partide, politicieni, evenimente,
  legi, harta (generată de `tools/build-map.mjs`).
- `docs/` — arhitectură și model de date. `docs/claude-plans/` e gitignored.

## Reguli de satiră

- Faptele marcate `real` trebuie să fie verificabile.
- Faptele marcate `fake` sunt inventate și intenționat absurde; niciodată despre viața
  privată, copii, boli sau acuzații penale plauzibile.
- Statisticile (corupție, traseism etc.) sunt de joc, nu evaluări ale persoanelor.
- UI-ul spune clar că e satiră.

## UI

Textul din interfață e în română, pentru că jocul e despre politica românească. Codul,
comentariile și documentația tehnică rămân în engleză.

## Personal conventions

- Claude doesn't commit by default (side sessions and worktrees included) and doesn't offer to. When work is ready, give the user the commit message; the user commits, and Claude may check the result with read-only git (`git log`, `git show`, `git status`). Only when the user explicitly asks Claude to commit does Claude make that commit. Never push or merge. No `Co-Authored-By` or any Claude attribution in messages.
- Commit messages: `feat(<area>): ...`, `fix(<area>): ...`. Branches: `<area>/<feature>`, PRs into `main`.
- Claude may create and switch branches itself, from up-to-date `main`. Branches are broad and long-lived (several features/phases), not one per feature: the user commits on them at each milestone and merges rarely. Claude never merges; suggest a merge into `main` only at a real milestone (a coherent set of features done and verified), not after every feature.
- Planning stays out of the repo: per-feature plans go in `docs/claude-plans/` (gitignored), starting from `00-overview.md`. Update them as work happens (status, decisions, deviations).
- Documentation that helps a reader of the code goes IN the repo, under `docs/`: diagrams (Mermaid preferred, renders on GitHub), architecture notes, data models. Every few features, propose a new or updated diagram/doc when the structure changed.
- Keep `CLAUDE.md` files current as the code changes.
- Before handing a feature over for testing, run it end-to-end in the real app and click through it, not just type-check/build. Then list the exact steps the user must run.
- Tests and test data never touch the user's real data/files: separate buckets/DBs/folders, never bulk-clean shared storage.
- Everything user-facing is English (UI copy, messages, new code comments). Chat with the user may be in Romanian.
- Every app we build together has a ctl (`<app>-ctl`): a line-based command language over the app's own commands, plus built-ins for what needs a dialog or the mouse, a local opt-in endpoint (127.0.0.1 + token), a CLI and a repo skill (`.claude/skills/<app>/SKILL.md`). Build it with the first features and keep it current with every feature, in the same change: the feature must work from a script, `help` and the skill list it, and the ctl tests cover it. A feature isn't done until the ctl can drive it.
