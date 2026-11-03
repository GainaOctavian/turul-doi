# Turul Doi

Joc de browser despre guvernarea României, ancorat în realitate, cu umor dozat: scenarii (2017,
2026), buget în M€, indicatori și comparații cu UE, harta electorală pe județe. Vezi
`README.md` și `docs/data-model.md`.

## Cum rulează

```bash
npm start          # http://127.0.0.1:4173 (dacă portul e ocupat, oprește serverul vechi)
npm run start:ctl  # același server + endpoint-ul de control
npm test           # node:test, fără dependențe
npm run ctl -- state
node tools/sim.mjs 2026 4   # simulare AI de reglaj pentru economie
```

## Arhitectură

- `shared/engine.mjs` (partide, sondaj, alegeri, evenimente, campanie), `shared/gov.mjs`
  (buget, taxe, indicatori, SoL, cabinet), `shared/parl.mjs` (legi, voturi, culise, moțiuni,
  relații, coeziune, fuziuni, plecări, profil), `shared/world.mjs` (UE și țări). Același cod rulează
  în browser (solo) și pe server (multiplayer).
- `public/app.mjs` (start, hartă, panouri politice, evenimente), `public/dash.mjs` (ecranele
  Guvern/Țara/Lume/Știri), `public/parl-ui.mjs` (Parlament și Partid), `public/kit.mjs` (formatare și componente), `public/portraits.mjs`.
- Datele sunt în `data/`; lista de fișiere e în `shared/data-files.mjs`. Un fișier nou de date
  se adaugă acolo.
- Bani: totul în M€ (bugetul statului, partidele, costul acțiunilor). Cheltuielile se rețin ca
  procent din PIB; sliderul din UI e în M€/an.

## UI

- Textul din interfață e în română, deliberat; codul, comentariile și documentația rămân în engleză.
- Șapte secțiuni color-coded (Politică, Parlament, Partid, Guvern, Țara, Lume, Știri). Culoarea secțiunii e `--sec`.
- Panourile se redesenează doar dacă HTML-ul s-a schimbat (`makePatcher`), păstrând scroll-ul,
  selecturile și `<details>`; nu redesena sub un buton apăsat sau un slider tras.
- Butoanele reacționează la `pointerdown` (`onPress`); click-ul de la tastatură (detail 0) rămâne.
- Selecturile controlate de starea jocului au `data-live` ca să nu fie restaurate din DOM-ul vechi.

## Date reale

- Faptele despre persoane trebuie să fie verificabile. Verifică liderii partidelor, premierul și miniștrii
  înainte să le scrii (căutare pe web); la 2 noiembrie 2026: Grindeanu la PSD, Fritz la USR,
  Niculescu premier din 20 octombrie 2026.
- Cifrele macro și bugetare din scenarii sunt estimări de joc; țările din comparație sunt orientative.
- Fără etichete „real”/„satiră”: o singură listă `facts` (fapte publice, inclusiv scandaluri cunoscute, verificate). Nu se inventează acuzații; umorul rămâne dozat.
- Partidele pot fi create, fuzionate sau modificate în timpul jocului (`state.defs`, `partyDef()` din `shared/util.mjs`): nu citi partidul direct din `data.parties`.
- Editează fișierele cu scripturi node sau cu tool-urile de editare, nu cu `Get-Content`/`Set-Content` (PowerShell 5.1 strică diacriticele).

## Legislație (surse pentru legi)

Legile din joc (`data/bills.json`) se sprijină pe acte reale, citite din corpusul
`github.com/lexifina/romania-law` (actualizat zilnic). Unealta e `tools/law.mjs`:

```bash
node tools/law.mjs sync && node tools/law.mjs clone   # index + clone superficial în .cache/ (gitignored)
node tools/law.mjs find --kind lege --text "cod"      # căutare în index (titlurile sunt doar numere)
node tools/law.mjs get 176/2010 --articles 3          # rândul din index + primele articole
node tools/law.mjs brief lege/2016/184 oug/2011/109   # subiectul, dintr-o privire
node tools/law.mjs grep "conflict de interese"        # full-text în articolele în vigoare
node tools/law.mjs repeals 571/2004                   # abrogări implicite (indexul le ratează)
node tools/law.mjs check                              # verifică data/law-sources.json
node tools/bills-law.mjs                              # reconstruiește surse + legi din lot
```

