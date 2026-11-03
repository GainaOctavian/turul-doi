// Turul Doi game engine. Pure functions over a plain JSON state so it can run
// in the browser (solo) and on the server (multiplayer) from the same code.
//
// Layers: this file = parties, polls, elections, events, campaign actions.
// gov.mjs = budget, metrics, standard of living, cabinet. world.mjs = EU + countries.
import { clamp, rand, log, round, dateAt, dayOf, partyDef } from "./util.mjs";
import { initParl, parlDaily, parlMonthly, parlSnapshot, distance, splitParty } from "./parl.mjs";
import { initWorld, worldMonthly, worldView } from "./world.mjs";
import {
  initGov,
  govMonthly,
  govAction,
  govSnapshot,
  applyGovEffects,
  formGovernment,
  fallGovernment,
} from "./gov.mjs";

// Costs are in million euro (M€), the same unit as the state budget.
export const ACTIONS = [
  { id: "rally", name: "Campanie în județ", desc: "Echipe în teren și o săptămână de întâlniri cu primarii. Bun la rural, slab la oraș.", cost: 0.9, cooldown: 4, target: "county" },
  { id: "tv", name: "Campanie TV", desc: "Spoturi și invitații la televiziune, cu întrebări despre pensii.", cost: 1.2, cooldown: 6, target: "none" },
  { id: "online", name: "Campanie online", desc: "Clipuri scurte, promisiuni lungi.", cost: 0.6, cooldown: 3, target: "none" },
  { id: "deal", name: "Înțelegere locală", desc: "Un baron local primește ceva, tu primești județul. Risc de scandal.", cost: 1.9, cooldown: 9, target: "county" },
  { id: "attack", name: "Atac la adversar", desc: "Scoate din influența unui rival într-un județ.", cost: 1.0, cooldown: 5, target: "county-party" },
  { id: "promise", name: "Promisiune electorală", desc: "Promite tot, nu costă nimic acum.", cost: 1.4, cooldown: 7, target: "none" },
];

// Opposition and outside-parliament actions. `need`: "opp" = not in government,
// "outside" = no seats, "any" = everyone. "party" targets need a rival.
ACTIONS.push(
  { id: "inquiry", name: "Anchetă parlamentară", desc: "Cere explicații în comisii. Guvernul pierde din imagine, opoziția câștigă din vizibilitate.", cost: 1.1, cooldown: 10, target: "none", need: "opp" },
  { id: "protest", name: "Protest în stradă", desc: "Oameni în piață, afișe, lanțuri umane. Mai mult efect când oamenii sunt deja nemulțumiți.", cost: 0.5, cooldown: 5, target: "county", need: "any" },
  { id: "signatures", name: "Strângere de semnături", desc: "Petiție pentru un referendum. Fără mandate, e singura cale să te vadă lumea.", cost: 0.3, cooldown: 20, target: "none", need: "outside" },
  { id: "foundation", name: "Fundație în județ", desc: "Ajutoare, burse și caravane medicale. Lent, dar durabil.", cost: 1.6, cooldown: 30, target: "county", need: "any" },
  { id: "exposure", name: "Dezvăluire", desc: "Documente despre un rival, publicate într-o zi. 30% din cazuri se întorc împotriva ta.", cost: 0.7, cooldown: 12, target: "party", need: "opp" },
);

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

const SEGMENT_SHARE = {
  pensionari_rural: (c) => 0.26 * (1 - c.urban),
  pensionari_urban: (c) => 0.2 * c.urban,
  tineri_urbani: (c) => 0.13 * c.urban,
  studenti: (c) => 0.02 + 0.05 * c.students,
  muncitori: (c) => 0.09 + 0.11 * c.industry,
  agricultori: (c) => 0.08 + 0.17 * c.agriculture,
  antreprenori: (c) => 0.04 + 0.06 * c.urban,
  bugetari: () => 0.09,
  someri: (c) => 0.04 + 0.03 * (1 - c.industry),
  diaspora: (c) => 0.05 + 0.12 * c.diaspora,
};

export function buildSegments(county) {
  const raw = {};
  let sum = 0;
  for (const [id, fn] of Object.entries(SEGMENT_SHARE)) {
    const v = Math.max(0.005, fn(county));
    raw[id] = v;
    sum += v;
  }
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    out[id] = Math.round((v / sum) * county.pop * 10) / 10;
  }
  return out;
}

const money = (v) => Math.round(v * 100) / 100;

// The parties that exist in this game's scenario (2017 has ALDE and PMP, 2026 has AUR).
function plist(state, data) {
  return state.partyIds.map((id) => partyDef(state, data, id));
}

function scaleSeats(map, total) {
  const sum = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  const exact = Object.entries(map).map(([id, n]) => ({ id, v: (n / sum) * total }));
  const out = Object.fromEntries(exact.map((e) => [e.id, Math.floor(e.v)]));
  let left = total - Object.values(out).reduce((a, b) => a + b, 0);
  for (const e of exact.slice().sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)))) {
    if (left <= 0) break;
    out[e.id] += 1;
    left -= 1;
  }
  return out;
}

export function scenarioOf(data, id) {
  const list = data.scenarios.scenarios;
  return list.find((s) => s.id === id) ?? list[0];
}

