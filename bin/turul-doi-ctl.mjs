#!/usr/bin/env node
// CLI for the running game: reads .turul-doi/ctl.json and sends lines to /ctl.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CFG = process.env.TURUL_DOI_CTL_FILE || join(process.cwd(), ".turul-doi", "ctl.json");

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CFG, "utf8"));
  } catch {
    console.error(`no game listening (missing ${CFG}); start it with TURUL_DOI_CTL=1 npm start`);
    process.exit(2);
  }
}

async function send(cfg, line) {
  const res = await fetch(`http://127.0.0.1:${cfg.port}/ctl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: cfg.token, line }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`ctl error ${res.status}: ${text}`);
    process.exit(2);
  }
  return text;
}

const args = process.argv.slice(2);
if (!args.length || args[0] === "--help" || args[0] === "help") {
  console.log(`usage: turul-doi-ctl <command...>
       turul-doi-ctl script.txt
       echo "state" | turul-doi-ctl -

commands: state, parties, poll, counties, play, speed, act, actions, laws,
          politicians, event, tick, election, coalition, accept, events, help`);
  process.exit(0);
}

const cfg = await loadConfig();

let lines;
if (args[0] === "-") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
} else if (args.length === 1 && args[0].endsWith(".txt")) {
  lines = (await readFile(resolve(args[0]), "utf8")).split(/\r?\n/);
} else {
  lines = [args.join(" ")];
}

let failed = false;
for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const out = await send(cfg, line);
  console.log(out);
  if (/^error\b/.test(out)) failed = true;
}
process.exit(failed ? 1 : 0);
