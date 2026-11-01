// Turul Doi game engine. Pure functions over a plain JSON state so it can run
// in the browser (solo) and on the server (multiplayer) from the same code.

export const ACTIONS = [
  {
    id: "rally",
    name: "Miting",
    desc: "Adună lumea în piață. Bun la rural, slab la oraș.",
    cost: 45,
    cooldown: 4,
    target: "county",
  },
  {
    id: "tv",
    name: "Aparență TV",
    desc: "O oră la televizor, cu întrebări despre pensii.",
    cost: 60,
    cooldown: 6,
    target: "none",
  },
  {
    id: "online",
    name: "Campanie online",
    desc: "Clipuri scurte, promisiuni lungi.",
    cost: 30,
    cooldown: 3,
    target: "none",
  },
  {
    id: "deal",
    name: "Înțelegere locală",
    desc: "Un baron local primește ceva, tu primești județul. Risc de scandal.",
    cost: 95,
    cooldown: 9,
    target: "county",
  },
  {
    id: "attack",
    name: "Atac la adversar",
    desc: "Scoate din influența unui rival într-un județ.",
    cost: 50,
    cooldown: 5,
    target: "county-party",
  },
  {
    id: "promise",
    name: "Promisiune electorală",
    desc: "Promite tot, nu costa nimic acum.",
    cost: 70,
    cooldown: 7,
    target: "none",
  },
  {
    id: "law",
    name: "Promulgă o lege",
    desc: "Doar guvernul poate. Legea mișcă segmentele imediat.",
    cost: 0,
    cooldown: 14,
    target: "law",
    requiresGovernment: true,
  },
];

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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function log(state, kind, title, text = "") {
  state.log.push({ day: state.day, kind, title, text });
  const max = state.config.maxLog ?? 120;
  if (state.log.length > max) state.log.splice(0, state.log.length - max);
}

export function createGame(data, opts = {}) {
  const cfg = data.config;
  const counties = {};
  for (const c of data.counties.counties) {
    counties[c.id] = {
      id: c.id,
      name: c.name,
      pop: c.pop,
      segments: buildSegments(c),
      boost: {},
    };
  }

  const parties = {};
  for (const p of data.parties.parties) {
    parties[p.id] = {
      id: p.id,
      funds: cfg.startFunds,
      capital: cfg.startCapital,
      boost: {},
      segBoost: {},
      cooldown: {},
      seats: 0,
      share: 0,
      gov: false,
    };
  }

  const politicians = {};
  for (const p of data.politicians.politicians) {
    politicians[p.id] = {
      id: p.id,
      name: p.name,
      party: p.party,
      role: p.role,
      stats: { ...p.stats },
      ability: p.ability,
      facts: p.facts,
    };
  }

  const state = {
    version: 1,
    day: 0,
    speed: 1,
    phase: "campaign",
    electionDay: cfg.campaignDays,
    resultUntil: -1,
    rng: (opts.seed ?? Date.now()) >>> 0,
    config: {
      campaignDays: cfg.campaignDays,
      totalSeats: cfg.totalSeats,
      startDate: cfg.startDate,
      tickMs: cfg.tickMs,
      maxLog: cfg.maxLog,
    },
    counties,
    parties,
    politicians,
    mood: Object.fromEntries(data.parties.parties.map((p) => [p.id, 1])),
    coalitions: [],
    offers: [],
    negotiation: null,
    humans: opts.humans ?? [],
    active: null,
    lastResult: null,
    recentEvents: [],
    log: [],
  };

  log(
    state,
    "system",
    "Campania începe",
    "Alegerile sunt peste 120 de zile. Fiecare partid pornește cu același buget și aceleași promisiuni.",
  );
  return state;
}

