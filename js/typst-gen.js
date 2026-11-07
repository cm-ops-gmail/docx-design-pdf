/* .docx -> Typst project:
 *   main.typ                 the document (one block per line)
 *   page_setup_template.typ  base tokens, page geometry, running header/footer, option grids, helpers
 *   tags/mcq.typ, tags/cq.typ   MCQ / CQ styling
 *   media/                   pictures from the document      templates/  logos      fonts/  Kalpurush
 * Written straight from the document model (no Pandoc, no text patching). Every block line has a
 * plain-text fallback, so a line the compiler rejects can be swapped for its text (see typst-app.js). */
(function (root) {
  "use strict";

  const OBJ = "";
  const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const C = () => root.Classify;
  const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const pt = (n) => (Math.round(n * 100) / 100) + "pt";
  const EMU_PT = 12700;
  // text width of the Typst page (8.5in - 2 x 0.58in) and of one column of #columns(2) (4% gutter), points
  const COL1 = 528.48, COL2 = (COL1 * 0.96) / 2;

  // ---------- markup escaping ----------
  // every character with a meaning in Typst markup gets a backslash
  const SPECIAL = /[\\#*_`$\[\]<>@~=+\-\/'"]/g;
  const esc = (s) => s.replace(SPECIAL, (c) => "\\" + c);

  // ---------- pictures ----------
  // Named the Python converter's way: <class>_<subject>_ch<NN>_img<NNN>, numbered in document order.
  // media/ holds the greyscale PNG, media_color/ the same picture in colour under the same name; main.typ
  // refers to them as  media-folder + "/name"  (media-folder is set in page_setup_template.typ).
  function mediaPrefix(o) {
    return `${o.className || "Class 9-10"}_${o.subjectName || "Math"}_ch${String(parseInt(o.chapterNumber, 10) || 1).padStart(2, "0")}`.replace(/ /g, "_").toLowerCase();
  }

  // class, subject and chapter guessed from a file name such as "Physics 2nd_Chapter 08_HSC 28 MB_Version 03"
  function guessMeta(fileName) {
    const parts = String(fileName || "").replace(/\.(docx|docm)$/i, "").split(/_+/).map((x) => x.trim()).filter(Boolean);
    const out = {};
    for (const p of parts) {
      const ch = /\b(?:chapter|ch|অধ্যায়)\s*[-.]?\s*(\d+)/i.exec(p);
      if (ch && !out.chapterNumber) { out.chapterNumber = parseInt(ch[1], 10); continue; }
      const cl = /^(class\s*[\d-]+|hsc|ssc|jsc|psc|admission)\b/i.exec(p);
      if (cl && !out.className) { out.className = cl[1].replace(/^(hsc|ssc|jsc|psc)$/i, (x) => x.toUpperCase()); continue; }
      if (!out.subjectName && !/version|\bmb\b|^v\d/i.test(p)) out.subjectName = p;
    }
    return out;
  }

  function createMedia(model, prefix) {
    const files = {};      // path -> Uint8Array
    const byKey = new Map();
    let n = 0;
    const next = (ext) => `${prefix}_img${String(++n).padStart(3, "0")}.${ext}`;
    async function get(target, crop) {
      const key = target + "|" + (crop || []).join(",");
      if (byKey.has(key)) return byKey.get(key);
      const job = (async () => {
        const m = await model.getMedia(target);
        if (!m || !m.mime) return null;
        if (m.mime === "image/svg+xml") { const name = next("svg"); files["media/" + name] = files["media_color/" + name] = m.bytes; return { name }; }
        try {
          const bmp = await createImageBitmap(new Blob([m.bytes], { type: m.mime }));
          let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
          if (crop && crop.some((v) => v)) {
            const [l, t, r, b] = crop;
            const x0 = Math.round(sw * l), y0 = Math.round(sh * t), x1 = Math.round(sw * (1 - r)), y1 = Math.round(sh * (1 - b));
            if (x1 > x0 && y1 > y0) { sx = x0; sy = y0; sw = x1 - x0; sh = y1 - y0; }
          }
          const whole = sx === 0 && sy === 0 && sw === bmp.width && sh === bmp.height;
          const scale = Math.min(1, 2400 / Math.max(sw, sh));
          const draw = async (grey) => {
            const cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(sw * scale)); cv.height = Math.max(1, Math.round(sh * scale));
            const g = cv.getContext("2d");
            if (grey) g.filter = "grayscale(1)";
            g.drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
            return new Uint8Array(await (await new Promise((r) => cv.toBlob(r, "image/png"))).arrayBuffer());
          };
          // PNG in both folders, so switching media-folder never breaks a path
          const name = next("png");
          files["media/" + name] = await draw(true);
          files["media_color/" + name] = whole && m.mime === "image/png" ? m.bytes : await draw(false);
          return { name };
        } catch (e) { return null; }
      })();
      byKey.set(key, job);
      return job;
    }
    // a picture's path as Typst code
    const src = (im) => `media-folder + ${q("/" + im.name)}`;
    return { get, files, src };
  }

  // ---------- generator ----------
  async function generate(model, segs, opts) {
    opts = opts || {};
    const meta = Object.assign(guessMeta(opts.name), Object.fromEntries(Object.entries(opts.meta || {}).filter(([, v]) => v)));
    const media = createMedia(model, mediaPrefix(meta));
    let zone = "normal";     // "normal" | "mcq" | "cq": the part being written
    const lines = [];        // main.typ body lines
    const fallback = [];     // same index: plain text that can replace the line, or null
    const warnings = [];
    const push = (line, plain) => { lines.push(line); fallback.push(plain == null ? null : plain); };
    const blank = () => { if (lines.length && lines[lines.length - 1] !== "") push("", null); };

    // equations come out of the reader as LaTeX; for Typst they are converted again from the XML
    function mathQueue(b) {
      if (!b || !b.node) return [];
      const inFallback = (n) => { for (let a = n.parentNode; a && a !== b.node; a = a.parentNode) if (a.localName === "Fallback" || a.localName === "txbxContent") return true; return false; };
      return Array.from(b.node.getElementsByTagNameNS(M, "oMath")).filter((m) => !inFallback(m));
    }

    async function picture(it, block) {
      const im = await media.get(it.target, it.crop);
      const w = it.cx ? it.cx / EMU_PT : 0;
      if (!im) { warnings.push("A picture in EMF/WMF format was left out (Typst cannot draw it)."); return `#box(stroke: 0.5pt + gray, inset: 3pt)[#text(size: 7pt, fill: gray)[picture]]`; }
      if (block) return `#pic(${media.src(im)}, ${w ? pt(w) : "100%"})`;
      return `#box(image(${media.src(im)}${w ? ", width: " + pt(w) : ""}))`;
    }

    // link every equation item to its XML (cut-out pieces such as MCQ options keep the same item objects)
    const mathOf = new WeakMap();
    function register(blocks) {
      for (const b of blocks) {
        if (b.kind === "p") { const qd = mathQueue(b); b.items.filter((i) => i.t === "math").forEach((it, k) => qd[k] && mathOf.set(it, qd[k])); }
        else if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) register(c.blocks);
        else if (b.kind === "textbox") register(b.blocks);
      }
    }
    for (const s of segs) register(s.blocks);

    // A row of figures is often captioned by one line below it, the labels separated by tabs
    // ("Fig: COBE <tab><tab> Fig: WMAP <tab><tab> Fig: Planck"): each label then goes under its figure.
    const rowCaptionPass = () => {
      for (const s of segs) {
        const bs = s.blocks;
        for (let k = 0; k < bs.length; k++) {
          if (bs[k].kind !== "p") continue;
          const row = rowOf(floatsOf(bs[k]));
          if (row.length < 2) continue;
          for (let j = k + 1; j < Math.min(bs.length, k + 12); j++) {
            const c = bs[j];
            if (c.kind !== "p") break;
            if (!plainOf(c)) continue;
            const groups = [[]];
            for (const it of c.items) { if (it.t === "tab") { if (groups[groups.length - 1].length) groups.push([]); } else groups[groups.length - 1].push(it); }
            const parts = groups.filter((g) => g.some((i) => i.t !== "text" || i.text.trim()));
            if (parts.length === row.length && plainOf(c).length < 40 * row.length) { bs[k].rowCaptions = parts; c.captionOf = bs[k]; }
            break;
          }
        }
      }
    };

    // A caption is often a separate floating text box, anchored a few paragraphs below its picture but placed
    // right under it (same left edge). Pair it with the picture so both stay together.
    const isTextBox = (i) => i.t === "shape" && i.floating && i.el && i.el.localName === "wsp" && i.el.getElementsByTagNameNS("*", "txbxContent").length > 0;
    for (const s of segs) {
      const bs = s.blocks;
      for (let k = 0; k < bs.length; k++) {
        if (bs[k].kind !== "p") continue;
        for (const f of bs[k].items) {
          if (!(f.floating && f.x != null && (f.t === "img" || (f.t === "shape" && !isTextBox(f))))) continue;
          for (let j = k; j < Math.min(bs.length, k + 6) && !f.caption; j++) {
            if (bs[j].kind !== "p") continue;
            const c = bs[j].items.find((i) => i !== f && isTextBox(i) && !i.consumed && i.x != null && i.cy / EMU_PT < 50 &&
              Math.abs(i.x - f.x) < 20 && i.cx <= f.cx * 1.4 + 20 * EMU_PT && (j > k || (i.dy || 0) >= (f.dy || 0) + f.cy / EMU_PT - 30));
            if (c) { f.caption = c; c.consumed = true; }
          }
        }
      }
    }

    // inline content of a paragraph on one line
    async function inline(items, b, o) {
      o = o || {};
      if (b) register([b]);
      const pieces = [];
      let afterCode = false;
      const add = (s, code) => {
        if (afterCode && /^[.(]/.test(s)) s = "\\" + s;
        pieces.push(s);
        afterCode = code;
      };
      for (const it of items) {
        if (it.t === "text") {
          if (!it.text) continue;
          let s = esc(it.text).replace(/\n/g, " #linebreak() ");
          let code = false;
          const wrap = (fn) => { s = `${fn}[${s}]`; code = true; };
          if (it.va === "sub") wrap("#sub");
          else if (it.va === "sup") wrap("#super");
          if (o.keepSize && it.sz) wrap(`#text(size: ${pt(it.sz / 2)})`);
          else if (it.sz && it.sz <= 16 && !o.noSmall) wrap("#text(size: 0.8em)");
          if (it.color && !/^0{6}$/i.test(it.color) && !/^auto$/i.test(it.color)) wrap(`#text(fill: rgb("#${it.color}"))`);
          if (it.b) wrap("#strong");
          if (it.i) wrap("#emph");
          if (it.u) wrap("#underline");
          if (it.s) wrap("#strike");
          if (it.bg) wrap(`#highlight(fill: rgb("#${it.bg}"))`);
          add(s, code);
        } else if (it.t === "br") add(" #linebreak() ", true);
        else if (it.t === "tab") add("#h(2em)", true);
        else if (it.t === "math") {
          const om = mathOf.get(it);
          const body = om ? root.OMMLTypst.typst(om, { display: it.display || o.lone }) : q(it.tex || "");
          // an equation alone in its paragraph: Word draws it full size (display style) where the paragraph puts it
          add(it.display ? `$ ${body} $` : o.lone ? `$display(${body})$` : `$${body}$`, true);
        } else if (it.t === "img") add(await picture(it, false), true);
        else if (it.t === "shape") { if (o.shapes && !it.consumed) o.shapes.push(it); }
        else if (it.t === "missing") add(`#box(stroke: 0.5pt + gray, inset: 3pt)[#text(size: 7pt, fill: gray)[${esc(it.what || "object")}]]`, true);
      }
      let s = pieces.join("").replace(/[ \t]+/g, " ").trim();
      s = s.replace(/^(\d+)\./, "$1\\."); // "1." at the start would be a numbered list
      return s;
    }

    const plainOf = (b) => (b && b.kind === "p" ? C().clean(b) : "");
    const fb = (text) => `#${q(text)}`;
    // the paragraph holds one inline equation and nothing else
    const loneMath = (items) => { const real = items.filter((i) => !(i.t === "text" && !i.text.trim()) && i.t !== "shape" && !(i.t === "img" && i.floating)); return real.length === 1 && real[0].t === "math" && !real[0].display; };

    // a paragraph cut into words (each keeps its formatting), for wrapping text around a picture
    async function wordsOf(items, b) {
      const words = [];
      let cur = [];
      const flush = () => { if (cur.length) { words.push(cur.join("")); cur = []; } };
      const lone = loneMath(items);
      for (const it of items) {
        if (it.t === "text") {
          for (const part of it.text.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { flush(); continue; }
            cur.push(await inline([Object.assign({}, it, { text: part })], b));
          }
        } else if (it.t === "br") { flush(); words.push("#linebreak()"); }
        else if (it.t === "tab") flush();
        else if (it.t !== "shape") cur.push(await inline([it], b, { lone }));
      }
      flush();
      return words.filter(Boolean);
    }

    // ---------- text flowing beside a floating picture or drawing (Word's square wrapping) ----------
    const wrapFloat = (b) => (b && b.kind === "p" && plainOf(b) && rowOf(floatsOf(b)).length < 2 ? b.items.find((i) => (i.t === "img" || i.t === "shape") && i.floating && i.wrap && !i.consumed) : null);
    // the paragraphs after blocks[k] that Word keeps beside its floating picture f: as many lines as the
    // picture is tall (10pt Kalpurush: ~12pt lines, ~4.8pt a character), one or two more to be safe. Any that
    // do not fit beside it in Typst simply continue full width underneath.
    function followersFor(blocks, k, f, colW) {
      const pw = f.cx / EMU_PT, ph = f.cy / EMU_PT + (f.dy || 0) + (f.caption ? f.caption.cy / EMU_PT : 0);
      const perLine = Math.max(8, (colW - pw - 9) / 4.8);
      const lines = (x) => (loneMath(x.items) ? (/frac|sqrt|\//.test((x.items.find((i) => i.t === "math") || {}).tex || "") ? 2.5 : 1.4) : Math.max(1, Math.ceil(plainOf(x).length / perLine)));
      const ok = (x) => x && x.kind === "p" && (plainOf(x) || loneMath(x.items)) && !x.para.heading && !x.para.shd && !x.para.border && !wrapFloat(x) &&
        !x.items.some((i) => i.t === "img" || i.t === "shape" || (i.t === "math" && i.display));
      let used = lines(blocks[k]);
      const room = ph / 12.1 + 1.5;
      const out = [];
      while (used < room && ok(blocks[k + 1 + out.length])) { const nb = blocks[k + 1 + out.length]; out.push(nb); used += lines(nb); }
      return out;
    }

    // a normal paragraph (or picture line) -> one line
    // a floating picture or drawing as code-mode content, with its caption text box under it
    async function floatFig(f) {
      const base = f.t === "shape" ? await drawing(f, { raw: true }) : (await picture(f, false)).slice(1);
      if (!f.caption) return base;
      const cap = await drawing(f.caption, { raw: true });
      return cap ? `stack(spacing: 2pt, ${base}, ${cap})` : base;
    }

    const floatsOf = (b) => b.items.filter((i) => !i.consumed && ((i.t === "img" && i.floating) || (i.t === "shape" && i.floating && i.wrap)));

    // floats of one paragraph that sit side by side at about the same height (Word positions known)
    function rowOf(floats) {
      const known = floats.filter((f) => f.x != null && f.cx > 0);
      if (known.length < 2) return [];
      const span = (f) => [f.dy || 0, (f.dy || 0) + f.cy / EMU_PT];
      const first = span(known[0]);
      const row = known.filter((f) => { const [a, z] = span(f); return a < first[1] - 10 && z > first[0] + 10; });
      if (row.length < 2) return [];
      // side by side: no two of them overlap much across
      const xs = row.map((f) => [f.x, f.x + f.cx / EMU_PT]).sort((p, q) => p[0] - q[0]);
      for (let i = 1; i < xs.length; i++) if (xs[i][0] < xs[i - 1][1] - 20) return [];
      return row;
    }

    async function paragraph(b, o) {
      o = o || {};
      // floating pictures: square/tight wrapping -> text flows beside the picture (wrap-pic);
      // other floating pictures get a line of their own before the paragraph
      // floating drawings (labelled boxes such as a "given data" panel) wrap like pictures
      if (b.captionOf) return []; // a caption line already drawn under its row of figures
      // two or more floats at the same height (a row of figures): placed where Word puts them, under the text
      const row = o.inCell ? [] : rowOf(floatsOf(b));
      if (row.length >= 2) {
        const rest = Object.assign({}, b, { items: b.items.filter((i) => !row.includes(i)) });
        const out = plainOf(rest) || rest.items.some((i) => i.t === "img" || i.t === "shape") ? await paragraph(rest, o) : [];
        const colW = Math.max(...row.map((f) => f.colW || 0)) || COL1;
        const top = Math.min(...row.map((f) => f.dy || 0));
        const caps = b.rowCaptions || [];
        const byX = row.slice().sort((p, q) => p.x - q.x);
        const figs = [];
        for (const f of row) {
          let fig = await floatFig(f);
          const c = caps[byX.indexOf(f)];
          if (c && c.length) fig = `stack(spacing: 4pt, ${fig}, box(width: ${pt(f.cx / EMU_PT)}, align(center, [${await inline(c, null)}])))`;
          figs.push(`(${pt(f.x)}, ${pt((f.dy || 0) - top)}, ${fig})`);
        }
        out.push([`#float-row(${pt(colW)}, (${figs.join(", ")}))`, null]);
        return out;
      }
      const floats = !o.inCell && plainOf(b) ? floatsOf(b) : [];
      if (floats.length) {
        const out = [];
        for (const f of floats.filter((f) => !f.wrap)) out.push([`#align(center, ${(await picture(f, true)).slice(1)})`, null]);
        const wrapped = floats.filter((f) => f.wrap);
        let rest = Object.assign({}, b, { items: b.items.filter((i) => !floats.includes(i)) });
        if (!wrapped.length) return out.concat(await paragraph(rest, o));
        const f = wrapped[0];
        const followers = o.followers || [];
        // a drawing that starts a line or more below the top of its paragraph: that paragraph stays full
        // width above it and only the paragraphs after it go beside it
        let dy = f.t === "shape" ? f.dy || 0 : 0;
        if (dy >= 10 && followers.length) { out.push(...(await paragraph(rest, Object.assign({}, o, { followers: null })))); rest = null; dy = Math.max(0, dy - 16); }
        let words = rest ? await wordsOf(rest.items, b) : [];
        // Word keeps flowing the next paragraphs beside a picture taller than its own paragraph
        for (const nb of followers) words = words.concat(words.length ? ["#parbreak()"] : [], await wordsOf(nb.items, nb));
        let fig = await floatFig(f);
        if (dy >= 1) fig = `pad(top: ${pt(dy)}, ${fig})`;
        const min = f.t === "shape" ? ", min-text: 0.8in" : "";
        out.push([`#wrap-pic(${fig}, side: ${f.wrap === "left" ? "left" : "right"}${min}, (${words.map((w) => `[${w}]`).join(", ")},))`,
          (rest ? [b] : []).concat(followers).map(plainOf).join(" ")]);
        for (const g of wrapped.slice(1)) out.push(g.t === "shape" ? [await drawing(g), null] : [`#align(center, ${(await picture(g, true)).slice(1)})`, null]);
        return out;
      }
      const shapes = [];
      const real = b.items.filter((i) => !(i.t === "text" && !i.text.trim()));
      if (real.length === 1 && real[0].t === "math" && real[0].display) {
        const om = mathQueue(b)[0];
        return [[`$ ${om ? root.OMMLTypst.typst(om, { display: true }) : q(real[0].tex)} $`, plainOf(b) || null]];
      }
      const lone = loneMath(b.items);
      const onlyPics = !plainOf(b) && b.items.some((i) => i.t === "img" || i.t === "shape");
      if (onlyPics) {
        const out = [];
        for (const it of b.items) {
          if (it.t === "img") out.push([`#align(center, ${(await picture(it, true)).slice(1)})`, null]);
          else if (it.t === "shape" && !it.consumed) { const d = await drawing(it); if (d) out.push([d, null]); }
        }
        return out;
      }
      const pa0 = b.para || {};
      // a numbered paragraph in ordinary text: Word's indent, the label in the hanging space
      const listed = pa0.list && zone === "normal" && !o.inCell && b.items[0] && b.items[0].label;
      let s = await inline(listed ? b.items.slice(1) : b.items, b, { shapes, keepSize: o.keepSize, lone });
      if (listed && s) {
        const L = pa0.list;
        const lab = await inline([Object.assign({}, b.items[0], { text: b.items[0].text.replace(/[\s\u00a0]+$/, "") })], b);
        s = `#num-par(${pt(L.left)}, ${pt(L.hanging)}, ${L.jc === "right" ? "right" : L.jc === "center" ? "center" : "left"}, [${lab}], [${s}])`;
      }
      if (!s) { const out = []; for (const sh of shapes) { const d = await drawing(sh); if (d) out.push([d, null]); } return out; }
      const pa = b.para || {};
      if (o.prefix) s = o.prefix(s);
      if (!o.inCell && pa.heading) s = `#heading(level: ${Math.min(pa.heading, 3)})[${s}]`;
      else if (pa.jc === "center") s = `#align(center)[${s}]`;
      else if (pa.jc === "right" || pa.jc === "end") s = `#align(right)[${s}]`;
      if (!o.inCell && pa.shd) s = `#block(fill: rgb("#${pa.shd}"), inset: 8pt, width: 100%)[${s}]`;
      else if (!o.inCell && pa.border) s = `#block(stroke: 0.7pt, inset: 6pt, width: 100%)[${s}]`;
      const out = [[s, plainOf(b)]];
      for (const sh of shapes) { const d = await drawing(sh); if (d) out.push([d, null]); }
      return out;
    }

    async function blocksInline(blocks, o) {
      const parts = [];
      for (const b of blocks) {
        if (b.kind === "table") parts.push(await table(b));
        else if (b.kind === "textbox") parts.push(await box(b.blocks));
        else if (b.kind === "p") for (const [s] of await paragraph(b, o)) if (s) parts.push(s);
      }
      return parts.join(" #parbreak() ");
    }

    async function box(blocks) {
      return `#block(stroke: 0.7pt, inset: 6pt, width: 100%)[${await blocksInline(blocks, { inCell: true })}]`;
    }

    async function table(t) {
      if (t.rows.length === 1 && t.rows[0].cells.length === 1 && t.rows[0].cells[0].span === 1) {
        const c = t.rows[0].cells[0];
        const style = [`width: 100%`, `inset: 6pt`, t.bordered ? "stroke: 0.7pt" : null, c.fill ? `fill: rgb("#${c.fill}")` : null].filter(Boolean).join(", ");
        return `#block(${style})[${await blocksInline(c.blocks, { inCell: true })}]`;
      }
      const ncols = Math.max(t.cols.length, ...t.rows.map((r) => r.cells.reduce((s, c) => s + c.span, 0)), 1);
      const total = t.cols.reduce((a, b) => a + b, 0);
      const cols = t.cols.length === ncols && total > 0 ? t.cols.map((w) => Math.max(0.05, Math.round((100 * w) / total) / 100) + "fr") : new Array(ncols).fill("1fr");
      const cells = [];
      const grid = t.rows.map((r) => { let col = 0; return r.cells.map((c) => { const o = { c, col }; col += c.span; return o; }); });
      for (let ri = 0; ri < t.rows.length; ri++) {
        for (const { c, col } of grid[ri]) {
          if (c.vmerge === "continue") continue;
          let rs = 1;
          if (c.vmerge === "restart") for (let k = ri + 1; k < grid.length; k++) { const below = grid[k].find((x) => x.col === col); if (below && below.c.vmerge === "continue") rs++; else break; }
          const args = [];
          if (c.span > 1) args.push(`colspan: ${c.span}`);
          if (rs > 1) args.push(`rowspan: ${rs}`);
          if (c.fill) args.push(`fill: rgb("#${c.fill}")`);
          else if (ri === 0 && t.bordered && t.rows.length > 1) args.push("fill: luma(242)");
          if (ri === 0 && t.bordered && t.rows.length > 1) args.push("align: center + horizon");
          const body = await blocksInline(c.blocks, { inCell: true });
          cells.push(args.length ? `table.cell(${args.join(", ")})[${body}]` : `[${body}]`);
        }
      }
      return `#table(columns: (${cols.join(", ")}${cols.length === 1 ? "," : ""}), stroke: ${t.bordered ? "0.7pt + black" : "none"}, inset: 5pt, align: horizon + left, ${cells.join(", ")})`;
    }

    async function block(b, o) {
      if (b.kind === "table") return [[await table(b), null]];
      if (b.kind === "textbox") return [[await box(b.blocks), null]];
      if (b.kind === "p") return paragraph(b, o);
      return [];
    }

    // ---------- drawings (flowcharts, labelled boxes) -> placed Typst shapes ----------
    const kids = (el) => Array.from((el && el.children) || []);
    const nm = (el, n) => kids(el).find((c) => c.localName === n) || null;
    const desc = (el, n) => (el ? el.getElementsByTagNameNS("*", n)[0] || null : null);
    const num = (el, a) => parseInt((el && el.getAttribute(a)) || "0", 10) || 0;
    function xfrm(node) {
      const pr = nm(node, "spPr") || nm(node, "grpSpPr");
      const x = pr && nm(pr, "xfrm");
      if (!x) return null;
      const off = nm(x, "off"), ext = nm(x, "ext"), cho = nm(x, "chOff"), che = nm(x, "chExt");
      return { x: num(off, "x"), y: num(off, "y"), w: num(ext, "cx"), h: num(ext, "cy"), cx: num(cho, "x"), cy: num(cho, "y"), cw: num(che, "cx") || num(ext, "cx"), ch: num(che, "cy") || num(ext, "cy"), flipH: x.getAttribute("flipH") === "1", flipV: x.getAttribute("flipV") === "1", rot: num(x, "rot") / 60000 };
    }
    function color(fillEl) {
      const c = fillEl && kids(fillEl)[0];
      if (!c) return null;
      if (c.localName === "srgbClr") return `rgb("#${c.getAttribute("val")}")`;
      if (c.localName === "sysClr") return `rgb("#${c.getAttribute("lastClr") || (c.getAttribute("val") === "window" ? "FFFFFF" : "000000")}")`;
      if (c.localName === "prstClr") { const v = (c.getAttribute("val") || "").toLowerCase(); return v === "white" ? "white" : v === "black" ? "black" : /^(gray|grey|silver)$/.test(v) ? "luma(128)" : "black"; }
      if (c.localName === "schemeClr") {
        const v = c.getAttribute("val");
        let l = /^(bg1|lt1)$/.test(v) ? 1 : /^(tx1|dk1)$/.test(v) ? 0 : 0.5;
        for (const m of kids(c)) { const k = (parseInt(m.getAttribute("val"), 10) || 0) / 100000; if (m.localName === "lumMod") l *= k; else if (m.localName === "lumOff") l += k; }
        return `luma(${Math.round(Math.max(0, Math.min(1, l)) * 255)})`;
      }
      return null;
    }
    function paint(sp) {
      const spPr = nm(sp, "spPr"), style = nm(sp, "style");
      let fill = null, line = null, w = 0.75, head = false, tail = false, dash = false;
      if (spPr) {
        if (nm(spPr, "noFill")) fill = "none"; else if (nm(spPr, "solidFill")) fill = color(nm(spPr, "solidFill"));
        const ln = nm(spPr, "ln");
        if (ln) {
          if (ln.getAttribute("w")) w = num(ln, "w") / EMU_PT;
          if (nm(ln, "noFill")) line = "none"; else if (nm(ln, "solidFill")) line = color(nm(ln, "solidFill"));
          const he = nm(ln, "headEnd"), te = nm(ln, "tailEnd"), pd = nm(ln, "prstDash");
          head = !!he && he.getAttribute("type") && he.getAttribute("type") !== "none";
          tail = !!te && te.getAttribute("type") && te.getAttribute("type") !== "none";
          dash = !!pd && pd.getAttribute("val") !== "solid";
        }
      }
      if (fill === null) fill = style && num(nm(style, "fillRef"), "idx") > 0 ? "white" : "none";
      if (line === null) line = style && num(nm(style, "lnRef"), "idx") > 0 ? "black" : "none";
      const stroke = line === "none" ? "none" : `(paint: ${line}, thickness: ${pt(Math.max(0.4, w))}${dash ? ', dash: "dashed"' : ""})`;
      return { fill, stroke, head, tail, lineColor: line === "none" ? "black" : line };
    }

    // raw: a plain box at the Word size (code mode, no #) for wrap-pic, instead of a centred #fitbox line
    async function drawing(item, o) {
      const W = item.cx / EMU_PT, H = item.cy / EMU_PT;
      if (!(W > 0) || !(H > 0)) return "";
      const out = [];
      const texts = []; // text boxes (rect shapes with text): placed at the end
      const place = (x, y, what) => out.push(`#place(top + left, dx: ${pt(x)}, dy: ${pt(y)}, ${what})`);
      const arrow = (x0, y0, x1, y1, p) => {
        const a = Math.atan2(y1 - y0, x1 - x0), L = 5.5, Wd = 2.6;
        const bx = x1 - L * Math.cos(a), by = y1 - L * Math.sin(a);
        const pts = [[x1, y1], [bx + Wd * Math.sin(a), by - Wd * Math.cos(a)], [bx - Wd * Math.sin(a), by + Wd * Math.cos(a)]];
        place(0, 0, `polygon(fill: ${p.lineColor}, ${pts.map(([x, y]) => `(${pt(x)}, ${pt(y)})`).join(", ")})`);
      };
      const T0 = (top) => ({ ox: 0, oy: 0, sx: W / (top.cw || item.cx || 1), sy: H / (top.ch || item.cy || 1), cx: top.cx, cy: top.cy });
      const boxOf = (node, T) => {
        const x = xfrm(node);
        if (!x) return null;
        const x0 = T.ox + (x.x - T.cx) * T.sx, y0 = T.oy + (x.y - T.cy) * T.sy;
        return { x0, y0, w: x.w * T.sx, h: x.h * T.sy, xf: x };
      };
      const textOf = async (sp) => {
        const tb = desc(sp, "txbxContent");
        if (!tb) return "";
        const paras = [];
        for (const p of kids(tb)) if (p.localName === "p") paras.push(...root.DocxReader.readParagraph(p, item.ctx).filter((x) => x.kind === "p"));
        const parts = [];
        for (const p of paras) {
          const s = await inline(p.items, p, { keepSize: true });
          if (!s) continue;
          // Word aligns a text-box paragraph left unless it says otherwise
          const jc = p.para.jc;
          parts.push(jc === "right" || jc === "end" ? `#align(right)[${s}]` : jc === "center" ? `#align(center)[${s}]` : `#align(left)[${s}]`);
        }
        return parts.join(" #parbreak() ");
      };
      async function shape(sp, bx) {
        const geom = desc(nm(sp, "spPr"), "prstGeom");
        const prst = geom ? geom.getAttribute("prst") : "rect";
        const p = paint(sp);
        if (/^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5])$/.test(prst) || sp.localName === "cxnSp") {
          let x0 = bx.x0, y0 = bx.y0, x1 = bx.x0 + bx.w, y1 = bx.y0 + bx.h;
          if (bx.xf.flipH) [x0, x1] = [x1, x0];
          if (bx.xf.flipV) [y0, y1] = [y1, y0];
          // where the elbow of a bent connector sits (adj1, default halfway)
          const gd = geom && Array.from(geom.getElementsByTagNameNS("*", "gd")).find((g) => g.getAttribute("name") === "adj1");
          const adj = gd ? (parseInt((gd.getAttribute("fmla") || "").replace(/^val\s+/, ""), 10) || 50000) / 100000 : 0.5;
          let segs;
          if (prst === "bentConnector3") { const mx = x0 + (x1 - x0) * adj; segs = [[x0, y0, mx, y0], [mx, y0, mx, y1], [mx, y1, x1, y1]]; }
          else if (prst === "bentConnector2") segs = [[x0, y0, x1, y0], [x1, y0, x1, y1]];
          else if (/^bentConnector/.test(prst)) { const my = y0 + (y1 - y0) * adj; segs = [[x0, y0, x0, my], [x0, my, x1, my], [x1, my, x1, y1]]; }
          else segs = [[x0, y0, x1, y1]];
          // Word keeps many connectors as a rotated box (90° / 270°): turn the points about its centre
          if (bx.xf.rot) {
            const a = (bx.xf.rot * Math.PI) / 180, cx = bx.x0 + bx.w / 2, cy = bx.y0 + bx.h / 2;
            const rp = (x, y) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
            segs = segs.map(([a1, b1, c1, d1]) => [...rp(a1, b1), ...rp(c1, d1)]);
          }
          const st = p.stroke === "none" ? "0.75pt" : p.stroke;
          for (const [a, b, c, d] of segs) place(0, 0, `line(start: (${pt(a)}, ${pt(b)}), end: (${pt(c)}, ${pt(d)}), stroke: ${st})`);
          if (p.tail) { const s = segs[segs.length - 1]; arrow(s[0], s[1], s[2], s[3], p); }
          if (p.head) { const s = segs[0]; arrow(s[2], s[3], s[0], s[1], p); }
          return;
        }
        const body = await textOf(sp);
        const bodyPr = desc(sp, "bodyPr");
        const ins = (k, d) => ((bodyPr && bodyPr.getAttribute(k) != null ? num(bodyPr, k) : d) / EMU_PT);
        const inset = `(left: ${pt(ins("lIns", 91440))}, right: ${pt(ins("rIns", 91440))}, top: ${pt(ins("tIns", 45720))}, bottom: ${pt(ins("bIns", 45720))})`;
        const anchor = bodyPr && bodyPr.getAttribute("anchor");
        const v = anchor === "ctr" ? "horizon" : anchor === "b" ? "bottom" : "top";
        // lines measured down to the descender, so a box sized by its text holds all of it (same line pitch)
        const content = body ? `[#set par(leading: 0.1em, justify: false); #set text(bottom-edge: "descender"); #align(${v})[${body}]]` : "[]";
        const W2 = pt(bx.w), H2 = pt(bx.h);
        const poly = polygonFor(prst, bx.w, bx.h);
        if (poly) {
          place(bx.x0, bx.y0, `polygon(fill: ${p.fill}, stroke: ${p.stroke}, ${poly})`);
          if (body) place(bx.x0, bx.y0, `box(width: ${W2}, height: ${H2}, inset: ${inset})${content}`);
        } else if (/^(ellipse|flowChartConnector)$/.test(prst)) {
          place(bx.x0, bx.y0, `ellipse(width: ${W2}, height: ${H2}, fill: ${p.fill}, stroke: ${p.stroke}, inset: ${inset})${content}`);
        } else {
          const radius = /^(roundRect|flowChartAlternateProcess)$/.test(prst) ? pt(Math.min(bx.w, bx.h) * 0.16) : prst === "flowChartTerminator" ? pt(bx.h / 2) : "0pt";
          const r = `rect(width: ${W2}, height: ${H2}, fill: ${p.fill}, stroke: ${p.stroke}, radius: ${radius}, inset: ${inset})${content}`;
          // grown version: at least the Word height (the 0pt-wide box), taller when the text needs it
          const innerH = Math.max(0, bx.h - ins("tIns", 45720) - ins("bIns", 45720));
          if (body && o && o.raw) texts.push({ bx, r, grow: `rect(width: ${W2}, fill: ${p.fill}, stroke: ${p.stroke}, radius: ${radius}, inset: ${inset}${p.fill !== "none" && p.stroke === "none" ? ", outset: 0.5pt" : ""})[#grid(columns: (0pt, 1fr), box(height: ${pt(innerH)}), ${content})]` });
          else place(bx.x0, bx.y0, r);
        }
      }
      async function pic(node, bx) {
        const blip = desc(node, "blip");
        const rel = blip && item.ctx.rels[blip.getAttributeNS(R, "embed")];
        const rect = desc(node, "srcRect");
        const crop = rect ? ["l", "t", "r", "b"].map((k) => num(rect, k) / 100000) : null;
        const im = rel && await media.get(rel.target, crop);
        if (im) place(bx.x0, bx.y0, `image(${media.src(im)}, width: ${pt(bx.w)}, height: ${pt(bx.h)}, fit: "stretch")`);
      }
      async function group(g, T) {
        for (const c of kids(g)) {
          const n = c.localName;
          if (n === "wsp" || n === "sp" || n === "cxnSp") { const bx = boxOf(c, T); if (bx) await shape(c, bx); }
          else if (n === "pic") { const bx = boxOf(c, T); if (bx) await pic(c, bx); }
          else if (n === "grpSp") {
            const bx = boxOf(c, T);
            if (!bx) continue;
            const x = bx.xf;
            await group(c, { ox: bx.x0, oy: bx.y0, sx: bx.w / (x.cw || 1), sy: bx.h / (x.ch || 1), cx: x.cx, cy: x.cy });
          }
        }
      }
      if (item.el.localName === "wgp") await group(item.el, T0(xfrm(item.el) || { cx: 0, cy: 0, cw: item.cx, ch: item.cy }));
      else await shape(item.el, { x0: 0, y0: 0, w: W, h: H, xf: xfrm(item.el) || {} });
      // beside text (wrap-pic) a single text box may grow when its text is taller in Typst than in Word, so the
      // text flowing underneath never runs into it; it stays in the flow, at least as tall as the drawing
      if (o && o.raw && texts.length === 1) {
        const t = texts[0];
        // an invisible copy in the flow sets the height; the real one is placed last so it covers what is under it
        return `box(width: ${pt(W)})[#grid(columns: (0pt, auto), box(height: ${pt(H)}), hide(pad(left: ${pt(t.bx.x0)}, top: ${pt(t.bx.y0)}, ${t.grow}))) ${out.join(" ")} #place(top + left, dx: ${pt(t.bx.x0)}, dy: ${pt(t.bx.y0)}, ${t.grow})]`;
      }
      for (const t of texts) place(t.bx.x0, t.bx.y0, t.r);
      if (o && o.raw) return `box(width: ${pt(W)}, height: ${pt(H)})[${out.join(" ")}]`;
      return `#fitbox(${pt(W)}, ${pt(H)})[${out.join(" ")}]`;
    }
    function polygonFor(prst, w, h) {
      const P = (pts) => pts.map(([x, y]) => `(${pt(x)}, ${pt(y)})`).join(", ");
      const k = Math.min(w, h);
      switch (prst) {
        case "triangle": return P([[w / 2, 0], [w, h], [0, h]]);
        case "rtTriangle": return P([[0, 0], [w, h], [0, h]]);
        case "diamond": case "flowChartDecision": return P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
        case "rightArrow": { const a = Math.min(w / 2, h); return P([[0, h / 4], [w - a, h / 4], [w - a, 0], [w, h / 2], [w - a, h], [w - a, h * 0.75], [0, h * 0.75]]); }
        case "leftArrow": { const a = Math.min(w / 2, h); return P([[w, h / 4], [a, h / 4], [a, 0], [0, h / 2], [a, h], [a, h * 0.75], [w, h * 0.75]]); }
        case "downArrow": { const a = Math.min(h / 2, w); return P([[w / 4, 0], [w * 0.75, 0], [w * 0.75, h - a], [w, h - a], [w / 2, h], [0, h - a], [w / 4, h - a]]); }
        case "upArrow": { const a = Math.min(h / 2, w); return P([[w / 4, h], [w * 0.75, h], [w * 0.75, a], [w, a], [w / 2, 0], [0, a], [w / 4, a]]); }
        case "chevron": { const a = Math.min(h / 2, w / 2); return P([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h], [a, h / 2]]); }
        case "homePlate": { const a = Math.min(h / 2, w / 2); return P([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h]]); }
        case "hexagon": { const a = Math.min(w / 4, h / 2); return P([[a, 0], [w - a, 0], [w, h / 2], [w - a, h], [a, h], [0, h / 2]]); }
        case "parallelogram": case "flowChartInputOutput": { const a = Math.min(w / 4, k / 2); return P([[a, 0], [w, 0], [w - a, h], [0, h]]); }
        default: return null;
      }
    }

    // ---------- MCQ ----------
    async function mcqZone(seg) {
      const units = C().mcqUnits(seg.blocks);
      for (const u of units) {
        if (u.u === "other") { for (const [s, f] of await block(u.block)) push(s, f); blank(); continue; }
        if (u.u === "stim") {
          for (const [s, f] of await block(u.stim || u.header)) push(s, f);
          blank();
          for (const b of u.passage) {
            if (b.kind !== "p") { for (const [s, f] of await block(b)) push(s, f); blank(); continue; }
            const sp = C().splitSource(b.items);
            let s = await inline(sp.body, b);
            if (sp.source) s += ` #mcq-source[${await inline(sp.source, b, { noSmall: true })}]`;
            push(s, plainOf(b));
            blank();
          }
          continue;
        }
        let title = await inline(u.titleItems, u.title);
        if (u.source) title += ` #mcq-source[${await inline(u.source, u.title, { noSmall: true })}]`;
        push(title, plainOf(u.title));
        blank();
        for (const b of u.extras) { for (const [s, f] of await block(b)) push(s, f); blank(); }
        if (u.options) {
          const args = [];
          // tabs and line breaks that only separated the options in Word are dropped
          const trimSep = (items) => { const a = items.slice(); const sep = (i) => i && (i.t === "tab" || i.t === "br" || (i.t === "text" && !i.text.trim())); while (sep(a[0])) a.shift(); while (sep(a[a.length - 1])) a.pop(); return a; };
          for (const o of u.options) args.push(`[(${o.letter}) ${await inline(trimSep(o.items), null)}]`);
          const firstLen = C().itemsText(u.options[0].items).replace(new RegExp(OBJ, "g"), "").trim().length;
          const pics = u.options.some((o) => o.items.some((i) => i.t === "img"));
          const five = u.options.length === 5;
          let fn = five ? "mcq-options-5" : firstLen > 20 && !pics ? "mcq-options-stacked" : "mcq-options";
          if (u.options.length < 4 || u.options.length > 5) fn = "mcq-options-list";
          if (u.answer && fn !== "mcq-options-list") {
            fn = fn === "mcq-options-5" ? "mcq-options-with-ans-5" : fn === "mcq-options-stacked" ? "mcq-options-stacked-with-ans" : "mcq-options-with-ans";
            args.push(`[#mcq-ans[${u.answer}]]`);
          }
          push(`#${fn}${args.join("")}`, u.options.map((o) => `(${o.letter}) ` + C().itemsText(o.items).replace(new RegExp(OBJ, "g"), "")).join("   "));
          blank();
          if (fn === "mcq-options-list" && u.answer) { push(`উত্তর: #mcq-ans[${u.answer}]`, `উত্তর: ${u.answer}`); blank(); }
        } else {
          for (const b of u.optParas) { for (const [s, f] of await block(b)) push(s, f); blank(); }
          if (u.answer) { push(`উত্তর: #mcq-ans[${u.answer}]`, `উত্তর: ${u.answer}`); blank(); }
        }
        for (const b of u.after) { for (const [s, f] of await block(b)) push(s, f); blank(); }
      }
    }

    // ---------- CQ ----------
    async function cqZone(seg) {
      const roles = C().cqRoles(seg.blocks);
      for (let i = 0; i < seg.blocks.length; i++) {
        const b = seg.blocks[i];
        const f = wrapFloat(b);
        const followers = f ? followersFor(seg.blocks, i, f, COL2) : [];
        const out = f ? await paragraph(b, { followers }) : await block(b);
        for (let [s, fb2] of out) {
          if (roles[i] === "cq-subq") s = `#cq-subq[${s}]`;
          push(s, fb2);
        }
        blank();
        i += followers.length;
      }
    }

    // ---------- the document ----------
    rowCaptionPass();
    let firstLabel = null;
    zone = "normal";
    for (const seg of segs) {
      if (seg.type === "section") {
        if (firstLabel === null) { firstLabel = seg.label || ""; continue; }
        if (seg.label) { blank(); push(`#set page(header: chapter-header([${esc(seg.label)}]))`, null); blank(); }
        continue;
      }
      if (seg.type === "mcq") {
        push("#apply-mcq[", null); push("#columns(2)[", null);
        zone = "mcq"; await mcqZone(seg); zone = "normal";
        push("]", null); push("]", null); blank();
      } else if (seg.type === "cq") {
        push("#apply-cq[", null); push("#columns(2)[", null);
        zone = "cq"; await cqZone(seg); zone = "normal";
        push("]", null); push("]", null); blank();
      } else {
        for (let k = 0; k < seg.blocks.length; k++) {
          const b = seg.blocks[k];
          const f = wrapFloat(b);
          if (!f) { for (const [s, fb2] of await block(b)) push(s, fb2); blank(); continue; }
          const followers = followersFor(seg.blocks, k, f, COL1);
          for (const [s, fb2] of await paragraph(b, { followers })) push(s, fb2);
          blank();
          k += followers.length;
        }
      }
    }

    const head = [
      `// Generated from ${opts.name || "a Word file"} — edit freely, the preview recompiles as you type.`,
      `// Styles live in page_setup_template.typ (page, header, footer, base tokens) and tags/mcq.typ, tags/cq.typ.`,
      `#import "page_setup_template.typ": *`,
      `#import "tags/mcq.typ": apply-mcq, mcq-ans, mcq-source`,
      `#import "tags/cq.typ": apply-cq, cq-subq`,
      `#show: apply-page-setup.with(label: [${esc(firstLabel || "")}])`,
      "",
    ];
    const main = head.concat(lines);
    const fbAll = head.map(() => null).concat(fallback);

    const files = {
      "main.typ": main.join("\n") + "\n",
      "page_setup_template.typ": opts.greyscale === false ? PAGE_SETUP.replace('media-folder  = "media" ', 'media-folder  = "media_color"') : PAGE_SETUP,
      "tags/mcq.typ": MCQ_TAG,
      "tags/cq.typ": CQ_TAG,
    };
    const binaries = Object.assign({}, media.files);
    const b64 = (u) => { const bin = atob(u.split(",")[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
    binaries["templates/header_logo.png"] = b64(root.ASSETS.headerLogo);
    binaries["templates/10ms-logo.png"] = b64(root.ASSETS.footerLogo);
    binaries["fonts/kalpurush.ttf"] = b64(root.ASSETS.kalpurush);
    return { files, binaries, fallback: fbAll, warnings: [...new Set(warnings)], meta, prefix: mediaPrefix(meta) };
  }

  // =========================================================================================
  // Templates (same tokens as the Python converter's page_setup_template.typ and tags/*.typ)
  // =========================================================================================
  const PAGE_SETUP = `// Page Setup Template
//
// ═══════════════════════════════════════════════════════════════════════════
// BASE STYLE TOKENS
// Change any value here to update the whole document AND every tag section.
// Tag files (tags/*.typ) import these tokens — they inherit your changes.
// ═══════════════════════════════════════════════════════════════════════════

#let base-font     = ("Kalpurush", "New Computer Modern")  // Bangla and English body font
#let footer-font   = "Kalpurush"  // footer and header font
#let base-size     = 10pt         // body text font size
#let topic-size    = 12pt         // heading level 1 (topic) font size
#let subtopic-size = 11pt         // heading level 2 (sub-topic) font size
#let footer-size   = 10pt         // footer font size
#let base-weight   = "regular"    // body font weight
#let base-leading  = 0.60em       // line spacing
#let base-indent   = 0pt          // first-line indent
#let eq-indent     = 0.2in        // indent for display (block) math equations
#let media-folder  = "media"      // "media" for greyscale, "media_color" for colour
#let header-image        = "templates/header_logo.png"  // header logo
#let header-image-height = 0.20in
#let footer-image        = "templates/10ms-logo.png"    // footer logo
#let footer-image-height = 0.28in
#let rule-stroke   = 0.5pt        // lines under the header / over the footer

#let to-bangla-number(num) = {
  let bn-digits = ("০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯")
  str(num).clusters().map(c => if c in "0123456789" { bn-digits.at(int(c)) } else { c }).join()
}

// ── MCQ option grids ─────────────────────────────────────────────────────────
#let mcq-col-widths = (1fr, 1fr)
#let mcq-row-gutter = 0.8em

#let mcq-options(a, b, c, d) = grid(
  columns: mcq-col-widths, row-gutter: mcq-row-gutter, align: horizon + left,
  a, b,
  c, d,
)
#let mcq-options-stacked(a, b, c, d) = grid(
  columns: (1fr,), row-gutter: mcq-row-gutter, align: horizon + left,
  a, b, c, d,
)
#let mcq-options-with-ans(a, b, c, d, ans) = grid(
  columns: (auto, 1fr, 1fr), row-gutter: mcq-row-gutter, column-gutter: 0.5em, align: horizon + left,
  [], a, b,
  ans, c, d,
)
#let mcq-options-5(a, b, c, d, e) = grid(
  columns: mcq-col-widths, row-gutter: mcq-row-gutter, align: horizon + left,
  a, b,
  c, d,
  e, [],
)
#let mcq-options-with-ans-5(a, b, c, d, e, ans) = grid(
  columns: (auto, 1fr, 1fr), row-gutter: mcq-row-gutter, column-gutter: 0.5em, align: horizon + left,
  [], a, b,
  [], c, d,
  ans, e, [],
)
#let mcq-options-stacked-with-ans(a, b, c, d, ans) = grid(
  columns: (auto, 1fr), row-gutter: mcq-row-gutter, column-gutter: 0.5em, align: horizon + left,
  [], a,
  [], b,
  ans, c,
  [], d,
)
// any other number of options: one per row
#let mcq-options-list(..opts) = grid(columns: (1fr,), row-gutter: mcq-row-gutter, align: horizon + left, ..opts)

// ── Helpers used by main.typ ─────────────────────────────────────────────────
// a picture at its Word size, shrunk to the column when wider
#let pic(path, w) = layout(size => image(path, width: if type(w) == length { calc.min(w, size.width) } else { w }))
// a Word drawing (flowchart, labelled boxes) at its Word size, shrunk to the column when wider
#let fitbox(w, h, body) = layout(size => {
  let s = if w > 0pt { calc.min(1, size.width / w) } else { 1 }
  align(center, scale(x: s * 100%, y: s * 100%, origin: top + left, reflow: true, box(width: w, height: h, body)))
})

// a picture that text flows around, as in Word (square wrapping): as many words as fit beside the
// picture go next to it, the rest of the paragraph continues full width underneath
#let wrap-pic(fig, side: left, gap: 0.12in, min-text: 1.5in, words) = layout(size => {
  let f = measure(fig)
  let tw = size.width - f.width - gap
  if tw < min-text or words.len() == 0 {
    align(center, fig)
    words.join([ ])
    return
  }
  let fits(n) = measure(block(width: tw, words.slice(0, n).join([ ]))).height <= f.height
  let lo = 0
  // a word (an equation) wider than the room beside the picture starts the part underneath
  let hi = words.position(w => measure(w).width > tw + 0.5pt)
  if hi == none { hi = words.len() }
  while lo < hi {
    let mid = calc.ceil((lo + hi) / 2)
    if fits(mid) { lo = mid } else { hi = mid - 1 }
  }
  // a paragraph break right after the text beside the picture belongs to neither part
  while lo > 0 and words.at(lo - 1).func() == parbreak { lo -= 1 }
  // cut between two paragraphs: the part underneath starts a paragraph of its own
  let at-break = lo > 0 and lo < words.len() and words.at(lo).func() == parbreak
  let head = if lo == 0 { [] } else if lo < words.len() and not at-break { words.slice(0, lo).join([ ]) + linebreak(justify: true) } else { words.slice(0, lo).join([ ]) }
  let cells = if side == left { (fig, head) } else { (head, fig) }
  // the picture and the text beside it stay together (a page break between them would lose the picture)
  block(breakable: false, grid(columns: if side == left { (f.width, 1fr) } else { (1fr, f.width) }, column-gutter: gap, ..cells))
  let rest = words.slice(if at-break { lo + 1 } else { lo })
  while rest.len() > 0 and rest.first().func() == parbreak { rest = rest.slice(1) }
  // a paragraph cut in the middle continues on the next line, unless the picture reaches lower than the text
  if not at-break and lo > 0 and rest.len() > 0 and measure(block(width: tw, head)).height >= f.height - 2pt { v(-par.spacing + 0.15em) }
  rest.join([ ])
})

// a numbered paragraph as in Word: the text starts at left, the label sits in the hanging space before it
#let num-par(left, hanging, label-align, label, body) = pad(left: left - hanging, {
  set par(hanging-indent: hanging, first-line-indent: 0pt)
  let gap = 0.3em
  if hanging > 0pt { box(width: hanging, if label-align == right { align(right, label + h(gap)) } else { label + h(gap) }) } else { label + h(gap) }
  body
})

// a row of floating pictures / drawings at their Word positions (x, y from the left of a Word column
// colw wide), shrunk with the row when the Typst column is narrower
#let float-row(colw, items) = layout(size => {
  let s = calc.min(1, size.width / colw)
  let h = calc.max(..items.map(i => i.at(1) + measure(i.at(2)).height))
  block(breakable: false, scale(x: s * 100%, y: s * 100%, origin: top + left, reflow: true,
    box(width: colw, height: h, { for i in items { place(top + left, dx: i.at(0), dy: i.at(1), i.at(2)) } })))
})

// ── Running chapter header ──────────────────────────────────────────────────
// Odd  page : Left = logo           | Right = Subject ▶ Chapter
// Even page : Left = Subject ▶ …    | Right = logo
// A new chapter changes it with  #set page(header: chapter-header([New text]))
#let chapter-header(label) = context [
  #set text(font: footer-font, size: 10pt)
  #let page-num = counter(page).get().first()
  #if calc.odd(page-num) {
    grid(columns: (auto, 1fr), align: (left + bottom, right + bottom), image(header-image, height: header-image-height), label)
  } else {
    grid(columns: (1fr, auto), align: (left + bottom, right + bottom), label, image(header-image, height: header-image-height))
  }
  #v(-0.7em)
  #line(length: 100%, stroke: rule-stroke)
]

#let apply-page-setup(body, label: []) = {
  set text(font: base-font, size: base-size, lang: "bn")
  set par(justify: true, leading: base-leading, first-line-indent: base-indent)
  show strong: it => text(stroke: 0.3pt + black, it.body)
  show math.equation.where(block: true): eq => pad(left: eq-indent)[#eq]
  show heading.where(level: 1): it => [
    #set text(size: topic-size, weight: "bold")
    #align(center)[#it.body]
    #v(0.5em)
  ]
  show heading.where(level: 2): it => [
    #set text(size: subtopic-size, weight: "bold")
    #it.body
    #v(0.3em)
  ]
  show heading.where(level: 3): it => [
    #set text(size: base-size, weight: "bold")
    #it.body
  ]

  // ── Page geometry ──────────────────────────────────────────────────────────
  // Page size  : 8.5" × 10.6"
  // Margins    : Top 0.68" | Bottom 0.68" | Left 0.58" | Right 0.58"
  set page(
    width: 8.5in,
    height: 10.6in,
    margin: (top: 0.68in, bottom: 0.68in, left: 0.58in, right: 0.58in),
    header-ascent: 0.06in,
    footer-descent: 0.03in,
    header: chapter-header(label),
    // Odd page : Left = logo | Right = page no.     Even page : Left = page no. | Right = logo
    footer: context [
      #line(length: 100%, stroke: rule-stroke)
      #v(-0.5em)
      #set text(font: footer-font, size: footer-size)
      #let page-num = counter(page).get().first()
      #if calc.odd(page-num) {
        grid(columns: (1fr, auto), align: (left + horizon, right + horizon), image(footer-image, height: footer-image-height), to-bangla-number(page-num))
      } else {
        grid(columns: (auto, 1fr), align: (left + horizon, right + horizon), to-bangla-number(page-num), image(footer-image, height: footer-image-height))
      }
    ],
    numbering: "1",
  )
  body
}
`;

  const MCQ_TAG = `// ── mcq tag styling ──────────────────────────────────────────────────────────
// Base tokens (font, size, leading …) come from page_setup_template.typ.
// Override individual values HERE to style only MCQ blocks.

#import "../page_setup_template.typ": base-font, base-size, base-weight, base-leading, base-indent

// ════════════════════════════════════════════════════════════════════
// ░░  SPACING & SIZE TOKENS — edit these to adjust layout            ░░
// ════════════════════════════════════════════════════════════════════

#let mcq-size = 9pt              // MCQ text size

// ── Board-exam source reference ──────────────────────────────────────────────
#let source-size  = 7pt      // font size of [কু.বো.'১৫] references
#let source-align = right    // alignment: right | left

// ── Circle tokens ────────────────────────────────────────────────────────────
#let opt-circle-size  = 1.45em  // diameter of option circles  (ক / খ / গ / ঘ)
#let ans-circle-size  = 1.6em   // diameter of correct-answer dark circle
#let circle-stroke    = 0.7pt   // stroke width for open option circles
#let circle-color     = black   // colour of the open option circles
#let circle-text-size = 8pt     // letter size inside every open circle
#let ans-fill         = black   // fill of the answer circle
#let ans-text-color   = white   // letter colour in the answer circle
#let ans-text-size    = 11pt    // letter size inside the answer circle

// ── Question hanging indent ───────────────────────────────────────────────────
#let question-hanging-indent = 1.8em

// ── Block vertical padding ────────────────────────────────────────────────────
#let mcq-block-padding = (x: 0pt, y: 0.4em)

// ════════════════════════════════════════════════════════════════════

#let mcq-source(it) = {
  if source-align == right { h(1fr) } else { h(0.5em) }
  text(size: source-size, style: "oblique")[#it]
}

// ── Open circle for option labels (ক / খ / গ / ঘ) ────────────────────────────
#let opt-circle(letter) = box(
  width: opt-circle-size, height: opt-circle-size,
  fill: none, stroke: circle-stroke + circle-color, radius: 50%, inset: 0pt, baseline: 25%,
)[#align(center + horizon)[#text(size: circle-text-size, weight: "bold", fill: circle-color)[#letter]]]

// ── Correct-answer indicator (filled dark circle) ─────────────────────────────
#let mcq-ans(letter) = box(
  width: ans-circle-size, height: ans-circle-size,
  fill: ans-fill, stroke: none, radius: 50%, inset: 0pt, baseline: 25%,
)[#align(center + horizon)[#text(size: ans-text-size, weight: "bold", fill: ans-text-color)[#letter]]]

// ── Block wrapper ─────────────────────────────────────────────────────────────
#let apply-mcq(body) = {
  set text(font: base-font, size: mcq-size, weight: base-weight, lang: "bn")
  set par(justify: true, leading: base-leading, first-line-indent: 0pt, hanging-indent: question-hanging-indent)

  // bracket option labels become open circles
  show "(ক)": opt-circle("ক")
  show "(খ)": opt-circle("খ")
  show "(গ)": opt-circle("গ")
  show "(ঘ)": opt-circle("ঘ")
  show "(ঙ)": opt-circle("ঙ")

  block(width: 100%, inset: mcq-block-padding)[#body]
}
`;

  const CQ_TAG = `// ── cq tag styling ───────────────────────────────────────────────────────────
// Base tokens (font, size, leading …) come from page_setup_template.typ.
// Override individual values HERE to style only CQ blocks.

#import "../page_setup_template.typ": base-font, base-size, base-weight, base-leading, base-indent

// ════════════════════════════════════════════════════════════════════
// ░░  SPACING & INDENT TOKENS — edit these to adjust layout          ░░
// ════════════════════════════════════════════════════════════════════

#let cq-size = base-size      // CQ text size

// ── Sub-question indentation ──────────────────────────────────────────────────
// Amount the (ক)(খ)(গ)(ঘ) sub-question lines are shifted from the left margin.
#let cq-indent = 0.4in

// ── Block vertical padding ────────────────────────────────────────────────────
#let cq-block-padding = (x: 0pt, y: 0.4em)

// ════════════════════════════════════════════════════════════════════

#let cq-subq(body) = pad(left: cq-indent)[#body]

#let apply-cq(body) = {
  set text(font: base-font, size: cq-size, weight: base-weight, lang: "bn")
  set par(justify: true, leading: base-leading, first-line-indent: 0pt)
  block(width: 100%, inset: cq-block-padding)[#body]
}
`;

  root.TypstGen = { generate, esc, guessMeta, mediaPrefix };
})(typeof globalThis !== "undefined" ? globalThis : this);
