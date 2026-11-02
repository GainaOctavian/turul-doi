// Small helpers shared by the engine, the government model and the world model.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export const round = (v, d = 1) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

// Deterministic LCG kept on the state so a saved game replays the same way.
export function rand(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

// Standard normal (Box–Muller) on the same generator.
export function gauss(state) {
  const u = Math.max(1e-9, rand(state));
  const v = rand(state);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function log(state, kind, title, text = "") {
  state.log.push({ day: state.day, kind, title, text });
  const max = state.config.maxLog ?? 120;
  if (state.log.length > max) state.log.splice(0, state.log.length - max);
}

export function dateAt(startDate, day) {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export function dayOf(startDate, isoDate) {
  const a = new Date(`${startDate}T00:00:00Z`).getTime();
  const b = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}
