// The presidency: who sits at Cotroceni, the election every five years (two rounds, with
// partners backing a candidate), and the law pipeline after a plenary vote: the president
// promulgates, sends the law back to Parliament, or refers it to the Constitutional Court.
import { clamp, rand, log, round, partyDef, dayOf } from "./util.mjs";
import { computePoll, applyEffects } from "./engine.mjs";
import { distance, relation, addRel, reopenLaw, lawEffects } from "./parl.mjs";

const TERM_DAYS = 1826;
const NOMINATION_WINDOW = 150; // days before the vote when candidacies open
const BACKING_WINDOW = 120; // days before the vote when partners may back a candidate
const HUMAN_WAIT = 7; // days a human president's party has to decide before the AI does
const MIN_SHARE_TO_RUN = 0.02;

export function initPresidency(state, data, sc) {
  const pres = sc.president ? state.politicians[sc.president] : null;
  state.pres = {
    president: { id: pres?.id ?? null, party: pres?.party ?? null, since: -1000, termEnd: dayOf(sc.startDate, sc.presidentialDate) },
    electionDay: dayOf(sc.startDate, sc.presidentialDate),
    nominated: {},
    backing: {},
    pending: [],
    nextPending: 1,
    lastResult: null,
    returned: {},
  };
}

const presLean = (state, data) => (state.pres.president.party ? partyDef(state, data, state.pres.president.party)?.lean ?? 0 : 0);
const humanPresident = (state) => !!state.pres.president.party && state.humans.includes(state.pres.president.party);

// The leader if they have a name, otherwise the most charismatic member of the party.
export function candidateOf(state, partyId) {
  const leader = state.leaders[partyId];
  if (leader && state.politicians[leader]) return leader;
  const best = Object.values(state.politicians)
    .filter((p) => p.party === partyId)
    .sort((a, b) => b.stats.charisma - a.stats.charisma)[0];
  return best?.id ?? null;
}

/* ------------------------------------------------------------ the election */

export function runPresidentialElection(state, data) {
  const poll = computePoll(state, data).national;
  const runners = state.partyIds.filter((p) => (poll[p] ?? 0) >= MIN_SHARE_TO_RUN || state.pres.nominated[p]);
  const score = {};
  for (const p of runners) {
    const id = candidateOf(state, p);
    if (!id) continue;
    score[p] = (poll[p] ?? 0) * (0.85 + state.politicians[id].stats.charisma / 250);
  }
  // Partners that back a candidate hand 80% of their vote over to it.
  for (const [cand, partners] of Object.entries(state.pres.backing)) {
    if (score[cand] == null) continue;
    for (const q of partners) {
      if (score[q] == null) continue;
      const t = score[q] * 0.8;
      score[cand] += t;
      score[q] -= t;
    }
  }
  const total = Object.values(score).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const share = Object.fromEntries(Object.entries(score).map(([p, v]) => [p, Math.max(0, v) / total]));
  const ranked = Object.entries(share).sort((a, b) => b[1] - a[1]);
  let winner = ranked[0]?.[0] ?? state.pres.president.party;
  let round1 = true;
  if (ranked.length >= 2 && ranked[0][1] < 0.5) {
    // Second round: the other candidates' voters go to whoever they are closer to.
    round1 = false;
    const [a, b] = [ranked[0][0], ranked[1][0]];
    let sa = share[a];
    let sb = share[b];
    for (const [o, v] of ranked.slice(2)) {
      const da = Math.max(0.01, distance(state, data, a, o));
      const db = Math.max(0.01, distance(state, data, b, o));
      sa += v * (db / (da + db));
      sb += v * (da / (da + db));
    }
    winner = sa >= sb ? a : b;
  }
  const id = candidateOf(state, winner);
  state.pres.president = { id, party: winner, since: state.day, termEnd: state.day + TERM_DAYS };
  state.pres.lastResult = { day: state.day, winner, round: round1 ? 1 : 2, shares: ranked.slice(0, 5).map(([p, v]) => [p, round(v, 3)]) };
  state.pres.nominated = {};
  state.pres.backing = {};
  state.pres.electionDay += TERM_DAYS;
  log(state, "election", "Alegeri prezidențiale", `${(winner ?? "").toUpperCase()} a câștigat ${round1 ? "din primul tur" : "în turul al doilea"}. Președinte: ${state.politicians[id]?.name ?? "fără nume"}.`);
}

