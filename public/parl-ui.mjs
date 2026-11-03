// Parliament and Party screens: votes, laws, backroom deals, relations, the
// party profile, mergers and splits. Same shape as dash.mjs: (S) => html.
import * as K from "/kit.mjs";

const { esc, fmt, share, badge, section, bar } = K;
const pct = (v) => `${((v ?? 0) * 100).toFixed(1)}%`;
const num = (n) => fmt(n);

const P = (S) => S.snap.parl;
const pdef = (S, id) => S.partyById[id];
const pname = (S, id) => pdef(S, id)?.name ?? String(id ?? "").toUpperCase();
const pcolor = (S, id) => pdef(S, id)?.color ?? "#7a879b";
const pbadge = (S, id) => badge(pname(S, id), pcolor(S, id));
const seats = (S, id) => S.snap.parties[id]?.seats ?? 0;
const me = (S) => S.snap.parties[S.party];
const segName = (S, id) => S.data.segments.segments.find((s) => s.id === id)?.name ?? id;
const inGov = (S, id) => S.snap.gov.gov.coalition.includes(id);

const STANCE = (v) => (v > 0.1 ? ["pentru", "#2fbf8a"] : v < -0.1 ? ["contra", "#ff4d6d"] : ["indecis", "#ffb02e"]);

// Same price formula as the engine's lobbyPrice(), from the relation in the snapshot.
const price = (rel) => ({ capital: Math.round(3 + (100 - rel) / 12), money: Math.round((0.5 + (100 - rel) / 50) * 10) / 10 });

const leanLabel = (v) =>
  v < -0.45 ? "liberal, de piață" : v < -0.15 ? "centru-dreapta" : v <= 0.15 ? "centru" : v <= 0.45 ? "centru-stânga" : "intervenționist, social";

/* ------------------------------------------------------------------ votes */

function forecast(S, b) {
  let yes = 0;
  let no = 0;
  for (const [p, v] of Object.entries(b.stance)) {
    const choice = b.votes[p] ?? (v > 0.1 ? "yes" : v < -0.1 ? "no" : "abstain");
    if (choice === "yes") yes += seats(S, p);
    else if (choice === "no") no += seats(S, p);
  }
  return { yes, no };
}

