// Governing the country: budget (in million euro), taxes, public services,
// standard of living per voter segment, the cabinet, and the people who run it.
// Pure functions over the shared game state, like the engine.
import { clamp, round, rand, log } from "./util.mjs";

export const LINES = ["pensions", "social", "health", "education", "defense", "order", "infra", "agri", "admin"];
const ALL = [...LINES, "other"];

// How well a service turns money into quality. `gain` = quality points between
// starving it and doubling it; `ministry` = whose competence matters.
const SERVICES = {
  health: { gain: 14, line: "health", ministry: "sanatate" },
  education: { gain: 14, line: "education", ministry: "educatie" },
  safety: { gain: 12, line: "order", ministry: "interne" },
  infra: { gain: 20, line: "infra", ministry: "transport" },
};

const EMIGRANT_POOL = {
  tineri_urbani: 0.3, muncitori: 0.3, studenti: 0.15, agricultori: 0.1, antreprenori: 0.08, bugetari: 0.07,
};

const MAJORITY = 166;
const MOTORWAY_COST = 12; // M€ per km, all in

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const find = (arr, id) => arr.find((x) => x.id === id);

/* --------------------------------------------------------------- setup */

export function initGov(state, data, sc) {
  const eco = sc.economy;
  const gv = sc.government;
  const g = data.government;

  state.macro = {
    gdp: eco.gdp, pop: eco.pop, growth: eco.growth, potential: eco.potential,
    inflation: eco.inflation, unemployment: eco.unemployment, wage: eco.wage,
    debt: (eco.gdp * eco.debtPct) / 100, rate: eco.rate, rateMarg: eco.rate, deficitPct: 0,
    gdpPps: eco.gdpPps, realGdpIdx: 100, priceIdx: 100, wageIdx: 100, pensionerIdx: 100, pensionIdx: 100,
    shock: eco.drag ?? 0, infShock: 0, uShock: 0, vatImpulse: 0,
    u0: eco.unemployment, infl0: eco.inflation, rate0: eco.rate,
    emigration: eco.emigration, e0: eco.emigration, spreadBase: eco.spreadBase, euTrend: eco.euTrend ?? 0,
  };

  const ratio = {};
  for (const k of ALL) ratio[k] = eco.spend[k] / 100;
  const rev0 = {};
  for (const r of g.revenueLines) rev0[r.id] = eco.revenue[r.id] / 100;
  state.budget = {
    tax: { ...eco.tax }, tax0: { ...eco.tax },
    ratio, base: { ...ratio }, paid: { ...ratio }, rev0, cool: {}, flows: null,
  };

  state.metrics = { ...eco.metrics, emigration: eco.emigration };
  state.met0 = { ...state.metrics };

  state.gov = {
    pm: gv.pm, pmParty: gv.pmParty, coalition: [...gv.coalition],
    support: Object.fromEntries((gv.support ?? []).map((p) => [p, true])),
    ministries: structuredClone(gv.ministries), confidence: gv.confidence, caretaker: false,
    minoritySeats: sc.minoritySeats ?? 0,
  };

  state.policies = {};
  state.proposals = [];
  state.nextProposal = 1;
  state.solMod = {};
  state.sat = {};

  state.eff0 = {};
  for (const min of g.ministries) state.eff0[min.id] = effRaw(state, min.id);
  state.cab0 = cabinetCorruption(state);

  const level = eco.rating.level;
  state.rating = {
    idx: Math.max(0, g.rating.levels.indexOf(level)),
    outlook: eco.rating.outlook,
    strain: 0, bad: 0, good: 0,
  };

  state.agg = policyAgg(state, data);

  // First pass of the books, so day 0 already has real numbers.
  const flows = makeFlows(state, revenue(state, data), spendFlows(state));
  state.budget.flows = flows;
  state.macro.deficitPct = flows.deficitPct;
  state.rating.strain = strainOf(state);
  m_marg(state);
  state.macro.rateMarg = state.macro.rate; // start from the scenario's own average

  state.sol = computeSol(state, data);
  state.solExpect = { ...state.sol };
  for (const seg of Object.keys(state.sol)) state.sat[seg] = 0;
  updateGovMult(state, data);

  state.hist = { days: [], s: {} };
  pushHist(state, data);
}

function m_marg(state) {
  const m = state.macro;
  const w = state.world;
  const jun = state.rating.idx < 6 ? 1 : 0;
  m.rateMarg = w.ecb + m.spreadBase + 1.35 * state.rating.strain + jun;
}

/* ------------------------------------------------------------ policies */

export function policyAgg(state, data) {
  const agg = {
    spend: {}, rev: {}, sol: {}, comp: {}, drift: {},
    growth: 0, inflation: 0, unemployment: 0, wage: 0, compliance: 0, euAbsorption: 0, emigration: 0, motorwayBoost: 1,
  };
  for (const id of Object.keys(state.policies)) {
    const p = find(data.policies.policies, id);
    if (!p) continue;
    for (const [k, v] of Object.entries(p.spend ?? {})) agg.spend[k] = (agg.spend[k] ?? 0) + v / 100;
    for (const [k, v] of Object.entries(p.revenue ?? {})) agg.rev[k] = (agg.rev[k] ?? 0) + v / 100;
    const e = p.effects ?? {};
    for (const [k, v] of Object.entries(e.sol ?? {})) agg.sol[k] = (agg.sol[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.comp ?? {})) agg.comp[k] = (agg.comp[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.drift ?? {})) agg.drift[k] = (agg.drift[k] ?? 0) + v;
    for (const k of ["growth", "inflation", "unemployment", "wage", "compliance", "euAbsorption", "emigration"]) {
      agg[k] += e[k] ?? 0;
    }
    if (e.motorwayBoost) agg.motorwayBoost = Math.max(agg.motorwayBoost, e.motorwayBoost);
  }
  return agg;
}

/* ------------------------------------------------------------- cabinet */

function minister(state, mid) {
  const id = state.gov.ministries[mid]?.minister;
  return id ? state.politicians[id] : null;
}

function competence(p) {
  if (!p) return 0.55;
  return (p.stats.patience + (100 - p.stats.corruption) + (100 - p.stats.gaffes)) / 300;
}

function effRaw(state, mid) {
  const c = competence(minister(state, mid));
  return (0.8 + 0.5 * (c - 0.5)) * (0.85 + (0.3 * state.metrics.cpi) / 100);
}

