// Parliament: laws and votes, backroom deals, no-confidence motions, relations
// between parties, party cohesion, mergers, splits and the party profile.
// State lives in `state.parl`; party definitions that change (merges, splits,
// a shifted direction) live in `state.defs`.
import { clamp, rand, log, round, partyDef, senateMapFrom, SENATE_MAJORITY } from "./util.mjs";
import { computePoll, applyEffects } from "./engine.mjs";
import { fallGovernment } from "./gov.mjs";
import { queueLaw, challengeCCR, nominate, backCandidate } from "./presidency.mjs";

const MAJORITY = 166;
const LAW_DAYS = 12;
const MOTION_DAYS = 7;
const COST = { bill: 8, motion: 25, merge: 15, shift: 12, pact: 10, amend: 3 };
// Recruiting MPs: per MP, from the unaffiliated group or poached from a shaky rival party.
const RECRUIT = { pool: { capital: 3, money: 0.4, max: 5 }, poach: { capital: 5, money: 0.8, max: 3, cohesionBelow: 65, minSeats: 10 }, cooldown: 12, maxFree: 25 };
const SEGMENTS = ["pensionari_rural", "pensionari_urban", "tineri_urbani", "studenti", "muncitori", "agricultori", "antreprenori", "bugetari", "someri", "diaspora"];

const find = (arr, id) => arr.find((x) => x.id === id);
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const seatsOf = (state, id) => state.parties[id]?.seats ?? 0;
const inGov = (state, id) => state.gov.coalition.includes(id);
const upper = (id) => String(id).toUpperCase();

/* ----------------------------------------------------------------- setup */

export function initParl(state) {
  state.defs = {};
  state.renamed = {};
  state.parl = { rel: {}, bills: [], next: 1, passed: {}, done: [], mergeOffers: [], pacts: [], cool: {}, free: 0, supportOffers: [], nextOffer: 1 };
  for (const p of Object.values(state.parties)) p.cohesion = 72;
}

/* ------------------------------------------------------------- relations */

// How far two parties are on what they chase: 0 = the same voters.
export function distance(state, data, a, b) {
  const pa = partyDef(state, data, a)?.affinity ?? {};
  const pb = partyDef(state, data, b)?.affinity ?? {};
  const keys = Object.keys(pa);
  if (!keys.length) return 1;
  let s = 0;
  for (const k of keys) s += ((pa[k] ?? 0.3) - (pb[k] ?? 0.3)) ** 2;
  return Math.sqrt(s / keys.length);
}

function baseRel(state, data, a, b) {
  let v = 72 - distance(state, data, a, b) * 120;
  if (inGov(state, a) && inGov(state, b)) v += 12;
  return clamp(v, 12, 80);
}

export function relation(state, data, a, b) {
  if (a === b) return 100;
  return state.parl.rel[key(a, b)] ?? round(baseRel(state, data, a, b), 0);
}

export function addRel(state, data, a, b, d) {
  if (a === b || !a || !b) return;
  state.parl.rel[key(a, b)] = round(clamp(relation(state, data, a, b) + d, 0, 100), 1);
}

/* ---------------------------------------------------------------- votes */

function sourceOf(data, b) {
  const s = b.source && data.lawSources?.sources.find((x) => x.slug === b.source.slug);
  return s ? { ref: s.ref, note: b.source.note, portal: s.portal, latest: s.latest } : null;
}

const billDef = (data, id) => find(data.bills.bills, id);

// How much a party likes a bill, from about -1.5 (certain no) to +1.5 (certain yes).
function lawScore(state, data, party, entry) {
  const bill = billDef(data, entry.bill);
  const def = partyDef(state, data, party);
  const aff = def.affinity ?? {};
  let interest = 0;
  for (const [seg, v] of Object.entries(bill.interest ?? {})) interest += v * (aff[seg] ?? 0.3);
  // Adopted amendments change who gains and who loses from the bill.
  for (const o of amendOptions(data, bill)) {
    if (!amendedBy(entry).includes(o.id)) continue;
    for (const [seg, v] of Object.entries(o.interest ?? {})) interest += v * (aff[seg] ?? 0.3);
  }
  let s = interest * 1.2 - Math.abs(bill.lean - (def.lean ?? 0)) * 1.1 + 0.3;
  s += ((relation(state, data, party, entry.from) - 50) / 50) * 0.6;
  if (hasPact(state, party, entry.from)) s += 0.6;
  if (inGov(state, party) && inGov(state, entry.from)) s += 0.35;
  else if (inGov(state, party) !== inGov(state, entry.from)) s -= 0.15;
  s += entry.deals[party] ?? 0;
  if (entry.pledged?.includes(party)) s += 1.5;
  return s;
}

function motionScore(state, data, party, entry) {
  const g = state.gov;
  if (inGov(state, party)) return -2;
  let s = (50 - g.confidence) / 55 + ((relation(state, data, party, entry.from) - 50) / 50) * 0.5;
  s -= ((relation(state, data, party, g.pmParty) - 50) / 50) * 0.5;
  if (g.support[party]) s -= 0.6;
  s += entry.deals[party] ?? 0;
  if (entry.pledged?.includes(party)) s += 1.5;
  return s;
}

export function stanceOf(state, data, party, entry) {
  return entry.kind === "motion" ? motionScore(state, data, party, entry) : lawScore(state, data, party, entry);
}

/* ------------------------------------------------------------ bills, motion */

function openByParty(state, party) {
  return state.parl.bills.find((b) => b.from === party && b.status === "open");
}

export function proposeBill(state, data, partyId, billId) {
  const party = state.parties[partyId];
  const def = billDef(data, billId);
  if (!party || !def) return { ok: false, error: "Lege necunoscută." };
  if (seatsOf(state, partyId) === 0) return { ok: false, error: "Fără mandate nu poți depune legi în Parlament." };
  if (openByParty(state, partyId)) return { ok: false, error: "Ai deja o lege în dezbatere." };
  if (state.parl.bills.some((b) => b.bill === billId && b.status === "open")) return { ok: false, error: "Legea e deja în dezbatere." };
  const last = state.parl.passed[billId];
  if (last != null && state.day - last < 540) return { ok: false, error: "Legea a fost adoptată de curând." };
  const until = state.parl.cool[`bill:${partyId}`] ?? -1;
  if (until > state.day) return { ok: false, error: `O lege nouă se poate depune din ziua ${until}.` };
  if (party.capital < COST.bill) return { ok: false, error: `Capital politic insuficient (${COST.bill} necesar).` };
  party.capital = round(party.capital - COST.bill, 1);
  state.parl.cool[`bill:${partyId}`] = state.day + 20;
  return openEntry(state, data, { kind: "law", bill: billId, from: partyId, days: LAW_DAYS, title: def.title });
}

// A law the president sent back: Parliament votes on it again, in a shorter window.
export function reopenLaw(state, data, billId, from, title) {
  return openEntry(state, data, { kind: "law", bill: billId, from, days: 10, title: title ?? billId });
}