/* ------------------------------------------------------------ candidacies and backing */

export function nominate(state, data, partyId) {
  const p = state.pres;
  const party = state.parties[partyId];
  if (!party) return { ok: false, error: "Partid necunoscut." };
  const toVote = p.electionDay - state.day;
  if (toVote > NOMINATION_WINDOW || toVote <= 0) return { ok: false, error: `Candidaturile se depun în ultimele ${NOMINATION_WINDOW} de zile.` };
  if (p.nominated[partyId]) return { ok: false, error: "Ați depus deja o candidatură." };
  const share = computePoll(state, data).national[partyId] ?? 0;
  if (share < MIN_SHARE_TO_RUN) return { ok: false, error: `Sub ${Math.round(MIN_SHARE_TO_RUN * 100)}% în sondaje nu se poate candida.` };
  const cand = candidateOf(state, partyId);
  if (!cand) return { ok: false, error: "Partidul nu are un candidat." };
  if (party.capital < 15 || party.funds < 1.5) return { ok: false, error: "Candidatura costă 15 capital politic și 1,5 M€ (strângerea de semnături)." };
  party.capital = round(party.capital - 15, 1);
  party.funds = round(party.funds - 1.5, 1);
  p.nominated[partyId] = true;
  log(state, "election", "Candidatură prezidențială", `${partyId.toUpperCase()} îl propune pe ${state.politicians[cand].name}.`);
  return { ok: true, message: `Candidatură depusă: ${state.politicians[cand].name}.` };
}

// A partner backs a nominated candidate. The AI partner says yes when they are close enough.
export function backCandidate(state, data, partnerId, candidateParty) {
  const p = state.pres;
  const toVote = p.electionDay - state.day;
  if (toVote > BACKING_WINDOW || toVote <= 0) return { ok: false, error: `Sprijinul se dă în ultimele ${BACKING_WINDOW} de zile.` };
  if (!p.nominated[candidateParty]) return { ok: false, error: "Candidatul nu a fost propus." };
  if (partnerId === candidateParty) return { ok: false, error: "Nu îți poți susține propria candidatură." };
  if (Object.values(p.backing).some((list) => list.includes(partnerId))) return { ok: false, error: "Ai deja un candidat susținut." };
  const party = state.parties[partnerId];
  if (!party) return { ok: false, error: "Partid necunoscut." };
  if (party.capital < 5) return { ok: false, error: "Sprijinul costă 5 capital politic." };
  const rel = relation(state, data, partnerId, candidateParty);
  const close = distance(state, data, partnerId, candidateParty) <= 0.4;
  if (rel < 45 || !close) return { ok: false, error: `${partnerId.toUpperCase()} nu se regăsește în programul ${candidateParty.toUpperCase()}.` };
  party.capital = round(party.capital - 5, 1);
  (p.backing[candidateParty] ??= []).push(partnerId);
  addRel(state, data, partnerId, candidateParty, 3);
  log(state, "election", "Sprijin pentru prezidențiale", `${partnerId.toUpperCase()} își pune voturile în spatele ${candidateParty.toUpperCase()}.`);
  return { ok: true, message: `Ai sprijinit candidatura ${candidateParty.toUpperCase()}.` };
}

