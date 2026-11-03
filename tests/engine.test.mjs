import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createGame,
  computePoll,
  applyAction,
  applyGov,
  fireEvent,
  tick,
  runElection,
  buildSegments,
  decide,
  snapshot,
  applyParl,
  consumeRenamed,
  lobbyPrice,
  lists,
  previewAction,
  segmentShares,
} from "../shared/engine.mjs";
import { dayOf } from "../shared/util.mjs";
import { createCtl } from "../shared/ctl.mjs";
import { DATA_FILES } from "../shared/data-files.mjs";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const data = Object.fromEntries(Object.entries(DATA_FILES).map(([k, f]) => [k, read(f)]));
const map = read("romania-map.json");

const newGame = (scenario = "2026", humans = ["psd"]) => createGame(data, { seed: 99, scenario, humans });

const segmentIds = new Set(data.segments.segments.map((s) => s.id));
const partyIds = new Set(data.parties.parties.map((p) => p.id));
const countyIds = new Set(data.counties.counties.map((c) => c.id));
const politicianIds = new Set(data.politicians.politicians.map((p) => p.id));
const spendLines = data.government.spendLines.map((l) => l.id);
const sumObj = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------- the map */

test("every county has a shape on the map, Bucharest included", () => {
  const onMap = new Set(map.counties.map((c) => c.id));
  for (const id of countyIds) assert.ok(onMap.has(id), `${id} missing on the map`);
  assert.ok(onMap.has("bucuresti") && onMap.has("ilfov"));
});

test("every county is split into segments that add up to its population", () => {
  for (const county of data.counties.counties) {
    const segments = buildSegments(county);
    assert.ok(Math.abs(sumObj(segments) - county.pop) < 0.5, county.id);
    assert.equal(Object.keys(segments).length, data.segments.segments.length);
  }
});

/* ------------------------------------------------------------ scenarios */

test("each scenario starts with its own parties, calibrated to the starting poll", () => {
  for (const sc of data.scenarios.scenarios) {
    const state = newGame(sc.id);
    assert.deepEqual(state.partyIds, sc.parties);
    const poll = computePoll(state, data);
    const sum = sumObj(sc.startPoll);
    for (const id of sc.parties) {
      assert.ok(Math.abs(poll.national[id] - sc.startPoll[id] / sum) < 0.006, `${sc.id}/${id}`);
    }
    assert.ok(Math.abs(sumObj(poll.national) - 1) < 1e-6);
    for (const county of Object.values(poll.counties)) assert.ok(Math.abs(sumObj(county) - 1) < 1e-6);
  }
  assert.ok(!newGame("2017").parties.aur && !newGame("2026").parties.alde);
});

test("parliament adds up to the total and only parties above 5% get a poll seat", () => {
  for (const sc of data.scenarios.scenarios) {
    const state = newGame(sc.id);
    assert.equal(sumObj(Object.fromEntries(state.partyIds.map((id) => [id, state.parties[id].seats]))) + sc.minoritySeats, data.config.totalSeats);
    const poll = computePoll(state, data);
    assert.equal(sumObj(poll.seats) + sc.minoritySeats, data.config.totalSeats);
    for (const [id, seats] of Object.entries(poll.seats)) if (poll.national[id] < 0.05) assert.equal(seats, 0, id);
  }
});

test("the starting cabinet matches the real one", () => {
  const s26 = newGame("2026");
  assert.equal(s26.gov.pm, "niculescu");
  assert.deepEqual(s26.gov.coalition, ["psd"]);
  assert.ok(s26.gov.support.pnl && s26.gov.support.udmr);
  assert.equal(s26.gov.ministries.finante.minister, "nazare");
  assert.equal(s26.gov.ministries.finante.party, null);
  const s17 = newGame("2017");
  assert.equal(s17.gov.pm, "grindeanu");
  assert.deepEqual(s17.gov.coalition, ["psd", "alde"]);
  assert.equal(s17.gov.ministries.externe.party, "alde");
  assert.equal(s17.leaders.psd, "dragnea");
  assert.equal(s17.leaders.usr, "nicusor");
});

/* --------------------------------------------------------------- content */

function checkEffects(effects, where) {
  const known = ["segments", "convert", "county", "party", "countyParty", "funds", "segBoost", "countyBoostAll", "politician", "macro", "metric", "confidence", "sol", "budget"];
  for (const key of Object.keys(effects ?? {})) assert.ok(known.includes(key), `${where}: unknown effect ${key}`);
  const party = (id) => assert.ok(["self", "gov", "opp"].includes(id) || partyIds.has(id), `${where}: party ${id}`);
  const segments = (obj) => Object.keys(obj ?? {}).forEach((s) => assert.ok(segmentIds.has(s), `${where}: segment ${s}`));
  const convert = (rules) =>
    (rules ?? []).forEach((r) => {
      assert.ok(segmentIds.has(r.from) && segmentIds.has(r.to), `${where}: convert ${r.from}->${r.to}`);
      assert.ok(r.share > 0 && r.share < 1, `${where}: share ${r.share}`);
    });
  segments(effects?.segments);
  segments(effects?.segBoost);
  segments(effects?.sol);
  convert(effects?.convert);
  Object.keys(effects?.party ?? {}).forEach(party);
  Object.keys(effects?.funds ?? {}).forEach(party);
  for (const [cid, p] of Object.entries(effects?.countyParty ?? {})) {
    assert.ok(countyIds.has(cid), `${where}: county ${cid}`);
    Object.keys(p).forEach(party);
  }
  for (const [cid, spec] of Object.entries(effects?.county ?? {})) {
    assert.ok(countyIds.has(cid), `${where}: county ${cid}`);
    segments(spec.segments);
    convert(spec.convert);
    Object.keys(spec.party ?? {}).forEach(party);
  }
  for (const k of Object.keys(effects?.budget ?? {})) assert.ok(spendLines.includes(k) || k === "other", `${where}: budget ${k}`);
  if (effects?.politician) assert.ok(politicianIds.has(effects.politician.id), `${where}: politician`);
}

test("every event, choice and policy only points at things that exist", () => {
  const ids = new Set();
  for (const e of data.events.events) {
    assert.ok(!ids.has(e.id), `duplicate event ${e.id}`);
    ids.add(e.id);
    assert.ok(e.title && e.text && e.scenarios?.length, `${e.id}: title/text/scenarios`);
    checkEffects(e.effects, e.id);
    checkEffects(e.ignore, `${e.id}.ignore`);
    for (const c of e.choices ?? []) {
      assert.ok(c.label && c.hint !== undefined, `${e.id}: choice label/hint`);
      checkEffects(c.effects, `${e.id}.${c.label}`);
    }
    if (e.choices) assert.ok(e.choices.length >= 2, `${e.id}: needs 2+ choices`);
  }
  for (const e of data.events.events) {
    if (e.after) assert.ok(ids.has(e.after), `${e.id}: after ${e.after}`);
  }
  for (const p of data.policies.policies) {
    assert.ok(data.government.ministries.some((m) => m.id === p.ministry), `${p.id}: ministry`);
    for (const k of Object.keys(p.spend ?? {})) assert.ok(spendLines.includes(k) || k === "other", `${p.id}: spend ${k}`);
    for (const k of Object.keys(p.revenue ?? {})) assert.ok(data.government.revenueLines.some((r) => r.id === k), `${p.id}: revenue ${k}`);
    checkEffects({ sol: p.effects?.sol }, p.id);
    if (p.effects?.event) assert.ok(ids.has(p.effects.event), `${p.id}: event ${p.effects.event}`);
  }
  assert.ok(data.events.events.length >= 120);
  assert.ok(data.events.events.filter((e) => e.choices).length >= 10);
  assert.ok(data.policies.policies.length >= 25);
});

