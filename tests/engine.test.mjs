import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createGame,
  computePoll,
  applyAction,
  fireEvent,
  tick,
  runElection,
  buildSegments,
  decide,
  snapshot,
} from "../shared/engine.mjs";
import { createCtl } from "../shared/ctl.mjs";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const data = {
  config: read("config.json"),
  segments: read("segments.json"),
  parties: read("parties.json"),
  politicians: read("politicians.json"),
  counties: read("counties.json"),
  events: read("events.json"),
  laws: read("laws.json"),
};

const newGame = () => createGame(data, { seed: 99, humans: ["psd"] });

test("every county is split into segments that add up to its population", () => {
  for (const county of data.counties.counties) {
    const segments = buildSegments(county);
    const sum = Object.values(segments).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - county.pop) < 0.5, `${county.id}: ${sum} vs ${county.pop}`);
    assert.equal(Object.keys(segments).length, data.segments.segments.length);
  }
});

test("the national poll adds up to 100%", () => {
  const state = newGame();
  const poll = computePoll(state, data);
  const sum = Object.values(poll.national).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  for (const county of Object.values(poll.counties)) {
    const local = Object.values(county).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(local - 1) < 1e-6);
  }
});

test("seats add up to the total and only parties above 5% get any", () => {
  const state = newGame();
  const poll = computePoll(state, data);
  const total = Object.values(poll.seats).reduce((a, b) => a + b, 0);
  assert.equal(total, data.config.totalSeats);
  for (const [id, seats] of Object.entries(poll.seats)) {
    if (poll.national[id] < 0.05) assert.equal(seats, 0, id);
  }
});

test("an action spends funds and starts a cooldown", () => {
  const state = newGame();
  const before = state.parties.psd.funds;
  const first = applyAction(state, data, "psd", { type: "rally", county: "cluj" });
  assert.equal(first.ok, true);
  assert.ok(state.parties.psd.funds < before);
  const second = applyAction(state, data, "psd", { type: "rally", county: "cluj" });
  assert.equal(second.ok, false);
  assert.match(second.error, /Prea devreme/);
});

test("laws need a government", () => {
  const state = newGame();
  const res = applyAction(state, data, "psd", { type: "law", law: "austeritate" });
  assert.equal(res.ok, false);
  assert.match(res.error, /guvern/);
});

test("moving voters between segments keeps the population constant", () => {
  const state = newGame();
  data.events.events.push({
    id: "test-convert",
    title: "test",
    text: "",
    weight: 1,
    minDay: 0,
    effects: { convert: [{ from: "studenti", to: "diaspora", share: 0.5 }] },
  });
  const before = Object.values(state.counties.cluj.segments).reduce((a, b) => a + b, 0);
  fireEvent(state, data, "test-convert");
  const after = Object.values(state.counties.cluj.segments).reduce((a, b) => a + b, 0);
  data.events.events.pop();
  assert.ok(Math.abs(before - after) < 0.5, `${before} vs ${after}`);
  assert.ok(state.counties.cluj.segments.diaspora > 0);
});

test("the clock reaches an election and forms a government", () => {
  const state = newGame();
  tick(state, data, data.config.campaignDays + 1);
  assert.ok(state.lastResult);
  const gov = state.lastResult.gov;
  assert.ok(gov.length >= 1);
  for (const id of gov) assert.equal(state.parties[id].gov, true);
  assert.ok(state.electionDay > data.config.campaignDays);
});

test("the ctl drives coalitions, events, elections and rejects bad input", () => {
  const ctl = createCtl(data);
  ctl.run("play psd");
  assert.match(ctl.run("laws"), /austeritate/);
  assert.match(ctl.run("politicians"), /ciolacu/);
  assert.match(ctl.run("event diploma-avion"), /^event diploma-avion/);
  assert.match(ctl.run("event nope"), /^error/);
  assert.match(ctl.run("coalition psd pnl"), /trimis/);
  assert.match(ctl.run("accept pnl psd"), /format/);
  assert.match(ctl.run("speed 3"), /^error/);
  assert.match(ctl.run("speed 4"), /^speed 4/);
  assert.match(ctl.run("act rally nowhere"), /^error/);
  assert.match(ctl.run("election"), /^winner/);
  assert.match(ctl.run("counties cluj"), /cluj/);
  assert.match(ctl.run("events"), /Alegeri/);
});

const segmentIds = new Set(data.segments.segments.map((s) => s.id));
const partyIds = new Set(data.parties.parties.map((p) => p.id));
const countyIds = new Set(data.counties.counties.map((c) => c.id));
const politicianIds = new Set(data.politicians.politicians.map((p) => p.id));

// Throws a readable assertion when an effects block points at something that doesn't exist.
function checkEffects(effects, where) {
  const known = ["segments", "convert", "county", "party", "countyParty", "funds", "segBoost", "countyBoostAll", "politician"];
  for (const key of Object.keys(effects ?? {})) assert.ok(known.includes(key), `${where}: unknown effect ${key}`);
  const party = (id) => assert.ok(id === "self" || partyIds.has(id), `${where}: party ${id}`);
  const segments = (obj) => Object.keys(obj ?? {}).forEach((s) => assert.ok(segmentIds.has(s), `${where}: segment ${s}`));
  const convert = (rules) =>
    (rules ?? []).forEach((r) => {
      assert.ok(segmentIds.has(r.from) && segmentIds.has(r.to), `${where}: convert ${r.from}->${r.to}`);
      assert.ok(r.share > 0 && r.share < 1, `${where}: share ${r.share}`);
    });
  segments(effects?.segments);
  segments(effects?.segBoost);
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
  if (effects?.politician) assert.ok(politicianIds.has(effects.politician.id), `${where}: politician`);
}

