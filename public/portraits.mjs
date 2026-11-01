// Caricature portraits drawn in code from the `look` field of data/politicians.json.
// Deliberately simple: big head, small shoulders, one exaggerated trait each.

const HAIR = {
  short: (c) => `<path d="M26 40 Q26 14 50 14 Q74 14 74 40 Q70 26 50 26 Q30 26 26 40Z" fill="${c}"/>`,
  side: (c) => `<path d="M25 42 Q24 13 52 14 Q76 15 75 40 Q64 22 40 28 Q30 31 25 42Z" fill="${c}"/>`,
  bald: (c) => `<path d="M28 34 Q34 26 50 26 Q66 26 72 34 Q64 28 50 28 Q36 28 28 34Z" fill="${c}" opacity=".55"/>`,
  long: (c) =>
    `<path d="M24 44 Q22 12 50 12 Q78 12 76 44 L78 72 Q70 66 70 50 Q68 26 50 26 Q32 26 30 50 Q30 66 22 72Z" fill="${c}"/>`,
  bob: (c) =>
    `<path d="M24 46 Q22 12 50 12 Q78 12 76 46 L76 60 Q66 58 68 44 Q64 26 50 26 Q36 26 32 44 Q34 58 24 60Z" fill="${c}"/>`,
  bun: (c) =>
    `<circle cx="50" cy="10" r="9" fill="${c}"/><path d="M26 40 Q26 14 50 14 Q74 14 74 40 Q70 26 50 26 Q30 26 26 40Z" fill="${c}"/>`,
  curly: (c) =>
    `<g fill="${c}"><circle cx="30" cy="26" r="9"/><circle cx="42" cy="18" r="10"/><circle cx="58" cy="18" r="10"/><circle cx="70" cy="26" r="9"/></g>`,
};

function facial(kind, hair, skin) {
  if (kind === "mustache") return `<path d="M38 55 Q50 50 62 55 Q50 58 38 55Z" fill="${hair}"/>`;
  if (kind === "stubble")
    return `<path d="M32 50 Q50 76 68 50 Q66 70 50 74 Q34 70 32 50Z" fill="${hair}" opacity=".28"/>`;
  if (kind === "beard")
    return `<path d="M30 48 Q32 78 50 80 Q68 78 70 48 Q64 62 50 62 Q36 62 30 48Z" fill="${hair}" opacity=".85"/>`;
  return "";
}

export function portrait(look = {}, opts = {}) {
  const hairColor = look.hairColor ?? "#2b2623";
  const skin = look.skin ?? "#e8b896";
  const suit = look.suit ?? "#2a3550";
  const hairFn = HAIR[look.hair] ?? HAIR.short;
  const tie = look.tie
    ? `<path d="M47 76 L53 76 L55 100 L50 104 L45 100Z" fill="${look.tie}"/>`
    : `<path d="M44 76 L50 86 L56 76Z" fill="${skin}"/>`;
  const glasses = look.glasses
    ? `<g fill="none" stroke="#10131a" stroke-width="2"><rect x="31" y="42" width="15" height="11" rx="4"/><rect x="54" y="42" width="15" height="11" rx="4"/><path d="M46 47 H54"/></g>`
    : "";
  const bg = opts.bg ?? "#1a2468";
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "portret"}">
  <rect width="100" height="100" rx="14" fill="${bg}"/>
  <path d="M10 100 Q12 76 36 72 L64 72 Q88 76 90 100Z" fill="${suit}"/>
  <path d="M42 70 L50 84 L58 70Z" fill="#f4f1ea"/>
  ${tie}
  <rect x="42" y="62" width="16" height="14" rx="4" fill="${skin}"/>
  <ellipse cx="50" cy="46" rx="25" ry="29" fill="${skin}"/>
  ${hairFn(hairColor)}
  <ellipse cx="25" cy="48" rx="4" ry="6" fill="${skin}"/><ellipse cx="75" cy="48" rx="4" ry="6" fill="${skin}"/>
  <circle cx="39" cy="47" r="2.4" fill="#10131a"/><circle cx="61" cy="47" r="2.4" fill="#10131a"/>
  <path d="M33 40 Q39 37 45 40" stroke="${hairColor}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M55 40 Q61 37 67 40" stroke="${hairColor}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M50 49 L47 59 L52 59" stroke="#00000033" stroke-width="2" fill="none" stroke-linecap="round"/>
  ${facial(look.facial, hairColor, skin)}
  <path d="M42 66 Q50 71 58 66" stroke="#7a2e2e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  ${glasses}
</svg>`;
}