export function createGame(data, opts = {}) {
  const cfg = data.config;
  const sc = scenarioOf(data, opts.scenario ?? "2026");

  const counties = {};
  for (const c of data.counties.counties) {
    counties[c.id] = { id: c.id, name: c.name, pop: c.pop, segments: buildSegments(c), boost: {} };
  }

  const politicians = {};
  for (const p of data.politicians.politicians) {
    const ov = p.scenarios?.[sc.id];
    if (!ov) continue;
    politicians[p.id] = {
      id: p.id,
      name: p.name,
      party: ov.party !== undefined ? ov.party : p.party,
      role: ov.role ?? p.role,
      stats: { ...(ov.stats ?? p.stats) },
      ability: ov.ability !== undefined ? ov.ability : p.ability,
      facts: ov.facts ?? p.facts,
      look: p.look,
    };
  }

  const target = {};
  const tsum = Object.values(sc.startPoll).reduce((a, b) => a + b, 0);
  for (const id of sc.parties) target[id] = (sc.startPoll[id] ?? 0.05) / tsum;

  const parties = {};
  const seats = scaleSeats(sc.parliament, cfg.totalSeats - (sc.minoritySeats ?? 0));
  for (const id of sc.parties) {
    parties[id] = {
      id,
      funds: money(cfg.startFunds * (0.6 + 2 * target[id])),
      capital: cfg.startCapital,
      boost: {},
      segBoost: {},
      cooldown: {},
      seats: seats[id] ?? 0,
      share: target[id],
      gov: sc.government.coalition.includes(id),
    };
  }

  const state = {
    version: 2,
    scenario: sc.id,
    day: 0,
    date: sc.startDate,
    speed: 1,
    phase: "government",
    electionDay: dayOf(sc.startDate, sc.electionDate),
    resultUntil: -1,
    rng: (opts.seed ?? Date.now()) >>> 0,
    config: {
      totalSeats: cfg.totalSeats,
      minoritySeats: sc.minoritySeats ?? 0,
      startDate: sc.startDate,
      tickMs: cfg.tickMs,
      maxLog: cfg.maxLog,
      termDays: cfg.termDays ?? 1461,
    },
    partyIds: [...sc.parties],
    leaders: { ...sc.leaders },
    strength: Object.fromEntries(sc.parties.map((id) => [id, 1])),
    counties,
    parties,
    politicians,
    mood: Object.fromEntries(sc.parties.map((id) => [id, 1])),
    govMult: null,
    coalitions: [],
    offers: [],
    negotiation: null,
    pendingBloc: null,
    humans: opts.humans ?? [],
    active: null,
    lastResult: null,
    recentEvents: [],
    fired: {},
    decisions: [],
    nextDecision: 1,
    log: [],
  };

  calibrate(state, data, target);
  initWorld(state, data, sc);
  initGov(state, data, sc);
  initParl(state);

  log(state, "system", sc.name, sc.blurb);
  return state;
}

// Pulls each party's strength until the national poll matches the scenario's
// starting numbers, while the county biases keep the regional shape.
function calibrate(state, data, target) {
  for (let i = 0; i < 60; i += 1) {
    const poll = computePoll(state, data);
    let err = 0;
    for (const id of state.partyIds) {
      const have = Math.max(poll.national[id], 1e-6);
      state.strength[id] *= Math.pow(target[id] / have, 0.7);
      err = Math.max(err, Math.abs(target[id] - poll.national[id]));
    }
    if (err < 0.0012) break;
  }
}

export function dateOf(state) {
  return dateAt(state.config.startDate, state.day);
}

function decay(state) {
  for (const c of Object.values(state.counties)) {
    for (const p of Object.keys(c.boost)) {
      c.boost[p] *= 0.97;
      if (Math.abs(c.boost[p]) < 0.001) delete c.boost[p];
    }
  }
  for (const p of Object.values(state.parties)) {
    for (const s of Object.keys(p.segBoost)) {
      p.segBoost[s] = 1 + (p.segBoost[s] - 1) * 0.98;
      if (Math.abs(p.segBoost[s] - 1) < 0.001) delete p.segBoost[s];
    }
  }
}

function income(state, data) {
  const poll = computePoll(state, data);
  for (const p of Object.values(state.parties)) {
    const share = poll.national[p.id] ?? 0;
    // Party money in M€: roughly 7–15 M€ a year for a big party, plus donations.
    p.funds = money(p.funds + 0.02 + share * 0.1);
    p.capital = round(p.capital + 0.25 + share * 0.5, 2);
  }
}

export function computePoll(state, data) {
  const parties = plist(state, data);
  const national = {};
  for (const p of parties) national[p.id] = 0;
  const counties = {};
  let totalPop = 0;

  for (const c of Object.values(state.counties)) {
    totalPop += c.pop;
    const scores = {};
    let total = 0;
    for (const p of parties) {
      let s = 0;
      const gm = state.govMult?.[p.id];
      for (const seg of data.segments.segments) {
        const size = c.segments[seg.id] ?? 0;
        const aff = p.affinity[seg.id] ?? 0.3;
        const sb = state.parties[p.id].segBoost[seg.id] ?? 1;
        s += size * aff * sb * (gm?.[seg.id] ?? 1);
      }
      s *=
        (state.strength[p.id] ?? 1) *
        (p.bias?.[c.id] ?? 1) *
        (state.mood[p.id] ?? 1) *
        (1 + (c.boost[p.id] ?? 0));
      scores[p.id] = Math.max(0.0001, s);
      total += scores[p.id];
    }
    counties[c.id] = {};
    for (const p of parties) {
      const share = scores[p.id] / total;
      counties[c.id][p.id] = share;
      national[p.id] += share * c.pop;
    }
  }

  for (const p of parties) national[p.id] = totalPop ? national[p.id] / totalPop : 0;
  const seats = allocateSeats(state, data, national, counties);
  return { national, counties, seats };
}

// Every party runs its own list. It gets in with 5% nationally, or with 20% in four counties.
const THRESHOLD = 0.05;

export function lists(state, national, counties) {
  return state.partyIds.map((id) => {
    const share = national[id] ?? 0;
    const strongCounties = counties ? Object.values(counties).filter((c) => (c[id] ?? 0) >= 0.2).length : 0;
    return { parties: [id], share, need: THRESHOLD, strongCounties, passes: share >= THRESHOLD || strongCounties >= 4 };
  });
}

function allocateSeats(state, data, national, counties) {
  const parties = plist(state, data);
  const totalSeats = state.config.totalSeats - state.config.minoritySeats;
  const seats = Object.fromEntries(parties.map((p) => [p.id, 0]));
  const eligible = lists(state, national, counties).filter((l) => l.passes);
  if (eligible.length === 0) return seats;

  // National D'Hondt between lists: simple, proportional and easy to read next to the
  // poll bars. County results still drive the campaign and colour the map.
  const won = eligible.map(() => 0);
  for (let i = 0; i < totalSeats; i += 1) {
    let best = 0;
    let bestV = -1;
    eligible.forEach((l, k) => {
      const v = l.share / (won[k] + 1);
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    });
    won[best] += 1;
  }
  eligible.forEach((l, k) => {
    seats[l.parties[0]] = won[k];
  });
  return seats;
}