test("every event, choice and law only points at things that exist", () => {
  const ids = new Set();
  for (const e of data.events.events) {
    assert.ok(!ids.has(e.id), `duplicate event ${e.id}`);
    ids.add(e.id);
    assert.ok(e.title && e.text, `${e.id}: title/text`);
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
  for (const l of data.laws.laws) checkEffects(l.effects, l.id);
  assert.ok(data.events.events.length >= 100);
  assert.ok(data.events.events.filter((e) => e.choices).length >= 10);
});

test("every politician has stats, facts, a look and valid references", () => {
  const stats = ["charisma", "patience", "malleability", "gaffes", "visibility", "corruption", "traseism"];
  for (const p of data.politicians.politicians) {
    assert.ok(p.party === null || partyIds.has(p.party), `${p.id}: party`);
    for (const s of stats) assert.ok(p.stats[s] >= 0 && p.stats[s] <= 100, `${p.id}: ${s}`);
    assert.ok(p.facts.real.length >= 1 && p.facts.fake.length >= 1, `${p.id}: facts`);
    assert.ok(p.look?.hair && p.look.skin && p.look.suit, `${p.id}: look`);
    for (const seg of Object.keys(p.ability.effect)) assert.ok(segmentIds.has(seg), `${p.id}: ${seg}`);
  }
  for (const party of data.parties.parties) {
    const leader = data.politicians.politicians.find((p) => p.id === party.leader);
    assert.equal(leader?.party, party.id, `${party.id} leader belongs to the party`);
  }
  assert.ok(data.politicians.politicians.length >= 30);
});

test("a decision event asks the player, applies the choice and expires if ignored", () => {
  const state = newGame();
  fireEvent(state, data, "d-greva-medici");
  let snap = snapshot(state, data);
  assert.equal(snap.decisions.length, 1);
  assert.equal(snap.decisions[0].party, "psd");
  assert.equal(snap.decisions[0].choices.length, 3);

  assert.equal(decide(state, data, "aur", snap.decisions[0].id, 0).ok, false);
  assert.equal(decide(state, data, "psd", snap.decisions[0].id, 9).ok, false);
  const before = state.parties.psd.funds;
  const res = decide(state, data, "psd", snap.decisions[0].id, 1);
  assert.equal(res.ok, true);
  assert.equal(state.parties.psd.funds, before - 50);
  assert.equal(snapshot(state, data).decisions.length, 0);

  fireEvent(state, data, "d-greva-medici");
  state.parties.psd.funds = 5;
  const d = snapshot(state, data).decisions[0];
  assert.equal(decide(state, data, "psd", d.id, 1).ok, false);
  tick(state, data, 10);
  assert.equal(state.decisions.length, 0);
  assert.ok(state.log.some((l) => l.kind === "decision" && /ignorat/.test(l.title)));
});

test("follow-up events only fire after their cause", () => {
  const byId = Object.fromEntries(data.events.events.map((e) => [e.id, e]));
  for (const seed of [1, 2, 3, 4, 5]) {
    const state = createGame(data, { seed, humans: [] });
    for (let d = 0; d < 119; d += 1) {
      tick(state, data, 1);
      for (const [id, day] of Object.entries(state.fired)) {
        const cause = byId[id].after;
        if (!cause || day !== state.day) continue;
        const causeDay = state.fired[cause];
        assert.ok(causeDay !== undefined && state.day - causeDay <= 45, `${id} without ${cause} (seed ${seed})`);
      }
    }
  }
});

test("a county event only reshapes the segments of that county", () => {
  const state = newGame();
  const other = JSON.stringify(state.counties.cluj.segments);
  const before = Object.values(state.counties.hunedoara.segments).reduce((a, b) => a + b, 0);
  const workers = state.counties.hunedoara.segments.muncitori;
  const jobless = state.counties.hunedoara.segments.someri;
  fireEvent(state, data, "valea-jiului-minele");
  const h = state.counties.hunedoara.segments;
  assert.ok(h.muncitori < workers && h.someri > jobless);
  assert.ok(Math.abs(Object.values(h).reduce((a, b) => a + b, 0) - before) < 0.5);
  assert.equal(JSON.stringify(state.counties.cluj.segments), other);
  assert.ok(state.counties.hunedoara.boost.psd < 0);
});

test("team members add to the leader's ability when a party acts", () => {
  const state = newGame();
  const psdMembers = data.politicians.politicians.filter((p) => p.party === "psd");
  assert.ok(psdMembers.length >= 5);
  applyAction(state, data, "psd", { type: "rally", county: "dolj" });
  assert.ok(state.parties.psd.segBoost.pensionari_rural > 1.05);
});

test("pausing stops the clock in the ctl and resumes it", () => {
  const ctl = createCtl(data);
  assert.equal(ctl.run("pause"), "paused");
  assert.equal(ctl.room.state.speed, 0);
  assert.equal(ctl.run("speed 0"), "paused");
  assert.equal(ctl.run("resume"), "speed 1");
  assert.match(ctl.run("speed 5"), /^error/);
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

test("the ctl plays a full turn and reports state", () => {
  const ctl = createCtl(data);
  assert.match(ctl.run("play psd"), /playing psd/);
  assert.match(ctl.run("act rally cluj"), /^ok/);
  assert.match(ctl.run("tick 3"), /^day 3/);
  assert.match(ctl.run("poll"), /psd/);
  assert.match(ctl.run("bogus"), /^error/);
});
