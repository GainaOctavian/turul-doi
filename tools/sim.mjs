import { readFileSync } from "node:fs";
import { createGame, computePoll, tick, snapshot } from "../shared/engine.mjs";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const data = {
  config: read("config.json"), segments: read("segments.json"), parties: read("parties.json"),
  politicians: read("politicians.json"), counties: read("counties.json"), events: read("events.json"),
  scenarios: read("scenarios.json"), government: read("government.json"), policies: read("policies.json"),
  countries: read("countries.json"),
};

const years = Number(process.argv[3] ?? 4);
for (const id of [process.argv[2] ?? "2026"]) {
  const s = createGame(data, { seed: 5, scenario: id, humans: [] });
  const p0 = computePoll(s, data);
  console.log(id, "poll", Object.entries(p0.national).map(([k, v]) => `${k}:${(v * 100).toFixed(1)}`).join(" "));
  console.log("seats", JSON.stringify(p0.seats), "gov", s.gov.coalition, "support", Object.keys(s.gov.support));
  const show = (label) => {
    const m = s.macro, x = s.metrics;
    console.log(
      label.padEnd(8),
      `gdp ${Math.round(m.gdp)} g ${m.growth.toFixed(1)} inf ${m.inflation.toFixed(1)} u ${m.unemployment.toFixed(1)}`,
      `def ${m.deficitPct.toFixed(1)} debt ${(m.debt / m.gdp * 100).toFixed(0)} rate ${m.rate.toFixed(1)} rat ${s.rating.idx}/${s.rating.strain.toFixed(1)}`,
      `H ${x.health.toFixed(0)} E ${x.education.toFixed(0)} I ${x.infra.toFixed(0)} cpi ${x.cpi.toFixed(0)} km ${x.motorwayKm.toFixed(0)}`,
      `LE ${x.lifeExp.toFixed(1)} conf ${s.gov.confidence.toFixed(0)} gov ${s.gov.coalition.join("+")}`,
    );
  };
  show("day0");
  for (let y = 1; y <= years; y += 1) {
    tick(s, data, 365);
    show(`year ${y}`);
  }
  const snap = snapshot(s, data);
  console.log("snapshot bytes", JSON.stringify(snap).length);
  console.log("sat", JSON.stringify(snap.gov.sat));
  console.log("last result", s.lastResult && JSON.stringify(s.lastResult.seats), s.lastResult?.gov);
}
