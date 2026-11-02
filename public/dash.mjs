// The government, country, world and news screens. Each function takes the app
// state `S` (data + latest snapshot + UI drafts) and returns an HTML string.
import { portrait } from "/portraits.mjs";
import * as K from "/kit.mjs";

const { esc, fmt, meur, pct1, share, signed, tone, arrow, spark, bar, badge, dot, statCard, section } = K;

export const SECTIONS = [
  { id: "politica", name: "Politică", color: "#5b8dff", subs: [["county", "Județ"], ["actions", "Campanie"], ["poll", "Sondaj"], ["team", "Echipă"]] },
  { id: "guvern", name: "Guvern", color: "#2fbf8a", subs: [["overview", "Prezentare"], ["budget", "Buget"], ["policies", "Politici"], ["cabinet", "Cabinet"], ["proposals", "Propuneri"]] },
  { id: "tara", name: "Țara", color: "#ffb02e", subs: [["metrics", "Indicatori"], ["sol", "Standard de viață"]] },
  { id: "lume", name: "Lume", color: "#a77bff", subs: [["compare", "Comparații"], ["table", "Tabel"], ["events", "Evenimente"]] },
  { id: "stiri", name: "Știri", color: "#ff4d6d", subs: [["all", "Toate"], ["gov", "Guvern"], ["world", "Lume"], ["politics", "Politică"]] },
];

const G = (S) => S.snap.gov;
const pdef = (S, id) => S.partyById[id];
const pcolor = (S, id) => pdef(S, id)?.color ?? "#7a879b";
const pname = (S, id) => pdef(S, id)?.name ?? (id ? String(id).toUpperCase() : "Independent");
const partyBadge = (S, id) => (id ? badge(pname(S, id), pcolor(S, id)) : badge("Independent", "#8d99ae"));
const ministryDef = (S, id) => S.data.government.ministries.find((m) => m.id === id);
const ministryBadge = (S, id) => badge(ministryDef(S, id)?.short ?? id, ministryDef(S, id)?.color ?? "#8d99ae");

export function roleOf(S, id) {
  const gv = G(S).gov;
  if (gv.pmParty === id && gv.coalition.includes(id)) return "premier";
  if (gv.coalition.includes(id)) return "guvern";
  if (id in gv.support) return gv.support[id] ? "sprijin" : "retras";
  return "opozitie";
}

export const ROLE_LABEL = {
  premier: "Partidul premierului",
  guvern: "La guvernare",
  sprijin: "Sprijin parlamentar",
  retras: "Sprijin retras",
  opozitie: "În opoziție",
};

const ownerOf = (S, mid) => G(S).gov.ministries.find((m) => m.id === mid)?.party ?? null;

// What the player can do with something a ministry controls.
function mode(S, mid) {
  const owner = ownerOf(S, mid);
  if (owner === S.party) return "direct";
  if (G(S).gov.coalition.includes(S.party)) return "propose";
  return "none";
}

function actButton(S, mid, attrs, labels = {}) {
  const m = mode(S, mid);
  if (m === "none") return `<button class="btn2" disabled title="Doar partidele din guvern">Doar guvernul</button>`;
  const text = m === "direct" ? labels.direct ?? "Aplică" : labels.propose ?? "Propune";
  return `<button class="btn2 ${m === "direct" ? "primary2" : ""}" ${attrs}>${text}</button>`;
}

const series = (S, key) => G(S).hist?.s?.[key] ?? [];
const yearAgo = (arr) => (arr.length ? arr[Math.max(0, arr.length - 13)] : null);

/* --------------------------------------------------------------- overview */

function seatBar(S) {
  const s = S.snap;
  const gv = G(S).gov;
  const total = 330;
  const seats = (p) => s.parties[p]?.seats ?? 0;
  const supporters = Object.entries(gv.support).filter(([, on]) => on).map(([p]) => p);
  const parts = [];
  for (const p of gv.coalition) parts.push({ w: seats(p), c: pcolor(S, p), t: `${pname(S, p)} ${seats(p)}` });
  for (const p of supporters) parts.push({ w: seats(p), c: pcolor(S, p), t: `${pname(S, p)} (sprijin) ${seats(p)}`, hatch: true });
  parts.push({ w: s.minoritySeats, c: "#8d99ae", t: `Minorități ${s.minoritySeats}`, hatch: true });
  const used = parts.reduce((a, p) => a + p.w, 0);
  parts.push({ w: Math.max(0, total - used), c: "transparent", t: "Opoziție", empty: true });
  const mine = parts.slice(0, -1).reduce((a, p) => a + p.w, 0);
  return `<div class="seatbar" title="Majoritatea e 166">
    ${parts.map((p) => `<i class="${p.hatch ? "hatch" : ""} ${p.empty ? "empty" : ""}" style="width:${(p.w / total) * 100}%;--sc:${p.c}" title="${esc(p.t)}"></i>`).join("")}
    <b style="left:${(166 / total) * 100}%"></b>
  </div>
  <div class="seat-legend">
    ${gv.coalition.map((p) => `<span>${dot(pcolor(S, p))}${esc(pname(S, p))} ${seats(p)}</span>`).join("")}
    ${supporters.map((p) => `<span class="dim">${dot(pcolor(S, p))}${esc(pname(S, p))} (sprijin) ${seats(p)}</span>`).join("")}
    <span class="dim">${dot("#8d99ae")}Minorități ${s.minoritySeats}</span>
    <strong>${mine} din 330 · majoritatea e 166</strong>
  </div>`;
}

