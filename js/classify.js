/* Finds the MCQ and CQ parts of an untagged document and gives each block its role.
 *
 * Detection follows the MCQ scraper: a numbered question ("১।") followed within a few paragraphs by
 * "(ক)" options is an MCQ when its options sit in pairs on one line or an "উত্তর: ক" line follows;
 * "প্রশ্ন-০১:" stems, "১নং প্রশ্নের উত্তর" headers, "জ্ঞানমূলক/অনুধাবনমূলক প্রশ্নোত্তর" and numbered
 * short questions answered by "উত্তর: <sentence>" are CQ. A run of same-kind signals forms one zone;
 * a banner picture, a heading, a chapter change or a signal of the other kind ends it.
 *
 *   segment(blocks) -> [{ type: "normal" | "mcq" | "cq" | "section", blocks, label }]
 *   mcqUnits(blocks) -> [{ u: "stim" | "q" | "other", ... }]
 *   cqRoles(blocks)  -> role per block */
(function (root) {
  "use strict";

  const OBJ = "";
  const Q_START = /^\s*([০-৯0-9]{1,3})\s*[।.)]\s*\S/;
  const CQ_START = /^\s*প্রশ্ন\s*[-–—:]?\s*[০-৯0-9]{1,3}\s*[:ঃ।.)]/;
  const CQ_ANS_HDR = /^\s*[০-৯0-9]+\s*নং\s*প্রশ্নের\s*(উত্তর|সমাধান)/;
  const CQ_SECTION = /^\s*(জ্ঞানমূলক|অনুধাবনমূলক|প্রয়োগমূলক|উচ্চতর\s*দক্ষতামূলক|সৃজনশীল)\s*প্রশ্ন/;
  const MCQ_SECTION = /^\s*(বহুনির্বাচনি|বহুনির্বাচনী|বহুপদী\s*সমাপ্তিসূচক|অভিন্ন\s*তথ্যভিত্তিক)\s*প্রশ্ন/;
  const ANS_LETTER = /^\s*উত্তর\s*[:ঃ：]?\s*\(?\s*([কখগঘঙ])\s*\)?\s*[।.]?\s*$/;
  const ANS_TEXT = /^\s*উত্তর\s*[:ঃ：]\s*\S/;
  const OPT_MARK = /\(\s*([কখগঘঙ])\s*\)/;
  const OPT_MARK_G = /\(\s*([কখগঘঙ])\s*\)+/g;
  const OPT_LEAD = /^\s*\(\s*[কখগঘঙ]\s*\)/;
  const STIM_WORD = /^\s*(নিচের\s+)?(উদ্দীপক|অনুচ্ছেদ|তথ্য|চিত্র|ছক|কবিতা|গদ্যাংশ|কবিতাংশ|ছকটি|চিত্রটি)\S*\s/;
  const isStim = (t) => STIM_WORD.test(t) && /উত্তর\s*দাও/.test(t.slice(0, 200)) && /[০-৯0-9]/.test(t.slice(0, 160)) && !Q_START.test(t);
  const ROMAN = /^\s*(i{1,3}|iv|v|vi{0,3})\s*[.)]\s*/i;
  const BOARD_TAIL = /\s*(\[[^\[\]]*\])\s*$/;
  // a CQ sub-question is an instruction ("…ব্যাখ্যা করো।", "…কী?"); MCQ options are bare phrases
  // ("নেটওয়ার্ক বিশ্লেষণ"), so words like বিশ্লেষণ alone do not count
  const CQ_TASK = /([?？]|।\s*$|করো|কর\s*।|দেখাও|লেখো|যুক্তি\s*দাও|নির্ণয়\s*কর)/;

  const clean = (b) => (b && b.kind === "p" ? b.text.replace(new RegExp(OBJ, "g"), "").trim() : "");
  const isBlank = (b) => b.kind === "p" && !b.text.replace(/\s/g, "") && !b.items.some((i) => i.t === "img" || i.t === "shape" || i.t === "math" || i.t === "missing");

  // a wide, flat picture on its own line: the section banners between parts of a chapter
  const TEXT_W_EMU = 7.34 * 914400;
  function isBanner(b) {
    if (b.kind !== "p" || clean(b)) return false;
    const pics = b.items.filter((i) => i.t === "img" || i.t === "shape");
    if (!pics.length) return false;
    const w = Math.max(...pics.map((p) => p.cx || 0)), h = Math.max(...pics.map((p) => p.cy || 0));
    return w >= TEXT_W_EMU * 0.55 && h > 0 && w / h >= 3.2;
  }
  const isHeading = (b) => b.kind === "p" && b.para.heading > 0;
  const softHeading = (b) => {
    const t = clean(b);
    return b.kind === "p" && t.length > 0 && t.length <= 60 && b.para.allBold && !/[।?:ঃ]$/.test(t) &&
      !Q_START.test(t) && !CQ_START.test(t) && !OPT_LEAD.test(t) && !/^উত্তর/.test(t);
  };

  // Options laid out in a (usually borderless) Word table:  [ ] (ক) … (খ) …  /  [গ] (গ) … (ঘ) …
  // -> { paras: cell paragraphs carrying option labels, answer: the lone letter in a cell (or null) }
  function tableOptions(b) {
    if (!b || b.kind !== "table") return null;
    if (b._opt !== undefined) return b._opt;
    let res = null, marks = 0, answer = null, prose = false;
    const paras = [];
    for (const r of b.rows) for (const c of r.cells) for (const x of c.blocks) {
      if (x.kind !== "p") continue;
      const t = clean(x);
      const m = t.match(OPT_MARK_G);
      if (m) { marks += m.length; paras.push(x); continue; }
      const a = /^\(?\s*([কখগঘঙ])\s*\)?$/.exec(t) || ANS_LETTER.exec(t);
      if (a) answer = a[1];
      else if (t.length > 30) prose = true;
    }
    if (marks >= 2 && !prose) res = { paras, answer };
    b._opt = res;
    return res;
  }

  function signals(blocks) {
    const n = blocks.length;
    const sig = new Array(n).fill(null);
    const T = blocks.map(clean);

    // first paragraph (from i on) that starts with an option label, before the next question. Options
    // inside running prose ("যথা: (ক) … (খ) …") do not count, and neither does a long paragraph in between.
    const optionsAt = (i) => {
      for (let j = i; j < Math.min(i + 12, n); j++) {
        if (j > i && tableOptions(blocks[j])) return j;
        if (blocks[j].kind !== "p") continue;
        if (j > i && (Q_START.test(T[j]) || CQ_START.test(T[j]) || isBanner(blocks[j]) || isHeading(blocks[j]))) return -1;
        // options on the question line: "…কোনটি? (ক) … (খ) … (গ) … (ঘ) …" (prose like "যথা: (ক) …, (খ) …" has fewer)
        if (j === i && /[?？:ঃ—–-]\s*\(\s*ক\s*\)/.test(T[j]) && (T[j].match(OPT_MARK_G) || []).length >= 3) return j;
        if (j > i && OPT_LEAD.test(T[j])) return j;
        if (j > i && T[j].length > 160) return -1;
      }
      return -1;
    };
    const mcqLike = (j) => {
      const tab = tableOptions(blocks[j]);
      if (tab) {
        if (tab.answer) return true;
        const lead = tab.paras.map((x) => clean(x).replace(OPT_MARK_G, "").trim());
        return lead.filter((t) => CQ_TASK.test(t)).length < Math.max(2, Math.ceil(lead.length * 0.75));
      }
      const opts = [];
      let k = j;
      for (; k < Math.min(j + 8, n); k++) {
        if (blocks[k].kind !== "p") continue;
        const t = T[k];
        if (!t && blocks[k].items.length) continue; // a picture line between options
        if (!OPT_MARK.test(t)) break;
        opts.push(t);
        if ((t.match(OPT_MARK_G) || []).length >= 2) return true; // "(ক) .. (খ) .." on one line
      }
      for (let m = k; m < Math.min(k + 3, n); m++) if (ANS_LETTER.test(T[m])) return true;
      const lead = opts.map((t) => t.replace(OPT_MARK, "").trim());
      if (!lead.length) return true;
      const tasks = lead.filter((t) => CQ_TASK.test(t)).length;
      const avg = lead.reduce((s, t) => s + t.length, 0) / lead.length;
      return !(tasks >= Math.max(2, Math.ceil(lead.length * 0.75)) && avg > 12);
    };

    for (let i = 0; i < n; i++) {
      const b = blocks[i];
      if (b.kind !== "p") continue;
      const t = T[i];
      if (!t) continue;
      if (MCQ_SECTION.test(t) && t.length < 80) sig[i] = "mcq";
      else if (CQ_SECTION.test(t) && t.length < 80) sig[i] = "cq";
      else if (CQ_ANS_HDR.test(t) && t.length < 60) sig[i] = "cq";
      else if (ANS_LETTER.test(t)) sig[i] = "mcq";
      else if (isStim(t)) sig[i] = "mcq";
      else if (CQ_START.test(t)) sig[i] = "cq";
      else if (Q_START.test(t)) {
        const j = optionsAt(i);
        if (j >= 0) sig[i] = mcqLike(j) ? "mcq" : "cq";
        else {
          // short question: "১। বিপণন কী?" answered by "উত্তর: <sentence>"
          for (let k = i + 1; k < Math.min(i + 4, n); k++) {
            if (Q_START.test(T[k])) break;
            if (ANS_TEXT.test(T[k]) && !ANS_LETTER.test(T[k])) { sig[i] = "cq"; sig[k] = "cq"; break; }
          }
        }
      }
    }
    return sig;
  }

  // leftover "mcq (start)" / "cq (end)" style tags from the Typst workflow carry no content
  const TAG_LINE = /^\s*[A-Za-z][\w -]*\(\s*(start|end)\s*\)\s*$/i;

  const TAG_HEAD = /^\s*[A-Za-z][\w -]*\(\s*(?:start|end)\s*\)[^\S\n]*\n/i;
  const TAG_TAIL = /\n\s*[A-Za-z][\w -]*\(\s*(?:start|end)\s*\)\s*$/i;
  function stripTags(b) {
    if (b.kind !== "p") return b;
    let s = 0, e = b.text.length, m;
    if ((m = TAG_HEAD.exec(b.text))) s = m[0].length;
    if ((m = TAG_TAIL.exec(b.text)) && m.index >= s) e = m.index;
    if (s === 0 && e === b.text.length) return b;
    const items = trimItems(sliceItems(b.items, s, e));
    return Object.assign({}, b, { items, text: itemsText(items) });
  }

  function segment(allBlocks) {
    const blocks = allBlocks.map(stripTags).filter((b) => b.kind !== "p" || !(isBlank(b) || TAG_LINE.test(clean(b))));
    const sig = signals(blocks);
    const n = blocks.length;
    const hard = (i) => blocks[i].kind === "section" || isBanner(blocks[i]) || isHeading(blocks[i]) || (blocks[i].kind === "p" && blocks[i].para.pageBreakBefore);
    const zone = new Array(n).fill(null);

    let i = 0;
    while (i < n) {
      if (!sig[i]) { i++; continue; }
      const type = sig[i];
      const maxGap = type === "mcq" ? 16 : 80;
      let last = i, j = i + 1;
      for (; j < n; j++) {
        if (hard(j)) break;
        if (sig[j] && sig[j] !== type) break;
        if (sig[j] === type) { last = j; continue; }
        if (j - last > maxGap) break;
        // a bold one-line title inside a CQ answer is fine; one with no CQ after it starts new content
        if (type === "cq" && softHeading(blocks[j])) {
          let next = -1;
          for (let k = j + 1; k < Math.min(j + 26, n); k++) { if (hard(k)) break; if (sig[k]) { next = k; break; } }
          if (next < 0 || sig[next] !== "cq") break;
        }
      }
      // tail after the last signal
      let end = last;
      if (type === "mcq") {
        // the last question with no "উত্তর:" line: take its lines up to its last option paragraph
        if (!ANS_LETTER.test(clean(blocks[last]))) {
          let seenOpt = false;
          for (let k = last + 1; k < Math.min(last + 12, n); k++) {
            if (hard(k) || sig[k]) break;
            const t = clean(blocks[k]);
            if (OPT_LEAD.test(t) || tableOptions(blocks[k]) || (seenOpt && !t && blocks[k].kind === "p")) { end = k; seenOpt = true; }
            else if (seenOpt || t.length > 160) break; // text after the options is not part of the question
          }
        }
      } else {
        for (let k = last + 1; k < n; k++) {
          if (hard(k) || sig[k] || softHeading(blocks[k])) break;
          end = k;
        }
      }
      for (let k = i; k <= end; k++) zone[k] = type;
      i = end + 1;
    }

    const segs = [];
    for (let k = 0; k < n; k++) {
      const b = blocks[k];
      if (b.kind === "section") { segs.push({ type: "section", label: b.label, blocks: [] }); continue; }
      const type = zone[k] || "normal";
      const last = segs[segs.length - 1];
      if (last && last.type === type) last.blocks.push(b);
      else segs.push({ type, blocks: [b] });
    }
    return segs;
  }

  // ---------- MCQ structure ----------
  // Cuts a paragraph's items at text offsets (OBJ characters stand for one item each).
  function sliceItems(items, start, end) {
    const out = [];
    let pos = 0;
    for (const it of items) {
      const len = it.t === "text" ? it.text.length : 1;
      const a = Math.max(start, pos), z = Math.min(end, pos + len);
      if (z > a) {
        if (it.t === "text") out.push(Object.assign({}, it, { text: it.text.slice(a - pos, z - pos) }));
        else out.push(it);
      }
      pos += len;
    }
    return out;
  }
  const itemsText = (items) => items.map((it) => (it.t === "text" ? it.text : it.t === "br" ? "\n" : OBJ)).join("");
  function trimItems(items) {
    const out = items.slice();
    while (out.length && out[0].t === "text" && !out[0].text.trim()) out.shift();
    while (out.length && (out[out.length - 1].t === "br" || (out[out.length - 1].t === "text" && !out[out.length - 1].text.trim()))) out.pop();
    if (out.length && out[0].t === "text") out[0] = Object.assign({}, out[0], { text: out[0].text.replace(/^\s+/, "") });
    const l = out.length - 1;
    if (l >= 0 && out[l].t === "text") out[l] = Object.assign({}, out[l], { text: out[l].text.replace(/\s+$/, "") });
    return out;
  }

  // trailing "[ঢা. বো. '২৫]" -> { body, source }
  function splitSource(items) {
    const text = itemsText(items);
    const m = BOARD_TAIL.exec(text);
    if (!m || m[1].length > 220 || !/(বো|বোর্ড|কলেজ|স্কুল|বিদ্যালয়|ক্যাডেট|[০-৯0-9]{2})/.test(m[1])) return { body: items, source: null };
    return { body: trimItems(sliceItems(items, 0, m.index)), source: sliceItems(items, m.index + m[0].indexOf("["), m.index + m[0].length).filter((it) => it.t !== "text" || it.text.trim()) };
  }

  // option paragraphs -> [{ letter, items }] or null when they do not read as options
  function parseOptions(paras) {
    const opts = [];
    for (const p of paras) {
      const text = itemsText(p.items);
      const marks = [...text.matchAll(OPT_MARK_G)];
      if (!marks.length) {
        if (!opts.length) return null;
        const last = opts[opts.length - 1];
        last.items = last.items.concat([{ t: "text", text: " " }], p.items);
        continue;
      }
      const before = trimItems(sliceItems(p.items, 0, marks[0].index));
      if (before.length) {
        // a picture printed just before its label belongs to that option
        const allPics = before.every((it) => it.t === "img" || it.t === "shape" || (it.t === "text" && !it.text.trim()));
        if (opts.length && !allPics) opts[opts.length - 1].items = opts[opts.length - 1].items.concat([{ t: "text", text: " " }], before);
        else if (!allPics) return null;
        else marks[0].pre = before;
      }
      marks.forEach((m, k) => {
        const endAt = k + 1 < marks.length ? marks[k + 1].index : text.length;
        const items = trimItems(sliceItems(p.items, m.index + m[0].length, endAt));
        opts.push({ letter: m[1], items: (m.pre || []).concat(items) });
      });
    }
    // tables laid out column-wise give ক গ খ ঘ; put them back in order
    const ORDER = "কখগঘঙ";
    opts.sort((a, b) => ORDER.indexOf(a.letter) - ORDER.indexOf(b.letter));
    const letters = opts.map((o) => o.letter).join("");
    if (!/^কখ(গ(ঘ(ঙ)?)?)?$/.test(letters)) return null;
    return opts;
  }

  function mcqUnits(blocks) {
    const units = [];
    let cur = null;
    for (const b of blocks) {
      const t = clean(b);
      if (b.kind === "p" && isStim(t)) {
        cur = { u: "stim", header: b, passage: [] };
        units.push(cur);
        continue;
      }
      if (b.kind === "p" && Q_START.test(t) && !OPT_LEAD.test(t)) {
        cur = { u: "q", title: b, extras: [], optParas: [], answer: null, after: [] };
        units.push(cur);
        // options written on the title line itself
        const m = /\(\s*ক\s*\)/.exec(b.text);
        if (m) {
          cur.title = Object.assign({}, b, { items: trimItems(sliceItems(b.items, 0, m.index)) });
          cur.optParas.push({ items: sliceItems(b.items, m.index, b.text.length) });
        }
        continue;
      }
      if (cur && cur.u === "q") {
        const am = ANS_LETTER.exec(t);
        if (am && !cur.answer) { cur.answer = am[1]; cur.answerBlock = b; cur.done = true; continue; }
        const tab = !cur.done && !cur.optParas.length ? tableOptions(b) : null;
        if (tab) {
          cur.optParas.push(...tab.paras);
          cur.optTable = b;
          if (tab.answer) { cur.answer = tab.answer; cur.done = true; }
          continue;
        }
        if (!cur.done && b.kind === "p") {
          const picOnly = !t && b.items.some((i) => i.t === "img" || i.t === "shape" || i.t === "math");
          if (OPT_MARK.test(t) || (cur.optParas.length && picOnly)) { cur.optParas.push(b); continue; }
        }
        if (cur.optParas.length || cur.done) cur.after.push(b);
        else cur.extras.push(b);
        continue;
      }
      if (cur && cur.u === "stim") { cur.passage.push(b); continue; }
      units.push({ u: "other", block: b });
    }
    for (const q of units) {
      if (q.u !== "q") continue;
      q.options = q.optParas.length ? parseOptions(q.optParas) : null;
      const s = splitSource(q.title.items);
      q.titleItems = s.body;
      q.source = s.source;
    }
    return units;
  }

  // ---------- CQ roles ----------
  function cqRoles(blocks) {
    let phase = "";
    return blocks.map((b) => {
      const t = clean(b);
      if (b.kind !== "p") return "";
      if (CQ_SECTION.test(t) && t.length < 80) { phase = ""; return "cq-section"; }
      if (CQ_ANS_HDR.test(t) && t.length < 60) { phase = "a"; return "cq-anshdr"; }
      if (CQ_START.test(t)) { phase = "q"; return "cq-stem"; }
      if (OPT_LEAD.test(t) && (phase === "q" || phase === "")) return "cq-subq";
      if (Q_START.test(t) && !OPT_LEAD.test(t)) { phase = "sq"; return "cq-sq"; }
      if (ANS_TEXT.test(t) && phase === "sq") return "cq-sa";
      return "";
    });
  }

  root.Classify = { segment, mcqUnits, cqRoles, tableOptions, isStim, OPT_MARK_G, BOARD_TAIL, Q_START, splitSource, sliceItems, trimItems, itemsText, isBanner, clean };
})(typeof globalThis !== "undefined" ? globalThis : this);