function openEntry(state, data, e) {
  const entry = { id: state.parl.next, status: "open", day: state.day, vote: state.day + e.days, deals: {}, pledged: [], votes: {}, ...e };
  state.parl.next += 1;
  state.parl.bills.push(entry);
  if (e.kind === "law") {
    // Friends of the proposer get a head start.
    for (const p of state.partyIds) if (p !== e.from && relation(state, data, p, e.from) >= 65) entry.deals[p] = 0.25;
    if (!state.humans.includes(e.from)) makeSupportOffers(state, data, entry);
    log(state, "parl", `Proiect de lege: ${e.title}`, `${upper(e.from)} depune proiectul. Votul în plen e în ziua ${entry.vote}.`);
    return { ok: true, message: `Ai depus „${e.title}”. Votul e în ${e.days} zile.`, id: entry.id };
  }
  log(state, "parl", "Moțiune de cenzură depusă", `${upper(e.from)} a strâns semnăturile. Votul în plen e în ziua ${entry.vote}.`);
  return { ok: true, message: `Moțiunea e depusă. Votul e în ${e.days} zile.`, id: entry.id };
}

export function fileMotion(state, data, partyId) {
  const g = state.gov;
  const party = state.parties[partyId];
  if (g.caretaker) return { ok: false, error: "Guvernul e deja demis." };
  if (inGov(state, partyId)) return { ok: false, error: "Partidele din guvern nu depun moțiuni." };
  if (seatsOf(state, partyId) === 0) return { ok: false, error: "Fără mandate nu poți depune o moțiune." };
  if (state.parl.bills.some((b) => b.kind === "motion" && b.status === "open")) return { ok: false, error: "O moțiune e deja în dezbatere." };
  const until = state.budget.cool.motion ?? -1;
  if (until > state.day) return { ok: false, error: `O moțiune nouă se poate depune din ziua ${until}.` };
  if (party.capital < COST.motion || party.funds < 1) return { ok: false, error: `Moțiunea costă ${COST.motion} capital politic și 1 M€.` };
  party.capital = round(party.capital - COST.motion, 1);
  party.funds = round(party.funds - 1, 1);
  state.budget.cool.motion = state.day + 120;
  return openEntry(state, data, { kind: "motion", from: partyId, days: MOTION_DAYS, title: "Moțiune de cenzură" });
}

// Backroom: favors cost capital, money costs M€ (and risks a scandal), a swap
// pledges your own votes. Friends are cheaper; enemies will not talk at all.
export function lobbyPrice(state, data, from, to) {
  const rel = relation(state, data, from, to);
  return { rel, capital: round(3 + (100 - rel) / 12, 0), money: round(0.5 + (100 - rel) / 50, 1) };
}

export function lobby(state, data, partyId, entryId, target, how, against = false) {
  const entry = state.parl.bills.find((b) => b.id === Number(entryId) && b.status === "open");
  if (!entry) return { ok: false, error: "Votul nu mai e deschis." };
  if (!state.parties[target] || target === partyId || seatsOf(state, target) === 0) return { ok: false, error: "Alege un partid din Parlament." };
  if (entry.from !== partyId && !entry.votes[partyId] && how !== "swap" && how !== "favor") {
    return { ok: false, error: "Poți negocia doar pentru votul tău sau pentru legea ta." };
  }
  if (against && how === "swap") return { ok: false, error: "Schimbul de voturi se face doar în favoarea unei legi." };
  const sign = against ? -1 : 1;
  const price = lobbyPrice(state, data, partyId, target);
  if (price.rel < 15) return { ok: false, error: `${upper(target)} nu mai vorbește cu tine. Reface relația întâi.` };
  const party = state.parties[partyId];
  if (how === "favor") {
    if (party.capital < price.capital) return { ok: false, error: `Capital politic insuficient (${price.capital} necesar).` };
    party.capital = round(party.capital - price.capital, 1);
    entry.deals[target] = (entry.deals[target] ?? 0) + 0.55 * sign;
    addRel(state, data, partyId, target, 2);
    log(state, "parl", "Negociere de culise", `${upper(partyId)} cere un serviciu de la ${upper(target)}: „Ne vedem după vot.”`);
    return { ok: true, message: against ? `${upper(target)} va vota împotrivă. A costat ${price.capital} capital politic.` : `${upper(target)} te va sprijini. A costat ${price.capital} capital politic.` };
  }
  if (how === "money") {
    if (party.funds < price.money) return { ok: false, error: `Fonduri insuficiente (${price.money} M€ necesari).` };
    party.funds = round(party.funds - price.money, 1);
    entry.deals[target] = (entry.deals[target] ?? 0) + 0.5 * sign;
    if (rand(state) < 0.15) {
      state.mood[partyId] = clamp((state.mood[partyId] ?? 1) * 0.985, 0.55, 1.6);
      log(state, "scandal", "Votul cumpărat", `Presa publică o discuție între ${upper(partyId)} și ${upper(target)} despre „sprijin logistic” înainte de vot.`);
      return { ok: true, message: `${upper(target)} ${against ? "va vota împotrivă" : "va vota cu tine"}, dar discuția a ajuns în presă.` };
    }
    return { ok: true, message: `${upper(target)} a primit „sprijinul logistic” de ${price.money} M€${against ? " și va vota împotrivă" : ""}.` };
  }
  if (how === "swap") {
    const theirs = state.parl.bills.find((b) => b.from === target && b.status === "open" && b.kind === "law" && b.id !== entry.id);
    if (!theirs) return { ok: false, error: `${upper(target)} nu are nicio lege în dezbatere.` };
    if (!theirs.pledged.includes(partyId)) theirs.pledged.push(partyId);
    entry.deals[target] = (entry.deals[target] ?? 0) + 0.7;
    addRel(state, data, partyId, target, 4);
    log(state, "parl", "Schimb de voturi", `${upper(partyId)} votează „${theirs.title}”, iar ${upper(target)} votează proiectul ${upper(partyId)}.`);
    return { ok: true, message: `Schimb de voturi: votezi „${theirs.title}”, ${upper(target)} votează legea ta.` };
  }
  return { ok: false, error: "Tip de negociere necunoscut: favor, money sau swap." };
}

// The concrete amendments a bill offers: written ones, or one per segment it favors plus one that
// softens the blow for its biggest loser. Each carries effects that add to the law's on promulgation.
export function amendOptions(data, bill) {
  const own = data.amendments?.bills?.[bill.id];
  if (own) return own;
  const tpl = data.amendments?.templates ?? {};
  const byInterest = Object.entries(bill.interest ?? {}).sort((x, y) => y[1] - x[1]);
  const picks = byInterest.filter(([, v]) => v > 0).slice(0, 2).map(([seg]) => seg);
  const loser = byInterest.at(-1);
  if (loser && loser[1] <= -0.3) picks.push(loser[0]);
  else if (byInterest[2]) picks.push(byInterest[2][0]);
  // A bill with no declared interests still offers a few amendments.
  picks.push("tineri_urbani", "antreprenori", "bugetari");
  return [...new Set(picks)].slice(0, 3).filter((seg) => tpl[seg]).map((seg) => {
    const t = tpl[seg];
    return {
      id: seg, label: t.label, text: t.text,
      effects: { sol: { [seg]: 1.2, [t.hurt]: -0.3 } },
      interest: { [seg]: 0.4, [t.hurt]: -0.2 },
    };
  });
}

const amendedBy = (entry) => Object.values(entry.amended ?? {});

// A law's effects with the adopted amendments added on top.
export function lawEffects(data, billId, amended = {}) {
  const bill = billDef(data, billId);
  const fx = structuredClone(bill.effects);
  const add = (into, from) => {
    for (const [k, v] of Object.entries(from)) {
      if (typeof v === "number") into[k] = (into[k] ?? 0) + v;
      else add((into[k] ??= {}), v);
    }
  };
  const opts = amendOptions(data, bill);
  for (const id of Object.values(amended)) {
    const o = opts.find((x) => x.id === id);
    if (o) add(fx, o.effects);
  }
  return fx;
}

