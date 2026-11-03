// Romanian legislation lookup, backed by github.com/lexifina/romania-law.
//
//   node tools/law.mjs sync                       download/refresh the act index into .cache/
//   node tools/law.mjs find [--kind lege] [--year 2010] [--text "cod"] [--status "in force"] [--limit 30]
//   node tools/law.mjs get <slug|path|"176/2010"> [--kind lege]   index row + first articles
//   node tools/law.mjs clone                      shallow clone of the corpus into .cache/romania-law (needed by grep/repeals)
//   node tools/law.mjs grep "<regex>" [--limit 20]  full-text search of the articles in force
//   node tools/law.mjs repeals <slug|ref>          articles that mention the act next to "abrog" (implicit repeals)
//   node tools/law.mjs brief <path|ref>...         one line per act: status, versions and the opening of article 1
//   node tools/law.mjs check                      verify data/law-sources.json against the index
//
// The index only has numbers and dates ("Legea nr. 176/2010"); the subject comes from
// the first articles, which `get` fetches (and caches). data/law-sources.json is the curated
// list the game relies on: every bill with a `source` must point at an entry there.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(ROOT, ".cache");
const INDEX = join(CACHE, "acts.json");
const RAW = "https://raw.githubusercontent.com/lexifina/romania-law/main";
const MAX_AGE_DAYS = 7;

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

async function sync(force = false) {
  mkdirSync(CACHE, { recursive: true });
  if (!force && existsSync(INDEX)) {
    const meta = JSON.parse(readFileSync(INDEX, "utf8"));
    if ((Date.now() - new Date(meta.fetched).getTime()) / 864e5 < MAX_AGE_DAYS) return meta;
  }
  const res = await fetch(`${RAW}/data/acts.json`);
  if (!res.ok) throw new Error(`index download failed: ${res.status}`);
  const j = await res.json();
  const meta = { fetched: new Date().toISOString(), acts: j.acts };
  writeFileSync(INDEX, JSON.stringify(meta));
  return meta;
}

const load = async () => {
  const meta = await sync(false);
  return meta.acts;
};

// "176/2010" -> number 176, year 2010
const parseRef = (s) => {
  const m = /^(\d+)\/(\d{4})$/.exec(s);
  return m ? { number: m[1], year: m[2] } : null;
};

function findOne(acts, ref, kind) {
  const r = parseRef(ref);
  return acts.find(
    (a) =>
      a.slug === ref ||
      a.path === ref ||
      (r && a.number === r.number && a.year === r.year && (!kind || a.kind === kind) && (kind || a.kind === "lege")),
  );
}

const row = (a) =>
  `${a.slug.padEnd(22)} ${a.status.padEnd(9)} v${String(a.versions).padEnd(3)} ${a.from}..${a.latest}  ${a.short ?? a.title}${a.code ? `  [${a.code}]` : ""}`;

async function article(path, n = 1) {
  const file = join(CACHE, "articles", `${path.replaceAll("/", "_")}_${n}.md`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const res = await fetch(`${RAW}/${path}/art-${String(n).padStart(3, "0")}.md`);
  if (!res.ok) return null;
  const text = await res.text();
  mkdirSync(join(CACHE, "articles"), { recursive: true });
  writeFileSync(file, text);
  return text;
}

const CORPUS = join(CACHE, "romania-law");
const git = (a) => spawnSync("git", ["-c", "http.sslBackend=schannel", ...a], { encoding: "utf8", maxBuffer: 1e9 });
const needCorpus = () => {
  if (!existsSync(CORPUS)) {
    console.log("no local corpus: run  node tools/law.mjs clone");
    process.exit(2);
  }
};

// Whole-file matches of an act number near "abrog": the index's status misses implicit repeals.
function repealHits(a) {
  const num = `${a.number}/${a.year}`;
  const res = git(["-C", CORPUS, "grep", "-n", "-i", "--all-match", "-e", "abrog", "-e", `nr\\. \\?${a.number}/${a.year}`, "--", "*.md"]);
  const hits = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m || !m[3].includes(num) || m[1].startsWith(a.path + "/") || /(^|\/)(README|ACTS)\.md$/.test(m[1])) continue;
    hits.push({ file: m[1], text: m[3].trim() });
  }
  return hits;
}
// A line like "se abroga Legea nr. N/Y" (not "art. 5 din Legea nr. N/Y") repeals the whole act.
const wholeRepeal = (h, a) => new RegExp(`abrog[^.;]{0,120}?(Legea|Ordonanța de urgență a Guvernului|Ordonanța Guvernului|Hotărârea Guvernului)\\s+nr\\.\\s*${a.number}/${a.year}`, "i").test(h.text) && !/art\.|alin\.|lit\.|titlul|capitolul|sec[țt]iunea|anexa|pct\./i.test(h.text.split(`nr. ${a.number}/${a.year}`)[0].slice(-60));

