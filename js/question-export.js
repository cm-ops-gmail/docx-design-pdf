/* Questions out of a .docx, the way the MCQ/SQ scraper extracts them, laid out the way the Typst
 * converter (unified_convert.py) wrote its output folder:
 *
 *   mcq_questions.csv      unified_convert columns: title, image, …, explanation, options_N_answer / _is_correct / _image
 *   mcq_questions.xlsx     the MCQ scraper's sheet: status, SI, type, chapter, Board, title, image, explanation, options …
 *   short_questions.xlsx   the SQ scraper's sheet: জ্ঞানমূলক / অনুধাবনমূলক short questions with answers
 *   cq_questions.csv       creative questions: title (the stem), type, question, answer, image — all four parts
 *   cq_ka_kha.csv          only the জ্ঞানমূলক / অনুধাবনমূলক rows (creative (ক)/(খ) parts and the short questions)
 *   images.csv             every picture: number, file, text around it, base64 (unified_convert columns)
 *   question_images/       each question's picture and each option's picture, cropped like the scraper does
 *   media/  media_color/   every picture of the document in greyscale and in colour
 *
 * MCQ and short-question extraction runs the scraper's own code (js/scrapper/), unchanged. */
(function (root) {
  "use strict";

  const OBJ = "";
  const LETTERS = ["ক", "খ", "গ", "ঘ"];
  const LATIN = { "ক": "a", "খ": "b", "গ": "c", "ঘ": "d", "ঙ": "e" };
  const CQ_TYPE = { "ক": "জ্ঞানমূলক", "খ": "অনুধাবনমূলক", "গ": "প্রয়োগমূলক", "ঘ": "উচ্চতর দক্ষতামূলক" };
  const MCQ_FIELDS = [
    "title", "image", "thumbnail", "video", "audio",
    "explanation", "explanation_image", "explanation_video", "explanation_audio",
    "options_1_answer", "options_1_is_correct", "options_1_image", "options_1_audio", "options_1_video",
    "options_2_answer", "options_2_is_correct", "options_2_image", "options_2_video", "options_2_audio",
    "options_3_answer", "options_3_is_correct", "options_3_image", "options_3_video", "options_3_audio",
    "options_4_answer", "options_4_is_correct", "options_4_image",
  ];
  const CQ_FIELDS = ["title", "type", "question", "answer", "image"];
  const IMG_FIELDS = ["image_number", "filename", "alt_text", "title", "surrounding_text", "next_paragraph", "image_base64"];

  // ---------- helpers ----------
  // CSV the way Python's csv module with utf-8-sig writes it (Excel opens Bangla correctly)
  function csv(rows, fields) {
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return "﻿" + [fields.join(","), ...rows.map((r) => fields.map((f) => cell(r[f])).join(","))].join("\r\n") + "\r\n";
  }
  const pad = (n) => String(n).padStart(3, "0");
  function dataUrlBytes(url) {
    const bin = atob(url.split(",")[1]);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); };
  // paragraph text with equations as $LaTeX$ (the scraper's convention)
  const textOf = (items) => items.map((it) => (it.t === "text" ? it.text : it.t === "math" ? ` $${it.tex}$ ` : it.t === "br" || it.t === "tab" ? " " : "")).join("").replace(/\s+/g, " ").trim();

  async function recolor(bytes, mime, grey) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d");
    if (grey) g.filter = "grayscale(1)";
    g.drawImage(bmp, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ---------- creative questions (প্রশ্ন-০১ … (ক)–(ঘ) … ১নং প্রশ্নের উত্তর (ক) …) ----------
  function creativeQuestions(segs) {
    const C = root.Classify;
    const out = [];
    for (const seg of segs) {
      if (seg.type !== "cq") continue;
      const roles = C.cqRoles(seg.blocks);
      let q = null, phase = "", cur = "";
      const flush = () => { if (q && Object.keys(q.parts).length) out.push(q); q = null; cur = ""; };
      seg.blocks.forEach((b, i) => {
        if (b.kind !== "p") return;
        const role = roles[i];
        const t = textOf(b.items);
        if (role === "cq-section") { flush(); return; }
        if (role === "cq-stem") { flush(); q = { title: t, parts: {}, pictures: b.items.filter((x) => x.t === "img" || x.t === "shape") }; phase = "q"; return; }
        if (!q) return;
        if (role === "cq-anshdr") { phase = "a"; cur = ""; return; }
        const m = /^\(?\s*([কখগঘ])\s*[)।.]\s*/.exec(t);
        if (m && (phase === "q" || /^\(?\s*[কখগঘ]\s*\)/.test(t) || /^[কখগঘ]\s*[.।]/.test(t))) {
          cur = m[1];
          const rest = t.slice(m[0].length);
          if (phase === "q") q.parts[cur] = { question: rest, answer: "" };
          else (q.parts[cur] = q.parts[cur] || { question: "", answer: "" }).answer = rest;
          return;
        }
        if (phase === "q") {
          if (cur) q.parts[cur].question += " " + t;
          else { q.title = (q.title + " " + t).trim(); q.pictures.push(...b.items.filter((x) => x.t === "img" || x.t === "shape")); }
        } else if (cur && q.parts[cur]) q.parts[cur].answer = (q.parts[cur].answer + "\n" + t).trim();
      });
      flush();
    }
    return out;
  }

  // ---------- main ----------
  /** data: the .docx bytes; model/segs: DocxReader.read + Classify.segment of the same file */
  async function build(data, model, segs, opts) {
    opts = opts || {};
    const say = opts.onProgress || (() => {});
    const files = {};
    const summary = {};

    // MCQs: the scraper's extraction, with sharp cropped pictures
    say("Extracting MCQs…");
    const mcq = await root.MCQCore.extract(data.slice(0), { encode: root.MCQImages.encodeFull });
    const mcqRows = [];
    let withPics = 0;
    for (let i = 0; i < mcq.mcqs.length; i++) {
      const q = mcq.mcqs[i];
      const n = pad(i + 1);
      const row = { title: [q.title, q.board].filter(Boolean).join(" "), explanation: q.explanation };
      if (q.image) { files[`question_images/mcq_${n}.png`] = dataUrlBytes(q.image); row.image = `question_images/mcq_${n}.png`; withPics++; }
      LETTERS.forEach((L, k) => {
        row[`options_${k + 1}_answer`] = q.options[L] == null ? "" : q.options[L];
        row[`options_${k + 1}_is_correct`] = q.answer ? (q.answer === L ? "1" : "0") : "";
        const pic = (q.optionImageUrls || {})[L];
        if (pic) { const p = `question_images/mcq_${n}_${LATIN[L]}.png`; files[p] = dataUrlBytes(pic); row[`options_${k + 1}_image`] = p; }
      });
      mcqRows.push(row);
    }
    files["mcq_questions.csv"] = csv(mcqRows, MCQ_FIELDS);
    summary.mcq = mcqRows.length;
    summary.mcqWithPictures = withPics;
    summary.mcqNoAnswer = mcq.mcqs.filter((q) => !q.answer).length;

    // the scraper's own spreadsheet (pictures shrunk to fit a cell, as the scraper does)
    if (root.ExcelJS && mcq.mcqs.length) {
      say("Building the MCQ spreadsheet…");
      for (const q of mcq.mcqs) {
        q.image = await root.MCQImages.shrink(q.image);
        for (const L of Object.keys(q.optionImageUrls || {})) q.optionImageUrls[L] = await root.MCQImages.shrink(q.optionImageUrls[L]);
      }
      const wb = await root.MCQCore.buildWorkbook(root.ExcelJS, root.MCQParser.toRows(mcq.mcqs));
      files["mcq_questions.xlsx"] = new Uint8Array(await wb.xlsx.writeBuffer());
    }

    // short questions: the SQ scraper
    say("Extracting short questions…");
    const sq = await root.MCQCore.extract(data.slice(0), { kind: "sq" });
    summary.sq = sq.mcqs.length;
    if (root.ExcelJS && sq.rows.length) {
      const wb = await root.MCQCore.buildWorkbook(root.ExcelJS, sq.rows, { sheet: "SQ", headers: root.SQParser.HEADERS, widths: [8, 6, 16, 30, 24, 50, 90], imageCols: [] });
      files["short_questions.xlsx"] = new Uint8Array(await wb.xlsx.writeBuffer());
    }

    // creative questions
    say("Reading creative questions…");
    const cqs = creativeQuestions(segs);
    const cqRows = [];
    for (let i = 0; i < cqs.length; i++) {
      const q = cqs[i];
      let image = "";
      if (q.pictures.length) {
        const rels = {};
        const entries = q.pictures.map((it) => {
          if (it.t === "img") return { crop: it.crop, getBytes: async () => (await model.getMedia(it.target)).bytes };
          for (const [k, v] of Object.entries(it.ctx.rels)) rels[k] = v.target;
          return { group: it.el, rels, getBytes: async (target) => (await model.getMedia(target)).bytes };
        });
        const url = await root.MCQImages.encodeFull(entries);
        if (url) { image = `question_images/cq_${pad(i + 1)}.png`; files[image] = dataUrlBytes(url); }
      }
      for (const L of LETTERS) if (q.parts[L]) cqRows.push({ title: q.title, type: CQ_TYPE[L], question: q.parts[L].question.trim(), answer: q.parts[L].answer.trim(), image });
    }
    files["cq_questions.csv"] = csv(cqRows, CQ_FIELDS);
    const kaKha = cqRows.filter((r) => r.type === CQ_TYPE["ক"] || r.type === CQ_TYPE["খ"])
      .concat(sq.mcqs.map((s) => ({ title: "", type: s.type, question: [s.title, s.board].filter(Boolean).join(" "), answer: s.answer, image: "" })));
    files["cq_ka_kha.csv"] = csv(kaKha, CQ_FIELDS);
    summary.cq = cqs.length;
    summary.cqRows = cqRows.length;

    // every picture of the document: media/ (greyscale), media_color/, images.csv
    say("Collecting the pictures…");
    const flat = [];
    const walk = (blocks) => { for (const b of blocks) { if (b.kind === "p") flat.push(b); else if (b.kind === "table") for (const r of b.rows) for (const c of r.cells) walk(c.blocks); else if (b.kind === "textbox") walk(b.blocks); } };
    walk(model.blocks);
    const seen = new Map();
    const imgRows = [];
    for (let k = 0; k < flat.length; k++) {
      for (const it of flat[k].items) {
        if (it.t !== "img") continue;
        const key = it.target;
        let name = seen.get(key);
        if (name === undefined) {
          name = "";
          const m = await model.getMedia(it.target);
          if (m && m.mime && m.mime !== "image/svg+xml") {
            // with a prefix, the Python converter's names: <class>_<subject>_ch<NN>_img<NNN>
            const base = opts.prefix ? `${opts.prefix}_img${String(seen.size + 1).padStart(3, "0")}` : `image${seen.size + 1}`;
            const ext = m.mime === "image/jpeg" ? "jpg" : "png";
            files[`media_color/${base}.${ext}`] = ext === "jpg" || m.mime === "image/png" ? m.bytes : await recolor(m.bytes, m.mime, false);
            const grey = await recolor(m.bytes, m.mime, true);
            name = `media/${base}.png`;
            files[name] = grey;
          }
          seen.set(key, name);
        }
        imgRows.push({
          image_number: imgRows.length + 1, filename: name, alt_text: "", title: "",
          surrounding_text: textOf(flat[k].items), next_paragraph: flat[k + 1] ? textOf(flat[k + 1].items) : "",
          image_base64: name ? "data:image/png;base64," + b64(files[name]) : "",
        });
      }
    }
    files["images.csv"] = csv(imgRows, IMG_FIELDS);
    summary.images = imgRows.length;

    files["README.txt"] = [
      `Questions from ${opts.name || "the Word file"}`,
      "",
      `mcq_questions.csv     ${summary.mcq} MCQs (${summary.mcqWithPictures} with pictures${summary.mcqNoAnswer ? `, ${summary.mcqNoAnswer} without an answer` : ""}) — Typst converter columns`,
      "mcq_questions.xlsx    the same MCQs in the MCQ scraper's sheet",
      `short_questions.xlsx  ${summary.sq} short questions (SQ scraper)`,
      `cq_questions.csv      ${summary.cq} creative questions, ${summary.cqRows} parts`,
      "cq_ka_kha.csv         only the জ্ঞানমূলক / অনুধাবনমূলক rows",
      `images.csv            ${summary.images} pictures with the text around them`,
      "question_images/      cropped question and option pictures (mcq_001.png, mcq_001_a.png …, cq_001.png)",
      "media/, media_color/  every picture in greyscale and in colour",
      "",
    ].join("\r\n");
    return { files, summary };
  }

  // put the files into a JSZip folder
  function addTo(folder, files) {
    for (const [p, v] of Object.entries(files)) folder.file(p, v);
  }

  root.QuestionExport = { build, addTo, creativeQuestions };
})(typeof globalThis !== "undefined" ? globalThis : this);
