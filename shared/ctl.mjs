// Line-based control language over the game engine. Used by the CLI
// (bin/turul-doi-ctl.mjs) and by the local endpoint when TURUL_DOI_CTL=1.
import {
  createGame,
  tick,
  snapshot,
  applyAction,
  offerCoalition,
  acceptCoalition,
  fireEvent,
  runElection,
  ACTIONS,
} from "./engine.mjs";

export const HELP = `turul-doi ctl
  state                     ziua, data, partidul jucat, fonduri
  parties                   partide: id, sondaj, mandate, fonduri, guvern
  poll                      sondaj național pe partide
  counties [filtru]         câștigătorul fiecărui județ
  play <partid> [nume]      joacă pentru un partid (solo/room)
  speed <1|2|4>             viteza ceasului
  act <tip> [judet] [rival] [lege]   acțiune (vezi "actions")
  actions                   acțiunile disponibile
  laws                      legile disponibile
  politicians               profilurile politicienilor
  event <id>                declanșează un eveniment
  tick <zile>               avansează ceasul
  election                  alegeri acum
  coalition <de> <catre>    ofertă de coaliție
  accept <catre> <de>       acceptă oferta
  events                    ultimele evenimente
  help                      acest text`;

export function createCtl(data) {
  const room = { state: createGame(data, { seed: 12345 }) };
  const parties = data.parties.parties;

  function findParty(id) {
    return parties.find((p) => p.id === id)?.id ?? null;
  }

  function fmtPct(v) {
    return `${(v * 100).toFixed(1)}%`;
  }

  function run(line) {
    const raw = String(line ?? "").trim();
    if (!raw) return "";
    const [cmd, ...args] = raw.split(/\s+/);
    const state = room.state;

    switch (cmd) {
      case "help":
        return HELP;

      case "state": {
        const snap = snapshot(state, data);
        const human = state.humans[0] ?? "-";
        const p = human !== "-" ? state.parties[human] : null;
        return [
          `day ${snap.day} (${snap.date})`,
          `election in ${Math.max(0, snap.electionDay - snap.day)} days`,
          `playing ${human}${p ? ` funds ${p.funds} capital ${p.capital}` : ""}`,
          `speed ${snap.speed} events ${snap.log.filter((l) => l.kind === "event").length}`,
        ].join("\n");
      }

      case "parties": {
        const snap = snapshot(state, data);
        return parties
          .map((p) => {
            const s = state.parties[p.id];
            return `${p.id.padEnd(5)} ${fmtPct(snap.parties[p.id].share).padStart(6)} seats ${String(s.seats).padStart(3)} funds ${String(s.funds).padStart(5)}${s.gov ? " GOV" : ""}`;
          })
          .join("\n");
      }

      case "poll": {
        const snap = snapshot(state, data);
        return parties
          .slice()
          .sort((a, b) => snap.poll.national[b.id] - snap.poll.national[a.id])
          .map((p) => `${p.id.padEnd(5)} ${fmtPct(snap.poll.national[p.id])}`)
          .join("\n");
      }

      case "counties": {
        const snap = snapshot(state, data);
        const filter = (args[0] ?? "").toLowerCase();
        return Object.values(state.counties)
          .filter((c) => c.id.includes(filter) || c.name.toLowerCase().includes(filter))
          .map((c) => {
            const top = Object.entries(snap.poll.counties[c.id]).sort((a, b) => b[1] - a[1])[0];
            return `${c.id.padEnd(18)} ${top[0]} ${fmtPct(top[1])}`;
          })
          .join("\n");
      }

      case "play": {
        const id = findParty(args[0]);
        if (!id) return `error: partid necunoscut (${args[0] ?? ""})`;
        state.humans = [id];
        return `playing ${id}`;
      }

      case "speed": {
        const v = Number(args[0]);
        if (![1, 2, 4].includes(v)) return "error: speed 1, 2 sau 4";
        state.speed = v;
        return `speed ${v}`;
      }

      case "actions":
        return ACTIONS.map(
          (a) => `${a.id.padEnd(8)} cost ${String(a.cost).padStart(3)} cd ${a.cooldown} ${a.target}`,
        ).join("\n");

      case "laws":
        return data.laws.laws.map((l) => `${l.id.padEnd(14)} capital ${l.capital}  ${l.name}`).join("\n");

      case "politicians":
        return data.politicians.politicians
          .map((p) => `${p.id.padEnd(10)} ${p.party ?? "-"}  carisma ${p.stats.charisma} corupție ${p.stats.corruption} traseism ${p.stats.traseism}`)
          .join("\n");

      case "act": {
        const type = args[0];
        if (!type) return "error: lipsește tipul acțiunii";
        const action = { type };
        if (["rally", "deal"].includes(type)) action.county = args[1];
        if (type === "attack") {
          action.county = args[1];
          action.targetParty = args[2];
        }
        if (type === "law") action.law = args[1];
        const party = state.humans[0];
        if (!party) return "error: alege un partid cu play <partid>";
        const res = applyAction(state, data, party, action);
        return res.ok ? `ok ${res.message}` : `error: ${res.error}`;
      }

      case "event": {
        const ev = fireEvent(state, data, args[0]);
        return ev ? `event ${ev.id}: ${ev.title}` : "error: eveniment necunoscut";
      }

      case "tick": {
        const n = Number(args[0] ?? 1);
        if (!Number.isFinite(n) || n < 1) return "error: tick <zile>";
        tick(state, data, Math.min(1000, Math.floor(n)));
        return `day ${state.day} (${snapshot(state, data).date})`;
      }

      case "election": {
        runElection(state, data);
        const r = state.lastResult;
        return `winner ${r.winner} gov ${r.gov.join("+")} seats ${r.seats[r.winner]}`;
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
          .filter((l) => l.kind === "event" || l.kind === "election")
          .slice(-10)
          .map((l) => `d${l.day} ${l.title}`)
          .join("\n");

      default:
        return `error: comandă necunoscută (${cmd}); scrie help`;
    }
  }

  return { run, room };
}