function addCountyBoost(state, countyId, partyId, amount) {
  const c = state.counties[countyId];
  if (!c || !state.parties[partyId]) return;
  c.boost[partyId] = clamp((c.boost[partyId] ?? 0) + amount, -0.7, 1.2);
}

function addSegBoost(state, partyId, segId, factor) {
  const p = state.parties[partyId];
  if (!p) return;
  p.segBoost[segId] = clamp((p.segBoost[segId] ?? 1) * factor, 0.55, 1.9);
}

// The leader's ability counts in full; every other party member adds a third of theirs.
function abilityFactor(state, partyId, segId) {
  const leader = state.leaders[partyId];
  let factor = state.politicians[leader]?.ability?.effect?.[segId] ?? 1;
  for (const p of Object.values(state.politicians)) {
    if (p.party !== partyId || p.id === leader) continue;
    const m = p.ability?.effect?.[segId];
    if (m) factor *= 1 + (m - 1) * 0.3;
  }
  return factor;
}

// Resizes segments in one county. `segments` scales a segment, `convert` moves
// a share of one segment into another (population is conserved).
function shiftSegments(c, spec) {
  for (const [seg, delta] of Object.entries(spec.segments ?? {})) {
    if (!(seg in c.segments)) continue;
    c.segments[seg] = Math.max(0.5, c.segments[seg] * (1 + delta));
  }
  for (const rule of spec.convert ?? []) {
    const from = c.segments[rule.from];
    const to = c.segments[rule.to];
    if (from == null || to == null) continue;
    const moved = from * rule.share;
    c.segments[rule.from] = Math.max(0.5, from - moved);
    c.segments[rule.to] = to + moved;
  }
}

// Effect keys: segments, convert (everywhere); county (only the named counties,
// with their own segments/convert/party); party (national mood); countyParty;
// funds (M€); segBoost and countyBoostAll (the acting party); politician.
// Governance keys (see gov.mjs): macro, metric, confidence, sol, budget.
// "self" stands for the acting party; "gov"/"opp" for the governing/other parties.
export function applyEffects(state, data, effects, ctx = {}) {
  if (!effects) return;
  const who = (key) => {
    if (key === "self") return ctx.partyId ? [ctx.partyId] : [];
    if (key === "gov") return state.gov.coalition;
    if (key === "opp") return state.partyIds.filter((p) => !state.gov.coalition.includes(p));
    return [key];
  };

  for (const c of Object.values(state.counties)) shiftSegments(c, effects);
  noteCauses(state, ctx, effects);

  for (const [cid, spec] of Object.entries(effects.county ?? {})) {
    const c = state.counties[cid];
    if (!c) continue;
    shiftSegments(c, spec);
    for (const [key, amount] of Object.entries(spec.party ?? {})) {
      for (const pid of who(key)) addCountyBoost(state, cid, pid, amount);
    }
  }

  if (effects.party) {
    for (const [key, delta] of Object.entries(effects.party)) {
      for (const pid of who(key)) {
        if (!(pid in state.mood)) continue;
        state.mood[pid] = clamp((state.mood[pid] ?? 1) * (1 + delta), 0.55, 1.6);
      }
    }
  }

  if (effects.countyParty) {
    for (const [cid, parties] of Object.entries(effects.countyParty)) {
      for (const [key, amount] of Object.entries(parties)) {
        for (const pid of who(key)) addCountyBoost(state, cid, pid, amount);
      }
    }
  }

  if (effects.segBoost && ctx.partyId) {
    for (const [seg, factor] of Object.entries(effects.segBoost)) addSegBoost(state, ctx.partyId, seg, factor);
  }

  if (effects.funds) {
    for (const [key, amount] of Object.entries(effects.funds)) {
      for (const target of who(key)) {
        if (state.parties[target]) state.parties[target].funds = money(state.parties[target].funds + amount);
      }
    }
  }

  if (effects.countyBoostAll && ctx.partyId) {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, ctx.partyId, effects.countyBoostAll);
  }

  if (effects.politician) {
    const p = state.politicians[effects.politician.id];
    if (p) {
      const stat = effects.politician.stat;
      p.stats[stat] = clamp((p.stats[stat] ?? 0) + effects.politician.delta, 0, 100);
    }
  }

  applyGovEffects(state, data, effects, ctx);
}

const CHAIN_WINDOW = 45;

function recentlyFired(state, id) {
  const day = state.fired[id];
  return day != null && state.day - day <= CHAIN_WINDOW;
}

// An event with `after: "<id>"` is a follow-up: it only appears within
// CHAIN_WINDOW days of its cause, and four times as likely as a normal one.
function pickEvent(state, data) {
  const pool = data.events.events
    .filter((e) => (e.minDay ?? 0) <= state.day && !state.recentEvents.includes(e.id))
    .filter((e) => !e.scenarios || e.scenarios.includes(state.scenario))
    .filter((e) => !e.months || e.months.includes(Number(state.date.slice(5, 7))))
    .filter((e) => !e.after || recentlyFired(state, e.after))
    .map((e) => ({ e, w: (e.weight ?? 1) * (e.after ? 4 : 1) }));
  // News does not repeat until everything that fits the moment has been told once.
  const fresh = pool.filter((x) => state.fired[x.e.id] == null);
  if (fresh.length) pool.splice(0, pool.length, ...fresh);
  const total = pool.reduce((s, x) => s + x.w, 0);
  if (!pool.length || total <= 0) return null;
  let r = rand(state) * total;
  for (const x of pool) {
    r -= x.w;
    if (r <= 0) return x.e;
  }
  return pool[pool.length - 1].e;
}

