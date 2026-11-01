// Builds data/romania-map.json from the geoBoundaries ADM1 file.
// Source: geoBoundaries ROU ADM1 (CC BY 4.0), World Bank / www.geoboundaries.org
// The raw file is downloaded on first run and is gitignored.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const RAW = new URL("./raw-romania.geojson", import.meta.url);
const RAW_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/ROU/ADM1/geoBoundaries-ROU-ADM1_simplified.geojson";

if (!existsSync(RAW)) {
  console.log("downloading geoBoundaries ROU ADM1...");
  const res = await fetch(RAW_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
}

const NAMES = {
  ALBA: "Alba", ARAD: "Arad", ARGES: "Argeș", BACAU: "Bacău",
  BIHOR: "Bihor", "BISTRITA-NASAUD": "Bistrița-Năsăud", BOTOSANI: "Botoșani",
  BRAILA: "Brăila", BRASOV: "Brașov", BUZAU: "Buzău", CALARASI: "Călărași",
  "CARAS-SEVERIN": "Caraș-Severin", CLUJ: "Cluj", CONSTANTA: "Constanța",
  COVASNA: "Covasna", DAMBOVITA: "Dâmbovița", DOLJ: "Dolj", GALATI: "Galați",
  GIURGIU: "Giurgiu", GORJ: "Gorj", HARGHITA: "Harghita", HUNEDOARA: "Hunedoara",
  IALOMITA: "Ialomița", IASI: "Iași", ILFOV: "Ilfov", MARAMURES: "Maramureș",
  MEHEDINTI: "Mehedinți", BUCURESTI: "București", MURES: "Mureș", NEAMT: "Neamț",
  OLT: "Olt", PRAHOVA: "Prahova", SALAJ: "Sălaj", "SATU MARE": "Satu Mare",
  SIBIU: "Sibiu", SUCEAVA: "Suceava", TELEORMAN: "Teleorman", TIMIS: "Timiș",
  TULCEA: "Tulcea", VALCEA: "Vâlcea", VASLUI: "Vaslui", VRANCEA: "Vrancea",
};

export function slug(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

const K = 151.2;
const COS = Math.cos((46 * Math.PI) / 180);
const X0 = 20.2;
const Y0 = 48.35;
const project = ([lon, lat]) => [
  (lon - X0) * COS * K,
  (Y0 - lat) * K,
];

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

function ringToPath(ring) {
  const pts = ring.map(project);
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * 10) / 10;
    const y = Math.round(pts[i][1] * 10) / 10;
    d += `${i === 0 ? "M" : "L"}${x} ${y}`;
  }
  return d + "Z";
}

const geo = JSON.parse(readFileSync(RAW, "utf8"));
const counties = [];

for (const f of geo.features) {
  const rawName = f.properties.shapeName;
  const name = NAMES[rawName] || rawName;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const parts = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (outer.length < 8 || ringArea(outer) < 0.0005) continue;
    parts.push(ringToPath(outer));
  }
  counties.push({ id: slug(name), name, d: parts.join(" ") });
}

counties.sort((a, b) => a.name.localeCompare(b.name, "ro"));
const out = { viewBox: "0 0 1000 720", source: "geoBoundaries ROU ADM1 (CC BY 4.0)", counties };
writeFileSync(new URL("../data/romania-map.json", import.meta.url), JSON.stringify(out));
console.log(`wrote ${counties.length} counties, ${JSON.stringify(out).length} bytes`);
