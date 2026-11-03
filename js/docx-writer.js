/* Restyles the MCQ and CQ parts of a .docx in place and leaves everything else exactly as it was.
 *
 * Works on the document.xml DOM the reader parsed; every model block carries its XML node.
 *   MCQ part : two columns (continuous section breaks), 9pt, hanging indent 1.8em, options set on tab
 *              stops with circled ক খ গ ঘ, the answer as a black circle beside the second option row,
 *              board references pushed right at 7pt italic           (tags/mcq.typ)
 *   CQ part  : two columns, 10pt, (ক)-(ঘ) sub-questions indented 0.4in (tags/cq.typ) */
(function (root) {
  "use strict";

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const NS = {
    w: W,
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
    w14: "http://schemas.microsoft.com/office/word/2010/wordml",
    wp14: "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
  };
  const OBJ = "";
  const OPT_MARK_G = /\(\s*([কখগঘঙ])\s*\)+/g;
  const LETTERS = "কখগঘঙ";
  const TAG_LINE = /^\s*[A-Za-z][\w -]*\(\s*(start|end)\s*\)\s*$/i;
  const TAG_HEAD = /^\s*[A-Za-z][\w -]*\(\s*(?:start|end)\s*\)[^\S\n]*\n?/i;

  // Style values in Word units (twips = 1/20 pt, half-points for font size, EMU for drawings), worked
  // out from the settings (Settings.DEFAULTS are the Typst template values)
  const SMALL_SZ = 16; // runs at 8pt or less are small print (board references) and keep their size
  let S, MCQ_SZ, CQ_SZ, SRC_SZ, HANG, CQ_INDENT, ANS_COL, OPT_D, ANS_D;
  const hex = (c) => String(c || "#000000").replace("#", "").toUpperCase();
  const isBlack = (c) => /^#?0{6}$/.test(String(c || "#000000"));
  function useSettings(settings) {
    S = settings;
    const m = S.mcq;
    MCQ_SZ = Math.round(m.fontSize * 2);
    CQ_SZ = Math.round(S.cq.fontSize * 2);
    SRC_SZ = Math.round(m.sourceSize * 2);
    HANG = Math.round(m.hangingEm * m.fontSize * 20);
    CQ_INDENT = Math.round(S.cq.subIndent * 1440);
    OPT_D = Math.round(m.circleEm * m.fontSize * 12700);
    ANS_D = Math.round(m.answerEm * m.fontSize * 12700);
    ANS_COL = Math.round(m.answerEm * m.fontSize * 20 + m.ansGapEm * m.fontSize * 20);
  }

  // child order Word expects inside property elements
  const RPR = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];
  const PPR = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
  const SPR = ["headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc", "pgBorders", "lnNumType", "pgNumType", "cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter", "docGrid", "printerSettings", "sectPrChange"];
  const TPR = ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook"];

  let doc, docPrId;

  // ---------- small XML helpers ----------
  const kids = (el) => Array.from((el && el.children) || []);
  const wkid = (el, name) => kids(el).find((c) => c.localName === name && c.namespaceURI === W) || null;
  const isW = (el, name) => el && el.namespaceURI === W && el.localName === name;
  function wel(name, attrs) {
    const e = doc.createElementNS(W, "w:" + name);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttributeNS(W, "w:" + k, String(v));
    return e;
  }
  // put `el` into `parent`, replacing a child of the same name, at the place `order` says
  function setChild(parent, el, order) {
    for (const c of kids(parent)) if (c.namespaceURI === W && c.localName === el.localName) parent.removeChild(c);
    const idx = order.indexOf(el.localName);
    const after = kids(parent).find((c) => order.indexOf(c.localName) > idx);
    parent.insertBefore(el, after || null);
    return el;
  }
  function removeChild(parent, name) { const c = wkid(parent, name); if (c) parent.removeChild(c); }
  function pPrOf(p) {
    let pPr = wkid(p, "pPr");
    if (!pPr) { pPr = wel("pPr"); p.insertBefore(pPr, p.firstChild); }
    return pPr;
  }
  function rPrOf(r) {
    let rPr = wkid(r, "rPr");
    if (!rPr) { rPr = wel("rPr"); r.insertBefore(rPr, r.firstChild); }
    return rPr;
  }
  const inTextBox = (n, stop) => { for (let a = n.parentNode; a && a !== stop; a = a.parentNode) if (a.localName === "txbxContent" || a.localName === "drawing" || a.localName === "pict") return true; return false; };

  // font size of every run in a paragraph (small print such as board references keeps its size)
  function setSizes(p, sz, styleSz) {
    const apply = (rPr) => {
      const cur = wkid(rPr, "sz");
      const v = cur ? parseInt(cur.getAttributeNS(W, "val"), 10) : styleSz;
      if (v && v <= SMALL_SZ) return;
      setChild(rPr, wel("sz", { val: sz }), RPR);
      setChild(rPr, wel("szCs", { val: sz }), RPR);
    };
    for (const r of Array.from(p.getElementsByTagNameNS(W, "r"))) {
      if (inTextBox(r, p)) continue;
      apply(rPrOf(r));
    }
    for (const mr of Array.from(p.getElementsByTagNameNS(M, "r"))) { const rPr = wkid(mr, "rPr"); if (rPr) apply(rPr); }
    const pPr = pPrOf(p);
    let mark = wkid(pPr, "rPr");
    if (!mark) mark = setChild(pPr, wel("rPr"), PPR);
    apply(mark);
  }

  // ---------- paragraph content as cuttable atoms ----------
  // Every child of the paragraph becomes one atom; runs are split so each run holds one piece of content.
  // `t` is the atom's text (OBJ for pictures/equations), `cut` whether it can be split inside.
  function atoms(p) {
    const out = [];
    for (const c of kids(p)) {
      if (isW(c, "pPr")) continue;
      if (isW(c, "r")) {
        const rPr = wkid(c, "rPr");
        const content = kids(c).filter((x) => x !== rPr);
        if (content.length <= 1) { out.push(atomOf(c)); continue; }
        for (const x of content) {
          const r = wel("r");
          if (rPr) r.appendChild(rPr.cloneNode(true));
          r.appendChild(x);
          p.insertBefore(r, c);
          out.push(atomOf(r));
        }
        p.removeChild(c);
      } else out.push(atomOf(c));
    }
    return out;
  }
  function atomOf(n) {
    if (isW(n, "r")) {
      const x = kids(n).find((k) => !isW(k, "rPr"));
      if (!x) return { n, t: "" };
      const ln = x.localName;
      if (ln === "t") return { n, t: x.textContent, cut: true };
      if (ln === "tab" || ln === "ptab") return { n, t: "\t" };
      if (ln === "br" || ln === "cr") return { n, t: "\n" };
      if (ln === "noBreakHyphen") return { n, t: "-" };
      if (["fldChar", "instrText", "lastRenderedPageBreak", "footnoteRef", "endnoteRef", "softHyphen"].includes(ln)) return { n, t: "" };
      return { n, t: OBJ };
    }
    if (n.namespaceURI === M) return { n, t: OBJ };
    if (["hyperlink", "ins", "smartTag", "fldSimple", "sdt", "customXml"].includes(n.localName)) {
      return { n, t: Array.from(n.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join("") };
    }
    return { n, t: "" }; // bookmarks, proofing marks, deleted text
  }
  const joined = (L) => L.map((a) => a.t).join("");
  function setText(run, s) {
    const t = wkid(run, "t");
    t.textContent = s;
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
  }
  // make `pos` an atom boundary (splitting a text run if needed); returns the index of the atom starting there
  function cutAt(L, pos) {
    let acc = 0;
    for (let i = 0; i < L.length; i++) {
      const len = L[i].t.length;
      if (pos === acc) return i;
      if (pos < acc + len) {
        if (!L[i].cut) return pos - acc < len / 2 ? i : i + 1;
        const k = pos - acc, s = L[i].t;
        const r2 = L[i].n.cloneNode(true);
        setText(L[i].n, s.slice(0, k));
        setText(r2, s.slice(k));
        L[i].n.parentNode.insertBefore(r2, L[i].n.nextSibling);
        L[i].t = s.slice(0, k);
        L.splice(i + 1, 0, { n: r2, t: s.slice(k), cut: true });
        return i + 1;
      }
      acc += len;
    }
    return L.length;
  }
  function range(L, a, b) {
    const i = cutAt(L, a), j = cutAt(L, b);
    return L.slice(i, j);
  }
  // drop leading/trailing whitespace of a run of atoms
  function trim(list) {
    const out = list.slice();
    const edge = (fromStart) => {
      while (out.length) {
        const a = fromStart ? out[0] : out[out.length - 1];
        if (a.cut) {
          const s = fromStart ? a.t.replace(/^\s+/, "") : a.t.replace(/\s+$/, "");
          if (s) { if (s !== a.t) { a.t = s; setText(a.n, s); } return; }
        } else if (a.t.trim() !== "") return;
        (fromStart ? out.shift() : out.pop()); // whitespace, bookmarks, proofing marks
      }
    };
    edge(true); edge(false);
    return out;
  }

  // ---------- circles (small inline Word shapes, like the Typst opt-circle / mcq-ans) ----------
  const parser = () => new DOMParser();
  const NSDECL = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join(" ");
  // The circles are small pictures drawn here, with the letter centred on its actual ink. (A Word text box
  // places the letter by the font's line metrics, which differ from font to font and left it off-centre.)
  const SCALE = 10; // pixels per point: sharp in print
  let circleRels = {}; // "o" + letter / "a" + letter -> relationship id
  async function drawCircle(letter, filled) {
    const m = S.mcq;
    const dpt = (filled ? m.answerEm : m.circleEm) * m.fontSize;
    const W = Math.round(dpt * SCALE);
    const cv = document.createElement("canvas");
    cv.width = cv.height = W;
    const g = cv.getContext("2d");
    const lw = filled ? 0 : m.circleStroke * SCALE;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - lw / 2 - 0.5, 0, Math.PI * 2);
    if (filled) { g.fillStyle = m.answerFill; g.fill(); }
    else { g.lineWidth = lw; g.strokeStyle = m.circleColor; g.stroke(); }
    const px = (filled ? m.answerTextSize : m.circleTextSize) * SCALE;
    g.font = `bold ${px}px Kalpurush, "Noto Sans Bengali", "Noto Serif Bengali", sans-serif`;
    g.fillStyle = filled ? m.answerTextColor : m.circleTextColor;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    const t = g.measureText(letter);
    const L = t.actualBoundingBoxLeft, R = t.actualBoundingBoxRight, A = t.actualBoundingBoxAscent, D = t.actualBoundingBoxDescent;
    g.fillText(letter, (W - (L + R)) / 2 + L, (W - (A + D)) / 2 + A);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function makeCircles(model) {
    if (root.ASSETS && !Array.from(document.fonts).some((f) => f.family.replace(/"/g, "") === "Kalpurush" && f.status === "loaded")) {
      try { document.fonts.add(await new FontFace("Kalpurush", `url(${root.ASSETS.kalpurush})`).load()); } catch (e) { /* system Bangla font */ }
    }
    const dir = model.mainPath.slice(0, model.mainPath.lastIndexOf("/") + 1);
    const relsPath = `${dir}_rels/${model.mainPath.slice(dir.length)}.rels`;
    const rels = parser().parseFromString(await model.zip.file(relsPath).async("string"), "application/xml");
    const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
    const taken = new Set(Array.from(rels.getElementsByTagNameNS(PKG, "Relationship")).map((r) => r.getAttribute("Id")));
    circleRels = {};
    let n = 0;
    for (const filled of [false, true]) {
      for (const [i, letter] of [...LETTERS].entries()) {
        const name = `typst_${filled ? "answer" : "option"}_${i + 1}.png`;
        model.zip.file(`${dir}media/${name}`, await drawCircle(letter, filled));
        let id;
        do id = "rIdTypstC" + ++n; while (taken.has(id));
        const r = rels.createElementNS(PKG, "Relationship");
        r.setAttribute("Id", id);
        r.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
        r.setAttribute("Target", "media/" + name);
        rels.documentElement.appendChild(r);
        circleRels[(filled ? "a" : "o") + letter] = id;
      }
    }
    model.zip.file(relsPath, new XMLSerializer().serializeToString(rels));
    const ctFile = model.zip.file("[Content_Types].xml");
    let ct = await ctFile.async("string");
    if (!/Extension="png"/i.test(ct)) ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
    model.zip.file("[Content_Types].xml", ct);
  }

  function circleRun(letter, filled) {
    const d = filled ? ANS_D : OPT_D;
    const id = ++docPrId;
    const drop = Math.round((d / 12700) * 0.62); // half-points below the baseline, so the circle sits on the text's middle
    const xml = `<w:r ${NSDECL} xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<w:rPr><w:noProof/><w:position w:val="-${drop}"/></w:rPr><w:drawing>` +
      `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${d}" cy="${d}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${id}" name="${filled ? "answer" : "option"} ${letter}" descr="(${letter})"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${filled ? "answer" : "option"}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${circleRels[(filled ? "a" : "o") + letter]}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${d}" cy="${d}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const frag = parser().parseFromString(xml, "application/xml").documentElement;
    return doc.importNode(frag, true);
  }
  function textRun(s, like) {
    const r = wel("r");
    const rPr = like && wkid(like, "rPr");
    if (rPr) r.appendChild(rPr.cloneNode(true));
    const t = wel("t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = s;
    r.appendChild(t);
    return r;
  }
  function tabRun() { const r = wel("r"); r.appendChild(wel("tab")); return r; }

  // ---------- sections: two columns around a part ----------
  function textWidth(sp) {
    const sz = wkid(sp, "pgSz"), mar = wkid(sp, "pgMar");
    const g = (el, a, d) => (el && parseInt(el.getAttributeNS(W, a), 10)) || d;
    let w = g(sz, "w", 12240);
    if (sz && sz.getAttributeNS(W, "orient") === "landscape" && g(sz, "h", 15840) > w) w = g(sz, "h", 15840);
    return w - g(mar, "left", 1440) - g(mar, "right", 1440) - g(mar, "gutter", 0);
  }
  // columns for an MCQ / CQ part (`part` = S.mcq or S.cq)
  function setCols(sp, part) {
    const tw = textWidth(sp);
    const n = Math.max(1, Math.round(part.columns));
    setChild(sp, n > 1 ? wel("cols", { num: n, space: Math.round((tw * part.gutter) / 100) }) : wel("cols", { space: 720 }), SPR);
  }
  const colWidth = (tw, part) => { const n = Math.max(1, Math.round(part.columns)); return Math.round((tw - (n > 1 ? (tw * part.gutter) / 100 : 0) * (n - 1)) / n); };
  // a run's colour, unless it is plain black (that would wipe colours the Word file already has)
  function colorRuns(p, color) {
    if (isBlack(color)) return;
    for (const r of Array.from(p.getElementsByTagNameNS(W, "r"))) {
      if (inTextBox(r, p)) continue;
      setChild(rPrOf(r), wel("color", { val: hex(color) }), RPR);
    }
  }
  function sectOf(p) { return isW(p, "p") ? wkid(wkid(p, "pPr"), "sectPr") : null; }
  // the section properties that govern `node`: the next section break at or after it
  function governing(body, node) {
    for (let n = node; n; n = n.nextElementSibling) {
      if (isW(n, "sectPr")) return n;
      const s = sectOf(n);
      if (s) return s;
    }
    return wkid(body, "sectPr");
  }
  function breakPara(sp) {
    const p = wel("p");
    const pPr = p.appendChild(wel("pPr"));
    pPr.appendChild(wel("spacing", { before: 0, after: 0, line: 240, lineRule: "auto" }));
    const rPr = pPr.appendChild(wel("rPr"));
    rPr.appendChild(wel("sz", { val: 2 }));
    rPr.appendChild(wel("szCs", { val: 2 }));
    pPr.appendChild(sp);
    return p;
  }

  // ---------- fitting wide pictures and tables into a column ----------
  function fitToColumn(node, colTw) {
    const maxEmu = colTw * 635;
    for (const ext of Array.from(node.getElementsByTagNameNS(NS.wp, "extent"))) {
      const cx = parseInt(ext.getAttribute("cx"), 10), cy = parseInt(ext.getAttribute("cy"), 10);
      if (!(cx > maxEmu)) continue;
      const k = maxEmu / cx;
      ext.setAttribute("cx", Math.round(cx * k));
      ext.setAttribute("cy", Math.round(cy * k));
      const holder = ext.parentNode;
      // the picture's (or group's) own size must follow the frame
      const g = holder.getElementsByTagNameNS(NS.a, "graphicData")[0];
      const top = g && kids(g)[0];
      const spPr = top && kids(top).find((c) => c.localName === "spPr" || c.localName === "grpSpPr");
      const x = spPr && spPr.getElementsByTagNameNS(NS.a, "ext")[0];
      if (x && x.parentNode.localName === "xfrm") { x.setAttribute("cx", Math.round(cx * k)); x.setAttribute("cy", Math.round(cy * k)); }
    }
    for (const tbl of isW(node, "tbl") ? [node] : Array.from(node.getElementsByTagNameNS(W, "tbl"))) {
      const grid = wkid(tbl, "tblGrid");
      const cols = grid ? kids(grid).filter((c) => c.localName === "gridCol") : [];
      const total = cols.reduce((s, c) => s + (parseInt(c.getAttributeNS(W, "w"), 10) || 0), 0);
      if (total <= colTw) continue;
      const k = colTw / total;
      cols.forEach((c) => c.setAttributeNS(W, "w:w", Math.floor((parseInt(c.getAttributeNS(W, "w"), 10) || 0) * k)));
      for (const tcW of Array.from(tbl.getElementsByTagNameNS(W, "tcW"))) {
        if (tcW.getAttributeNS(W, "type") === "dxa") tcW.setAttributeNS(W, "w:w", Math.floor((parseInt(tcW.getAttributeNS(W, "w"), 10) || 0) * k));
      }
      let tblPr = wkid(tbl, "tblPr");
      if (!tblPr) { tblPr = wel("tblPr"); tbl.insertBefore(tblPr, tbl.firstChild); }
      setChild(tblPr, wel("tblW", { w: 5000, type: "pct" }), TPR);
      removeChild(tblPr, "tblInd");
    }
  }

  // ---------- MCQ ----------
  function optionsFrom(paras) {
    const opts = [];
    for (const p of paras) {
      const L = atoms(p);
      const text = joined(L);
      const marks = [...text.matchAll(OPT_MARK_G)];
      if (!marks.length) {
        if (!opts.length) return null;
        opts[opts.length - 1].nodes.push(...trim(L));
        continue;
      }
      const ends = marks.map((m, k) => (k + 1 < marks.length ? marks[k + 1].index : text.length));
      // cut from the right so earlier offsets stay valid
      const parts = [];
      for (let k = marks.length - 1; k >= 0; k--) parts[k] = trim(range(L, marks[k].index + marks[k][0].length, ends[k]));
      const before = trim(range(L, 0, marks[0].index));
      if (before.length) {
        if (opts.length) opts[opts.length - 1].nodes.push(...before);
        else if (before.every((a) => a.t === OBJ)) parts[0] = before.concat(parts[0]);
        else return null;
      }
      marks.forEach((m, k) => opts.push({ letter: m[1], nodes: parts[k], p }));
    }
    opts.sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
    if (!/^কখ(গ(ঘ(ঙ)?)?)?$/.test(opts.map((o) => o.letter).join(""))) return null;
    return opts;
  }

  function optionParagraph(cells, ans, indent, tabPos, keepNext, like) {
    const p = wel("p");
    const pPr = p.appendChild(wel("pPr"));
    if (keepNext) setChild(pPr, wel("keepNext"), PPR);
    if (tabPos) {
      const tabs = setChild(pPr, wel("tabs"), PPR);
      tabs.appendChild(wel("tab", { val: "left", pos: tabPos }));
    }
    // Typst row-gutter (0.8em) is measured between the circles; Word's "space after" is below the text line
    setChild(pPr, wel("spacing", { before: 0, after: Math.round(S.mcq.rowGapEm * S.mcq.fontSize * 15), line: 240, lineRule: "auto" }), PPR);
    setChild(pPr, wel("ind", ans ? { left: indent, hanging: indent } : { left: indent, firstLine: 0 }), PPR);
    setChild(pPr, wel("jc", { val: "left" }), PPR);
    if (ans) { p.appendChild(circleRun(ans, true)); p.appendChild(tabRun()); }
    cells.forEach((c, i) => {
      if (i) p.appendChild(tabRun());
      p.appendChild(circleRun(c.letter, false));
      const first = c.nodes.find((a) => isW(a.n, "r"));
      p.appendChild(textRun(" ", first ? first.n : like));
      for (const a of c.nodes) p.appendChild(a.n);
    });
    colorRuns(p, S.mcq.optionColor);
    p._optionRow = true;
    return p;
  }

  // the Typst rule: options in pairs, one per row when an option is long
  function layoutOptions(opts, answer, colTw, like) {
    const indent = answer ? ANS_COL : 0;
    const textLen = (o) => o.nodes.map((a) => (a.t === OBJ ? "" : a.t)).join("").trim().length;
    const pics = opts.some((o) => o.nodes.some((a) => a.t === OBJ));
    const stacked = !pics && opts.length <= 4 && Math.max(...opts.map(textLen)) > S.mcq.stackAfter;
    const rows = [];
    if (stacked) opts.forEach((o) => rows.push([o]));
    else for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2));
    const ansRow = stacked ? 2 : opts.length === 5 ? 2 : 1;
    const tabPos = stacked ? 0 : Math.round(indent + (colTw - indent) / 2 + 45);
    const keep = S.mcq.keepTogether;
    return rows.map((row, r) => optionParagraph(row, r === Math.min(ansRow, rows.length - 1) ? answer : null, indent, tabPos, keep && r < rows.length - 1, like));
  }

  // trailing "[ঢা. বো. '২৫]": small italic, pushed to the right edge on a right tab stop (Typst mcq-source)
  function sourceRight(p, colTw) {
    const L = atoms(p);
    const text = joined(L);
    const m = /\s*(\[[^\[\]]*\])\s*$/.exec(text);
    if (!m || m[1].length > 220 || !/(বো|বোর্ড|কলেজ|স্কুল|বিদ্যালয়|ক্যাডেট|[০-৯0-9]{2})/.test(m[1])) return;
    const start = m.index + m[0].indexOf("[");
    const src = range(L, start, text.length);
    if (!src.length) return;
    for (const a of src) {
      if (!isW(a.n, "r")) continue;
      const rPr = rPrOf(a.n);
      if (S.mcq.sourceItalic) { setChild(rPr, wel("i"), RPR); setChild(rPr, wel("iCs"), RPR); }
      setChild(rPr, wel("sz", { val: SRC_SZ }), RPR);
      setChild(rPr, wel("szCs", { val: SRC_SZ }), RPR);
      if (!isBlack(S.mcq.sourceColor)) setChild(rPr, wel("color", { val: hex(S.mcq.sourceColor) }), RPR);
      a.n._source = true;
    }
    // never break inside the reference: if it does not fit, all of it goes to the next line (as in Typst)
    for (const a of src) {
      if (!a.cut) continue;
      const parts = a.t.replace(/ /g, " ").split("-");
      setText(a.n, parts[0]);
      let at = a.n;
      for (const part of parts.slice(1)) {
        const hy = a.n.cloneNode(true);
        hy.replaceChild(wel("noBreakHyphen"), wkid(hy, "t"));
        hy._source = true;
        at.parentNode.insertBefore(hy, at.nextSibling);
        at = hy;
        if (!part) continue;
        const rest = a.n.cloneNode(true);
        setText(rest, part);
        rest._source = true;
        at.parentNode.insertBefore(rest, at.nextSibling);
        at = rest;
      }
    }
    if (!S.mcq.sourceRight) return;
    p.insertBefore(tabRun(), src[0].n);
    const pPr = pPrOf(p);
    // justified, the line before a reference that moved down would be stretched word by word
    setChild(pPr, wel("jc", { val: "left" }), PPR);
    const tabs = wkid(pPr, "tabs") || setChild(pPr, wel("tabs"), PPR);
    tabs.appendChild(wel("tab", { val: "right", pos: colTw }));
  }

  // colour of a question title, leaving the board reference its own colour
  function colorTitle(p, color) {
    if (isBlack(color)) return;
    for (const r of Array.from(p.getElementsByTagNameNS(W, "r"))) {
      if (r._source || inTextBox(r, p)) continue;
      setChild(rPrOf(r), wel("color", { val: hex(color) }), RPR);
    }
  }

  function hanging(p) {
    const pPr = pPrOf(p);
    if (wkid(pPr, "numPr")) return; // Word's own list numbering keeps its indents
    setChild(pPr, wel("ind", { left: HANG, hanging: HANG }), PPR);
  }

  function styleMcq(seg, colTw) {
    const units = root.Classify.mcqUnits(seg.blocks);
    let done = 0;
    for (const u of units) {
      if (u.u === "stim") {
        for (const b of u.passage) if (b.kind === "p" && b.node) sourceRight(b.node, colTw);
        continue;
      }
      if (u.u !== "q" || !u.title.node) continue;
      sourceRight(u.title.node, colTw);
      colorTitle(u.title.node, S.mcq.questionColor);
      if (S.mcq.keepTogether) {
        setChild(pPrOf(u.title.node), wel("keepNext"), PPR);
        for (const b of u.extras) if (b.kind === "p" && b.node) setChild(pPrOf(b.node), wel("keepNext"), PPR);
      }
      const paraNodes = u.optParas.map((b) => b.node).filter(Boolean);
      if (!paraNodes.length) continue;
      const anchor = u.optTable ? u.optTable.node : paraNodes[0];
      const like = u.title.node.getElementsByTagNameNS(W, "r")[0];
      const opts = optionsFrom(paraNodes);
      if (!opts) continue;
      const rows = layoutOptions(opts, u.answer, colTw, like);
      rows.forEach((r) => anchor.parentNode.insertBefore(r, anchor));
      if (u.optTable) u.optTable.node.remove();
      else paraNodes.forEach((p) => p.remove());
      if (u.answer && u.answerBlock && u.answerBlock.node) u.answerBlock.node.remove();
      done++;
    }
    return done;
  }

  function styleCq(seg) {
    const roles = root.Classify.cqRoles(seg.blocks);
    seg.blocks.forEach((b, i) => {
      if (b.kind !== "p" || !b.node) return;
      colorRuns(b.node, S.cq.textColor);
      if (roles[i] === "cq-subq") {
        setChild(pPrOf(b.node), wel("ind", { left: CQ_INDENT, firstLine: 0 }), PPR);
        colorRuns(b.node, S.cq.subColor);
      }
      if (S.cq.keepHeaders && (roles[i] === "cq-anshdr" || roles[i] === "cq-section")) setChild(pPrOf(b.node), wel("keepNext"), PPR);
    });
  }

  // "mcq (start)" style tags left from the Typst workflow
  function removeTags(body) {
    for (const p of Array.from(body.getElementsByTagNameNS(W, "p"))) {
      if (inTextBox(p, body) || !/\(\s*(start|end)\s*\)/i.test(p.textContent)) continue;
      const L = atoms(p);
      const text = joined(L);
      if (TAG_LINE.test(text)) {
        if (p.parentNode === body && !sectOf(p)) p.remove();
        else range(L, 0, text.length).forEach((a) => a.n.remove());
        continue;
      }
      const m = TAG_HEAD.exec(text);
      if (m && text.slice(m[0].length).trim()) range(L, 0, m[0].length).forEach((a) => a.n.remove());
    }
  }

  // ---------- main ----------
  /** model: DocxReader.read() result; segs: Classify.segment(model.blocks); settings: Settings.load().
   *  Returns { blob, stats }. */
  async function write(model, segs, settings, opts) {
    useSettings(settings || root.Settings.DEFAULTS);
    doc = model.doc;
    const rootEl = doc.documentElement;
    for (const [k, v] of Object.entries(NS)) {
      if (k !== "w" && !rootEl.getAttribute("xmlns:" + k)) rootEl.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:" + k, v);
    }
    docPrId = Math.max(1000, ...Array.from(doc.getElementsByTagNameNS(NS.wp, "docPr")).map((d) => parseInt(d.getAttribute("id"), 10) || 0)) + 1;
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    const top = (n) => { while (n && n.parentNode !== body) n = n.parentNode; return n; };
    const clones = []; // [clone, original sectPr]
    const PS = root.DocxPageSetup;
    // page size and margins first: the column widths below depend on them
    if (S.page.enabled) for (const sp of Array.from(body.getElementsByTagNameNS(W, "sectPr"))) PS.geometry(sp, S, { wel, setChild, wkid, SPR });
    if (segs.some((s) => s.type === "mcq")) await makeCircles(model);

    const stats = { mcq: 0, cq: 0, questions: 0 };
    for (const seg of segs) {
      if (seg.type !== "mcq" && seg.type !== "cq") continue;
      const nodes = seg.blocks.map((b) => b.node && top(b.node)).filter(Boolean);
      if (!nodes.length) continue;
      const first = nodes[0], last = nodes[nodes.length - 1];
      const gov = governing(body, last);
      if (!gov) continue;
      const govAsWas = gov.cloneNode(true); // taken before this part changes any columns
      stats[seg.type]++;
      const part = seg.type === "mcq" ? S.mcq : S.cq;
      const colTw = colWidth(textWidth(gov), part);

      // markers so the part can be found again after its paragraphs are rebuilt
      const startMark = doc.createComment("part"), endMark = doc.createComment("end");
      body.insertBefore(startMark, first);
      body.insertBefore(endMark, last.nextSibling);

      if (seg.type === "mcq") stats.questions += styleMcq(seg, colTw); else styleCq(seg);

      // the part's paragraphs: size, MCQ hanging indent, fitting wide pictures and tables
      const inPart = [];
      for (let n = startMark.nextSibling; n && n !== endMark; n = n.nextSibling) if (n.nodeType === 1) inPart.push(n);
      const styleSz = 0;
      for (const n of inPart) {
        const paras = isW(n, "p") ? [n] : Array.from(n.getElementsByTagNameNS(W, "p")).filter((p) => !inTextBox(p, n));
        for (const p of paras) {
          setSizes(p, seg.type === "mcq" ? MCQ_SZ : CQ_SZ, styleSz);
          if (seg.type === "mcq" && isW(n, "p") && !p._optionRow) hanging(p);
        }
        fitToColumn(n, colTw);
        const s = sectOf(n);
        if (s) setCols(s, part); // a section break inside the part
      }

      // section break before the part (keeps whatever came before as it was)
      const prev = startMark.previousElementSibling;
      if (prev && !sectOf(prev)) {
        const c = govAsWas.cloneNode(true);
        clones.push([c, gov]);
        body.insertBefore(breakPara(c), startMark);
      }
      // section break after the part, with two columns
      const lastEl = endMark.previousElementSibling;
      if (sectOf(lastEl)) setCols(sectOf(lastEl), part);
      else if (endMark.nextElementSibling && isW(endMark.nextElementSibling, "sectPr")) setCols(endMark.nextElementSibling, part);
      else {
        const c = govAsWas.cloneNode(true);
        setCols(c, part);
        clones.push([c, gov]);
        body.insertBefore(breakPara(c), endMark);
      }
      startMark.remove();
      endMark.remove();
    }

    // Each original section is now cut into pieces: only the first piece starts the way the original
    // did (new page, first-page header, page-number restart); the others follow on continuously.
    const byOrig = new Map();
    for (const [c, o] of clones) { if (!byOrig.has(o)) byOrig.set(o, []); byOrig.get(o).push(c); }
    for (const [orig, cs] of byOrig) {
      const pieces = cs.concat([orig]);
      pieces.forEach((sp, i) => {
        if (i === 0) return;
        setChild(sp, wel("type", { val: "continuous" }), SPR);
        removeChild(sp, "titlePg");
        const pn = wkid(sp, "pgNumType");
        if (pn) pn.removeAttributeNS(W, "start");
      });
    }

    removeTags(body);

    // Typst header and footer on every section (a cut-up section keeps its chapter's header text)
    if (S.header.enabled || S.footer.enabled) {
      const origOf = new Map(clones.map(([c, o]) => [c, o]));
      const labelOf = (sp) => (model.sectionLabels && model.sectionLabels.get(origOf.get(sp) || sp)) || null;
      await PS.headersFooters({ doc, zip: model.zip, mainPath: model.mainPath, body, S, labelOf, docPrStart: docPrId + 1000 });
    }

    let xml = new XMLSerializer().serializeToString(doc);
    if (!xml.startsWith("<?xml")) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    model.zip.file(model.mainPath, xml);
    const blob = await model.zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    return { blob, stats };
  }

  root.DocxWriter = { write };
})(typeof globalThis !== "undefined" ? globalThis : this);
