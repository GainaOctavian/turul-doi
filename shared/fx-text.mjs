// Plain-Romanian description of an `effects` object, so the player sees exactly what an event,
// a choice or a law does: "▲ Pensionari rurali: nivel de trai +2", "▼ inflație +0,15 pp", ...

const METRIC = {
  cpi: "indicele anticorupție",
  infra: "infrastructura",
  education: "educația",
  health: "sănătatea",
  safety: "siguranța",
  earlyLeavers: "abandonul școlar",
  lifeExp: "speranța de viață",
};
const MACRO = { growth: "creșterea economică", inflation: "inflația", unemployment: "șomajul" };
const BUDGET = { pensions: "pensii", social: "asistență socială", education: "educație", health: "sănătate", defense: "apărare", agri: "agricultură", order: "ordine publică", admin: "administrație", infra: "investiții", transport: "transport" };
const RULES = { electoralThreshold: "pragul electoral" };
// For these, a rise is bad news for the player.
const BAD_UP = new Set(["inflation", "unemployment", "earlyLeavers"]);

const num = (v, d = 1) => Math.abs(v).toFixed(d).replace(/\.?0+$/, "").replace(".", ",") || "0";
const sgn = (v, d = 1) => `${v > 0 ? "+" : "−"}${num(v, d)}`;
const arrow = (v, bad = false) => ((v > 0) !== bad ? "▲" : "▼");

export function describeEffects(data, fx) {
  const out = [];
  if (!fx) return out;
  const seg = (id) => data.segments?.segments?.find((s) => s.id === id)?.name ?? id;
  const who = (key) => (key === "self" ? "ta" : key === "gov" ? "guvernării" : key === "opp" ? "opoziției" : key.toUpperCase());

  for (const [id, v] of Object.entries(fx.segments ?? {})) out.push(`${arrow(v)} ${seg(id)}: voturi ${sgn(v * 100)}%`);
  for (const [id, v] of Object.entries(fx.sol ?? {})) out.push(`${arrow(v)} ${seg(id)}: nivel de trai ${sgn(v)}`);
  for (const [key, v] of Object.entries(fx.party ?? {})) out.push(`${arrow(v)} popularitatea ${who(key)} ${sgn(v * 100)}%`);
  for (const [id, v] of Object.entries(fx.segBoost ?? {})) out.push(`${arrow(v - 1)} ${seg(id)}: simpatie pentru tine ${sgn((v - 1) * 100)}%`);
  for (const [k, v] of Object.entries(fx.macro ?? {})) out.push(`${arrow(v, BAD_UP.has(k))} ${MACRO[k] ?? k} ${sgn(v, 2)} pp`);
  for (const [k, v] of Object.entries(fx.metric ?? {})) out.push(`${arrow(v, BAD_UP.has(k))} ${METRIC[k] ?? k} ${sgn(v)}`);
  for (const [k, v] of Object.entries(fx.budget ?? {})) out.push(`${v > 0 ? "▲" : "▼"} bugetul pentru ${BUDGET[k] ?? k} ${sgn(v * 100, 0)}%`);
  for (const [key, v] of Object.entries(fx.funds ?? {})) out.push(`${arrow(v)} fonduri ${key === "self" ? "tale" : who(key)} ${sgn(v)} M€`);
  for (const [key, v] of Object.entries(fx.lasting ?? {})) out.push(`${arrow(v)} pentru totdeauna: popularitatea ${who(key)} ${sgn(v * 100)}% (până o pierzi)`);
  for (const [k, v] of Object.entries(fx.rules ?? {})) out.push(`${RULES[k] ?? k}: ${num(v)}%`);
  if (fx.confidence) out.push(`${arrow(fx.confidence)} încrederea în guvern ${sgn(fx.confidence, 0)} puncte`);
  if (fx.countyBoostAll) out.push(`${arrow(fx.countyBoostAll)} influența ta în toate județele ${sgn(fx.countyBoostAll * 100, 0)}%`);
  const nCounty = Object.keys(fx.county ?? {}).length + Object.keys(fx.countyParty ?? {}).length;
  if (nCounty) out.push(`efecte locale în ${nCounty} județe`);
  if (fx.convert?.length) out.push("mută votanți între grupuri");
  if (fx.politician) out.push(`${arrow(fx.politician.delta)} ${fx.politician.id}: ${fx.politician.stat} ${sgn(fx.politician.delta, 0)}`);
  if (fx.buff) {
    for (const [key, factor] of Object.entries(fx.buff.mood ?? {})) {
      out.push(`${arrow(factor - 1)} ${fx.buff.days ?? 30} de zile: popularitatea ${who(key)} ${sgn((factor - 1) * 100)}%${fx.buff.label ? ` (${fx.buff.label})` : ""}`);
    }
  }
  return out;
}