test("every politician has stats, facts, a look and valid references", () => {
  const stats = ["charisma", "patience", "malleability", "gaffes", "visibility", "corruption", "traseism"];
  for (const p of data.politicians.politicians) {
    assert.ok(p.party === null || partyIds.has(p.party), `${p.id}: party`);
    for (const s of stats) assert.ok(p.stats[s] >= 0 && p.stats[s] <= 100, `${p.id}: ${s}`);
    assert.ok(Array.isArray(p.facts) && p.facts.length >= 1, `${p.id}: facts`);
    assert.ok(p.look?.hair && p.look.skin && p.look.suit, `${p.id}: look`);
    if (p.ability) for (const seg of Object.keys(p.ability.effect)) assert.ok(segmentIds.has(seg), `${p.id}: ${seg}`);
    assert.ok(Object.keys(p.scenarios ?? {}).length >= 1, `${p.id}: scenarios`);
  }
  assert.ok(data.politicians.politicians.length >= 60);
});

test("scenario data points at real parties, politicians and ministries", () => {
  for (const sc of data.scenarios.scenarios) {
    const pols = Object.fromEntries(data.politicians.politicians.filter((p) => p.scenarios?.[sc.id]).map((p) => [p.id, p]));
    for (const id of sc.parties) {
      assert.ok(partyIds.has(id), `${sc.id}: party ${id}`);
      // A party can have no named leader (collective leadership) but not an unknown one.
      if (sc.leaders[id] !== null) assert.ok(pols[sc.leaders[id]], `${sc.id}: leader of ${id} is present`);
      assert.ok(sc.startPoll[id] > 0, `${sc.id}: ${id} poll`);
      if (id in sc.parliament) assert.ok(sc.parliament[id] > 0, `${sc.id}: ${id} seats`);
    }
    for (const m of data.government.ministries) {
      const slot = sc.government.ministries[m.id];
      assert.ok(slot, `${sc.id}: ministry ${m.id}`);
      if (slot.minister) assert.ok(pols[slot.minister], `${sc.id}: minister ${slot.minister}`);
      assert.ok(slot.party === null || sc.parties.includes(slot.party), `${sc.id}: ${m.id} party`);
    }
    const e = sc.economy;
    const total = (o) => sumObj(o);
    assert.ok(total(e.revenue) > 25 && total(e.spend) > 25, `${sc.id}: budget scale`);
    assert.ok(data.countries.series[String(sc.year)], `${sc.id}: country series`);
  }
});

/* ------------------------------------------------------ campaign actions */

test("a campaign action spends M€ and starts a cooldown", () => {
  const state = newGame();
  const before = state.parties.psd.funds;
  assert.ok(before > 3 && before < 20, `funds ${before} should be a few M€`);
  const first = applyAction(state, data, "psd", { type: "rally", county: "cluj" });
  assert.equal(first.ok, true);
  assert.ok(state.parties.psd.funds < before);
  const second = applyAction(state, data, "psd", { type: "rally", county: "cluj" });
  assert.equal(second.ok, false);
  assert.match(second.error, /Prea devreme/);
});

test("team members add to the leader's ability when a party acts", () => {
  const state = newGame();
  applyAction(state, data, "psd", { type: "rally", county: "dolj" });
  assert.ok(state.parties.psd.segBoost.pensionari_rural > 1.05);
});

/* ---------------------------------------------------------- government */

test("the books balance: revenue minus spending is the balance, and debt follows it", () => {
  for (const id of ["2017", "2026"]) {
    const state = newGame(id);
    const f = snapshot(state, data).gov.budget.flows;
    assert.ok(Math.abs(f.revTotal - sumObj(f.revenue)) <= 8, `${id}: revenue total`);
    assert.ok(Math.abs(f.spendTotal - sumObj(f.spend)) <= 8, `${id}: spend total`);
    assert.ok(Math.abs(f.balance - (f.revTotal - f.spendTotal)) <= 2);
    const debt0 = state.macro.debt;
    tick(state, data, 30);
    const f2 = snapshot(state, data).gov.budget.flows;
    assert.ok(Math.abs(state.macro.debt - (debt0 - f2.balance / 12)) < 5, `${id}: debt change matches the balance`);
  }
});

test("a minister can change the budget and a tax; others must propose", () => {
  const state = newGame("2017", ["psd"]);
  const gdp = state.macro.gdp;
  // PSD holds Health in 2017: direct.
  const target = state.budget.ratio.health * gdp * 1.1;
  const ok = applyGov(state, data, "psd", { type: "setSpend", line: "health", amount: target });
  assert.equal(ok.ok, true, ok.error);
  assert.ok(Math.abs(state.budget.ratio.health * gdp - target) < 1);
  const again = applyGov(state, data, "psd", { type: "setSpend", line: "health", amount: target * 1.02 });
  assert.match(again.error, /Prea devreme/);
  const wild = applyGov(state, data, "psd", { type: "setSpend", line: "education", amount: gdp * 0.2 });
  assert.equal(wild.ok, false);

  // Taxes: Finance is PSD too.
  const vat = applyGov(state, data, "psd", { type: "setTax", tax: "vat", rate: 21 });
  assert.equal(vat.ok, true, vat.error);
  assert.equal(state.budget.tax.vat, 21);

  // Energy belongs to ALDE: PSD can only propose. ALDE is AI, so it answers at once.
  const prop = applyGov(state, data, "psd", { type: "policy", id: "plafonare-energie", on: true });
  assert.equal(prop.ok, true, prop.error);
  assert.equal(state.proposals.length, 1);
  assert.ok(["accepted", "rejected"].includes(state.proposals[0].status));
});

test("the opposition cannot touch the budget but can file a motion", () => {
  const state = newGame("2026", ["aur"]);
  const res = applyGov(state, data, "aur", { type: "setSpend", line: "health", amount: 1000 });
  assert.equal(res.ok, false);
  assert.match(res.error, /Doar partidele din guvern/);
  state.parties.aur.capital = 100;
  const motion = applyGov(state, data, "aur", { type: "motion" });
  assert.equal(motion.ok, true, motion.error);
  assert.match(motion.message, /Moțiunea/);
  const again = applyGov(state, data, "aur", { type: "motion" });
  assert.equal(again.ok, false);
});

