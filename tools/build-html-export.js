// Builds js/html-export-assets.js: the stylesheet and layout engine that every exported HTML project
// carries (so the export works on its own). It copies css/style.css (page part) and js/paginate.js.
// Run again after changing either of those:   node tools/build-html-export.js
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(dir, "css/style.css"), "utf8");
const pageCss = css.split("/* ===== App shell")[0].trim();
let paginate = fs.readFileSync(path.join(dir, "js/paginate.js"), "utf8");
// heights include the block's margins (boxes, tables and shaded paragraphs have a bottom margin)
const HEIGHT = "static height(e) { return e.getBoundingClientRect().height; }";
if (!paginate.includes(HEIGHT)) throw new Error("paginate.js changed: update the height patch in tools/build-html-export.js");
// a box may also break inside its table (a one-cell box around a long table has only that one child)
const patches = [
  ["    if (kids.length < 2) return null;\n    const top = box.getBoundingClientRect().top;\n    let k = 0;", "    if (!kids.length) return null;\n    const top = box.getBoundingClientRect().top;\n    let k = 0;"],
  ['if (next && next.dataset.split === "text") {', 'if (next && (next.dataset.split === "text" || next.dataset.split === "table")) {'],
  ["if (limit - used >= 34) cut = splitText(next, limit - used - 1);", 'if (limit - used >= 34) cut = (next.dataset.split === "table" ? splitTable : splitText)(next, limit - used - 1);'],
];
for (const [a, b] of patches) {
  if (!paginate.includes(a)) throw new Error("paginate.js changed: update the patches in tools/build-html-export.js (" + a.slice(0, 40) + ")");
  paginate = paginate.replace(a, b);
}
paginate = paginate.replace(HEIGHT, "static height(e) { const cs = getComputedStyle(e); return e.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0); }");

const STYLE = `/* Page and content styles. Values mirror the Typst templates:
 *   page   8.5in x 10.6in, margins 0.68in / 0.58in        (page_setup_template.typ)
 *   MCQ    9pt, hanging indent 1.8em, option circles 13.05pt, answer circle 14.4pt   (tags/mcq.typ)
 *   CQ     10pt, sub-question indent 0.4in                 (tags/cq.typ)
 * Edit any value and reload index.html; the pages are laid out again. */

${pageCss}

/* ----- screen view and printing ----- */
body { margin: 0; background: #e9ebef; }
#pages { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 24px 16px 60px; }
#pages .page { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); }
.toolbar { position: fixed; top: 12px; right: 12px; z-index: 9; display: flex; gap: 8px; }
.toolbar button { font: 600 14px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px; border: 1px solid #c0392b; background: #c0392b; color: #fff; cursor: pointer; }
@page { size: 8.5in 10.6in; margin: 0; }
@media print {
  body { background: #fff; }
  .toolbar, #measure { display: none !important; }
  #pages { display: block; padding: 0; gap: 0; }
  #pages .page { box-shadow: none; break-after: page; }
  #pages .page:last-child { break-after: auto; }
}
`;

const SHIM = `/* Layout engine for this page: lays the content of #content out on fixed-size pages.
 * The page geometry is in Paginator below (IN = 96 px); colours and sizes are in style.css. */
window.ASSETS = { headerLogo: "templates/header_logo.png", footerLogo: "templates/10ms-logo.png" };

// MCQ options: two per row, or one per row when they do not fit (the answer circle goes in front
// of the second row, beside গ when stacked)
window.Render = {
  layoutOptions(grid, mode) {
    const cells = grid._cells || (grid._cells = Array.from(grid.children).filter((c) => c.classList.contains("opt")));
    const n = cells.length, ans = grid.dataset.ans;
    grid.textContent = "";
    grid.dataset.mode = mode;
    const per = mode === "stacked" ? 1 : 2;
    const rows = [];
    for (let i = 0; i < n; i += per) rows.push(cells.slice(i, i + per));
    const ansRow = mode === "stacked" ? 2 : n === 5 ? 2 : 1;
    grid.style.gridTemplateColumns = (ans ? "auto " : "") + (per === 2 ? "1fr 1fr" : "1fr");
    rows.forEach((row, r) => {
      if (ans) {
        const a = document.createElement("div");
        a.className = "ans-cell";
        if (r === Math.min(ansRow, rows.length - 1)) { const c = document.createElement("span"); c.className = "ac"; c.textContent = ans; a.appendChild(c); }
        grid.appendChild(a);
      }
      row.forEach((c) => grid.appendChild(c));
      for (let k = row.length; k < per; k++) grid.appendChild(document.createElement("div"));
    });
  },
};
`;

const BOOT = `
// ---------- start: lay out every part of #content ----------
(async function () {
  const content = document.getElementById("content");
  await document.fonts.ready;
  for (const img of content.querySelectorAll("img")) if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
  const marks = content.querySelectorAll(".chapter");
  const pager = new Paginator(document.getElementById("pages"), document.getElementById("measure"), { label: marks[0] ? marks[0].dataset.label : "" });
  for (const el of Array.from(content.children)) {
    if (el.classList.contains("chapter")) { pager.setLabel(el.dataset.label); continue; }
    if (!el.classList.contains("flow")) continue;
    // the options grids are re-built from their cells
    for (const g of el.querySelectorAll(".opts")) window.Render.layoutOptions(g, g.dataset.mode || "pairs");
    await pager.flow({ type: el.dataset.type }, Array.from(el.children));
  }
  content.remove();
  document.getElementById("measure").textContent = "";
  document.documentElement.dataset.ready = String(pager.pageNo);
  window.__pages = pager.pageNo;
})();
`;

const out = `/* GENERATED by tools/build-html-export.js — do not edit by hand. */
window.HTMLExportAssets = {
  style: ${JSON.stringify(STYLE)},
  engine: ${JSON.stringify(SHIM + "\n" + paginate + "\n" + BOOT)},
};
`;
fs.writeFileSync(path.join(dir, "js/html-export-assets.js"), out);
console.log("wrote js/html-export-assets.js", out.length, "bytes");