export function fireEvent(state, data, eventId) {
  const ev = eventId ? data.events.events.find((e) => e.id === eventId) : pickEvent(state, data);
  if (!ev) return null;
  applyEffects(state, data, ev.effects, { title: ev.title });
  state.recentEvents.push(ev.id);
  if (state.recentEvents.length > 14) state.recentEvents.shift();
  state.fired[ev.id] = state.day;
  state.active = { ...ev, day: state.day };
  log(state, "event", ev.title, ev.text);

  // Events with `choices` hand every human player a decision to answer.
  if (ev.choices?.length) {
    for (const partyId of state.humans) {
      if (!state.parties[partyId]) continue;
      state.decisions.push({
        id: state.nextDecision,
        party: partyId,
        eventId: ev.id,
        day: state.day,
        expires: state.day + (ev.expires ?? 8),
      });
      state.nextDecision += 1;
    }
  }
  return ev;
}

export function decide(state, data, partyId, decisionId, choiceIndex) {
  const d = state.decisions.find((x) => x.id === Number(decisionId) && x.party === partyId);
  if (!d) return { ok: false, error: "Decizia nu mai există." };
  if (d.defection) return decideDefection(state, data, d, Number(choiceIndex));
  const ev = data.events.events.find((e) => e.id === d.eventId);
  const choice = ev?.choices?.[Number(choiceIndex)];
  if (!choice) return { ok: false, error: "Alegere invalidă." };
  const party = state.parties[partyId];
  const cost = choice.cost ?? 0;
  if (party.funds < cost) return { ok: false, error: `Fonduri insuficiente (${cost} M€ necesari).` };
  party.funds = money(party.funds - cost);
  applyEffects(state, data, choice.effects, { partyId, title: ev.title });
  state.decisions = state.decisions.filter((x) => x !== d);
  log(state, "decision", `${partyId.toUpperCase()}: ${choice.label}`, choice.text ?? ev.title);
  return { ok: true, message: choice.text ?? `Ai ales „${choice.label}”.` };
}

function leaderId(state, partyId) {
  return state.leaders[partyId];
}

function aiTurn(state, data, partyId) {
  const party = state.parties[partyId];
  if (!party) return;
  const poll = computePoll(state, data);
  const leader = Object.entries(poll.national).sort((a, b) => b[1] - a[1])[0][0];
  const counties = Object.keys(state.counties);
  const randomCounty = () => counties[Math.floor(rand(state) * counties.length)];
  const cost = (id) => ACTION_BY_ID[id].cost;
  const ready = (id) => (party.cooldown[id] ?? -1) <= state.day && party.funds >= cost(id);
  const r = rand(state);

  if (r < 0.12 && ready("deal")) {
    const cid = counties
      .slice()
      .sort((a, b) => (poll.counties[b][partyId] ?? 0) - (poll.counties[a][partyId] ?? 0))[3];
    applyAction(state, data, partyId, { type: "deal", county: cid || randomCounty() });
    return;
  }
  if (r < 0.38 && ready("attack") && leader !== partyId) {
    applyAction(state, data, partyId, { type: "attack", county: randomCounty(), targetParty: leader });
    return;
  }
  if (r < 0.72 && ready("rally")) {
    const cid = counties
      .slice()
      .sort((a, b) => (poll.counties[b][partyId] ?? 0) - (poll.counties[a][partyId] ?? 0))[0];
    applyAction(state, data, partyId, { type: "rally", county: cid || randomCounty() });
    return;
  }
  if (ready("online")) applyAction(state, data, partyId, { type: "online" });
  else if (ready("tv")) applyAction(state, data, partyId, { type: "tv" });
}

