/* .docx -> HTML + CSS project:
 *   index.html   the content (one element per block, grouped into normal / mcq / cq parts)
 *   style.css    page, header/footer, MCQ and CQ styles (the Typst template values)
 *   engine.js    lays the content out on pages when index.html opens
 *   fonts.css    Kalpurush, embedded          images/  pictures      templates/  logos
 * Open index.html in Chrome to see the pages; print it to save a PDF. */
(function (root) {
  "use strict";

  const C = () => root.Classify;
  const R = () => root.Render;
  const escAttr = (s) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  function unitsFor(seg) {
    if (seg.type === "mcq") return C().mcqUnits(seg.blocks).map((u) => R().mcqUnit(u));
    if (seg.type === "cq") {
      const roles = C().cqRoles(seg.blocks);
      return seg.blocks.map((b, i) => R().cqBlock(b, roles[i]));
    }
    return seg.blocks.map((b) => R().block(b));
  }

  async function generate(model, segs, opts) {
    opts = opts || {};
    await R().prepareImages(model, opts.greyscale !== false);

    const binaries = {};
    const byUrl = new Map();
    let n = 0;
    async function file(url) {
      if (byUrl.has(url)) return byUrl.get(url);
      const blob = await (await fetch(url)).blob();
      const ext = /svg/.test(blob.type) ? "svg" : /jpeg/.test(blob.type) ? "jpg" : "png";
      const p = `images/image${++n}.${ext}`;
      binaries[p] = new Uint8Array(await blob.arrayBuffer());
      byUrl.set(url, p);
      return p;
    }

    // A drawing sits inside a paragraph; written out as <div>/<p> it would not survive being read back
    // (a <div> or <p> inside a <p> closes that paragraph), so its parts become <span>s with the same classes
    function spanify(scope) {
      const els = Array.from(scope.querySelectorAll(".drawing-holder div, .drawing-holder p"));
      for (const el of els.reverse()) {
        const s = document.createElement("span");
        for (const a of Array.from(el.attributes)) s.setAttribute(a.name, a.value);
        if (!/display\s*:/.test(s.getAttribute("style") || "") && !el.classList.contains("shape-text")) s.style.display = "block";
        while (el.firstChild) s.appendChild(el.firstChild);
        el.replaceWith(s);
      }
    }

    const out = [];
    for (const seg of segs) {
      if (seg.type === "section") { out.push(`<div class="chapter" data-label="${escAttr(seg.label)}"></div>`); continue; }
      const units = unitsFor(seg);
      const holder = document.createElement("div");
      const seen = [];
      for (const u of units) {
        for (const img of u.querySelectorAll ? u.querySelectorAll("img") : []) if (/^blob:/.test(img.src)) seen.push(img.src);
        if (u.tagName === "IMG" && /^blob:/.test(u.src)) seen.push(u.src);
        holder.appendChild(u);
      }
      spanify(holder);
      // pictures: from in-memory addresses to files in images/ (in the text only, so this page loads nothing)
      let html = Array.from(holder.children).map((c) => c.outerHTML).join("\n");
      for (const url of seen) html = html.split(url).join(await file(url));
      const label = { normal: "Normal text (one column)", mcq: "MCQ part (two columns, tags/mcq.typ styling)", cq: "CQ part (two columns, tags/cq.typ styling)" }[seg.type];
      out.push(`\n<!-- ${label} -->\n<section class="flow" data-type="${seg.type}">\n${html}\n</section>`);
    }

    const title = escAttr(opts.name || "Document");
    const index = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!-- Equations are drawn with KaTeX -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="toolbar"><button onclick="print()">Print / Save as PDF</button></div>

<!-- The pages are built here from #content when the file opens (engine.js). -->
<div id="pages"></div>
<div id="measure"></div>

<!--
  Content of ${title}. Each block is one element: <p class="p"> paragraph, <table class="tbl">,
  <div class="fig"> picture, <div class="mq"> MCQ question, <div class="opts"> its options
  (data-ans = the correct option). Edit the text freely; keep the element structure.
  A <div class="chapter" data-label="..."> starts a new chapter (its text goes in the page header).
-->
<main id="content">
${out.join("\n")}
</main>

<script src="engine.js"></script>
</body>
</html>
`;
    const b64 = (u) => { const bin = atob(u.split(",")[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
    binaries["templates/header_logo.png"] = b64(root.ASSETS.headerLogo);
    binaries["templates/10ms-logo.png"] = b64(root.ASSETS.footerLogo);
    const fonts = `/* Kalpurush, embedded so the page also works when opened straight from disk */\n@font-face { font-family: "Kalpurush"; src: url("${root.ASSETS.kalpurush}") format("truetype"); }\n`;
    return {
      files: { "index.html": index, "style.css": root.HTMLExportAssets.style, "engine.js": root.HTMLExportAssets.engine },
      extraText: { "fonts.css": fonts },
      binaries,
    };
  }

  root.HTMLGen = { generate };
})(typeof globalThis !== "undefined" ? globalThis : this);
