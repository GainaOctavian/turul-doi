// Builds data/law-sources.json (the curated, verified acts) and appends the legislation-based
// bills to data/bills.json. Safe to re-run: bills are matched by id, sources are rebuilt.
//   node tools/law.mjs sync && node tools/bills-law.mjs && node tools/law.mjs check
//
// Every source below was read in the corpus (github.com/lexifina/romania-law, checked 2026-11-03)
// and its index status cross-checked with `law.mjs repeals`, because the index misses implicit
// repeals. `retired` lists acts that look in force in the index but are not.
import { readFileSync, writeFileSync } from "node:fs";

const rj = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const index = rj(".cache/acts.json").acts;
const act = (kind, ref) => {
  const [number, year] = ref.split("/");
  const a = index.find((x) => x.kind === kind && x.number === number && x.year === year);
  if (!a) throw new Error(`not in index: ${kind} ${ref}`);
  return a;
};

const SOURCES = [
  ["lege", "286/2009", "Codul penal: infracțiuni de corupție (art. 289 luarea de mită 3-10 ani, 291 traficul de influență 2-7, 295 delapidarea 2-7, 297 abuzul în serviciu, 301 conflictul de interese 1-5)"],
  ["lege", "135/2010", "Codul de procedură penală"],
  ["lege", "78/2000", "Prevenirea, descoperirea și sancționarea faptelor de corupție"],
  ["lege", "176/2010", "Integritatea în exercitarea funcțiilor și demnităților publice: declarații de avere și interese, ANI (indexul îl marchează ca act modificator, dar conține regimul de bază)"],
  ["lege", "361/2022", "Protecția avertizorilor în interes public; abrogă Legea 571/2004 (art. 37)"],
  ["lege", "544/2001", "Accesul la informațiile de interes public"],
  ["lege", "52/2003", "Transparența decizională în administrația publică"],
  ["lege", "98/2016", "Achiziții publice"],
  ["lege", "99/2016", "Achiziții sectoriale"],
  ["lege", "100/2016", "Concesiuni de lucrări și de servicii"],
  ["lege", "184/2016", "Prevenirea conflictului de interese în achiziții publice (verificare ex ante)"],
  ["oug", "109/2011", "Guvernanța corporativă a întreprinderilor publice"],
  ["lege", "318/2015", "Agenția Națională de Administrare a Bunurilor Indisponibilizate"],
  ["lege", "129/2019", "Prevenirea și combaterea spălării banilor și a finanțării terorismului"],
  ["lege", "70/2015", "Încasări și plăți în numerar: limite pentru persoane juridice și PFA"],
  ["lege", "334/2006", "Finanțarea partidelor politice și a campaniilor electorale"],
  ["lege", "14/2003", "Partidele politice"],
  ["lege", "208/2015", "Alegerea Senatului și a Camerei Deputaților; Autoritatea Electorală Permanentă"],
  ["lege", "115/2015", "Alegeri locale"],
  ["lege", "370/2004", "Alegerea Președintelui României"],
  ["lege", "47/1992", "Organizarea și funcționarea Curții Constituționale"],
  ["lege", "303/2022", "Statutul judecătorilor și procurorilor (înlocuiește Legea 303/2004)"],
  ["lege", "304/2022", "Organizarea judiciară (înlocuiește Legea 304/2004)"],
  ["lege", "305/2022", "Consiliul Superior al Magistraturii (înlocuiește Legea 317/2004)"],
  ["oug", "57/2019", "Codul administrativ (înlocuiește Legea 188/1999 și Legea 7/2004)"],
  ["lege", "227/2015", "Codul fiscal"],
  ["lege", "207/2015", "Codul de procedură fiscală"],
  ["lege", "53/2003", "Codul muncii"],
  ["lege", "360/2023", "Sistemul public de pensii (în vigoare din 1 septembrie 2024; înlocuiește Legea 263/2010)"],
  ["lege", "198/2023", "Învățământul preuniversitar"],
  ["lege", "199/2023", "Învățământul superior"],
  ["lege", "95/2006", "Reforma în domeniul sănătății"],
  ["lege", "123/2012", "Energia electrică și gazele naturale"],
  ["lege", "273/2006", "Finanțele publice locale"],
  ["lege", "500/2002", "Finanțele publice"],
  ["lege", "69/2010", "Responsabilitatea fiscal-bugetară"],
  ["lege", "416/2001", "Venitul minim garantat"],
  ["lege", "17/2014", "Vânzarea terenurilor agricole din extravilan (indexul îl marchează ca act modificator)"],
  ["lege", "203/2015", "Planificarea apărării"],
];