// Before the plenary vote a party can attach one concrete amendment to a law (3 capital).
// One per party, and each amendment can be adopted only once per bill.
export function amendBill(state, data, partyId, entryId, optionId) {
  const party = state.parties[partyId];
  const entry = state.parl.bills.find((b) => b.id === Number(entryId));
  if (!party || !entry || entry.kind !== "law") return { ok: false, error: "Nu există o lege de amendat." };
  if (entry.status !== "open") return { ok: false, error: "Votul s-a încheiat." };
  if (entry.amended?.[partyId]) return { ok: false, error: "Ai amendat deja legea." };
  const option = amendOptions(data, billDef(data, entry.bill)).find((o) => o.id === optionId);
  if (!option) return { ok: false, error: "Amendament necunoscut." };
  if (amendedBy(entry).includes(optionId)) return { ok: false, error: "Amendamentul a fost deja adoptat." };
  if (party.capital < COST.amend) return { ok: false, error: `Amendamentul costă ${COST.amend} capital politic.` };
  party.capital = round(party.capital - COST.amend, 1);
  (entry.amended ??= {})[partyId] = optionId;
  log(state, "parl", `Amendament: ${entry.title}`, `${upper(partyId)}: ${option.label}.`);
  return { ok: true, message: `Amendament adoptat: ${option.label}.` };
}

export function voteBill(state, data, partyId, entryId, vote) {
  const entry = state.parl.bills.find((b) => b.id === Number(entryId) && b.status === "open");
  if (!entry) return { ok: false, error: "Votul nu mai e deschis." };
  if (!["yes", "no", "abstain"].includes(vote)) return { ok: false, error: "Votează: yes, no sau abstain." };
  if (seatsOf(state, partyId) === 0 && !state.config.minoritySeats) return { ok: false, error: "Fără mandate nu poți vota." };
  if (entry.pledged.includes(partyId) && vote !== "yes") return { ok: false, error: "Ai promis voturile tale pentru această lege." };
  entry.votes[partyId] = vote;
  return { ok: true, message: vote === "yes" ? "Ai votat pentru." : vote === "no" ? "Ai votat împotrivă." : "Te abții." };
}

function resolve(state, data, entry) {
  const tally = { yes: 0, no: 0, abstain: 0 };
  const by = {};
  for (const p of state.partyIds) {
    const seats = seatsOf(state, p);
    if (!seats) continue;
    const score = stanceOf(state, data, p, entry);
    let vote = entry.votes[p];
    const natural = score > 0.1 ? "yes" : score < -0.1 ? "no" : "abstain";
    if (!vote) vote = natural;
    // Rebels: the less cohesive the party, the more of its members vote the other way.
    const cohesion = state.parties[p].cohesion ?? 72;
    const rebels = vote === "abstain" ? 0 : Math.round(seats * clamp((100 - cohesion) / 300, 0, 0.3) * (0.5 + rand(state)));
    const opposite = vote === "yes" ? "no" : "yes";
    tally[vote] += seats - rebels;
    if (rebels) tally[opposite] += rebels;
    by[p] = vote;
    if (state.humans.includes(p) && entry.votes[p] && entry.votes[p] !== natural && natural !== "abstain") {
      state.parties[p].cohesion = round(clamp(cohesion - 3, 0, 100), 1);
    }
  }
  const minority = state.config.minoritySeats ?? 0;
  if (minority) {
    const withGov = entry.kind === "law" && inGov(state, entry.from);
    tally[withGov ? "yes" : entry.kind === "motion" ? "no" : "abstain"] += minority;
  }
  entry.tally = tally;
  entry.by = by;
  // The Senate votes too, with its own seats: a law needs a majority there, and so does a censure motion.
  const sm = senateMapFrom(state);
  const senate = { yes: 0, no: 0, abstain: 0 };
  for (const [p, v] of Object.entries(by)) senate[v] += sm[p] ?? 0;
  entry.senateTally = senate;
  const chamberPass = entry.kind === "motion" ? tally.yes >= MAJORITY : tally.yes > tally.no;
  const senatePass = entry.kind === "motion" ? senate.yes >= SENATE_MAJORITY : senate.yes > senate.no;
  const passed = chamberPass && senatePass;
  entry.status = passed ? "passed" : "failed";
  if (chamberPass && !senatePass) {
    log(state, "parl", "Senatul a oprit votul", `Camera a votat ${tally.yes} la ${tally.no}, dar în Senat sunt ${senate.yes} pentru și ${senate.no} împotrivă.`);
  }

  if (entry.kind === "motion") {
    log(state, "parl", "Votul asupra moțiunii", `${tally.yes} pentru, ${tally.no} împotrivă, ${tally.abstain} abțineri. Pragul e ${MAJORITY}.`);
    if (passed) {
      fallGovernment(state, data, `Moțiunea depusă de ${upper(entry.from)} a trecut cu ${tally.yes} de voturi.`);
    } else {
      state.gov.confidence = clamp(state.gov.confidence + 4, 0, 100);
      state.mood[entry.from] = clamp((state.mood[entry.from] ?? 1) * 0.99, 0.55, 1.6);
    }
  } else {
    const def = billDef(data, entry.bill);
    for (const [p, v] of Object.entries(by)) {
      if (p === entry.from) continue;
      addRel(state, data, entry.from, p, v === "yes" ? 4 : v === "no" ? -1.5 : 0);
      if (v === "no" && hasPact(state, entry.from, p) && relation(state, data, entry.from, p) < 45) breakPact(state, entry.from, p);
      // Voting with another party's bill builds a relationship for the voter too.
      if (v === "yes" && passed) state.parties[p].capital = round(state.parties[p].capital + 0.8, 1);
    }
    log(state, "parl", passed ? `Lege adoptată: ${def.title}` : `Lege respinsă: ${def.title}`, `${tally.yes} pentru, ${tally.no} împotrivă, ${tally.abstain} abțineri. Inițiator: ${upper(entry.from)}.`);
    if (passed) {
      state.parl.passed[entry.bill] = state.day;
      // The law waits at Cotroceni: its effects apply only when the president promulgates it.
      queueLaw(state, data, entry, def);
      state.parties[entry.from].capital = round(state.parties[entry.from].capital + 4, 1);
      const cohesionGain = inGov(state, entry.from) ? 1 : 2;
      state.parties[entry.from].cohesion = round(clamp((state.parties[entry.from].cohesion ?? 72) + cohesionGain, 0, 100), 1);
    } else {
      state.parties[entry.from].capital = round(state.parties[entry.from].capital + 1, 1);
    }
  }
  state.parl.done.unshift({ id: entry.id, kind: entry.kind, title: entry.title, from: entry.from, status: entry.status, day: state.day, tally });
  state.parl.done = state.parl.done.slice(0, 20);
  state.parl.bills = state.parl.bills.filter((b) => b !== entry);
}

/* -------------------------------------------------------------- AI parties */

