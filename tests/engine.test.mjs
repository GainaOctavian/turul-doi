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

test("the ctl plays a full turn and reports state", () => {
  const ctl = createCtl(data);
  assert.match(ctl.run("play psd"), /playing psd/);
  assert.match(ctl.run("act rally cluj"), /^ok/);
  assert.match(ctl.run("tick 3"), /^day 3/);
  assert.match(ctl.run("poll"), /psd/);
  assert.match(ctl.run("bogus"), /^error/);
});