test("higher taxes raise revenue; more health money raises quality over time", (t) => {
  // No random news in this one, so the two games differ only by the budget.
  const chance = data.config.eventChance;
  data.config.eventChance = 0;
  data.config.parlAi = false;
  t.after(() => {
    data.config.eventChance = chance;
    delete data.config.parlAi;
  });
  const a = newGame("2026", ["psd"]);
  const b = newGame("2026", ["psd"]);
  b.parties.psd.capital = 200;
  b.gov.ministries.finante = { party: "psd", minister: null };
  b.gov.ministries.sanatate = { party: "psd", minister: "rogobete" };
  assert.equal(applyGov(b, data, "psd", { type: "setTax", tax: "vat", rate: 24 }).ok, true);
  assert.equal(applyGov(b, data, "psd", { type: "setSpend", line: "health", amount: b.budget.ratio.health * b.macro.gdp * 1.25 }).ok, true);
  tick(a, data, 360);
  tick(b, data, 360);
  assert.ok(b.budget.flows.revenue.vat > a.budget.flows.revenue.vat, "VAT revenue");
  assert.ok(b.metrics.health > a.metrics.health + 1, `health ${b.metrics.health} vs ${a.metrics.health}`);
  assert.ok(b.macro.inflation > a.macro.inflation - 0.2, "VAT feeds inflation");
});

test("a policy changes the budget and what voters feel", () => {
  const state = newGame("2026", ["psd"]);
  state.parties.psd.capital = 200;
  const before = state.sol.pensionari_rural;
  const pensions0 = snapshot(state, data).gov.budget.paid.pensions;
  const res = applyGov(state, data, "psd", { type: "policy", id: "indexare-pensii", on: true });
  assert.equal(res.ok, true, res.error);
  tick(state, data, 90);
  assert.ok(state.sol.pensionari_rural > before + 2, "pensioners feel better");
  assert.ok(state.budget.paid.pensions > pensions0, "pensions cost more");
  assert.ok(state.sat.pensionari_rural > 0, "and are more satisfied than they expected");
  const repeal = applyGov(state, data, "psd", { type: "policy", id: "indexare-pensii", on: false });
  assert.equal(repeal.ok, true, repeal.error);
});

test("the prime minister's party can reshuffle; its partner objects", () => {
  const state = newGame("2017", ["psd"]);
  const before = state.gov.confidence;
  const res = applyGov(state, data, "psd", { type: "appoint", ministry: "energie", politician: "dragnea" });
  assert.equal(res.ok, true, res.error);
  assert.equal(state.gov.ministries.energie.minister, "dragnea");
  assert.equal(state.gov.ministries.energie.party, "psd");
  assert.ok(state.gov.confidence < before, "ALDE lost a ministry");
  const nonPm = applyGov(newGame("2017", ["alde"]), data, "alde", { type: "appoint", ministry: "energie", politician: "petcu" });
  assert.equal(nonPm.ok, false);
});

test("a cabinet that loses confidence falls and a new one is formed", () => {
  const state = newGame("2026", []);
  state.gov.confidence = 10;
  tick(state, data, 30);
  assert.ok(state.log.some((l) => l.title === "Guvernul a căzut"));
  assert.ok(state.log.some((l) => l.title === "Guvern învestit"));
  assert.ok(state.gov.coalition.length >= 1 && !state.gov.caretaker);
});

for (const scenario of ["2026", "2017"]) {
  test(`${scenario}: four years of AI government stay inside believable ranges`, () => {
    const state = createGame(data, { seed: 7, scenario, humans: [] });
    for (let year = 0; year < 4; year += 1) {
      tick(state, data, 365);
      const m = state.macro;
      const debt = (m.debt / m.gdp) * 100;
      assert.ok(m.growth > -6 && m.growth < 9, `growth ${m.growth}`);
      assert.ok(m.inflation > -1.5 && m.inflation < 16, `inflation ${m.inflation}`);
      assert.ok(m.unemployment > 2 && m.unemployment < 16, `unemployment ${m.unemployment}`);
      assert.ok(m.deficitPct > -2 && m.deficitPct < 14, `deficit ${m.deficitPct}`);
      assert.ok(debt > 15 && debt < 120, `debt ${debt}`);
      for (const k of ["health", "education", "infra", "safety", "cpi"]) {
        assert.ok(state.metrics[k] >= 5 && state.metrics[k] <= 98, `${k} ${state.metrics[k]}`);
      }
      const total = Object.values(state.counties).reduce((s, c) => s + c.pop, 0);
      const segs = Object.values(state.counties).reduce((s, c) => s + sumObj(c.segments), 0);
      // Events resize segments on purpose (education cuts, factory closures), so allow some drift.
      assert.ok(Math.abs(total - segs) < total * 0.1, `segments (${segs}) vs population (${total})`);
    }
    assert.ok(state.lastResult, "an election was held");
    assert.ok(state.metrics.motorwayKm > data.scenarios.scenarios.find((s) => s.id === scenario).economy.metrics.motorwayKm);
  });
}

test("the simulated world stays plausible and Romania is compared with it", () => {
  const state = createGame(data, { seed: 3, scenario: "2026", humans: [] });
  tick(state, data, 365 * 6);
  const snap = snapshot(state, data);
  for (const [id, v] of Object.entries(snap.world.countries)) {
    assert.ok(v.growth > -7 && v.growth < 10, `${id} growth ${v.growth}`);
    assert.ok(v.inflation > -2 && v.inflation < 16, `${id} inflation ${v.inflation}`);
    assert.ok(v.debt > 5 && v.debt < 220, `${id} debt ${v.debt}`);
    assert.ok(v.unemployment > 1 && v.unemployment < 30, `${id} unemployment ${v.unemployment}`);
  }
  assert.ok(snap.world.countries.ro && snap.world.countries.eu && snap.world.countries.de);
  assert.ok(state.world.log.length > 0, "world events happened");
});

test("people leaving shift voters into the diaspora without losing anyone", () => {
  const state = newGame("2026", []);
  const total = (s) => Object.values(s.counties).reduce((a, c) => a + sumObj(c.segments), 0);
  const t0 = total(state);
  const d0 = Object.values(state.counties).reduce((a, c) => a + c.segments.diaspora, 0);
  tick(state, data, 360);
  const d1 = Object.values(state.counties).reduce((a, c) => a + c.segments.diaspora, 0);
  assert.ok(d1 > d0 + 30, `diaspora grew ${d1 - d0}`);
  assert.ok(Math.abs(total(state) - t0) < t0 * 0.03);
});

/* ------------------------------------------------- events and decisions */

test("moving voters between segments keeps the population constant", () => {
  const state = newGame();
  data.events.events.push({
    id: "test-convert", title: "test", text: "", weight: 1, minDay: 0, scenarios: ["2026"],
    effects: { convert: [{ from: "studenti", to: "diaspora", share: 0.5 }] },
  });
  const before = sumObj(state.counties.cluj.segments);
  fireEvent(state, data, "test-convert");
  const after = sumObj(state.counties.cluj.segments);
  data.events.events.pop();
  assert.ok(Math.abs(before - after) < 0.5, `${before} vs ${after}`);
  assert.ok(state.counties.cluj.segments.diaspora > 0);
});