export function applyAction(state, data, partyId, action) {
  const def = ACTION_BY_ID[action?.type];
  const party = state.parties[partyId];
  if (!def) return { ok: false, error: "Acțiune necunoscută." };
  if (!party) return { ok: false, error: "Partid necunoscut." };
  if ((party.cooldown[def.id] ?? -1) > state.day) {
    return { ok: false, error: `Prea devreme. Disponibil în ziua ${party.cooldown[def.id]}.` };
  }
  if (party.funds < def.cost) {
    return { ok: false, error: `Fonduri insuficiente (${def.cost} M€ necesari).` };
  }
  if (def.target === "county" && !state.counties[action.county]) {
    return { ok: false, error: "Alege un județ." };
  }
  if (def.target === "county-party") {
    if (!state.counties[action.county]) return { ok: false, error: "Alege un județ." };
    if (!state.parties[action.targetParty] || action.targetParty === partyId) {
      return { ok: false, error: "Alege un partid rival." };
    }
  }

  if (def.need === "opp" && inCoalition(state, partyId)) {
    return { ok: false, error: "Doar partidele din opoziție pot face asta." };
  }
  if (def.need === "outside" && (party.seats ?? 0) > 0) {
    return { ok: false, error: "Doar partidele fără mandate pot strânge semnături." };
  }
  if (def.target === "party") {
    if (!state.parties[action.targetParty] || action.targetParty === partyId) return { ok: false, error: "Alege un partid rival." };
  }
  party.funds = money(party.funds - def.cost);
  party.cooldown[def.id] = state.day + def.cooldown;
  const leader = leaderId(state, partyId);
  const countyName = action.county ? state.counties[action.county].name : "";
  const boostSegs = (map) => {
    for (const [seg, base] of Object.entries(map)) {
      addSegBoost(state, partyId, seg, 1 + (base - 1) * abilityFactor(state, partyId, seg));
    }
  };

  if (def.id === "rally") {
    addCountyBoost(state, action.county, partyId, 0.16);
    boostSegs({ pensionari_rural: 1.05, agricultori: 1.04, muncitori: 1.03, pensionari_urban: 1.02, tineri_urbani: 1.01 });
    log(state, "action", `Campanie la ${countyName}`, `${state.politicians[leader]?.name ?? partyId} a vorbit în fața a 2.000 de oameni și a 40 de jandarmi.`);
    return { ok: true, message: `Campanie organizată la ${countyName}.` };
  }

  if (def.id === "tv") {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, partyId, 0.03);
    addSegBoost(state, partyId, "pensionari_urban", 1.04);
    addSegBoost(state, partyId, "pensionari_rural", 1.02);
    addSegBoost(state, partyId, "bugetari", 1.015);
    log(state, "action", "Campanie TV", `${state.politicians[leader]?.name ?? partyId} a explicat bugetul în 12 minute și a primit încă 12.`);
    return { ok: true, message: "Campania TV a început." };
  }

  if (def.id === "online") {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, partyId, 0.02);
    boostSegs({ tineri_urbani: 1.05, studenti: 1.05, antreprenori: 1.02, diaspora: 1.02 });
    log(state, "action", "Campanie online", "Un clip de 15 secunde a strâns mai multe voturi decât un discurs de o oră.");
    return { ok: true, message: "Campania online a pornit." };
  }

  if (def.id === "deal") {
    addCountyBoost(state, action.county, partyId, 0.34);
    addSegBoost(state, partyId, "bugetari", 1.02);
    addSegBoost(state, partyId, "agricultori", 1.02);
    if (rand(state) < 0.3) {
      state.mood[partyId] = clamp((state.mood[partyId] ?? 1) * 0.97, 0.55, 1.6);
      log(state, "scandal", `Scandal la ${countyName}`, "O înregistrare a apărut pe internet. Nimeni nu recunoaște vocea, dar toți recunosc tonul.");
      return { ok: true, message: `Înțelegere făcută la ${countyName}, dar a apărut un scandal.` };
    }
    log(state, "action", `Înțelegere la ${countyName}`, "Un consilier local a trecut la partidul tău. A doua zi a trecut înapoi, dar poza a rămas.");
    return { ok: true, message: `Ai câștigat influență la ${countyName}.` };
  }

  if (def.id === "attack") {
    addCountyBoost(state, action.county, partyId, 0.02);
    addCountyBoost(state, action.county, action.targetParty, -0.22);
    log(state, "action", `Atac la ${countyName}`, `${partyId.toUpperCase()} a spus despre ${action.targetParty.toUpperCase()} că „nu are plan”. Planul lor a fost publicat a doua zi.`);
    return { ok: true, message: `Ai atacat ${action.targetParty.toUpperCase()} la ${countyName}.` };
  }

  if (def.id === "promise") {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, partyId, 0.025);
    boostSegs({ antreprenori: 1.03, pensionari_rural: 1.02, tineri_urbani: 1.02, agricultori: 1.02 });
    log(state, "action", "Promisiune electorală", "S-a promis o autostradă, un spital și o grădiniță. Toate în același loc.");
    return { ok: true, message: "Promisiunea a fost făcută." };
  }

  if (def.id === "inquiry") {
    for (const p of state.partyIds) if (inCoalition(state, p)) state.mood[p] = clamp((state.mood[p] ?? 1) * 0.99, 0.55, 1.6);
    boostSegs({ bugetari: 1.03, tineri_urbani: 1.03, pensionari_urban: 1.02 });
    noteCauses(state, { partyId, title: "Anchetă parlamentară" }, { segments: { bugetari: 0.01, tineri_urbani: 0.01 } });
    log(state, "action", "Anchetă parlamentară", "Comisia a cerut documentele, ministerul le-a trimis în ultimul moment.");
    return { ok: true, message: "Ancheta a fost depusă." };
  }

  if (def.id === "protest") {
    // Protests work best when people are already unhappy: the average satisfaction scales the crowd.
    const mood = Object.values(state.sat ?? {});
    const avgSat = mood.length ? mood.reduce((a, b) => a + b, 0) / mood.length : 0;
    const crowd = avgSat < 0 ? 1.5 : avgSat < 0.2 ? 1 : 0.7;
    addCountyBoost(state, action.county, partyId, 0.1 * crowd);
    boostSegs({ muncitori: 1.04, tineri_urbani: 1.05 });
    for (const p of state.partyIds) if (inCoalition(state, p)) state.mood[p] = clamp((state.mood[p] ?? 1) * 0.995, 0.55, 1.6);
    noteCauses(state, { partyId, title: "Protest în stradă" }, { segments: { muncitori: 0.01, tineri_urbani: 0.01 } });
    log(state, "action", `Protest la ${countyName}`, "Câteva sute de oameni, un megafon și o piață care s-a golit devreme.");
    return { ok: true, message: `Protest organizat la ${countyName}.` };
  }

  if (def.id === "signatures") {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, partyId, 0.02);
    state.mood[partyId] = clamp((state.mood[partyId] ?? 1) * 1.02, 0.55, 1.6);
    boostSegs({ tineri_urbani: 1.03, studenti: 1.03 });
    log(state, "action", "Strângere de semnături", "Petiția a trecut pragul. Ce urmează să fie cu ea, rămâne de văzut.");
    return { ok: true, message: "Semnăturile au fost depuse." };
  }

  if (def.id === "foundation") {
    addCountyBoost(state, action.county, partyId, 0.18);
    boostSegs({ pensionari_rural: 1.04, pensionari_urban: 1.02, agricultori: 1.02 });
    log(state, "action", `Fundație la ${countyName}`, "Ajutoarele au ajuns la oamenii care le așteptau de luni de zile.");
    return { ok: true, message: `Fundația a deschis un birou la ${countyName}.` };
  }

  if (def.id === "exposure") {
    const target = action.targetParty;
    state.mood[target] = clamp((state.mood[target] ?? 1) * 0.975, 0.55, 1.6);
    if (rand(state) < 0.3) {
      state.mood[partyId] = clamp((state.mood[partyId] ?? 1) * 0.985, 0.55, 1.6);
      log(state, "scandal", "Dezvăluirea s-a întors", `Documentele despre ${target.toUpperCase()} s-au dovedit a fi, în parte, ale tale.`);
      return { ok: true, message: "Dezvăluirea s-a întors împotriva ta." };
    }
    log(state, "action", `Dezvăluire despre ${target.toUpperCase()}`, "Documentele au apărut într-o singură zi, cu un titlu care a rămas toată săptămâna.");
    return { ok: true, message: `Ai publicat documentele despre ${target.toUpperCase()}.` };
  }

  return { ok: false, error: "Acțiune necunoscută." };
}