function efficiency(state, mid) {
  return effRaw(state, mid) / (state.eff0[mid] || 1);
}

function cabinetCorruption(state) {
  const list = Object.keys(state.gov.ministries)
    .map((mid) => minister(state, mid))
    .filter(Boolean);
  if (!list.length) return 30;
  return list.reduce((s, p) => s + p.stats.corruption, 0) / list.length;
}

export function ownerOf(state, ministryId) {
  return state.gov.ministries[ministryId]?.party ?? null;
}

const lean = (data, partyId) => (partyId ? find(data.parties.parties, partyId)?.lean ?? 0 : -0.2);

/* ----------------------------------------------------- books: money in M€ */

function strainOf(state) {
  const m = state.macro;
  const debtPct = (m.debt / m.gdp) * 100;
  return (
    Math.max(0, m.deficitPct - 3) * 0.5 +
    Math.max(0, debtPct - 55) * 0.04 +
    Math.max(0, 2 - m.growth) * 0.15 +
    Math.max(0, m.inflation - 5) * 0.1 -
    (state.metrics.cpi - 45) * 0.01
  );
}

function revenue(state, data) {
  const m = state.macro;
  const b = state.budget;
  const agg = state.agg;
  const gdp = m.gdp;
  const cyc = 1 + (0.6 * (m.growth - m.potential)) / 100;
  const emp = 1 - 0.03 * (m.unemployment - m.u0);
  const comp = Math.pow(state.metrics.cpi / state.met0.cpi, 0.5) * (1 + agg.compliance);
  const rate = (id) => Math.pow(b.tax[id] / b.tax0[id], find(data.government.taxes, id).elasticity);
  const euF = (1 + agg.euAbsorption) * Math.max(0.3, 1 + m.euTrend * (state.day / 365));
  const r = {
    vat: gdp * b.rev0.vat * rate("vat") * comp * cyc,
    income: gdp * b.rev0.income * rate("income") * comp * cyc * emp,
    corp: gdp * b.rev0.corp * rate("corp") * comp * (1 + 2 * (cyc - 1)),
    social: gdp * b.rev0.social * emp * comp * cyc,
    excise: gdp * b.rev0.excise,
    eu: gdp * b.rev0.eu * euF,
    other: gdp * b.rev0.other,
  };
  for (const [k, v] of Object.entries(agg.rev)) r[k] = (r[k] ?? 0) + gdp * v;
  return r;
}

function spendFlows(state) {
  const m = state.macro;
  const out = {};
  for (const k of ALL) out[k] = state.budget.paid[k] * m.gdp;
  out.interest = (m.debt * m.rate) / 100;
  return out;
}

function makeFlows(state, rev, spend) {
  const gdp = state.macro.gdp;
  const revTotal = sum(rev);
  const spendTotal = sum(spend);
  const base = {};
  for (const k of ALL) base[k] = state.budget.base[k] * gdp;
  return {
    revenue: Object.fromEntries(Object.entries(rev).map(([k, v]) => [k, round(v, 0)])),
    revTotal: round(revTotal, 0),
    spend: Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, round(v, 0)])),
    spendTotal: round(spendTotal, 0),
    base: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, round(v, 0)])),
    balance: round(revTotal - spendTotal, 0),
    deficitPct: ((spendTotal - revTotal) / gdp) * 100,
  };
}

/* --------------------------------------------------- standard of living */

export function computeComp(state, data) {
  const m = state.macro;
  const b = state.budget;
  const x = state.metrics;
  const agg = state.agg;
  const rel = (k) => b.paid[k] / b.base[k];
  const realWage = (m.wageIdx / m.priceIdx) * 100;
  const taxIdx = 0.4 * (b.tax.vat / b.tax0.vat) + 0.4 * (b.tax.income / b.tax0.income) + 0.2 * (b.tax.corp / b.tax0.corp);
  const c = {
    wage: 0.5 + (realWage - 100) / 80,
    pension: 0.5 + (m.pensionIdx - 100) / 80,
    jobs: 1 - (m.unemployment - 3) / 12,
    prices: 1 - m.inflation / 12,
    health: x.health / 100,
    edu: x.education / 100,
    infra: x.infra / 100,
    safety: x.safety / 100,
    cpi: x.cpi / 100,
    tax: 0.6 - (taxIdx - 1) * 1.5,
    housing: 0.5 - (m.rate - m.rate0) * 0.05 - (m.inflation - m.infl0) * 0.01 + (0.3 * (realWage - 100)) / 100,
    subsidies: 0.5 + (rel("agri") - 1) * 1.2,
    benefits: 0.5 + (rel("social") - 1) * 1.0,
    growth: 0.5 + (m.growth - 2.5) / 8,
    publicWage: 0.5 + (rel("admin") - 1) * 0.8 + (0.3 * (realWage - 100)) / 100,
  };
  for (const [k, v] of Object.entries(agg.comp)) c[k] = (c[k] ?? 0.5) + v;
  for (const k of Object.keys(c)) c[k] = clamp(c[k], 0, 1);
  state.comp = c;
  return c;
}

export function computeSol(state, data) {
  const c = computeComp(state, data);
  const out = {};
  for (const [seg, weights] of Object.entries(data.government.sol)) {
    let s = 0;
    for (const [k, w] of Object.entries(weights)) s += w * (c[k] ?? 0.5);
    out[seg] = s * 100 + (state.agg.sol[seg] ?? 0) + (state.solMod[seg] ?? 0);
  }
  return out;
}

function updateGovMult(state, data) {
  const out = {};
  const g = state.gov;
  for (const p of state.partyIds) {
    const def = find(data.parties.parties, p);
    let role;
    if (p === g.pmParty && g.coalition.includes(p)) role = 1;
    else if (g.coalition.includes(p)) role = 0.8;
    else if (g.support[p]) role = 0.35;
    else role = -(def.oppGain ?? 0.3);
    out[p] = {};
    for (const seg of Object.keys(state.sat)) out[p][seg] = clamp(1 + role * 0.7 * state.sat[seg], 0.55, 1.6);
  }
  state.govMult = out;
}

function nationalSat(state) {
  const tot = {};
  for (const c of Object.values(state.counties)) {
    for (const [seg, n] of Object.entries(c.segments)) tot[seg] = (tot[seg] ?? 0) + n;
  }
  let sumPop = 0;
  let acc = 0;
  for (const [seg, n] of Object.entries(tot)) {
    sumPop += n;
    acc += n * (state.sat[seg] ?? 0);
  }
  return sumPop ? acc / sumPop : 0;
}