- Nu te baza pe `status` din index: lipsesc abrogările implicite (Legea 571/2004 apare „in force”,
  dar art. 37 din Legea 361/2022 o abrogă) și „amending act” e o euristică. Rulează `repeals`.
- `data/law-sources.json`: actele verificate (`sources`) și capcanele (`retired`). O lege din
  joc primește `source: {slug, note}`; testele refuză surse necunoscute sau retrase.
- Previzualizările (`previewAction`) rulează o acțiune pe o copie a stării și raportează diferența în pp; nu cheltuiesc nimic. Folosește-le în loc să duplici logica de efect în UI.
- Acțiunile de guvernare (`need: "gov"` în `ACTIONS`, `shared/engine.mjs`): inaugurare, pachet de ajutoare, comunicare de guvern; doar partidele din coaliție le pot folosi.
- Amendamentele (`amendOptions`, `lawEffects`, `amendBill` în `shared/parl.mjs`): fiecare lege oferă amendamente concrete (text + efecte) din `data/amendments.json`; cel adoptat își adaugă efectele la promulgare.
- Prezidența (`shared/presidency.mjs`): legile adoptate în Parlament așteaptă la Cotroceni 7 zile; efectele lor se aplică doar la promulgare (`decideLaw`). Președintele e AI sau jucătorul (dacă partidul lui conduce Cotroceni), iar alegerile sunt la 5 ani, în două tururi.
- Echilibrul (erodarea guvernării, estomparea creditului) e în `balanceMonthly`; folosește `data.config.balance = false` în teste care compară două jocuri.
- Tonul legilor e profesionist, fără glume; doar știrile pot fi amuzante.
- Scandalurile din `politicians.json` au fiecare o intrare în `data/scandal-sources.json` (decizia, data, autoritatea, sursa).
  Testul verifică că faptul există în joc. Sursele sunt Wikipedia citând presa și comunicatele; decizia primară (portal.just.ro, scj.ro) trebuie verificată înainte de lansare.

## Personal conventions

- Claude doesn't commit by default (side sessions and worktrees included) and doesn't offer to. When work is ready, give the user the commit message; the user commits, and Claude may check the result with read-only git (`git log`, `git show`, `git status`). Only when the user explicitly asks Claude to commit does Claude make that commit. Never push or merge. No `Co-Authored-By` or any Claude attribution in messages.
- Commit messages: `feat(<area>): ...`, `fix(<area>): ...`. Branches: `<area>/<feature>`, PRs into `main`.
- Claude may create and switch branches itself, from up-to-date `main`. Branches are broad and long-lived (several features/phases), not one per feature: the user commits on them at each milestone and merges rarely. Claude never merges; suggest a merge into `main` only at a real milestone (a coherent set of features done and verified), not after every feature.
- Planning stays out of the repo: per-feature plans go in `docs/claude-plans/` (gitignored), starting from `00-overview.md`. Update them as work happens (status, decisions, deviations).
- Documentation that helps a reader of the code goes IN the repo, under `docs/`: diagrams (Mermaid preferred, renders on GitHub), architecture notes, data models. Every few features, propose a new or updated diagram/doc when the structure changed.
- Keep `CLAUDE.md` files current as the code changes.
- Before handing a feature over for testing, run it end-to-end in the real app and click through it, not just type-check/build. Then list the exact steps the user must run.
- Tests and test data never touch the user's real data/files: separate buckets/DBs/folders, never bulk-clean shared storage.
- Everything user-facing is English (UI copy, messages, new code comments), except in this repo: the game UI and game data text are Romanian on purpose (see "UI" above). Code, comments and docs stay English. Chat with the user may be in Romanian.
- Every app we build together has a ctl (`<app>-ctl`): a line-based command language over the app's own commands, plus built-ins for what needs a dialog or the mouse, a local opt-in endpoint (127.0.0.1 + token), a CLI and a repo skill (`.claude/skills/<app>/SKILL.md`). Build it with the first features and keep it current with every feature, in the same change: the feature must work from a script, `help` and the skill list it, and the ctl tests cover it. A feature isn't done until the ctl can drive it.