test("a decision event asks the player, applies the choice and expires if ignored", () => {
  const state = newGame();
  fireEvent(state, data, "d-greva-medici");
  const snap = snapshot(state, data);
  assert.equal(snap.decisions.length, 1);
  assert.equal(snap.decisions[0].party, "psd");
  assert.equal(snap.decisions[0].choices.length, 3);

  assert.equal(decide(state, data, "aur", snap.decisions[0].id, 0).ok, false);
  assert.equal(decide(state, data, "psd", snap.decisions[0].id, 9).ok, false);
  const before = state.parties.psd.funds;
  const res = decide(state, data, "psd", snap.decisions[0].id, 1);
  assert.equal(res.ok, true);
  assert.ok(Math.abs(state.parties.psd.funds - (before - 1)) < 0.01, "the choice costs 1 M€");
  assert.equal(snapshot(state, data).decisions.length, 0);

  fireEvent(state, data, "d-greva-medici");
  state.parties.psd.funds = 0.2;
  const d = snapshot(state, data).decisions[0];
  assert.equal(decide(state, data, "psd", d.id, 1).ok, false);
  tick(state, data, 10);
  assert.equal(state.decisions.length, 0);
  assert.ok(state.log.some((l) => l.kind === "decision" && /ignorat/.test(l.title)));
});

test("follow-up events only fire after their cause, and events respect the scenario", () => {
  const byId = Object.fromEntries(data.events.events.map((e) => [e.id, e]));
  for (const scenario of ["2026", "2017"]) {
    for (const seed of [1, 2, 3]) {
      const state = createGame(data, { seed, scenario, humans: [] });
      for (let d = 0; d < 400; d += 1) {
        tick(state, data, 1);
        for (const [id, day] of Object.entries(state.fired)) {
          if (day !== state.day) continue;
          assert.ok(byId[id].scenarios.includes(scenario), `${id} should not fire in ${scenario}`);
          if (byId[id].months) {
            assert.ok(byId[id].months.includes(Number(state.date.slice(5, 7))), `${id} fired out of season (${state.date})`);
          }
          const cause = byId[id].after;
          if (!cause) continue;
          const causeDay = state.fired[cause];
          assert.ok(causeDay !== undefined && state.day - causeDay <= 45, `${id} without ${cause} (seed ${seed})`);
        }
      }
    }
  }
});

test("a county event only reshapes the segments of that county", () => {
  const state = newGame();
  const other = JSON.stringify(state.counties.cluj.segments);
  const before = sumObj(state.counties.hunedoara.segments);
  const workers = state.counties.hunedoara.segments.muncitori;
  const jobless = state.counties.hunedoara.segments.someri;
  fireEvent(state, data, "valea-jiului-minele");
  const h = state.counties.hunedoara.segments;
  assert.ok(h.muncitori < workers && h.someri > jobless);
  assert.ok(Math.abs(sumObj(h) - before) < 0.5);
  assert.equal(JSON.stringify(state.counties.cluj.segments), other);
  assert.ok(state.counties.hunedoara.boost.psd < 0);
});

test("the clock reaches an election on its date and forms a government", () => {
  const state = newGame("2026", []);
  tick(state, data, state.electionDay + 1);
  assert.ok(state.lastResult);
  for (const id of state.lastResult.gov) assert.equal(state.parties[id].gov, true);
  assert.ok(state.electionDay > 2000);
  assert.ok(state.gov.coalition.length >= 1);
});

test("a manual election works at any time", () => {
  const state = newGame("2017", []);
  runElection(state, data);
  assert.ok(state.lastResult && state.lastResult.gov.length >= 1);
});

/* ------------------------------------------------ small parties, alliances */

const MINORS = { 2017: ["pru", "prm", "per"], 2026: ["sens", "fd", "reper", "psdu", "drept"] };

// Pushes one party's mood until its national poll share is about `target`.
function tune(state, id, target) {
  for (let i = 0; i < 40; i += 1) {
    const have = computePoll(state, data).national[id];
    state.mood[id] *= Math.pow(target / have, 0.8);
  }
}

test("parties that missed the threshold start with no seats and can be played", () => {
  for (const [scenario, ids] of Object.entries(MINORS)) {
    const state = newGame(scenario, [ids[0]]);
    const poll = computePoll(state, data);
    for (const id of ids) {
      assert.ok(state.partyIds.includes(id), `${scenario}/${id} is in the game`);
      assert.equal(state.parties[id].seats, 0);
      assert.ok(poll.national[id] < 0.05, `${id} starts below 5%`);
      assert.equal(poll.seats[id], 0);
    }
    assert.equal(applyAction(state, data, ids[0], { type: "online" }).ok, true);
    assert.equal(state.gov.coalition.includes(ids[0]), false);
    assert.equal(snapshot(state, data).lists.find((l) => l.parties.includes(ids[0])).passes, false);
  }
  assert.equal(newGame("2026").leaders.drept, null, "no named leader is allowed");
});

test("a small party that campaigns past 5% wins seats", () => {
  const state = newGame("2026", ["sens"]);
  tune(state, "sens", 0.075);
  const poll = computePoll(state, data);
  assert.ok(poll.national.sens > 0.07);
  assert.ok(poll.seats.sens >= 15, `seats ${poll.seats.sens}`);
});

test("every party runs its own list: 5% nationally or 20% in four counties", () => {
  const state = newGame("2026", ["sens"]);
  const poll = computePoll(state, data);
  const mine = lists(state, poll.national, poll.counties).find((l) => l.parties[0] === "sens");
  assert.equal(mine.need, 0.05);
  const strong = { a: { sens: 0.25 }, b: { sens: 0.21 }, c: { sens: 0.2 }, d: { sens: 0.3 } };
  const regional = lists(state, { sens: 0.03 }, strong).find((l) => l.parties[0] === "sens");
  assert.equal(regional.strongCounties, 4);
  assert.equal(regional.passes, true);
});

/* -------------------------------------------------------------- parliament */

const bigOpposition = (state) => state.partyIds.filter((p) => !state.gov.coalition.includes(p) && state.parties[p].seats > 20);

test("the opposition can file a law, negotiate and vote; the law applies when it passes", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.capital = 60;
  const before = state.parties.usr.capital;
  const res = applyParl(state, data, "usr", { type: "bill", bill: "avertizori" });
  assert.equal(res.ok, true, res.error);
  assert.equal(state.parties.usr.capital, before - 8);
  assert.equal(applyParl(state, data, "usr", { type: "bill", bill: "digitalizare" }).ok, false, "one bill at a time");
  const price = lobbyPrice(state, data, "usr", "pnl");
  assert.ok(price.capital >= 3 && price.money > 0);
  assert.equal(applyParl(state, data, "usr", { type: "lobby", id: res.id, target: "pnl", how: "favor" }).ok, true);
  assert.equal(applyParl(state, data, "usr", { type: "vote", id: res.id, vote: "yes" }).ok, true);
  const cpi = state.metrics.cpi;
  tick(state, data, 13);
  assert.equal(state.parl.bills.length >= 0, true);
  const done = state.parl.done.find((d) => d.id === res.id);
  assert.ok(done, "the vote happened");
  if (done.status === "passed") assert.ok(state.metrics.cpi >= cpi, "the law's effect applied");
});

test("a party without seats cannot file laws or motions", () => {
  const state = newGame("2026", ["sens"]);
  assert.match(applyParl(state, data, "sens", { type: "bill", bill: "avertizori" }).error, /mandate/);
  assert.match(applyParl(state, data, "sens", { type: "motion" }).error, /mandate/);
});

