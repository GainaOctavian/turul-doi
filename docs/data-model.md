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
  "leader": "ciolacu", "strength": 1.22,
  "affinity": { "pensionari_rural": 0.9, "...": 0.3 },
  "bias": { "olt": 1.35, "dolj": 1.3 } }
```

Votul unui partid într-un județ = Σ(segment × affinity × segBoost) × strength × bias ×
mood × (1 + countyBoost).

### `politicians.json`

```json
{ "id": "ciolacu", "name": "Marcel Ciolacu", "party": "psd", "role": "...",
  "stats": { "charisma": 62, "patience": 38, "malleability": 74, "gaffes": 46,
             "visibility": 82, "corruption": 64, "traseism": 58 },
  "ability": { "name": "...", "text": "...", "effect": { "segment": 1.25 } },
  "facts": { "real": ["..."], "fake": ["..."] } }
```

`party: null` = independent (Nicușor Dan, Iohannis, Geoană). Abilitatea liderului
amplifică acțiunile pe segmentele din `effect`.

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

Efectele se aplică tuturor județelor. `convert` mută votanți fără să schimbe populația.
`weight` e probabilitatea relativă; `minDay` întârzie evenimentul; un eveniment nu se repetă
în ultimele 14.

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
mood{ id }, coalitions[], offers[], humans[], active, lastResult, recentEvents[], log[]
```

`tick(state, data, days)` avansează ceasul: decay, venit, tururi AI, evenimente, alegeri.
`snapshot(state, data)` e ce primește UI-ul (include sondajul calculat).

## Fluxul unei acțiuni

1. UI (solo) sau POST `/api/rooms/:cod/action` (multiplayer).
2. `applyAction` validează cooldown, fonduri, țintă, guvern.
3. Se scad fondurile, se setează cooldown, se aplică boost-uri pe județ/segmente.
4. `snapshot` → randare hartă, panel, ticker.
