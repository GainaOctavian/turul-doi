// Turul Doi server: static files, multiplayer rooms over SSE, and the local
// control endpoint used by bin/turul-doi-ctl.mjs.
import http from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  createGame,
  tick,
  snapshot,
  applyAction,
  applyGov,
  offerCoalition,
  acceptCoalition,
  decide,
} from "./shared/engine.mjs";
import { createCtl } from "./shared/ctl.mjs";
import { DATA_FILES } from "./shared/data-files.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const CTL = process.env.TURUL_DOI_CTL === "1" || process.argv.includes("--ctl");

const readJson = async (file) =>
  JSON.parse(await readFile(join(ROOT, "data", file), "utf8"));

const data = Object.fromEntries(
  await Promise.all(Object.entries(DATA_FILES).map(async ([key, file]) => [key, await readJson(file)])),
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const rooms = new Map();
const players = new Map();

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let code = "";
    const bytes = randomBytes(4);
    for (const b of bytes) code += alphabet[b % alphabet.length];
    if (!rooms.has(code)) return code;
  }
}

function createRoom(seed = Date.now(), scenario = "2026") {
  const code = roomCode();
  const room = {
    code,
    state: createGame(data, { seed, scenario }),
    clients: new Set(),
    last: Date.now(),
    players: new Map(),
  };
  rooms.set(code, room);
  return room;
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

// Snapshot plus who is seated at which party, so the UI can list the players.
// The long history series only go out once a month (and on connect).
function view(room, hist = true) {
  return { ...snapshot(room.state, data, { hist }), players: Object.fromEntries(room.players) };
}

function broadcast(room) {
  if (!room.clients.size) return;
  const snap = view(room, room.state.day % 30 === 0);
  for (const client of room.clients) {
    try {
      sendEvent(client.res, "state", snap);
    } catch {
      room.clients.delete(client);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // speed 0 means paused: the clock stops for everyone in the room.
    if (!room.clients.size || room.state.speed === 0) continue;
    const interval = Math.max(250, data.config.tickMs / (room.state.speed || 1));
    if (now - room.last >= interval) {
      room.last = now;
      tick(room.state, data, 1);
      broadcast(room);
    }
  }
}, 200);

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res, pathname, base = PUBLIC) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.replace(/^\//, ""));
  const file = normalize(join(base, rel));
  if (!file.startsWith(normalize(base))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const content = await readFile(file);
    const ext = extname(file);
    const noCache = [".html", ".js", ".mjs", ".css", ".json"].includes(ext);
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": noCache ? "no-cache" : "public, max-age=300",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  }
}

const ctl = CTL ? createCtl(data) : null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  try {
    if (path === "/api/health") {
      return json(res, 200, { ok: true, rooms: rooms.size });
    }

    if (path === "/api/rooms" && req.method === "POST") {
      const { scenario } = await body(req);
      const known = data.scenarios.scenarios.some((s) => s.id === scenario);
      const room = createRoom(Date.now(), known ? scenario : "2026");
      return json(res, 200, { code: room.code, scenario: room.state.scenario });
    }

    const info = path.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
    if (info && req.method === "GET") {
      const room = rooms.get(info[1]);
      if (!room) return json(res, 404, { error: "Cod inexistent." });
      return json(res, 200, {
        code: room.code,
        scenario: room.state.scenario,
        partyIds: room.state.partyIds,
        taken: Object.fromEntries(room.players),
      });
    }

    if (path === "/api/rooms/join" && req.method === "POST") {
      const { code, party, name } = await body(req);
      const room = rooms.get(String(code || "").toUpperCase());
      if (!room) return json(res, 404, { error: "Cod inexistent." });
      if (!room.state.partyIds.includes(party)) {
        return json(res, 400, { error: "Partidul nu există în acest scenariu." });
      }
      if (room.players.has(party)) {
        return json(res, 409, { error: "Partidul e deja luat." });
      }
      room.players.set(party, String(name || party).slice(0, 24));
      return json(res, 200, { code: room.code });
    }

    const stream = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/stream$/);
    if (stream) {
      const room = rooms.get(stream[1]);
      if (!room) {
        res.writeHead(404).end("no room");
        return;
      }
      const party = url.searchParams.get("party");
      const name = url.searchParams.get("name") || "";
      if (party && !room.players.has(party)) {
        if (!room.state.partyIds.includes(party)) {
          res.writeHead(400).end("no party");
          return;
        }
        room.players.set(party, String(name || party).slice(0, 24));
      }
      if (party && !room.state.humans.includes(party)) {
        room.state.humans.push(party);
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");
      const client = { res, party };
      room.clients.add(client);
      sendEvent(res, "state", view(room));
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => {
        clearInterval(ping);
        room.clients.delete(client);
      });
      return;
    }

    const action = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/(action|gov|coalition|accept|speed|decide)$/);
    if (action && req.method === "POST") {
      const room = rooms.get(action[1]);
      if (!room) return json(res, 404, { error: "Cod inexistent." });
      const payload = await body(req);
      const party = payload.party;
      if (!room.state.humans.includes(party)) {
        return json(res, 403, { error: "Nu joci acest partid." });
      }
      if (action[2] === "action") {
        const result = applyAction(room.state, data, party, payload.action || {});
        if (result.ok) broadcast(room);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (action[2] === "gov") {
        const result = applyGov(room.state, data, party, payload.action || {});
        if (result.ok) broadcast(room);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (action[2] === "decide") {
        const result = decide(room.state, data, party, payload.decision, payload.choice);
        if (result.ok) broadcast(room);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (action[2] === "coalition") {
        const result = offerCoalition(room.state, data, party, payload.to);
        if (result.ok) broadcast(room);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (action[2] === "accept") {
        const result = acceptCoalition(room.state, data, party, payload.from);
        if (result.ok) broadcast(room);
        return json(res, result.ok ? 200 : 400, result);
      }
      const speed = Number(payload.speed);
      if (![0, 1, 2, 4].includes(speed)) return json(res, 400, { error: "Viteză invalidă." });
      room.state.speed = speed;
      broadcast(room);
      return json(res, 200, { ok: true });
    }

    if (path === "/ctl" && req.method === "POST" && ctl) {
      const remote = req.socket.remoteAddress || "";
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
        return json(res, 403, { error: "local only" });
      }
      const { token, line } = await body(req);
      if (token !== process.env.TURUL_DOI_CTL_TOKEN) {
        return json(res, 403, { error: "bad token" });
      }
      const output = ctl.run(line);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(output);
    }

    if (path.startsWith("/api/")) return json(res, 404, { error: "not found" });
    if (path.startsWith("/shared/")) return serveStatic(req, res, path, ROOT);
    if (path.startsWith("/data/")) return serveStatic(req, res, path, ROOT);
    return serveStatic(req, res, path);
  } catch (err) {
    return json(res, 500, { error: String(err?.message || err) });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is busy. Stop the old server or run with PORT=<other>.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`Turul Doi: http://127.0.0.1:${PORT}`);
  if (CTL) {
    const token = randomBytes(16).toString("hex");
    process.env.TURUL_DOI_CTL_TOKEN = token;
    const dir = join(ROOT, ".turul-doi");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "ctl.json"),
      JSON.stringify({ port: PORT, token, pid: process.pid }, null, 2),
    );
    console.log("ctl enabled: .turul-doi/ctl.json");
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (CTL) await rm(join(ROOT, ".turul-doi", "ctl.json"), { force: true });
    process.exit(0);
  });
}