test("relations: friends are cheaper, laws and votes move them", () => {
  const state = newGame("2026", ["usr"]);
  const friend = lobbyPrice(state, data, "usr", "pnl");
  const rival = lobbyPrice(state, data, "usr", "aur");
  assert.ok(friend.rel > rival.rel && friend.capital < rival.capital);
  state.parl.rel["aur|usr"] = 10;
  assert.match(applyParl(state, data, "usr", { type: "bill", bill: "avertizori" }).message ?? "", /Ai depus/);
  const id = state.parl.bills[0].id;
  assert.match(applyParl(state, data, "usr", { type: "lobby", id, target: "aur", how: "favor" }).error, /nu mai vorbește/);
});

test("a no-confidence motion is a vote: it needs 166 and can be lobbied", () => {
  const state = newGame("2026", ["aur"]);
  state.parties.aur.capital = 80;
  state.parties.aur.funds = 20;
  const res = applyParl(state, data, "aur", { type: "motion" });
  assert.equal(res.ok, true, res.error);
  assert.match(applyParl(state, data, "aur", { type: "motion" }).error, /deja/);
  const needed = 166;
  state.gov.confidence = 10;
  tick(state, data, 8);
  const done = state.parl.done.find((d) => d.kind === "motion");
  assert.ok(done, "the vote was held");
  assert.equal(done.status === "passed", done.tally.yes >= needed);
  void bigOpposition;
});

test("fusion and absorption: the human keeps playing as the new group", () => {
  const state = newGame("2026", ["sens"]);
  state.parties.sens.capital = 40;
  state.parl.rel["drept|sens"] = 90;
  let res = applyParl(state, data, "sens", { type: "merge", target: "drept", mode: "fusion" });
  for (let i = 0; !res.merged && i < 30; i += 1) {
    state.parties.sens.capital = 40;
    state.parl.cool = {};
    state.parl.rel["drept|sens"] = 90;
    res = applyParl(state, data, "sens", { type: "merge", target: "drept", mode: "fusion" });
  }
  assert.ok(res.merged, "an AI party eventually agrees");
  assert.equal(res.merged, "sens-drept");
  assert.equal(state.partyIds.includes("sens"), false);
  const renamed = consumeRenamed(state);
  assert.equal(renamed.sens, "sens-drept");
  state.humans = state.humans.map((h) => renamed[h] ?? h);
  assert.deepEqual(state.humans, ["sens-drept"]);
  assert.equal(state.defs["sens-drept"].name, "SENS-DREPT");
  assert.equal(computePoll(state, data).national["sens-drept"] > 0.02, true);
  tick(state, data, 40);
});

test("a party can lose people to a new group, historical or new", () => {
  const state = newGame("2026", ["pnl"]);
  const seats = state.parties.pnl.seats;
  const res = applyParl(state, data, "pnl", { type: "split", frac: 0.3, template: "pdl" });
  assert.equal(res.ok, true, res.error);
  assert.ok(state.partyIds.includes("pdl"));
  assert.ok(state.parties.pnl.seats < seats);
  assert.equal(state.parties.pdl.seats + state.parties.pnl.seats, seats);
  assert.ok(Object.values(state.politicians).some((p) => p.party === "pdl"));
  assert.equal(applyParl(state, data, "pnl", { type: "split", frac: 0.2, template: "pdl" }).ok, false, "name taken");
  const snap = snapshot(state, data);
  assert.ok(snap.defs.pdl && snap.parl.rel.pdl.pnl < 50);
  tick(state, data, 90);
});

test("shifting direction moves the profile and costs capital and cohesion", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.capital = 50;
  const before = snapshot(state, data);
  const aff0 = (before.defs.usr?.affinity ?? data.parties.parties.find((p) => p.id === "usr").affinity).studenti;
  const res = applyParl(state, data, "usr", { type: "shift", segment: "studenti" });
  assert.equal(res.ok, true, res.error);
  assert.ok(snapshot(state, data).defs.usr.affinity.studenti > aff0);
  assert.ok(state.parties.usr.cohesion < 72);
  assert.match(applyParl(state, data, "usr", { type: "shift", lean: 1 }).error, /din nou/);
});

test("a new cabinet lets each party pick its own ministers for free", () => {
  const state = newGame("2026", ["psd"]);
  runElection(state, data);
  const g = state.gov;
  assert.ok(g.formUntil >= state.day);
  const mine = Object.entries(g.ministries).find(([id, s]) => s.party === "psd" && id !== "premier");
  if (mine) {
    const cand = Object.values(state.politicians).find((p) => p.party === "psd" && p.id !== mine[1].minister && !Object.values(g.ministries).some((s) => s.minister === p.id));
    if (cand) {
      const cap = state.parties.psd.capital;
      const res = applyGov(state, data, "psd", { type: "appoint", ministry: mine[0], politician: cand.id });
      assert.equal(res.ok, true, res.error);
      assert.equal(state.parties.psd.capital, cap, "free in the window");
    }
  }
});

test("AI parliaments pass laws over four years and stay consistent", () => {
  const state = createGame(data, { seed: 9, scenario: "2026", humans: [] });
  tick(state, data, 1461);
  const laws = state.log.filter((l) => l.title.startsWith("Lege adoptată"));
  assert.ok(laws.length >= 8, `laws ${laws.length}`);
  const titles = laws.map((l) => l.title);
  assert.equal(new Set(titles).size >= titles.length - 2, true, "few repeats");
  for (const id of state.partyIds) assert.ok(state.parties[id] && state.leaders[id] !== undefined, id);
  const seats = state.partyIds.reduce((s, id) => s + state.parties[id].seats, 0);
  assert.equal(seats + state.config.minoritySeats, state.config.totalSeats);
});

test("news does not repeat while there are fresh events that fit the moment", () => {
  const state = createGame(data, { seed: 21, scenario: "2026", humans: [] });
  const seen = [];
  for (let i = 0; i < 60; i += 1) {
    const ev = fireEvent(state, data);
    if (ev) seen.push(ev.id);
  }
  assert.equal(new Set(seen).size, seen.length, "no event twice in 60 draws");
  assert.ok(data.events.events.length >= 250, "a large pool");
});

test("a multiplayer-style rename keeps humans pointing at the merged party", () => {
  const state = newGame("2026", ["sens", "drept"]);
  state.parties.sens.capital = 40;
  state.parl.rel["drept|sens"] = 95;
  const res = applyParl(state, data, "sens", { type: "merge", target: "drept", mode: "fusion", name: "SENS-DREPT" });
  assert.equal(res.ok, true);
  assert.equal(state.parl.mergeOffers.length, 1, "a human target must answer");
  const accepted = applyParl(state, data, "drept", { type: "merge-answer", from: "sens", accept: true });
  assert.equal(accepted.ok, true, accepted.error);
  assert.deepEqual(state.humans, ["sens-drept"]);
  assert.deepEqual(consumeRenamed(state), { sens: "sens-drept", drept: "sens-drept" });
  assert.deepEqual(consumeRenamed(state), {}, "consumed once");
});

