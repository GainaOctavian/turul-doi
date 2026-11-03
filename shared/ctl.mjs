// Line-based control language over the game engine. Used by the CLI
// (bin/turul-doi-ctl.mjs) and by the local endpoint when TURUL_DOI_CTL=1.
import {
  createGame,
  tick,
  snapshot,
  applyAction,
  applyGov,
  offerCoalition,
  acceptCoalition,
  applyParl,
  consumeRenamed,
  splinterOptions,
  fireEvent,
  runElection,
  decide,
  ACTIONS,
  previewAction,
} from "./engine.mjs";

export const HELP = `turul-doi ctl
  scenario <2017|2026>      pornește un joc nou pe scenariu
  state                     data, scenariul, partidul jucat, fonduri
  gov                       guvernul: premier, coaliție, încredere, rating
  parties                   partide: sondaj, mandate, fonduri, guvern
  poll                      sondaj național pe partide
  counties [filtru]         câștigătorul fiecărui județ
  play <partid>             joacă pentru un partid
  speed <0|1|2|4>           viteza ceasului (0 = pauză)
  pause / resume            oprește sau pornește ceasul
  act <tip> [judet] [rival] campanie: rally tv online deal attack promise inquiry protest signatures foundation exposure; la guvernare: inauguration relief govpr
  preview <tip> [judet] [rival]  efectul estimat, fără să cheltuiască nimic (în pp)
  actions                   acțiunile de campanie și costul lor în M€
  budget                    venituri și cheltuieli în M€, deficit
  spend <linie> <M€>        setează o linie de cheltuieli (M€/an)
  tax <vat|income|corp> <%> setează o cotă de impozitare
  policies [minister]       politicile disponibile și starea lor
  policy <id>               adoptă o politică; repeal <id> o abrogă
  metrics                   indicatorii țării, cu media UE
  sol                       standardul de viață pe segmente de votanți
  world [indicator]         comparația cu UE și alte țări
  cabinet                   ministerele, partidele și miniștrii
  appoint <minister> <id>   numește un ministru (doar partidul premierului)
  proposals                 propunerile din guvern; answer <id> <accept|reject>
  motion                    depune o moțiune de cenzură (opoziția)
  support <on|off>          oferă sau retrage sprijinul parlamentar
  politicians [partid]      profilurile politicienilor
  event <id>                declanșează un eveniment
  decisions                 deciziile în așteptare; decide <id> <alegere>
  tick <zile>               avansează ceasul; month [n] = 30 de zile
  election                  alegeri acum
  coalition <de> <catre>    ofertă de coaliție; accept <catre> <de>
  lists                     listele la alegeri: prag 5%, procent, județe peste 20%
  parl                      Parlamentul: legi în dezbatere, voturi, relații
  laws                      catalogul de legi pe care le poți depune
  bill <lege>               depune o lege (și opoziția poate)
  vote <nr> <yes|no|abstain> votezi o lege sau o moțiune
  lobby <nr> <partid> <favor|money|swap> [against]  negociere de culise (și împotriva unei legi)
  rel [partid]              relațiile tale cu celelalte partide
  courtesy <partid>         gest politic: +8 relație (4 capital)
  merge <partid> <fusion|absorb|pact> [nume]   fuziune, absorbție sau pact de colaborare (relație 55+)
  merge-answer <partid> <yes|no>  răspunzi unei oferte
  split [frac] [model]      oamenii pleacă și formează o grupare nouă (ex: split 0.3 pdl)
  profile [partid]          profilul partidului: categorii, direcție, oameni
  shift <categorie|left|right>  mută direcția partidului
  president                 președintele, candidaturile, sprijinul și legile la Cotroceni
  pres-run                  depune candidatura (ultimele 150 de zile)
  pres-back <partid>        susține o candidatură propusă
  recruit [partid|-] [nr]    recrutează parlamentari (neafiliați cu -, sau de la un rival cu grup șubred)
  offers                    ofertele de sprijin primite
  offer <nr> yes|no          acceptă sau refuză o ofertă
  amend <nr> <id>           adoptă un amendament la o lege deschisă (3 capital, o dată); fără id, le listează
  ccr <nr>                  sesizează Curtea Constituțională pentru o lege la Cotroceni
  events                    ultimele evenimente
  help                      acest text`;

const f0 = (n) => Math.round(n).toLocaleString("ro-RO");
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