// Government decisions (budget, taxes, policies, cabinet, motions). See gov.mjs.
export { applyParl, consumeRenamed, splinterOptions, relation, lobbyPrice } from "./parl.mjs";

export function applyGov(state, data, partyId, action) {
  const res = govAction(state, data, partyId, action);
  if (res.ok && res.event) fireEvent(state, data, res.event);
  flushPending(state, data);
  return res;
}

function flushPending(state, data) {
  if (!state.pendingBloc) return;
  const bloc = state.pendingBloc;
  state.pendingBloc = null;
  setGovernment(state, data, bloc);
}

/* ------------------------------------------------------------ coalitions */

export function offerCoalition(state, data, from, to) {
  if (!state.parties[from] || !state.parties[to] || from === to) {
    return { ok: false, error: "Partid invalid." };
  }
  if (state.offers.some((o) => o.from === from && o.to === to)) {
    return { ok: false, error: "Oferta există deja." };
  }
  state.offers.push({ from, to, day: state.day });
  log(state, "coalition", "Ofertă de coaliție", `${from.toUpperCase()} a invitat ${to.toUpperCase()} la guvernare.`);
  return { ok: true, message: "Oferta a fost trimisă." };
}

export function acceptCoalition(state, data, to, from) {
  const offer = state.offers.find((o) => o.from === from && o.to === to);
  if (!offer) return { ok: false, error: "Nu există ofertă." };
  state.offers = state.offers.filter((o) => o !== offer);

  // Signing with a party that already has a protocol merges the blocs, so a
  // three-party majority can be built one signature at a time.
  const involved = state.coalitions.filter((c) => c.parties.includes(from) || c.parties.includes(to));
  const parties = new Set([from, to]);
  for (const c of involved) for (const p of c.parties) parties.add(p);
  state.coalitions = state.coalitions.filter((c) => !involved.includes(c));
  state.coalitions.push({ parties: [...parties], day: state.day });

  log(
    state,
    "coalition",
    "Coaliție formată",
    `${[...parties].map((p) => p.toUpperCase()).join(" + ")} au semnat un protocol cu 14 pagini și zero promisiuni.`,
  );
  return { ok: true, message: "Coaliția a fost formată." };
}

// Seats of a bloc, with the minorities' group standing behind any government.
function blocSeats(state, ids) {
  return [...new Set(ids)].reduce((s, id) => s + (state.parties[id]?.seats ?? 0), 0);
}

function majorityOk(state, ids) {
  const need = Math.floor(state.config.totalSeats / 2) + 1;
  return blocSeats(state, ids) + state.config.minoritySeats >= need;
}

function canJoin(state, data, from, to) {
  const blocA = state.coalitions.find((c) => c.parties.includes(from));
  const blocB = state.coalitions.find((c) => c.parties.includes(to));
  const parties = new Set([...(blocA ? blocA.parties : [from]), ...(blocB ? blocB.parties : [to])]);
  if (parties.size > 4) return false;
  if (blocSeats(state, [...parties]) > 300) return false;
  return distance(state, data, from, to) <= 0.28;
}

function setGovernment(state, data, gov) {
  for (const id of state.partyIds) state.parties[id].gov = gov.includes(id);
  formGovernment(state, data, gov);
  if (state.lastResult) state.lastResult.gov = gov;
  return gov;
}

// The ten days after an election (or a fallen cabinet) are for negotiations. A
// bloc that reaches a majority takes the government immediately; otherwise the
// designated party governs alone, leaning on whoever supports it.
function negotiationStep(state, data) {
  const neg = state.negotiation;
  if (!neg) return;

  const valid = state.coalitions
    .filter((c) => majorityOk(state, c.parties))
    .sort((a, b) => blocSeats(state, b.parties) - blocSeats(state, a.parties));

  if (!neg.settled && valid.length) {
    neg.settled = true;
    setGovernment(state, data, valid[0].parties);
    log(
      state,
      "coalition",
      "Guvern format",
      `${valid[0].parties.map((p) => p.toUpperCase()).join(" + ")} au anunțat că au o majoritate „confortabilă”.`,
    );
  }

  if (state.day >= neg.until) {
    if (!neg.settled) {
      log(state, "coalition", "Guvern minoritar", "Negocierile au eșuat. Partidul desemnat guvernează singur și promite că se descurcă.");
    }
    state.negotiation = null;
    state.offers = [];
  }
}

function aiCoalitionOffers(state, data) {
  const parties = plist(state, data)
    .slice()
    .sort((a, b) => state.parties[b.id].seats - state.parties[a.id].seats);

  for (const p of parties) {
    if (state.humans.includes(p.id)) continue;
    if ((state.parties[p.id]?.seats ?? 0) === 0) continue;
    const bloc = state.coalitions.find((c) => c.parties.includes(p.id));
    const blocParties = bloc ? bloc.parties : [p.id];
    const partner = parties
      .filter(
        (q) =>
          q.id !== p.id &&
          (state.parties[q.id]?.seats ?? 0) > 0 &&
          !blocParties.includes(q.id) &&
          !state.offers.some((o) => o.from === p.id && o.to === q.id) &&
          canJoin(state, data, p.id, q.id),
      )
      .sort((a, b) => distance(state, data, p.id, a.id) - distance(state, data, p.id, b.id))[0];
    if (!partner) continue;
    if (rand(state) < 0.6) offerCoalition(state, data, p.id, partner.id);
  }
}

