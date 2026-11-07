/* Reads a .docx into a plain document model the classifier and renderer work on.
 *
 *   blocks  top-level items in reading order:
 *     { kind: "p", items, text, para }      a paragraph (items = formatted runs, equations, pictures, shapes)
 *     { kind: "table", rows, cols }          a table (cells hold blocks of their own)
 *     { kind: "section", label }             start of a new Word section (label = its page-header text)
 *   getMedia(target) -> Promise<{ bytes, mime }>
 *
 * In `text` every non-text item (equation, picture, shape, tab) is one OBJ character, so offsets in
 * `text` map 1:1 onto `items` and a paragraph can be cut at a regex match without losing formatting. */
(function (root) {
  "use strict";

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const OBJ = "";

  const kids = (el) => Array.from((el && el.children) || []);
  const wkid = (el, name) => kids(el).find((c) => c.localName === name && c.namespaceURI === W) || null;
  const wval = (el, name = "val") => (el ? el.getAttributeNS(W, name) : null);
  const firstDesc = (el, name) => (el ? el.getElementsByTagNameNS("*", name)[0] || null : null);
  const on = (el) => !!el && !["0", "false", "off", "none"].includes(wval(el) || "");

  const HIGHLIGHT = {
    yellow: "FFFF00", green: "00FF00", cyan: "00FFFF", magenta: "FF00FF", blue: "0000FF", red: "FF0000",
    darkBlue: "00008B", darkCyan: "008B8B", darkGreen: "006400", darkMagenta: "8B008B", darkRed: "8B0000",
    darkYellow: "808000", darkGray: "A9A9A9", lightGray: "D3D3D3", black: "000000", white: "FFFFFF",
  };

  function resolveTarget(target, baseDir) {
    if (/^[a-z]+:/i.test(target)) return null; // external link
    if (target.startsWith("/")) return target.slice(1);
    const out = [];
    for (const p of (baseDir + target).split("/")) {
      if (p === "..") out.pop();
      else if (p !== ".") out.push(p);
    }
    return out.join("/");
  }

  async function readXml(zip, path) {
    const f = path && zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
  }

  async function readRels(zip, partPath) {
    const dir = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/") + 1) : "";
    const doc = await readXml(zip, `${dir}_rels/${partPath.slice(dir.length)}.rels`);
    const rels = {};
    if (doc) {
      for (const r of Array.from(doc.getElementsByTagName("Relationship"))) {
        rels[r.getAttribute("Id")] = { target: resolveTarget(r.getAttribute("Target"), dir), type: r.getAttribute("Type") || "" };
      }
    }
    return rels;
  }

  const sniff = (b) => {
    if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
    if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
    if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
    if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
    if (b[0] === 0x3c) return "image/svg+xml";
    return ""; // EMF / WMF / TIFF: a browser cannot draw these
  };

  // ---------- styles: run and paragraph properties with inheritance ----------
  function readStyles(doc) {
    const styles = {};
    let defaultPara = null;
    const defaults = { r: {}, p: {} };
    if (!doc) return { styles, defaultPara, defaults };
    const dd = doc.getElementsByTagNameNS(W, "docDefaults")[0];
    if (dd) {
      defaults.r = runProps(firstDesc(dd, "rPr"));
      defaults.p = paraProps(firstDesc(dd, "pPr"));
    }
    for (const s of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
      const id = wval(s, "styleId");
      const nameEl = wkid(s, "name");
      styles[id] = {
        id, type: wval(s, "type"), name: nameEl ? wval(nameEl) : id,
        basedOn: wval(wkid(s, "basedOn")),
        r: runProps(wkid(s, "rPr")), p: paraProps(wkid(s, "pPr")),
      };
      if (wval(s, "type") === "paragraph" && wval(s, "default") === "1") defaultPara = id;
    }
    return { styles, defaultPara, defaults };
  }

  function runProps(rPr) {
    const o = {};
    if (!rPr) return o;
    for (const c of kids(rPr)) {
      const n = c.localName;
      if (n === "b") o.b = on(c) || wval(c) === null;
      else if (n === "i") o.i = on(c) || wval(c) === null;
      else if (n === "u") o.u = wval(c) !== "none";
      else if (n === "strike" || n === "dstrike") o.s = on(c) || wval(c) === null;
      else if (n === "caps") o.caps = on(c) || wval(c) === null;
      else if (n === "vanish") o.hidden = on(c) || wval(c) === null;
      else if (n === "color") { const v = wval(c); if (v && v !== "auto") o.color = v; }
      else if (n === "sz") { const v = parseInt(wval(c), 10); if (v) o.sz = v; }
      else if (n === "vertAlign") { const v = wval(c); if (v === "subscript") o.va = "sub"; else if (v === "superscript") o.va = "sup"; else o.va = ""; }
      else if (n === "highlight") { const v = wval(c); if (v && v !== "none" && HIGHLIGHT[v]) o.bg = HIGHLIGHT[v]; }
      else if (n === "shd") { const f = wval(c, "fill"); if (f && f !== "auto" && !/^f{6}$/i.test(f)) o.bg = o.bg || f; }
      else if (n === "rStyle") o.rStyle = wval(c);
    }
    return o;
  }

  // <w:ind>: left (start), hanging / first-line, in points
  function indOf(el) {
    const v = (k) => { const x = wval(el, k); return x == null ? null : (parseInt(x, 10) || 0) / 20; };
    const o = {};
    const left = v("left") ?? v("start");
    if (left != null) o.left = left;
    if (v("hanging") != null) o.hanging = v("hanging");
    else if (v("firstLine") != null) o.hanging = -v("firstLine");
    return o;
  }

  function paraProps(pPr) {
    const o = {};
    if (!pPr) return o;
    for (const c of kids(pPr)) {
      const n = c.localName;
      if (n === "pStyle") o.style = wval(c);
      else if (n === "jc") o.jc = wval(c);
      else if (n === "keepNext") o.keepNext = on(c) || wval(c) === null;
      else if (n === "pageBreakBefore") o.pageBreakBefore = on(c) || wval(c) === null;
      else if (n === "outlineLvl") o.outline = parseInt(wval(c), 10);
      else if (n === "shd") { const f = wval(c, "fill"); if (f && f !== "auto" && !/^f{6}$/i.test(f)) o.shd = f; }
      else if (n === "numPr") {
        const id = wval(wkid(c, "numId")), lvl = wval(wkid(c, "ilvl"));
        o.num = { id, lvl: parseInt(lvl || "0", 10) };
      } else if (n === "ind") o.ind = indOf(c);
      else if (n === "pBdr") o.border = kids(c).some((b) => wval(b) && wval(b) !== "none" && wval(b) !== "nil");
      else if (n === "rPr") o.markRun = runProps(c);
    }
    return o;
  }

  function styleChain(st, id, key) {
    const out = [];
    const seen = new Set();
    while (id && st.styles[id] && !seen.has(id)) {
      seen.add(id);
      out.unshift(st.styles[id][key]);
      id = st.styles[id].basedOn;
    }
    return Object.assign({}, ...out);
  }

  // ---------- numbering (Word lists) ----------
  async function readNumbering(zip, mainDir) {
    const doc = await readXml(zip, `${mainDir}numbering.xml`);
    const abstract = {}, nums = {};
    if (!doc) return { abstract, nums };
    for (const a of Array.from(doc.getElementsByTagNameNS(W, "abstractNum"))) {
      const lvls = {};
      for (const l of kids(a).filter((x) => x.localName === "lvl")) {
        const ind = wkid(wkid(l, "pPr"), "ind");
        lvls[parseInt(wval(l, "ilvl"), 10)] = {
          fmt: wval(wkid(l, "numFmt")) || "decimal",
          text: wval(wkid(l, "lvlText")) ?? "",
          start: parseInt(wval(wkid(l, "start")) || "1", 10),
          ind: ind ? indOf(ind) : null,           // the level's own indents (points)
          jc: wval(wkid(l, "lvlJc")) || "left",   // label alignment in the hanging space
          run: runProps(wkid(l, "rPr")),          // label formatting (often bold)
        };
      }
      abstract[wval(a, "abstractNumId")] = lvls;
    }
    for (const n of Array.from(doc.getElementsByTagNameNS(W, "num"))) {
      nums[wval(n, "numId")] = wval(wkid(n, "abstractNumId"));
    }
    return { abstract, nums };
  }

  const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
  function fmtNumber(n, fmt) {
    const roman = (x) => {
      const t = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
      let s = "";
      for (const [v, r] of t) while (x >= v) { s += r; x -= v; }
      return s;
    };
    const letter = (x) => { let s = ""; while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); } return s; };
    switch (fmt) {
      case "lowerRoman": return roman(n);
      case "upperRoman": return roman(n).toUpperCase();
      case "lowerLetter": return letter(n);
      case "upperLetter": return letter(n).toUpperCase();
      case "bullet": return "";
      case "none": return "";
      case "hindiNumbers": case "bengali": case "bengaliNumbers":
        return String(n).replace(/\d/g, (d) => BN_DIGITS[d]);
      case "hindiVowels": case "hindiConsonants": {
        const bn = "কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহ";
        return bn[(n - 1) % bn.length];
      }
      default: return String(n);
    }
  }

  function makeNumberer(numbering) {
    const counters = {}; // abstractId -> [count per level]
    return function label(num) {
      if (!num || !num.id || num.id === "0") return null;
      const absId = numbering.nums[num.id];
      const lvls = absId != null ? numbering.abstract[absId] : null;
      if (!lvls) return null;
      const c = counters[absId] || (counters[absId] = []);
      const lvl = num.lvl || 0;
      const def = lvls[lvl] || { fmt: "decimal", text: `%${lvl + 1}.`, start: 1 };
      c[lvl] = c[lvl] === undefined ? def.start : c[lvl] + 1;
      for (let k = lvl + 1; k < 9; k++) c[k] = undefined;
      label.lastDef = def;
      if (def.fmt === "bullet") return "•";
      return def.text.replace(/%(\d)/g, (_, d) => {
        const li = parseInt(d, 10) - 1;
        const ld = lvls[li] || def;
        return fmtNumber(c[li] === undefined ? ld.start : c[li], ld.fmt);
      });
    };
  }

  // ---------- reader ----------
  async function read(data) {
    const zip = await JSZip.loadAsync(data);
    let mainPath = "word/document.xml";
    const pkg = await readXml(zip, "_rels/.rels");
    if (pkg) {
      const r = Array.from(pkg.getElementsByTagName("Relationship")).find((x) => /\/officeDocument$/.test(x.getAttribute("Type") || ""));
      if (r) mainPath = resolveTarget(r.getAttribute("Target"), "");
    }
    const mainDir = mainPath.includes("/") ? mainPath.slice(0, mainPath.lastIndexOf("/") + 1) : "";
    const doc = await readXml(zip, mainPath);
    if (!doc || !doc.getElementsByTagNameNS(W, "body")[0]) throw new Error("This is not a Word (.docx) file.");
    const rels = await readRels(zip, mainPath);
    const themeRel = Object.values(rels).find((r) => /\/theme$/.test(r.type));
    if (root.Shapes) root.Shapes.setTheme(await readXml(zip, themeRel ? themeRel.target : `${mainDir}theme/theme1.xml`));
    const st = readStyles(await readXml(zip, `${mainDir}styles.xml`));
    const numbering = await readNumbering(zip, mainDir);
    const numLabel = makeNumberer(numbering);

    // page-header text of every header part, by relationship id. Headers built from separate paragraphs or
    // text boxes ("Subject" / "অধ্যায় ১১" / "Chapter") are joined with ▶ the way single-line headers write it.
    const headerText = {};
    const inFallback = (n) => { for (let a = n.parentNode; a; a = a.parentNode) if (a.localName === "Fallback") return true; return false; };
    const ownPara = (n) => { let a = n.parentNode; while (a && !(a.localName === "p" && a.namespaceURI === W)) a = a.parentNode; return a; };
    for (const [id, r] of Object.entries(rels)) {
      if (!/\/header$/.test(r.type)) continue;
      const hdr = await readXml(zip, r.target);
      if (!hdr) continue;
      const texts = Array.from(hdr.getElementsByTagNameNS(W, "p"))
        .filter((p) => !inFallback(p))
        .map((p) => Array.from(p.getElementsByTagNameNS(W, "t")).filter((t) => ownPara(t) === p).map((t) => t.textContent).join(""))
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      headerText[id] = texts.length > 1 && !texts.some((t) => /[▶►▸]/.test(t)) ? texts.join(" ▶ ") : texts.join(" ");
    }
    const sectionLabel = (sectPr) => {
      if (!sectPr) return null;
      const refs = kids(sectPr).filter((c) => c.localName === "headerReference");
      const pick = refs.find((r) => wval(r, "type") === "default") || refs[0];
      if (!pick) return null;
      return headerText[pick.getAttributeNS(R, "id")] || null;
    };

    const mediaCache = {};
    async function getMedia(target) {
      if (!mediaCache[target]) {
        mediaCache[target] = (async () => {
          const f = zip.file(target);
          if (!f) return null;
          const bytes = await f.async("uint8array");
          return { bytes, mime: sniff(bytes) };
        })();
      }
      return mediaCache[target];
    }

    const ctx = { st, rels, numLabel };
    const body = doc.getElementsByTagNameNS(W, "body")[0];

    // Sections: a sectPr inside a paragraph closes the section that paragraph belongs to; the body's
    // last sectPr closes the final one. Collect them first so each section's header is known up front.
    const sectPrs = [];
    for (const c of kids(body)) {
      if (c.localName === "p") { const sp = wkid(wkid(c, "pPr"), "sectPr"); if (sp) sectPrs.push(sp); }
      else if (c.localName === "sectPr") sectPrs.push(c);
    }
    const labels = [];
    let prev = null;
    for (const sp of sectPrs) { const l = sectionLabel(sp) || prev; labels.push(l); prev = l; }
    const sectionLabels = new Map(sectPrs.map((sp, i) => [sp, labels[i]]));
    // text-column width of every section in points (where a floating picture or drawing sits in it)
    const colWidths = sectPrs.map((sp) => {
      const tw = (el, a) => parseInt(wval(el, a) || "0", 10) || 0;
      const pg = wkid(sp, "pgSz"), mar = wkid(sp, "pgMar"), cols = wkid(sp, "cols");
      const n = Math.max(1, tw(cols, "num") || 1);
      const w = (tw(pg, "w") || 11906) - tw(mar, "left") - tw(mar, "right");
      return { colW: (w - (n - 1) * (cols && wval(cols, "space") != null ? tw(cols, "space") : 720)) / n / 20, marL: tw(mar, "left") / 20 };
    });

    const blocks = [];
    let sec = 0;
    blocks.push({ kind: "section", label: labels[0] || null });
    for (const c of kids(body)) {
      if (c.namespaceURI !== W) continue;
      Object.assign(ctx, colWidths[Math.min(sec, colWidths.length - 1)] || {});
      if (c.localName === "p") {
        blocks.push(...readParagraph(c, ctx));
        if (wkid(wkid(c, "pPr"), "sectPr")) {
          sec++;
          if (sec < labels.length && labels[sec] !== labels[sec - 1]) blocks.push({ kind: "section", label: labels[sec] });
        }
      } else if (c.localName === "tbl") {
        blocks.push(readTable(c, ctx));
      } else if (c.localName === "sdt") {
        const content = wkid(c, "sdtContent");
        for (const x of kids(content)) {
          if (x.localName === "p") blocks.push(...readParagraph(x, ctx));
          else if (x.localName === "tbl") blocks.push(readTable(x, ctx));
        }
      }
    }
    return { blocks, getMedia, zip, doc, mainPath, sectionLabels };
  }

  // ---------- paragraphs ----------
  function readParagraph(p, ctx) {
    const { st } = ctx;
    const direct = paraProps(wkid(p, "pPr"));
    const styleId = direct.style || st.defaultPara;
    const sp = Object.assign({}, st.defaults.p, styleChain(st, styleId, "p"), direct);
    const styleName = (st.styles[styleId] && st.styles[styleId].name) || styleId || "";
    const baseRun = Object.assign({}, st.defaults.r, styleChain(st, styleId, "r"));

    const items = [];
    const extra = []; // text boxes become blocks of their own after the paragraph
    walkInline(p, ctx, baseRun, items, extra);

    // drop hidden runs and merge adjacent text runs with identical formatting
    const merged = [];
    for (const it of items) {
      if (it.t === "text" && it.hidden) continue;
      const last = merged[merged.length - 1];
      if (it.t === "text" && last && last.t === "text" && sameFmt(last, it)) last.text += it.text;
      else merged.push(it);
    }
    const label = sp.num ? ctx.numLabel(sp.num) : null;
    let list = null;
    if (label) {
      const def = ctx.numLabel.lastDef || {};
      merged.unshift(Object.assign({ t: "text", text: label + " ", b: false, label: true }, def.run || {}));
      // indents: the numbering level's, overridden by the paragraph's own (style indents come first)
      const ind = Object.assign({}, styleChain(st, styleId, "p").ind || {}, def.ind || {}, direct.ind || {});
      if (ind.left > 0) list = { left: ind.left, hanging: Math.max(0, Math.min(ind.left, ind.hanging || 0)), jc: def.jc || "left" };
    }

    const text = merged.map((it) => (it.t === "text" ? it.text : it.t === "br" ? "\n" : OBJ)).join("");
    const textRuns = merged.filter((it) => it.t === "text" && it.text.trim());
    const para = {
      jc: sp.jc || "", shd: sp.shd || "", border: !!sp.border, keepNext: !!sp.keepNext,
      pageBreakBefore: !!sp.pageBreakBefore, styleName, list,
      heading: headingLevel(styleName, sp.outline),
      allBold: textRuns.length > 0 && textRuns.every((r) => r.b),
      maxSize: Math.max(0, ...textRuns.map((r) => r.sz || 0)),
    };
    const out = [{ kind: "p", items: merged, text, para, node: p }];
    return out.concat(extra);
  }

  function headingLevel(name, outline) {
    const m = /^(?:heading|শিরোনাম)\s*(\d)/i.exec(name || "");
    if (m) return parseInt(m[1], 10);
    if (/^title$/i.test(name || "")) return 1;
    if (Number.isInteger(outline) && outline >= 0 && outline < 6) return outline + 1;
    return 0;
  }

  const FMT_KEYS = ["b", "i", "u", "s", "color", "bg", "sz", "va", "caps"];
  const sameFmt = (a, b) => FMT_KEYS.every((k) => (a[k] || "") === (b[k] || ""));

  function walkInline(node, ctx, baseRun, items, extra) {
    for (const c of kids(node)) {
      const n = c.localName;
      if (c.namespaceURI === W) {
        if (n === "r") readRun(c, ctx, baseRun, items, extra);
        else if (["hyperlink", "smartTag", "ins", "fldSimple", "customXml", "bdo", "dir"].includes(n)) walkInline(c, ctx, baseRun, items, extra);
        else if (n === "sdt") walkInline(wkid(c, "sdtContent") || c, ctx, baseRun, items, extra);
      } else if (c.namespaceURI === M) {
        if (n === "oMath") items.push({ t: "math", tex: OMML.tex(c, false), display: false });
        else if (n === "oMathPara") {
          for (const om of kids(c)) if (om.localName === "oMath") items.push({ t: "math", tex: OMML.tex(om, false), display: true });
        }
      } else if (n === "AlternateContent") {
        const choice = kids(c).find((x) => x.localName === "Choice") || kids(c).find((x) => x.localName === "Fallback");
        if (choice) walkInline(choice, ctx, baseRun, items, extra);
      }
    }
  }

  function readRun(r, ctx, baseRun, items, extra) {
    const { st } = ctx;
    const direct = runProps(wkid(r, "rPr"));
    const fmt = Object.assign({}, baseRun, direct.rStyle ? styleChain(st, direct.rStyle, "r") : {}, direct);
    delete fmt.rStyle;
    const pushText = (t) => {
      if (!t) return;
      items.push(Object.assign({ t: "text", text: fmt.caps ? t.toUpperCase() : t }, fmt));
    };
    for (const x of kids(r)) {
      const n = x.localName;
      if (n === "t") pushText(x.textContent);
      else if (n === "tab" || n === "ptab") items.push({ t: "tab" });
      else if (n === "br" || n === "cr") {
        if (wval(x, "type") === "page" || wval(x, "type") === "column") continue; // Typst flow ignores manual breaks
        items.push({ t: "br" });
      } else if (n === "noBreakHyphen") pushText("‑");
      else if (n === "softHyphen") continue;
      else if (n === "sym") {
        const ch = parseInt(wval(x, "char") || "0", 16);
        if (ch >= 0x20 && ch < 0xf000) pushText(String.fromCodePoint(ch));
        else pushText("•");
      } else if (n === "drawing") readDrawing(x, ctx, items, extra);
      else if (n === "pict" || n === "object") readVml(x, ctx, items, extra);
      else if (n === "AlternateContent") {
        const choice = kids(x).find((y) => y.localName === "Choice") || kids(x).find((y) => y.localName === "Fallback");
        if (!choice) continue;
        for (const y of kids(choice)) {
          if (y.localName === "drawing") readDrawing(y, ctx, items, extra);
          else if (y.localName === "pict") readVml(y, ctx, items, extra);
        }
      }
    }
  }

  // ---------- drawings ----------
  function readDrawing(drawing, ctx, items, extra) {
    for (const holder of kids(drawing)) { // wp:inline | wp:anchor
      const floating = holder.localName === "anchor";
      const ext = kids(holder).find((c) => c.localName === "extent");
      const cx = ext ? parseInt(ext.getAttribute("cx"), 10) || 0 : 0;
      const cy = ext ? parseInt(ext.getAttribute("cy"), 10) || 0 : 0;
      const gd = firstDesc(holder, "graphicData");
      if (!gd) continue;
      const content = kids(gd)[0];
      if (!content) continue;
      const place = floating ? anchorPlacement(holder, cx, ctx) : {};
      const ln = content.localName;
      if (ln === "pic") {
        const img = picItem(content, ctx);
        if (img) items.push(Object.assign(img, { cx, cy, floating }, place));
      } else if (ln === "wgp" || ln === "wsp") {
        items.push(Object.assign({ t: "shape", el: content, cx, cy, floating, ctx }, place));
      } else if (ln === "chart") {
        items.push({ t: "missing", cx, cy, what: "chart" });
      }
    }
  }

  // floating picture: does text wrap around it (square/tight/through), on which side does it sit, and how far
  // below the top of its paragraph (dy, points) it starts
  function anchorPlacement(anchor, cx, ctx) {
    const wrap = kids(anchor).find((c) => /^wrap/.test(c.localName));
    const wrapped = !!wrap && /^(wrapSquare|wrapTight|wrapThrough)$/.test(wrap.localName);
    const posH = kids(anchor).find((c) => c.localName === "positionH");
    const posV = kids(anchor).find((c) => c.localName === "positionV");
    let side = "right";
    let x = null; // left edge in points from the left of the text column, when known
    if (posH) {
      const align = kids(posH).find((c) => c.localName === "align");
      const off = kids(posH).find((c) => c.localName === "posOffset");
      if (align) {
        side = /left|inside/.test(align.textContent) ? "left" : "right";
        if (ctx && ctx.colW) x = /left|inside/.test(align.textContent) ? 0 : /center/.test(align.textContent) ? (ctx.colW - cx / 12700) / 2 : ctx.colW - cx / 12700;
      } else if (off) {
        x = (parseInt(off.textContent, 10) || 0) / 12700;
        if (ctx && ctx.colW) {
          // the text goes on the wider side; the picture sits on the other one
          const from = posH.getAttribute("relativeFrom");
          if (from === "page" || from === "leftMargin") x -= ctx.marL || 0;
          side = x <= ctx.colW - x - cx / 12700 ? "left" : "right";
        } else side = x < 2.2 * 72 ? "left" : "right";
      }
    }
    let dy = 0;
    if (posV && posV.getAttribute("relativeFrom") === "paragraph") {
      const off = kids(posV).find((c) => c.localName === "posOffset");
      if (off) dy = Math.max(0, (parseInt(off.textContent, 10) || 0) / 12700);
    }
    return { wrap: wrapped ? side : "", dy, x, colW: (ctx && ctx.colW) || 0 };
  }

  function picItem(pic, ctx) {
    const blip = firstDesc(pic, "blip");
    if (!blip) return null;
    const rid = blip.getAttributeNS(R, "embed") || blip.getAttributeNS(R, "link");
    const rel = ctx.rels[rid];
    if (!rel || !rel.target) return null;
    const rect = firstDesc(pic, "srcRect");
    const crop = rect ? ["l", "t", "r", "b"].map((k) => (parseInt(rect.getAttribute(k) || "0", 10) || 0) / 100000) : null;
    return { t: "img", target: rel.target, crop };
  }

  // Legacy VML pictures and text boxes
  function readVml(pict, ctx, items, extra) {
    for (const el of Array.from(pict.getElementsByTagName("*"))) {
      if (el.localName === "imagedata") {
        const rel = ctx.rels[el.getAttributeNS(R, "id")];
        if (!rel || !rel.target) continue;
        const shape = el.parentNode;
        const style = (shape && shape.getAttribute && shape.getAttribute("style")) || "";
        const dim = (k) => {
          const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)(pt|in|px)?`).exec(style);
          if (!m) return 0;
          const v = parseFloat(m[1]), u = m[2] || "px";
          return Math.round(v * (u === "pt" ? 12700 : u === "in" ? 914400 : 9525));
        };
        items.push({ t: "img", target: rel.target, crop: null, cx: dim("width"), cy: dim("height"), floating: false });
      } else if (el.localName === "txbxContent") {
        const blocks = [];
        for (const p of kids(el)) {
          if (p.localName === "p") blocks.push(...readParagraph(p, ctx));
          else if (p.localName === "tbl") blocks.push(readTable(p, ctx));
        }
        if (blocks.some((b) => b.kind !== "p" || b.text.trim())) extra.push({ kind: "textbox", blocks });
      }
    }
  }

  // ---------- tables ----------
  function readTable(tbl, ctx) {
    const grid = wkid(tbl, "tblGrid");
    const cols = grid ? kids(grid).filter((c) => c.localName === "gridCol").map((c) => parseInt(wval(c, "w"), 10) || 0) : [];
    const tblPr = wkid(tbl, "tblPr");
    const borders = wkid(tblPr, "tblBorders");
    let bordered = true;
    if (borders) {
      const edges = kids(borders);
      if (edges.length && edges.every((e) => ["none", "nil"].includes(wval(e) || ""))) bordered = false;
    }
    const rows = [];
    for (const tr of kids(tbl).filter((c) => c.localName === "tr")) {
      const cells = [];
      for (const tc of kids(tr).filter((c) => c.localName === "tc" || c.localName === "sdt")) {
        const cell = tc.localName === "sdt" ? wkid(wkid(tc, "sdtContent"), "tc") : tc;
        if (!cell) continue;
        const pr = wkid(cell, "tcPr");
        const shd = wkid(pr, "shd");
        const fill = shd && wval(shd, "fill") && wval(shd, "fill") !== "auto" ? wval(shd, "fill") : "";
        const vm = wkid(pr, "vMerge");
        const blocks = [];
        for (const x of kids(cell)) {
          if (x.localName === "p") blocks.push(...readParagraph(x, ctx));
          else if (x.localName === "tbl") blocks.push(readTable(x, ctx));
        }
        cells.push({
          blocks, fill,
          span: parseInt(wval(wkid(pr, "gridSpan")) || "1", 10) || 1,
          vmerge: vm ? (wval(vm) === "restart" ? "restart" : "continue") : "",
          valign: wval(wkid(pr, "vAlign")) || "",
        });
      }
      rows.push({ cells, header: !!wkid(wkid(tr, "trPr"), "tblHeader") });
    }
    return { kind: "table", rows, cols, bordered, node: tbl };
  }

  root.DocxReader = { read, readParagraph, readTable, OBJ, W, A, R, WP, kids, firstDesc };
})(typeof globalThis !== "undefined" ? globalThis : this);
