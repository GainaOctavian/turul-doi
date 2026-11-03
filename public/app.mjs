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
  decide,
  fireEvent,
  scenarioOf,
  ACTIONS,
  previewAction,
} from "/shared/engine.mjs";
import { DATA_FILES } from "/shared/data-files.mjs";
import { portrait } from "/portraits.mjs";
import { esc, fmt, share, meur, signed } from "/kit.mjs";
import { SECTIONS, renderView, roleOf, ROLE_LABEL, badges } from "/dash.mjs";
import { presView } from "/parl-ui.mjs";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const S = {
  previews: {},
  data: null,
  map: null,
  mode: "solo",
  scenario: "2026",
  party: "psd",
  name: "",
  room: null,
  taken: {},
  roomScenario: null,
  game: null,
  snap: null,
  selected: "cluj",
  section: "politica",
  sub: { politica: "county", parlament: "votes", partid: "profile", guvern: "overview", tara: "metrics", lume: "compare", stiri: "all" },
  draft: { spend: {}, tax: {} },
  polFilter: "all",
  worldInd: "growth",
  teamAll: false,
  lastTick: 0,
  lastSpeed: 1,
  es: null,
  lastToast: null,
  dismissedResult: null,
  busy: false,
  keys: { topbar: "", ticker: "", decision: "", sections: "" },
};

let partyById = {};
let segById = {};
S.partyById = partyById;
S.segById = segById;

const num = (v) => Math.round(v).toLocaleString("ro-RO");
const pct = (v) => `${((v ?? 0) * 100).toFixed(1).replace(".", ",")}%`;
const color = (id) => partyById[id]?.color ?? "#7a879b";
const pname = (id) => partyById[id]?.name ?? (id ? String(id).toUpperCase() : "Independent");

function fmtDate(iso) {
  return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, file]) => {
      const res = await fetch(`/data/${file}`);
      if (!res.ok) throw new Error(`Nu pot încărca ${file}`);
      return [key, await res.json()];
    }),
  );
  S.data = Object.fromEntries(entries);
  const mapRes = await fetch("/data/romania-map.json");
  if (!mapRes.ok) throw new Error("Nu pot încărca harta");
  S.map = await mapRes.json();

  for (const p of S.data.parties.parties) partyById[p.id] = p;
  for (const s of S.data.segments.segments) segById[s.id] = s;

  const params = new URLSearchParams(location.search);
  if (params.get("scenario") && scenarioOf(S.data, params.get("scenario")).id === params.get("scenario")) {
    S.scenario = params.get("scenario");
  }
  const sc = scenarioOf(S.data, S.scenario);
  S.party = sc.parties.includes(params.get("party")) ? params.get("party") : sc.government.pmParty;

  buildStart();
  buildMap();
  setupEvents();

  // Space pauses and resumes, unless the user is typing in a field.
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !S.snap || e.target.closest("input, select, textarea")) return;
    e.preventDefault();
    togglePause();
  });
}

/* ------------------------------------------------------------- start UI */

const PARTY_BLURB = {
  psd: "Pensiile, primăriile și linia de partid.",
  pnl: "Bugete tăiate și autostrăzi promise.",
  usr: "Orașe, TikTok și reformă.",
  aur: "Piața, steagul și microfonul.",
  udmr: "Coaliții și ministere.",
  sos: "Scandalul ca program de guvernare.",
  pot: "Misterul ca strategie.",
  alde: "Echilibrul de la centru, cu un ochi pe majoritate.",
  pmp: "Vorba directă, fostul președinte și diaspora.",
};

const curScenario = () => scenarioOf(S.data, S.scenario);

function scenarioRole(sc, p) {
  const g = sc.government;
  if (g.pmParty === p) return ["premier", "Partidul premierului"];
  if (g.coalition.includes(p)) return ["guvern", "La guvernare"];
  if (g.support.includes(p)) return ["sprijin", "Sprijin parlamentar"];
  if (!(p in sc.parliament)) return ["extra", "Extraparlamentar"];
  return ["opozitie", "În opoziție"];
}

function buildStart() {
  $("#scenario-grid").innerHTML = S.data.scenarios.scenarios
    .map(
      (sc) => `<button class="scen ${sc.id === S.scenario ? "active" : ""}" data-scenario="${sc.id}">
        <b>${esc(sc.name)}</b><span>${esc(sc.blurb)}</span><em>Start: ${esc(fmtDate(sc.startDate))}</em></button>`,
    )
    .join("");
  renderPartyGrid();
  renderStartFields();
}

function renderPartyGrid() {
  const sc = curScenario();
  const ids = S.roomScenario ? scenarioOf(S.data, S.roomScenario).parties : sc.parties;
  const grid = $("#party-grid");
  grid.innerHTML = ids
    .map((id) => {
      const p = partyById[id];
      const leader = S.data.politicians.politicians.find((x) => x.id === sc.leaders[id]);
      const [role, label] = scenarioRole(sc, id);
      const taken = S.taken[id];
      return `<button class="party-card ${id === S.party ? "active" : ""} ${taken ? "taken" : ""}" data-party="${id}" ${taken ? "disabled" : ""} style="--pc:${p.color}">
        <div class="pc-top"><span class="dot" style="--pc:${p.color}"></span>${esc(p.name)}<span class="role ${role}">${label}</span></div>
        <div class="pc-leader">${esc(leader?.name ?? "Conducere colectivă")}</div>
        <div class="pc-desc">${taken ? `Ocupat de ${esc(taken)}` : esc(PARTY_BLURB[id] ?? p.fullName)}</div>
      </button>`;
    })
    .join("");
}

function renderStartFields() {
  const box = $("#start-fields");
  const btn = $("#start-btn");
  if (S.mode === "solo") {
    box.innerHTML = "";
    btn.textContent = "Începe jocul";
    return;
  }
  const code = $("#room-code")?.value ?? "";
  box.innerHTML = `
    <div class="field"><label for="player-name">Numele tău</label>
      <input id="player-name" placeholder="ex. Octavian" maxlength="20" value="${esc(S.name)}" /></div>
    <div class="field"><label for="room-code">Cod cameră (gol = creezi)</label>
      <input id="room-code" placeholder="ABCD" maxlength="4" style="text-transform:uppercase" value="${esc(code)}" /></div>`;
  btn.textContent = "Intră în joc";
}