function satBars(S) {
  const g = G(S);
  return S.data.segments.segments
    .map((seg) => {
      const v = g.sat[seg.id] ?? 0;
      const side = v >= 0 ? "pos" : "neg";
      return `<div class="satrow"><span>${dot(seg.color)}${esc(seg.name)}</span>
        <div class="sat"><i class="${side}" style="width:${Math.abs(v) * 50}%;${v >= 0 ? "left:50%" : `right:50%`}"></i><u></u></div>
        <em class="${v > 0.05 ? "good" : v < -0.05 ? "bad" : ""}">${v > 0.05 ? "mulțumit" : v < -0.05 ? "nemulțumit" : "neutru"}</em></div>`;
    })
    .join("");
}

function overview(S) {
  const s = S.snap;
  const g = G(S);
  const gv = g.gov;
  const m = g.macro;
  const pm = s.politicians[gv.pm];
  const role = roleOf(S, S.party);
  const euDef = s.world.countries.eu.deficit;
  const euDebt = s.world.countries.eu.debt;
  const rate = g.rating;
  const daysLeft = Math.max(0, s.electionDay - s.day);
  const mine = s.decisions.filter((d) => d.party === S.party).length;
  const open = g.proposals.filter((p) => p.to === S.party && p.status === "open").length;

  const cards = [
    `<div class="sc pm"><div class="sc-label">Premier</div>
      <div class="pmrow">${pm ? `<div class="portrait sm">${portrait(pm.look, { label: pm.name })}</div>` : ""}
      <div><div class="pm-name">${esc(pm?.name ?? "Guvern demis")}</div>
      <div class="sc-sub">${partyBadge(S, pm?.party ?? gv.pmParty)} ${esc(pm?.role ?? "")}</div></div></div></div>`,
    statCard({
      label: "Încredere în guvern",
      value: `${gv.confidence}`,
      unit: "/100",
      tone: gv.confidence >= 55 ? "good" : gv.confidence < 35 ? "bad" : "",
      sub: `Aprobare ${gv.approval}% · sub 18 cade guvernul`,
      extra: spark(series(S, "confidence"), { color: "var(--sec)" }),
    }),
    statCard({
      label: "Rating suveran",
      value: esc(rate.level),
      unit: ` · ${rate.outlook}`,
      tone: rate.investmentGrade ? (rate.outlook === "negativ" ? "warn" : "good") : "bad",
      sub: `Încordare ${fmt(rate.strain, 1)} · dobândă medie ${pct1(m.rate)}`,
      extra: bar(rate.strain, 4, rate.strain > 2.2 ? "var(--bad)" : "var(--sec)", 3),
    }),
    statCard({
      label: "Deficit bugetar",
      value: fmt(m.deficitPct, 1),
      unit: "% PIB",
      tone: tone("low", m.deficitPct - euDef, 0.2),
      sub: `UE ${fmt(euDef, 1)}% · ${meur(Math.abs(g.budget.flows.balance))}/an`,
      extra: spark(series(S, "deficit"), { color: "var(--sec)", ref: series(S, "eu_deficit") }),
    }),
    statCard({
      label: "Datoria publică",
      value: fmt(m.debtPct, 1),
      unit: "% PIB",
      tone: tone("low", m.debtPct - euDebt, 1),
      sub: `UE ${fmt(euDebt, 0)}% · ${meur(m.debt)}`,
      extra: spark(series(S, "debt"), { color: "var(--sec)", ref: series(S, "eu_debt") }),
    }),
    statCard({
      label: "Următoarele alegeri",
      value: fmt(daysLeft),
      unit: " zile",
      sub: `Sondaje și campania contează tot mai mult`,
    }),
  ];

  return `
    <div class="you ${role}">Tu conduci ${partyBadge(S, S.party)} <strong>${ROLE_LABEL[role]}</strong>
      ${mine ? `<a data-do="decision-focus">${mine} decizie în așteptare</a>` : ""}
      ${open ? `<a data-do="go" data-sec="guvern" data-sub="proposals">${open} propunere de răspuns</a>` : ""}</div>
    <div class="grid cards">${cards.join("")}</div>
    ${section("Majoritatea parlamentară", seatBar(S), { sub: "Coaliția, sprijinul din afara guvernului și grupul minorităților față de pragul de 166." })}
    ${section("Ce simt oamenii", `<div class="satlist">${satBars(S)}</div>`, { sub: "Satisfacția față de ce se aștepta fiecare grup. Contează la următoarele alegeri.", right: `<a class="more" data-do="go" data-sec="tara" data-sub="sol">Standard de viață →</a>` })}
  `;
}

/* ----------------------------------------------------------------- budget */

const GROUP_ORDER = ["Social", "Servicii", "Securitate", "Investiții", "Stat"];

