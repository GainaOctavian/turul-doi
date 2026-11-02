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
} from "../shared/engine.mjs";
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
    assert.ok(p.facts.real.length >= 1 && p.facts.fake.length >= 1, `${p.id}: facts`);
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
      assert.ok(pols[sc.leaders[id]], `${sc.id}: leader of ${id} is present`);
      assert.ok(sc.startPoll[id] > 0 && sc.parliament[id] > 0, `${sc.id}: ${id} numbers`);
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
  t.after(() => {
    data.config.eventChance = chance;
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
      assert.ok(Math.abs(total - segs) < total * 0.04, "segments still add up to the population");
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