// Parties without a human at the keyboard decide their own candidacies and partners.
function aiCampaignMoves(state, data) {
  const p = state.pres;
  const toVote = p.electionDay - state.day;
  const poll = computePoll(state, data).national;
  if (toVote <= NOMINATION_WINDOW && toVote > NOMINATION_WINDOW - 1) {
    for (const id of state.partyIds) {
      if (state.humans.includes(id) || p.nominated[id]) continue;
      if ((poll[id] ?? 0) >= 0.04 && candidateOf(state, id)) p.nominated[id] = true;
    }
  }
  if (toVote <= BACKING_WINDOW && toVote > BACKING_WINDOW - 1) {
    const cands = Object.keys(p.nominated);
    for (const id of state.partyIds) {
      if (state.humans.includes(id) || cands.includes(id) || (poll[id] ?? 0) >= 0.06) continue;
      const pick = cands
        .filter((c) => relation(state, data, id, c) >= 45 && distance(state, data, id, c) <= 0.4)
        .sort((a, b) => distance(state, data, id, a) - distance(state, data, id, b))[0];
      if (pick && rand(state) < 0.6) {
        (p.backing[pick] ??= []).push(id);
        log(state, "election", "Sprijin pentru prezidențiale", `${id.toUpperCase()} își pune voturile în spatele ${pick.toUpperCase()}.`);
      }
    }
  }
}

/* ------------------------------------------------------------ the law pipeline */

// A law that passed the plenary waits at Cotroceni for the president.
export function queueLaw(state, data, entry, def) {
  state.pres.pending.push({
    id: state.pres.nextPending,
    bill: entry.bill,
    from: entry.from,
    title: def.title,
    day: state.day,
    deadline: state.day + 7,
    humanUntil: state.day + 7 + HUMAN_WAIT,
    ccrAsked: false,
    amended: { ...(entry.amended ?? {}) },
  });
  state.pres.nextPending += 1;
  log(state, "law", `La Cotroceni: ${def.title}`, "Președintele are șapte zile să se hotărască.");
}

function aiChoice(state, data, pending) {
  const bill = data.bills.bills.find((b) => b.id === pending.bill);
  if (!bill) return "promulgate";
  const sameSide = state.pres.president.party && state.pres.president.party === pending.from;
  const dist = Math.abs((bill.lean ?? 0) - presLean(state, data));
  const pReturn = sameSide ? 0.02 : 0.08 + 0.25 * Math.min(1, dist);
  const r = rand(state);
  // A law goes back to Parliament only once; the second time the president must decide.
  if (r < pReturn && !state.pres.returned?.[pending.bill]) return "return";
  if (r < pReturn + 0.04) return "ccr";
  return "promulgate";
}

// Settles one pending law: promulgate (effects apply), return (Parliament votes again), or CCR.
export function decideLaw(state, data, pending, choice, forced = false) {
  const bill = data.bills.bills.find((b) => b.id === pending.bill);
  state.pres.pending = state.pres.pending.filter((x) => x !== pending);
  state.decisions = state.decisions.filter((d) => d.presidential !== pending.id);
  if (choice === "ccr") {
    // A referral strikes the law half the time; a successful challenge always does.
    if (forced || rand(state) < 0.5) {
      addRel(state, data, pending.from, state.pres.president.party ?? pending.from, -3);
      log(state, "law", "Curtea Constituțională: neconstituțională", `„${pending.title}” nu mai intră în vigoare.`);
      return "struck";
    }
    choice = "promulgate";
  }
  if (choice === "return") {
    log(state, "law", `Retrimisă în Parlament: ${pending.title}`, "Președintele cere o nouă dezbatere. Parlamentul votează din nou.");
    state.pres.returned ??= {};
    state.pres.returned[pending.bill] = true;
    reopenLaw(state, data, pending.bill, pending.from, pending.title);
    return "returned";
  }
  if (bill) {
    const fx = lawEffects(data, bill.id, pending.amended);
    if (fx.party?.self) fx.party.self *= 0.5;
    applyEffects(state, data, fx, { partyId: pending.from, title: bill.title });
    log(state, "law", `Promulgată: ${bill.title}`, "Legea intră în vigoare.");
  }
  return "promulgated";
}