async function lookupRoom(code) {
  S.roomScenario = null;
  S.taken = {};
  if (code.length === 4) {
    try {
      const res = await fetch(`/api/rooms/${code}`);
      if (res.ok) {
        const info = await res.json();
        S.roomScenario = info.scenario;
        S.scenario = info.scenario;
        S.taken = info.taken;
        const free = info.partyIds.find((id) => !info.taken[id]);
        if (!info.partyIds.includes(S.party) || info.taken[S.party]) S.party = free ?? S.party;
        $("#start-error").textContent = "";
      } else {
        $("#start-error").textContent = "Cod inexistent.";
      }
    } catch {
      $("#start-error").textContent = "Nu pot contacta serverul.";
    }
  }
  buildStart();
  $("#room-code")?.focus();
}

async function startGame() {
  const err = $("#start-error");
  err.textContent = "";
  if (S.mode === "solo") {
    S.game = createGame(S.data, { seed: Date.now(), humans: [S.party], scenario: S.scenario });
    const params = new URLSearchParams(location.search);
    const skip = Math.max(0, Math.min(1500, Number(params.get("day") || 0)));
    if (skip) tick(S.game, S.data, skip);
    // Debug: ?event=<id> fires one event at the start (for testing decisions).
    if (params.get("event")) fireEvent(S.game, S.data, params.get("event"));
    S.snap = snapshot(S.game, S.data);
    S.lastTick = performance.now();
    showApp();
    return;
  }

  S.name = ($("#player-name")?.value || "Jucător").trim() || "Jucător";
  let code = ($("#room-code")?.value || "").trim().toUpperCase();
  try {
    if (!code) {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: S.scenario }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Nu pot crea camera.");
      code = body.code;
    }
    const res = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, party: S.party, name: S.name }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Nu pot intra în cameră.");
    S.room = code;
    S.mode = "multi";
    connectRoom(code);
    showApp();
  } catch (e) {
    err.textContent = e.message;
  }
}

// The server sends the long history series only once a month, so keep the last copy.
function connectRoom(code) {
  const es = new EventSource(`/api/rooms/${code}/stream?party=${S.party}&name=${encodeURIComponent(S.name)}`);
  S.es = es;
  es.addEventListener("state", (e) => {
    const snap = JSON.parse(e.data);
    if (!snap.gov.hist && S.snap?.gov?.hist) snap.gov.hist = S.snap.gov.hist;
    S.scenario = snap.scenario.id;
    S.snap = snap;
    if (!$("#app").classList.contains("hidden")) render();
  });
  es.addEventListener("error", () => {
    // EventSource reconnects by itself; nothing to do.
  });
}

function showApp() {
  $("#start").classList.add("hidden");
  $("#app").classList.remove("hidden");
  addPins();
  buildTabs();
  render();
  if (S.mode === "solo") setInterval(soloLoop, 200);
}

function soloLoop() {
  if (!S.game || S.game.speed === 0) return;
  const now = performance.now();
  const interval = S.data.config.tickMs / S.game.speed;
  if (now - S.lastTick < interval) return;
  S.lastTick = now;
  tick(S.game, S.data, 1);
  S.snap = snapshot(S.game, S.data);
  render();
}

/* ------------------------------------------------------------------- map */