function voteCard(S, b) {
  const s = S.snap;
  const mine = b.votes[S.party];
  const f = forecast(S, b);
  const need = b.kind === "motion" ? `${P(S).needed} pentru ca guvernul să cadă` : "majoritate simplă";
  const myRel = P(S).rel[S.party] ?? {};
  const chips = Object.entries(b.stance)
    .sort((a, c) => seats(S, c[0]) - seats(S, a[0]))
    .map(([p, v]) => {
      const [label, col] = STANCE(v);
      const pledged = b.pledged.includes(p) ? " · angajat" : "";
      return `<span class="chip st" style="--tc:${col}" title="Înclinație ${v}"><span class="dot" style="--pc:${pcolor(S, p)}"></span>${esc(pname(S, p))} ${seats(S, p)} <em>${label}${pledged}</em></span>`;
    })
    .join("");
  const targets = Object.keys(b.stance).filter((p) => p !== S.party);
  const lobbyBox =
    targets.length && seats(S, S.party) > 0
      ? `<div class="lobby">
      <div class="lobby-h">Negocieri de culise</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="lt-${b.id}" class="sel">${targets.map((p) => `<option value="${p}">${esc(pname(S, p))} · relație ${Math.round(myRel[p] ?? 50)}</option>`).join("")}</select>
        <select id="lg-${b.id}" class="sel"><option value="">Pentru legea asta</option><option value="against">Împotriva legii</option></select>
        <select id="lh-${b.id}" class="sel">
          <option value="favor">Serviciu (capital politic)</option>
          <option value="money">Sprijin logistic (M€, risc de scandal)</option>
          <option value="swap">Schimb de voturi (votezi legea lor)</option>
        </select>
        <button class="btn2 primary2" data-do="parl-lobby" data-id="${b.id}">Negociază</button>
      </div>
      <small class="muted">Cu cât relația e mai bună, cu atât negocierea costă mai puțin. Sub 15 nu mai vorbesc cu tine.</small>
    </div>`
      : "";
  return `<div class="vote-card ${b.kind}">
    <div class="row between"><b>${esc(b.title)}</b><span class="muted">votul în ziua ${b.vote} (${Math.max(0, b.vote - s.day)} zile)</span></div>
    <div class="row" style="gap:6px;margin:4px 0">${b.kind === "motion" ? badge("Moțiune", "#ff4d6d") : badge("Lege", "#4cc9f0")} inițiator ${pbadge(S, b.from)}</div>
    <p class="muted" style="margin:2px 0 8px">${esc(b.text)}</p>
    <div class="row between" style="margin-bottom:6px"><span>Estimare: <b style="color:#2fbf8a">${f.yes} pentru</b> · <b style="color:#ff4d6d">${f.no} contra</b></span><span class="muted">${need}</span></div>
    ${bar(f.yes, f.yes + f.no || 1, "#2fbf8a")}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:8px 0">${chips}</div>
    ${
      seats(S, S.party) > 0
        ? `<div class="row" style="gap:8px;align-items:center"><span class="muted">Votul tău:</span>
      ${[["yes", "Pentru"], ["no", "Contra"], ["abstain", "Abținere"]].map(([v, l]) => `<button class="btn2 ${mine === v ? "primary2" : ""}" data-do="parl-vote" data-id="${b.id}" data-vote="${v}">${l}</button>`).join("")}
      ${mine ? "" : `<small class="muted">Dacă nu votezi, partidul urmează linia lui.</small>`}</div>
      ${b.kind === "law" ? amendBox(S, b) : ""}`
        : `<p class="hint">Partidul tău nu are mandate: urmărești votul din tribune.</p>`
    }
    ${lobbyBox}
  </div>`;
}

// What an amendment changes, in words: segments that gain (+) or lose (-) and other effects.
function amendEffects(S, fx) {
  const parts = Object.entries(fx.sol ?? {}).map(([id, v]) => `${v > 0 ? "▲" : "▼"} ${esc(segName(S, id))}`);
  const label = { growth: "creștere", inflation: "inflație", unemployment: "șomaj" };
  for (const [k, v] of Object.entries(fx.macro ?? {})) parts.push(`${v > 0 ? "▲" : "▼"} ${label[k] ?? k}`);
  for (const [k, v] of Object.entries(fx.budget ?? {})) parts.push(`${v > 0 ? "▲" : "▼"} cheltuieli ${esc(k)}`);
  for (const [k, v] of Object.entries(fx.metric ?? {})) parts.push(`${v > 0 ? "▲" : "▼"} ${esc(k)}`);
  return parts.join(" · ");
}

// Concrete amendments to an open law: pick one (3 capital) before the vote.
function amendBox(S, b) {
  const mine = b.amended?.[S.party];
  const taken = Object.values(b.amended ?? {});
  const rows = (b.options ?? [])
    .map((o) => {
      const done = taken.includes(o.id);
      return `<div class="row between" style="gap:8px;padding:4px 0"><div style="min-width:0"><b>${esc(o.label)}</b>${done ? ` ${badge("adoptat", "#2fbf8a")}` : ""}<div class="muted" style="font-size:12px">${esc(o.text)}</div><div style="font-size:12px">${amendEffects(S, o.effects)}</div></div><button class="btn2" data-do="parl-amend" data-id="${b.id}" data-option="${o.id}" ${mine || done ? "disabled" : ""}>3 cap.</button></div>`;
    })
    .join("");
  return `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer">Amendamente${mine ? " (ai depus unul)" : ""}</summary>${rows}</details>`;
}