/* --------------------------------------------------------- monthly step */

export function govMonthly(state, data) {
  const m = state.macro;
  const b = state.budget;
  const x = state.metrics;
  const w = state.world;
  state.agg = policyAgg(state, data);
  const agg = state.agg;
  const eu = w.countries.eu.v;

  // --- the books
  for (const k of ALL) b.paid[k] += 0.15 * (b.ratio[k] + (agg.spend[k] ?? 0) - b.paid[k]);
  const rev = revenue(state, data);
  const spend = spendFlows(state);
  const flows = makeFlows(state, rev, spend);
  b.flows = flows;
  m.debt = Math.max(0, m.debt - flows.balance / 12);
  m.deficitPct += 0.35 * (flows.deficitPct - m.deficitPct);

  // --- markets and rating
  state.rating.strain += 0.2 * (strainOf(state) - state.rating.strain);
  stepRating(state, data);
  m_marg(state);
  m.rate += 0.03 * (m.rateMarg - m.rate);

  // --- macro
  let spendRel = 0;
  for (const k of ALL) spendRel += b.paid[k] - b.base[k];
  let taxDrag = 0;
  for (const t of data.government.taxes) taxDrag -= t.growthDrag * (b.tax[t.id] - b.tax0[t.id]);
  const gTarget =
    m.potential +
    0.35 * spendRel * 100 +
    taxDrag +
    0.012 * (x.education - state.met0.education) +
    0.01 * (x.infra - state.met0.infra) +
    0.006 * (x.health - state.met0.health) +
    0.012 * (x.cpi - state.met0.cpi) -
    0.1 * (m.rateMarg - m.rate0) +
    0.45 * (eu.growth - w.euTrend0) +
    m.shock +
    agg.growth;
  m.growth += 0.18 * (gTarget - m.growth);
  m.growth = clamp(m.growth, -8, 10);

  const iTarget =
    2.8 + 0.28 * (m.growth - m.potential) + 0.012 * (w.energy - 100) + m.vatImpulse + m.infShock + agg.inflation + 0.35 * (eu.inflation - 2.0);
  m.inflation += 0.13 * (iTarget - m.inflation);
  m.inflation = clamp(m.inflation, -1.5, 25);

  const uTarget = m.u0 - 0.3 * (m.growth - m.potential) + m.uShock + agg.unemployment - 0.01 * (m.emigration - m.e0);
  m.unemployment += 0.07 * (uTarget - m.unemployment);
  m.unemployment = clamp(m.unemployment, 2, 25);

  const wageG = m.inflation + 0.55 * m.growth + 1.2 + agg.wage - 0.3 * Math.max(0, m.unemployment - m.u0);
  m.wageIdx *= 1 + wageG / 1200;
  m.wage *= 1 + wageG / 1200;
  m.priceIdx *= 1 + m.inflation / 1200;
  m.gdp *= 1 + (m.growth + m.inflation) / 1200;
  m.realGdpIdx *= 1 + m.growth / 1200;
  m.gdpPps *= 1 + (m.growth - eu.growth) / 1200;
  m.pensionerIdx *= 1 + 0.0035 / 12;
  m.pensionIdx = (100 * (b.paid.pensions / b.base.pensions) * (m.realGdpIdx / 100)) / (m.pensionerIdx / 100);

  m.shock *= 0.93;
  m.infShock *= 0.9;
  m.uShock *= 0.9;
  m.vatImpulse *= 0.9;
  for (const k of Object.keys(state.solMod)) state.solMod[k] *= 0.88;

  // --- public services and society
  for (const [k, s] of Object.entries(SERVICES)) {
    const rel = (b.paid[s.line] / b.base[s.line]) * efficiency(state, s.ministry);
    const target = state.met0[k] + s.gain * Math.tanh(1.6 * (rel - 1));
    x[k] = clamp(x[k] + 0.035 * (target - x[k]) + (agg.drift[k] ?? 0) / 12, 5, 98);
  }
  const cabCorr = cabinetCorruption(state);
  const cpiTarget = state.met0.cpi - 0.08 * (cabCorr - state.cab0);
  x.cpi = clamp(x.cpi + 0.04 * (cpiTarget - x.cpi) + (agg.drift.cpi ?? 0) / 12, 15, 90);
  x.lifeExp += (0.2 + 0.014 * (x.health - state.met0.health) + (agg.drift.lifeExp ?? 0)) / 12;
  const elTarget = clamp(36 - 0.4 * x.education + (state.met0.earlyLeavers - (36 - 0.4 * state.met0.education)), 3, 30);
  x.earlyLeavers += 0.08 * (elTarget - x.earlyLeavers);
  const realWage = (m.wageIdx / m.priceIdx) * 100;
  const aTarget =
    state.met0.arope +
    0.8 * (m.unemployment - m.u0) -
    0.12 * (realWage - 100) -
    4 * (b.paid.social / b.base.social - 1) -
    0.05 * (m.pensionIdx - 100);
  x.arope = clamp(x.arope + 0.04 * (aTarget - x.arope) + (agg.drift.arope ?? 0) / 12, 5, 60);
  x.motorwayKm += (b.paid.infra * m.gdp * 0.12 * efficiency(state, "transport") * agg.motorwayBoost) / MOTORWAY_COST / 12;

  // --- people leaving shift voters into the diaspora
  const eTarget =
    m.e0 *
      (1 +
        0.05 * (m.unemployment - m.u0) +
        0.015 * (state.met0.cpi - x.cpi) +
        0.01 * (state.met0.education - x.education) +
        0.002 * (state.met0.health - x.health) -
        (0.04 * (realWage - 100)) / 10) +
    agg.emigration;
  m.emigration = clamp(m.emigration + 0.05 * (eTarget - m.emigration), 20, 300);
  x.emigration = m.emigration;
  migrate(state, m.emigration / 12);
  m.pop = Math.max(10, m.pop - m.emigration / 12 / 1000 - (0.0015 * m.pop) / 12);

  // --- how people feel, and what that does to the polls
  state.sol = computeSol(state, data);
  for (const seg of Object.keys(state.sol)) {
    state.sat[seg] = clamp((state.sol[seg] - state.solExpect[seg]) / 10, -1, 1);
    state.solExpect[seg] += 0.05 * (state.sol[seg] - state.solExpect[seg]);
  }
  updateGovMult(state, data);
  confidenceStep(state, data);

  aiGovern(state, data);
  expireProposals(state);
  pushHist(state, data);
}

