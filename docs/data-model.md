# Model de date

Tot conținutul de joc e JSON, în `data/`. Motorul nu are altă sursă de adevăr.

## Fișiere

### `config.json`

```json
{ "campaignDays": 120, "totalSeats": 330, "startDate": "2027-01-01",
  "startFunds": 350, "startCapital": 25, "eventChance": 0.24,
  "aiEveryDays": 3, "tickMs": 2000, "daysPerTick": 1, "maxLog": 120 }
```

### `counties.json`

42 de intrări. `pop` e în mii de locuitori; indicii sunt valori de model între 0 și 1.

```json
{ "id": "cluj", "name": "Cluj", "pop": 679,
  "urban": 0.67, "students": 1.0, "agriculture": 0.25, "industry": 0.55, "diaspora": 0.35 }
```

Segmentele unui județ se calculează din acești indici (`buildSegments` în `engine.mjs`),
apoi sunt normalizate ca suma să dea `pop`.

### `segments.json`

10 segmente: `pensionari_rural`, `pensionari_urban`, `tineri_urbani`, `studenti`,
`muncitori`, `agricultori`, `antreprenori`, `bugetari`, `someri`, `diaspora`.
Fiecare are `name`, `blurb`, `color`.

### `parties.json`

```json
{ "id": "psd", "name": "PSD", "fullName": "...", "color": "#d81e2c",
  "leader": "grindeanu", "strength": 1.22,
  "affinity": { "pensionari_rural": 0.9, "...": 0.3 },
  "bias": { "olt": 1.35, "dolj": 1.3 } }
```

Votul unui partid într-un județ = Σ(segment × affinity × segBoost) × strength × bias ×
mood × (1 + countyBoost).

### `politicians.json`

```json
{ "id": "ciolacu", "name": "Marcel Ciolacu", "party": "psd", "role": "...",
  "stats": { "charisma": 62, "patience": 38, "malleability": 74, "gaffes": 46,
             "visibility": 82, "corruption": 44, "traseism": 40 },
  "ability": { "name": "...", "text": "...", "effect": { "segment": 1.25 } },
  "facts": { "real": ["..."], "fake": ["..."] },
  "look": { "hair": "short", "hairColor": "#2b2623", "skin": "#e8b896",
            "glasses": false, "facial": "none", "suit": "#23324d", "tie": "#b3261e" } }
```

33 de profiluri. `party: null` = independent sau din afara jocului (Nicușor Dan, Iohannis,
Niculescu, Georgescu, Ponta etc.). Abilitatea liderului amplifică acțiunile pe segmentele din
`effect`; ceilalți membri ai partidului adaugă o treime din abilitatea lor.

`look` desenează portretul caricatural (`public/portraits.mjs`): `hair` (short, side, bald,
long, bob, bun, curly), `facial` (none, mustache, stubble, beard), culori hex.

Fiecare fapt `real` trebuie să poată fi verificat; datele curente (liderii partidelor,
premierul) se verifică din nou când se schimbă scena politică.

### `events.json`

```json
{ "id": "austeritate-invatamant", "title": "...", "text": "...",
  "weight": 7, "minDay": 10,
  "effects": {
    "segments": { "tineri_urbani": -0.05 },
    "convert": [{ "from": "studenti", "to": "diaspora", "share": 0.22 }],
    "party": { "usr": 0.02 },
    "countyParty": { "sibiu": { "pnl": 0.22 } },
    "funds": { "psd": -60 },
    "politician": { "id": "grindeanu", "stat": "gaffes", "delta": 6 } } }
```

Efectele `segments` și `convert` se aplică tuturor județelor; `convert` mută votanți fără
să schimbe populația. `weight` e probabilitatea relativă; `minDay` întârzie evenimentul; un
eveniment nu se repetă în ultimele 14.

**Efecte locale** (`county`): doar județele numite se schimbă, cu `segments`, `convert` și
`party` propriu (Valea Jiului: muncitori → șomeri doar în Hunedoara).

```json
"county": { "hunedoara": { "convert": [{ "from": "muncitori", "to": "someri", "share": 0.1 }],
                           "party": { "psd": -0.08 } } }
```

**Lanțuri** (`after`): `"after": "diploma-avion"` face din eveniment o urmare. Apare doar în
cel mult 45 de zile după cauză și are de patru ori mai multe șanse.

**Decizii** (`choices`): evenimentul cere un răspuns de la fiecare jucător. Fiecare alegere
are `label`, `hint` (ce vede jucătorul), `text` (rezultatul), `cost` opțional și `effects`.
`ignore` se aplică dacă decizia expiră (implicit 8 zile, `expires`). În `choices[].effects`,
`self` înseamnă partidul care a ales și se pot folosi `segBoost` (preferința partidului pentru
un segment), `party`, `county` și `funds`.

```json
{ "id": "d-donatie-afacerist", "choices": [
  { "label": "Accepți donația", "hint": "+120 fonduri · imaginea suferă",
    "text": "...", "effects": { "funds": { "self": 120 }, "party": { "self": -0.025 } } } ] }
```

### `laws.json`

```json
{ "id": "austeritate", "name": "...", "text": "...", "capital": 35,
  "effects": { "segments": { "bugetari": -0.06 },
               "funds": { "self": 110 },
               "countyBoostAll": 0.06 } }
```

`self` = partidul care promulgă. `countyBoostAll` dă boost în toate județele.

### `romania-map.json`

Generat de `tools/build-map.mjs`. `viewBox` + 42 de `{ id, name, d }` (path SVG).

## Starea jocului

`createGame` produce o stare serializabilă:

```
day, speed, electionDay, resultUntil, rng,
config, counties{ id: { pop, segments, boost } },
parties{ id: { funds, capital, boost, segBoost, cooldown, seats, share, gov } },
politicians{ id: { stats, ability, facts } },
mood{ id }, coalitions[], offers[], humans[], active, lastResult, recentEvents[], log[],
fired{ eventId: day }, decisions[ { id, party, eventId, expires } ], nextDecision
```

`speed: 0` înseamnă pauză. Clientul (solo) și serverul (camere) nu mai apelează `tick` cât
timp viteza e 0.

`tick(state, data, days)` avansează ceasul: decay, venit, tururi AI, evenimente, alegeri.
`snapshot(state, data)` e ce primește UI-ul (include sondajul calculat).

## Fluxul unei acțiuni

1. UI (solo) sau POST `/api/rooms/:cod/action` (multiplayer).
2. `applyAction` validează cooldown, fonduri, țintă, guvern.
3. Se scad fondurile, se setează cooldown, se aplică boost-uri pe județ/segmente.
4. `snapshot` → randare hartă, panel, ticker.

## Fluxul unei decizii

1. `fireEvent` pe un eveniment cu `choices` creează câte o decizie pentru fiecare partid
   uman (`state.decisions`).
2. `snapshot` le trimite cu etichetele alegerilor (nu și cu efectele).
3. UI arată dock-ul „DECIZIE”; click → `decide` (solo) sau POST `/api/rooms/:cod/decide`.
4. Alegerea aplică efectele pentru acel partid și scoate decizia. Dacă expiră, se aplică
   `ignore`.