export function runElection(state, data) {
  const poll = computePoll(state, data);
  const parties = plist(state, data);
  for (const p of parties) {
    state.parties[p.id].seats = poll.seats[p.id] ?? 0;
    state.parties[p.id].share = poll.national[p.id] ?? 0;
  }

  const valid = state.coalitions
    .filter((c) => majorityOk(state, c.parties))
    .sort((a, b) => blocSeats(state, b.parties) - blocSeats(state, a.parties));
  const ranked = parties.slice().sort((a, b) => state.parties[b.id].seats - state.parties[a.id].seats);
  const gov = valid.length ? valid[0].parties : [ranked[0].id];

  state.lastResult = {
    day: state.day,
    date: dateOf(state),
    seats: Object.fromEntries(parties.map((p) => [p.id, state.parties[p.id].seats])),
    national: { ...poll.national },
    gov,
    winner: ranked[0].id,
  };
  setGovernment(state, data, gov);
  state.resultUntil = state.day + 10;
  state.negotiation = { until: state.day + 10, settled: valid.length > 0 };
  state.electionDay += state.config.termDays;

  log(
    state,
    "election",
    "Alegeri parlamentare",
    `${ranked[0].id.toUpperCase()} a câștigat cu ${state.parties[ranked[0].id].seats} mandate. Guvern: ${gov.map((g) => g.toUpperCase()).join(" + ")}.`,
  );

  for (const p of Object.values(state.parties)) {
    p.boost = {};
    p.segBoost = {};
    p.funds = money(p.funds + 1.6);
    p.capital = round(p.capital + 20, 1);
  }
  for (const id of Object.keys(state.mood)) {
    state.mood[id] = 1 + (state.mood[id] - 1) * 0.6;
  }
  for (const c of Object.values(state.counties)) c.boost = {};

  // Protocols are per cycle: the ones that decided this election stay as the
  // governing bloc, everything else is cleared before negotiations.
  state.coalitions = valid.length ? [{ parties: [...valid[0].parties], day: state.day }] : [];
  state.offers = [];
  return poll;
}

export function tick(state, data, days = 1) {
  for (let i = 0; i < days; i += 1) {
    state.day += 1;
    state.date = dateOf(state);
    decay(state);
    income(state, data);

    if (state.day % 30 === 0) {
      state.segPrev = segmentShares(state, data);
      worldMonthly(state, data);
      govMonthly(state, data);
      flushPending(state, data);
      parlMonthly(state, data);
    }
    parlDaily(state, data);

    // The AI campaigns hard before an election and only lightly in between.
    const toElection = state.electionDay - state.day;
    if (state.day % (data.config.aiEveryDays ?? 3) === 0) {
      for (const p of plist(state, data)) {
        if (state.humans.includes(p.id)) continue;
        if (toElection < 150 || rand(state) < 0.15) aiTurn(state, data, p.id);
      }
    }

    // AI parties answer coalition offers: compatible partners sign, the rest refuse.
    if (state.offers.length) {
      for (const offer of [...state.offers]) {
        if (state.humans.includes(offer.to)) continue;
        if (canJoin(state, data, offer.from, offer.to)) {
          acceptCoalition(state, data, offer.to, offer.from);
        } else {
          state.offers = state.offers.filter((o) => o !== offer);
          log(
            state,
            "coalition",
            "Ofertă refuzată",
            `${offer.to.toUpperCase()} a refuzat oferta ${offer.from.toUpperCase()}: „nu împărțim aceiași votanți”.`,
          );
        }
      }
    }

    if (state.negotiation && !state.negotiation.settled && state.day % 2 === 0) {
      aiCoalitionOffers(state, data);
    }
    negotiationStep(state, data);

    // Unanswered decisions lapse; the event's `ignore` effects land on that party.
    for (const d of [...state.decisions]) {
      if (state.day <= d.expires) continue;
      state.decisions = state.decisions.filter((x) => x !== d);
      if (d.defection) {
        splitParty(state, data, d.party, { frac: 0.1 });
        log(state, "decision", `${d.party.toUpperCase()}: nimeni nu a mai fost întrebat`, "Oamenii au plecat fără să mai aștepte un răspuns.");
        continue;
      }
      const ev = data.events.events.find((e) => e.id === d.eventId);
      applyEffects(state, data, ev?.ignore, { partyId: d.party });
      log(state, "decision", `${d.party.toUpperCase()} a ignorat decizia`, ev?.title ?? "");
    }

    if (rand(state) < (data.config.eventChance ?? 0.1)) {
      fireEvent(state, data);
    }

    if (state.day >= state.electionDay) {
      runElection(state, data);
    }
  }
  return state;
}

// `opts.hist: false` leaves out the long history series (the server sends them monthly).
export function snapshot(state, data, opts = {}) {
  const poll = computePoll(state, data);
  const parties = {};
  for (const p of plist(state, data)) {
    const sp = state.parties[p.id];
    parties[p.id] = {
      funds: money(sp.funds),
      capital: round(sp.capital, 1),
      seats: sp.seats,
      share: Math.round((poll.national[p.id] ?? 0) * 1000) / 1000,
      gov: sp.gov,
      cooldown: sp.cooldown,
      boost: sp.boost,
    };
  }
  const sc = scenarioOf(data, state.scenario);
  return {
    scenario: { id: sc.id, name: sc.name, year: sc.year },
    day: state.day,
    date: dateOf(state),
    phase: state.phase,
    speed: state.speed,
    electionDay: state.electionDay,
    resultUntil: state.resultUntil,
    partyIds: state.partyIds,
    leaders: state.leaders,
    minoritySeats: state.config.minoritySeats,
    counties: state.counties,
    parties,
    politicians: state.politicians,
    mood: state.mood,
    coalitions: state.coalitions,
    offers: state.offers,
    defs: state.defs,
    parl: parlSnapshot(state, data),
    lists: lists(state, poll.national, poll.counties),
    negotiation: state.negotiation,
    humans: state.humans,
    active: state.active,
    decisions: state.decisions.map((d) => {
      const ev = d.defection ? pseudoEvent(d) : data.events.events.find((e) => e.id === d.eventId);
      return {
        id: d.id,
        party: d.party,
        title: ev.title,
        text: ev.text,
        expires: d.expires,
        choices: ev.choices.map((c) => ({ label: c.label, hint: c.hint ?? "", cost: c.cost ?? 0 })),
      };
    }),
    lastResult: state.lastResult,
    causes: (state.causes ?? []).slice(-160),
    segShares: segmentShares(state, data),
    segPrev: state.segPrev ?? null,
    poll: {
      national: poll.national,
      counties: poll.counties,
      seats: poll.seats,
    },
    gov: govSnapshot(state, data, opts),
    world: worldView(state, data),
    log: state.log.slice(-60),
  };
}

