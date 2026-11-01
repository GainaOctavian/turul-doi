# Turul Doi

Un joc de browser, satiric, despre politica românească. Câștigi România județ cu județ:
hartă de influență pe toate cele 42 de unități administrativ-teritoriale, segmente de votanți
care își schimbă mărimea în timp, politicieni reali cu profiluri de joc și un ceas în timp
real, nu ture.

Satiră, nu știri. Personajele sunt reale; statisticile și faptele marcate „satiră” sunt
inventate și intenționat absurde. Jocul nu conține acuzații reale și nu e o sursă de
informare.

## Pornire

Ai nevoie doar de Node 20+.

```bash
npm start          # http://127.0.0.1:4173
npm test           # teste pe motorul de joc
```

Fără build step, fără dependențe npm. Serverul e scris pe `node:http`.

### Multiplayer

Un jucător creează o cameră (cod de 4 litere) și alege un partid; ceilalți intră cu codul
și își aleg partidele rămase. Fiecare joacă de pe calculatorul lui. Serverul ține ceasul și
trimite starea prin Server-Sent Events, deci nu e nevoie de WebSocket sau de porturi
suplimentare.

Pentru joc pe mai multe calculatoare, pornește serverul pe o mașină din rețea și deschide
`http://<ip-ul-lui>:4173` de pe celelalte. Implicit ascultă doar pe `127.0.0.1`.

## Cum se joacă

- **Ceas**: o zi de joc la fiecare 2 secunde, viteză 1x/2x/4x. Butonul „Pauză” (sau tasta
  Space) oprește ceasul; în multiplayer se oprește pentru toți din cameră. Campania durează
  120 de zile, apoi urmează alegeri și un nou ciclu.
- **Decizii**: unele evenimente îți cer un răspuns în câteva zile (susții greva? accepți
  donația?). Fiecare alegere mută alte segmente. Dacă nu răspunzi, decizia expiră.
- **Echipa**: fiecare partid are mai mulți politicieni, cu portret caricatural, statistici și
  fapte reale/satirice. Liderul contează integral în campanie, ceilalți adaugă o treime.
- **Hartă**: fiecare județ e colorat de partidul care conduce acolo. Click pe județ pentru
  segmentele de votanți și acțiunile locale.
- **Acțiuni**: miting, apariție TV, campanie online, înțelegere locală, atac la adversar,
  promisiune electorală. Costă fonduri și au cooldown.
- **Legi**: doar partidul de guvernământ promulgă legi, plătind cu capital politic. Legile
  mișcă imediat segmentele de votanți.
- **Evenimente**: știri satirice care schimbă segmente, partide și județe. Unele mută
  votanți dintr-un segment în altul (austeritate în învățământ → studenți pleacă → diaspora
  crește), păstrând populația județului constantă.
- **Alegeri**: la ziua 120, mandatul se împarte la nivel național (D'Hondt, prag 5%) între
  330 de locuri. Coalițiile care trec de 166 de mandate formează guvernul.

## Structură

```
shared/engine.mjs      motorul pur: stare JSON, tick, acțiuni, sondaj, alegeri
shared/ctl.mjs         limbajul de comenzi al ctl-ului, peste motor
server.mjs             fișiere statice, camere SSE, endpoint /ctl
bin/turul-doi-ctl.mjs  CLI-ul de control
public/                UI fără framework (index.html, style.css, app.mjs)
data/                  tot conținutul editabil (județe, segmente, partide, evenimente, legi)
tools/build-map.mjs    regenerează harta din geoBoundaries
tests/                 teste pe motor, fără dependențe
docs/                  arhitectură și model de date
```

Motorul rulează identic în browser (solo) și pe server (multiplayer): aceeași funcție
`tick`, aceeași stare serializabilă.

## Control din terminal

Fiecare aplicație are un `ctl`: un limbaj simplu de comenzi peste comenzile jocului, ca să
poți verifica și conduce o partidă dintr-un script.

```bash
npm run start:ctl            # pornește serverul cu endpoint-ul /ctl activ
npm run ctl -- state
npm run ctl -- play psd
npm run ctl -- "act rally cluj"
npm run ctl -- "tick 30"
npm run ctl -- parties
npm run ctl -- help
```

Endpoint-ul `/ctl` ascultă doar pe `127.0.0.1` și cere un token scris în
`.turul-doi/ctl.json` la pornire.

## Harta

Contururile județelor vin din [geoBoundaries](https://www.geoboundaries.org/) ROU ADM1
(CC BY 4.0, World Bank). `tools/build-map.mjs` le proiectează și le simplifică în
`data/romania-map.json`. Populațiile și indicii de model din `data/counties.json` sunt
aproximări ale recensământului din 2021, nu date oficiale.

## Datele de joc

Tot conținutul stă în `data/*.json` și se poate edita fără să atingi codul:

| Fișier | Ce conține |
| --- | --- |
| `config.json` | durata campaniei, numărul de mandate, fonduri de start, ritmul ceasului |
| `counties.json` | cele 42 de județe, populație și indici (urban, studenți, agricultură, industrie, diaspora) |
| `segments.json` | cele 10 segmente de votanți |
| `parties.json` | partide, lideri, afinități pe segmente, bias pe județe |
| `politicians.json` | profiluri, statistici de joc, abilități, fapte reale și satirice |
| `events.json` | ~110 evenimente: naționale, pe județe, lanțuri cauză→efect și decizii |
| `laws.json` | 24 de legi disponibile guvernului |

Modelul complet (efecte, lanțuri, decizii) e în `docs/data-model.md`. Datele despre scena
politică (liderii partidelor, premierul) sunt verificate la noiembrie 2026; când se schimbă,
se actualizează `parties.json` și `politicians.json`.

## Aspect

Interfața e gândită ca o seară electorală de televiziune: albastru intens, bandă roșie
„LIVE” derulantă cu ultimele știri, hartă ca un zid de studio. Portretele din tabul „Echipă”
sunt desenate în cod (`public/portraits.mjs`) din câmpul `look` al fiecărui politician.

## Reguli de satiră

- Faptele marcate `real` trebuie să fie verificabile.
- Faptele marcate `fake` sunt inventate și intenționat absurde. Niciodată despre viața
  privată, copii, boli sau acuzații penale plauzibile.
- Statisticile (corupție, traseism, maleabilitate) sunt valori de joc, nu evaluări ale
  persoanelor reale.

## Licență

Codul: vezi `LICENSE`. Harta: geoBoundaries, CC BY 4.0.