function aiBills(state, data) {
  if (data.config.parlAi === false) return;
  for (const p of state.partyIds) {
    if (state.humans.includes(p) || seatsOf(state, p) === 0 || openByParty(state, p)) continue;
    const chance = inGov(state, p) ? 0.5 : 0.3;
    if (rand(state) > chance) continue;
    const def = partyDef(state, data, p);
    const open = state.parl.bills.map((b) => b.bill);
    const options = data.bills.bills
      .filter((b) => !open.includes(b.id) && (state.parl.passed[b.id] == null || state.day - state.parl.passed[b.id] >= 540))
      .map((b) => {
        let s = -Math.abs(b.lean - (def.lean ?? 0));
        for (const [seg, v] of Object.entries(b.interest ?? {})) s += v * (def.affinity?.[seg] ?? 0.3) * 0.6;
        return { b, s: s + rand(state) * 0.4 };
      })
      .sort((a, b) => b.s - a.s);
    const pick = options[0]?.b;
    if (pick) openEntry(state, data, { kind: "law", bill: pick.id, from: p, days: LAW_DAYS, title: pick.title });
  }
}

function aiMotion(state, data) {
  const g = state.gov;
  if (g.caretaker || g.confidence >= 50) return;
  if ((state.budget.cool.motion ?? -1) > state.day || state.parl.bills.some((b) => b.kind === "motion" && b.status === "open")) return;
  const filers = state.partyIds.filter((p) => !state.humans.includes(p) && !inGov(state, p) && !g.support[p] && seatsOf(state, p) > 0);
  if (!filers.length || rand(state) > 0.35) return;
  const from = filers.sort((a, b) => seatsOf(state, b) - seatsOf(state, a))[0];
  state.budget.cool.motion = state.day + 120;
  openEntry(state, data, { kind: "motion", from, days: MOTION_DAYS, title: "Moțiune de cenzură" });
}

/* -------------------------------------------------------- merge and split */

