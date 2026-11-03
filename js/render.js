/* Document model -> DOM, styled like the Typst templates (page_setup_template.typ, tags/mcq.typ, tags/cq.typ).
 * Every top-level element carries data-split ("text" | "table" | "kids" | "none") and data-keepnext
 * for the paginator. */
(function (root) {
  "use strict";

  const OBJ = "";
  const EMU_PX = 9525;
  const C = () => root.Classify;

  // ---------- pictures: crop, optional greyscale, downscale; cached per picture + crop ----------
  const images = new Map(); // key -> { url, w, h } | null

  async function prepareImages(model, greyscale) {
    const jobs = [];
    const want = (target, crop) => {
      const key = target + "|" + (crop || []).join(",");
      if (!images.has(key)) { images.set(key, null); jobs.push({ key, target, crop }); }
    };
    const visit = (blocks) => {
      for (const b of blocks) {
        if (b.kind === "p") for (const it of b.items) { if (it.t === "img") want(it.target, it.crop); else if (it.t === "shape") shapePictures(it, want); }
        else if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) visit(c.blocks);
        else if (b.kind === "textbox") visit(b.blocks);
      }
    };
    visit(model.blocks);
    let done = 0;
    for (const j of jobs) {
      images.set(j.key, await loadImage(model, j.target, j.crop, greyscale));
      if (++done % 10 === 0 && root.App) root.App.progress(`Preparing pictures… ${done}/${jobs.length}`);
    }
  }

  function shapePictures(item, want) {
    const R = root.DocxReader.R;
    for (const blip of Array.from(item.el.getElementsByTagNameNS("*", "blip"))) {
      const rel = item.ctx.rels[blip.getAttributeNS(R, "embed")];
      if (!rel) continue;
      const rect = blip.parentNode && Array.from(blip.parentNode.children).find((c) => c.localName === "srcRect");
      want(rel.target, rect ? cropOf(rect) : null);
    }
  }
  const cropOf = (rect) => ["l", "t", "r", "b"].map((k) => (parseInt(rect.getAttribute(k) || "0", 10) || 0) / 100000);

  async function loadImage(model, target, crop, greyscale) {
    try {
      const media = await model.getMedia(target);
      if (!media || !media.mime) return null;
      if (media.mime === "image/svg+xml") return { url: URL.createObjectURL(new Blob([media.bytes], { type: media.mime })), w: 0, h: 0 };
      const bmp = await createImageBitmap(new Blob([media.bytes], { type: media.mime }));
      let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
      if (crop && crop.some((v) => v)) {
        const [l, t, r, b] = crop;
        const x0 = Math.round(sw * l), y0 = Math.round(sh * t), x1 = Math.round(sw * (1 - r)), y1 = Math.round(sh * (1 - b));
        if (x1 > x0 && y1 > y0) { sx = x0; sy = y0; sw = x1 - x0; sh = y1 - y0; }
      }
      const scale = Math.min(1, 2400 / Math.max(sw, sh));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(sw * scale));
      cv.height = Math.max(1, Math.round(sh * scale));
      const g = cv.getContext("2d");
      if (greyscale) g.filter = "grayscale(1)";
      g.drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      bmp.close && bmp.close();
      const type = media.mime === "image/jpeg" ? "image/jpeg" : "image/png";
      const blob = await new Promise((res) => cv.toBlob(res, type, 0.92));
      return { url: URL.createObjectURL(blob), w: cv.width, h: cv.height };
    } catch (e) {
      console.warn("picture skipped", target, e);
      return null;
    }
  }
  const imageFor = (target, crop) => images.get(target + "|" + (crop || []).join(",")) || null;

  // ---------- inline content ----------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function mathEl(tex, display) {
    const span = el(display ? "div" : "span", display ? "eq" : "m");
    try {
      root.katex.render(tex || "", span, { throwOnError: false, displayMode: !!display, strict: "ignore" });
    } catch (e) {
      span.textContent = tex;
    }
    return span;
  }

  function imgEl(it, opts) {
    const im = imageFor(it.target, it.crop);
    const wpx = it.cx ? it.cx / EMU_PX : 0, hpx = it.cy ? it.cy / EMU_PX : 0;
    if (!im) {
      const box = el("span", "img-missing", "picture (EMF/WMF) not shown");
      if (wpx) { box.style.width = wpx + "px"; box.style.height = Math.max(24, hpx) + "px"; }
      return box;
    }
    const img = el("img", "pic");
    img.src = im.url;
    img.alt = "";
    const w = wpx || im.w * 0.75, h = hpx || im.h * 0.75;
    if (w && h) { img.width = Math.round(w); img.height = Math.round(h); img.style.aspectRatio = `${w} / ${h}`; }
    if (opts && opts.maxH) img.style.maxHeight = opts.maxH;
    return img;
  }

  function shapeEl(it) {
    const reader = root.DocxReader;
    const readBox = (tb) => {
      const out = [];
      for (const c of Array.from(tb.children)) {
        if (c.localName === "p") out.push(...reader.readParagraph(c, it.ctx));
        else if (c.localName === "tbl") out.push(reader.readTable(c, it.ctx));
      }
      return out;
    };
    const renderBlocks = (blocks) => {
      const f = document.createDocumentFragment();
      for (const b of blocks) f.appendChild(b.kind === "table" ? tableEl(b, { inShape: true }) : paraEl(b, { inShape: true }));
      return f;
    };
    const pic = (rid, rect) => {
      const rel = it.ctx.rels[rid];
      const im = rel && imageFor(rel.target, rect ? cropOf(rect) : null);
      return im ? im.url : null;
    };
    const d = root.Shapes.render(it, readBox, renderBlocks, pic);
    const holder = el("span", "drawing-holder");
    holder.dataset.w = it.cx / EMU_PX;
    holder.dataset.h = it.cy / EMU_PX;
    holder.appendChild(d);
    return holder;
  }

  function textSpan(it, opts) {
    let node = document.createTextNode(it.text);
    const cls = [];
    const style = {};
    if (it.b) cls.push("b");
    if (it.i) cls.push("i");
    if (it.u) cls.push("u");
    if (it.s) cls.push("s");
    if (it.va === "sub" || it.va === "sup") cls.push(it.va);
    if (it.color && !/^0{6}$/.test(it.color)) style.color = "#" + it.color;
    if (it.bg) { style.backgroundColor = "#" + it.bg; cls.push("hl"); }
    if (opts && opts.keepSize && it.sz) style.fontSize = it.sz / 2 + "pt";
    else if (it.sz && it.sz <= 16 && !(opts && opts.noSmall)) cls.push("small");
    if (!cls.length && !Object.keys(style).length) return node;
    const s = el("span", cls.join(" "));
    Object.assign(s.style, style);
    s.appendChild(node);
    return s;
  }

  function inline(items, opts) {
    const f = document.createDocumentFragment();
    for (const it of items) {
      if (it.t === "text") f.appendChild(textSpan(it, opts));
      else if (it.t === "br") f.appendChild(el("br"));
      else if (it.t === "tab") f.appendChild(el("span", "tab"));
      else if (it.t === "math") f.appendChild(mathEl(it.tex, false));
      else if (it.t === "img" || it.t === "shape") {
        const e = it.t === "img" ? imgEl(it, opts) : shapeEl(it);
        // a floating picture in a paragraph of text: wrapped pictures float to their side, the rest get a line of their own
        // (a line or two of text cannot wrap around a picture; it would only leave a blank area beside it)
        if (it.floating && opts && opts.withText) e.classList.add(it.wrap && opts.withText === "long" ? "fl-" + it.wrap : "fl-block");
        f.appendChild(e);
      } else if (it.t === "missing") f.appendChild(el("span", "img-missing", it.what || "object"));
    }
    return f;
  }

  // ---------- blocks ----------
  const visible = (b) => C().clean(b);
  const onlyObjects = (b) => !visible(b) && b.items.some((i) => i.t === "img" || i.t === "shape" || i.t === "missing");

  function paraEl(b, opts) {
    opts = opts || {};
    const items = b.items;
    // a paragraph that is just a display equation
    const real = items.filter((i) => !(i.t === "text" && !i.text.trim()));
    if (real.length === 1 && real[0].t === "math" && real[0].display) {
      const e = mathEl(real[0].tex, true);
      e.dataset.split = "none";
      return e;
    }
    if (onlyObjects(b) && !opts.inShape) {
      const fig = el("div", "fig");
      fig.appendChild(inline(items, opts));
      fig.dataset.split = "none";
      return fig;
    }
    const p = el("p", "p");
    const pa = b.para || {};
    if (opts.inShape || opts.inCell) {
      p.classList.add(opts.inShape ? "in-shape" : "in-cell");
      if (pa.jc === "center") p.style.textAlign = "center";
      else if (pa.jc === "right" || pa.jc === "end") p.style.textAlign = "right";
      else p.style.textAlign = opts.inShape ? "left" : "left";
      p.appendChild(inline(items, opts.inShape ? { keepSize: true } : opts));
      return p;
    }
    if (pa.heading === 1) p.classList.add("h1");
    else if (pa.heading >= 2) p.classList.add("h2");
    if (pa.jc === "center") p.classList.add("center");
    else if (pa.jc === "right" || pa.jc === "end") p.classList.add("right");
    if (pa.shd) { p.classList.add("shd"); p.style.backgroundColor = "#" + pa.shd; }
    if (pa.border) p.classList.add("boxed");
    p.appendChild(inline(items, Object.assign({ withText: visible(b).length >= 150 ? "long" : "short" }, opts)));
    p.dataset.split = pa.heading || pa.shd ? "none" : "text";
    if (pa.heading || pa.keepNext || (pa.allBold && visible(b).length < 70)) p.dataset.keepnext = "1";
    return p;
  }

  // a one-cell table is a box around ordinary content; it may break between its paragraphs
  function cellBox(t) {
    const c = t.rows[0].cells[0];
    const box = el("div", "cellbox" + (t.bordered ? " bordered" : ""));
    if (c.fill) box.style.backgroundColor = "#" + c.fill;
    for (const b of c.blocks) {
      if (b.kind === "p" && !b.text.trim() && !b.items.length) continue;
      box.appendChild(block(b));
    }
    box.dataset.split = "kids";
    return box;
  }

  function tableEl(t, opts) {
    opts = opts || {};
    if (!opts.inShape && !opts.inCell && t.rows.length === 1 && t.rows[0].cells.length === 1 && t.rows[0].cells[0].span === 1) return cellBox(t);
    const table = el("table", "tbl" + (t.bordered ? "" : " plain") + (opts.inShape ? " in-shape" : ""));
    const ncols = Math.max(t.cols.length, ...t.rows.map((r) => r.cells.reduce((s, c) => s + c.span, 0)));
    const total = t.cols.reduce((a, b) => a + b, 0);
    if (t.cols.length === ncols && total > 0) {
      const cg = el("colgroup");
      for (const w of t.cols) { const c = el("col"); c.style.width = (100 * w / total).toFixed(2) + "%"; cg.appendChild(c); }
      table.appendChild(cg);
    }
    const tbody = el("tbody");
    // vertical merges: count how many rows each "restart" cell spans
    const grid = t.rows.map((r) => { let col = 0; return r.cells.map((c) => { const o = { c, col }; col += c.span; return o; }); });
    t.rows.forEach((r, ri) => {
      const tr = el("tr");
      grid[ri].forEach(({ c, col }) => {
        if (c.vmerge === "continue") return;
        const td = el("td");
        if (c.span > 1) td.colSpan = c.span;
        if (c.vmerge === "restart") {
          let rs = 1;
          for (let k = ri + 1; k < grid.length; k++) {
            const below = grid[k].find((x) => x.col === col);
            if (below && below.c.vmerge === "continue") rs++; else break;
          }
          if (rs > 1) td.rowSpan = rs;
        }
        if (c.fill) td.style.backgroundColor = "#" + c.fill;
        else if (ri === 0 && t.bordered && t.rows.length > 1) td.classList.add("head");
        if (ri === 0 && t.bordered && t.rows.length > 1) td.classList.add("row0");
        if (c.valign === "top") td.style.verticalAlign = "top";
        else if (c.valign === "bottom") td.style.verticalAlign = "bottom";
        for (const b of c.blocks) {
          if (b.kind === "table") td.appendChild(tableEl(b, opts));
          else if (b.kind === "p" && (b.text.trim() || b.items.length)) td.appendChild(onlyObjects(b) ? figInCell(b) : paraEl(b, { inCell: true, inShape: opts.inShape }));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    table.dataset.split = "table";
    return table;
  }
  function figInCell(b) {
    const d = el("div", "fig in-cell");
    d.appendChild(inline(b.items));
    return d;
  }

  function block(b, opts) {
    if (b.kind === "p") return paraEl(b, opts);
    if (b.kind === "table") return tableEl(b, opts);
    if (b.kind === "textbox") {
      const box = el("div", "textbox");
      for (const x of b.blocks) box.appendChild(x.kind === "table" ? tableEl(x) : paraEl(x, { inCell: true }));
      box.dataset.split = "none";
      return box;
    }
    return el("div");
  }

  // ---------- MCQ ----------
  const circle = (letter) => el("span", "oc", letter);
  const ansCircle = (letter) => el("span", "ac", letter);

  // "(ক)" anywhere in MCQ text becomes an open circle (Typst: show "(ক)": opt-circle("ক"))
  function circled(frag) {
    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\(\s*[কখগঘঙ]\s*\)/.test(n.data)) hits.push(n);
    for (const n of hits) {
      const parts = n.data.split(/\(\s*([কখগঘঙ])\s*\)/);
      const f = document.createDocumentFragment();
      parts.forEach((s, k) => { if (k % 2) f.appendChild(circle(s)); else if (s) f.appendChild(document.createTextNode(s)); });
      n.parentNode.replaceChild(f, n);
    }
    return frag;
  }

  function mcqPara(b, cls) {
    const p = paraEl(b);
    p.classList.add("mq-line");
    if (cls) p.classList.add(cls);
    circled(p);
    return p;
  }

  function optionsGrid(opts, answer) {
    const grid = el("div", "opts");
    const cells = opts.map((o) => {
      const c = el("div", "opt");
      c.appendChild(circle(o.letter));
      c.appendChild(document.createTextNode(" "));
      const body = el("span", "opt-body");
      body.appendChild(circled(inline(o.items)));
      c.appendChild(body);
      return c;
    });
    const firstLen = C().itemsText(opts[0].items).replace(new RegExp(OBJ, "g"), "").trim().length;
    const hasPic = opts.some((o) => o.items.some((i) => i.t === "img" || i.t === "shape"));
    grid.dataset.n = opts.length;
    grid.dataset.ans = answer || "";
    grid._cells = cells;
    layoutOptions(grid, firstLen > 20 && !hasPic && opts.length <= 4 ? "stacked" : "pairs");
    return grid;
  }

  // Typst: mcq-options / -stacked / -5, and the -with-ans variants that put the black answer
  // circle in an extra first column beside the second option row (beside "গ" when stacked)
  function layoutOptions(grid, mode) {
    const cells = grid._cells, n = cells.length, ans = grid.dataset.ans;
    grid.textContent = "";
    grid.dataset.mode = mode;
    const per = mode === "stacked" ? 1 : 2;
    const rows = [];
    for (let i = 0; i < n; i += per) rows.push(cells.slice(i, i + per));
    const ansRow = mode === "stacked" ? 2 : n === 5 ? 2 : 1;
    grid.style.gridTemplateColumns = (ans ? "auto " : "") + (per === 2 ? "1fr 1fr" : "1fr");
    rows.forEach((row, r) => {
      if (ans) {
        const a = el("div", "ans-cell");
        if (r === Math.min(ansRow, rows.length - 1)) a.appendChild(ansCircle(ans));
        grid.appendChild(a);
      }
      row.forEach((c) => grid.appendChild(c));
      for (let k = row.length; k < per; k++) grid.appendChild(el("div"));
    });
  }

  function mcqUnit(u) {
    if (u.u === "other") {
      const e = block(u.block);
      if (u.block.kind === "p") { e.classList.add("mq-line"); circled(e); }
      return e;
    }
    const box = el("div", "mq");
    box.dataset.split = "kids";
    if (u.u === "stim") {
      const h = mcqPara(u.header, "mq-stim-head");
      h.dataset.keepnext = "1";
      box.appendChild(h);
      for (const b of u.passage) {
        if (b.kind !== "p") { box.appendChild(block(b)); continue; }
        const s = C().splitSource(b.items);
        const p = mcqPara(Object.assign({}, b, { items: s.body }), "mq-passage");
        if (s.source) p.appendChild(sourceEl(s.source));
        box.appendChild(p);
      }
      box.classList.add("mq-stim");
      return box;
    }
    const title = mcqPara(Object.assign({}, u.title, { items: u.titleItems }), "mq-title");
    if (u.source) title.appendChild(sourceEl(u.source));
    box.appendChild(title);
    for (const b of u.extras) box.appendChild(b.kind === "p" ? mcqPara(b, ROMAN.test(C().clean(b)) ? "mq-roman" : "") : block(b));
    if (u.options) box.appendChild(optionsGrid(u.options, u.answer));
    else {
      for (const b of u.optParas) box.appendChild(b.kind === "p" ? mcqPara(b) : block(b));
      if (u.answer) { const a = el("p", "p mq-line"); a.append("উত্তর: ", ansCircle(u.answer)); box.appendChild(a); }
    }
    for (const b of u.after) box.appendChild(b.kind === "p" ? mcqPara(b) : block(b));
    return box;
  }
  const ROMAN = /^\s*(i{1,3}|iv|v|vi{0,3})\s*[.)]\s*/i;

  function sourceEl(items) {
    const s = el("span", "src");
    s.appendChild(inline(items, { noSmall: true }));
    return s;
  }

  // ---------- CQ ----------
  function cqBlock(b, role) {
    const e = block(b);
    if (b.kind !== "p" || !role) return e;
    e.classList.add(role);
    if (role === "cq-section" || role === "cq-anshdr" || role === "cq-stem-label") e.dataset.keepnext = "1";
    if (role === "cq-section") e.dataset.split = "none";
    if (role === "cq-anshdr") e.classList.add("b");
    return e;
  }

  root.Render = { prepareImages, block, mcqUnit, cqBlock, layoutOptions, inline };
})(typeof globalThis !== "undefined" ? globalThis : this);