// Index says "in force" but the act is gone or emptied: do not use as a source.
const RETIRED = [
  { ref: "571/2004", supersededBy: "361/2022", why: "abrogată prin art. 37 din Legea 361/2022" },
  { ref: "304/2004", supersededBy: "304/2022", why: "legile justiției din 2022 au înlocuit legile din 2004" },
  { ref: "317/2004", supersededBy: "305/2022", why: "CSM: lege nouă din 2022" },
  { ref: "303/2004", supersededBy: "303/2022", why: "statutul magistraților: lege nouă din 2022" },
  { ref: "188/1999", supersededBy: "57/2019 (oug)", why: "Codul administrativ" },
  { ref: "7/2004", supersededBy: "57/2019 (oug)", why: "Codul de conduită: preluat de Codul administrativ" },
  { ref: "263/2010", supersededBy: "360/2023", why: "pensii: lege nouă" },
  { ref: "115/1996", supersededBy: "176/2010", why: "declararea averii: articolul 1 e abrogat" },
  { ref: "144/2007", supersededBy: "176/2010", why: "ANI: articolul 1 e abrogat; regimul e în Legea 176/2010" },
  { ref: "161/2003", supersededBy: "78/2000, 176/2010", why: "lege-umbrelă golită prin abrogări; nu folosi titlurile ei" },
];

const sources = SOURCES.map(([kind, ref, topic]) => {
  const a = act(kind, ref);
  return { slug: a.slug, path: a.path, ref: `${kind === "oug" ? "OUG" : "Legea"} nr. ${ref}`, topic, latest: a.latest, portal: a.portal, verified: "2026-11-03", ...(a.status === "amending act" ? { statusNote: "indexul îl etichetează «amending act» (euristică); textul de bază a fost citit și e în vigoare" } : {}) };
});
writeFileSync(new URL("../data/law-sources.json", import.meta.url), JSON.stringify({ note: "Curated acts the game cites. Rebuild with tools/bills-law.mjs; verify with tools/law.mjs check.", sources, retired: RETIRED }, null, 2) + "\n");

const slug = (kind, ref) => act(kind, ref).slug;
const cp = slug("lege", "286/2009");

// B(id, title, text, lean, interest, effects, sourceSlug, note)
const NEW = [];
const B = (id, title, text, lean, interest, effects, source, note) => NEW.push({ id, title, text, lean, interest, effects, source: { slug: source, note } });

