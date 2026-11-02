// Small formatting helpers and HTML pieces shared by the screens.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const fmt = (n, d = 0) =>
  Number(n ?? 0).toLocaleString("ro-RO", { minimumFractionDigits: d, maximumFractionDigits: d });

// Million euro, the unit of the state budget.
export const meur = (n, d = 0) => `${fmt(n, d)} M€`;
export const pct1 = (v, d = 1) => `${fmt(v, d)}%`;
export const share = (v, d = 1) => `${fmt((v ?? 0) * 100, d)}%`;
export const signed = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n), d)}`;

// "good" / "bad" / "flat" for a change, given which direction is better.
export function tone(better, delta, eps = 0.05) {
  if (Math.abs(delta) < eps) return "flat";
  return (delta > 0) === (better === "high") ? "good" : "bad";
}

export const arrow = (delta, eps = 0.05) => (Math.abs(delta) < eps ? "→" : delta > 0 ? "▲" : "▼");

// A tiny line chart. `ref` is an optional second series drawn dashed (the EU).
export function spark(values, { w = 120, h = 30, color = "currentColor", ref = null } = {}) {
  if (!values || values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
  const all = ref ? [...values, ...ref] : values;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = 3;
  const x = (i, n) => pad + (i * (w - 2 * pad)) / Math.max(1, n - 1);
  const y = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  const line = (arr) => arr.map((v, i) => `${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${ref ? `<polyline points="${line(ref)}" fill="none" stroke="currentColor" stroke-opacity=".38" stroke-width="1.4" stroke-dasharray="3 3"/>` : ""}
    <polyline points="${line(values)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(values.length - 1, values.length).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.4" fill="${color}"/>
  </svg>`;
}

// Horizontal bar, 0..max. `mark` draws a thin tick (a baseline or a threshold).
export function bar(value, max, color = "var(--sec)", mark = null) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="bar2"><i style="width:${w.toFixed(1)}%;background:${color}"></i>${
    mark != null ? `<b style="left:${Math.max(0, Math.min(100, (mark / max) * 100)).toFixed(1)}%"></b>` : ""
  }</div>`;
}

export const badge = (text, color = "var(--muted)", title = "") =>
  `<span class="tag2" style="--tc:${color}" ${title ? `title="${esc(title)}"` : ""}>${esc(text)}</span>`;

export const dot = (color) => `<span class="dot" style="--pc:${color}"></span>`;

export function statCard({ label, value, unit = "", sub = "", tone: t = "", extra = "", color = "" }) {
  return `<div class="sc ${t}" ${color ? `style="--cc:${color}"` : ""}>
    <div class="sc-label">${esc(label)}</div>
    <div class="sc-value">${value}<small>${esc(unit)}</small></div>
    ${sub ? `<div class="sc-sub">${sub}</div>` : ""}
    ${extra}
  </div>`;
}

export const section = (title, body, { sub = "", right = "" } = {}) => `<section class="blk">
  <header class="blk-h"><div><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div>${right}</header>
  ${body}
</section>`;