function buildMap() {
  const svg = $("#map");
  svg.innerHTML = S.map.counties.map((c) => `<path id="c-${c.id}" data-id="${c.id}" d="${c.d}"></path>`).join("");

  svg.addEventListener("click", (e) => {
    const id = e.target?.dataset?.id;
    if (!id) return;
    selectCounty(id);
  });

  const tip = $("#tooltip");
  svg.addEventListener("mousemove", (e) => {
    const id = e.target?.dataset?.id;
    if (!id || !S.snap) {
      tip.classList.add("hidden");
      return;
    }
    const shares = Object.entries(S.snap.poll.counties[id]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    tip.innerHTML = `<b>${esc(S.snap.counties[id].name)}</b>${shares
      .map(([pid, v]) => `<div class="tt-row"><span><span class="dot" style="--pc:${color(pid)}"></span> ${pname(pid)}</span><em>${pct(v)}</em></div>`)
      .join("")}`;
    const box = $(".map-wrap").getBoundingClientRect();
    tip.style.left = `${e.clientX - box.left}px`;
    tip.style.top = `${e.clientY - box.top - 8}px`;
    tip.classList.remove("hidden");
  });
  svg.addEventListener("mouseleave", () => tip.classList.add("hidden"));
}

// Bucharest is a speck inside Ilfov on the map, so it gets a pin you can click.
function addPins() {
  const svg = $("#map");
  if ($("#pin-bucuresti")) return;
  const shape = $("#c-bucuresti");
  if (!shape?.getBBox) return;
  const b = shape.getBBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  svg.insertAdjacentHTML(
    "beforeend",
    `<g class="pin"><circle id="pin-bucuresti" data-id="bucuresti" cx="${cx}" cy="${cy}" r="17"></circle>
     <text x="${cx}" y="${cy + 4}" text-anchor="middle">B</text></g>`,
  );
}

function selectCounty(id) {
  S.selected = id;
  S.section = "politica";
  S.sub.politica = "county";
  render();
}

/* --------------------------------------------------------------- render */

function render() {
  if (!S.snap) return;
  // Merged and split parties live in the snapshot; a merger may also rename mine.
  for (const [id, d] of Object.entries(S.snap.defs ?? {})) partyById[id] = d;
  const to = S.snap.renamed?.[S.party];
  if (to) S.party = to;
  S.partyById = partyById;
  renderTopbar();
  renderSections();
  const politics = S.section === "politica";
  $("#view-politics").classList.toggle("hidden", !politics);
  $("#view-dash").classList.toggle("hidden", politics);
  if (politics) {
    renderMap();
    renderPollStrip();
    renderTabs();
    renderPanel();
  } else {
    renderDash();
  }
  renderTicker();
  renderDecision();
  renderToast();
  renderResult();
}

function setSection(id, sub) {
  S.section = id;
  if (sub) S.sub[id] = sub;
  S.draft = { spend: {}, tax: {} };
  render();
}

function renderSections() {
  const b = badges(S);
  const html = SECTIONS.map(
    (s) =>
      `<button class="secbtn ${S.section === s.id ? "active" : ""}" data-sec="${s.id}" style="--sec:${s.color}"><i></i>${s.name}${b[s.id] ? `<em>${b[s.id]}</em>` : ""}</button>`,
  ).join("");
  if (html === S.keys.sections) return;
  S.keys.sections = html;
  $("#sections").innerHTML = html;
}

function renderTopbar() {
  const s = S.snap;
  const party = s.parties[S.party];
  const daysLeft = Math.max(0, s.electionDay - s.day);
  const role = roleOf(S, S.party);
  const paused = s.speed === 0;
  const html = `
    <div class="tb-brand"><div class="flag"><i></i><i></i><i></i></div>TURUL DOI</div>
    <div class="tb-date"><b>${fmtDate(s.date)}</b><span title="${esc(s.scenario.name)}">${s.scenario.year} · alegeri în ${num(daysLeft)} zile</span></div>
    <div class="speeds">
      <button data-toggle-pause class="${paused ? "active" : ""}" title="Pauză / reia (Space)">${paused ? "▶ Reia" : "❚❚ Pauză"}</button>
      ${[1, 2, 4].map((v) => `<button data-speed="${v}" class="${s.speed === v ? "active" : ""}">${v}x</button>`).join("")}
    </div>
    <div class="spacer"></div>
    <span class="chip role ${role}" title="${esc(ROLE_LABEL[role])}">${esc(ROLE_LABEL[role])}</span>
    <span class="chip"><span class="dot" style="--pc:${color(S.party)}"></span>${esc(pname(S.party))} · <b>${fmt(party?.funds ?? 0, 1)}</b> M€</span>
    <span class="chip" title="Capital politic: se cheltuie pe politici și remanieri">Capital <b>${num(party?.capital ?? 0)}</b></span>
    <span class="chip">Mandate <b>${num(party?.seats ?? 0)}</b></span>
    ${S.room ? playersChips(s) : ""}
    ${S.room ? `<button class="chip room-chip" data-copy-room title="Copiază codul ca să intre și ceilalți">Cod cameră <b class="room-code">${esc(S.room)}</b> ⧉</button>` : ""}
  `;
  if (html === S.keys.topbar) return;
  S.keys.topbar = html;
  $("#topbar").innerHTML = html;
}

function playersChips(s) {
  return Object.entries(s.players ?? {})
    .map(
      ([pid, name]) =>
        `<span class="chip ${pid === S.party ? "me" : ""}" title="${esc(pname(pid))}"><span class="dot" style="--pc:${color(pid)}"></span>${esc(name)}</span>`,
    )
    .join("");
}

function setSpeed(v) {
  if (v > 0) S.lastSpeed = v;
  if (S.mode === "solo") {
    S.game.speed = v;
    S.snap.speed = v;
    renderTopbar();
  } else {
    post(`/api/rooms/${S.room}/speed`, { party: S.party, speed: v });
  }
}

function togglePause() {
  if (!S.snap) return;
  setSpeed(S.snap.speed === 0 ? S.lastSpeed : 0);
}

async function copyRoomCode() {
  try {
    await navigator.clipboard.writeText(S.room);
    toast("Cod copiat", `Trimite-le celorlalți codul ${S.room}.`);
  } catch {
    toast("Cod cameră", `Codul este ${S.room}.`);
  }
}

function renderMap() {
  const s = S.snap;
  for (const c of S.map.counties) {
    const path = document.getElementById(`c-${c.id}`);
    if (!path) continue;
    const shares = s.poll.counties[c.id];
    const [pid, sh] = Object.entries(shares).sort((a, b) => b[1] - a[1])[0];
    path.setAttribute("fill", color(pid));
    path.setAttribute("fill-opacity", String(Math.min(0.95, 0.42 + sh * 0.9)));
    path.classList.toggle("selected", c.id === S.selected);
    if (c.id === "bucuresti") {
      const pin = $("#pin-bucuresti");
      if (pin) {
        pin.setAttribute("fill", color(pid));
        pin.classList.toggle("selected", c.id === S.selected);
      }
    }
  }

  const leaders = {};
  for (const c of Object.values(s.counties)) {
    const [pid] = Object.entries(s.poll.counties[c.id]).sort((a, b) => b[1] - a[1])[0];
    leaders[pid] = (leaders[pid] ?? 0) + 1;
  }
  $("#map-legend").innerHTML = Object.entries(leaders)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, n]) => `<span><span class="dot" style="--pc:${color(pid)}"></span>${pname(pid)} ${n}</span>`)
    .join("");

  const c = s.counties[S.selected];
  if (c) $("#map-sub").textContent = `${c.name} · ${num(c.pop)} mii locuitori · click pe hartă sau alege din listă`;
}

function renderPollStrip() {
  const rows = Object.entries(S.snap.poll.national).sort((a, b) => b[1] - a[1]);
  $("#poll-strip").innerHTML = rows
    .map(
      ([pid, v]) => `<div class="poll-mini">
        <div class="pm-top"><span class="dot" style="--pc:${color(pid)}"></span>${pname(pid)}</div>
        <b>${pct(v)}</b>
        <div class="bar"><i style="--pc:${color(pid)};width:${(v * 100).toFixed(1)}%"></i></div>
      </div>`,
    )
    .join("");
}

/* ---------------------------------------------------------- side panels */

const POLITICS_TABS = SECTIONS.find((s) => s.id === "politica").subs;

function buildTabs() {
  $("#tabs").innerHTML = POLITICS_TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join("");
}