function stepRating(state, data) {
  const r = state.rating;
  const levels = data.government.rating.levels;
  if (r.strain > 3.0) {
    r.bad += 1;
    r.good = 0;
  } else if (r.strain < 0.4) {
    r.good += 1;
    r.bad = 0;
  } else {
    r.bad = Math.max(0, r.bad - 1);
    r.good = Math.max(0, r.good - 1);
  }
  const was = r.idx;
  if (r.bad >= 6 && r.idx > 0) {
    r.idx -= 1;
    r.bad = 0;
  } else if (r.good >= 24 && r.idx < levels.length - 1) {
    r.idx += 1;
    r.good = 0;
  }
  r.outlook = r.strain > 2.2 ? "negativ" : r.strain < 1.0 ? "pozitiv" : "stabil";
  if (r.idx !== was) {
    const down = r.idx < was;
    const junk = down && r.idx < data.government.rating.investmentGrade;
    log(
      state,
      "rating",
      down ? `Ratingul României scade la ${levels[r.idx]}` : `Ratingul României crește la ${levels[r.idx]}`,
      junk
        ? "Agențiile de rating retrogradează România sub nivelul investițional. Dobânzile cresc, investitorii pleacă, iar toți încep să dea vina pe toți."
        : down
          ? "Agenția de rating invocă deficitul și datoria. Ministerul spune că „datele sunt în curs de analiză”."
          : "Agenția de rating apreciază disciplina bugetară. Ministerul spune că a avut un plan.",
    );
    if (junk) {
      state.macro.shock -= 0.6;
      state.gov.confidence -= 8;
    }
    if (!down) state.gov.confidence += 3;
  }
}

function migrate(state, thousand) {
  const total = Object.values(state.counties).reduce((s, c) => s + c.pop, 0);
  for (const c of Object.values(state.counties)) {
    const people = (thousand * c.pop) / total;
    for (const [seg, w] of Object.entries(EMIGRANT_POOL)) {
      const moved = Math.min(people * w, c.segments[seg] * 0.02);
      c.segments[seg] -= moved;
      c.segments.diaspora += moved;
    }
  }
}

function seatsOf(state, parties) {
  return [...new Set(parties)].reduce((s, p) => s + (state.parties[p]?.seats ?? 0), 0);
}

function confidenceStep(state, data) {
  const g = state.gov;
  if (g.caretaker) return;
  const supporters = Object.entries(g.support).filter(([, on]) => on).map(([p]) => p);
  const bloc = seatsOf(state, [...g.coalition, ...supporters]) + g.minoritySeats;
  const margin = bloc - (MAJORITY - 1);
  const target =
    55 +
    28 * nationalSat(state) +
    clamp(0.12 * margin, -12, 12) -
    (state.rating.idx < data.government.rating.investmentGrade ? 8 : 0);
  g.confidence = clamp(g.confidence + 0.12 * (target - g.confidence), 0, 100);
  if (g.confidence < 18) fallGovernment(state, data, "Majoritatea din Parlament nu mai are încredere în guvern, iar moțiunea de cenzură trece.");
}

/* ---------------------------------------------------- forming governments */

export function fallGovernment(state, data, cause) {
  const g = state.gov;
  log(state, "coalition", "Guvernul a căzut", cause);
  g.caretaker = true;
  g.confidence = 40;
  state.coalitions = [];
  state.offers = [];
  state.negotiation = { until: state.day + 10, settled: false };
  const old = new Set(g.coalition);
  const ranked = state.partyIds
    .slice()
    .sort((a, b) => (state.parties[b].seats ?? 0) - (state.parties[a].seats ?? 0));
  const designated = ranked.find((p) => !old.has(p)) ?? ranked[0];
  state.pendingBloc = [designated];
  return designated;
}

const MINISTRY_ORDER = ["sanatate", "educatie", "transport", "munca", "aparare", "justitie", "externe", "economie", "agricultura", "energie", "fonduri"];

function bestPolitician(state, partyId, used) {
  const list = Object.values(state.politicians)
    .filter((p) => p.party === partyId && !used.has(p.id) && p.id !== state.leaders[partyId])
    .sort((a, b) => competence(b) - competence(a));
  return list[0]?.id ?? null;
}

export function formGovernment(state, data, bloc) {
  const g = state.gov;
  const seats = (p) => state.parties[p]?.seats ?? 0;
  const pmParty = bloc.slice().sort((a, b) => seats(b) - seats(a))[0];
  const quota = Object.fromEntries(bloc.map((p) => [p, 0]));
  const owner = {};
  for (const id of ["premier", "finante", "interne"]) {
    owner[id] = pmParty;
    quota[pmParty] += 1;
  }
  for (const id of MINISTRY_ORDER) {
    let best = bloc[0];
    for (const p of bloc) if (seats(p) / (quota[p] + 1) > seats(best) / (quota[best] + 1)) best = p;
    owner[id] = best;
    quota[best] += 1;
  }
  const used = new Set();
  const ministries = {};
  const leader = state.leaders[pmParty];
  for (const [id, party] of Object.entries(owner)) {
    let mid = id === "premier" && state.politicians[leader] ? leader : bestPolitician(state, party, used);
    if (mid) used.add(mid);
    ministries[id] = { party, minister: mid };
  }
  g.ministries = ministries;
  g.coalition = [...bloc];
  g.pmParty = pmParty;
  g.pm = state.politicians[leader] ? leader : null;
  g.caretaker = false;
  g.confidence = 58;
  g.support = {};

  // A minority cabinet leans on the closest party that can bring it to a majority.
  let total = seatsOf(state, bloc) + g.minoritySeats;
  if (total < MAJORITY) {
    const candidates = state.partyIds
      .filter((p) => !bloc.includes(p))
      .sort((a, b) => distance(data, pmParty, a) - distance(data, pmParty, b));
    for (const p of candidates) {
      if (total >= MAJORITY) break;
      g.support[p] = true;
      total += seats(p);
    }
  }
  // A new cabinet gets a short honeymoon; laws stay, open proposals do not.
  for (const seg of Object.keys(state.sat)) {
    state.solExpect[seg] = (state.sol[seg] ?? 0) - 3;
  }
  state.proposals = [];
  updateGovMult(state, data);
  log(
    state,
    "coalition",
    "Guvern învestit",
    `${bloc.map((p) => p.toUpperCase()).join(" + ")} preiau cabinetul. Premier: ${state.politicians[g.pm]?.name ?? "o persoană fără partid"}.`,
  );
}