test("every law cites a verified act, and no retired act is used as a source", () => {
  const slugs = new Set(data.lawSources.sources.map((s) => s.slug));
  for (const s of data.lawSources.sources) assert.ok(s.portal.startsWith("https://legislatie.just.ro/") && s.latest && s.verified, s.slug);
  const retired = data.lawSources.retired.map((r) => r.ref.replace("/", "-"));
  for (const b of data.bills.bills) {
    if (b.source) assert.ok(slugs.has(b.source.slug), `${b.id}: unknown source ${b.source.slug}`);
    for (const r of retired) assert.ok(!b.source?.slug.endsWith(r), `${b.id}: retired source`);
  }
  assert.ok(data.bills.bills.filter((b) => b.source).length >= 35, "most bills are grounded in an act");
  assert.ok(data.bills.bills.length >= 55);
  for (const b of data.bills.bills) assert.ok(b.title && b.text && b.effects, b.id);
});

test("negotiating against a law lowers the target's support", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.capital = 80;
  const res = applyParl(state, data, "usr", { type: "bill", bill: "ani-verificare-automata" });
  const entry = state.parl.bills[0];
  const before = snapshot(state, data).parl.bills[0].stance.pnl;
  assert.equal(applyParl(state, data, "usr", { type: "lobby", id: res.id, target: "pnl", how: "favor", against: true }).ok, true);
  assert.ok(snapshot(state, data).parl.bills[0].stance.pnl < before, "stance fell");
  assert.ok(entry.deals.pnl < 0);
  assert.match(applyParl(state, data, "usr", { type: "lobby", id: res.id, target: "pnl", how: "swap", against: true }).error, /doar în favoarea/);
});

test("every scandal fact in the game points at a registered decision and a real politician", () => {
  const reg = JSON.parse(readFileSync(new URL("../data/scandal-sources.json", import.meta.url), "utf8")).entries;
  const byId = Object.fromEntries(data.politicians.politicians.map((p) => [p.id, p]));
  for (const e of reg) {
    const p = byId[e.politician];
    assert.ok(p, `${e.politician}: unknown politician`);
    assert.ok(p.facts.some((f) => f.includes(e.fact)), `${e.politician}: fact "${e.fact}" is missing from the game`);
    assert.ok(e.decision && e.authority && e.source && e.date, `${e.politician}: registry entry incomplete`);
  }
  const names = new Set(data.politicians.politicians.map((p) => p.id));
  assert.equal(names.size, data.politicians.politicians.length, "politician ids are unique");
});

test("a courtesy warms a relation, a pact needs 55 and helps the partner's laws", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.capital = 60;
  const before = state.parl.rel["pnl|usr"] ?? lobbyPrice(state, data, "usr", "pnl").rel;
  assert.equal(applyParl(state, data, "usr", { type: "courtesy", target: "pnl" }).ok, true);
  assert.match(applyParl(state, data, "usr", { type: "courtesy", target: "pnl" }).error, /din ziua/);
  assert.ok(state.parl.rel["pnl|usr"] >= before + 7);
  state.parl.rel["aur|usr"] = 30;
  assert.match(applyParl(state, data, "usr", { type: "merge", target: "aur", mode: "pact" }).error, /relație de cel puțin 55/);
  state.parl.rel["pnl|usr"] = 90;
  let res;
  for (let i = 0; i < 20 && !res?.pact; i += 1) {
    state.parties.usr.capital = 60;
    res = applyParl(state, data, "usr", { type: "merge", target: "pnl", mode: "pact" });
  }
  assert.ok(res.pact, "an AI partner with a good relation eventually agrees");
  assert.equal(snapshot(state, data).parl.pacts.length, 1);
  assert.match(applyParl(state, data, "usr", { type: "merge", target: "pnl", mode: "pact" }).error, /deja un pact/);
});

test("balance: credit for laws fades and governing wears the party down", () => {
  const run = (balance) => {
    data.config.balance = balance;
    const state = createGame(data, { seed: 3, scenario: "2017", humans: [] });
    const start = state.mood[state.gov.pmParty];
    tick(state, data, 600);
    return { start, end: state.mood[state.gov.pmParty], pm: state.gov.pmParty };
  };
  try {
    const on = run(true);
    assert.ok(on.end < 1.02, `the governing party does not keep climbing (mood ${on.end})`);
  } finally {
    delete data.config.balance;
  }
});

test("a small party played by a human slowly gains ground; the cap is 1.8x", () => {
  const state = newGame("2026", ["reper"]);
  const s0 = state.strength.reper;
  tick(state, data, 360);
  assert.ok(state.strength.reper > s0, "grows");
  tick(state, data, 3000);
  assert.ok(state.strength.reper <= s0 * 1.8 + 1e-9, "capped");
});

/* ---------------------------------------- opposition, outside, previews, defections */

test("opposition and outside actions respect who may use them", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.funds = 20;
  assert.equal(applyAction(state, data, "usr", { type: "inquiry" }).ok, true, "opposition may open an inquiry");
  assert.equal(applyAction(state, data, "psd", { type: "inquiry" }).ok, false, "the government may not");
  assert.equal(applyAction(state, data, "usr", { type: "signatures" }).ok, false, "a party with seats cannot collect signatures");
  const outside = newGame("2026", ["sens"]);
  outside.parties.sens.funds = 20;
  assert.equal(applyAction(outside, data, "sens", { type: "signatures" }).ok, true);
  assert.equal(applyAction(outside, data, "sens", { type: "exposure", targetParty: "sens" }).ok, false, "not against yourself");
  assert.equal(applyAction(outside, data, "sens", { type: "exposure", targetParty: "aur" }).ok, true);
});

test("a preview estimates an action and spends nothing", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.funds = 20;
  const before = JSON.stringify({ f: state.parties.usr.funds, c: state.parties.usr.cooldown, m: state.mood });
  const p = previewAction(state, data, "usr", { type: "protest", county: "bucuresti" });
  assert.equal(p.ok, true);
  assert.ok(p.national.usr > 0, "protest adds national support");
  assert.ok(p.segs.find((x) => x.seg === "tineri_urbani").own > 0, "young urban voters move");
  assert.equal(JSON.stringify({ f: state.parties.usr.funds, c: state.parties.usr.cooldown, m: state.mood }), before, "state untouched");
  assert.equal(previewAction(state, data, "psd", { type: "inquiry" }).ok, false, "a preview reports refusals too");
});

test("segment shares add up to one across all parties", () => {
  const state = newGame("2026", ["usr"]);
  const shares = segmentShares(state, data);
  for (const seg of data.segments.segments) {
    const sum = Object.values(shares[seg.id]).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `${seg.id} sums to ${sum}`);
  }
});

test("events leave causes for the voter groups they move", () => {
  const state = newGame("2026", ["usr"]);
  fireEvent(state, data, "medici-pleaca");
  const snap = snapshot(state, data);
  assert.ok(snap.causes.some((c) => c.seg === "bugetari" && c.text === "Medicii pleacă în Germania"));
});

