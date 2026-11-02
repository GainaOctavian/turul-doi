// The outside world: a global cycle, the EU average and a handful of comparison
// countries. Romania itself is simulated by gov.mjs; here we only keep the rest
// moving, with shocks and events that stay inside plausible ranges.
import { clamp, gauss, rand, round, log } from "./util.mjs";

const IND = [
  "gdpPps", "growth", "inflation", "unemployment", "deficit", "debt",
  "lifeExp", "cpi", "earlyLeavers", "arope", "motorwayDensity",
];

export function initWorld(state, data, sc) {
  const series = data.countries.series[String(sc.year)] ?? data.countries.series["2026"];
  const eco = sc.economy;
  const euStart = series.eu;
  const euTrendGrowth = sc.year <= 2019 ? 1.8 : 1.4;
  const countries = {};
  for (const def of data.countries.countries) {
    if (def.player) continue;
    const v = { ...series[def.id] };
    // Poorer economies converge faster; everybody drifts toward a plain EU trend.
    const trendGrowth = def.id === "eu" ? euTrendGrowth : 0.5 * v.growth + 0.5 * euTrendGrowth + 0.025 * (100 - v.gdpPps);
    countries[def.id] = {
      v,
      trend: {
        growth: round(trendGrowth, 2),
        inflation: def.id === "eu" ? 2.0 : round(0.4 * v.inflation + 0.6 * 2.1, 2),
        unemployment: v.unemployment,
        deficit: round(0.7 * v.deficit + 0.3 * 2.5, 2),
        cpi: v.cpi,
        lifeExp: v.lifeExp,
      },
      shock: { growth: 0, inflation: 0, deficit: 0 },
    };
  }
  state.world = {
    cycle: 0,
    energy: eco.energy,
    ecb: eco.ecb,
    ecbTarget: sc.year <= 2019 ? 0.5 : 2.0,
    infShock: 0,
    euTrend0: euTrendGrowth,
    countries,
    firedAt: {},
    log: [],
  };
}

function worldYear(state) {
  return Number(state.date?.slice(0, 4) ?? 2026);
}

function applyWorldEvent(state, data, ev) {
  const w = state.world;
  const e = ev.effects ?? {};
  if (e.cycle) w.cycle = clamp(w.cycle + e.cycle, -3.5, 2.5);
  if (e.energy) w.energy = clamp(w.energy + e.energy, 60, 220);
  if (e.ecb) w.ecbTarget = clamp(w.ecbTarget + e.ecb, -0.5, 5);
  if (e.inflation && ev.country === "global") w.infShock += e.inflation;
  const target = ev.country === "global" ? null : w.countries[ev.country];
  if (target) {
    if (e.growth) target.shock.growth += e.growth;
    if (e.inflation) target.shock.inflation += e.inflation;
    if (e.deficit) target.shock.deficit += e.deficit;
    if (e.unemployment) target.v.unemployment = clamp(target.v.unemployment + e.unemployment, 1.5, 28);
    if (e.debt) target.v.debt = clamp(target.v.debt + e.debt, 5, 220);
    if (e.cpi) target.v.cpi = clamp(target.v.cpi + e.cpi, 20, 95);
    if (e.euGrowth) w.countries.eu.shock.growth += e.euGrowth;
  }
  const name = data.countries.countries.find((c) => c.id === ev.country)?.short ?? "Lume";
  w.log.push({ day: state.day, country: ev.country, title: ev.title, text: ev.text });
  if (w.log.length > 30) w.log.shift();
  log(state, "world", `${name}: ${ev.title}`, ev.text);
}