function distance(data, a, b) {
  const pa = find(data.parties.parties, a)?.affinity ?? {};
  const pb = find(data.parties.parties, b)?.affinity ?? {};
  const keys = Object.keys(pa);
  if (!keys.length) return 1;
  let s = 0;
  for (const k of keys) s += ((pa[k] ?? 0.3) - (pb[k] ?? 0.3)) ** 2;
  return Math.sqrt(s / keys.length);
}

/* ---------------------------------------------------------------- actions */

const label = (state, data, action) => {
  const def = (arr, id) => find(arr, id)?.name ?? id;
  const f = (n) => Math.round(n).toLocaleString("ro-RO");
  if (action.type === "setSpend") return `${def(data.government.spendLines, action.line)} → ${f(action.amount)} M€/an`;
  if (action.type === "setTax") return `${def(data.government.taxes, action.tax)} → ${action.rate}%`;
  if (action.type === "policy") return `${action.on === false ? "Abrogă" : "Adoptă"}: ${def(data.policies.policies, action.id)}`;
  return action.type;
};

function ministryOf(state, data, action) {
  if (action.type === "setSpend") return find(data.government.spendLines, action.line)?.ministry;
  if (action.type === "setTax") return find(data.government.taxes, action.tax)?.ministry;
  if (action.type === "policy") return find(data.policies.policies, action.id)?.ministry;
  if (action.type === "appoint") return "premier";
  return null;
}

function actionLean(state, data, action) {
  if (action.type === "policy") return find(data.policies.policies, action.id)?.lean ?? 0;
  if (action.type === "setSpend") {
    const cur = state.budget.ratio[action.line] * state.macro.gdp;
    return action.amount > cur ? 0.5 : -0.5;
  }
  if (action.type === "setTax") return action.rate < state.budget.tax[action.tax] ? 0.4 : -0.4;
  return 0;
}

function cooldownKey(action) {
  if (action.type === "setSpend") return `line:${action.line}`;
  if (action.type === "setTax") return `tax:${action.tax}`;
  if (action.type === "policy") return `policy:${action.id}`;
  return action.type;
}

const CAP = { setSpend: 2, setTax: 8, appoint: 15, repeal: 5 };

// Applies an action with no ownership checks. Caller has already decided who
// is allowed. Returns { ok, message, event? }.
function execute(state, data, partyId, action) {
  const b = state.budget;
  const m = state.macro;
  const gv = state.gov;
  const day = state.day;

  if (action.type === "setSpend") {
    const def = find(data.government.spendLines, action.line);
    if (!def) return { ok: false, error: "Linie de buget necunoscută." };
    const amount = Number(action.amount);
    if (!Number.isFinite(amount)) return { ok: false, error: "Sumă invalidă." };
    const ratio = amount / m.gdp;
    const lo = b.base[def.id] * def.min;
    const hi = b.base[def.id] * def.max;
    if (ratio < lo - 1e-9 || ratio > hi + 1e-9) {
      return { ok: false, error: `${def.name}: între ${Math.round(lo * m.gdp).toLocaleString("ro-RO")} și ${Math.round(hi * m.gdp).toLocaleString("ro-RO")} M€/an.` };
    }
    const before = b.ratio[def.id] * m.gdp;
    b.ratio[def.id] = ratio;
    b.cool[cooldownKey(action)] = day + 20;
    log(state, "budget", `Buget: ${def.name}`, `${Math.round(before).toLocaleString("ro-RO")} → ${Math.round(amount).toLocaleString("ro-RO")} M€/an (${(ratio * 100).toFixed(2).replace(".", ",")}% din PIB).`);
    return { ok: true, message: `${def.name}: ${Math.round(amount).toLocaleString("ro-RO")} M€/an.` };
  }

  if (action.type === "setTax") {
    const def = find(data.government.taxes, action.tax);
    if (!def) return { ok: false, error: "Taxă necunoscută." };
    const rate = Math.round(Number(action.rate));
    if (!Number.isFinite(rate) || rate < def.min || rate > def.max) {
      return { ok: false, error: `${def.name}: între ${def.min}% și ${def.max}%.` };
    }
    const before = b.tax[def.id];
    if (rate === before) return { ok: false, error: "Cota e deja aceasta." };
    b.tax[def.id] = rate;
    m.vatImpulse += def.inflation * (rate - before);
    b.cool[cooldownKey(action)] = day + 30;
    log(state, "budget", `Taxe: ${def.name}`, `${before}% → ${rate}%.`);
    return { ok: true, message: `${def.name}: ${rate}%.` };
  }

  if (action.type === "policy") {
    const p = find(data.policies.policies, action.id);
    if (!p) return { ok: false, error: "Politică necunoscută." };
    if (action.on === false) {
      if (!state.policies[p.id]) return { ok: false, error: "Politica nu este activă." };
      delete state.policies[p.id];
      state.agg = policyAgg(state, data);
      b.cool[cooldownKey(action)] = day + 30;
      log(state, "law", `Abrogată: ${p.name}`, "Măsura iese din vigoare. Cine a rămas fără ea află din Monitorul Oficial.");
      return { ok: true, message: `Ai abrogat „${p.name}”.` };
    }
    if (state.policies[p.id]) return { ok: false, error: "Politica e deja în vigoare." };
    state.policies[p.id] = { since: day };
    state.agg = policyAgg(state, data);
    b.cool[cooldownKey(action)] = day + 30;
    // Partners react to how far the measure is from what they stand for.
    const partners = gv.coalition.filter((q) => q !== partyId);
    if (partners.length) {
      const avg = partners.reduce((s, q) => s + (1 - Math.abs((p.lean ?? 0) - lean(data, q)) / 1.5), 0) / partners.length;
      gv.confidence = clamp(gv.confidence + (avg - 0.55) * 10, 0, 100);
    }
    gv.confidence = clamp(gv.confidence + (p.effects?.confidence ?? 0), 0, 100);
    log(state, "law", `Adoptată: ${p.name}`, p.text);
    return { ok: true, message: `Ai adoptat „${p.name}”.`, event: p.effects?.event };
  }

  if (action.type === "appoint") {
    const pol = state.politicians[action.politician];
    const slot = gv.ministries[action.ministry];
    if (!pol || !slot) return { ok: false, error: "Numire invalidă." };
    const taken = Object.entries(gv.ministries).find(([id, s]) => s.minister === pol.id && id !== action.ministry);
    if (taken) return { ok: false, error: `${pol.name} conduce deja alt minister.` };
    const prevParty = slot.party;
    slot.minister = pol.id;
    slot.party = pol.party ?? null;
    if (action.ministry === "premier") {
      gv.pm = pol.id;
      if (pol.party) gv.pmParty = pol.party;
    }
    if (prevParty && prevParty !== slot.party && gv.coalition.includes(prevParty) && prevParty !== partyId) {
      gv.confidence = clamp(gv.confidence - 4, 0, 100);
    }
    b.cool.appoint = day + 45;
    const min = find(data.government.ministries, action.ministry);
    log(state, "coalition", `Remaniere: ${min?.short ?? action.ministry}`, `${pol.name} preia ministerul.`);
    return { ok: true, message: `${pol.name} conduce acum ${min?.name ?? action.ministry}.` };
  }

  return { ok: false, error: "Acțiune de guvern necunoscută." };
}

