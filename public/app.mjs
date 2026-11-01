import {
  createGame,
  tick,
  snapshot,
  applyAction,
  offerCoalition,
  acceptCoalition,
  ACTIONS,
} from "/shared/engine.mjs";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const S = {
  data: null,
  map: null,
  mode: "solo",
  party: "psd",
  name: "",
  room: null,
  game: null,
  snap: null,
  selected: "cluj",
  tab: "county",
  lastTick: 0,
  es: null,
  lastToast: null,
  dismissedResult: null,
  lawChoice: null,
};

let partyById = {};
let segById = {};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pct = (v) => `${((v ?? 0) * 100).toFixed(1).replace(".", ",")}%`;
const num = (v) => Math.round(v).toLocaleString("ro-RO");
const color = (id) => partyById[id]?.color ?? "#7a879b";
const pname = (id) => partyById[id]?.name ?? String(id).toUpperCase();
const segName = (id) => segById[id]?.name ?? id;

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/* ------------------------------------------------------------------ boot */

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Nu pot încărca ${path}`);
  return res.json();
}

async function boot() {
  const [config, segments, parties, politicians, counties, events, laws, map] = await Promise.all([
    loadJson("/data/config.json"),
    loadJson("/data/segments.json"),
    loadJson("/data/parties.json"),
    loadJson("/data/politicians.json"),
    loadJson("/data/counties.json"),
    loadJson("/data/events.json"),
    loadJson("/data/laws.json"),
    loadJson("/data/romania-map.json"),
  ]);
  S.data = { config, segments, parties, politicians, counties, events, laws };
  S.map = map;
  partyById = Object.fromEntries(parties.parties.map((p) => [p.id, p]));
  segById = Object.fromEntries(segments.segments.map((s) => [s.id, s]));
  S.party = "psd";
  S.selected = "cluj";
  const requested = new URLSearchParams(location.search).get("party");
  if (requested && partyById[requested]) S.party = requested;

  buildStart();
  buildMap();
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
};

function buildStart() {
  const grid = $("#party-grid");
  grid.innerHTML = S.data.parties.parties
    .map((p) => {
      const leader = S.data.politicians.politicians.find((x) => x.id === p.leader);
      return `<button class="party-card ${p.id === S.party ? "active" : ""}" data-party="${p.id}" style="--pc:${p.color}">
        <div class="pc-top"><span class="dot" style="--pc:${p.color}"></span>${esc(p.name)}</div>
        <div class="pc-leader">${esc(leader?.name ?? "")}</div>
        <div class="pc-desc">${esc(PARTY_BLURB[p.id] ?? p.fullName)}</div>
      </button>`;
    })
    .join("");

  grid.addEventListener("click", (e) => {
    const card = e.target.closest("[data-party]");
    if (!card) return;
    S.party = card.dataset.party;
    $$(".party-card").forEach((c) => c.classList.toggle("active", c === card));
  });

  $$(".mode").forEach((btn) =>
    btn.addEventListener("click", () => {
      S.mode = btn.dataset.mode;
      $$(".mode").forEach((b) => b.classList.toggle("active", b === btn));
      renderStartFields();
    }),
  );

  renderStartFields();
  $("#start-btn").addEventListener("click", startGame);
}

function renderStartFields() {
  const box = $("#start-fields");
  const btn = $("#start-btn");
  if (S.mode === "solo") {
    box.innerHTML = "";
    btn.textContent = "Începe campania";
  } else {
    box.innerHTML = `
      <div class="field"><label for="player-name">Numele tău</label>
        <input id="player-name" placeholder="ex. Octavian" maxlength="20" value="${esc(S.name)}" /></div>
      <div class="field"><label for="room-code">Cod cameră (gol = creezi)</label>
        <input id="room-code" placeholder="ABCD" maxlength="4" style="text-transform:uppercase" /></div>`;
    btn.textContent = "Intră în joc";
    $("#player-name").addEventListener("input", (e) => (S.name = e.target.value));
  }
}

async function startGame() {
  const err = $("#start-error");
  err.textContent = "";
  if (S.mode === "solo") {
    S.game = createGame(S.data, { seed: Date.now(), humans: [S.party] });
    const params = new URLSearchParams(location.search);
    const skip = Math.max(0, Math.min(400, Number(params.get("day") || 0)));
    if (skip) tick(S.game, S.data, skip);
    S.snap = snapshot(S.game, S.data);
    S.lastTick = performance.now();
    showApp();
    return;
  }

  S.name = ($("#player-name")?.value || "Jucător").trim() || "Jucător";
  let code = ($("#room-code")?.value || "").trim().toUpperCase();

  try {
    if (!code) {
      const res = await fetch("/api/rooms", { method: "POST" });
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

function connectRoom(code) {
  const es = new EventSource(
    `/api/rooms/${code}/stream?party=${S.party}&name=${encodeURIComponent(S.name)}`,
  );
  S.es = es;
  es.addEventListener("state", (e) => {
    S.snap = JSON.parse(e.data);
    render();
  });
  es.addEventListener("error", () => {
    // EventSource reconnects by itself; nothing to do.
  });
}

function showApp() {
  $("#start").classList.add("hidden");
  $("#app").classList.remove("hidden");
  buildTabs();
  render();
  if (S.mode === "solo") {
    setInterval(soloLoop, 200);
  }
}

function soloLoop() {
  if (!S.game) return;
  const now = performance.now();
  const interval = S.data.config.tickMs / (S.game.speed || 1);
  if (now - S.lastTick < interval) return;
  S.lastTick = now;
  tick(S.game, S.data, 1);
  S.snap = snapshot(S.game, S.data);
  render();
}

/* ------------------------------------------------------------------ map */

function buildMap() {
  const svg = $("#map");
  svg.innerHTML = S.map.counties
    .map((c) => `<path id="c-${c.id}" data-id="${c.id}" d="${c.d}"></path>`)
    .join("");

  svg.addEventListener("click", (e) => {
    const id = e.target?.dataset?.id;
    if (!id) return;
    S.selected = id;
    S.tab = "county";
    render();
  });

  const tip = $("#tooltip");
  svg.addEventListener("mousemove", (e) => {
    const id = e.target?.dataset?.id;
    if (!id || !S.snap) {
      tip.classList.add("hidden");
      return;
    }
    const shares = Object.entries(S.snap.poll.counties[id])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    tip.innerHTML = `<b>${esc(S.snap.counties[id].name)}</b>${shares
      .map(
        ([pid, v]) =>
          `<div class="tt-row"><span><span class="dot" style="--pc:${color(pid)}"></span> ${pname(pid)}</span><em>${pct(v)}</em></div>`,
      )
      .join("")}`;
    const box = $(".map-wrap").getBoundingClientRect();
    tip.style.left = `${e.clientX - box.left}px`;
    tip.style.top = `${e.clientY - box.top - 8}px`;
    tip.classList.remove("hidden");
  });
  svg.addEventListener("mouseleave", () => tip.classList.add("hidden"));
}

/* --------------------------------------------------------------- render */

function render() {
  if (!S.snap) return;
  renderTopbar();
  renderMap();
  renderPollStrip();
  renderTabs();
  renderPanel();
  renderTicker();
  renderToast();
  renderResult();
}

function renderTopbar() {
  const s = S.snap;
  const party = s.parties[S.party];
  const daysLeft = Math.max(0, s.electionDay - s.day);
  const gov = party?.gov ? `<span class="chip" style="border-color:${color(S.party)}66">GUVERN</span>` : "";
  $("#topbar").innerHTML = `
    <div class="tb-brand"><div class="flag"><i></i><i></i><i></i></div>TURUL DOI</div>
    <div class="tb-date"><b>${fmtDate(s.date)}</b><span>ziua ${s.day} · alegeri în ${daysLeft} zile</span></div>
    <div class="speeds">
      ${[1, 2, 4]
        .map((v) => `<button data-speed="${v}" class="${s.speed === v ? "active" : ""}">${v}x</button>`)
        .join("")}
    </div>
    <div class="spacer"></div>
    ${gov}
    <span class="chip"><span class="dot" style="--pc:${color(S.party)}"></span>${pname(S.party)} · <b>${num(party?.funds ?? 0)}</b> fonduri</span>
    <span class="chip">Capital <b>${num(party?.capital ?? 0)}</b></span>
    <span class="chip">Mandate <b>${num(party?.seats ?? 0)}</b></span>
    ${S.room ? `<span class="chip">Cameră <b class="room-code">${esc(S.room)}</b></span>` : ""}
  `;
  $$("[data-speed]", $("#topbar")).forEach((btn) =>
    btn.addEventListener("click", () => {
      const v = Number(btn.dataset.speed);
      if (S.mode === "solo") {
        S.game.speed = v;
        S.snap.speed = v;
        renderTopbar();
      } else {
        post(`/api/rooms/${S.room}/speed`, { party: S.party, speed: v });
      }
    }),
  );
}

function renderMap() {
  const s = S.snap;
  for (const c of S.map.counties) {
    const path = document.getElementById(`c-${c.id}`);
    if (!path) continue;
    const shares = s.poll.counties[c.id];
    const [pid, share] = Object.entries(shares).sort((a, b) => b[1] - a[1])[0];
    path.setAttribute("fill", color(pid));
    path.setAttribute("fill-opacity", String(Math.min(0.95, 0.42 + share * 0.9)));
    path.classList.toggle("selected", c.id === S.selected);
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
  if (c) $("#map-sub").textContent = `${c.name} · ${num(c.pop)} mii locuitori · click pe hartă`;
}

function renderPollStrip() {
  const s = S.snap;
  const rows = Object.entries(s.poll.national).sort((a, b) => b[1] - a[1]);
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

function buildTabs() {
  const tabs = [
    ["county", "Județ"],
    ["actions", "Acțiuni"],
    ["news", "Știri"],
    ["poll", "Sondaj"],
    ["team", "Echipă"],
  ];
  $("#tabs").innerHTML = tabs
    .map(([id, label]) => `<button data-tab="${id}" class="${S.tab === id ? "active" : ""}">${label}</button>`)
    .join("");
  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    S.tab = btn.dataset.tab;
    renderTabs();
    renderPanel();
  });
}

function renderTabs() {
  $$("#tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === S.tab));
}

function renderPanel() {
  const fn = { county: panelCounty, actions: panelActions, news: panelNews, poll: panelPoll, team: panelTeam }[S.tab];
  const panel = $("#panel");
  panel.innerHTML = fn ? fn() : "";
  panel.scrollTop = 0;
  wirePanel();
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

  return `
    <div class="card">
      <div class="row between">
        <h4>${esc(c.name)}</h4>
        <span class="muted">${num(c.pop)} mii locuitori</span>
      </div>
      <div class="muted" style="font-size:12px;margin-top:2px">Câștigă ${pname(shares[0][0])} cu ${pct(shares[0][1])}</div>
      <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
        ${shares
          .slice(0, 4)
          .map(
            ([pid, v]) => `<span class="chip" style="padding:4px 9px;font-size:11px"><span class="dot" style="--pc:${color(pid)}"></span>${pname(pid)} ${pct(v)}</span>`,
          )
          .join("")}
      </div>
    </div>

    <h3>Segmente de votanți</h3>
    ${segs
      .map(
        (seg) => `<div class="seg-row">
          <div>
            <div class="seg-name"><span style="color:var(--text)">${esc(seg.name)}</span><span>${pct(seg.size / total)}</span></div>
            <div class="bar"><i style="--pc:${seg.color};width:${((seg.size / total) * 100).toFixed(1)}%"></i></div>
          </div>
          <div class="seg-val">${num(seg.size)}</div>
        </div>`,
      )
      .join("")}

    <h3>Acțiuni rapide la ${esc(c.name)}</h3>
    <div class="row wrap">
      <button class="btn" data-quick="rally">Miting</button>
      <button class="btn" data-quick="deal">Înțelegere locală</button>
    </div>
    <div class="row" style="margin-top:8px;gap:8px">
      <select id="rival">${S.data.parties.parties
        .filter((p) => p.id !== S.party)
        .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
        .join("")}</select>
      <button class="btn" data-quick="attack">Atac</button>
    </div>
  `;
}

function panelActions() {
  const s = S.snap;
  const party = s.parties[S.party];
  const c = s.counties[S.selected];
  const rivalOptions = S.data.parties.parties
    .filter((p) => p.id !== S.party)
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join("");

  return `
    <h3>Acțiuni</h3>
    ${ACTIONS.map((a) => {
      const cd = party.cooldown[a.id] ?? -1;
      const ready = cd <= s.day;
      const affordable = party.funds >= a.cost;
      const govBlock = a.requiresGovernment && !party.gov;
      const disabled = !ready || !affordable || govBlock;
      const reason = govBlock
        ? "Doar guvernul"
        : !ready
          ? `din ziua ${cd}`
          : !affordable
            ? "fonduri insuficiente"
            : "";
      const target = a.target === "county" || a.target === "county-party" ? ` · ${esc(c?.name ?? "")}` : "";
      return `<div class="action-card">
        <div class="ac-name">${a.name}${target}</div>
        <div class="ac-desc">${a.desc}</div>
        <div class="ac-meta">${a.cost ? `${a.cost} fonduri` : "capital politic"} · ${reason || `pregătit`}</div>
        <button data-act="${a.id}" ${disabled ? "disabled" : ""} class="${a.requiresGovernment ? "law-btn" : ""}">${a.requiresGovernment ? "Promulgă" : "Fă"}</button>
      </div>`;
    }).join("")}

    <div class="card">
      <div class="row between"><span class="muted">Rival pentru atac</span></div>
      <select id="rival" style="width:100%;margin-top:6px">${rivalOptions}</select>
    </div>

    <h3>Legi (guvern)</h3>
    <div class="card">
      <select id="law" style="width:100%">
        ${S.data.laws.laws
          .map((l) => `<option value="${l.id}">${esc(l.name)} · ${l.capital} capital</option>`)
          .join("")}
      </select>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">Legea se aplică imediat dacă ești la guvernare. Costă capital politic.</p>
    </div>
  `;
}

function panelNews() {
  const s = S.snap;
  const active = s.active
    ? `<div class="card" style="border-color:#6b561a;background:#1d1a10">
        <div class="n-day">Ultima știre · ziua ${s.active.day}</div>
        <h4 style="margin:4px 0 4px">${esc(s.active.title)}</h4>
        <div class="muted" style="font-size:12px">${esc(s.active.text)}</div>
      </div>`
    : "";
  const items = [...s.log].reverse();
  return `
    ${active}
    <h3>Jurnalul campaniei</h3>
    ${items
      .map(
        (l) => `<div class="news-item ${esc(l.kind)}">
          <div class="n-day">ziua ${l.day} · ${esc(l.kind)}</div>
          <div class="n-title">${esc(l.title)}</div>
          ${l.text ? `<div class="n-text">${esc(l.text)}</div>` : ""}
        </div>`,
      )
      .join("")}
  `;
}

function panelPoll() {
  const s = S.snap;
  const rows = Object.entries(s.poll.national).sort((a, b) => b[1] - a[1]);
  const mySeats = s.parties[S.party].seats;
  const coalition = s.coalitions
    .map(
      (c) =>
        `<div class="row between"><span>${c.parties.map(pname).join(" + ")}</span><b>${num(
          c.parties.reduce((sum, id) => sum + (s.parties[id].seats ?? 0), 0),
        )}</b></div>`,
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

  return `
    <h3>Sondaj național</h3>
    ${rows
      .map(
        ([pid, v]) => `<div style="margin-bottom:9px">
          <div class="row between" style="font-size:12px"><span><span class="dot" style="--pc:${color(pid)}"></span> ${pname(pid)}</span><b>${pct(v)}</b></div>
          <div class="bar" style="margin-top:3px"><i style="--pc:${color(pid)};width:${(v * 100).toFixed(1)}%"></i></div>
        </div>`,
      )
      .join("")}

    <h3>Mandate (330)</h3>
    <div class="card">
      ${Object.entries(s.poll.seats)
        .sort((a, b) => b[1] - a[1])
        .filter(([, n]) => n > 0)
        .map(
          ([pid, n]) => `<div class="seat-row"><span class="sr-name" style="color:${color(pid)}">${pname(pid)}</span>
            <div class="bar"><i style="--pc:${color(pid)};width:${((n / 330) * 100).toFixed(1)}%"></i></div>
            <span class="sr-num">${n}</span></div>`,
        )
        .join("")}
      <div class="muted" style="font-size:11.5px;margin-top:6px">Partidul tău: ${num(mySeats)} mandate</div>
    </div>

    <h3>Coaliție</h3>
    <div class="coalition-box">
      ${
        s.coalitions.length
          ? coalition
          : `<span class="muted">Nicio coaliție formată. ${s.parties[S.party].gov ? "Ești la guvernare." : "Guvernul e ales după alegeri."}</span>`
      }
    </div>
    ${offers ? `<div class="card">${offers}</div>` : ""}
    <div class="card">
      <div class="row" style="gap:8px">
        <select id="coalition-target" style="flex:1">
          ${S.data.parties.parties
            .filter((p) => p.id !== S.party)
            .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
            .join("")}
        </select>
        <button class="btn" data-coalition="1">Ofertă</button>
      </div>
      <p class="muted" style="font-size:11px;margin:8px 0 0">Ofertele se acceptă în tabul celuilalt jucător, sau automat de AI după alegeri.</p>
    </div>
  `;
}

function panelTeam() {
  const s = S.snap;
  const leaderId = partyById[S.party]?.leader;
  const list = Object.values(s.politicians)
    .filter((p) => p.party === S.party || p.id === leaderId)
    .sort((a, b) => (a.id === leaderId ? -1 : b.id === leaderId ? 1 : 0));

  return `
    <h3>${pname(S.party)} · echipa</h3>
    ${list
      .map(
        (p) => `<div class="politician">
          <div class="pol-top"><b>${esc(p.name)}</b>
            <span class="dot" style="--pc:${color(p.party ?? S.party)}"></span></div>
          <div class="pol-role">${esc(p.role)}</div>
          <div class="stats">
            ${[
              ["Carismă", "charisma"],
              ["Răbdare", "patience"],
              ["Maleabilitate", "malleability"],
              ["Gafe", "gaffes"],
              ["Vizibilitate", "visibility"],
              ["Corupție", "corruption"],
              ["Traseism", "traseism"],
            ]
              .map(
                ([label, key]) => `<div class="stat">
                  <div class="st-top"><span>${label}</span><b>${p.stats[key]}</b></div>
                  <div class="bar" style="height:3px"><i style="--pc:${color(p.party ?? S.party)};width:${p.stats[key]}%"></i></div>
                </div>`,
              )
              .join("")}
          </div>
          <div class="ability"><b>${esc(p.ability.name)}</b> — ${esc(p.ability.text)}</div>
          <div class="facts">
            ${(p.facts?.real ?? []).map((f) => `<div><span class="tag real">real</span>${esc(f)}</div>`).join("")}
            ${(p.facts?.fake ?? []).map((f) => `<div><span class="tag fake">satiră</span>${esc(f)}</div>`).join("")}
          </div>
        </div>`,
      )
      .join("")}
    <p class="muted" style="font-size:11px">Statisticile de joc sunt satirice. Faptele „reale” sunt verificabile; cele „satiră” sunt inventate.</p>
  `;
}

function wirePanel() {
  const panel = $("#panel");
  const rival = $("#rival")?.value;
  const law = $("#law")?.value;

  $$("[data-quick]", panel).forEach((btn) =>
    btn.addEventListener("click", () => {
      const type = btn.dataset.quick;
      const action = { type, county: S.selected };
      if (type === "attack") action.targetParty = $("#rival")?.value ?? rival;
      doAction(action);
    }),
  );

  $$("[data-act]", panel).forEach((btn) =>
    btn.addEventListener("click", () => {
      const type = btn.dataset.act;
      const action = { type };
      if (type === "rally" || type === "deal") action.county = S.selected;
      if (type === "attack") {
        action.county = S.selected;
        action.targetParty = $("#rival")?.value ?? rival;
      }
      if (type === "law") action.law = $("#law")?.value ?? law;
      doAction(action);
    }),
  );

  $$("[data-accept]", panel).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const from = btn.dataset.accept;
      if (S.mode === "solo") {
        const res = acceptCoalition(S.game, S.data, S.party, from);
        if (res.ok) {
          S.snap = snapshot(S.game, S.data);
          render();
        }
        toast(res.ok ? "Coaliție" : "Nu se poate", res.ok ? res.message : res.error);
      } else {
        const res = await post(`/api/rooms/${S.room}/accept`, { party: S.party, from });
        if (!res.ok) toast("Nu se poate", res.error);
      }
    }),
  );

  $$("[data-coalition]", panel).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const to = $("#coalition-target")?.value;
      if (!to) return;
      if (S.mode === "solo") {
        const res = offerCoalition(S.game, S.data, S.party, to);
        if (res.ok) {
          S.snap = snapshot(S.game, S.data);
          render();
        }
        toast(res.ok ? "Ofertă trimisă" : "Nu se poate", res.ok ? res.message : res.error);
      } else {
        const res = await post(`/api/rooms/${S.room}/coalition`, { party: S.party, to });
        if (!res.ok) toast("Nu se poate", res.error);
      }
    }),
  );
}

function renderTicker() {
  const s = S.snap;
  const last = [...s.log].reverse().find((l) => l.kind === "event") ?? [...s.log].reverse()[0];
  $("#ticker").innerHTML = `<b>Breaking</b><span>${last ? `${esc(last.title)} — ${esc(last.text)}` : "Campania începe."}</span>`;
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
  modal.innerHTML = `<div class="modal-card">
    <div class="muted" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase">Rezultat · ziua ${r.day}</div>
    <h2>Alegeri parlamentare</h2>
    <p>${pname(r.winner)} a câștigat. Guvern: ${r.gov.map(pname).join(" + ")}.</p>
    ${rows
      .map(
        ([pid, n]) => `<div class="seat-row"><span class="sr-name" style="color:${color(pid)}">${pname(pid)}</span>
          <div class="bar"><i style="--pc:${color(pid)};width:${((n / 330) * 100).toFixed(1)}%"></i></div>
          <span class="sr-num">${n}</span></div>`,
      )
      .join("")}
    <div class="modal-actions"><button class="btn gold" id="close-result">Continuă campania</button></div>
  </div>`;
  modal.classList.remove("hidden");
  $("#close-result").addEventListener("click", () => {
    S.dismissedResult = r.day;
    modal.classList.add("hidden");
  });
}

/* ------------------------------------------------------------- actions */

async function doAction(action) {
  if (S.mode === "solo") {
    const res = applyAction(S.game, S.data, S.party, action);
    if (res.ok) {
      S.snap = snapshot(S.game, S.data);
      render();
    }
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
  toast.timer = setTimeout(() => box.classList.add("hidden"), 4200);
}

boot().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;color:#e9eef7;font-family:system-ui">
    <h2>Turul Doi nu a pornit</h2><pre>${esc(err.message)}</pre></div>`;
});