B("abuz-prag-prejudiciu", "Abuzul în serviciu: prag minim de prejudiciu", "Proiectul condiționează răspunderea penală pentru abuz în serviciu (art. 297 Cod penal) de un prejudiciu peste un prag stabilit prin lege. Magistrații și societatea civilă avertizează că faptele sub prag rămân nesancționate penal.", -0.3, { bugetari: 0.7, antreprenori: 0.1, tineri_urbani: -0.6, studenti: -0.5, diaspora: -0.5 }, { metric: { cpi: -1.6 }, sol: { tineri_urbani: -1, diaspora: -1.5 }, confidence: -3, party: { self: -0.012 } }, cp, "art. 297");
B("trafic-influenta-pedepse", "Traficul de influență: majorarea pedepselor", "Limitele pedepsei pentru traficul de influență (art. 291 Cod penal, în prezent 2–7 ani) se majorează, iar confiscarea se extinde la bunurile dobândite în perioada faptei.", 0.1, { tineri_urbani: 0.6, antreprenori: 0.4, studenti: 0.5, bugetari: -0.3 }, { metric: { cpi: 0.9 }, party: { self: 0.008 } }, cp, "art. 291");
B("delapidare-confiscare", "Confiscarea extinsă pentru delapidare și luare de mită", "Instanțele pot confisca bunurile nejustificate ale condamnaților pentru luare de mită (art. 289) și delapidare (art. 295), cu inversarea sarcinii probei pentru valorile peste un prag.", 0, { tineri_urbani: 0.5, studenti: 0.4, bugetari: -0.4, antreprenori: 0.2 }, { metric: { cpi: 1.1 }, party: { self: 0.008 } }, cp, "art. 289, 295");
B("conflict-interese-penal", "Conflictul de interese: eliminarea excepțiilor din art. 301", "Proiectul restrânge excepțiile din art. 301 alin. (2) Cod penal și extinde infracțiunea la rudele de gradul III ale funcționarului.", 0.1, { tineri_urbani: 0.5, bugetari: -0.5, antreprenori: 0.2 }, { metric: { cpi: 0.8 }, sol: { bugetari: -0.5 } }, cp, "art. 301");
B("ani-verificare-automata", "Verificarea automată a declarațiilor de avere și de interese", "ANI primește acces automat la registrele de proprietate, conturi și societăți comerciale pentru corelarea declarațiilor cu datele reale (Legea 176/2010).", 0, { tineri_urbani: 0.7, antreprenori: 0.3, studenti: 0.5, bugetari: -0.3 }, { metric: { cpi: 1.0 }, party: { self: 0.006 } }, "legea-176-2010", "declarații de avere");
B("ani-sanctiuni-incompatibilitate", "Incompatibilități: sancțiuni mai dure și termene mai scurte", "Persoana aflată în incompatibilitate pierde mandatul și funcția, iar procedura ANI se încheie în termene maximale stabilite prin lege (Legea 176/2010).", 0.1, { tineri_urbani: 0.5, bugetari: -0.4, antreprenori: 0.2 }, { metric: { cpi: 0.7 } }, "legea-176-2010", "incompatibilități");
B("prevent-extindere", "Extinderea sistemului de verificare ex ante a conflictelor de interese", "Mecanismul de verificare prealabilă a conflictului de interese în achizițiile publice (Legea 184/2016) se aplică și contractelor sub pragul actual.", -0.1, { antreprenori: 0.5, tineri_urbani: 0.4, bugetari: -0.3 }, { metric: { cpi: 0.8 }, macro: { growth: -0.02 } }, "legea-184-2016", "conflict de interese în achiziții");
B("achizitie-directa-prag", "Majorarea pragului pentru achiziția directă", "Autoritățile pot atribui direct contracte până la un prag majorat (Legea 98/2016), cu obligația de a publica ulterior contractul. Autoritățile locale susțin că simplifică procedurile; criticii avertizează asupra fragmentării artificiale a contractelor.", -0.2, { antreprenori: 0.3, bugetari: 0.5, tineri_urbani: -0.5, agricultori: 0.2 }, { metric: { cpi: -1.0, infra: 0.3 }, macro: { growth: 0.04 }, party: { self: -0.006 } }, "legea-98-2016", "achiziție directă");
B("achizitii-transparenta-contracte", "Publicarea integrală a contractelor de achiziție publică", "Toate contractele și actele adiționale se publică într-un registru deschis, cu motivarea modificărilor de preț (Legea 98/2016).", 0, { antreprenori: 0.5, tineri_urbani: 0.6, studenti: 0.4, bugetari: -0.2 }, { metric: { cpi: 1.0 }, party: { self: 0.006 } }, "legea-98-2016", "transparență contracte");
B("intreprinderi-publice-selectie", "Selecția administratorilor din întreprinderile publice", "Consiliile de administrație se constituie prin selecție independentă, cu mandate fixe și criterii de performanță (OUG 109/2011), nu prin numire politică directă.", -0.3, { antreprenori: 0.6, tineri_urbani: 0.5, bugetari: -0.6, muncitori: -0.1 }, { metric: { cpi: 0.9 }, macro: { growth: 0.05 }, party: { self: 0.006 } }, "oug-109-2011", "guvernanță corporativă");
B("finantare-partide-plafon", "Plafonarea donațiilor către partide", "Donațiile private către partide și campanii se plafonează, iar donatorii mari sunt publicați în timp real (Legea 334/2006).", 0, { tineri_urbani: 0.6, studenti: 0.4, antreprenori: 0.2 }, { metric: { cpi: 0.7 }, funds: { self: -0.3 }, party: { self: 0.005 } }, "legea-334-2006", "finanțarea partidelor");
B("finantare-partide-subventie", "Majorarea subvenției de la bugetul de stat pentru partide", "Subvenția anuală a partidelor crește, iar criteriile de împărțire rămân cele după rezultatul la alegeri (Legea 334/2006).", 0.1, { tineri_urbani: -0.4, studenti: -0.3, bugetari: 0.2 }, { metric: { cpi: -0.2 }, funds: { self: 1.2 }, party: { self: -0.004 } }, "legea-334-2006", "subvenții");
B("aep-control-finantare", "Controlul finanțării campaniilor de către AEP", "Autoritatea Electorală Permanentă primește competențe sporite de verificare a veniturilor și cheltuielilor din campanie, cu sancțiuni pentru raportări false (Legea 334/2006, Legea 208/2015).", 0, { tineri_urbani: 0.6, studenti: 0.4, antreprenori: 0.2 }, { metric: { cpi: 0.6 }, party: { self: 0.004 } }, "legea-208-2015", "AEP");
B("csm-independenta", "Consolidarea independenței Consiliului Superior al Magistraturii", "Proiectul modifică procedura de alegere a membrilor CSM și limitează influența executivului asupra numirilor în funcții de conducere (Legea 305/2022).", 0, { tineri_urbani: 0.5, antreprenori: 0.3, bugetari: -0.1 }, { metric: { cpi: 0.7 }, party: { self: 0.004 } }, "legea-305-2022", "CSM");
B("justitie-termene-dosare", "Termene maxime pentru dosarele de corupție", "Dosarele de corupție de mare corupție se judecă în termene maxime stabilite prin lege, pentru a evita prescrierea (Codul de procedură penală).", 0, { tineri_urbani: 0.5, antreprenori: 0.3, studenti: 0.4 }, { metric: { cpi: 0.8 } }, "legea-135-2010", "termene și prescripție");
B("beneficiari-reali", "Registrul beneficiarilor reali ai societăților", "Registrul beneficiarilor reali devine public și verificabil online, cu amenzi pentru nedeclarare (Legea 129/2019).", -0.1, { tineri_urbani: 0.5, antreprenori: -0.2, studenti: 0.3 }, { metric: { cpi: 0.8 }, macro: { growth: -0.02 } }, "legea-129-2019", "spălare de bani");
B("numerar-plafon", "Reducerea plafonului pentru plățile în numerar", "Plafonul zilnic pentru plățile în numerar între firme se reduce, pentru a limita evaziunea (Legea 70/2015).", -0.1, { antreprenori: -0.5, agricultori: -0.3, tineri_urbani: 0.2, bugetari: 0.1 }, { metric: { cpi: 0.4 }, macro: { growth: -0.03 }, sol: { antreprenori: -1 } }, "legea-70-2015", "numerar");
B("transparenta-decizionala-obligatorie", "Dezbaterea publică obligatorie pentru actele normative", "Proiectele de acte normative nu pot fi adoptate fără dezbatere publică de minimum 30 de zile, cu excepții limitate (Legea 52/2003).", 0, { tineri_urbani: 0.5, antreprenori: 0.4, studenti: 0.4, bugetari: -0.2 }, { metric: { cpi: 0.5 }, confidence: -1 }, "legea-52-2003", "transparență");
B("informatii-publice-termene", "Termene mai scurte pentru informațiile de interes public", "Termenul de răspuns la cererile de informații publice se reduce, iar refuzul nemotivat se sancționează (Legea 544/2001).", 0, { tineri_urbani: 0.5, studenti: 0.4, antreprenori: 0.3, bugetari: -0.3 }, { metric: { cpi: 0.5 } }, "legea-544-2001", "acces la informații");
B("oug-limitare-penal", "Limitarea ordonanțelor de urgență în domeniul penal", "Guvernul nu mai poate modifica prin ordonanță de urgență normele de drept penal și procedură penală, ci doar prin lege adoptată de Parlament.", 0, { tineri_urbani: 0.6, antreprenori: 0.3, studenti: 0.5, bugetari: -0.2 }, { metric: { cpi: 0.6 }, confidence: -2 }, "legea-286-2009", "Codul penal");
B("avertizori-protectie-361", "Protecția avertizorilor: sancțiuni pentru represalii", "Măsurile disciplinare luate în urma unei sesizări de integritate se anulează automat, iar angajatorul răspunde pentru represalii (Legea 361/2022).", 0, { tineri_urbani: 0.7, antreprenori: 0.4, studenti: 0.5, bugetari: -0.1 }, { metric: { cpi: 0.9 }, party: { self: 0.006 } }, "legea-361-2022", "avertizori");
B("pensii-indexare-360", "Indexarea punctului de pensie", "Punctul de pensie se indexează anual cu rata inflației și cu 50% din creșterea salariului mediu brut (Legea 360/2023).", 0.5, { pensionari_rural: 1, pensionari_urban: 1, muncitori: -0.1, tineri_urbani: -0.4 }, { sol: { pensionari_rural: 2, pensionari_urban: 2 }, budget: { pensions: 0.1 }, party: { self: 0.01 } }, "legea-360-2023", "pensii");
B("educatie-198-performanta", "Evaluarea unităților de învățământ după rezultatele elevilor", "Finanțarea suplimentară a școlilor se leagă de progresul elevilor, nu doar de numărul lor (Legea 198/2023).", -0.1, { bugetari: 0.2, tineri_urbani: 0.4, studenti: 0.3 }, { metric: { education: 0.6 }, party: { self: 0.004 } }, "legea-198-2023", "educație");
B("universitati-199-finantare", "Finanțarea universităților pe baza performanței în cercetare", "O parte din finanțarea de bază se acordă pe baza publicațiilor și a brevetelor, nu doar a numărului de studenți (Legea 199/2023).", -0.2, { studenti: 0.5, tineri_urbani: 0.3, bugetari: 0.1 }, { metric: { education: 0.5 }, sol: { studenti: 0.5 } }, "legea-199-2023", "învățământ superior");
B("finante-locale-cote", "Cote mai mari din impozitul pe venit pentru bugetele locale", "Administrațiile locale rețin o cotă mai mare din impozitul pe venit colectat pe teritoriul lor (Legea 273/2006).", -0.1, { bugetari: 0.5, antreprenori: 0.2, agricultori: 0.2 }, { budget: { admin: 0.05 }, metric: { infra: 0.4 }, confidence: -1 }, "legea-273-2006", "finanțe locale");
B("responsabilitate-fiscala", "Reguli stricte de responsabilitate fiscal-bugetară", "Guvernul trebuie să respecte o regulă de deficit pe termen mediu și să publice impactul fiscal al fiecărui act normativ (Legea 69/2010).", -0.3, { antreprenori: 0.5, tineri_urbani: 0.2, bugetari: -0.3, pensionari_urban: -0.2 }, { macro: { growth: -0.04 }, party: { self: 0.004 } }, "legea-69-2010", "disciplină fiscală");
B("codul-muncii-telemunca", "Codul muncii: reglementarea muncii la distanță", "Angajatorii trebuie să acopere costurile muncii la distanță și să garanteze dreptul la deconectare (Legea 53/2003).", 0.2, { tineri_urbani: 0.6, muncitori: 0.2, antreprenori: -0.4 }, { sol: { tineri_urbani: 1 }, macro: { growth: -0.02 } }, "legea-53-2003", "Codul muncii");