function checkCooldown(state, action) {
  const until = state.budget.cool[cooldownKey(action)] ?? -1;
  if (until > state.day) return `Prea devreme. Disponibil în ziua ${until}.`;
  return null;
}

function capitalCost(data, action) {
  if (action.type === "policy") {
    return action.on === false ? CAP.repeal : find(data.policies.policies, action.id)?.capital ?? 20;
  }
  return CAP[action.type] ?? 0;
}

function pay(state, data, partyId, action) {
  const party = state.parties[partyId];
  const cost = capitalCost(data, action);
  if (party.capital < cost) return `Capital politic insuficient (${cost} necesar).`;
  party.capital = round(party.capital - cost, 1);
  return null;
}

export function govAction(state, data, partyId, action) {
  const party = state.parties[partyId];
  if (!party) return { ok: false, error: "Partid necunoscut." };
  const g = state.gov;
  const type = action?.type;

  if (type === "answer") return answerProposal(state, data, partyId, action);
  if (type === "motion") return motion(state, data, partyId);
  if (type === "support") return setSupport(state, data, partyId, action.on !== false);

  if (!["setSpend", "setTax", "policy", "appoint"].includes(type)) {
    return { ok: false, error: "Acțiune de guvern necunoscută." };
  }
  if (g.caretaker) return { ok: false, error: "Guvernul e demis; nicio decizie până la învestitura noului cabinet." };

  const mid = ministryOf(state, data, action);
  const owner = ownerOf(state, mid);
  const cd = checkCooldown(state, action);
  if (cd) return { ok: false, error: cd };

  if (type === "appoint") {
    if (!g.coalition.includes(partyId) || ownerOf(state, "premier") !== partyId) {
      return { ok: false, error: "Doar partidul premierului poate face remanieri." };
    }
    const err = pay(state, data, partyId, action);
    if (err) return { ok: false, error: err };
    return execute(state, data, partyId, action);
  }

  if (owner === partyId) {
    const err = pay(state, data, partyId, action);
    if (err) return { ok: false, error: err };
    return execute(state, data, partyId, action);
  }

  if (!g.coalition.includes(partyId)) {
    return { ok: false, error: "Doar partidele din guvern pot propune măsuri. Opoziția poate depune o moțiune." };
  }

  // Not your ministry: propose it to whoever holds it.
  const err = pay(state, data, partyId, action);
  if (err) return { ok: false, error: err };
  const prop = {
    id: state.nextProposal,
    from: partyId,
    to: owner,
    ministry: mid,
    action,
    label: label(state, data, action),
    day: state.day,
    expires: state.day + 15,
    status: "open",
  };
  state.nextProposal += 1;
  state.proposals.push(prop);
  state.budget.cool[cooldownKey(action)] = state.day + 10;
  const minName = find(data.government.ministries, mid)?.short ?? mid;
  if (owner === null || !state.humans.includes(owner)) {
    decideProposal(state, data, prop);
    return { ok: true, message: prop.status === "accepted" ? `Propunerea a fost acceptată (${minName}).` : `Propunerea a fost respinsă (${minName}).` };
  }
  log(state, "coalition", "Propunere în guvern", `${partyId.toUpperCase()} propune la ${minName}: ${prop.label}.`);
  return { ok: true, message: `Propunere trimisă către ${minName}.` };
}

function decideProposal(state, data, prop) {
  const ownerLean = lean(data, prop.to);
  const agree = 1 - Math.abs(actionLean(state, data, prop.action) - ownerLean) / 1.2;
  let p = clamp(agree, 0.1, 0.9);
  if (prop.from === state.gov.pmParty) p = clamp(p + 0.15, 0.1, 0.95);
  const ok = rand(state) < p;
  const minName = find(data.government.ministries, prop.ministry)?.short ?? prop.ministry;
  if (ok) {
    const res = execute(state, data, prop.to ?? prop.from, prop.action);
    prop.status = res.ok ? "accepted" : "rejected";
    if (!res.ok) prop.reason = res.error;
  } else {
    prop.status = "rejected";
  }
  log(
    state,
    "coalition",
    prop.status === "accepted" ? `Propunere acceptată (${minName})` : `Propunere respinsă (${minName})`,
    `${prop.from.toUpperCase()}: ${prop.label}.`,
  );
}

function answerProposal(state, data, partyId, action) {
  const prop = state.proposals.find((p) => p.id === Number(action.id) && p.status === "open");
  if (!prop || prop.to !== partyId) return { ok: false, error: "Propunerea nu mai există." };
  if (action.accept) {
    const res = execute(state, data, partyId, prop.action);
    prop.status = res.ok ? "accepted" : "rejected";
    if (!res.ok) {
      prop.reason = res.error;
      return { ok: false, error: res.error };
    }
    return { ok: true, message: "Ai acceptat propunerea.", event: res.event };
  }
  prop.status = "rejected";
  log(state, "coalition", "Propunere respinsă", `${partyId.toUpperCase()} a refuzat: ${prop.label}.`);
  return { ok: true, message: "Ai respins propunerea." };
}