export function dateOf(state, data) {
  const start = new Date(`${state.config.startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + state.day);
  return start.toISOString().slice(0, 10);
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
    p.funds = Math.round((p.funds + 1 + share * 5) * 10) / 10;
    p.capital = Math.round((p.capital + 0.25 + share * 0.5) * 10) / 10;
  }
}

export function computePoll(state, data) {
  const parties = data.parties.parties;
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
      for (const seg of data.segments.segments) {
        const size = c.segments[seg.id] ?? 0;
        const aff = p.affinity[seg.id] ?? 0.3;
        const sb = state.parties[p.id].segBoost[seg.id] ?? 1;
        s += size * aff * sb;
      }
      s *=
        (p.strength ?? 1) *
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
  const seats = allocateSeats(state, data, counties, national);
  return { national, counties, seats };
}

function allocateSeats(state, data, countyShares, national) {
  const parties = data.parties.parties;
  const totalSeats = state.config.totalSeats;
  const eligible = parties.filter((p) => (national[p.id] ?? 0) >= 0.05).map((p) => p.id);
  const seats = Object.fromEntries(parties.map((p) => [p.id, 0]));
  if (eligible.length === 0) return seats;

  // National D'Hondt: simple, proportional and easy to read next to the poll bars.
  // County results still drive the campaign and colour the map.
  const local = Object.fromEntries(eligible.map((id) => [id, 0]));
  for (let i = 0; i < totalSeats; i += 1) {
    let best = eligible[0];
    let bestV = -1;
    for (const id of eligible) {
      const v = (national[id] ?? 0) / (local[id] + 1);
      if (v > bestV) {
        bestV = v;
        best = id;
      }
    }
    local[best] += 1;
    seats[best] += 1;
  }
  return seats;
}

function addCountyBoost(state, countyId, partyId, amount) {
  const c = state.counties[countyId];
  if (!c) return;
  c.boost[partyId] = clamp((c.boost[partyId] ?? 0) + amount, -0.7, 1.2);
}

function addSegBoost(state, partyId, segId, factor) {
  const p = state.parties[partyId];
  if (!p) return;
  p.segBoost[segId] = clamp((p.segBoost[segId] ?? 1) * factor, 0.55, 1.9);
}

function abilityFactor(state, partyId, data, segId) {
  const leader = data.parties.parties.find((p) => p.id === partyId)?.leader;
  const ability = leader ? state.politicians[leader]?.ability?.effect : null;
  return ability?.[segId] ?? 1;
}

function applyEffects(state, data, effects, ctx = {}) {
  if (!effects) return;

  if (effects.segments) {
    for (const c of Object.values(state.counties)) {
      for (const [seg, delta] of Object.entries(effects.segments)) {
        if (!(seg in c.segments)) continue;
        c.segments[seg] = Math.max(0.5, c.segments[seg] * (1 + delta));
      }
    }
  }

  if (effects.convert) {
    for (const c of Object.values(state.counties)) {
      for (const rule of effects.convert) {
        const from = c.segments[rule.from];
        const to = c.segments[rule.to];
        if (from == null || to == null) continue;
        const moved = from * rule.share;
        c.segments[rule.from] = Math.max(0.5, from - moved);
        c.segments[rule.to] = to + moved;
      }
    }
  }

  if (effects.party) {
    for (const [pid, delta] of Object.entries(effects.party)) {
      state.mood[pid] = clamp((state.mood[pid] ?? 1) * (1 + delta), 0.55, 1.6);
    }
  }

  if (effects.countyParty) {
    for (const [cid, parties] of Object.entries(effects.countyParty)) {
      for (const [pid, amount] of Object.entries(parties)) {
        addCountyBoost(state, cid, pid, amount);
      }
    }
  }

  if (effects.funds) {
    for (const [pid, amount] of Object.entries(effects.funds)) {
      const target = pid === "self" ? ctx.partyId : pid;
      if (target && state.parties[target]) {
        state.parties[target].funds = Math.round((state.parties[target].funds + amount) * 10) / 10;
      }
    }
  }

  if (effects.countyBoostAll && ctx.partyId) {
    for (const cid of Object.keys(state.counties)) {
      addCountyBoost(state, cid, ctx.partyId, effects.countyBoostAll);
    }
  }

  if (effects.politician) {
    const p = state.politicians[effects.politician.id];
    if (p) {
      const stat = effects.politician.stat;
      p.stats[stat] = clamp((p.stats[stat] ?? 0) + effects.politician.delta, 0, 100);
    }
  }
}

function pickEvent(state, data) {
  const pool = data.events.events.filter(
    (e) => (e.minDay ?? 0) <= state.day && !state.recentEvents.includes(e.id),
  );
  if (!pool.length) return null;
  const total = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = rand(state) * total;
  for (const e of pool) {
    r -= e.weight ?? 1;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

export function fireEvent(state, data, eventId) {
  const ev = eventId
    ? data.events.events.find((e) => e.id === eventId)
    : pickEvent(state, data);
  if (!ev) return null;
  applyEffects(state, data, ev.effects, {});
  state.recentEvents.push(ev.id);
  if (state.recentEvents.length > 14) state.recentEvents.shift();
  state.active = { ...ev, day: state.day };
  log(state, "event", ev.title, ev.text);
  return ev;
}

function leaderId(data, partyId) {
  return data.parties.parties.find((p) => p.id === partyId)?.leader;
}

function aiTurn(state, data, partyId) {
  const party = state.parties[partyId];
  if (!party) return;
  const poll = computePoll(state, data);
  const leader = Object.entries(poll.national).sort((a, b) => b[1] - a[1])[0][0];
  const counties = Object.keys(state.counties);
  const randomCounty = () => counties[Math.floor(rand(state) * counties.length)];
  const r = rand(state);

  if (r < 0.12 && party.funds >= 95 && party.cooldown.deal <= state.day) {
    const cid = counties
      .slice()
      .sort((a, b) => (poll.counties[b][partyId] ?? 0) - (poll.counties[a][partyId] ?? 0))[3];
    applyAction(state, data, partyId, { type: "deal", county: cid || randomCounty() });
    return;
  }
  if (r < 0.38 && party.funds >= 50 && party.cooldown.attack <= state.day && leader !== partyId) {
    applyAction(state, data, partyId, {
      type: "attack",
      county: randomCounty(),
      targetParty: leader,
    });
    return;
  }
  if (r < 0.72 && party.funds >= 45 && party.cooldown.rally <= state.day) {
    const cid = counties
      .slice()
      .sort((a, b) => (poll.counties[b][partyId] ?? 0) - (poll.counties[a][partyId] ?? 0))[0];
    applyAction(state, data, partyId, { type: "rally", county: cid || randomCounty() });
    return;
  }
  if (party.funds >= 30 && party.cooldown.online <= state.day) {
    applyAction(state, data, partyId, { type: "online" });
  } else if (party.funds >= 60 && party.cooldown.tv <= state.day) {
    applyAction(state, data, partyId, { type: "tv" });
  }
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
    return { ok: false, error: `Fonduri insuficiente (${def.cost} necesari).` };
  }
  if (def.requiresGovernment && !party.gov) {
    return { ok: false, error: "Doar partidul de guvernământ poate promulga legi." };
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
  if (def.target === "law") {
    const law = data.laws.laws.find((l) => l.id === action.law);
    if (!law) return { ok: false, error: "Lege necunoscută." };
    if (party.capital < law.capital) {
      return { ok: false, error: `Capital politic insuficient (${law.capital} necesar).` };
    }
    party.capital -= law.capital;
    applyEffects(state, data, law.effects, { partyId });
    party.funds -= def.cost;
    party.cooldown[def.id] = state.day + def.cooldown;
    log(state, "law", `Lege promulgată: ${law.name}`, law.text);
    return { ok: true, message: `Ai promulgat „${law.name}”.` };
  }

  party.funds = Math.round((party.funds - def.cost) * 10) / 10;
  party.cooldown[def.id] = state.day + def.cooldown;
  const leader = leaderId(data, partyId);
  const countyName = action.county ? state.counties[action.county].name : "";

  if (def.id === "rally") {
    addCountyBoost(state, action.county, partyId, 0.16);
    for (const [seg, base] of Object.entries({
      pensionari_rural: 1.05,
      agricultori: 1.04,
      muncitori: 1.03,
      pensionari_urban: 1.02,
      tineri_urbani: 1.01,
    })) {
      addSegBoost(state, partyId, seg, 1 + (base - 1) * abilityFactor(state, partyId, data, seg));
    }
    log(state, "action", `Miting la ${countyName}`, `${state.politicians[leader]?.name ?? partyId} a vorbit în fața a 2.000 de oameni și a 40 de jandarmi.`);
    return { ok: true, message: `Miting organizat la ${countyName}.` };
  }

  if (def.id === "tv") {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, partyId, 0.03);
    addSegBoost(state, partyId, "pensionari_urban", 1.04);
    addSegBoost(state, partyId, "pensionari_rural", 1.02);
    addSegBoost(state, partyId, "bugetari", 1.015);
    log(state, "action", "Aparență TV", `${state.politicians[leader]?.name ?? partyId} a explicat bugetul în 12 minute și a primit încă 12.`);
    return { ok: true, message: "Ai apărut la televizor." };
  }

  if (def.id === "online") {
    for (const cid of Object.keys(state.counties)) addCountyBoost(state, cid, partyId, 0.02);
    for (const [seg, base] of Object.entries({
      tineri_urbani: 1.05,
      studenti: 1.05,
      antreprenori: 1.02,
      diaspora: 1.02,
    })) {
      addSegBoost(state, partyId, seg, 1 + (base - 1) * abilityFactor(state, partyId, data, seg));
    }
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
    for (const [seg, base] of Object.entries({
      antreprenori: 1.03,
      pensionari_rural: 1.02,
      tineri_urbani: 1.02,
      agricultori: 1.02,
    })) {
      addSegBoost(state, partyId, seg, 1 + (base - 1) * abilityFactor(state, partyId, data, seg));
    }
    log(state, "action", "Promisiune electorală", "S-a promis o autostradă, un spital și o grădiniță. Toate în același loc.");
    return { ok: true, message: "Promisiunea a fost făcută." };
  }

  return { ok: false, error: "Acțiune necunoscută." };
}

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
  const involved = state.coalitions.filter(
    (c) => c.parties.includes(from) || c.parties.includes(to),
  );
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

function blocSeats(state, ids) {
  return [...new Set(ids)].reduce((s, id) => s + (state.parties[id]?.seats ?? 0), 0);
}

// Rough ideological distance from the affinity vectors: parties that chase the
// same voters sit close together. Used only for AI coalition manners.
function affinityDistance(data, a, b) {
  const pa = data.parties.parties.find((p) => p.id === a)?.affinity ?? {};
  const pb = data.parties.parties.find((p) => p.id === b)?.affinity ?? {};
  const keys = Object.keys(pa);
  if (!keys.length) return 1;
  let sum = 0;
  for (const k of keys) sum += ((pa[k] ?? 0.3) - (pb[k] ?? 0.3)) ** 2;
  return Math.sqrt(sum / keys.length);
}

function canJoin(state, data, from, to) {
  const blocA = state.coalitions.find((c) => c.parties.includes(from));
  const blocB = state.coalitions.find((c) => c.parties.includes(to));
  const parties = new Set([
    ...(blocA ? blocA.parties : [from]),
    ...(blocB ? blocB.parties : [to]),
  ]);
  if (parties.size > 4) return false;
  if (blocSeats(state, [...parties]) > 300) return false;
  return affinityDistance(data, from, to) <= 0.28;
}

function setGovernment(state, data, gov) {
  for (const p of data.parties.parties) state.parties[p.id].gov = gov.includes(p.id);
  if (state.lastResult) state.lastResult.gov = gov;
  return gov;
}

// The ten days after an election are for negotiations. A bloc that reaches a
// majority takes the government immediately; otherwise the winner governs alone.
function negotiationStep(state, data) {
  const neg = state.negotiation;
  if (!neg) return;

  const valid = state.coalitions
    .filter((c) => blocSeats(state, c.parties) >= 166)
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
      log(state, "coalition", "Guvern minoritar", "Negocierile au eșuat. Partidul câștigător guvernează singur și promite că se descurcă.");
    }
    state.negotiation = null;
    state.offers = [];
  }
}

function aiCoalitionOffers(state, data) {
  const parties = data.parties.parties
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
      .sort(
        (a, b) =>
          affinityDistance(data, p.id, a.id) - affinityDistance(data, p.id, b.id),
      )[0];
    if (!partner) continue;
    if (rand(state) < 0.6) offerCoalition(state, data, p.id, partner.id);
  }
}

export function runElection(state, data) {
  const poll = computePoll(state, data);
  for (const p of data.parties.parties) {
    state.parties[p.id].seats = poll.seats[p.id] ?? 0;
    state.parties[p.id].share = poll.national[p.id] ?? 0;
  }

  const seatsOf = (ids) => blocSeats(state, ids);
  const valid = state.coalitions
    .filter((c) => seatsOf(c.parties) >= 166)
    .sort((a, b) => seatsOf(b.parties) - seatsOf(a.parties));
  const ranked = data.parties.parties.slice().sort((a, b) => state.parties[b.id].seats - state.parties[a.id].seats);
  const gov = valid.length ? valid[0].parties : [ranked[0].id];
  setGovernment(state, data, gov);

  state.lastResult = {
    day: state.day,
    seats: Object.fromEntries(data.parties.parties.map((p) => [p.id, state.parties[p.id].seats])),
    national: { ...poll.national },
    gov,
    winner: ranked[0].id,
  };
  state.resultUntil = state.day + 10;
  state.negotiation = { until: state.day + 10, settled: valid.length > 0 };
  state.electionDay += state.config.campaignDays;

  log(
    state,
    "election",
    "Alegeri parlamentare",
    `${ranked[0].id.toUpperCase()} a câștigat cu ${state.parties[ranked[0].id].seats} mandate. Guvern: ${gov.map((g) => g.toUpperCase()).join(" + ")}.`,
  );

  for (const p of Object.values(state.parties)) {
    p.boost = {};
    p.segBoost = {};
    p.funds = Math.round((p.funds + 80) * 10) / 10;
    p.capital = Math.round((p.capital + 20) * 10) / 10;
  }
  for (const id of Object.keys(state.mood)) {
    state.mood[id] = 1 + (state.mood[id] - 1) * 0.6;
  }

  // Protocols are per cycle: the ones that decided this election stay as the
  // governing bloc, everything else is cleared before negotiations.
  state.coalitions = valid.length ? [{ parties: [...valid[0].parties], day: state.day }] : [];
  state.offers = [];
  return poll;
}

export function tick(state, data, days = 1) {
  for (let i = 0; i < days; i += 1) {
    state.day += 1;
    decay(state);
    income(state, data);

    if (state.day % (data.config.aiEveryDays ?? 3) === 0) {
      for (const p of data.parties.parties) {
        if (state.humans.includes(p.id)) continue;
        aiTurn(state, data, p.id);
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

    if (rand(state) < (data.config.eventChance ?? 0.2)) {
      fireEvent(state, data);
    }

    if (state.day >= state.electionDay) {
      runElection(state, data);
    }
  }
  return state;
}

export function snapshot(state, data) {
  const poll = computePoll(state, data);
  const parties = {};
  for (const p of data.parties.parties) {
    const sp = state.parties[p.id];
    parties[p.id] = {
      funds: Math.round(sp.funds * 10) / 10,
      capital: Math.round(sp.capital * 10) / 10,
      seats: sp.seats,
      share: Math.round((poll.national[p.id] ?? 0) * 1000) / 1000,
      gov: sp.gov,
      cooldown: sp.cooldown,
      boost: sp.boost,
    };
  }
  return {
    day: state.day,
    date: dateOf(state, data),
    phase: state.phase,
    speed: state.speed,
    electionDay: state.electionDay,
    resultUntil: state.resultUntil,
    counties: state.counties,
    parties,
    politicians: state.politicians,
    mood: state.mood,
    coalitions: state.coalitions,
    offers: state.offers,
    negotiation: state.negotiation,
    humans: state.humans,
    active: state.active,
    lastResult: state.lastResult,
    poll: {
      national: poll.national,
      counties: poll.counties,
      seats: poll.seats,
    },
    log: state.log.slice(-40),
  };
}