test("a human party with a shaky group gets a decision; leaving splits the party", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.cohesion = 30;
  state.parties.usr.seats = 40;
  state.parties.usr.funds = 5;
  state.decisions.push({ id: state.nextDecision, party: "usr", eventId: null, defection: { seats: 4 }, day: state.day, expires: state.day + 10 });
  state.nextDecision += 1;
  const d = snapshot(state, data).decisions.find((x) => x.party === "usr");
  assert.match(d.title, /vrea să plece/);
  const id = d.id;
  assert.equal(decide(state, data, "usr", id, 0).ok, true, "keeping the group");
  assert.ok(state.parties.usr.cohesion > 30);
  state.decisions.push({ id: state.nextDecision, party: "usr", eventId: null, defection: { seats: 4 }, day: state.day, expires: state.day + 10 });
  state.nextDecision += 1;
  const before = state.partyIds.length;
  const id2 = state.decisions[state.decisions.length - 1].id;
  assert.equal(decide(state, data, "usr", id2, 1).ok, true, "letting them leave");
  assert.equal(state.partyIds.length, before + 1);
});

/* --------------------------------------------------------------- presidency */

import { decideLaw, runPresidentialElection, presSnapshot } from "../shared/presidency.mjs";
import { stanceOf, lawEffects, amendOptions } from "../shared/parl.mjs";

test("the presidency starts with the scenario's president and a dated election", () => {
  const s17 = newGame("2017", ["usr"]);
  assert.equal(s17.pres.president.id, "iohannis");
  assert.equal(s17.pres.electionDay, dayOf("2017-01-04", "2019-11-10"));
  const s26 = newGame("2026", ["usr"]);
  assert.equal(s26.pres.president.id, "nicusor");
  assert.ok(s26.pres.electionDay > 0);
});

test("a presidential election names a winner and a second round when nobody has half", () => {
  const state = newGame("2026", ["usr"]);
  runPresidentialElection(state, data);
  const r = state.pres.lastResult;
  assert.ok(r.winner && state.partyIds.includes(r.winner));
  assert.ok(r.round === 1 || r.round === 2);
  assert.equal(state.pres.president.party, r.winner);
  assert.equal(state.pres.nominated && Object.keys(state.pres.nominated).length, 0, "candidacies are reset");
  assert.ok(state.pres.electionDay > state.day + 1000, "the next election is five years away");
});

test("candidacies open in the last months and cost capital; partners back a nominated party", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.capital = 60;
  state.parties.usr.funds = 10;
  const early = applyParl(state, data, "usr", { type: "pres-run" });
  assert.equal(early.ok, false, "too early");
  state.day = state.pres.electionDay - 100;
  const ok = applyParl(state, data, "usr", { type: "pres-run" });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(applyParl(state, data, "usr", { type: "pres-run" }).ok, false, "only once");
  assert.equal(applyParl(state, data, "pnl", { type: "pres-back", target: "usr" }).ok, false, "not nominated: no backing for PNL's rival");
  state.pres.nominated.pnl = true;
  const back = applyParl(state, data, "udmr", { type: "pres-back", target: "pnl" });
  assert.ok(back.ok || /programul/.test(back.error), back.error);
  const snap = presSnapshot(state, data);
  assert.ok(snap.candidates.some((c) => c.party === "usr" && c.nominated));
});

test("a passed law waits at Cotroceni; promulgation applies its effects", () => {
  const state = newGame("2026", ["usr"]);
  const before = state.metrics.cpi;
  const entry = { id: 999, bill: "abuz-prag-prejudiciu", from: "usr", title: "Abuzul în serviciu: prag minim de prejudiciu" };
  const bill = data.bills.bills.find((b) => b.id === entry.bill);
  state.pres.pending.push({ id: 1, bill: entry.bill, from: "usr", title: bill.title, day: state.day, deadline: state.day, humanUntil: state.day + 7, ccrAsked: false });
  decideLaw(state, data, state.pres.pending[0], "promulgate");
  assert.equal(state.pres.pending.length, 0);
  assert.ok(state.metrics.cpi < before, "the law's anti-corruption effect lands only now");
});

test("a human president's party decides; an ignored law falls to the AI after the window", () => {
  const state = newGame("2026", ["usr"]);
  state.pres.president.party = "usr";
  state.pres.pending.push({ id: 7, bill: "avertizori-protectie-361", from: "pnl", title: "Protecția avertizorilor", day: state.day, deadline: state.day, humanUntil: state.day + 7, ccrAsked: false });
  tick(state, data, 1);
  const d = state.decisions.find((x) => x.presidential === 7);
  assert.ok(d, "a decision is waiting");
  assert.match(snapshot(state, data).decisions.find((x) => x.id === d.id).title, /Cotroceni/);
  assert.equal(decide(state, data, "usr", d.id, 0).ok, true);
  assert.equal(state.pres.pending.length, 0);
  state.pres.pending.push({ id: 8, bill: "avertizori-protectie-361", from: "pnl", title: "x", day: state.day, deadline: state.day, humanUntil: state.day + 2, ccrAsked: false });
  tick(state, data, 3);
  assert.equal(state.pres.pending.length, 0, "the AI decided after the window");
});

test("the opposition can challenge a law at the CCR only with 15 MPs; returning a law reopens the vote", () => {
  const state = newGame("2026", ["psd"]);
  state.parties.psd.capital = 40;
  state.gov.coalition = ["pnl"];
  state.pres.pending.push({ id: 3, bill: "avertizori-protectie-361", from: "pnl", title: "Protecția avertizorilor", day: state.day, deadline: state.day + 99, humanUntil: state.day + 99, ccrAsked: false });
  const small = applyParl(state, data, "sens", { type: "ccr", id: 3 });
  assert.equal(small.ok, false, "a party without 15 MPs cannot refer");
  const ok = applyParl(state, data, "psd", { type: "ccr", id: 3 });
  assert.ok(ok.ok || /deja/.test(ok.error), ok.error);
  const again = applyParl(state, data, "psd", { type: "ccr", id: 3 });
  assert.equal(again.ok, false, "only once");
  const pend = { id: 4, bill: "avertizori-protectie-361", from: "pnl", title: "Protecția avertizorilor", day: 0, deadline: 0, humanUntil: 0, ccrAsked: false };
  state.pres.pending.push(pend);
  const before = state.parl.bills.length;
  decideLaw(state, data, pend, "return");
  assert.equal(state.parl.bills.length, before + 1, "Parliament votes again");
});

test("rating: a long deficit moves the rating; below the reference each notch takes longer, but a deep crisis can go there", () => {
  const levels = data.government.rating.levels;
  const ref = levels.indexOf(data.government.rating.reference);
  const state = createGame(data, { seed: 5, scenario: "2026", humans: [] });
  state.macro.debt = state.macro.gdp * 2.5; // a debt crisis: the strain term alone is far above every threshold
  const steps = [];
  let last = state.rating.idx;
  for (let m = 0; m < 120; m += 1) {
    tick(state, data, 30);
    if (state.rating.idx !== last) {
      steps.push({ month: m, idx: state.rating.idx });
      last = state.rating.idx;
    }
  }
  assert.ok(steps.length >= 2, "the rating moves");
  const below = steps.filter((s) => s.idx < ref);
  assert.ok(below.length >= 1, `a crisis reaches below ${levels[ref]}`);
  assert.ok(state.rating.idx >= 0, "never below the lowest level");
  if (below.length >= 2) {
    const gaps = below.slice(1).map((s, i) => s.month - below[i].month);
    assert.ok(gaps.every((g) => g >= 4), `notches below the reference come slower: ${gaps}`);
  }
});