function spendRows(S) {
  const g = G(S);
  const b = g.budget;
  const fl = b.flows;
  const gdp = g.macro.gdp;
  const lines = S.data.government.spendLines;
  const rows = [];
  for (const grp of GROUP_ORDER) {
    const items = lines.filter((l) => l.group === grp);
    if (!items.length) continue;
    rows.push(`<div class="grp">${esc(grp)}</div>`);
    for (const l of items) {
      const baseM = fl.base[l.id];
      const targetM = Math.round(b.ratio[l.id] * gdp);
      const lo = Math.round(baseM * l.min);
      const hi = Math.round(baseM * l.max);
      const draft = S.draft.spend[l.id] ?? targetM;
      const step = Math.max(10, Math.round(baseM * 0.004));
      const cd = b.cool[`line:${l.id}`] ?? -1;
      const locked = cd > S.snap.day;
      const dpct = baseM ? ((draft - baseM) / baseM) * 100 : 0;
      const policyM = Math.round((b.policy[l.id] ?? 0) * gdp);
      rows.push(`<div class="rowl" data-line="${l.id}">
        <div class="rl-name">${dot(l.color)}<b>${esc(l.name)}</b><small>${esc(l.blurb)}</small></div>
        <div class="rl-owner">${ministryBadge(S, l.ministry)} ${partyBadge(S, ownerOf(S, l.ministry))}</div>
        <div class="rl-val"><b data-draft-val="${l.id}">${fmt(draft)}</b><span> M€/an</span>
          <small data-draft-delta="${l.id}" class="${dpct > 0.5 ? "up" : dpct < -0.5 ? "down" : ""}">${dpct > 0.5 || dpct < -0.5 ? `${signed(dpct, 0)}% față de bază` : "la nivelul de bază"}</small></div>
        <input type="range" class="rng" data-slider="${l.id}" min="${lo}" max="${hi}" step="${step}" value="${draft}" style="--base:${((baseM - lo) / (hi - lo)) * 100}%">
        <div class="rl-meta">plătit acum ${meur(fl.spend[l.id])} · ${fmt((fl.spend[l.id] / gdp) * 100, 1)}% PIB${policyM ? ` · politici ${signed(policyM, 0)} M€` : ""} · interval ${fmt(lo)}–${fmt(hi)}</div>
        <div class="rl-act">${locked ? `<small class="dim">din ziua ${cd}</small>` : actButton(S, l.ministry, `data-do="spend-apply" data-line="${l.id}"`)}</div>
      </div>`);
    }
  }
  return rows.join("");
}

function taxCards(S) {
  const g = G(S);
  const b = g.budget;
  const fl = b.flows;
  return S.data.government.taxes
    .map((t) => {
      const cur = b.tax[t.id];
      const val = S.draft.tax[t.id] ?? cur;
      const cd = b.cool[`tax:${t.id}`] ?? -1;
      const locked = cd > S.snap.day;
      const est = fl.revenue[t.id] * (Math.pow(val / cur, t.elasticity) - 1);
      const rev0 = b.tax0[t.id];
      return `<div class="taxc" style="--cc:${t.color}">
        <div class="tc-h">${dot(t.color)}<b>${esc(t.name)}</b>${ministryBadge(S, t.ministry)} ${partyBadge(S, ownerOf(S, t.ministry))}</div>
        <div class="tc-v">
          <button class="step" data-do="tax-step" data-tax="${t.id}" data-dir="-1" aria-label="Scade">−</button>
          <strong data-tax-val="${t.id}">${val}%</strong>
          <button class="step" data-do="tax-step" data-tax="${t.id}" data-dir="1" aria-label="Crește">+</button>
        </div>
        <div class="tc-s ${est > 1 ? "up" : est < -1 ? "down" : ""}" data-tax-est="${t.id}">${val === cur ? `Acum ${cur}% (la start ${rev0}%)` : `${signed(est, 0)} M€/an venituri estimate`}</div>
        <p>${esc(t.blurb)}</p>
        <div class="tc-a">${locked ? `<small class="dim">din ziua ${cd}</small>` : val === cur ? "" : actButton(S, t.ministry, `data-do="tax-apply" data-tax="${t.id}"`)}</div>
      </div>`;
    })
    .join("");
}

function revenueTable(S) {
  const g = G(S);
  const fl = g.budget.flows;
  const gdp = g.macro.gdp;
  const lines = S.data.government.revenueLines;
  return `<div class="stack">${lines.map((l) => `<i style="width:${(fl.revenue[l.id] / fl.revTotal) * 100}%;background:${l.color}" title="${esc(l.name)}"></i>`).join("")}</div>
    <table class="tbl"><tbody>${lines
      .map((l) => `<tr><td>${dot(l.color)}${esc(l.name)}</td><td class="num">${meur(fl.revenue[l.id])}</td><td class="num dim">${fmt((fl.revenue[l.id] / gdp) * 100, 1)}% PIB</td></tr>`)
      .join("")}
      <tr class="tot"><td>Total venituri</td><td class="num">${meur(fl.revTotal)}</td><td class="num dim">${fmt((fl.revTotal / gdp) * 100, 1)}% PIB</td></tr></tbody></table>`;
}