// The opposition may send a law to the Constitutional Court (needs 15 MPs, costs 5 capital).
export function challengeCCR(state, data, partyId, pendingId) {
  const party = state.parties[partyId];
  const pending = state.pres.pending.find((x) => x.id === Number(pendingId));
  if (!pending) return { ok: false, error: "Legea nu mai e la Cotroceni." };
  if ((party?.seats ?? 0) < 15) return { ok: false, error: "Sesizarea CCR cere cel puțin 15 parlamentari." };
  if (pending.ccrAsked) return { ok: false, error: "Legea a fost deja sesizată la CCR." };
  if (party.capital < 5) return { ok: false, error: "Sesizarea costă 5 capital politic." };
  party.capital = round(party.capital - 5, 1);
  pending.ccrAsked = true;
  if (rand(state) < 0.35) {
    decideLaw(state, data, pending, "ccr", true);
    return { ok: true, message: "Curtea a constatat neconstituționalitatea." };
  }
  log(state, "law", "Sesizare la CCR respinsă", `${partyId.toUpperCase()} a sesizat Curtea, fără succes. Legea rămâne la Cotroceni.`);
  return { ok: true, message: "Curtea nu a admis sesizarea." };
}

export function presidencyDaily(state, data) {
  const p = state.pres;
  aiCampaignMoves(state, data);
  if (state.day >= p.electionDay) runPresidentialElection(state, data);
  for (const pending of [...p.pending]) {
    if (state.day < pending.deadline) continue;
    if (humanPresident(state) && state.day < pending.humanUntil) {
      if (!state.decisions.some((d) => d.presidential === pending.id)) {
        state.decisions.push({ id: state.nextDecision, party: p.president.party, eventId: null, presidential: pending.id, day: state.day, expires: pending.humanUntil });
        state.nextDecision += 1;
      }
      continue;
    }
    decideLaw(state, data, pending, aiChoice(state, data, pending));
  }
}

export function decidePresidential(state, data, d, choiceIndex) {
  const pending = state.pres.pending.find((x) => x.id === d.presidential);
  if (!pending) return { ok: false, error: "Legea nu mai e la Cotroceni." };
  const choice = ["promulgate", "return", "ccr"][choiceIndex];
  if (!choice) return { ok: false, error: "Alegere invalidă." };
  const outcome = decideLaw(state, data, pending, choice);
  const msg = { promulgated: "Ai promulgat legea.", returned: "Legea a fost retrimisă în Parlament.", struck: "Curtea a respins legea.", ccr: "Ai sesizat Curtea." };
  return { ok: true, message: msg[outcome] ?? "Decizie luată." };
}

export function presPseudoEvent(state, d) {
  const pending = state.pres.pending.find((x) => x.id === d.presidential);
  return {
    title: "Legea așteaptă la Cotroceni",
    text: pending ? `„${pending.title}” a trecut prin Parlament. Ce faci cu ea?` : "Legea nu mai e la Cotroceni.",
    choices: [
      { label: "O promulgi", hint: "Intră în vigoare acum", cost: 0 },
      { label: "O retrimiți în Parlament", hint: "Parlamentul votează din nou", cost: 0 },
      { label: "Sesizezi Curtea Constituțională", hint: "Un risc: Curtea poate respinge legea", cost: 0 },
    ],
  };
}

export function presSnapshot(state, data) {
  const p = state.pres;
  const pres = state.politicians[p.president.id];
  const poll = computePoll(state, data).national;
  return {
    president: { id: p.president.id, name: pres?.name ?? null, party: p.president.party, role: pres?.role ?? null, since: p.president.since, termEnd: p.president.termEnd },
    electionDay: p.electionDay,
    toVote: Math.max(0, p.electionDay - state.day),
    nominated: Object.keys(p.nominated),
    backing: p.backing,
    candidates: state.partyIds
      .filter((id) => candidateOf(state, id))
      .map((id) => ({ party: id, name: state.politicians[candidateOf(state, id)].name, nominated: !!p.nominated[id], share: round(poll[id] ?? 0, 4) })),
    pending: p.pending.map((x) => ({ id: x.id, title: x.title, from: x.from, deadline: x.deadline, forHuman: humanPresident(state) })),
    lastResult: p.lastResult,
    presLean: presLean(state, data),
  };
}

export { TERM_DAYS, NOMINATION_WINDOW, BACKING_WINDOW };