const blend = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, "0")).join("")}`;
};

export function offerMerge(state, data, from, to, mode = "fusion", name = "") {
  if (!state.parties[from] || !state.parties[to] || from === to) return { ok: false, error: "Partid invalid." };
  if (!["fusion", "absorb", "pact"].includes(mode)) return { ok: false, error: "Alege fusion, absorb sau pact." };
  if (state.parl.mergeOffers.some((o) => o.from === from && o.to === to)) return { ok: false, error: "Oferta există deja." };
  if (mode === "pact" && hasPact(state, from, to)) return { ok: false, error: "Aveți deja un pact de colaborare." };
  const rel = relation(state, data, from, to);
  if (mode === "pact" && rel < PACT_MIN) return { ok: false, error: `Pactul cere o relație de cel puțin ${PACT_MIN} (acum ${Math.round(rel)}).` };
  const cost = mode === "pact" ? COST.pact : COST.merge;
  const party = state.parties[from];
  if (party.capital < cost) return { ok: false, error: `Capital politic insuficient (${cost} necesar).` };
  if (rel < 25) return { ok: false, error: `${upper(to)} nu vrea să negocieze cu tine acum.` };
  party.capital = round(party.capital - cost, 1);
  const offer = { from, to, mode, name: String(name || "").slice(0, 28), day: state.day };
  const what = mode === "fusion" ? ["Ofertă de fuziune", "o fuziune cu"] : mode === "pact" ? ["Ofertă de colaborare", "un pact de colaborare cu"] : ["Ofertă de absorbție", "absorbția"];
  log(state, "parl", what[0], `${upper(from)} propune ${what[1]} ${upper(to)}.`);
  if (state.humans.includes(to)) {
    state.parl.mergeOffers.push(offer);
    return { ok: true, message: `Oferta a fost trimisă către ${upper(to)}.` };
  }
  return answerMerge(state, data, offer, null);
}

export function acceptMerge(state, data, to, from, accept = true) {
  const offer = state.parl.mergeOffers.find((o) => o.from === from && o.to === to);
  if (!offer) return { ok: false, error: "Nu există ofertă." };
  state.parl.mergeOffers = state.parl.mergeOffers.filter((o) => o !== offer);
  return answerMerge(state, data, offer, accept);
}

function answerMerge(state, data, offer, forced) {
  const { from, to } = offer;
  let ok = forced;
  if (ok === null && offer.mode === "pact") {
    ok = rand(state) < clamp((relation(state, data, from, to) - 45) / 40, 0.05, 0.95);
  } else if (ok === null) {
    const bigger = seatsOf(state, from) >= seatsOf(state, to);
    const p = clamp((relation(state, data, from, to) - 40) / 50 + (bigger ? 0.1 : -0.1) - distance(state, data, from, to) * 1.2 + (hasPact(state, from, to) ? 0.2 : 0), 0.03, 0.9);
    ok = rand(state) < p;
  }
  if (!ok) {
    addRel(state, data, from, to, -3);
    log(state, "parl", "Propunere refuzată", `${upper(to)} a refuzat propunerea ${upper(from)}: „încă ne gândim”.`);
    return { ok: true, message: `${upper(to)} a refuzat.`, refused: true };
  }
  if (offer.mode === "pact") {
    state.parl.pacts.push({ a: from, b: to, day: state.day });
    addRel(state, data, from, to, 5);
    log(state, "parl", "Pact de colaborare", `${upper(from)} și ${upper(to)} colaborează strâns: își sprijină legile și își apără relația.`);
    return { ok: true, message: `Pact de colaborare cu ${upper(to)}.`, pact: true };
  }
  const merged = offer.mode === "fusion" ? fuse(state, data, [from, to], offer.name) : fuse(state, data, [from, to], offer.name, from);
  return { ok: true, message: `Fuziune încheiată: ${partyDef(state, data, merged).name}.`, merged };
}

// Fuses several parties into one. `keep` makes the survivor an existing party (absorption).
function fuse(state, data, ids, name, keep = null) {
  const poll = computePoll(state, data);
  const defs = ids.map((i) => partyDef(state, data, i));
  const shares = ids.map((i) => poll.national[i] ?? 0);
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const w = shares.map((s) => s / total);
  const lead = ids.slice().sort((a, b) => seatsOf(state, b) - seatsOf(state, a))[0];
  const newName = name || (keep ? partyDef(state, data, keep).name : defs.map((d) => d.name).join("-"));
  let newId = keep;
  if (!newId) {
    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grup";
    newId = slug;
    for (let n = 2; state.partyIds.includes(newId) && !ids.includes(newId); n += 1) newId = `${slug}-${n}`;
  }
  const mix = (get) => defs.reduce((s, d, i) => s + w[i] * get(d), 0);
  const affinity = Object.fromEntries(SEGMENTS.map((seg) => [seg, round(mix((d) => d.affinity?.[seg] ?? 0.3), 3)]));
  const counties = Object.keys(state.counties);
  const bias = Object.fromEntries(counties.map((c) => [c, round(mix((d) => d.bias?.[c] ?? 1), 3)]));
  const def = {
    ...partyDef(state, data, lead),
    id: newId, name: newName, fullName: keep ? defs[0].fullName : defs.map((d) => d.fullName ?? d.name).join(" + "),
    color: keep ? partyDef(state, data, keep).color : blend(defs[0].color, defs[1].color, 0.5),
    lean: round(mix((d) => d.lean ?? 0), 3), affinity, bias,
  };

  const sum = (f) => ids.reduce((s, i) => s + f(state.parties[i]), 0);
  const parent = state.parties[lead];
  const merged = {
    ...parent, id: newId, seats: sum((p) => p.seats ?? 0), funds: round(sum((p) => p.funds), 2),
    capital: round(sum((p) => p.capital) * 0.8, 1), boost: {}, segBoost: {}, cooldown: {},
    cohesion: round(ids.reduce((s, i, k) => s + w[k] * (state.parties[i].cohesion ?? 72), 0) - 4, 1),
    gov: ids.some((i) => state.parties[i].gov),
  };
  const leaderOf = state.leaders[lead];
  const strengthTarget = total;
  const moodAvg = ids.reduce((s, i, k) => s + w[k] * (state.mood[i] ?? 1), 0);
  const govMult = state.govMult?.[lead];

  // Rewrite every reference to the old ids.
  const re = (id) => (ids.includes(id) ? newId : id);
  const relOthers = {};
  for (const o of state.partyIds.filter((p) => !ids.includes(p))) {
    relOthers[o] = ids.reduce((s, i, k) => s + w[k] * relation(state, data, i, o), 0);
  }
  for (const k of Object.keys(state.parl.rel)) if (ids.some((i) => k.split("|").includes(i))) delete state.parl.rel[k];
  for (const [o, v] of Object.entries(relOthers)) state.parl.rel[key(newId, o)] = round(v, 1);

  const pos = state.partyIds.indexOf(ids.find((i) => state.partyIds.includes(i)));
  state.partyIds = state.partyIds.filter((p) => !ids.includes(p));
  state.partyIds.splice(Math.max(0, pos), 0, newId);
  for (const i of ids) {
    delete state.parties[i];
    delete state.strength[i];
    delete state.mood[i];
    delete state.leaders[i];
    if (state.govMult) delete state.govMult[i];
    if (state.defs[i]) delete state.defs[i];
  }
  state.defs[newId] = def;
  state.parties[newId] = merged;
  state.strength[newId] = 1;
  state.mood[newId] = round(moodAvg, 3);
  state.leaders[newId] = leaderOf ?? null;
  if (state.govMult) state.govMult[newId] = govMult;
  for (const p of Object.values(state.politicians)) p.party = re(p.party);
  for (const c of Object.values(state.counties)) {
    let boost = 0;
    for (const i of ids) {
      boost += c.boost[i] ?? 0;
      delete c.boost[i];
    }
    if (boost) c.boost[newId] = boost;
  }
  const g = state.gov;
  g.coalition = [...new Set(g.coalition.map(re))];
  g.support = Object.fromEntries(Object.entries(g.support).map(([p, v]) => [re(p), v]).filter(([p]) => !g.coalition.includes(p)));
  for (const slot of Object.values(g.ministries)) slot.party = re(slot.party);
  g.pmParty = re(g.pmParty);
  state.coalitions = state.coalitions.map((c) => ({ ...c, parties: [...new Set(c.parties.map(re))] }));
  state.offers = state.offers.map((o) => ({ ...o, from: re(o.from), to: re(o.to) })).filter((o) => o.from !== o.to);
  state.proposals.forEach((p) => {
    p.from = re(p.from);
    p.to = p.to ? re(p.to) : p.to;
  });
  state.decisions.forEach((d) => (d.party = re(d.party)));
  if (state.pendingBloc) state.pendingBloc = [...new Set(state.pendingBloc.map(re))];
  for (const b of state.parl.bills) {
    b.from = re(b.from);
    for (const m of ["deals", "votes"]) {
      for (const [p, v] of Object.entries(b[m])) {
        if (re(p) !== p) {
          b[m][re(p)] = b[m][re(p)] ?? v;
          delete b[m][p];
        }
      }
    }
    b.pledged = [...new Set(b.pledged.map(re))];
  }
  state.parl.pacts = state.parl.pacts.map((p) => ({ ...p, a: re(p.a), b: re(p.b) })).filter((p) => p.a !== p.b);
  state.parl.mergeOffers = state.parl.mergeOffers.filter((o) => !ids.includes(o.from) && !ids.includes(o.to));
  state.humans = [...new Set(state.humans.map(re))];
  for (const i of ids) if (i !== newId) state.renamed[i] = newId;

  // The merged party is worth about the sum of its parts in the polls.
  for (let k = 0; k < 20; k += 1) {
    const have = computePoll(state, data).national[newId] || 1e-6;
    state.strength[newId] *= Math.pow(strengthTarget / have, 0.8);
  }
  g.confidence = clamp(g.confidence - (ids.some((i) => g.coalition.includes(re(i))) ? 2 : 0), 0, 100);
  log(state, "parl", keep ? `${newName} absoarbe un partid` : `Fuziune: ${newName}`, `${ids.map(upper).join(" + ")} merg împreună, cu ${merged.seats} de mandate și o conducere comună.`);
  return newId;
}

export function splinterOptions(state, data, partyId) {
  return data.splinters.splinters.filter((t) => !state.partyIds.includes(t.id) && (t.from.includes(partyId) || !t.from.length));
}

// People leave a party and form another group. `template` picks a historical
// name; otherwise the group is named after its leader.
export function splitParty(state, data, partyId, opts = {}) {
  const parent = state.parties[partyId];
  if (!parent) return { ok: false, error: "Partid necunoscut." };
  if (parent.seats < 4) return { ok: false, error: "Partidul are prea puțini parlamentari pentru o despărțire." };
  const frac = clamp(Number(opts.frac ?? 0.25), 0.1, 0.5);
  const template = opts.template ? data.splinters.splinters.find((t) => t.id === opts.template) : null;
  if (opts.template && (!template || state.partyIds.includes(template.id))) return { ok: false, error: "Numele nu mai e disponibil." };

  const members = Object.values(state.politicians).filter((p) => p.party === partyId && p.id !== state.leaders[partyId]);
  const want = Math.max(1, Math.round(members.length * frac));
  const chosen = (opts.politicians?.length ? members.filter((m) => opts.politicians.includes(m.id)) : members.slice().sort((a, b) => b.stats.traseism - a.stats.traseism)).slice(0, want);
  const chief = chosen.slice().sort((a, b) => b.stats.charisma - a.stats.charisma)[0] ?? null;

  const id = template?.id ?? `grup-${state.parl.next}`;
  state.parl.next += 1;
  const def0 = partyDef(state, data, partyId);
  const name = template?.name ?? (opts.name ? String(opts.name).slice(0, 24) : chief ? `Grupul ${chief.name.split(" ").slice(-1)[0]}` : "Grup nou");
  const shift = template ? template.lean - (def0.lean ?? 0) : rand(state) < 0.5 ? 0.2 : -0.2;
  const def = {
    ...def0, id, name, fullName: template?.fullName ?? `${name}, grup desprins din ${def0.name}`,
    color: template?.color ?? blend(def0.color, "#ffffff", 0.35), lean: round(clamp((def0.lean ?? 0) + shift, -1, 1), 3), leader: undefined,
    affinity: Object.fromEntries(SEGMENTS.map((seg) => [seg, round(clamp((def0.affinity?.[seg] ?? 0.3) + (rand(state) - 0.5) * 0.12, 0.05, 1), 3)])),
  };
  const seats = Math.max(1, Math.round(parent.seats * frac));
  parent.seats -= seats;
  const funds = round(parent.funds * frac, 2);
  parent.funds = round(parent.funds - funds, 2);
  parent.cohesion = round(clamp((parent.cohesion ?? 72) + 8 - 12, 0, 100), 1);
  state.partyIds.push(id);
  state.defs[id] = def;
  state.parties[id] = { id, funds, capital: 12, boost: {}, segBoost: {}, cooldown: {}, seats, share: 0, gov: parent.gov, cohesion: 70 };
  state.strength[id] = state.strength[partyId] * frac;
  state.strength[partyId] *= 1 - frac;
  state.mood[id] = 1;
  state.leaders[id] = chief?.id ?? null;
  if (state.govMult) state.govMult[id] = state.govMult[partyId];
  for (const m of chosen) {
    m.party = id;
    for (const slot of Object.values(state.gov.ministries)) if (slot.minister === m.id) slot.party = id;
  }
  if (state.leaders[partyId] && !state.politicians[state.leaders[partyId]]) state.leaders[partyId] = null;
  if (inGov(state, partyId)) {
    state.gov.coalition.push(id);
    state.gov.confidence = clamp(state.gov.confidence - 3, 0, 100);
  } else if (partyId in state.gov.support) state.gov.support[id] = state.gov.support[partyId];
  addRel(state, data, id, partyId, 0);
  state.parl.rel[key(id, partyId)] = 30;
  log(state, "parl", `${name} se desparte de ${upper(partyId)}`, `${chosen.map((m) => m.name).join(", ") || "Un grup de parlamentari"} pleacă cu ${seats} de mandate. ${template?.text ?? ""}`.trim());
  return { ok: true, message: `${name} s-a desprins cu ${seats} de mandate.`, id };
}

function aiShuffle(state, data) {
  const humans = state.humans;
  // Merges: weak, similar parties band together.
  const poll = computePoll(state, data);
  // Only parties without seats band together on their own; the others negotiate with the player.
  const weak = state.partyIds.filter((p) => !humans.includes(p) && seatsOf(state, p) === 0 && (poll.national[p] ?? 0) < 0.05);
  for (const a of weak) {
    if (rand(state) > 0.04) continue;
    const b = weak.find((q) => q !== a && distance(state, data, a, q) < 0.2 && relation(state, data, a, q) > 50 && a.length + q.length < 16);
    if (b && state.partyIds.includes(a) && state.partyIds.includes(b)) {
      fuse(state, data, [a, b], "");
      return;
    }
  }
  // Splits: restless parties lose people.
  for (const p of state.partyIds) {
    if (state.parties[p].seats < 12) continue;
    const co = state.parties[p].cohesion ?? 72;
    const chance = co < 45 ? 0.18 : co < 60 ? 0.04 : 0.006;
    if (rand(state) > chance) continue;
    const opts = splinterOptions(state, data, p);
    splitParty(state, data, p, { frac: 0.15 + rand(state) * 0.2, template: opts.length && rand(state) < 0.6 ? opts[0].id : undefined });
    if (humans.includes(p)) state.parl.cool.splitWarned = state.day;
    return;
  }
}

/* ----------------------------------------------------------------- profile */

function ownDef(state, data, id) {
  if (!state.defs[id]) state.defs[id] = structuredClone(partyDef(state, data, id));
  return state.defs[id];
}

// Moves the party's focus: `segment` raises one group of voters (the rest
// share the cost), `lean` moves it left (+) or right (-).
export function shiftParty(state, data, partyId, change) {
  const party = state.parties[partyId];
  if (!party) return { ok: false, error: "Partid necunoscut." };
  const until = state.parl.cool[`shift:${partyId}`] ?? -1;
  if (until > state.day) return { ok: false, error: `Direcția se poate schimba din nou în ziua ${until}.` };
  if (party.capital < COST.shift) return { ok: false, error: `Capital politic insuficient (${COST.shift} necesar).` };
  const def = ownDef(state, data, partyId);
  if (change.segment) {
    if (!SEGMENTS.includes(change.segment)) return { ok: false, error: "Categorie necunoscută." };
    const up = 0.1;
    const others = SEGMENTS.filter((s) => s !== change.segment);
    def.affinity[change.segment] = round(clamp((def.affinity[change.segment] ?? 0.3) + up, 0.05, 1), 3);
    for (const s of others) def.affinity[s] = round(clamp((def.affinity[s] ?? 0.3) - up / others.length, 0.05, 1), 3);
  } else if (change.lean) {
    def.lean = round(clamp((def.lean ?? 0) + (change.lean > 0 ? 0.12 : -0.12), -1, 1), 3);
  } else {
    return { ok: false, error: "Alege o categorie sau o direcție." };
  }
  party.capital = round(party.capital - COST.shift, 1);
  party.cohesion = round(clamp((party.cohesion ?? 72) - 3, 0, 100), 1);
  state.parl.cool[`shift:${partyId}`] = state.day + 45;
  log(state, "parl", `${upper(partyId)} își schimbă direcția`, change.segment ? "Conducerea mută accentul pe alte categorii de votanți." : "Conducerea mută partidul pe o altă linie politică.");
  return { ok: true, message: "Direcția partidului s-a schimbat. Unii dintre oameni nu sunt de acord." };
}

/* --------------------------------------------- unaffiliated MPs and support offers */

// A shaky AI party sheds an MP now and then; unaffiliated MPs wait to be recruited.
function driftToFree(state) {
  const p = state.parl;
  p.free ??= 0;
  if (p.free >= RECRUIT.maxFree || rand(state) > 0.35) return;
  const pool = state.partyIds.filter((id) => !state.humans.includes(id) && seatsOf(state, id) >= 10);
  if (!pool.length) return;
  const weights = pool.map((id) => 100 - (state.parties[id].cohesion ?? 72));
  let r = rand(state) * weights.reduce((a, b) => a + b, 0);
  const idx = weights.findIndex((w) => (r -= w) < 0);
  const id = pool[idx < 0 ? 0 : idx];
  state.parties[id].seats -= 1;
  p.free += 1;
  log(state, "parl", "Un parlamentar a plecat", `Un parlamentar ${upper(id)} a părăsit grupul și rămâne neafiliat. Alte partide îl curtează deja.`);
}

// Take MPs: from the unaffiliated group (no `from`) or poached from a rival with a shaky group.
export function recruitMps(state, data, partyId, opts = {}) {
  const party = state.parties[partyId];
  if (!party) return { ok: false, error: "Partid necunoscut." };
  const from = opts.from || null;
  const tier = from ? RECRUIT.poach : RECRUIT.pool;
  const until = state.parl.cool[`recruit:${partyId}`] ?? -1;
  if (until > state.day) return { ok: false, error: `Un nou val de recrutări e posibil din ziua ${until}.` };
  let available;
  if (from) {
    const v = state.parties[from];
    if (!v || from === partyId) return { ok: false, error: "Alege un alt partid." };
    if ((v.cohesion ?? 72) >= tier.cohesionBelow) return { ok: false, error: `${upper(from)} își ține oamenii: grupul lui e prea unit (sub ${tier.cohesionBelow} de coeziune).` };
    if ((v.seats ?? 0) < tier.minSeats) return { ok: false, error: `${upper(from)} are prea puțini parlamentari de luat.` };
    available = Math.min(tier.max, v.seats - tier.minSeats + 1);
  } else {
    available = Math.min(tier.max, state.parl.free ?? 0);
    if (available <= 0) return { ok: false, error: "Nu sunt parlamentari neafiliați." };
  }
  const n = Math.max(1, Math.min(Number(opts.count) || 1, available));
  const capital = tier.capital * n;
  const money = round(tier.money * n, 1);
  if (party.capital < capital || party.funds < money) return { ok: false, error: `${n} parlamentari costă ${capital} capital politic și ${money} M€.` };
  party.capital = round(party.capital - capital, 1);
  party.funds = round(party.funds - money, 2);
  party.seats = (party.seats ?? 0) + n;
  state.parl.cool[`recruit:${partyId}`] = state.day + RECRUIT.cooldown;
  if (from) {
    state.parties[from].seats -= n;
    state.parties[from].cohesion = round(clamp((state.parties[from].cohesion ?? 72) - 4, 0, 100), 1);
    addRel(state, data, partyId, from, -8);
    log(state, "parl", "Parlamentari mutați", `${n} parlamentari ${upper(from)} trec la ${upper(partyId)}. Relația dintre cele două partide are de suferit.`);
    return { ok: true, message: `${n} parlamentari au trecut de la ${upper(from)} la tine.` };
  }
  state.parl.free -= n;
  log(state, "parl", "Parlamentari recrutați", `${upper(partyId)} aduce ${n} parlamentari neafiliați în grupul său.`);
  return { ok: true, message: `${n} parlamentari neafiliați s-au alăturat grupului tău.` };
}

// An AI party that files a law courts the human parties that would not vote yes on their own.
function makeSupportOffers(state, data, entry) {
  const from = state.parties[entry.from];
  for (const to of state.humans) {
    if (to === entry.from || seatsOf(state, to) === 0) continue;
    const score = lawScore(state, data, to, entry);
    if (score >= 0.4) continue;
    const gap = 0.4 - score;
    const money = round(clamp(0.3 + gap * 0.6, 0.3, 2), 1);
    const capital = Math.round(clamp(1 + gap * 2, 1, 6));
    if (!from || from.funds < money + 0.5) continue;
    state.parl.supportOffers.push({ id: state.parl.nextOffer, entry: entry.id, from: entry.from, to, money, capital, day: state.day });
    state.parl.nextOffer += 1;
  }
}

// Answer an offer: accepting pays you and binds your votes (the pledge cannot be broken).
export function answerOffer(state, data, partyId, offerId, accept) {
  const offer = state.parl.supportOffers.find((o) => o.id === Number(offerId) && o.to === partyId);
  if (!offer) return { ok: false, error: "Oferta nu mai e valabilă." };
  const entry = state.parl.bills.find((b) => b.id === offer.entry && b.status === "open");
  state.parl.supportOffers = state.parl.supportOffers.filter((o) => o !== offer);
  if (!accept) return { ok: true, message: "Ai refuzat oferta." };
  if (!entry) return { ok: false, error: "Votul s-a încheiat." };
  const giver = state.parties[offer.from];
  if (giver.funds < offer.money) return { ok: false, error: "Partidul nu mai are banii promiși." };
  const me = state.parties[partyId];
  giver.funds = round(giver.funds - offer.money, 2);
  giver.capital = round(Math.max(0, giver.capital - offer.capital), 1);
  me.funds = round(me.funds + offer.money, 2);
  me.capital = round(me.capital + offer.capital, 1);
  if (!entry.pledged.includes(partyId)) entry.pledged.push(partyId);
  entry.votes[partyId] = "yes";
  addRel(state, data, partyId, offer.from, 4);
  log(state, "parl", "Sprijin cumpărat", `${upper(partyId)} votează „${entry.title}” în schimbul a ${offer.money} M€ și ${offer.capital} capital politic de la ${upper(offer.from)}.`);
  return { ok: true, message: `Ai primit ${offer.money} M€ și ${offer.capital} capital politic. Votezi pentru.` };
}

// Big instruments: a party with a lot of political capital can spend it on something large.
// Each has a capital price, a small money price, and a cooldown. The effects are real but slow.
const INSTRUMENTS = [
  { id: "program", name: "Program național", cost: 30, funds: 2, cooldown: 60, text: "Un document de 200 de pagini, citit de trei jurnaliști și comentat de toți." },
  { id: "reform", name: "Reformă internă", cost: 35, funds: 1, cooldown: 90, text: "Congres, organigramă nouă și o parte din vechea gardă mutată în afara listelor." },
  { id: "tour", name: "Turneu național", cost: 40, funds: 4, cooldown: 60, text: "Patruzeci de orașe în patruzeci de zile. Două sunt pe listă și alea." },
];

export function instrument(state, data, partyId, id) {
  const party = state.parties[partyId];
  const def = INSTRUMENTS.find((i) => i.id === id);
  if (!party || !def) return { ok: false, error: "Instrument necunoscut." };
  const key = "inst:" + partyId + ":" + id;
  const until = state.parl.cool[key] ?? -1;
  if (until > state.day) return { ok: false, error: "Se poate folosi din ziua " + until + "." };
  if (party.capital < def.cost) return { ok: false, error: "Capital politic insuficient (" + def.cost + " necesar)." };
  if (party.funds < def.funds) return { ok: false, error: "Fonduri insuficiente (" + def.funds + " M€ necesari)." };
  party.capital = round(party.capital - def.cost, 1);
  party.funds = round(party.funds - def.funds, 2);
  state.parl.cool[key] = state.day + def.cooldown;
  const ctx = { partyId, title: def.name };
  if (id === "program") {
    applyEffects(state, data, { party: { self: 0.03 }, segments: { tineri_urbani: 0.01, muncitori: 0.01, pensionari_rural: 0.01 } }, ctx);
  } else if (id === "reform") {
    party.cohesion = round(clamp((party.cohesion ?? 72) + 12, 0, 100), 1);
    applyEffects(state, data, { party: { self: 0.02 } }, ctx);
  } else {
    applyEffects(state, data, { party: { self: 0.05 }, segments: { pensionari_rural: 0.015, agricultori: 0.015, pensionari_urban: 0.01 } }, ctx);
  }
  log(state, "parl", def.name, def.text);
  return { ok: true, message: def.name + ": " + def.text };
}

/* ------------------------------------------------------- courtesy and pacts */

const COURTESY = { capital: 4, gain: 8, days: 20 };
const PACT_MIN = 55;

export const hasPact = (state, a, b) => state.parl.pacts.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

function breakPact(state, a, b) {
  state.parl.pacts = state.parl.pacts.filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a)));
  log(state, "parl", "Colaborarea s-a rupt", `${upper(a)} și ${upper(b)} nu mai au un pact de colaborare.`);
}

// A visit, a joint statement: cheap, repeatable, and the quickest way to warm a relation.
export function courtesy(state, data, partyId, target) {
  const party = state.parties[partyId];
  if (!party || !state.parties[target] || target === partyId) return { ok: false, error: "Alege un partid." };
  const key2 = `court:${key(partyId, target)}`;
  if ((state.parl.cool[key2] ?? -1) > state.day) return { ok: false, error: `Un nou gest e posibil din ziua ${state.parl.cool[key2]}.` };
  if (party.capital < COURTESY.capital) return { ok: false, error: `Capital politic insuficient (${COURTESY.capital} necesar).` };
  party.capital = round(party.capital - COURTESY.capital, 1);
  state.parl.cool[key2] = state.day + COURTESY.days;
  addRel(state, data, partyId, target, COURTESY.gain);
  return { ok: true, message: `Gest către ${upper(target)}: relația crește cu ${COURTESY.gain}.` };
}

// What the balance needs each month: credit fades, governing wears down, small parties can break through.
function balanceMonthly(state, data) {
  if (data.config.balance === false) return;
  const poll = computePoll(state, data);
  const g = state.gov;
  for (const p of state.partyIds) {
    let m = state.mood[p] ?? 1;
    m += (1 - m) * 0.04;
    // The cost of ruling: every month in government costs a little support.
    if (g.coalition.includes(p)) m *= p === g.pmParty ? 0.992 : 0.9945;
    state.mood[p] = clamp(m, 0.55, p === g.pmParty ? 1.4 : 1.45);
    // The player's party below the threshold gains ground on its own (up to 1.8x), as outsiders do
    // when voters look for something new; campaigning and decisions do the rest.
    const share = poll.national[p] ?? 0;
    if (share < 0.05 && state.humans.includes(p)) {
      state.parl.base ??= {};
      const base = (state.parl.base[p] ??= state.strength[p]);
      state.strength[p] = Math.min(base * 1.8, state.strength[p] * (1 + 0.02 * (1 - share / 0.05)));
    }
  }
}

/* ---------------------------------------------------------------- the clock */

export function parlDaily(state, data) {
  for (const b of [...state.parl.bills]) if (state.day >= b.vote) resolve(state, data, b);
  // Offers lapse with their vote.
  state.parl.supportOffers = (state.parl.supportOffers ?? []).filter((o) => state.parl.bills.some((b) => b.id === o.entry && b.status === "open"));
}

export function parlMonthly(state, data) {
  balanceMonthly(state, data);
  // Relations drift: partners warm up, rivals cool down, everything slides back to its base.
  const ids = state.partyIds.filter((p) => seatsOf(state, p) > 0);
  const g = state.gov;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const [a, b] = [ids[i], ids[j]];
      const cur = relation(state, data, a, b);
      const base = baseRel(state, data, a, b);
      let d = (base - cur) * 0.06;
      if (inGov(state, a) && inGov(state, b)) d += 2.5;
      if (hasPact(state, a, b)) d += 1.5;
      else if (inGov(state, a) !== inGov(state, b) && !g.support[a] && !g.support[b]) d -= 0.4;
      else if ((inGov(state, a) && g.support[b]) || (inGov(state, b) && g.support[a])) d += 1.5;
      state.parl.rel[key(a, b)] = round(clamp(cur + d, 0, 100), 1);
    }
  }
  for (const p of state.partyIds) {
    const c = state.parties[p];
    let co = (c.cohesion ?? 72) + ((72 - (c.cohesion ?? 72)) * 0.06);
    if (inGov(state, p) && g.confidence < 40) co -= 2;
    if (c.seats === 0) co += 0.5;
    c.cohesion = round(clamp(co, 0, 100), 1);
  }
  driftToFree(state);
  aiBills(state, data);
  aiMotion(state, data);
  aiShuffle(state, data);
  // Human parties with a shaky group get a decision: a group asks to leave.
  for (const p of state.partyIds) {
    if (!state.humans.includes(p)) continue;
    const c = state.parties[p];
    if ((c.cohesion ?? 72) >= 50 || (c.seats ?? 0) < 8) continue;
    if (state.decisions.some((d) => d.party === p && d.defection)) continue;
    if (rand(state) > 0.12) continue;
    const seats = Math.max(2, Math.round(c.seats * 0.1));
    state.decisions.push({ id: state.nextDecision, party: p, eventId: null, defection: { seats }, day: state.day, expires: state.day + 10 });
    state.nextDecision += 1;
  }
}

export function consumeRenamed(state) {
  const r = state.renamed ?? {};
  state.renamed = {};
  return r;
}

/* ---------------------------------------------------------------- snapshot */

export function parlSnapshot(state, data) {
  const open = state.parl.bills.map((b) => ({
    id: b.id, kind: b.kind, bill: b.bill ?? null, title: b.title, text: b.bill ? billDef(data, b.bill).text : "Votul trebuie să strângă 166 de voturi pentru ca guvernul să cadă.",
    from: b.from, day: b.day, vote: b.vote, deals: b.deals, pledged: b.pledged, votes: b.votes, amended: b.amended ?? {},
    options: b.kind === "law" ? amendOptions(data, billDef(data, b.bill)).map((o) => ({ id: o.id, label: o.label, text: o.text, effects: o.effects })) : [],
    stance: Object.fromEntries(state.partyIds.filter((p) => seatsOf(state, p) > 0).map((p) => [p, round(stanceOf(state, data, p, b), 2)])),
  }));
  const rel = {};
  for (const a of state.partyIds) {
    rel[a] = {};
    for (const b of state.partyIds) if (a !== b) rel[a][b] = relation(state, data, a, b);
  }
  return {
    bills: open,
    done: state.parl.done,
    rel,
    cohesion: Object.fromEntries(state.partyIds.map((p) => [p, state.parties[p].cohesion ?? 72])),
    mergeOffers: state.parl.mergeOffers,
    pacts: state.parl.pacts,
    courtesy: COURTESY,
    pactMin: PACT_MIN,
    cool: state.parl.cool,
    catalog: data.bills.bills.map((b) => ({ source: sourceOf(data, b), id: b.id, title: b.title, text: b.text, lean: b.lean, interest: b.interest, openNow: state.parl.bills.some((x) => x.bill === b.id), passedDay: state.parl.passed[b.id] ?? null })),
    splinters: Object.fromEntries(state.partyIds.map((p) => [p, splinterOptions(state, data, p).map((t) => ({ id: t.id, name: t.name, fullName: t.fullName }))])),
    costs: COST,
    instruments: INSTRUMENTS,
    recruit: RECRUIT,
    free: state.parl.free ?? 0,
    supportOffers: (state.parl.supportOffers ?? []).map((o) => ({ ...o, title: state.parl.bills.find((b) => b.id === o.entry)?.title ?? "" })),
    needed: MAJORITY,
  };
}


/* ---------------------------------------------------------------- dispatch */

// One entry point for the server, the browser and the ctl.
export function applyParl(state, data, partyId, a = {}) {
  if (!state.parties[partyId]) return { ok: false, error: "Partid necunoscut." };
  switch (a.type) {
    case "bill": return proposeBill(state, data, partyId, a.bill);
    case "motion": return fileMotion(state, data, partyId);
    case "vote": return voteBill(state, data, partyId, a.id, a.vote);
    case "amend": return amendBill(state, data, partyId, a.id, a.option);
    case "recruit": return recruitMps(state, data, partyId, { from: a.from, count: a.count });
    case "offer": return answerOffer(state, data, partyId, a.id, a.accept === true);
    case "instrument": return instrument(state, data, partyId, a.id);
    case "lobby": return lobby(state, data, partyId, a.id, a.target, a.how, a.against === true);
    case "merge": return offerMerge(state, data, partyId, a.target, a.mode, a.name);
    case "courtesy": return courtesy(state, data, partyId, a.target);
    case "pres-run": return nominate(state, data, partyId);
    case "pres-back": return backCandidate(state, data, partyId, a.target);
    case "ccr": return challengeCCR(state, data, partyId, a.id);
    case "merge-answer": return acceptMerge(state, data, partyId, a.from, a.accept !== false);
    case "shift": return shiftParty(state, data, partyId, { segment: a.segment, lean: a.lean });
    case "split": {
      if (state.parties[partyId].capital < 10) return { ok: false, error: "Capital politic insuficient (10 necesar)." };
      const res = splitParty(state, data, partyId, a);
      if (res.ok) state.parties[partyId].capital = round(state.parties[partyId].capital - 10, 1);
      return res;
    }
    default: return { ok: false, error: "Acțiune parlamentară necunoscută." };
  }
}