function budgetView(S) {
  const g = G(S);
  const fl = g.budget.flows;
  const m = g.macro;
  const gdp = m.gdp;
  const euDef = S.snap.world.countries.eu.deficit;
  const summary = [
    statCard({ label: "PIB nominal", value: fmt(gdp), unit: " M€", sub: `${signed(m.growth, 1)}% real · inflație ${fmt(m.inflation, 1)}%`, extra: spark(series(S, "growth"), { color: "var(--sec)", ref: series(S, "eu_growth") }) }),
    statCard({ label: "Venituri", value: fmt(fl.revTotal), unit: " M€", sub: `${fmt((fl.revTotal / gdp) * 100, 1)}% din PIB` }),
    statCard({ label: "Cheltuieli", value: fmt(fl.spendTotal), unit: " M€", sub: `${fmt((fl.spendTotal / gdp) * 100, 1)}% din PIB` }),
    statCard({ label: "Sold", value: signed(fl.balance, 0), unit: " M€", tone: fl.balance >= 0 ? "good" : "bad", sub: `Deficit ${fmt(m.deficitPct, 1)}% · UE ${fmt(euDef, 1)}%` }),
    statCard({ label: "Dobânzi plătite", value: fmt(fl.spend.interest), unit: " M€", sub: `${fmt((fl.spend.interest / fl.revTotal) * 100, 1)}% din venituri · cost ${fmt(m.rate, 1)}%` }),
  ];
  const party = S.snap.parties[S.party];
  return `
    <div class="grid cards">${summary.join("")}</div>
    ${section("Taxe", `<div class="grid taxes">${taxCards(S)}</div>`, { sub: "Schimbarea unei taxe se simte în venituri, în prețuri și în creștere. Fiecare cotă se poate muta o dată la 30 de zile." })}
    ${section("Cheltuieli publice", `<div class="rows">${spendRows(S)}</div>`, {
      sub: "Țintele sunt în milioane de euro pe an; banii se aliniază treptat. Bara marchează nivelul de bază. Capital politic: <b>" + fmt(party.capital, 0) + "</b>.",
    })}
    <div class="two">
      ${section("Venituri", revenueTable(S))}
      ${section("Cheltuieli fixe", `<table class="tbl"><tbody>${S.data.government.fixedSpend.map((l) => `<tr><td>${dot(l.color)}${esc(l.name)}</td><td class="num">${meur(fl.spend[l.id])}</td><td class="num dim">${fmt((fl.spend[l.id] / gdp) * 100, 1)}% PIB</td></tr>`).join("")}</tbody></table>`, { sub: "Dobânda crește odată cu datoria și cu încrederea piețelor." })}
    </div>`;
}

/* --------------------------------------------------------------- policies */

function policyImpact(S, p) {
  const gdp = G(S).macro.gdp;
  const net = Object.values(p.spend ?? {}).reduce((a, v) => a + v, 0) - Object.values(p.revenue ?? {}).reduce((a, v) => a + v, 0);
  const chips = [];
  if (net) chips.push(`<span class="chip3 ${net > 0 ? "bad" : "good"}">${net > 0 ? "cost" : "câștig"} ${meur(Math.abs((net / 100) * gdp))}/an</span>`);
  const e = p.effects ?? {};
  for (const [seg, v] of Object.entries(e.sol ?? {})) {
    chips.push(`<span class="chip3 ${v > 0 ? "good" : "bad"}">${esc(S.segById[seg]?.name ?? seg)} ${signed(v, 0)}</span>`);
  }
  const fx = [["growth", "creștere", 1], ["inflation", "inflație", -1], ["unemployment", "șomaj", -1], ["wage", "salarii", 1], ["compliance", "colectare", 1], ["euAbsorption", "fonduri UE", 1]];
  for (const [k, label, dir] of fx) if (e[k]) chips.push(`<span class="chip3 ${e[k] * dir > 0 ? "good" : "bad"}">${label} ${signed(e[k] * (k === "compliance" || k === "euAbsorption" ? 100 : 1), k === "compliance" || k === "euAbsorption" ? 0 : 2)}${k === "compliance" || k === "euAbsorption" ? "%" : ""}</span>`);
  for (const [k, v] of Object.entries(e.drift ?? {})) {
    const met = S.data.government.metrics.find((x) => x.id === k);
    const good = (v > 0) === ((met?.better ?? "high") === "high");
    chips.push(`<span class="chip3 ${good ? "good" : "bad"}">${esc(met?.name ?? k)} ${signed(v, 1)}/an</span>`);
  }
  if (e.confidence) chips.push(`<span class="chip3 ${e.confidence > 0 ? "good" : "bad"}">încredere ${signed(e.confidence, 0)}</span>`);
  return chips.join("");
}

