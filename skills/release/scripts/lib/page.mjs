// The client's shared delivery page: one self-contained HTML document, so it can be
// published as a claude.ai artifact or opened from disk.

import { releaseMonths, releaseTotals, releasesByMonth } from "./calendar.mjs";

const esc = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const hours = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const monthName = (month) => {
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const dayLabel = (date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(".", "");

const STATUS = { merged: "Publicado", open: "Em revisão", closed: "Encerrado" };
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// PR numbers repeat across repos, and a client's log merges every product, so
// an entry is identified by its PR URL (the same rule as the web DeliveryLog).
const anchorId = (url) =>
  `pr-${url.replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-zA-Z0-9]+/g, "-")}`;

const totalsLine = (t) =>
  `${t.entries} ${t.entries === 1 ? "entrega" : "entregas"} · ${hours.format(t.estimateHours)} h · ${
    t.tokens ? `${compact.format(t.tokens)} tokens` : "tokens não medidos"
  }`;

function entryCard(e, labelProduct) {
  return `<article class="entry" id="${anchorId(e.url)}">
  <div class="entry-meta">
    <time datetime="${e.date}">${esc(dayLabel(e.date))}</time>
    <a class="pr" href="${esc(e.url)}" target="_blank" rel="noreferrer">PR #${e.pr}</a>
    <span class="pill pill-${e.status}">${STATUS[e.status]}</span>${
      labelProduct && e.product ? `\n    <span class="product">${esc(e.product)}</span>` : ""
    }
  </div>
  <h3>${esc(e.title.pt)}</h3>
  <p>${esc(e.summary.pt)}</p>
  <dl class="figures">
    <div><dt>Horas estimadas</dt><dd>${hours.format(e.estimateHours)} h</dd></div>
    <div><dt>Tokens</dt><dd>${e.measured ? compact.format(e.measured.tokens.total) : "não medido"}</dd></div>
  </dl>
</article>`;
}

function productSplit(entries) {
  const rows = new Map();
  for (const e of entries) rows.set(e.product ?? "", [...(rows.get(e.product ?? "") ?? []), e]);
  return [...rows]
    .map(([name, list]) => `<span>${esc(name)}: ${esc(totalsLine(releaseTotals(list)))}</span>`)
    .join("");
}

function monthSection(m, open, labelProduct) {
  const weeks = m.weeks
    .map((w) => {
      const days = w.days
        .map((d) => {
          const chips = d.entries
            .map(
              (e) =>
                `<a class="chip chip-${e.status}" href="#${anchorId(e.url)}" title="${esc(
                  labelProduct && e.product ? `${e.product} · ${e.title.pt}` : e.title.pt,
                )}">#${e.pr} ${esc(e.title.pt)}</a>`,
            )
            .join("");
          return `<div class="day${d.inMonth ? "" : " out"}${d.entries.length ? " has" : ""}"><span class="num">${d.day}</span>${chips}</div>`;
        })
        .join("");
      return `<div class="week">${days}<div class="week-total">${w.totals.entries ? esc(totalsLine(w.totals)) : ""}</div></div>`;
    })
    .join("");
  return `<section class="month" id="m-${m.month}"${open ? "" : " hidden"} aria-label="${esc(monthName(m.month))}">
  <div class="month-head">
    <h2>${esc(monthName(m.month))}</h2>
    <dl class="totals">
      <div><dt>Entregas</dt><dd>${m.totals.entries}</dd></div>
      <div><dt>Horas estimadas</dt><dd>${hours.format(m.totals.estimateHours)} h</dd></div>
      <div><dt>Tokens</dt><dd>${m.totals.tokens ? compact.format(m.totals.tokens) : "—"}</dd></div>
    </dl>
  </div>${labelProduct && m.entries.length ? `\n  <p class="split">${productSplit(m.entries)}</p>` : ""}
  <div class="calendar" role="presentation">
    <div class="weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}<span>Semana</span></div>
    ${weeks}
  </div>
  <div class="entries">${
    m.entries.length
      ? m.entries.map((e) => entryCard(e, labelProduct)).join("")
      : `<p class="empty">Nenhuma entrega neste mês.</p>`
  }</div>
</section>`;
}

/**
 * The client's shared page: every month with entries, newest open, one tab per month.
 * Self-contained (the claude.ai artifact allows no app assets). `name` is the client's and
 * heads the page; when the entries span several products, each one names its product.
 * `timeZone` dates the "updated" line.
 */
export function renderReleasesPage(entries, generatedAt, name, timeZone = "UTC") {
  const months = releaseMonths(entries);
  const labelProduct = new Set(entries.map((e) => e.product).filter(Boolean)).size > 1;
  const tabs = months
    .map(
      (m, i) =>
        `<a class="tab" href="#m-${m}" data-month="${m}"${i === 0 ? ' aria-current="true"' : ""}>${esc(monthName(m))}</a>`,
    )
    .join("");
  const sections = months
    .map((m, i) => monthSection(releasesByMonth(entries, m), i === 0, labelProduct))
    .join("");
  const updated = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(generatedAt);

  // The artifact server refuses a page that does not start with a doctype. charset
  // next: the file opened from disk has only this, and without it the browser reads
  // UTF-8 accents as Latin-1.
  return `<!DOCTYPE html>
<meta charset="utf-8">
<title>${esc(name ? `Entregas ${name}` : "Entregas")}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Raleway:wght@400;500;600;700;800&display=swap">
<style>
/* Layout: a work log — month tabs, a Monday-first calendar with week totals, then the entries in full. */
:root {
  --bg: #f4f4f5; --surface: #ffffff; --fg: #0f0f0f; --muted: #6b6b70; --border: #e4e4e7;
  --accent: #ea0356; --accent-soft: #fde7ef; --ok: #13795b; --ok-soft: #e3f4ec; --warn: #9a5b00; --warn-soft: #fbf0dc;
  --font-display: "Raleway", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Raleway", ui-sans-serif, system-ui, sans-serif;
  --font-data: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #101012; --surface: #18181b; --fg: #ededef; --muted: #9a9aa2; --border: #2a2a2f;
  --accent: #ff3d7f; --accent-soft: #3a1422; --ok: #4fd1a1; --ok-soft: #12291f; --warn: #f2b45a; --warn-soft: #2e2312; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #101012; --surface: #18181b; --fg: #ededef; --muted: #9a9aa2; --border: #2a2a2f;
  --accent: #ff3d7f; --accent-soft: #3a1422; --ok: #4fd1a1; --ok-soft: #12291f; --warn: #f2b45a; --warn-soft: #2e2312; color-scheme: dark }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--font-body);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 32px 48px; }
.wrap { max-width: 1040px; margin: 0 auto; display: grid; gap: 24px; }
header { display: grid; gap: 6px; }
.eyebrow { font: 600 11px/1 var(--font-data); letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
h1 { font: 800 clamp(28px, 5vw, 40px)/1.1 var(--font-display); margin: 0; text-wrap: balance; letter-spacing: -.01em; }
.lead { margin: 0; color: var(--muted); max-width: 65ch; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.tab { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); text-decoration: none; font-weight: 600; font-size: 13px; }
.tab[aria-current="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.tab:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.month { display: grid; gap: 20px; }
.month-head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; }
h2 { font: 700 24px/1.2 var(--font-display); margin: 0; }
dl { margin: 0; }
.totals { display: flex; flex-wrap: wrap; gap: 20px; }
.totals dt, .figures dt { font: 600 10.5px/1 var(--font-data); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.totals dd { margin: 4px 0 0; font: 700 22px/1 var(--font-data); font-variant-numeric: tabular-nums; }
.calendar { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.weekdays, .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) minmax(0, 1.3fr); }
.weekdays span { padding: 8px 10px; font: 600 10.5px/1 var(--font-data); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); }
.week + .week .day, .week + .week .week-total { border-top: 1px solid var(--border); }
.day { min-height: 76px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; min-width: 0; border-right: 1px solid var(--border); }
.day.out { background: color-mix(in srgb, var(--bg) 60%, transparent); }
.day.out .num { opacity: .45; }
.num { font: 600 12px/1 var(--font-data); color: var(--muted); font-variant-numeric: tabular-nums; }
.chip { display: block; font-size: 11.5px; font-weight: 600; line-height: 1.3; padding: 3px 6px; border-radius: 6px; text-decoration: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--ok-soft); color: var(--ok); }
.chip-open { background: var(--warn-soft); color: var(--warn); }
.chip-closed { background: var(--bg); color: var(--muted); }
.week-total { padding: 8px 10px; font: 500 11.5px/1.4 var(--font-data); color: var(--muted); background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface)); font-variant-numeric: tabular-nums; }
.entries { display: grid; gap: 12px; }
.entry { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; display: grid; gap: 6px; min-width: 0; scroll-margin-top: 16px; }
.entry:target { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.entry-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font: 500 12px/1 var(--font-data); color: var(--muted); }
.pr { color: var(--accent); font-weight: 600; text-decoration: none; }
.pr:hover { text-decoration: underline; }
.pill { padding: 3px 8px; border-radius: 999px; font: 600 11px/1.2 var(--font-body); background: var(--ok-soft); color: var(--ok); }
.pill-open { background: var(--warn-soft); color: var(--warn); }
.pill-closed { background: var(--bg); color: var(--muted); }
.product { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); font: 600 11px/1.2 var(--font-body); color: var(--fg); }
.split { margin: -8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 20px; font: 500 12px/1.4 var(--font-data); color: var(--muted); }
.entry h3 { margin: 2px 0 0; font: 700 17px/1.3 var(--font-display); text-wrap: balance; }
.entry p { margin: 0; max-width: 72ch; }
.figures { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 4px; }
.figures dd { margin: 3px 0 0; font: 600 14px/1 var(--font-data); font-variant-numeric: tabular-nums; }
.empty { color: var(--muted); margin: 0; }
footer { color: var(--muted); font-size: 12.5px; display: grid; gap: 4px; max-width: 75ch; }
@media (max-width: 720px) {
  .calendar { display: none; }
}
@media (prefers-reduced-motion: no-preference) { .entry { transition: border-color .2s, box-shadow .2s; } }
</style>
<div class="wrap">
  <header>
    ${name ? `<span class="eyebrow">${esc(name)}</span>` : ""}
    <h1>Entregas</h1>
    <p class="lead">Tudo o que foi entregue, mês a mês: o que mudou, o PR no GitHub, as horas estimadas e os tokens de IA usados no desenvolvimento.</p>
  </header>
  <nav class="tabs" aria-label="Meses">${tabs}</nav>
  ${sections || `<p class="empty">Nenhuma entrega registrada ainda.</p>`}
  <footer>
    <span>Atualizado em ${esc(updated)}.</span>
    <span>Horas estimadas: o tempo que um desenvolvedor sênior levaria. Tokens: soma das sessões do Claude Code no branch de cada PR (entrada, saída e cache).</span>
  </footer>
</div>
<script>
(() => {
  const tabs = [...document.querySelectorAll(".tab")];
  const show = (month) => {
    const target = document.getElementById("m-" + month);
    if (!target) return false;
    document.querySelectorAll(".month").forEach((s) => (s.hidden = s !== target));
    tabs.forEach((t) => t.setAttribute("aria-current", String(t.dataset.month === month)));
    return true;
  };
  const fromHash = () => {
    const hash = location.hash.slice(1);
    if (hash.startsWith("m-")) return show(hash.slice(2));
    if (hash.startsWith("pr-")) {
      const card = document.getElementById(hash);
      const section = card && card.closest(".month");
      if (section) show(section.id.slice(2));
    }
  };
  tabs.forEach((t) => t.addEventListener("click", (event) => {
    event.preventDefault();
    show(t.dataset.month);
    try { history.replaceState(null, "", "#m-" + t.dataset.month); } catch (e) {}
  }));
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    const card = document.querySelector(c.getAttribute("href"));
    if (card) card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
  fromHash();
  addEventListener("hashchange", fromHash);
})();
</script>
`;
}