export function createCtl(data, opts = {}) {
  const room = { state: createGame(data, { seed: 12345, scenario: opts.scenario ?? "2026" }) };
  const find = (arr, id) => arr.find((x) => x.id === id);

  const partyIds = () => room.state.partyIds;
  const me = () => room.state.humans[0];
  const need = () => (me() ? null : "error: alege un partid cu play <partid>");

  function run(line) {
    const raw = String(line ?? "").trim();
    if (!raw) return "";
    const [cmd, ...args] = raw.split(/\s+/);
    const state = room.state;
    const gov = () => snapshot(state, data).gov;

    switch (cmd) {
      case "help":
        return HELP;

      case "scenario": {
        if (!find(data.scenarios.scenarios, args[0])) return "error: scenarii: 2017, 2026";
        room.state = createGame(data, { seed: 12345, scenario: args[0] });
        return `scenariu ${args[0]}: ${find(data.scenarios.scenarios, args[0]).name}`;
      }

      case "state": {
        const snap = snapshot(state, data);
        const human = state.humans[0] ?? "-";
        const p = human !== "-" ? state.parties[human] : null;
        return [
          `scenariu ${state.scenario}`,
          `ziua ${snap.day} (${snap.date})`,
          `alegeri în ${Math.max(0, snap.electionDay - snap.day)} zile`,
          `joci ${human}${p ? ` fonduri ${p.funds} M€ capital ${p.capital}` : ""}`,
          `viteza ${snap.speed}`,
        ].join("\n");
      }

      case "gov": {
        const g = gov();
        const snap = snapshot(state, data);
        const name = (id) => state.politicians[id]?.name ?? "-";
        return [
          `premier ${name(g.gov.pm)} (${g.gov.pmParty ?? "independent"})`,
          `coaliție ${g.gov.coalition.join("+") || "-"}  sprijin ${Object.keys(g.gov.support).join(",") || "-"}`,
          `încredere ${g.gov.confidence}  aprobare ${g.gov.approval}`,
          `rating ${g.rating.level} (${g.rating.outlook})  încordare ${g.rating.strain}`,
          `alegeri în ${Math.max(0, snap.electionDay - snap.day)} zile`,
        ].join("\n");
      }

      case "parties": {
        const snap = snapshot(state, data);
        return partyIds()
          .map((id) => {
            const s = state.parties[id];
            return `${id.padEnd(5)} ${pct(snap.parties[id].share).padStart(6)} mandate ${String(s.seats).padStart(3)} fonduri ${String(s.funds).padStart(5)} M€${s.gov ? " GUVERN" : ""}`;
          })
          .join("\n");
      }

      case "poll": {
        const snap = snapshot(state, data);
        return partyIds()
          .slice()
          .sort((a, b) => snap.poll.national[b] - snap.poll.national[a])
          .map((id) => `${id.padEnd(5)} ${pct(snap.poll.national[id])}`)
          .join("\n");
      }

      case "counties": {
        const snap = snapshot(state, data);
        const filter = (args[0] ?? "").toLowerCase();
        return Object.values(state.counties)
          .filter((c) => c.id.includes(filter) || c.name.toLowerCase().includes(filter))
          .map((c) => {
            const top = Object.entries(snap.poll.counties[c.id]).sort((a, b) => b[1] - a[1])[0];
            return `${c.id.padEnd(18)} ${top[0]} ${pct(top[1])}`;
          })
          .join("\n");
      }

      case "play": {
        if (!partyIds().includes(args[0])) return `error: partid necunoscut în scenariu (${partyIds().join(", ")})`;
        state.humans = [args[0]];
        return `playing ${args[0]}`;
      }

      case "speed": {
        const v = Number(args[0]);
        if (![0, 1, 2, 4].includes(v)) return "error: speed 0 (pauză), 1, 2 sau 4";
        state.speed = v;
        return v === 0 ? "paused" : `speed ${v}`;
      }

      case "pause":
        state.speed = 0;
        return "paused";

      case "resume":
        state.speed = 1;
        return "speed 1";

      case "actions":
        return ACTIONS.map((a) => `${a.id.padEnd(8)} ${String(a.cost).padStart(4)} M€  cd ${a.cooldown}  ${a.target}`).join("\n");

      case "act": {
        const type = args[0];
        if (!type) return "error: lipsește tipul acțiunii";
        const action = { type };
        if (["rally", "deal", "protest", "foundation", "inauguration"].includes(type)) action.county = args[1];
        if (type === "exposure") action.targetParty = args[1];
        if (type === "attack") {
          action.county = args[1];
          action.targetParty = args[2];
        }
        if (need()) return need();
        const res = applyAction(state, data, me(), action);
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "preview": {
        if (need()) return need();
        const type = args[0];
        const action = { type };
        if (["rally", "deal", "protest", "foundation", "inauguration"].includes(type)) action.county = args[1];
        if (type === "attack" || type === "exposure") action.targetParty = type === "attack" ? args[2] : args[1];
        if (type === "attack") action.county = args[1];
        const p = previewAction(state, data, me(), action);
        if (!p.ok) return `error: ${p.error}`;
        const own = p.national[me()] ?? 0;
        const segs = p.segs.filter((x) => Math.abs(x.own) >= 0.05).sort((x, y) => Math.abs(y.own) - Math.abs(x.own)).slice(0, 4).map((x) => `${x.seg} ${x.own > 0 ? "+" : ""}${x.own} pp`);
        return `tu ${own > 0 ? "+" : ""}${own} pp în sondaj · ${segs.join(" · ") || "fără efect vizibil pe votanți"}`;
      }

      case "budget": {
        const g = gov();
        const fl = g.budget.flows;
        const gdp = g.macro.gdp;
        const line = (name, v) => `  ${name.padEnd(28)} ${f0(v).padStart(8)} M€  ${((v / gdp) * 100).toFixed(1).padStart(5)}% PIB`;
        const out = [`PIB ${f0(gdp)} M€`, "VENITURI"];
        for (const r of data.government.revenueLines) out.push(line(r.name, fl.revenue[r.id]));
        out.push(line("Total venituri", fl.revTotal), "CHELTUIELI");
        for (const l of data.government.spendLines) out.push(line(l.name, fl.spend[l.id]));
        for (const l of data.government.fixedSpend) out.push(line(l.name, fl.spend[l.id]));
        out.push(line("Total cheltuieli", fl.spendTotal));
        out.push(`  Sold ${f0(fl.balance)} M€  deficit ${f1(g.macro.deficitPct)}% PIB  datorie ${f1(g.macro.debtPct)}% PIB`);
        out.push(`  Taxe: TVA ${g.budget.tax.vat}%  venit ${g.budget.tax.income}%  profit ${g.budget.tax.corp}%`);
        return out.join("\n");
      }

      case "spend": {
        if (need()) return need();
        const res = applyGov(state, data, me(), { type: "setSpend", line: args[0], amount: Number(args[1]) });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "tax": {
        if (need()) return need();
        const res = applyGov(state, data, me(), { type: "setTax", tax: args[0], rate: Number(args[1]) });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "policies": {
        const g = gov();
        return data.policies.policies
          .filter((p) => !args[0] || p.ministry === args[0])
          .map((p) => `${g.policies[p.id] != null ? "[x]" : "[ ]"} ${p.id.padEnd(22)} ${p.ministry.padEnd(11)} capital ${String(p.capital).padStart(2)}  ${p.name}`)
          .join("\n");
      }

      case "policy":
      case "repeal": {
        if (need()) return need();
        const res = applyGov(state, data, me(), { type: "policy", id: args[0], on: cmd === "policy" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "metrics": {
        const g = gov();
        const snap = snapshot(state, data);
        const eu = snap.world.countries.eu;
        const ro = snap.world.countries.ro;
        const rows = [];
        for (const m of data.government.metrics) {
          const v = g.macro[m.id] ?? g.metrics[m.id] ?? (m.id === "debt" ? g.macro.debtPct : m.id === "deficit" ? g.macro.deficitPct : m.id === "interest" ? g.budget.flows.spend.interest : m.id === "motorwayDensity" ? ro.motorwayDensity : m.id === "pensionReal" ? g.macro.pensionIdx : m.id === "gdp" ? g.macro.gdp : undefined);
          const euv = m.eu ? eu[m.eu] : null;
          rows.push(`${m.name.padEnd(30)} ${String(typeof v === "number" ? Math.round(v * 10 ** m.decimals) / 10 ** m.decimals : v).padStart(9)} ${m.unit.padEnd(11)}${euv != null ? ` UE ${euv}` : ""}`);
        }
        return rows.join("\n");
      }

      case "sol": {
        const g = gov();
        return data.segments.segments
          .map((s) => `${s.id.padEnd(18)} SoL ${String(g.sol[s.id]).padStart(5)}  așteptări ${String(g.solExpect[s.id]).padStart(5)}  satisfacție ${g.sat[s.id]}`)
          .join("\n");
      }

      case "world": {
        const snap = snapshot(state, data);
        const inds = args[0] ? data.countries.indicators.filter((i) => i.id === args[0]) : data.countries.indicators;
        if (!inds.length) return `error: indicatori: ${data.countries.indicators.map((i) => i.id).join(", ")}`;
        const ids = data.countries.countries.map((c) => c.id);
        const head = ["".padEnd(10), ...ids.map((c) => c.padStart(7))].join("");
        const rows = inds.map((i) => [i.short.padEnd(10), ...ids.map((c) => String(snap.world.countries[c][i.id]).padStart(7))].join(""));
        return [head, ...rows].join("\n");
      }

      case "cabinet": {
        const g = gov();
        return g.gov.ministries
          .map((m) => `${m.id.padEnd(12)} ${(m.party ?? "indep.").padEnd(7)} ${(m.name ?? "(vacant)").padEnd(26)} competență ${m.competence}`)
          .join("\n");
      }

      case "appoint": {
        if (need()) return need();
        const res = applyGov(state, data, me(), { type: "appoint", ministry: args[0], politician: args[1] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "proposals": {
        const g = gov();
        if (!g.proposals.length) return "nicio propunere";
        return g.proposals.map((p) => `#${p.id} ${p.from}->${p.to ?? "indep."} (${p.ministry}) ${p.label} [${p.status}]`).join("\n");
      }

      case "answer": {
        if (need()) return need();
        const res = applyGov(state, data, me(), { type: "answer", id: Number(args[0]), accept: args[1] === "accept" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "motion": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "motion" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "support": {
        if (need()) return need();
        const res = applyGov(state, data, me(), { type: "support", on: args[0] !== "off" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "politicians":
        return Object.values(state.politicians)
          .filter((p) => !args[0] || (p.party ?? "-") === args[0])
          .map((p) => `${p.id.padEnd(12)} ${(p.party ?? "-").padEnd(5)} carisma ${p.stats.charisma} corupție ${p.stats.corruption} traseism ${p.stats.traseism}  ${p.role}`)
          .join("\n");

      case "event": {
        const ev = fireEvent(state, data, args[0]);
        return ev ? `event ${ev.id}: ${ev.title}` : "error: eveniment necunoscut";
      }

      case "decisions": {
        const mine = snapshot(state, data).decisions.filter((d) => d.party === state.humans[0]);
        if (!mine.length) return "nicio decizie în așteptare";
        return mine
          .map(
            (d) =>
              `#${d.id} (până în ziua ${d.expires}) ${d.title}\n` +
              d.choices.map((c, i) => `  ${i}: ${c.label}${c.cost ? ` [${c.cost} M€]` : ""} - ${c.hint}`).join("\n"),
          )
          .join("\n");
      }

      case "decide": {
        if (need()) return need();
        const res = decide(state, data, me(), args[0], args[1]);
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "tick":
      case "month": {
        const n = Number(args[0] ?? 1) * (cmd === "month" ? 30 : 1);
        if (!Number.isFinite(n) || n < 1) return `error: ${cmd} <număr>`;
        tick(state, data, Math.min(2000, Math.floor(n)));
        return `ziua ${state.day} (${snapshot(state, data).date})`;
      }

      case "election": {
        runElection(state, data);
        const r = state.lastResult;
        return `winner ${r.winner} gov ${r.gov.join("+")} seats ${r.seats[r.winner]}`;
      }

      case "lists": {
        const snap = snapshot(state, data);
        return snap.lists
          .map((l) => `${l.parties.join("+").padEnd(14)} ${pct(l.share).padStart(6)}  prag ${pct(l.need)}  județe>20%: ${l.strongCounties}  ${l.passes ? "intră în Parlament" : "sub prag"}`)
          .join("\n");
      }

      case "parl": {
        const p = snapshot(state, data).parl;
        const lines = p.bills.map((b) => `#${b.id} [${b.kind}] ${b.title} (${b.from}) vot ziua ${b.vote}  ${Object.entries(b.stance).map(([k, v]) => k + ":" + v).join(" ")}`);
        lines.push(...p.done.slice(0, 6).map((d) => `  închis #${d.id} ${d.title} (${d.from}): ${d.status} ${d.tally.yes}-${d.tally.no}`));
        return lines.join("\n") || "niciun vot în desfășurare";
      }

      case "laws":
        return snapshot(state, data).parl.catalog.map((b) => `${b.id.padEnd(22)} ${b.title}${b.openNow ? " [în dezbatere]" : b.passedDay != null ? ` [adoptată ziua ${b.passedDay}]` : ""}`).join("\n");

      case "bill": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "bill", bill: args[0] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "recruit": {
        if (need()) return need();
        const p = snapshot(state, data).parl;
        if (!args[0]) return `neafiliați: ${p.free}; la rivali: recruit <partid> [nr] (coeziune sub ${p.recruit.poach.cohesionBelow}); din grup: recruit - [nr]`;
        const res = applyParl(state, data, me(), { type: "recruit", from: args[0] === "-" ? null : args[0], count: Number(args[1] ?? 1) });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "offers": {
        const o = snapshot(state, data).parl.supportOffers.filter((x) => x.to === me());
        return o.length ? o.map((x) => `#${x.id} ${x.from} oferă ${x.money} M€ + ${x.capital} cap. pentru „${x.title}”`).join("\n") : "nicio ofertă";
      }

      case "offer": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "offer", id: Number(args[0]), accept: args[1] === "yes" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "amend": {
        if (need()) return need();
        if (!args[1]) {
          const b = snapshot(state, data).parl.bills.find((x) => x.id === Number(args[0]));
          if (!b?.options?.length) return "error: nu există o lege cu acest număr.";
          return b.options.map((o) => `${o.id}: ${o.label} — ${o.text}`).join("\n");
        }
        const res = applyParl(state, data, me(), { type: "amend", id: Number(args[0]), option: args[1] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "vote": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "vote", id: args[0], vote: args[1] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "lobby": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "lobby", id: args[0], target: args[1], how: args[2], against: args[3] === "against" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "rel": {
        const who = args[0] ?? me();
        const rel = snapshot(state, data).parl.rel[who];
        if (!rel) return "error: alege un partid";
        return Object.entries(rel).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k.padEnd(12)} ${v}`).join("\n");
      }

      case "courtesy": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "courtesy", target: args[0] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "merge": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "merge", target: args[0], mode: args[1], name: args.slice(2).join(" ") });
        const ren = consumeRenamed(state);
        if (ren[me()]) state.humans = state.humans.map((h) => ren[h] ?? h);
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "merge-answer": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "merge-answer", from: args[0], accept: args[1] !== "no" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "split": {
        if (need()) return need();
        const frac = Number(args[0]);
        const res = applyParl(state, data, me(), { type: "split", frac: Number.isFinite(frac) ? frac : 0.25, template: args[1] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "profile": {
        const id = args[0] ?? me();
        const snap = snapshot(state, data);
        const def = snap.defs[id] ?? data.parties.parties.find((p) => p.id === id);
        if (!def) return "error: alege un partid";
        const aff = Object.entries(def.affinity).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", ");
        const people = Object.values(state.politicians).filter((p) => p.party === id).map((p) => p.name).join(", ");
        return `${def.name} lean ${def.lean} coeziune ${snap.parl.cohesion[id]} capital ${snap.parties[id].capital}\ncategorii: ${aff}\noameni: ${people || "-"}\nmodele de despărțire: ${splinterOptions(state, data, id).map((t) => t.id).join(", ") || "-"}`;
      }

      case "shift": {
        if (need()) return need();
        const dir = args[0];
        const change = dir === "left" ? { lean: 1 } : dir === "right" ? { lean: -1 } : { segment: dir };
        const res = applyParl(state, data, me(), { type: "shift", ...change });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "president": {
        const p = snapshot(state, data).pres;
        const who = p.president.name ?? "fără nume";
        const cands = p.candidates.map((c) => `${c.party} ${c.name} ${pct(c.share)}${c.nominated ? " (candidat)" : ""}`).join("\n");
        const backing = Object.entries(p.backing).map(([c, l]) => `${l.join("+")} → ${c}`).join("; ");
        return `președinte: ${who} (${p.president.party ?? "independent"}), alegeri în ${p.toVote} zile\n${cands}${backing ? `\nsprijin: ${backing}` : ""}\nla Cotroceni: ${p.pending.map((x) => `#${x.id} ${x.title}`).join("; ") || "nimic"}`;
      }

      case "pres-run": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "pres-run" });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "pres-back": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "pres-back", target: args[0] });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "ccr": {
        if (need()) return need();
        const res = applyParl(state, data, me(), { type: "ccr", id: Number(args[0]) });
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "coalition": {
        const res = offerCoalition(state, data, args[0], args[1]);
        return res.ok ? res.message : `error: ${res.error}`;
      }

      case "accept": {
        const res = acceptCoalition(state, data, args[0], args[1]);
        return res.ok ? res.message : `error: ${res.error}`;
      }

      case "events":
        return state.log
          .filter((l) => ["event", "election", "rating", "world"].includes(l.kind))
          .slice(-12)
          .map((l) => `d${l.day} ${l.title}`)
          .join("\n");

      default:
        return `error: comandă necunoscută (${cmd}); scrie help`;
    }
  }

  return { run, room };
}