export { fallGovernment };

/* ------------------------------------------------------- causes, previews, defections */

const inCoalition = (state, id) => state.gov.coalition.includes(id);

// Each event or law that moves a voter segment leaves a short note, so the UI can say why.
function noteCauses(state, ctx, effects) {
  const segs = effects?.segments ?? {};
  const sol = effects?.sol ?? {};
  const entries = [
    ...Object.entries(segs).map(([seg, v]) => ({ seg, v, kind: "votanți" })),
    ...Object.entries(sol).map(([seg, v]) => ({ seg, v, kind: "standard de viață" })),
  ];
  if (!entries.length) return;
  state.causes ??= [];
  for (const e of entries) {
    state.causes.push({ day: state.day, party: ctx.partyId ?? null, seg: e.seg, v: round(e.v, 3), kind: e.kind, text: ctx.title ?? "Eveniment" });
  }
  if (state.causes.length > 400) state.causes.splice(0, state.causes.length - 400);
}

// Estimated share of each voter segment for each party, the same arithmetic as computePoll.
export function segmentShares(state, data) {
  const parties = plist(state, data);
  const out = {};
  for (const seg of data.segments.segments) {
    const num = Object.fromEntries(parties.map((p) => [p.id, 0]));
    let total = 0;
    for (const c of Object.values(state.counties)) {
      const size = c.segments[seg.id] ?? 0;
      if (size <= 0) continue;
      total += size;
      const scores = {};
      let sum = 0;
      for (const p of parties) {
        const gm = state.govMult?.[p.id];
        const sb = state.parties[p.id].segBoost[seg.id] ?? 1;
        const s = Math.max(0.0001,
          size * (p.affinity[seg.id] ?? 0.3) * sb * (gm?.[seg.id] ?? 1) *
          (state.strength[p.id] ?? 1) * (p.bias?.[c.id] ?? 1) * (state.mood[p.id] ?? 1) * (1 + (c.boost[p.id] ?? 0)));
        scores[p.id] = s;
        sum += s;
      }
      for (const p of parties) num[p.id] += size * (scores[p.id] / sum);
    }
    out[seg.id] = Object.fromEntries(parties.map((p) => [p.id, total ? round(num[p.id] / total, 4) : 0]));
  }
  return out;
}

// What an action would do, without doing it: runs it on a copy and reports the change.
export function previewAction(state, data, partyId, action) {
  const slim = { ...state, hist: undefined, log: [], causes: [], world: undefined };
  const clone = structuredClone(slim);
  const before = segmentShares(state, data);
  const nationalBefore = computePoll(state, data).national;
  const res = applyAction(clone, data, partyId, action);
  if (!res.ok) return { ok: false, error: res.error };
  const after = segmentShares(clone, data);
  const nationalAfter = computePoll(clone, data).national;
  const segs = Object.keys(before).map((seg) => ({
    seg,
    own: round(((after[seg][partyId] ?? 0) - (before[seg][partyId] ?? 0)) * 100, 2),
    byParty: Object.fromEntries(Object.keys(before[seg]).map((p) => [p, round(((after[seg][p] ?? 0) - (before[seg][p] ?? 0)) * 100, 2)])),
  }));
  const national = Object.fromEntries(Object.keys(nationalBefore).map((p) => [p, round(((nationalAfter[p] ?? 0) - (nationalBefore[p] ?? 0)) * 100, 2)]));
  return { ok: true, national, segs };
}

/* defections: the cohesion of a human party can fall until a group wants to leave */

function pseudoEvent(d) {
  return {
    title: "Un grup de parlamentari vrea să plece",
    text: `${d.defection.seats} oameni din ${d.party.toUpperCase()} au semnat o cerere de demisie din grup.`,
    choices: defectionChoices(),
  };
}

function defectionChoices() {
  return [
    { label: "Îi convingi să rămână", hint: "Costă 0,5 M€ · coeziune +10", cost: 0.5 },
    { label: "Îi lași să plece", hint: "Pleacă ~10% din mandate, cu o grupare nouă", cost: 0 },
    { label: "Îi dai o funcție", hint: "Costă 1,5 M€ · coeziune +5 și un pic de scandal", cost: 1.5 },
  ];
}

function decideDefection(state, data, d, choice) {
  const choices = defectionChoices();
  const c = choices[choice];
  if (!c) return { ok: false, error: "Alegere invalidă." };
  const party = state.parties[d.party];
  if (party.funds < c.cost) return { ok: false, error: `Fonduri insuficiente (${c.cost} M€ necesari).` };
  party.funds = money(party.funds - c.cost);
  state.decisions = state.decisions.filter((x) => x !== d);
  if (choice === 0) {
    party.cohesion = round(clamp((party.cohesion ?? 72) + 10, 0, 100), 1);
    log(state, "decision", `${d.party.toUpperCase()}: a rămas în grup`, "Discuția a durat trei ore și o cafea.");
    return { ok: true, message: "Au rămas în grup." };
  }
  if (choice === 1) {
    const res = splitParty(state, data, d.party, { frac: 0.1 });
    return { ok: res.ok, message: res.ok ? "Au plecat și formează o grupare nouă." : res.error };
  }
  party.cohesion = round(clamp((party.cohesion ?? 72) + 5, 0, 100), 1);
  state.mood[d.party] = clamp((state.mood[d.party] ?? 1) * 0.99, 0.55, 1.6);
  log(state, "decision", `${d.party.toUpperCase()}: o funcție pentru un deputat`, "Presa a aflat înainte de semnătura contractului.");
  return { ok: true, message: "Ai găsit o funcție. A ieșit în presă." };
}

export { pseudoEvent, defectionChoices };