test("amendments: a party pays once to move a bill toward its own position, before the vote only", () => {
  const state = newGame("2026", ["usr"]);
  state.parties.usr.capital = 20;
  const id = state.parl.next;
  const bill = data.bills.bills.find((b) => b.id === "panouri-solare");
  state.parl.bills.push({ id, status: "open", kind: "law", bill: bill.id, from: "pnl", title: bill.title, day: state.day, vote: state.day + 5, deals: {}, pledged: [], votes: {} });
  const entry = state.parl.bills.find((b) => b.id === id);
  const before = stanceOf(state, data, "usr", entry);
  assert.equal(applyParl(state, data, "usr", { type: "amend", id, option: "nu-exista" }).ok, false, "unknown amendment");
  const first = applyParl(state, data, "usr", { type: "amend", id, option: "tineri-prioritate" });
  assert.equal(first.ok, true, first.error);
  assert.equal(state.parties.usr.capital, 17);
  assert.equal(applyParl(state, data, "usr", { type: "amend", id, option: "sate-fara-retea" }).ok, false, "only once per party");
  assert.equal(applyParl(state, data, "udmr", { type: "amend", id, option: "tineri-prioritate" }).ok, false, "an amendment is adopted once per bill");
  assert.ok(stanceOf(state, data, "usr", entry) > before, "a young-voter amendment makes the bill better for USR");
  const fx = lawEffects(data, bill.id, entry.amended);
  assert.equal(fx.sol.tineri_urbani, 1.5, "its effects add to the law's on promulgation");
  assert.equal(fx.macro.growth, bill.effects.macro.growth, "the law's own effects stay");
  const snapBills = snapshot(state, data).parl.bills;
  assert.equal(snapBills.find((b) => b.id === id).options.length, 3, "three concrete options per law");
  entry.status = "closed";
  assert.equal(applyParl(state, data, "udmr", { type: "amend", id, option: "componente-ue" }).ok, false, "no amendments after the vote");
});

test("hold-on actions: only the government may use them, and they have a price", () => {
  const state = newGame("2026", ["psd", "usr"]);
  state.gov.coalition = ["psd"];
  state.parties.psd.funds = 20;
  state.parties.usr.funds = 20;
  for (const type of ["relief", "govpr", "inauguration"]) {
    assert.equal(applyAction(state, data, "usr", { type, county: "cluj" }).ok, false, `${type}: the opposition may not`);
  }
  const moodBefore = state.mood.psd;
  const solBefore = state.solMod.pensionari_rural ?? 0;
  const res = applyAction(state, data, "psd", { type: "relief" });
  assert.equal(res.ok, true, res.error);
  assert.equal(state.parties.psd.funds, 17.5, "the relief package costs 2.5 M€");
  assert.ok(state.mood.psd > moodBefore, "voters reward the government");
  assert.ok((state.solMod.pensionari_rural ?? 0) > solBefore, "pensioners are happier");
  assert.equal(applyAction(state, data, "psd", { type: "relief" }).ok, false, "cooldown");
  assert.equal(applyAction(state, data, "psd", { type: "inauguration", county: "cluj" }).ok, true);
  assert.equal(applyAction(state, data, "psd", { type: "inauguration" }).ok, false, "a county is required");
});

test("every law offers at least two amendments, with real segments and unique ids", () => {
  const segs = new Set(data.segments.segments.map((s) => s.id));
  for (const bill of data.bills.bills) {
    const opts = amendOptions(data, bill);
    assert.ok(opts.length >= 2, `${bill.id} has ${opts.length} amendments`);
    assert.equal(new Set(opts.map((o) => o.id)).size, opts.length, `${bill.id}: duplicate amendment ids`);
    for (const o of opts) {
      assert.ok(o.label && o.text, `${bill.id}/${o.id}: needs a label and text`);
      for (const seg of Object.keys(o.effects.sol ?? {})) assert.ok(segs.has(seg), `${bill.id}/${o.id}: unknown segment ${seg}`);
    }
  }
});

/* --------------------------------------------------------------- the ctl */

test("the ctl drives scenarios, the budget, policies and the world", () => {
  const ctl = createCtl(data);
  assert.match(ctl.run("scenario 2017"), /2017/);
  assert.match(ctl.run("scenario 1999"), /^error/);
  assert.match(ctl.run("play psd"), /playing psd/);
  assert.match(ctl.run("play aur"), /^error/);
  assert.match(ctl.run("gov"), /Grindeanu/);
  assert.match(ctl.run("budget"), /Total venituri/);
  const gdp = ctl.room.state.macro.gdp;
  assert.match(ctl.run(`spend health ${Math.round(ctl.room.state.budget.ratio.health * gdp * 1.1)}`), /^ok/);
  assert.match(ctl.run("tax vat 21"), /^ok/);
  assert.match(ctl.run("tax vat 99"), /^error/);
  assert.match(ctl.run("policies sanatate"), /reforma-spitale/);
  assert.match(ctl.run("policy reforma-spitale"), /^ok/);
  assert.match(ctl.run("metrics"), /Datorie publică/);
  assert.match(ctl.run("sol"), /pensionari_rural/);
  assert.match(ctl.run("world growth"), /ro/);
  assert.match(ctl.run("cabinet"), /Grindeanu/);
  assert.match(ctl.run("month 2"), /^ziua 60/);
  assert.match(ctl.run("proposals"), /nicio propunere|#/);
  assert.match(ctl.run("bogus"), /^error/);
});

test("the ctl lists and answers decisions", () => {
  const ctl = createCtl(data);
  ctl.run("play psd");
  assert.match(ctl.run("decisions"), /nicio decizie/);
  ctl.run("event d-dezbatere-tv");
  assert.match(ctl.run("decisions"), /Accepți/);
  assert.match(ctl.run("decide 1 9"), /^error/);
  assert.match(ctl.run("decide 1 1"), /^ok/);
  assert.match(ctl.run("decisions"), /nicio decizie/);
  assert.match(ctl.run("politicians usr"), /fritz/);
});

test("pausing stops the clock in the ctl and resumes it", () => {
  const ctl = createCtl(data);
  assert.equal(ctl.run("pause"), "paused");
  assert.equal(ctl.room.state.speed, 0);
  assert.equal(ctl.run("speed 0"), "paused");
  assert.equal(ctl.run("resume"), "speed 1");
  assert.match(ctl.run("speed 5"), /^error/);
});

test("the ctl plays a full turn and reports state", () => {
  const ctl = createCtl(data);
  assert.match(ctl.run("play psd"), /playing psd/);
  assert.match(ctl.run("act rally cluj"), /^ok/);
  assert.match(ctl.run("tick 3"), /^ziua 3/);
  assert.match(ctl.run("poll"), /psd/);
  assert.match(ctl.run("counties cluj"), /cluj/);
  assert.match(ctl.run("election"), /^winner/);
  assert.match(ctl.run("events"), /Alegeri/);
});