if (cmd === "clone") {
  const r = git(["clone", "--depth", "1", "--single-branch", "https://github.com/lexifina/romania-law", CORPUS]);
  console.log(r.status === 0 ? "cloned" : r.stderr);
} else if (cmd === "brief") {
  needCorpus();
  const acts = await load();
  for (const ref of positional) {
    const a = findOne(acts, ref.includes("/") && /^[a-z-]+\//.test(ref) ? ref : ref, flag("kind")) ?? acts.find((x) => x.path === ref);
    if (!a) { console.log(ref, "-> not found"); continue; }
    let text = "";
    for (let n = 1; n <= 3 && text.length < 30; n += 1) {
      const f = join(CORPUS, a.path, `art-${String(n).padStart(3, "0")}.md`);
      if (!existsSync(f)) break;
      const body = readFileSync(f, "utf8").split(/\r?\n/).slice(1).join(" ").trim();
      if (!/^Abrogat/.test(body)) text = body;
    }
    console.log(`${a.path.padEnd(14)} ${a.status.padEnd(12)} v${String(a.versions).padEnd(3)} ${a.latest}  ${text.slice(0, 170).replace(/\s+/g, " ")}`);
  }
} else if (cmd === "grep") {
  needCorpus();
  const r = git(["-C", CORPUS, "grep", "-n", "-i", "-E", positional[0], "--", "*.md"]);
  const lines = r.stdout.split("\n").filter(Boolean);
  lines.slice(0, Number(flag("limit", 20))).forEach((l) => console.log(l.slice(0, 220)));
  console.log(`${lines.length} line(s)`);
} else if (cmd === "repeals") {
  needCorpus();
  const acts = await load();
  const a = findOne(acts, positional[0], flag("kind"));
  if (!a) process.exit(1);
  const hits = repealHits(a);
  hits.filter((h) => wholeRepeal(h, a)).forEach((h) => console.log("WHOLE ", h.file, "\n       ", h.text.slice(0, 200)));
  console.log(hits.length, "mention(s) near 'abrog';", hits.filter((h) => wholeRepeal(h, a)).length, "look like a whole-act repeal");
} else if (cmd === "sync") {
  const meta = await sync(true);
  const by = {};
  for (const a of meta.acts) by[a.kind] = (by[a.kind] ?? 0) + 1;
  console.log(`${meta.acts.length} acts`, by, "fetched", meta.fetched);
} else if (cmd === "find") {
  const acts = await load();
  const text = flag("text")?.toLowerCase();
  const out = acts.filter(
    (a) =>
      (!flag("kind") || a.kind === flag("kind")) &&
      (!flag("year") || a.year === flag("year")) &&
      (!flag("status") || a.status === flag("status")) &&
      (!text || `${a.title} ${a.short ?? ""} ${a.code ?? ""}`.toLowerCase().includes(text)),
  );
  out.slice(0, Number(flag("limit", 30))).forEach((a) => console.log(row(a)));
  console.log(`${out.length} match(es)`);
} else if (cmd === "get") {
  const acts = await load();
  const a = findOne(acts, positional[0], flag("kind"));
  if (!a) {
    console.log("not found");
    process.exit(1);
  }
  console.log(row(a));
  console.log("portal:", a.portal, a.withdrawn_by ? `\nwithdrawn by ${a.withdrawn_by}: ${a.reason}` : "");
  for (let n = 1; n <= Number(flag("articles", 2)); n += 1) {
    const t = await article(a.path, n);
    if (!t) break;
    console.log(`\n--- art. ${n} ---\n${t.trim().slice(0, 900)}`);
  }
} else if (cmd === "check") {
  const acts = await load();
  const src = JSON.parse(readFileSync(join(ROOT, "data", "law-sources.json"), "utf8")).sources;
  let bad = 0;
  for (const s of src) {
    const a = acts.find((x) => x.slug === s.slug);
    const problems = [];
    if (!a) problems.push("missing from index");
    else {
      if (a.status !== "in force" && !(a.status === "amending act" && s.statusNote)) problems.push(`status: ${a.status}${a.withdrawn_by ? ` (by ${a.withdrawn_by})` : ""}`);
      if (a.latest !== s.latest) problems.push(`latest changed: ${s.latest} -> ${a.latest}`);
    }
    if (a && existsSync(CORPUS)) {
      const whole = repealHits(a).filter((h) => wholeRepeal(h, a));
      if (whole.length && !s.supersededOk) problems.push(`possibly repealed by ${whole[0].file.split("/").slice(0, 3).join("/")}`);
    }
    if (problems.length) bad += 1;
    console.log(`${problems.length ? "!!" : "ok"} ${s.slug.padEnd(22)} ${problems.join("; ")}`);
  }
  console.log(`${src.length} sources, ${bad} to review`);
  process.exit(bad ? 1 : 0);
} else {
  console.log("usage: sync | find | get <slug|ref> | check  (see header of tools/law.mjs)");
}