function expireProposals(state) {
  for (const p of state.proposals) if (p.status === "open" && state.day > p.expires) p.status = "expired";
  state.proposals = state.proposals.filter((p) => state.day - p.day < 90);
}

function setSupport(state, data, partyId, on) {
  const g = state.gov;
  if (g.coalition.includes(partyId)) return { ok: false, error: "Partidele din guvern nu retrag sprijinul." };
  if (!(partyId in g.support) && on) {
    g.support[partyId] = true;
    return { ok: true, message: "Ai oferit sprijin parlamentar guvernului." };
  }
  if (!(partyId in g.support)) return { ok: false, error: "Nu sprijini guvernul." };
  g.support[partyId] = on;
  g.confidence = clamp(g.confidence + (on ? 3 : -8), 0, 100);
  log(state, "coalition", on ? "Sprijin reînnoit" : "Sprijin retras", `${partyId.toUpperCase()} ${on ? "revine să voteze alături de guvern" : "anunță că nu mai votează alături de guvern"}.`);
  return { ok: true, message: on ? "Ai reînnoit sprijinul." : "Ai retras sprijinul." };
}

function motion(state, data, partyId) {
  const g = state.gov;
  const party = state.parties[partyId];
  if (g.caretaker) return { ok: false, error: "Guvernul e deja demis." };
  if (g.coalition.includes(partyId)) return { ok: false, error: "Partidele din guvern nu depun moțiuni." };
  const until = state.budget.cool.motion ?? -1;
  if (until > state.day) return { ok: false, error: `O moțiune nouă se poate depune din ziua ${until}.` };
  if (party.capital < 25 || party.funds < 1) return { ok: false, error: "Moțiunea costă 25 capital politic și 1 M€." };
  party.capital = round(party.capital - 25, 1);
  party.funds = round(party.funds - 1, 1);
  state.budget.cool.motion = state.day + 120;

  let yes = party.seats ?? 0;
  for (const p of state.partyIds) {
    if (p === partyId || g.coalition.includes(p)) continue;
    if (p in g.support) {
      if (g.support[p] === false) yes += state.parties[p].seats ?? 0;
      continue;
    }
    if (state.humans.includes(p)) continue;
    if (rand(state) < clamp((80 - g.confidence) / 60, 0.05, 0.9)) yes += state.parties[p].seats ?? 0;
  }
  log(state, "coalition", "Moțiune de cenzură", `${partyId.toUpperCase()} depune o moțiune. Se strâng ${yes} de voturi, din 166 necesare.`);
  if (yes >= MAJORITY) {
    fallGovernment(state, data, `Moțiunea depusă de ${partyId.toUpperCase()} a trecut cu ${yes} de voturi.`);
    return { ok: true, message: "Moțiunea a trecut. Guvernul a căzut.", fell: true };
  }
  g.confidence = clamp(g.confidence + 4, 0, 100);
  state.mood[partyId] = clamp((state.mood[partyId] ?? 1) * 0.99, 0.55, 1.6);
  return { ok: true, message: `Moțiunea a eșuat (${yes} voturi).` };
}

/* ----------------------------------------------------------- AI governing */

function aiGovern(state, data) {
  const g = state.gov;
  const b = state.budget;
  const m = state.macro;
  if (g.caretaker) return;
  const toElection = state.electionDay - state.day;
  const electoral = toElection > 0 && toElection < 260;

  for (const min of data.government.ministries) {
    const owner = ownerOf(state, min.id);
    if (owner && state.humans.includes(owner)) continue;
    if (rand(state) > 0.22) continue;
    const l = lean(data, owner);
    const hawkish = m.deficitPct > 5.5 && (l < 0.45 || m.deficitPct > 7.5);
    const dovish = m.deficitPct < 3.2 || (electoral && l > -0.3 && m.deficitPct < 5);

    for (const lineId of min.levers.filter((q) => LINES.includes(q))) {
      if ((b.cool[`line:${lineId}`] ?? -1) > state.day) continue;
      const def = find(data.government.spendLines, lineId);
      const cur = b.ratio[lineId];
      let step = 0;
      if (hawkish) step = -0.04;
      else if (dovish && l > -0.3) step = 0.04;
      if (!step) continue;
      const next = clamp(cur * (1 + step), b.base[lineId] * def.min, b.base[lineId] * def.max);
      if (Math.abs(next - cur) < 1e-6) continue;
      b.ratio[lineId] = next;
      b.cool[`line:${lineId}`] = state.day + 20;
      break;
    }

    if (min.id === "finante" && (b.cool["tax:vat"] ?? -1) <= state.day) {
      const vat = find(data.government.taxes, "vat");
      if (hawkish && b.tax.vat < vat.max - 2 && rand(state) < 0.35) {
        b.tax.vat += 1;
        m.vatImpulse += vat.inflation;
        b.cool["tax:vat"] = state.day + 90;
        log(state, "budget", "Taxe: TVA", `Ministerul Finanțelor majorează TVA la ${b.tax.vat}%.`);
      } else if (dovish && electoral && b.tax.vat > b.tax0.vat - 2 && rand(state) < 0.2) {
        b.tax.vat -= 1;
        b.cool["tax:vat"] = state.day + 90;
        log(state, "budget", "Taxe: TVA", `Ministerul Finanțelor scade TVA la ${b.tax.vat}%.`);
      }
    }

    // Occasionally adopt a measure that fits the ministry and its politics.
    if (rand(state) < 0.2) {
      const options = data.policies.policies.filter(
        (p) => p.ministry === min.id && !state.policies[p.id] && Math.abs((p.lean ?? 0) - l) < 0.7 && (b.cool[`policy:${p.id}`] ?? -1) <= state.day,
      );
      const pick = options[Math.floor(rand(state) * options.length)];
      if (pick && (hawkish ? pick.lean <= 0.2 : true)) {
        const party = owner ? state.parties[owner] : null;
        if (!party || party.capital >= pick.capital) {
          if (party) party.capital = round(party.capital - pick.capital, 1);
          execute(state, data, owner, { type: "policy", id: pick.id, on: true });
        }
      }
    }
  }

  // Support parties lose patience when things go badly.
  for (const [p, on] of Object.entries(g.support)) {
    if (state.humans.includes(p)) continue;
    if (on && g.confidence < 40 && rand(state) < 0.12) setSupport(state, data, p, false);
    else if (!on && g.confidence > 55 && rand(state) < 0.12) setSupport(state, data, p, true);
  }
}