function policiesView(S) {
  const g = G(S);
  const filter = S.polFilter ?? "all";
  const ministries = S.data.government.ministries.filter((m) => S.data.policies.policies.some((p) => p.ministry === m.id));
  const chips = [`<button class="chipf ${filter === "all" ? "on" : ""}" data-do="pol-filter" data-m="all">Toate</button>`]
    .concat(ministries.map((m) => `<button class="chipf ${filter === m.id ? "on" : ""}" style="--cc:${m.color}" data-do="pol-filter" data-m="${m.id}">${esc(m.short)}</button>`))
    .join("");
  const party = S.snap.parties[S.party];
  const list = S.data.policies.policies
    .filter((p) => filter === "all" || p.ministry === filter)
    .map((p) => {
      const active = p.id in g.policies;
      const md = ministryDef(S, p.ministry);
      const cd = g.budget.cool[`policy:${p.id}`] ?? -1;
      const locked = cd > S.snap.day;
      const m = mode(S, p.ministry);
      let btn;
      if (locked) btn = `<small class="dim">din ziua ${cd}</small>`;
      else if (active) btn = m === "direct" ? `<button class="btn2" data-do="policy-off" data-id="${p.id}">Abrogă</button>` : `<span class="tag2" style="--tc:#2fbf8a">În vigoare</span>`;
      else btn = actButton(S, p.ministry, `data-do="policy-on" data-id="${p.id}"`, { direct: "Adoptă", propose: "Propune" });
      return `<article class="pol ${active ? "active" : ""}" style="--cc:${md.color}">
        <header><b>${esc(p.name)}</b>${ministryBadge(S, p.ministry)} ${partyBadge(S, ownerOf(S, p.ministry))}</header>
        <p>${esc(p.text)}</p>
        <div class="chips3">${policyImpact(S, p)}</div>
        <footer><span class="cap">Capital politic ${p.capital}</span>${btn}</footer>
      </article>`;
    })
    .join("");
  return `<div class="filters">${chips}</div>
    <p class="hint">Capital politic disponibil: <b>${fmt(party.capital, 0)}</b>. Măsurile unui minister le adoptă partidul care îl conduce; ceilalți din guvern pot doar să propună.</p>
    <div class="grid pols">${list}</div>`;
}

/* ---------------------------------------------------------------- cabinet */

function cabinetView(S) {
  const g = G(S);
  const pmMine = ownerOf(S, "premier") === S.party;
  const taken = new Set(g.gov.ministries.map((m) => m.minister).filter(Boolean));
  const pool = Object.values(S.snap.politicians).sort((a, b) => a.name.localeCompare(b.name, "ro"));
  return `<p class="hint">${pmMine ? "Ești la cârma guvernului: poți face remanieri (15 capital politic, o dată la 45 de zile). Un partener care pierde un minister se supără." : "Doar partidul premierului poate schimba miniștri."} Competența unui ministru (răbdare, corupție, gafe) schimbă cât de bine folosește ministerul banii.</p>
    <div class="grid cabinet">${g.gov.ministries
      .map((m) => {
        const md = ministryDef(S, m.id);
        const pol = m.minister ? S.snap.politicians[m.minister] : null;
        const options = pool
          .filter((p) => !taken.has(p.id) || p.id === m.minister)
          .map((p) => `<option value="${p.id}" ${p.id === m.minister ? "selected" : ""}>${esc(p.name)} (${esc(pname(S, p.party))})</option>`)
          .join("");
        return `<article class="cab" style="--cc:${md.color}">
          <header><b>${esc(md.name)}</b>${partyBadge(S, m.party)}</header>
          <div class="cab-min">${pol ? `<div class="portrait sm">${portrait(pol.look, { label: pol.name })}</div>` : `<div class="portrait sm empty">?</div>`}
            <div><div class="pm-name">${esc(pol?.name ?? "Fără ministru")}</div><div class="sc-sub">${esc(pol?.role ?? "interimar")}</div></div></div>
          <div class="kv"><span>Competență</span>${bar(m.competence, 100, md.color)}<em>${m.competence}</em></div>
          <div class="kv"><span>Randament</span>${bar(Math.min(150, m.efficiency * 100), 150, md.color, 100)}<em>${fmt(m.efficiency * 100, 0)}%</em></div>
          <div class="levers">${(md.levers.length ? md.levers.map((l) => S.data.government.spendLines.concat(S.data.government.taxes).find((x) => x.id === l)?.name ?? l) : ["Politici sectoriale"]).map((n) => `<span class="chip3">${esc(n)}</span>`).join("")}</div>
          ${pmMine ? `<div class="cab-act"><select id="appoint-${m.id}" class="sel">${options}</select><button class="btn2 primary2" data-do="appoint" data-m="${m.id}">Numește</button></div>` : ""}
        </article>`;
      })
      .join("")}</div>`;
}

/* -------------------------------------------------------------- proposals */