const bills = rj("data/bills.json");
const have = new Set(bills.bills.map((b) => b.id));
let added = 0;
for (const b of NEW) {
  if (have.has(b.id)) continue;
  bills.bills.push(b);
  added += 1;
}
// Existing bills that rest on a law now carry the same source so the registry stays honest.
const link = { avertizori: ["legea-361-2022", "avertizori"], "recalculare-pensii": ["legea-360-2023", "pensii"], "salariu-minim": ["legea-53-2003", "Codul muncii"], "autostrazi-ppp": ["legea-100-2016", "concesiuni"], "spitale-performanta": ["legea-95-2006", "sănătate"], "abandon-scolar": ["legea-198-2023", "educație"], "autonomie-universitati": ["legea-199-2023", "învățământ superior"], "buget-aparare": ["legea-203-2015", "apărare"], "subventii-agricultura": ["legea-17-2014", "terenuri agricole"], "vot-diaspora": ["legea-208-2015", "alegeri"], "finantare-partide": ["legea-334-2006", "partide"], "declaratii-avere": ["legea-176-2010", "declarații de avere"] };
for (const b of bills.bills) if (link[b.id] && !b.source) b.source = { slug: link[b.id][0], note: link[b.id][1] };
// Sources are typed as "legea-N-Y" / "oug-N-Y"; resolve them to the real index slug (codes have names).
const resolve = (slug) => {
  if (sources.some((s) => s.slug === slug)) return slug;
  const m = /^(legea|oug)-(\d+)-(\d{4})$/.exec(slug);
  const path = m && `${m[1] === "oug" ? "oug" : "lege"}/${m[3]}/${m[2]}`;
  const s = sources.find((x) => x.path === path);
  if (!s) throw new Error("source not in registry: " + slug);
  return s.slug;
};
for (const b of bills.bills) if (b.source) b.source.slug = resolve(b.source.slug);
writeFileSync(new URL("../data/bills.json", import.meta.url), JSON.stringify(bills, null, 2) + "\n");
console.log(`sources ${sources.length}, retired ${RETIRED.length}, bills added ${added}, total ${bills.bills.length}`);