/* -------------------------------------------------------------- history */

const HIST_KEYS = [
  ["growth", (s) => s.macro.growth],
  ["inflation", (s) => s.macro.inflation],
  ["unemployment", (s) => s.macro.unemployment],
  ["deficit", (s) => s.macro.deficitPct],
  ["debt", (s) => (s.macro.debt / s.macro.gdp) * 100],
  ["gdpPps", (s) => s.macro.gdpPps],
  ["rate", (s) => s.macro.rate],
  ["health", (s) => s.metrics.health],
  ["education", (s) => s.metrics.education],
  ["infra", (s) => s.metrics.infra],
  ["safety", (s) => s.metrics.safety],
  ["cpi", (s) => s.metrics.cpi],
  ["arope", (s) => s.metrics.arope],
  ["lifeExp", (s) => s.metrics.lifeExp],
  ["confidence", (s) => s.gov.confidence],
  ["realWage", (s) => (s.macro.wageIdx / s.macro.priceIdx) * 100],
  ["eu_growth", (s) => s.world.countries.eu.v.growth],
  ["eu_inflation", (s) => s.world.countries.eu.v.inflation],
  ["eu_unemployment", (s) => s.world.countries.eu.v.unemployment],
  ["eu_deficit", (s) => s.world.countries.eu.v.deficit],
  ["eu_debt", (s) => s.world.countries.eu.v.debt],
  ["eu_cpi", (s) => s.world.countries.eu.v.cpi],
];

function pushHist(state, data) {
  const h = state.hist;
  h.days.push(state.day);
  for (const [k, fn] of HIST_KEYS) (h.s[k] ??= []).push(round(fn(state), 2));
  for (const [seg, v] of Object.entries(state.sol ?? {})) (h.s[`sol_${seg}`] ??= []).push(round(v, 1));
  const cap = 72;
  if (h.days.length > cap) {
    h.days.shift();
    for (const k of Object.keys(h.s)) h.s[k].shift();
  }
}

/* ------------------------------------------------------------ event hooks */

// Effects with a government flavour, called from the engine's applyEffects.
export function applyGovEffects(state, data, effects, ctx = {}) {
  if (!effects || !state.macro) return;
  const m = state.macro;
  const g = state.gov;
  for (const [k, v] of Object.entries(effects.macro ?? {})) {
    if (k === "growth") m.shock += v;
    if (k === "inflation") m.infShock += v;
    if (k === "unemployment") m.uShock += v;
  }
  for (const [k, v] of Object.entries(effects.metric ?? {})) {
    if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] + v, 0, 100);
  }
  for (const [k, v] of Object.entries(effects.sol ?? {})) state.solMod[k] = (state.solMod[k] ?? 0) + v;
  for (const [k, v] of Object.entries(effects.budget ?? {})) {
    if (k in state.budget.ratio) {
      const base = state.budget.base[k];
      state.budget.ratio[k] = clamp(state.budget.ratio[k] + v / 100, base * 0.5, base * 2);
    }
  }
  if (effects.confidence) g.confidence = clamp(g.confidence + effects.confidence, 0, 100);
  void ctx;
}

/* ------------------------------------------------------------- snapshot */

const r = round;

export function govSnapshot(state, data, opts = {}) {
  const m = state.macro;
  const b = state.budget;
  const x = state.metrics;
  const g = state.gov;
  const ministries = data.government.ministries.map((min) => {
    const slot = g.ministries[min.id] ?? { party: null, minister: null };
    const p = slot.minister ? state.politicians[slot.minister] : null;
    return {
      id: min.id,
      party: slot.party,
      minister: slot.minister,
      name: p?.name ?? null,
      competence: r(competence(p) * 100, 0),
      efficiency: r(efficiency(state, min.id), 2),
    };
  });
  return {
    macro: {
      gdp: r(m.gdp, 0), pop: r(m.pop, 2), growth: r(m.growth, 2), potential: m.potential,
      inflation: r(m.inflation, 2), unemployment: r(m.unemployment, 2), wage: r(m.wage, 0),
      realWage: r((m.wageIdx / m.priceIdx) * 100, 1), pensionIdx: r(m.pensionIdx, 1),
      debt: r(m.debt, 0), debtPct: r((m.debt / m.gdp) * 100, 1), deficitPct: r(m.deficitPct, 2),
      rate: r(m.rate, 2), rateMarg: r(m.rateMarg, 2), gdpPps: r(m.gdpPps, 1), emigration: r(m.emigration, 0),
    },
    rating: {
      level: data.government.rating.levels[state.rating.idx],
      idx: state.rating.idx,
      outlook: state.rating.outlook,
      strain: r(state.rating.strain, 2),
      investmentGrade: state.rating.idx >= data.government.rating.investmentGrade,
    },
    budget: {
      tax: b.tax, tax0: b.tax0, ratio: b.ratio, base: b.base, paid: b.paid,
      flows: b.flows, policy: state.agg.spend, policyRev: state.agg.rev, cool: b.cool,
    },
    metrics: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, r(v, k === "motorwayKm" ? 0 : 1)])),
    sol: Object.fromEntries(Object.entries(state.sol).map(([k, v]) => [k, r(v, 1)])),
    solExpect: Object.fromEntries(Object.entries(state.solExpect).map(([k, v]) => [k, r(v, 1)])),
    sat: Object.fromEntries(Object.entries(state.sat).map(([k, v]) => [k, r(v, 2)])),
    comp: Object.fromEntries(Object.entries(state.comp).map(([k, v]) => [k, r(v, 3)])),
    gov: {
      pm: g.pm, pmParty: g.pmParty, coalition: g.coalition, support: g.support,
      confidence: r(g.confidence, 0), caretaker: g.caretaker, minoritySeats: g.minoritySeats,
      approval: r(clamp(50 + 40 * nationalSat(state), 0, 100), 0), ministries,
    },
    policies: Object.fromEntries(Object.entries(state.policies).map(([id, v]) => [id, v.since])),
    proposals: state.proposals.map((p) => ({
      id: p.id, from: p.from, to: p.to, ministry: p.ministry, label: p.label, day: p.day,
      expires: p.expires, status: p.status, reason: p.reason ?? null,
    })),
    hist: opts.hist === false ? undefined : state.hist,
  };
}