function proposalsView(S) {
  const g = G(S);
  const role = roleOf(S, S.party);
  const mineIn = g.proposals.filter((p) => p.to === S.party);
  const mineOut = g.proposals.filter((p) => p.from === S.party);
  const row = (p, incoming) => `<div class="prop ${p.status}">
    <div><b>${esc(p.label)}</b><small>${partyBadge(S, p.from)} → ${p.to ? partyBadge(S, p.to) : badge("independent", "#8d99ae")} ${ministryBadge(S, p.ministry)} · ziua ${p.day}</small></div>
    <div class="prop-act">${
      p.status === "open" && incoming
        ? `<button class="btn2 primary2" data-do="answer" data-id="${p.id}" data-accept="1">Acceptă</button><button class="btn2" data-do="answer" data-id="${p.id}" data-accept="0">Respinge</button>`
        : `<span class="tag2" style="--tc:${p.status === "accepted" ? "#2fbf8a" : p.status === "open" ? "#ffb02e" : "#8d99ae"}">${{ accepted: "Acceptată", rejected: "Respinsă", open: "În așteptare", expired: "Expirată" }[p.status]}</span>`
    }</div></div>`;

  const parliament = [];
  if (role === "opozitie" || role === "sprijin" || role === "retras") {
    const until = g.budget.cool.motion ?? -1;
    const wait = until > S.snap.day;
    parliament.push(`<div class="mot"><div><b>Moțiune de cenzură</b><p>Costă 25 de capital politic și 1 M€. Trece dacă strânge 166 de voturi; celelalte partide din opoziție votează în funcție de încrederea în guvern (acum ${g.gov.confidence}/100).</p></div>
      <button class="btn2 primary2" data-do="motion" ${wait ? "disabled" : ""}>${wait ? `din ziua ${until}` : "Depune moțiunea"}</button></div>`);
  }
  if (role === "sprijin" || role === "retras") {
    const on = role === "sprijin";
    parliament.push(`<div class="mot"><div><b>Sprijin parlamentar</b><p>${on ? "Votezi alături de guvern, fără să fii în el. Retragerea sprijinului scade încrederea cu 8 puncte." : "Ai retras sprijinul. Îl poți oferi din nou."}</p></div>
      <button class="btn2 ${on ? "" : "primary2"}" data-do="support" data-on="${on ? 0 : 1}">${on ? "Retrage sprijinul" : "Reia sprijinul"}</button></div>`);
  }
  return `${parliament.length ? section("În Parlament", parliament.join("")) : ""}
    ${section("Primite", mineIn.length ? mineIn.map((p) => row(p, true)).join("") : `<p class="hint">Nicio propunere pentru ministerele tale.</p>`, { sub: "Alte partide din guvern cer să schimbi ceva ce ține de ministerele tale." })}
    ${section("Trimise", mineOut.length ? mineOut.map((p) => row(p, false)).join("") : `<p class="hint">Nu ai trimis nicio propunere. O poți face din Buget sau din Politici, pentru ministerele altor partide.</p>`)}`;
}

/* ---------------------------------------------------------------- metrics */

function metricValue(S, id) {
  const g = G(S);
  const m = g.macro;
  const w = S.snap.world.countries.ro;
  const map = {
    gdp: m.gdp, growth: m.growth, inflation: m.inflation, unemployment: m.unemployment, wage: m.wage, gdpPps: m.gdpPps,
    deficit: m.deficitPct, debt: m.debtPct, interest: g.budget.flows.spend.interest, lifeExp: g.metrics.lifeExp,
    arope: g.metrics.arope, emigration: m.emigration, pensionReal: m.pensionIdx, health: g.metrics.health,
    education: g.metrics.education, earlyLeavers: g.metrics.earlyLeavers, safety: g.metrics.safety, cpi: g.metrics.cpi,
    motorwayKm: g.metrics.motorwayKm, motorwayDensity: w.motorwayDensity, infra: g.metrics.infra,
  };
  return map[id];
}

const HIST_KEY = { growth: "growth", inflation: "inflation", unemployment: "unemployment", deficit: "deficit", debt: "debt", gdpPps: "gdpPps", lifeExp: "lifeExp", arope: "arope", health: "health", education: "education", infra: "infra", safety: "safety", cpi: "cpi" };

function metricCard(S, m, color) {
  const v = metricValue(S, m.id);
  const hk = HIST_KEY[m.id];
  const hist = hk ? series(S, hk) : [];
  const prev = hist.length > 3 ? yearAgo(hist) : null;
  const delta = prev != null ? v - prev : 0;
  const eu = m.eu ? S.snap.world.countries.eu[m.eu] : null;
  const vsEu = eu != null ? tone(m.better, v - eu, Math.max(0.05, Math.abs(eu) * 0.02)) : "";
  const refKey = m.eu ? `eu_${m.eu}` : null;
  const ref = refKey && S.snap.gov.hist?.s?.[refKey] ? series(S, refKey) : null;
  const val = m.decimals ? fmt(v, m.decimals) : fmt(v);
  return `<div class="sc ${vsEu}" style="--cc:${color}">
    <div class="sc-label">${esc(m.name)}</div>
    <div class="sc-value">${val}<small> ${esc(m.unit)}</small></div>
    <div class="sc-sub">${prev != null ? `<span class="${tone(m.better, delta, Math.max(0.05, Math.abs(prev) * 0.004))}">${arrow(delta, 0.01)} ${signed(delta, m.decimals || 0)} în 12 luni</span>` : "&nbsp;"}${eu != null ? ` · UE ${fmt(eu, m.decimals)}` : ""}</div>
    ${hist.length > 1 ? spark(hist, { color, ref }) : ""}
  </div>`;
}

function metricsView(S) {
  const D = S.data.government;
  return D.metricGroups
    .map((grp) => `${section(grp.name, `<div class="grid cards">${D.metrics.filter((m) => m.group === grp.id).map((m) => metricCard(S, m, grp.color)).join("")}</div>`, { sub: grp.id === "economie" ? "Cifrele țării, cu comparația față de media UE acolo unde există." : "" })}`)
    .join("");
}

/* -------------------------------------------------------- standard of living */

function solView(S) {
  const g = G(S);
  const D = S.data.government;
  const pops = {};
  for (const c of Object.values(S.snap.counties)) for (const [seg, n] of Object.entries(c.segments)) pops[seg] = (pops[seg] ?? 0) + n;
  const totalPop = Object.values(pops).reduce((a, b) => a + b, 0);
  const rows = S.data.segments.segments.map((seg) => {
    const sol = g.sol[seg.id];
    const exp = g.solExpect[seg.id];
    const sat = g.sat[seg.id];
    const contrib = Object.entries(D.sol[seg.id]).map(([k, w]) => ({ k, v: w * ((g.comp[k] ?? 0.5) - 0.5) * 100 }));
    const best = contrib.slice().sort((a, b) => b.v - a.v).filter((x) => x.v > 0.3).slice(0, 2);
    const worst = contrib.slice().sort((a, b) => a.v - b.v).filter((x) => x.v < -0.3).slice(0, 2);
    const hist = series(S, `sol_${seg.id}`);
    return `<tr>
      <td>${dot(seg.color)}<b>${esc(seg.name)}</b><small>${fmt(((pops[seg.id] ?? 0) / totalPop) * 100, 1)}% din populație</small></td>
      <td class="solc"><div class="solbar">${bar(sol, 100, seg.color, exp)}<b>${fmt(sol, 0)}</b></div><small class="dim">așteptări ${fmt(exp, 0)}</small></td>
      <td><span class="satchip ${sat > 0.05 ? "good" : sat < -0.05 ? "bad" : ""}">${sat > 0.05 ? "▲" : sat < -0.05 ? "▼" : "→"} ${signed(sat * 100, 0)}</span></td>
      <td class="drv">${best.map((x) => `<span class="chip3 good">${esc(D.solComponents[x.k])}</span>`).join("")}${worst.map((x) => `<span class="chip3 bad">${esc(D.solComponents[x.k])}</span>`).join("")}</td>
      <td class="sparkc">${spark(hist, { color: seg.color, w: 90 })}</td>
    </tr>`;
  });
  const comps = Object.entries(D.solComponents)
    .map(([k, name]) => `<div class="kv"><span>${esc(name)}</span>${bar((g.comp[k] ?? 0) * 100, 100, "var(--sec)", 50)}<em>${fmt((g.comp[k] ?? 0) * 100, 0)}</em></div>`)
    .join("");
  return `${section("Standardul de viață pe grupuri", `<div class="tblw"><table class="tbl sol"><thead><tr><th>Grup</th><th>SoL și așteptări</th><th>Satisfacție</th><th>Ce contează acum</th><th>Evoluție</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`, {
    sub: "SoL = cât de bine trăiește grupul, de la 0 la 100. Votanții se compară cu ce se așteptau (linia din bară): când SoL depășește așteptările, partidele de la guvernare câștigă teren.",
  })}
  ${section("Componentele standardului de viață", `<div class="kvs">${comps}</div>`, { sub: "Valori 0–100; linia de la 50 e un nivel „normal”." })}`;
}

/* ------------------------------------------------------------------ world */

const worldIndicators = (S) => S.data.countries.indicators;
const countryDef = (S, id) => S.data.countries.countries.find((c) => c.id === id);

function compareView(S) {
  const inds = worldIndicators(S);
  const cur = inds.find((i) => i.id === S.worldInd) ?? inds[0];
  const wc = S.snap.world.countries;
  const eu = wc.eu[cur.id];
  const list = S.data.countries.countries
    .map((c) => ({ c, v: wc[c.id]?.[cur.id] }))
    .filter((x) => x.v != null)
    .sort((a, b) => (cur.better === "high" ? b.v - a.v : a.v - b.v));
  const vals = list.map((x) => x.v);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals) * 1.08 || 1;
  const rank = list.findIndex((x) => x.c.id === "ro") + 1;
  const roV = wc.ro[cur.id];
  const roHist = cur.id in HIST_KEY || ["gdpPps"].includes(cur.id) ? series(S, HIST_KEY[cur.id] ?? cur.id) : [];
  const euHist = S.snap.gov.hist?.s?.[`eu_${cur.id}`] ?? null;
  const chips = inds.map((i) => `<button class="chipf ${i.id === cur.id ? "on" : ""}" data-do="world-ind" data-ind="${i.id}">${esc(i.short)}</button>`).join("");
  return `<div class="filters">${chips}</div>
    <div class="grid cards">
      ${statCard({ label: `România · ${cur.name}`, value: fmt(roV, cur.decimals), unit: ` ${cur.unit}`, tone: tone(cur.better, roV - eu, Math.max(0.05, Math.abs(eu) * 0.02)), sub: `Locul ${rank} din ${list.length} · UE ${fmt(eu, cur.decimals)}` })}
      ${statCard({ label: "Față de media UE", value: signed(roV - eu, cur.decimals), unit: ` ${cur.unit}`, tone: tone(cur.better, roV - eu, Math.max(0.05, Math.abs(eu) * 0.02)), sub: cur.better === "high" ? "Mai mare e mai bine" : "Mai mic e mai bine" })}
      <div class="sc wide"><div class="sc-label">Evoluție, România (plin) și UE (punctat)</div>${roHist.length > 1 ? spark(roHist, { w: 360, h: 56, color: "#ffcf3f", ref: euHist }) : `<div class="sc-sub">Istoricul apare după câteva luni de joc.</div>`}</div>
    </div>
    ${section(cur.name, `<div class="ranks">${list
      .map((x) => {
        const isRo = x.c.id === "ro";
        const isEu = x.c.id === "eu";
        return `<div class="rank ${isRo ? "ro" : ""} ${isEu ? "eu" : ""}"><span>${dot(x.c.color)}${esc(x.c.short)}</span>${bar(x.v - lo, hi - lo, x.c.color, eu - lo)}<b>${fmt(x.v, cur.decimals)}</b></div>`;
      })
      .join("")}</div>`, { sub: "Linia verticală e media UE. Țările străine sunt simulate, cu șocuri și evenimente plauzibile; valorile de plecare sunt orientative." })}`;
}

function tableView(S) {
  const inds = worldIndicators(S);
  const wc = S.snap.world.countries;
  const eu = wc.eu;
  const head = `<tr><th>Țara</th>${inds.map((i) => `<th title="${esc(i.name)}">${esc(i.short)}</th>`).join("")}</tr>`;
  const body = S.data.countries.countries
    .map((c) => {
      const cells = inds
        .map((i) => {
          const v = wc[c.id][i.id];
          const d = v - eu[i.id];
          const t = c.id === "eu" ? "" : tone(i.better, d, Math.max(0.05, Math.abs(eu[i.id]) * 0.03));
          return `<td class="num heat ${t}">${fmt(v, i.decimals)}</td>`;
        })
        .join("");
      return `<tr class="${c.id === "ro" ? "ro" : c.id === "eu" ? "eu" : ""}"><td>${dot(c.color)}<b>${esc(c.short)}</b></td>${cells}</tr>`;
    })
    .join("");
  return `${section("România, UE și țările din comparație", `<div class="tblw"><table class="tbl world"><thead>${head}</thead><tbody>${body}</tbody></table></div>`, {
    sub: "Verde = mai bine decât media UE, roșu = mai rău. Unitățile: " + inds.map((i) => `${i.short} (${i.unit || "UE=100"})`).join(", ") + ".",
  })}`;
}

function worldEvents(S) {
  const w = S.snap.world;
  const ev = [...w.events].reverse();
  return `<div class="grid cards">
      ${statCard({ label: "Ciclul economic global", value: signed(w.cycle, 1), unit: " pp", tone: w.cycle > 0.3 ? "good" : w.cycle < -0.3 ? "bad" : "" , sub: "Pozitiv = expansiune" })}
      ${statCard({ label: "Preț energie (100 = normal)", value: fmt(w.energy), tone: w.energy > 125 ? "bad" : w.energy < 90 ? "good" : "", sub: "Influențează inflația" })}
      ${statCard({ label: "Dobânda BCE", value: fmt(w.ecb, 2), unit: "%", sub: "Baza dobânzii la care se împrumută România" })}
    </div>
    ${section("Ce se întâmplă în lume", ev.length ? ev.map((e) => `<div class="news-item world"><div class="n-day">ziua ${e.day} · ${esc(countryDef(S, e.country)?.short ?? "Lume")}</div><div class="n-title">${esc(e.title)}</div><div class="n-text">${esc(e.text)}</div></div>`).join("") : `<p class="hint">Încă nu s-a întâmplat nimic notabil. Evenimentele din afară apar în timp.</p>`)}`;
}

/* ------------------------------------------------------------------- news */

const NEWS_KINDS = {
  all: null,
  gov: ["budget", "law", "rating", "coalition", "decision"],
  world: ["world"],
  politics: ["election", "action", "scandal", "event", "system"],
};

function newsView(S, sub) {
  const kinds = NEWS_KINDS[sub];
  const items = [...S.snap.log].reverse().filter((l) => !kinds || kinds.includes(l.kind));
  const act = S.snap.active
    ? `<div class="card hot"><div class="n-day">Ultima știre · ziua ${S.snap.active.day}</div><h4>${esc(S.snap.active.title)}</h4><div class="muted">${esc(S.snap.active.text)}</div></div>`
    : "";
  return `${sub === "all" || sub === "politics" ? act : ""}
    <div class="newslist">${items.length ? items.map((l) => `<div class="news-item ${esc(l.kind)}"><div class="n-day">ziua ${l.day} · ${esc(l.kind)}</div><div class="n-title">${esc(l.title)}</div>${l.text ? `<div class="n-text">${esc(l.text)}</div>` : ""}</div>`).join("") : `<p class="hint">Nicio știre încă.</p>`}</div>`;
}

/* -------------------------------------------------------------- dispatcher */

export function renderView(S, sec, sub) {
  if (sec === "guvern") {
    return { overview, budget: budgetView, policies: policiesView, cabinet: cabinetView, proposals: proposalsView }[sub]?.(S) ?? "";
  }
  if (sec === "tara") return { metrics: metricsView, sol: solView }[sub]?.(S) ?? "";
  if (sec === "lume") return { compare: compareView, table: tableView, events: worldEvents }[sub]?.(S) ?? "";
  if (sec === "stiri") return newsView(S, sub);
  return "";
}

// Small counters shown on the section pills.
export function badges(S) {
  const g = G(S);
  const out = {};
  const open = g.proposals.filter((p) => p.to === S.party && p.status === "open").length;
  if (open) out.guvern = open;
  return out;
}
