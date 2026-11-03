/* Word drawings (DrawingML shapes and shape groups: flowcharts, labelled boxes, arrows) -> HTML/SVG.
 * Coordinates are worked out in CSS pixels at 96 dpi; the caller scales the result to the column. */
(function (root) {
  "use strict";

  const EMU = 9525; // EMU per CSS px
  const SVGNS = "http://www.w3.org/2000/svg";
  const kids = (el) => Array.from((el && el.children) || []);
  const nm = (el, n) => kids(el).find((c) => c.localName === n) || null;
  const desc = (el, n) => (el ? el.getElementsByTagNameNS("*", n)[0] || null : null);
  const num = (el, a) => parseInt((el && el.getAttribute(a)) || "0", 10) || 0;

  function xfrmOf(node) {
    const pr = nm(node, "spPr") || nm(node, "grpSpPr");
    const x = pr && nm(pr, "xfrm");
    if (!x) return null;
    const off = nm(x, "off"), ext = nm(x, "ext"), cho = nm(x, "chOff"), che = nm(x, "chExt");
    return {
      x: num(off, "x"), y: num(off, "y"), w: num(ext, "cx"), h: num(ext, "cy"),
      cx: num(cho, "x"), cy: num(cho, "y"), cw: num(che, "cx") || num(ext, "cx"), ch: num(che, "cy") || num(ext, "cy"),
      rot: num(x, "rot") / 60000, flipH: x.getAttribute("flipH") === "1", flipV: x.getAttribute("flipV") === "1",
    };
  }

  // theme colours (word/theme/theme1.xml), set by the reader; Word's defaults otherwise
  const theme = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };
  const ALIAS = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
  function setTheme(doc) {
    const scheme = doc && doc.getElementsByTagNameNS("*", "clrScheme")[0];
    if (!scheme) return;
    for (const c of kids(scheme)) {
      const v = kids(c)[0];
      if (!v) continue;
      const hex = v.localName === "srgbClr" ? v.getAttribute("val") : v.getAttribute("lastClr");
      if (hex) theme[c.localName] = hex;
    }
  }

  // apply DrawingML colour modifiers (lumMod / lumOff / shade / tint) in HSL lightness
  function modify(hex, el) {
    let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mods = kids(el);
    if (!mods.length) return "#" + hex;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    for (const m of mods) {
      const v = (parseInt(m.getAttribute("val"), 10) || 0) / 100000;
      if (m.localName === "lumMod") l *= v;
      else if (m.localName === "lumOff") l += v;
      else if (m.localName === "shade") l *= v;
      else if (m.localName === "tint") l = l + (1 - l) * (1 - v);
    }
    l = Math.max(0, Math.min(1, l));
    const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    if (s === 0) r = g = b = l;
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
    }
    return "#" + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }

  function colorOf(fillEl) {
    if (!fillEl) return null;
    const c = kids(fillEl)[0];
    if (!c) return null;
    if (c.localName === "srgbClr") return modify(c.getAttribute("val"), c);
    if (c.localName === "prstClr") return c.getAttribute("val");
    if (c.localName === "sysClr") return modify(c.getAttribute("lastClr") || "000000", c);
    if (c.localName === "schemeClr") {
      const v = c.getAttribute("val");
      return modify(theme[ALIAS[v] || v] || "808080", c);
    }
    return null;
  }

  // fill / outline of a shape: explicit spPr values, else the shape style (theme) defaults in black and white
  function paintOf(sp) {
    const spPr = nm(sp, "spPr");
    const style = nm(sp, "style");
    let fill = null, line = null, lineW = 0.75, dash = "", head = "", tail = "";
    if (spPr) {
      if (nm(spPr, "noFill")) fill = "none";
      else if (nm(spPr, "solidFill")) fill = colorOf(nm(spPr, "solidFill"));
      const ln = nm(spPr, "ln");
      if (ln) {
        if (ln.getAttribute("w")) lineW = num(ln, "w") / 12700;
        if (nm(ln, "noFill")) line = "none";
        else if (nm(ln, "solidFill")) line = colorOf(nm(ln, "solidFill"));
        const pd = nm(ln, "prstDash");
        if (pd && pd.getAttribute("val") !== "solid") dash = pd.getAttribute("val");
        const he = nm(ln, "headEnd"), te = nm(ln, "tailEnd");
        if (he && he.getAttribute("type") && he.getAttribute("type") !== "none") head = he.getAttribute("type");
        if (te && te.getAttribute("type") && te.getAttribute("type") !== "none") tail = te.getAttribute("type");
      }
    }
    if (fill === null) fill = style && num(nm(style, "fillRef"), "idx") > 0 ? "#ffffff" : "none";
    if (line === null) line = style && num(nm(style, "lnRef"), "idx") > 0 ? "#000000" : "none";
    return { fill, line, lineW: Math.max(0.5, lineW), dash, head, tail };
  }

  const LINES = /^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5])$/;

  function arrowMarker(svg, id, color) {
    const defs = svg.querySelector("defs") || svg.appendChild(document.createElementNS(SVGNS, "defs"));
    const m = document.createElementNS(SVGNS, "marker");
    m.setAttribute("id", id);
    m.setAttribute("viewBox", "0 0 10 10");
    m.setAttribute("refX", "9"); m.setAttribute("refY", "5");
    m.setAttribute("markerWidth", "7"); m.setAttribute("markerHeight", "7");
    m.setAttribute("orient", "auto-start-reverse");
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", "M0,0 L10,5 L0,10 z");
    p.setAttribute("fill", color);
    m.appendChild(p);
    defs.appendChild(m);
  }

  let markerSeq = 0;
  function drawLine(svg, prst, box, paint) {
    let { x0, y0, x1, y1 } = box;
    if (box.flipH) [x0, x1] = [x1, x0];
    if (box.flipV) [y0, y1] = [y1, y0];
    const path = document.createElementNS(SVGNS, "path");
    let d;
    if (/^bentConnector3$/.test(prst)) {
      const mx = (x0 + x1) / 2;
      d = `M${x0},${y0} L${mx},${y0} L${mx},${y1} L${x1},${y1}`;
    } else if (/^bentConnector2$/.test(prst)) d = `M${x0},${y0} L${x1},${y0} L${x1},${y1}`;
    else if (/^bentConnector/.test(prst)) {
      const my = (y0 + y1) / 2;
      d = `M${x0},${y0} L${x0},${my} L${x1},${my} L${x1},${y1}`;
    } else if (/^curvedConnector/.test(prst)) {
      const mx = (x0 + x1) / 2;
      d = `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    } else d = `M${x0},${y0} L${x1},${y1}`;
    const color = paint.line === "none" ? "#000" : paint.line;
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(paint.lineW * 96 / 72));
    if (paint.dash) path.setAttribute("stroke-dasharray", "4 3");
    if (paint.tail) { const id = "ah" + ++markerSeq; arrowMarker(svg, id, color); path.setAttribute("marker-end", `url(#${id})`); }
    if (paint.head) { const id = "ah" + ++markerSeq; arrowMarker(svg, id, color); path.setAttribute("marker-start", `url(#${id})`); }
    svg.appendChild(path);
  }

  // outline shapes drawn with SVG (arrows, chevrons, triangles ...); null = use a CSS box
  function shapePath(prst, w, h) {
    const t = Math.min(w, h);
    switch (prst) {
      case "triangle": return `M${w / 2},0 L${w},${h} L0,${h} Z`;
      case "rtTriangle": return `M0,0 L${w},${h} L0,${h} Z`;
      case "diamond": case "flowChartDecision": return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
      case "rightArrow": { const hw = Math.min(w * 0.5, h); return `M0,${h * 0.25} L${w - hw},${h * 0.25} L${w - hw},0 L${w},${h / 2} L${w - hw},${h} L${w - hw},${h * 0.75} L0,${h * 0.75} Z`; }
      case "leftArrow": { const hw = Math.min(w * 0.5, h); return `M${w},${h * 0.25} L${hw},${h * 0.25} L${hw},0 L0,${h / 2} L${hw},${h} L${hw},${h * 0.75} L${w},${h * 0.75} Z`; }
      case "downArrow": { const hh = Math.min(h * 0.5, w); return `M${w * 0.25},0 L${w * 0.75},0 L${w * 0.75},${h - hh} L${w},${h - hh} L${w / 2},${h} L0,${h - hh} L${w * 0.25},${h - hh} Z`; }
      case "upArrow": { const hh = Math.min(h * 0.5, w); return `M${w * 0.25},${h} L${w * 0.75},${h} L${w * 0.75},${hh} L${w},${hh} L${w / 2},0 L0,${hh} L${w * 0.25},${hh} Z`; }
      case "chevron": { const k = Math.min(h / 2, w / 2); return `M0,0 L${w - k},0 L${w},${h / 2} L${w - k},${h} L0,${h} L${k},${h / 2} Z`; }
      case "homePlate": { const k = Math.min(h / 2, w / 2); return `M0,0 L${w - k},0 L${w},${h / 2} L${w - k},${h} L0,${h} Z`; }
      case "hexagon": { const k = Math.min(w / 4, h / 2); return `M${k},0 L${w - k},0 L${w},${h / 2} L${w - k},${h} L${k},${h} L0,${h / 2} Z`; }
      case "parallelogram": case "flowChartInputOutput": { const k = Math.min(w / 4, t / 2); return `M${k},0 L${w},0 L${w - k},${h} L0,${h} Z`; }
      case "pentagon": return `M${w / 2},0 L${w},${h * 0.38} L${w * 0.81},${h} L${w * 0.19},${h} L0,${h * 0.38} Z`;
      default: return null;
    }
  }

  /**
   * item: { el (wpg:wgp | wps:wsp), cx, cy }, renderBlocks(blocks) -> element for text-box content
   * (paragraphs keep their own font sizes inside drawings, since the boxes have a fixed size).
   */
  function render(item, readBox, renderBlocks, imageFor) {
    const W = item.cx / EMU, H = item.cy / EMU;
    const wrap = document.createElement("div");
    wrap.className = "drawing";
    wrap.style.width = W + "px";
    wrap.style.height = H + "px";
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "drawing-lines");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const place = (node, T) => {
      const x = xfrmOf(node);
      if (!x) return null;
      const x0 = T.ox + (x.x - T.cx) * T.sx, y0 = T.oy + (x.y - T.cy) * T.sy;
      return { x0, y0, x1: x0 + x.w * T.sx, y1: y0 + x.h * T.sy, w: x.w * T.sx, h: x.h * T.sy, xf: x, flipH: x.flipH, flipV: x.flipV };
    };

    function shape(sp, box) {
      const geom = desc(nm(sp, "spPr"), "prstGeom");
      const prst = geom ? geom.getAttribute("prst") : "rect";
      const paint = paintOf(sp);
      if (LINES.test(prst) || sp.localName === "cxnSp") { drawLine(svg, prst, box, paint); return; }
      const div = document.createElement("div");
      div.className = "shape";
      Object.assign(div.style, { left: box.x0 + "px", top: box.y0 + "px", width: box.w + "px", height: box.h + "px" });
      if (box.xf.rot) div.style.transform = `rotate(${box.xf.rot}deg)`;
      const outline = shapePath(prst, box.w, box.h);
      if (outline) {
        const s = document.createElementNS(SVGNS, "svg");
        s.setAttribute("class", "shape-bg");
        s.setAttribute("width", box.w); s.setAttribute("height", box.h);
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", outline);
        p.setAttribute("fill", paint.fill === "none" ? "none" : paint.fill);
        p.setAttribute("stroke", paint.line === "none" ? "none" : paint.line);
        p.setAttribute("stroke-width", String(paint.lineW * 96 / 72));
        s.appendChild(p);
        div.appendChild(s);
      } else {
        if (paint.fill !== "none") div.style.background = paint.fill;
        if (paint.line !== "none") div.style.border = `${paint.lineW}pt ${paint.dash ? "dashed" : "solid"} ${paint.line}`;
        if (/^(roundRect|flowChartAlternateProcess|snipRoundRect)$/.test(prst)) div.style.borderRadius = Math.min(box.w, box.h) * 0.16 + "px";
        if (/^(ellipse|flowChartConnector)$/.test(prst)) div.style.borderRadius = "50%";
        if (prst === "flowChartTerminator") div.style.borderRadius = box.h / 2 + "px";
      }
      const tb = desc(sp, "txbxContent");
      if (tb) {
        const body = nm(sp, "bodyPr") || desc(sp, "bodyPr");
        const ins = (k, d) => ((body && body.getAttribute(k) != null ? num(body, k) : d) / EMU);
        const inner = document.createElement("div");
        inner.className = "shape-text";
        inner.style.padding = `${ins("tIns", 45720)}px ${ins("rIns", 91440)}px ${ins("bIns", 45720)}px ${ins("lIns", 91440)}px`;
        const anchor = body && body.getAttribute("anchor");
        inner.style.justifyContent = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
        if (body && body.getAttribute("vert") && /vert/.test(body.getAttribute("vert")) && body.getAttribute("vert") !== "horz") inner.style.writingMode = "vertical-rl";
        inner.appendChild(renderBlocks(readBox(tb)));
        div.appendChild(inner);
      }
      wrap.appendChild(div);
    }

    function picture(pic, box) {
      const blip = desc(pic, "blip");
      const src = blip && imageFor(blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"), desc(pic, "srcRect"));
      const el = src ? document.createElement("img") : document.createElement("div");
      if (src) el.src = src; else el.className = "img-missing";
      el.classList.add("shape");
      Object.assign(el.style, { left: box.x0 + "px", top: box.y0 + "px", width: box.w + "px", height: box.h + "px" });
      wrap.appendChild(el);
    }

    function group(g, T) {
      for (const c of kids(g)) {
        const n = c.localName;
        if (n === "wsp" || n === "sp" || n === "cxnSp") { const b = place(c, T); if (b) shape(c, b); }
        else if (n === "pic") { const b = place(c, T); if (b) picture(c, b); }
        else if (n === "grpSp") {
          const b = place(c, T);
          if (!b) continue;
          const x = b.xf;
          group(c, { ox: b.x0, oy: b.y0, sx: b.w / (x.cw || 1), sy: b.h / (x.ch || 1), cx: x.cx, cy: x.cy });
        } else if (n === "graphicFrame") {
          const b = place(c, T);
          const p = c.getElementsByTagNameNS("*", "pic")[0];
          if (b && p) picture(p, b);
        }
      }
    }

    const el = item.el;
    if (el.localName === "wgp") {
      const top = xfrmOf(el) || { cx: 0, cy: 0, cw: item.cx, ch: item.cy, w: item.cx, h: item.cy };
      group(el, { ox: 0, oy: 0, sx: W / (top.cw || item.cx || 1), sy: H / (top.ch || item.cy || 1), cx: top.cx, cy: top.cy });
    } else {
      const xf = xfrmOf(el) || {};
      shape(el, { x0: 0, y0: 0, x1: W, y1: H, w: W, h: H, xf: Object.assign({ rot: 0 }, xf, { rot: xf.rot || 0 }), flipH: xf.flipH, flipV: xf.flipV });
    }
    wrap.appendChild(svg);
    return wrap;
  }

  root.Shapes = { render, setTheme };
})(typeof globalThis !== "undefined" ? globalThis : this);
