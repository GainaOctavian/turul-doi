# Turul Doi

Un joc de browser, satiric dar ancorat în realitate, despre guvernarea României. Alegi un
scenariu (2017 sau 2026), un partid și un rol: la guvernare sau în opoziție. Aprobi bugetul în
milioane de euro, schimbi taxe, adopți politici, numești miniștri, urmărești deficitul,
datoria, ratingul și indicatorii țării față de media UE, iar la alegeri votanții judecă ce au
simțit. Harta cu cele 42 de unități administrativ-teritoriale rămâne câmpul de luptă electoral.

Jocul amestecă fapte verificabile cu umor și nu e o sursă de informare. Guvernele,
rezultatele din 2016 și 2024 și listele de miniștri din scenarii sunt reale; sondajele de start
din 2026, economia și bugetul sunt estimări de joc. Statisticile politicienilor sunt valori de
joc, nu evaluări ale persoanelor.

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

Interfața are șapte secțiuni, fiecare cu culoarea ei:

- **Politică** (albastru): harta influenței, județe (inclusiv București, cu marker propriu),
  campanie, sondaj și coaliții, echipa de politicieni cu portrete.
- **Parlament** (cyan): legi în dezbatere și voturi, catalogul de legi pe care le poți depune
  (și din opoziție), moțiuni de cenzură, negocieri de culise și relațiile cu fiecare partid.
- **Partid** (roz): profilul partidului (categorii de interes și direcție, pe care le poți
  muta), coeziune, oamenii partidului, fuziuni, absorbții și plecări din partid.
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
  știri cu urmări și efecte locale (peste 290, fără repetări până se termină toate cele potrivite momentului).
- **Alegeri**: la data fixă (la 4 ani), prin D'Hondt național cu prag de 5%; după alegeri,
  negocieri de coaliție și ministere împărțite proporțional.
- **Partide mici**: pe lângă partidele din Parlament poți juca formațiuni care au candidat și au
  rămas sub prag (2017: PRU, PRM, PER; 2026: SENS, Forța Dreptei, REPER, PSD Unit, DREPT; rezultatele
  din 2016 și 2024 sunt reale). Fără mandate, jocul tău e drumul spre Parlament: campanie, decizii și
  fuziuni. Fiecare partid candidează singur: 5% pe țară sau 20% în patru județe. Unde nu s-a găsit
  un lider verificat, partidul apare cu „conducere colectivă”.
- **Parlament**: orice partid cu mandate poate depune o lege (8 capital politic), la guvernare
  sau în opoziție, și votează legile altora. Votul din plen depinde de programul partidului, de
  relația cu inițiatorul și de înțelegerile din culise: servicii (capital), „sprijin logistic”
  (M€, cu risc de scandal) și schimburi de voturi. Moțiunea de cenzură e tot un vot (166).
  Capitalul politic și relațiile cu fiecare partid (care cresc din coaliții, sprijin, legi
  votate împreună și schimburi de voturi) fac negocierile mai ieftine.
- **Fuziuni și plecări**: nu există alianțe cu prag. Parlamentarii de pe lista ta rămân ai
  tăi, dar poți propune o fuziune (un nume nou, de exemplu SENS-DREPT) sau o absorbție; după ea
  joci mai departe cu noul grup. Oamenii pot pleca oricând să formeze alte grupări (istorice
  precum PDL din PNL sau PLUS din USR, ori noi). La formarea guvernului, fiecare partid își
  alege singur oamenii pentru ministerele lui, gratuit, în primele 10 zile.

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
| `parties.json` | 17 partide, parlamentare și extraparlamentare: afinități, bias pe județe, `lean`, `oppGain` |
| `politicians.json` | 65 de profiluri cu fapte verificabile (inclusiv cazuri publice cunoscute), pe scenarii, cu portret |
| `events.json` | ~290 de evenimente: naționale, sezoniere, pe județe, lanțuri, decizii (`tools/news-pool.mjs` a generat mare parte) |
| `bills.json` | 57 de legi care pot fi depuse și votate (cele mai multe cu act-sursă verificat): poziție, categorii afectate, efecte |
| `law-sources.json` | actele reale citate de legi (cu link la legislatie.just.ro) și actele abrogate care nu trebuie folosite |
| `splinters.json` | modele istorice de grupări care se desprind (PDL, PLUS, UNPR, PRO, PC) |
| `segments.json`, `counties.json`, `config.json` | segmente de votanți, județe, parametri |
| `romania-map.json` | harta (generată de `tools/build-map.mjs`) |

Modelul complet e în `docs/data-model.md`.

## Reguli pentru conținut

- Faptele despre persoane trebuie să fie verificabile (căutare pe web) și să țină de viața
  publică: funcții, hotărâri, dosare cunoscute. Nu se inventează acuzații.
- Statisticile (corupție, traseism, maleabilitate) sunt valori de joc, nu evaluări ale
  persoanelor reale.
- Umorul e dozat: știrile sunt în general sobre, cu ironie ușoară, nu glume la fiecare rând.
- Valorile pentru țările din comparație sunt orientative, nu date oficiale.

## Harta

Contururile județelor vin din [geoBoundaries](https://www.geoboundaries.org/) ROU ADM1
(CC BY 4.0, World Bank). `tools/build-map.mjs` le proiectează și le simplifică în
`data/romania-map.json`. Populațiile și indicii de model din `data/counties.json` sunt
aproximări ale recensământului din 2021, nu date oficiale.

## Licență

Codul: vezi `LICENSE`. Harta: geoBoundaries, CC BY 4.0.