function renderTabs() {
  $$("#tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === S.sub.politica));
}

// Re-renders an element only when its HTML changed, and keeps scroll, selects and
// <details> state. It never swaps the DOM under a pressed button or an open dropdown.
function makePatcher(el, onDirty) {
  const st = { html: "", key: "", dirty: false };
  const run = (html, key) => {
    const active = document.activeElement;
    const picking = el.contains(active) && active.matches("select, input[type=text], input[type=number]");
    if (S.busy || picking) {
      st.dirty = true;
      return false;
    }
    if (html === st.html && key === st.key) return true;
    const same = key === st.key;
    const top = same ? el.scrollTop : 0;
    const picks = {};
    // Selects driven by game state (data-live) are not restored from the old DOM.
    $$("select", el).forEach((s) => s.id && !s.dataset.live && (picks[s.id] = s.value));
    $$("input[type=text]", el).forEach((s) => s.id && (picks[s.id] = s.value));
    const open = $$("details", el).map((d) => d.open);
    el.innerHTML = html;
    for (const [id, v] of Object.entries(picks)) {
      const s = document.getElementById(id);
      if (s) s.value = v;
    }
    if (same) $$("details", el).forEach((d, i) => open[i] != null && (d.open = open[i]));
    el.scrollTop = top;
    st.html = html;
    st.key = key;
    st.dirty = false;
    return true;
  };
  run.state = st;
  run.onDirty = onDirty;
  return run;
}

let patchPanel;
let patchDash;

function renderPanel() {
  const fn = { county: panelCounty, actions: panelActions, poll: panelPoll, team: panelTeam }[S.sub.politica];
  patchPanel ??= makePatcher($("#panel"));
  patchPanel(fn ? fn() : "", `${S.sub.politica}|${S.selected}|${S.teamAll}`);
}

function renderDash() {
  const sec = SECTIONS.find((s) => s.id === S.section);
  const view = $("#view-dash");
  view.style.setProperty("--sec", sec.color);
  view.dataset.sec = sec.id;
  const sub = S.sub[sec.id];
  const tabs = sec.subs
    .map(([id, label]) => `<button data-do="go" data-sec="${sec.id}" data-sub="${id}" class="${id === sub ? "active" : ""}">${label}</button>`)
    .join("");
  const bar = $("#subtabs");
  if (bar.dataset.k !== `${sec.id}|${sub}`) {
    bar.innerHTML = tabs;
    bar.dataset.k = `${sec.id}|${sub}`;
  }
  patchDash ??= makePatcher($("#dash-body"));
  patchDash(renderView(S, sec.id, sub), `${sec.id}|${sub}|${S.worldInd}|${S.polFilter}`);
}

function panelCounty() {
  const s = S.snap;
  const c = s.counties[S.selected];
  if (!c) return "";
  const shares = Object.entries(s.poll.counties[S.selected]).sort((a, b) => b[1] - a[1]);
  const total = Object.values(c.segments).reduce((a, b) => a + b, 0);
  const segs = S.data.segments.segments
    .map((seg) => ({ ...seg, size: c.segments[seg.id] ?? 0 }))
    .sort((a, b) => b.size - a.size);
  const party = s.parties[S.party];
  const counties = Object.values(s.counties).sort((a, b) => a.name.localeCompare(b.name, "ro"));

  return `
    <div class="field inline"><label for="county-pick">Județ</label>
      <select id="county-pick" class="sel" data-live="1">${counties.map((x) => `<option value="${x.id}" ${x.id === S.selected ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
    <div class="card">
      <div class="row between"><h4>${esc(c.name)}</h4><span class="muted">${num(c.pop)} mii locuitori</span></div>
      <div class="muted" style="font-size:12px;margin-top:2px">Conduce ${pname(shares[0][0])} cu ${pct(shares[0][1])}</div>
      <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
        ${shares.slice(0, 4).map(([pid, v]) => `<span class="chip" style="padding:4px 9px;font-size:11px"><span class="dot" style="--pc:${color(pid)}"></span>${pname(pid)} ${pct(v)}</span>`).join("")}
      </div>
    </div>

    <h3>Segmente de votanți</h3>
    ${segs
      .map(
        (seg) => `<div class="seg-row" title="${esc(segTip(seg.id))}">
          <div>
            <div class="seg-name"><span style="color:var(--text)">${esc(seg.name)}</span><span>${pct(seg.size / total)}</span></div>
            <div class="bar"><i style="--pc:${seg.color};width:${((seg.size / total) * 100).toFixed(1)}%"></i></div>
          </div>
          <div class="seg-val">${num(seg.size)}</div>
        </div>`,
      )
      .join("")}

    <h3>Acțiuni în ${esc(c.name)}</h3>
    ${ACTIONS.filter((a) => a.target === "county" || a.target === "county-party")
      .map((a) => {
        const status = actionStatus(party, a);
        return `<div class="action-card">
          <div class="ac-name">${a.name}</div>
          <div class="ac-desc">${a.desc}</div>
          <div class="ac-meta">${fmt(a.cost, 1)} M€ · ${status}</div>
          <button data-quick="${a.id}" ${status === "pregătit" ? "" : "disabled"}>Fă</button>
        </div>`;
      })
      .join("")}
    <div class="row" style="margin-top:4px;gap:8px">
      <span class="muted" style="font-size:12px">Rival pentru atac</span>
      <select id="rival" class="grow sel">${s.partyIds.filter((id) => id !== S.party).map((id) => `<option value="${id}">${esc(pname(id))}</option>`).join("")}</select>
    </div>
  `;
}

// Who may use an action: opposition actions need an opposition party, outside ones need no seats.
function needStatus(s, party, a) {
  if (a.need === "opp" && s.gov.gov.coalition.includes(S.party)) return "doar opoziția";
  if (a.need === "outside" && party.seats > 0) return "doar fără mandate";
  return null;
}

// Estimated effect of an action: solo runs the engine locally, multiplayer asks the server.
function estimateFor(a) {
  const c = S.selected;
  const rival = $("#rival")?.value ?? null;
  const action = {
    type: a.id,
    county: a.target === "county" || a.target === "county-party" ? c : undefined,
    targetParty: a.target === "party" ? rival : undefined,
  };
  if (S.mode === "solo" && S.game) return previewAction(S.game, S.data, S.party, action);
  const key = `${S.party}|${a.id}|${action.county ?? ""}|${action.targetParty ?? ""}|${Math.floor(S.snap.day / 3)}`;
  if (!S.previews[key]) {
    S.previews[key] = { pending: true };
    post(`/api/rooms/${S.room}/preview`, { party: S.party, action }).then((res) => {
      S.previews[key] = res;
      renderPanel();
    });
  }
  return S.previews[key].pending ? null : S.previews[key];
}

function estimateHtml(est, a) {
  if (!est) return `<span class="muted">Se calculează efectul…</span>`;
  if (!est.ok) return `<span class="muted">${esc(est.error)}</span>`;
  const own = est.national[S.party] ?? 0;
  const segs = est.segs
    .filter((x) => Math.abs(x.own) >= 0.05)
    .sort((x, y) => Math.abs(y.own) - Math.abs(x.own))
    .slice(0, 3)
    .map((x) => `${esc(segName(x.seg))} ${signed(x.own, 1)} pp`);
  const rivalId = a.target === "party" ? $("#rival")?.value : null;
  const rival = rivalId ? `${esc(pname(rivalId))} ${signed(est.national[rivalId] ?? 0, 1)} pp în sondaj` : "";
  return `<b>Tu ${signed(own, 1)} pp în sondaj</b>${segs.length ? ` · ${segs.join(" · ")}` : ""}${rival ? ` · ${rival}` : ""}`;
}

function segName(id) {
  return S.data.segments.segments.find((x) => x.id === id)?.name ?? id;
}

// Hover on a voter group: who has it now, who gained or lost since last month, and recent causes.
function segTip(segId) {
  const s = S.snap;
  const sh = s.segShares?.[segId] ?? {};
  const prev = s.segPrev?.[segId] ?? {};
  const rows = Object.entries(sh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p, v]) => {
      const d = (v - (prev[p] ?? v)) * 100;
      return `${pname(p)} ${(v * 100).toFixed(1)}% (${d >= 0 ? "+" : ""}${d.toFixed(1)} pp de la luna trecută)`;
    });
  const causes = (s.causes ?? [])
    .filter((x) => x.seg === segId)
    .slice(-3)
    .reverse()
    .map((x) => `${x.text} (${x.v > 0 ? "+" : ""}${(x.v * 100).toFixed(1)}%, ziua ${x.day})`);
  return `${rows.join("\n")}\n${causes.length ? "De ce:\n" + causes.join("\n") : "Nicio schimbare recentă."}`;
}

// Why a campaign action can't be used right now, or "pregătit" when it can.
function actionStatus(party, a) {
  const cd = party.cooldown[a.id] ?? -1;
  if (cd > S.snap.day) return `din ziua ${cd}`;
  if (party.funds < a.cost) return "fonduri insuficiente";
  return "pregătit";
}

function panelActions() {
  const s = S.snap;
  const party = s.parties[S.party];
  const c = s.counties[S.selected];
  const daysLeft = Math.max(0, s.electionDay - s.day);
  return `
    <h3>Campanie</h3>
    <p class="hint">Efectul campaniei se estompează în câteva săptămâni, deci contează cel mai mult în ultimele luni dinaintea alegerilor (${num(daysLeft)} de zile rămase). Banii vin din finanțarea partidului și donații.</p>
    <p class="hint"><b>pp</b> = puncte procentuale din votanții categoriei (sau din sondajul național). „Efect estimat” e calculat din starea jocului, fără să cheltuiască nimic.</p>
    ${ACTIONS.map((a) => {
      const status = needStatus(s, party, a) ?? actionStatus(party, a);
      const target = a.target === "county" || a.target === "county-party" ? ` · ${esc(c?.name ?? "")}` : a.target === "party" ? ` · ${esc(pname($("#rival")?.value ?? ""))}` : "";
      const est = estimateFor(a);
      return `<div class="action-card" data-need="${a.need ?? "any"}">
        <div class="ac-name">${a.name}${target}</div>
        <div class="ac-desc">${a.desc}</div>
        <div class="ac-meta">${fmt(a.cost, 1)} M€ · ${status}</div>
        <div class="ac-est">${estimateHtml(est, a)}</div>
        <button data-act="${a.id}" ${status === "pregătit" ? "" : "disabled"}>Fă</button>
      </div>`;
    }).join("")}
    <div class="card">
      <div class="row between"><span class="muted">Rival pentru atac</span></div>
      <select id="rival" class="sel" style="width:100%;margin-top:6px">${s.partyIds.filter((id) => id !== S.party).map((id) => `<option value="${id}">${esc(pname(id))}</option>`).join("")}</select>
    </div>
    <p class="hint">Politicile de guvernare (buget, taxe, legi) sunt la secțiunea <b>Guvern</b>.</p>
  `;
}

function panelPoll() {
  const s = S.snap;
  const rows = Object.entries(s.poll.national).sort((a, b) => b[1] - a[1]);
  const mySeats = s.parties[S.party].seats;
  const coalition = s.coalitions
    .map(
      (c) =>
        `<div class="row between"><span>${c.parties.map(pname).join(" + ")}</span><b>${num(c.parties.reduce((sum, id) => sum + (s.parties[id].seats ?? 0), 0))}</b></div>`,
    )
    .join("");
  const offers = s.offers
    .map(
      (o) =>
        `<div class="row between" style="margin-bottom:6px">
          <span>${pname(o.from)} → ${pname(o.to)}</span>
          ${o.to === S.party ? `<button class="btn gold" data-accept="${o.from}">Acceptă</button>` : ""}
        </div>`,
    )
    .join("");
  const total = 330;
  const listOf = (id) => s.lists.find((l) => l.parties.includes(id));

  return `
    ${roadCard()}
    ${presView(S)}
    <h3>Sondaj național</h3>
    ${rows
      .map(([pid, v]) => {
        const l = listOf(pid);
        return `<div style="margin-bottom:9px">
          <div class="row between" style="font-size:12px"><span><span class="dot" style="--pc:${color(pid)}"></span> ${pname(pid)}${l && !l.passes ? ` <span class="below">sub prag</span>` : ""}</span><b>${pct(v)}</b></div>
          <div class="bar" style="margin-top:3px"><i style="--pc:${color(pid)};width:${Math.min(100, v * 300).toFixed(1)}%"></i></div>
        </div>`;
      })
      .join("")}


    <h3>Mandate (${total}, majoritatea 166)</h3>
    <div class="card">
      ${Object.entries(s.poll.seats)
        .sort((a, b) => b[1] - a[1])
        .filter(([, n]) => n > 0)
        .map(
          ([pid, n]) => `<div class="seat-row"><span class="sr-name" style="color:${color(pid)}">${pname(pid)}</span>
            <div class="bar"><i style="--pc:${color(pid)};width:${((n / total) * 100).toFixed(1)}%"></i></div>
            <span class="sr-num">${n}</span></div>`,
        )
        .join("")}
      <div class="seat-row"><span class="sr-name" style="color:#8d99ae">Minorități</span>
        <div class="bar"><i style="--pc:#8d99ae;width:${((s.minoritySeats / total) * 100).toFixed(1)}%"></i></div>
        <span class="sr-num">${s.minoritySeats}</span></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">Partidul tău: ${num(mySeats)} mandate în Parlamentul actual. Sondajul arată cum s-ar împărți mandatele la alegerile de azi.</div>
    </div>

    <h3>Coaliție</h3>
    <div class="coalition-box">
      ${
        s.coalitions.length
          ? coalition
          : `<span class="muted">${s.negotiation ? "Negocieri în curs." : "Guvernul actual: " + s.gov.gov.coalition.map(pname).join(" + ") + "."}</span>`
      }
    </div>
    ${offers ? `<div class="card">${offers}</div>` : ""}
    <div class="card">
      <div class="row" style="gap:8px">
        <select id="coalition-target" class="sel" style="flex:1">
          ${s.partyIds.filter((id) => id !== S.party).map((id) => `<option value="${id}">${esc(pname(id))}</option>`).join("")}
        </select>
        <button class="btn" data-coalition="1">Ofertă</button>
      </div>
      <p class="muted" style="font-size:11px;margin:8px 0 0">Ofertele de coaliție contează în perioada de negocieri după alegeri sau după căderea unui guvern.</p>
    </div>
  `;
}

// Where a party that is below the threshold stands, and how it can get in.
function roadCard() {
  const s = S.snap;
  const l = s.lists.find((x) => x.parties.includes(S.party));
  if (!l || l.passes) return "";
  const left = Math.max(0, s.electionDay - s.day);
  const gap = Math.max(0, l.need - l.share);
  return `<div class="card road">
    <div class="road-h"><b>Drumul spre Parlament</b><span>${num(left)} zile până la alegeri</span></div>
    <div class="road-bar"><i style="width:${Math.min(100, (l.share / l.need) * 100).toFixed(1)}%"></i><u></u></div>
    <div class="road-n"><b>${pct(l.share)}</b> din ${pct(l.need)} necesar${l.parties.length > 1 ? " (alianță)" : ""} · mai lipsesc ${pct(gap)}</div>
    <div class="road-n">Sau 20% în patru județe: ${l.strongCounties} din 4 până acum.</div>
    <p class="muted" style="font-size:11.5px;margin:6px 0 0">Campania, deciziile și fuziunile cu partide asemănătoare (tabul Partid) te pot duce peste prag. Sub prag, voturile nu dau mandate.</p>
  </div>`;
}

const STAT_LABELS = [
  ["Carismă", "charisma"],
  ["Răbdare", "patience"],
  ["Maleabilitate", "malleability"],
  ["Gafe", "gaffes"],
  ["Vizibilitate", "visibility"],
  ["Corupție", "corruption"],
  ["Traseism", "traseism"],
];

function politicianCard(p, open) {
  const col = color(p.party ?? S.party);
  return `<div class="politician">
    <div class="pol-head">
      <div class="portrait">${portrait(p.look, { label: p.name })}</div>
      <div class="grow">
        <div class="pol-top"><b>${esc(p.name)}</b>
          ${p.party ? `<span class="chip tiny"><span class="dot" style="--pc:${color(p.party)}"></span>${pname(p.party)}</span>` : `<span class="chip tiny">independent</span>`}</div>
        <div class="pol-role">${esc(p.role)}</div>
        ${p.ability ? `<div class="ability"><b>${esc(p.ability.name)}</b> — ${esc(p.ability.text)}</div>` : ""}
      </div>
    </div>
    <details ${open ? "open" : ""}>
      <summary>Statistici și fapte</summary>
      <div class="stats">
        ${STAT_LABELS.map(
          ([label, key]) => `<div class="stat">
            <div class="st-top"><span>${label}</span><b>${p.stats[key]}</b></div>
            <div class="bar" style="height:3px"><i style="--pc:${col};width:${p.stats[key]}%"></i></div>
          </div>`,
        ).join("")}
      </div>
      <div class="facts">
        ${(Array.isArray(p.facts) ? p.facts : []).map((f) => `<div>${esc(f)}</div>`).join("")}
      </div>
    </details>
  </div>`;
}

function panelTeam() {
  const s = S.snap;
  const leaderId = s.leaders[S.party];
  const all = Object.values(s.politicians);
  const mine = all.filter((p) => p.party === S.party).sort((a, b) => (a.id === leaderId ? -1 : b.id === leaderId ? 1 : 0));
  const order = s.partyIds;
  const everyone = all
    .slice()
    .sort((a, b) => order.indexOf(a.party ?? "~") - order.indexOf(b.party ?? "~") || a.name.localeCompare(b.name, "ro"));
  const list = S.teamAll ? everyone : mine;

  return `
    <div class="row between">
      <h3 style="margin:0">${S.teamAll ? "Toți politicienii" : `${pname(S.party)} · echipa`}</h3>
      <button class="btn ghost" data-team-toggle>${S.teamAll ? "Echipa mea" : `Toți (${all.length})`}</button>
    </div>
    <p class="muted" style="font-size:11.5px;margin:6px 0 10px">Liderul contează integral în campanie; ceilalți membri adaugă o treime din abilitatea lor. Miniștrii influențează cât de bine folosește ministerul banii.</p>
    ${list.map((p) => politicianCard(p, !S.teamAll && p.id === leaderId)).join("")}
    <p class="muted" style="font-size:11px">Statisticile de joc sunt estimări. Portretele sunt caricaturi desenate în cod.</p>
  `;
}

/* -------------------------------------------------------------- events */

// Buttons react on pointerdown, not click, so a re-render between press and
// release can't swallow the press. Keyboard activation still arrives as click.
function onPress(root, selector, handler) {
  const run = (e) => {
    const el = e.target.closest?.(selector);
    if (!el || !root.contains(el) || el.disabled) return;
    handler(el, e);
  };
  root.addEventListener("pointerdown", (e) => {
    if (e.button === 0) run(e);
  });
  root.addEventListener("click", (e) => {
    if (e.detail === 0) run(e);
  });
}

function setupEvents() {
  $("#scenario-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-scenario]");
    if (!btn || S.roomScenario) return;
    S.scenario = btn.dataset.scenario;
    const sc = curScenario();
    if (!sc.parties.includes(S.party)) S.party = sc.government.pmParty;
    buildStart();
  });
  $("#party-grid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-party]");
    if (!card || card.disabled) return;
    S.party = card.dataset.party;
    renderPartyGrid();
  });
  $$(".mode").forEach((btn) =>
    btn.addEventListener("click", () => {
      S.mode = btn.dataset.mode;
      S.roomScenario = null;
      S.taken = {};
      $$(".mode").forEach((b) => b.classList.toggle("active", b === btn));
      buildStart();
    }),
  );
  $("#start-fields").addEventListener("input", (e) => {
    if (e.target.id === "player-name") S.name = e.target.value;
    if (e.target.id === "room-code") {
      e.target.value = e.target.value.toUpperCase();
      lookupRoom(e.target.value);
    }
  });
  $("#start-btn").addEventListener("click", startGame);

  const top = $("#topbar");
  onPress(top, "[data-toggle-pause]", togglePause);
  onPress(top, "[data-speed]", (el) => setSpeed(Number(el.dataset.speed)));
  onPress(top, "[data-copy-room]", copyRoomCode);

  onPress($("#sections"), "[data-sec]", (el) => setSection(el.dataset.sec));
  onPress($("#tabs"), "[data-tab]", (el) => {
    S.sub.politica = el.dataset.tab;
    renderTabs();
    renderPanel();
  });
  $("#panel").addEventListener("change", (e) => {
    if (e.target.id === "county-pick") selectCounty(e.target.value);
  });

  const panel = $("#panel");
  // The Cotroceni card in Sondaj uses the same buttons as the Parlament screen.
  onPress(panel, "[data-do]", (el) => {
    const d = el.dataset.do;
    if (d === "pres-run") parlDo({ type: "pres-run" });
    if (d === "pres-back") parlDo({ type: "pres-back", target: el.dataset.target });
    if (d === "ccr") parlDo({ type: "ccr", id: Number(el.dataset.id) });
  });
  onPress(panel, "[data-quick]", (el) => {
    const type = el.dataset.quick;
    const action = { type, county: S.selected };
    if (type === "attack") action.targetParty = $("#rival")?.value;
    doAction(action);
  });
  onPress(panel, "[data-act]", (el) => {
    const type = el.dataset.act;
    const action = { type };
    if (["rally", "deal", "protest", "foundation"].includes(type)) action.county = S.selected;
    if (type === "attack") {
      action.county = S.selected;
      action.targetParty = $("#rival")?.value;
    }
    if (type === "exposure") action.targetParty = $("#rival")?.value;
    doAction(action);
  });
  onPress(panel, "[data-accept]", async (el) => {
    const from = el.dataset.accept;
    if (S.mode === "solo") {
      const res = acceptCoalition(S.game, S.data, S.party, from);
      if (res.ok) refreshSolo();
      toast(res.ok ? "Coaliție" : "Nu se poate", res.ok ? res.message : res.error);
    } else {
      const res = await post(`/api/rooms/${S.room}/accept`, { party: S.party, from });
      if (!res.ok) toast("Nu se poate", res.error);
    }
  });
  onPress(panel, "[data-coalition]", async () => {
    const to = $("#coalition-target")?.value;
    if (!to) return;
    if (S.mode === "solo") {
      const res = offerCoalition(S.game, S.data, S.party, to);
      if (res.ok) refreshSolo();
      toast(res.ok ? "Ofertă trimisă" : "Nu se poate", res.ok ? res.message : res.error);
    } else {
      const res = await post(`/api/rooms/${S.room}/coalition`, { party: S.party, to });
      if (!res.ok) toast("Nu se poate", res.error);
    }
  });
  onPress(panel, "[data-team-toggle]", () => {
    S.teamAll = !S.teamAll;
    renderPanel();
  });

  setupDash();

  onPress($("#decision"), "[data-decide]", (el) => answerDecision(Number(el.dataset.decision), Number(el.dataset.decide)));
  onPress($("#modal"), "#close-result", () => {
    S.dismissedResult = S.snap.lastResult?.day;
    $("#modal").classList.add("hidden");
  });

  // Hold the panels still while a button is pressed or a slider is dragged,
  // then catch up with whatever changed in the meantime.
  const release = () => {
    S.busy = false;
    if (S.snap) {
      if (patchPanel?.state.dirty) renderPanel();
      if (patchDash?.state.dirty) renderDash();
    }
  };
  for (const id of ["#panel", "#dash-body"]) $(id).addEventListener("pointerdown", () => (S.busy = true));
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
  for (const id of ["#panel", "#dash-body"]) $(id).addEventListener("focusout", () => setTimeout(release, 0));
}

function refreshSolo() {
  S.snap = snapshot(S.game, S.data);
  render();
}

/* ------------------------------------------------------ dashboard events */

async function govDo(action) {
  let res;
  if (S.mode === "solo") {
    res = applyGov(S.game, S.data, S.party, action);
    if (res.ok) refreshSolo();
  } else {
    res = await post(`/api/rooms/${S.room}/gov`, { party: S.party, action });
  }
  toast(res.ok ? "Guvern" : "Nu se poate", res.ok ? res.message : res.error);
  return res;
}

async function parlDo(action) {
  let res;
  if (S.mode === "solo") {
    res = applyParl(S.game, S.data, S.party, action);
    const renamed = consumeRenamed(S.game);
    if (renamed[S.party]) S.party = renamed[S.party];
    if (res.ok) refreshSolo();
  } else {
    res = await post(`/api/rooms/${S.room}/parl`, { party: S.party, action });
    if (res.renamed?.[S.party]) S.party = res.renamed[S.party];
  }
  toast(res.ok ? "Parlament" : "Nu se poate", res.ok ? res.message : res.error);
  return res;
}

function setupDash() {
  const dash = $("#view-dash");
  const g = () => S.snap.gov;
  const HANDLERS = {
    go: (el) => setSection(el.dataset.sec, el.dataset.sub),
    "pol-filter": (el) => {
      S.polFilter = el.dataset.m;
      renderDash();
    },
    "world-ind": (el) => {
      S.worldInd = el.dataset.ind;
      renderDash();
    },
    "spend-apply": async (el) => {
      const line = el.dataset.line;
      const cur = Math.round(g().budget.ratio[line] * g().macro.gdp);
      const amount = S.draft.spend[line] ?? cur;
      const res = await govDo({ type: "setSpend", line, amount });
      if (res.ok) delete S.draft.spend[line];
    },
    "tax-step": (el) => {
      const t = S.data.government.taxes.find((x) => x.id === el.dataset.tax);
      const cur = S.draft.tax[t.id] ?? g().budget.tax[t.id];
      S.draft.tax[t.id] = Math.max(t.min, Math.min(t.max, cur + Number(el.dataset.dir)));
      renderDash();
    },
    "tax-apply": async (el) => {
      const tax = el.dataset.tax;
      const res = await govDo({ type: "setTax", tax, rate: S.draft.tax[tax] });
      if (res.ok) delete S.draft.tax[tax];
    },
    "policy-on": (el) => govDo({ type: "policy", id: el.dataset.id, on: true }),
    "policy-off": (el) => govDo({ type: "policy", id: el.dataset.id, on: false }),
    appoint: (el) => govDo({ type: "appoint", ministry: el.dataset.m, politician: $(`#appoint-${el.dataset.m}`)?.value }),
    answer: (el) => govDo({ type: "answer", id: Number(el.dataset.id), accept: el.dataset.accept === "1" }),
    motion: () => parlDo({ type: "motion" }),
    "pres-run": () => parlDo({ type: "pres-run" }),
    "pres-back": (el) => parlDo({ type: "pres-back", target: el.dataset.target }),
    ccr: (el) => parlDo({ type: "ccr", id: Number(el.dataset.id) }),
    "parl-motion": () => parlDo({ type: "motion" }),
    "parl-vote": (el) => parlDo({ type: "vote", id: Number(el.dataset.id), vote: el.dataset.vote }),
    "parl-amend": (el) => parlDo({ type: "amend", id: Number(el.dataset.id) }),
    "parl-lobby": (el) => parlDo({ type: "lobby", id: Number(el.dataset.id), target: $(`#lt-${el.dataset.id}`)?.value, how: $(`#lh-${el.dataset.id}`)?.value, against: $(`#lg-${el.dataset.id}`)?.value === "against" }),
    "parl-bill": (el) => parlDo({ type: "bill", bill: el.dataset.id }),
    courtesy: (el) => parlDo({ type: "courtesy", target: el.dataset.target }),
    pact: (el) => parlDo({ type: "merge", target: el.dataset.target, mode: "pact" }),
    "shift-seg": (el) => parlDo({ type: "shift", segment: el.dataset.seg }),
    "shift-lean": (el) => parlDo({ type: "shift", lean: Number(el.dataset.dir) }),
    "merge-offer": () => parlDo({ type: "merge", target: $("#merge-t")?.value, mode: $("#merge-m")?.value, name: $("#merge-n")?.value }),
    "merge-answer": (el) => parlDo({ type: "merge-answer", from: el.dataset.from, accept: el.dataset.accept === "1" }),
    "split-go": () => parlDo({ type: "split", frac: Number($("#split-f")?.value), template: $("#split-t")?.value || undefined, name: $("#split-n")?.value }),
    support: (el) => govDo({ type: "support", on: el.dataset.on === "1" }),
    "decision-focus": () => toast("Decizie", "Răspunde în caseta de jos."),
  };
  onPress(dash, "[data-do]", (el) => HANDLERS[el.dataset.do]?.(el));

  // Sliders update their labels while dragged and only commit on "Aplică".
  dash.addEventListener("input", (e) => {
    const line = e.target.dataset?.slider;
    if (!line) return;
    const v = Number(e.target.value);
    S.draft.spend[line] = v;
    const base = S.snap.gov.budget.flows.base[line];
    const d = base ? ((v - base) / base) * 100 : 0;
    const val = $(`[data-draft-val="${line}"]`, dash);
    const delta = $(`[data-draft-delta="${line}"]`, dash);
    if (val) val.textContent = fmt(v);
    if (delta) {
      delta.textContent = Math.abs(d) > 0.5 ? `${signed(d, 0)}% față de bază` : "la nivelul de bază";
      delta.className = d > 0.5 ? "up" : d < -0.5 ? "down" : "";
    }
  });
}

/* ------------------------------------------------------- ticker, toasts */

function renderTicker() {
  const news = [...S.snap.log]
    .reverse()
    .filter((l) => ["event", "election", "decision", "rating", "world", "budget"].includes(l.kind))
    .slice(0, 8)
    .map((l) => `<em>${esc(l.title)}</em> ${esc(l.text)}`);
  const text = news.length ? news.join('<i class="sep">●</i>') : "Guvernarea abia a început. Primele decizii contează.";
  const html = `<b class="live"><i></i>LIVE</b><div class="marquee"><span style="--dur:${Math.max(45, Math.round(text.length / 6))}s">${text}</span></div>`;
  if (html === S.keys.ticker) return;
  S.keys.ticker = html;
  $("#ticker").innerHTML = html;
}

function renderToast() {
  const s = S.snap;
  if (!s.active) return;
  const key = `${s.active.day}-${s.active.id}`;
  if (S.lastToast === key) return;
  S.lastToast = key;
  const box = $("#toast");
  box.innerHTML = `<div class="t-kicker">Breaking news · ziua ${s.active.day}</div>
    <div class="t-title">${esc(s.active.title)}</div>
    <div class="t-text">${esc(s.active.text)}</div>`;
  box.classList.remove("hidden");
  clearTimeout(renderToast.timer);
  renderToast.timer = setTimeout(() => box.classList.add("hidden"), 7000);
}

function renderResult() {
  const s = S.snap;
  const r = s.lastResult;
  const modal = $("#modal");
  if (!r || s.day > s.resultUntil || S.dismissedResult === r.day) {
    modal.classList.add("hidden");
    return;
  }
  const rows = Object.entries(r.seats).sort((a, b) => b[1] - a[1]);
  const key = `r${r.day}`;
  if (modal.dataset.k === key && !modal.classList.contains("hidden")) return;
  modal.dataset.k = key;
  modal.innerHTML = `<div class="modal-card">
    <div class="muted" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase">Rezultat · ${esc(fmtDate(r.date ?? s.date))}</div>
    <h2>Alegeri parlamentare</h2>
    <p>${pname(r.winner)} a câștigat. Guvern: ${r.gov.map(pname).join(" + ")}.</p>
    ${rows
      .map(
        ([pid, n]) => `<div class="seat-row"><span class="sr-name" style="color:${color(pid)}">${pname(pid)}</span>
          <div class="bar"><i style="--pc:${color(pid)};width:${((n / 330) * 100).toFixed(1)}%"></i></div>
          <span class="sr-num">${n}</span></div>`,
      )
      .join("")}
    <div class="modal-actions"><button class="btn gold" id="close-result">Continuă</button></div>
  </div>`;
  modal.classList.remove("hidden");
}

async function answerDecision(id, choice) {
  let res;
  if (S.mode === "solo") {
    res = decide(S.game, S.data, S.party, id, choice);
    if (res.ok) refreshSolo();
  } else {
    res = await post(`/api/rooms/${S.room}/decide`, { party: S.party, decision: id, choice });
  }
  toast(res.ok ? "Decizie luată" : "Nu se poate", res.ok ? res.message : res.error);
}

function renderDecision() {
  const box = $("#decision");
  const mine = (S.snap.decisions ?? []).filter((d) => d.party === S.party);
  const d = mine[0];
  if (!d) {
    if (S.keys.decision) {
      box.classList.add("hidden");
      box.innerHTML = "";
      S.keys.decision = "";
    }
    return;
  }
  const left = Math.max(0, d.expires - S.snap.day);
  const funds = S.snap.parties[S.party].funds;
  const key = `${d.id}|${left}|${Math.floor(funds * 10)}|${mine.length}`;
  if (key === S.keys.decision) return;
  S.keys.decision = key;
  box.innerHTML = `
    <div class="dec-tag">DECIZIE${mine.length > 1 ? `<small>+${mine.length - 1} în așteptare</small>` : ""}</div>
    <div class="dec-body">
      <b>${esc(d.title)}</b>
      <span>${esc(d.text)}</span>
      <div class="dec-choices">
        ${d.choices
          .map(
            (c, i) => `<button class="dec-btn" data-decision="${d.id}" data-decide="${i}" ${c.cost > funds ? "disabled" : ""}>
              <b>${esc(c.label)}</b><small>${esc(c.hint)}</small></button>`,
          )
          .join("")}
      </div>
    </div>
    <div class="dec-left">${left}<small>zile</small></div>`;
  box.classList.remove("hidden");
}

/* ------------------------------------------------------------- actions */

async function doAction(action) {
  if (S.mode === "solo") {
    const res = applyAction(S.game, S.data, S.party, action);
    if (res.ok) refreshSolo();
    toast(res.ok ? "Gata" : "Nu se poate", res.ok ? res.message : res.error);
    return;
  }
  const res = await post(`/api/rooms/${S.room}/action`, { party: S.party, action });
  if (!res.ok) toast("Nu se poate", res.error);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...data };
}

function toast(kicker, text) {
  const box = $("#toast");
  box.innerHTML = `<div class="t-kicker">${esc(kicker)}</div><div class="t-text">${esc(text)}</div>`;
  box.classList.remove("hidden");
  clearTimeout(toast.timer);
  clearTimeout(renderToast.timer);
  toast.timer = setTimeout(() => box.classList.add("hidden"), 4200);
}

boot().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;color:#e9eef7;font-family:system-ui">
    <h2>Turul Doi nu a pornit</h2><pre>${esc(err.message)}</pre></div>`;
});