// Cotroceni: who is president, the candidacies, partners' backing and laws waiting for a decision.
export function presView(S) {
  const p = S.snap.pres;
  const party = me(S);
  const pres = p.president;
  const presName = pres.name ?? "fără nume";
  const presParty = pres.party ? pbadge(S, pres.party) : badge("independent", "#8d99ae");
  const inWindow = p.toVote > 0 && p.toVote <= 150;
  const iNominated = p.nominated.includes(S.party);
  const myShare = p.candidates.find((c) => c.party === S.party)?.share ?? 0;
  const canRun = inWindow && !iNominated && myShare >= 0.02 && party.capital >= 15 && party.funds >= 1.5;
  const backing = Object.entries(p.backing).map(([c, list]) => `${list.map((x) => pname(S, x)).join(", ")} → ${pname(S, c)}`);
  const iBacking = Object.values(p.backing).some((l) => l.includes(S.party));
  const canBack = p.toVote > 0 && p.toVote <= 120 && !iNominated && !iBacking && party.capital >= 5;
  const cands = p.candidates
    .map((c) => `<div class="row between" style="padding:4px 0"><span>${pbadge(S, c.party)} ${esc(c.name)} ${c.nominated ? badge("candidat", "#2fbf8a") : ""}</span><span class="muted">${pct(c.share)} în sondaj</span></div>`)
    .join("");
  const backBtns = p.nominated
    .filter((c) => c !== S.party)
    .map((c) => `<button class="btn2" data-do="pres-back" data-target="${c}" ${canBack ? "" : "disabled"}>Susține ${esc(pname(S, c))} (5 cap.)</button>`)
    .join(" ");
  const pending = p.pending
    .map((x) => {
      const canCcr = x.from !== S.party && (party.seats ?? 0) >= 15 && party.capital >= 5;
      return `<div class="row between" style="padding:5px 0;gap:8px"><span>${esc(x.title)} ${pbadge(S, x.from)}</span>${canCcr ? `<button class="btn2" data-do="ccr" data-id="${x.id}">Sesizează CCR (5 cap.)</button>` : badge(`până în ziua ${x.deadline}`, "#8d99ae")}</div>`;
    })
    .join("");
  const last = p.lastResult ? `Ultimele alegeri: ${pname(S, p.lastResult.winner)} (${p.lastResult.round === 1 ? "turul întâi" : "turul doi"}).` : "";
  return `${section("La Cotroceni", `
    <div class="row between" style="margin-bottom:8px"><span><b>${esc(presName)}</b> ${presParty}</span><span class="muted">${p.toVote > 0 ? `alegeri în ${num(p.toVote)} zile` : "alegerile sunt acum"}</span></div>
    <p class="muted" style="font-size:12px;margin:0 0 10px">${esc(pres.role ?? "")} ${last}</p>
    ${cands ? `<div style="margin-bottom:8px">${cands}</div>` : ""}
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn2 primary2" data-do="pres-run" ${canRun ? "" : "disabled"}>Depune candidatura (15 cap., 1,5 M€)</button>
      ${backBtns}
    </div>
    ${backing.length ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Sprijin: ${backing.map(esc).join(" · ")}</p>` : ""}
    ${pending ? `<div style="margin-top:10px">${pending}</div>` : ""}
  `, { sub: "Președintele promulgă legile, le poate retrimite în Parlament sau poate sesiza Curtea Constituțională. La o candidatură trebuie 2% în sondaje; partenerii pot da sprijin doar dacă relația e bună și programele apropiate." })}`;
}

// Offers from other parties for a vote, and the MPs you can recruit.
function courtView(S) {
  const p = P(S);
  const party = me(S);
  const offers = p.supportOffers
    .filter((o) => o.to === S.party)
    .map(
      (o) => `<div class="row between" style="gap:8px;padding:5px 0"><div style="min-width:0"><b>${esc(o.title)}</b> ${pbadge(S, o.from)}<div class="muted" style="font-size:12px">Îți oferă ${fmt(o.money)} M€ și ${o.capital} capital politic pentru votul tău. Dacă accepți, votezi pentru și nu mai poți da înapoi.</div></div><div class="row" style="gap:6px"><button class="btn2 primary2" data-do="offer" data-id="${o.id}" data-accept="1">Acceptă</button><button class="btn2" data-do="offer" data-id="${o.id}" data-accept="0">Refuză</button></div></div>`,
    )
    .join("");
  const poach = p.recruit.poach;
  const pool = p.recruit.pool;
  const cooling = (p.cool[`recruit:${S.party}`] ?? -1) > S.snap.day;
  const targets = S.snap.partyIds.filter((id) => id !== S.party && (S.snap.parties[id].seats ?? 0) >= poach.minSeats && (p.cohesion[id] ?? 72) < poach.cohesionBelow);
  const buttons = [
    `<button class="btn2 primary2" data-do="recruit" data-count="1" ${p.free > 0 && !cooling ? "" : "disabled"}>Recrutează un neafiliat (${pool.capital} cap., ${fmt(pool.money)} M€)</button>`,
    ...targets.map((id) => `<button class="btn2" data-do="recruit" data-from="${id}" data-count="1" ${cooling ? "disabled" : ""}>Atrage un parlamentar ${esc(pname(S, id))} (${poach.capital} cap., ${fmt(poach.money)} M€)</button>`),
  ].join(" ");
  return `${section("Oferte și recrutare", `
    ${offers ? `<div style="margin-bottom:10px">${offers}</div>` : `<p class="muted" style="margin:0 0 8px;font-size:12px">Nicio ofertă de sprijin acum. Partidele care depun legi pe care nu le-ai vota singur îți pot oferi bani și capital.</p>`}
    <p style="margin:0 0 8px"><b>${p.free}</b> parlamentari neafiliați · ${targets.length ? `${targets.length} partide cu grup șubred` : "niciun grup șubred de exploatat"}</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">${buttons}</div>
  `, { sub: "Parlamentarii neafiliați apar când un partid cu grup divizat pierde oameni. Un transfer de la un rival strică relația cu el și îi scade coeziunea." })}`;
}

export function votesView(S) {
  const p = P(S);
  const open = p.bills.map((b) => voteCard(S, b)).join("");
  const done = p.done.length
    ? p.done.map((d) => `<div class="row between" style="padding:4px 0"><span>${d.kind === "motion" ? badge("Moțiune", "#ff4d6d") : badge("Lege", "#4cc9f0")} ${esc(d.title)} ${pbadge(S, d.from)}</span><span class="muted">${badge(d.status === "passed" ? "adoptat" : "respins", d.status === "passed" ? "#2fbf8a" : "#8d99ae")} ${d.tally.yes}–${d.tally.no} · ziua ${d.day}</span></div>`).join("")
    : `<p class="hint">Niciun vot încă.</p>`;
  return `${presView(S)}
    ${courtView(S)}
    ${section("În dezbatere", open || `<p class="hint">Niciun vot programat. Poți depune o lege din tabul „Legi”, iar partidele AI depun și ele în fiecare lună.</p>`, { sub: "Fiecare lege și fiecare moțiune se votează în plen. Partidele votează după programul lor, relația cu inițiatorul și înțelegerile din culise." })}
    ${section("Voturi recente", done)}`;
}

/* ------------------------------------------------------------------- laws */

export function lawsView(S) {
  const p = P(S);
  const party = me(S);
  const cool = p.cool[`bill:${S.party}`] ?? -1;
  const open = p.bills.find((b) => b.from === S.party);
  const hasSeats = party.seats > 0;
  const motionWait = (S.snap.gov.budget.cool.motion ?? -1) > S.snap.day;
  const motion = !inGov(S, S.party) && hasSeats
    ? `<div class="mot"><div><b>Moțiune de cenzură</b><p>Costă ${p.costs.motion} capital politic și 1 M€. E un vot în plen (${p.needed} de voturi). Negociază înainte cu celelalte partide, din tabul „Voturi”.</p></div>
      <button class="btn2 primary2" data-do="parl-motion" ${motionWait || party.capital < p.costs.motion ? "disabled" : ""}>${motionWait ? `din ziua ${S.snap.gov.budget.cool.motion}` : "Depune moțiunea"}</button></div>`
    : "";
  const rows = p.catalog
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, "ro"))
    .map((l) => {
      const why = !hasSeats ? "fără mandate" : open ? "ai o lege în dezbatere" : cool > S.snap.day ? `din ziua ${cool}` : l.openNow ? "în dezbatere" : l.passedDay != null && S.snap.day - l.passedDay < 540 ? "adoptată recent" : party.capital < p.costs.bill ? "capital insuficient" : "";
      const interest = Object.entries(l.interest)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 4)
        .map(([seg, v]) => badge(`${v > 0 ? "+" : "−"} ${segName(S, seg)}`, v > 0 ? "#2fbf8a" : "#ff4d6d"))
        .join(" ");
      return `<div class="prop"><div><b>${esc(l.title)}</b><small>${esc(l.text)}</small>${l.source ? `<small class="muted">Sursă: <a href="${esc(l.source.portal)}" target="_blank" rel="noopener">${esc(l.source.ref)}</a>${l.source.note ? ` · ${esc(l.source.note)}` : ""} · ultima modificare ${esc(l.source.latest)}</small>` : ""}<div class="row" style="gap:5px;flex-wrap:wrap;margin-top:5px">${badge(leanLabel(l.lean), "#8d99ae")} ${interest}</div></div>
        <div class="prop-act"><button class="btn2 primary2" data-do="parl-bill" data-id="${l.id}" ${why ? "disabled" : ""} title="${esc(why)}">${why || `Depune (${p.costs.bill} cap.)`}</button></div></div>`;
    })
    .join("");
  return `${motion ? section("Moțiune", motion) : ""}
    ${section("Legi pe care le poți depune", rows, { sub: "Orice partid cu mandate poate depune legi, la guvernare sau în opoziție. O lege adoptată își produce efectele, iar inițiatorul primește capital politic." })}`;
}

/* -------------------------------------------------------------- relations */

export function relationsView(S) {
  const p = P(S);
  const mine = p.rel[S.party] ?? {};
  const rows = Object.entries(mine)
    .filter(([id]) => seats(S, id) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => {
      const pr = price(v);
      const col = v >= 65 ? "#2fbf8a" : v >= 35 ? "#ffb02e" : "#ff4d6d";
      const pact = p.pacts.some((x) => (x.a === S.party && x.b === id) || (x.b === S.party && x.a === id));
      const cool = p.cool[`court:${[S.party, id].sort().join("|")}`] ?? -1;
      const canCourt = cool <= S.snap.day && me(S).capital >= p.courtesy.capital;
      const canPact = !pact && v >= p.pactMin && me(S).capital >= p.costs.pact;
      return `<div class="rel-row"><div class="row between"><span>${pbadge(S, id)} ${pact ? badge("colaborare strânsă", "#2fbf8a") : ""} <small class="muted">${seats(S, id)} mandate · coeziune ${Math.round(p.cohesion[id] ?? 72)}</small></span><b style="color:${col}">${Math.round(v)}</b></div>
        ${bar(v, 100, col)}
        <div class="row between" style="gap:8px;flex-wrap:wrap;margin-top:4px">
          <small class="muted">Un serviciu costă ${pr.capital} capital, sprijinul logistic ${fmt(pr.money, 1)} M€${v < 15 ? " · nu mai vorbește cu tine" : ""}</small>
          <span><button class="btn2" data-do="courtesy" data-target="${id}" ${canCourt ? "" : "disabled"} title="Vizită, declarație comună: +${p.courtesy.gain} relație">Gest (${p.courtesy.capital} cap.)</button>
          ${pact ? "" : `<button class="btn2 primary2" data-do="pact" data-target="${id}" ${canPact ? "" : "disabled"} title="Pact de colaborare: cere relație ${p.pactMin}+">Pact (${p.costs.pact} cap.)</button>`}</span>
        </div></div>`;
    })
    .join("");
  return `${section("Relațiile partidului tău", rows || `<p class="hint">Nicio relație încă.</p>`, { sub: "Relația crește când sunteți în aceeași coaliție, când sprijini guvernul, când votezi legea altora sau faci schimburi de voturi, și scade când votezi împotrivă sau când un partid refuză o ofertă." })}`;
}

/* ---------------------------------------------------------------- profile */

export function profileView(S) {
  const s = S.snap;
  const def = pdef(S, S.party);
  const party = me(S);
  const p = P(S);
  const aff = def.affinity ?? {};
  const cool = p.cool[`shift:${S.party}`] ?? -1;
  const wait = cool > s.day;
  const cant = wait || party.capital < p.costs.shift;
  const cohesion = p.cohesion[S.party] ?? 72;
  const members = Object.values(s.politicians).filter((x) => x.party === S.party);
  const rows = S.data.segments.segments
    .map((seg) => ({ seg, v: aff[seg.id] ?? 0.3 }))
    .sort((a, b) => b.v - a.v)
    .map(({ seg, v }) => `<div class="seg-row"><div><div class="seg-name"><span style="color:var(--text)">${esc(seg.name)}</span><span>${Math.round(v * 100)}</span></div>${bar(v, 1, seg.color)}</div>
      <button class="btn2" data-do="shift-seg" data-seg="${seg.id}" ${cant ? "disabled" : ""} title="Mută accentul spre ${esc(seg.name)}">▲</button></div>`)
    .join("");
  const cohesionTone = cohesion < 45 ? "#ff4d6d" : cohesion < 60 ? "#ffb02e" : "#2fbf8a";
  return `<div class="grid cards">
      ${K.statCard({ label: "Capital politic", value: fmt(party.capital, 0), sub: "Se cheltuie pe legi, moțiuni, fuziuni și schimbări de direcție" })}
      ${K.statCard({ label: "Fonduri", value: fmt(party.funds, 1), unit: " M€" })}
      ${K.statCard({ label: "Coeziune", value: fmt(cohesion, 0), unit: "/100", tone: cohesion < 45 ? "bad" : cohesion >= 65 ? "good" : "", sub: cohesion < 45 ? "Oamenii pot pleca să formeze altă grupare" : "Cât de unit e partidul în vot" })}
      ${K.statCard({ label: "Direcție", value: leanLabel(def.lean ?? 0), sub: `Mandate: ${party.seats}` })}
    </div>
    ${section("Categorii de interes", rows, { sub: `Cui se adresează partidul. Un pas ▲ costă ${p.costs.shift} capital, mută 10 puncte spre categoria aleasă (restul scad puțin) și scade coeziunea. ${wait ? `Din nou posibil în ziua ${cool}.` : ""}`, right: `<span class="muted">${esc(def.fullName ?? def.name)}</span>` })}
    ${section("Direcția politică", `<div class="row" style="gap:10px;flex-wrap:wrap"><button class="btn2" data-do="shift-lean" data-dir="-1" ${cant ? "disabled" : ""}>← Mai spre piață</button><button class="btn2" data-do="shift-lean" data-dir="1" ${cant ? "disabled" : ""}>Mai social →</button></div>`, { sub: "Direcția influențează cum votează partidul și cu cine se înțelege." })}
    ${section("Oamenii partidului", members.length ? members.map((m) => `<div class="row between" style="padding:3px 0"><span>${esc(m.name)}${s.leaders[S.party] === m.id ? " " + badge("lider", pcolor(S, S.party)) : ""}</span><span class="muted">${esc(m.role ?? "")}</span></div>`).join("") : `<p class="hint">Conducere colectivă, fără profiluri individuale.</p>`)}`;
}

/* ------------------------------------------------------- mergers, splits */

export function mergersView(S) {
  const s = S.snap;
  const p = P(S);
  const party = me(S);
  const incoming = p.mergeOffers.filter((o) => o.to === S.party);
  const others = s.partyIds.filter((id) => id !== S.party);
  const mine = p.rel[S.party] ?? {};
  const splinters = p.splinters[S.party] ?? [];
  const cohesion = p.cohesion[S.party] ?? 72;
  const offers = incoming
    .map((o) => `<div class="row between" style="padding:5px 0"><span>${pbadge(S, o.from)} propune ${o.mode === "fusion" ? "o <b>fuziune</b>" : o.mode === "pact" ? "un <b>pact de colaborare</b>" : "să te <b>absoarbă</b>"}${o.name ? ` sub numele „${esc(o.name)}”` : ""}</span>
      <span><button class="btn2 primary2" data-do="merge-answer" data-from="${o.from}" data-accept="1">Acceptă</button> <button class="btn2" data-do="merge-answer" data-from="${o.from}" data-accept="0">Refuză</button></span></div>`)
    .join("");
  const form = `<div class="row" style="gap:8px;flex-wrap:wrap">
      <select id="merge-t" class="sel">${others.map((id) => `<option value="${id}">${esc(pname(S, id))} · relație ${Math.round(mine[id] ?? 50)}</option>`).join("")}</select>
      <select id="merge-m" class="sel"><option value="fusion">Fuziune (un nume nou)</option><option value="absorb">Absorbție (partidul meu rămâne)</option></select>
      <input id="merge-n" class="sel" type="text" maxlength="28" placeholder="Nume (opțional)" />
      <button class="btn2 primary2" data-do="merge-offer" ${party.capital < p.costs.merge ? "disabled" : ""}>Propune (${p.costs.merge} cap.)</button>
    </div>`;
  const split = `<div class="row" style="gap:8px;flex-wrap:wrap">
      <select id="split-f" class="sel">${[0.15, 0.25, 0.35, 0.5].map((v) => `<option value="${v}">${Math.round(v * 100)}% din oameni</option>`).join("")}</select>
      <select id="split-t" class="sel"><option value="">Grupare nouă</option>${splinters.map((t) => `<option value="${t.id}">${esc(t.name)} · ${esc(t.fullName)}</option>`).join("")}</select>
      <input id="split-n" class="sel" type="text" maxlength="24" placeholder="Nume (pentru gruparea nouă)" />
      <button class="btn2" data-do="split-go" ${party.seats < 4 || party.capital < 10 ? "disabled" : ""}>Despărțire (10 cap.)</button>
    </div>
    <small class="muted">Partea care pleacă devine un grup nou controlat de AI. ${cohesion < 45 ? "Coeziunea ta e scăzută: oamenii pot pleca oricând fără să te întrebe." : ""}</small>`;
  return `${incoming.length ? section("Oferte primite", offers) : ""}
    ${section("Fuziune sau absorbție", form, { sub: "Parlamentarii de pe lista ta rămân ai tăi, dar poți negocia să mergeți împreună. După fuziune joci mai departe cu noul grup (de exemplu SENS-DREPT). Un partid îndepărtat sau cu relație proastă refuză." })}
    ${section("Plecări din partid", split, { sub: "Oamenii pot pleca oricând să formeze alte grupări, istorice sau noi: din PNL, PDL; din USR, PLUS." })}`;
}

export const PARL_VIEWS = { votes: votesView, laws: lawsView, relations: relationsView };
export const PARTY_VIEWS = { profile: profileView, mergers: mergersView };