export function worldMonthly(state, data) {
  const w = state.world;
  const year = worldYear(state);

  // Global state
  w.cycle = 0.93 * w.cycle + 0.1 * gauss(state);
  w.energy = clamp(w.energy + 0.08 * (100 - w.energy) + 2.2 * gauss(state), 60, 220);
  w.infShock *= 0.9;
  w.ecbTarget += 0.02 * (1.9 + 0.4 * (w.countries.eu.v.inflation - 2.0) - w.ecbTarget);
  w.ecb += 0.06 * (w.ecbTarget - w.ecb);

  const eu = w.countries.eu;
  for (const def of data.countries.countries) {
    const c = w.countries[def.id];
    if (!c) continue;
    const v = c.v;
    const beta = def.beta ?? 1;
    const vol = def.vol ?? 0.25;
    const energyPush = 0.012 * (w.energy - 100);

    v.growth += 0.18 * (c.trend.growth + beta * w.cycle + c.shock.growth - v.growth) + vol * 0.35 * gauss(state);
    v.inflation += 0.12 * (c.trend.inflation + energyPush + w.infShock + c.shock.inflation - v.inflation) + vol * 0.22 * gauss(state);
    v.unemployment += 0.06 * (c.trend.unemployment - 0.35 * (v.growth - c.trend.growth) - v.unemployment);
    v.deficit += 0.05 * (c.trend.deficit + 0.4 * (c.trend.growth - v.growth) + c.shock.deficit - v.deficit);
    v.debt += (v.deficit - (v.debt * (v.growth + v.inflation)) / 100) / 12;
    if (def.id !== "eu") v.gdpPps *= 1 + (v.growth - eu.v.growth) / 1200;
    v.lifeExp += (0.2 + 0.05 * gauss(state)) / 12;
    v.cpi += 0.02 * (c.trend.cpi - v.cpi);
    v.earlyLeavers = Math.max(2, v.earlyLeavers - 0.1 / 12);
    v.arope = Math.max(8, v.arope - 0.12 / 12);
    v.motorwayDensity *= 1 + 0.004 / 12;

    c.shock.growth *= 0.9;
    c.shock.inflation *= 0.88;
    c.shock.deficit *= 0.93;
    v.growth = clamp(v.growth, -6, 9);
    v.inflation = clamp(v.inflation, -1.5, 15);
    v.unemployment = clamp(v.unemployment, 1.5, 28);
    v.deficit = clamp(v.deficit, -4, 12);
    v.debt = clamp(v.debt, 5, 220);
  }

  // Events: at most one a month, weighted, with cooldowns.
  if (rand(state) < 0.3) {
    const pool = data.countries.events.filter((e) => {
      if (e.minYear && year < e.minYear) return false;
      const last = w.firedAt[e.id];
      return last == null || (state.day - last) / 365 >= (e.cooldown ?? 3);
    });
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = rand(state) * total;
    for (const e of pool) {
      r -= e.weight;
      if (r <= 0) {
        w.firedAt[e.id] = state.day;
        applyWorldEvent(state, data, e);
        break;
      }
    }
  }
}

// The row shown for Romania, read from the government model.
export function roRow(state) {
  const m = state.macro;
  const x = state.metrics;
  return {
    gdpPps: m.gdpPps,
    growth: m.growth,
    inflation: m.inflation,
    unemployment: m.unemployment,
    deficit: m.deficitPct,
    debt: (m.debt / m.gdp) * 100,
    lifeExp: x.lifeExp,
    cpi: x.cpi,
    earlyLeavers: x.earlyLeavers,
    arope: x.arope,
    motorwayDensity: x.motorwayKm / x.area,
  };
}

export function worldView(state, data) {
  const w = state.world;
  const rows = { ro: roRow(state) };
  for (const [id, c] of Object.entries(w.countries)) rows[id] = c.v;
  const out = {};
  for (const [id, v] of Object.entries(rows)) {
    out[id] = Object.fromEntries(IND.map((k) => [k, round(v[k], k === "gdpPps" || k === "debt" || k === "cpi" ? 1 : 2)]));
  }
  return {
    countries: out,
    cycle: round(w.cycle, 2),
    energy: round(w.energy, 0),
    ecb: round(w.ecb, 2),
    events: w.log.slice(-12),
  };
}

export const INDICATORS = IND;
