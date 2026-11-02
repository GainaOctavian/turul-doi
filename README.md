# Turul Doi

Un joc de browser, satiric dar ancorat în realitate, despre guvernarea României. Alegi un
scenariu (2017 sau 2026), un partid și un rol: la guvernare sau în opoziție. Aprobi bugetul în
milioane de euro, schimbi taxe, adopți politici, numești miniștri, urmărești deficitul,
datoria, ratingul și indicatorii țării față de media UE, iar la alegeri votanții judecă ce au
simțit. Harta cu cele 42 de unități administrativ-teritoriale rămâne câmpul de luptă electoral.

Satiră, nu știri. Personajele sunt reale; faptele marcate „satiră” sunt inventate și
intenționat absurde. Jocul nu conține acuzații reale și nu e o sursă de informare. Guvernele,
rezultatele din 2016 și listele de miniștri din scenarii sunt reale; sondajele de start din
2026, economia și bugetul sunt estimări de joc.

## Pornire

Ai nevoie doar de Node 20+.

```bash
npm start          # http://127.0.0.1:4173
npm test           # teste pe motor, pe date și pe ctl
```

Fără build step, fără dependențe npm. Serverul e scris pe `node:http`.

### Multiplayer

Un jucător creează o cameră (cod de 4 litere) pentru un scenariu și alege un partid; ceilalți
intră cu codul și își aleg partidele rămase (scenariul se vede automat). Fiecare joacă de pe
calculatorul lui; serverul ține ceasul și trimite starea prin Server-Sent Events. Pauza
oprește ceasul pentru toți. Pentru joc în rețea, pornește serverul pe o mașină și deschide
`http://<ip-ul-lui>:4173` de pe celelalte. Implicit ascultă doar pe `127.0.0.1`.

## Cum se joacă

Interfața are cinci secțiuni, fiecare cu culoarea ei:

- **Politică** (albastru): harta influenței, județe (inclusiv București, cu marker propriu),
  campanie, sondaj și coaliții, echipa de politicieni cu portrete.
- **Guvern** (verde): prezentare (premier, încredere, rating, deficit, majoritate), buget,
  politici, cabinet, propuneri.
- **Țara** (galben): indicatori economici, sociali, de servicii și de infrastructură, plus
  standardul de viață pe segmente de votanți.
- **Lume** (violet): comparații cu media UE și cu nouă țări simulate, tabel, evenimente externe.
- **Știri** (roșu): jurnalul evenimentelor, filtrat pe guvern, lume și politică.

Reguli în pași mari:

- **Ceas**: o zi de joc la fiecare 2 secunde, viteze 1x/2x/4x, pauză (buton sau Space).
- **Buget**: venituri și cheltuieli în M€. Cheltuielile se mută treptat spre ținta aleasă;
  taxele se simt în venituri, prețuri și creștere. Sub 18 de încredere, guvernul cade.
- **Cine decide**: o pârghie (o linie de buget, o taxă, o politică) aparține ministerului care
  o controlează, deci partidului care îl conduce. Ceilalți din guvern trimit o propunere.
  Opoziția depune moțiuni. Partidul premierului poate face remanieri.
- **Piețe**: deficitul și datoria mută ratingul (BBB- e ultima treaptă investițională) și
  costul împrumuturilor.
- **Standardul de viață (SoL)**: fiecare segment își măsoară viața (salarii, pensii, prețuri,
  servicii, taxe…) față de așteptări. Peste așteptări, câștigă partidele de la guvernare.
- **Campanie și decizii**: acțiuni de campanie în județe, decizii cu răspuns în câteva zile,
  evenimente satirice cu urmări și efecte locale.
- **Alegeri**: la data fixă (la 4 ani), prin D'Hondt național cu prag de 5%; după alegeri,
  negocieri de coaliție și ministere împărțite proporțional.

Parametri de URL pentru teste: `?scenario=2017&party=psd&day=40&event=d-greva-medici`.

## Structură

```
shared/engine.mjs      partide, sondaj, alegeri, evenimente, campanie, snapshot
shared/gov.mjs         buget, taxe, indicatori, SoL, cabinet, propuneri, AI de guvernare
shared/world.mjs       ciclul global, media UE și țările din comparație
shared/ctl.mjs         limbajul de comenzi al ctl-ului
shared/data-files.mjs  lista fișierelor de date
server.mjs             fișiere statice, camere SSE, endpoint /ctl
bin/turul-doi-ctl.mjs  CLI-ul de control
public/                UI fără framework (app, dash, kit, portraits)
data/                  tot conținutul editabil
tools/                 build-map.mjs (harta), sim.mjs (simulare de reglaj)
tests/                 teste fără dependențe
docs/                  model de date și arhitectură
```

Motorul rulează identic în browser (solo) și pe server (multiplayer).

## Control din terminal

Fiecare aplicație are un `ctl`: un limbaj simplu de comenzi peste comenzile jocului.

```bash
npm run start:ctl                      # pornește serverul cu endpoint-ul /ctl activ
npm run ctl -- "scenario 2017"
npm run ctl -- "play psd"
npm run ctl -- "budget"
npm run ctl -- "tax vat 21"
npm run ctl -- "policy indexare-pensii"
npm run ctl -- "month 6"
npm run ctl -- metrics
npm run ctl -- "world growth"
npm run ctl -- help
```

Endpoint-ul `/ctl` ascultă doar pe `127.0.0.1` și cere un token scris în `.turul-doi/ctl.json`.

## Datele de joc

Tot conținutul stă în `data/*.json` și se poate edita fără să atingi codul:

| Fișier | Ce conține |
| --- | --- |
| `scenarios.json` | scenariile 2017 și 2026: guvern, parlament, economie, buget de start |
| `government.json` | ministere, linii de buget, taxe, indicatori, ponderile SoL, rating |
| `policies.json` | 31 de politici cu efecte pe buget, segmente și indicatori |
| `countries.json` | UE și nouă țări (valori de start, evenimente externe) |
| `parties.json` | 9 partide: afinități, bias pe județe, `lean`, `oppGain` |
| `politicians.json` | 63 de profiluri (reale + fapte satirice), pe scenarii, cu portret |
| `events.json` | ~130 de evenimente: naționale, sezoniere, pe județe, lanțuri, decizii |
| `segments.json`, `counties.json`, `config.json` | segmente de votanți, județe, parametri |
| `romania-map.json` | harta (generată de `tools/build-map.mjs`) |

Modelul complet e în `docs/data-model.md`.

## Reguli de satiră

- Faptele marcate `real` trebuie să fie verificabile; datele despre scena politică se
  actualizează când se schimbă guvernele sau conducerea partidelor.
- Faptele marcate `fake` sunt inventate și intenționat absurde. Niciodată despre viața
  privată, copii, boli sau acuzații penale plauzibile.
- Statisticile (corupție, traseism, maleabilitate) sunt valori de joc, nu evaluări ale
  persoanelor reale.
- Valorile pentru țările din comparație sunt orientative, nu date oficiale.

## Harta

Contururile județelor vin din [geoBoundaries](https://www.geoboundaries.org/) ROU ADM1
(CC BY 4.0, World Bank). `tools/build-map.mjs` le proiectează și le simplifică în
`data/romania-map.json`. Populațiile și indicii de model din `data/counties.json` sunt
aproximări ale recensământului din 2021, nu date oficiale.

## Licență

Codul: vezi `LICENSE`. Harta: geoBoundaries, CC BY 4.0.
