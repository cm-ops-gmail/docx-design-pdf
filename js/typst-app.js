/* Typst: .docx -> Typst project, live compile in the browser (typst.ts), auto-repair, zip download. */
(function (root) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const WASM = "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.6.0/pkg/typst_ts_web_compiler_bg.wasm";
  const TEXT_FILES = ["main.typ", "page_setup_template.typ", "tags/mcq.typ", "tags/cq.typ"];

  let typst = null, compilerReady = null, resolveCompiler;
  compilerReady = new Promise((r) => (resolveCompiler = r));
  let project = null;   // { name, files: {path: text}, binaries: {path: Uint8Array}, fallback: [] }
  let current = "main.typ";
  let lastPdf = null, pdfUrl = null;
  let cm = null;
  const docs = {};      // path -> CodeMirror.Doc
  let compiling = false, again = false, timer = null;
  const repaired = new Set(); // main.typ line numbers replaced by plain text

  // ---------- compiler (loaded by the module script in typst.html) ----------
  function attachCompiler($typst, TypstSnippet) {
    typst = $typst;
    root.__typst = $typst; // for testing from the console
    $typst.setCompilerInitOptions({ getModule: () => WASM });
    const b64 = root.ASSETS.kalpurush.split(",")[1];
    const bin = atob(b64);
    const font = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) font[i] = bin.charCodeAt(i);
    $typst.use(TypstSnippet.preloadFontData(font));
    resolveCompiler($typst);
  }

  async function mapProject() {
    for (const [p, data] of Object.entries(project.binaries)) await typst.mapShadow("/" + p, data);
  }

  // ---------- click-to-code markers ----------
  // For the compile only (never in your files): before every block line of main.typ an invisible
  // position marker in a paragraph of its own. Tested to leave every word exactly where it was.
  // A line inside an open ( or { (a call written over several lines) gets none.
  function instrument(src) {
    const lines = src.split("\n");
    const out = [], map = []; // map[compiled line] = original line
    const stack = [];
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      const opener = /^#apply-(mcq|cq)\[$/.test(t) ? 1 : /^#columns\(\d+\)\[$/.test(t) ? 0 : null;
      const plain = !t.trim() || /^(\/\/|#import|#show|#set|#let|#\[|\])/.test(t) || opener !== null;
      if (!plain && depth === 0) {
        out.push(`#context [#metadata((l: ${i}, z: ${stack.includes(1) ? 1 : 0}, p: here().position()))<__src>]`, "");
        map.push(i, i);
      }
      out.push(t);
      map.push(i);
      if (opener !== null) stack.push(opener);
      else if (t === "]") stack.pop();
      // ( and { left open across lines (ignores escaped characters and strings)
      const bare = t.replace(/\\./g, "").replace(/"(?:[^"\\]|\\.)*"/g, "");
      for (const c of bare) { if (c === "(" || c === "{") depth++; else if (c === ")" || c === "}") depth = Math.max(0, depth - 1); }
    }
    return { text: out.join("\n"), map };
  }

  let markers = []; // [{ l, z, page, x, y }] from the last good compile
  async function compileOnce(withMarkers) {
    const ins = withMarkers ? instrument(docs["main.typ"] ? docs["main.typ"].getValue() : project.files["main.typ"]) : null;
    for (const p of TEXT_FILES) await typst.addSource("/" + p, p === "main.typ" && ins ? ins.text : docs[p] ? docs[p].getValue() : project.files[p]);
    const compiler = await typst.getCompiler();
    const res = await compiler.compile({ mainFilePath: "/main.typ", format: "pdf", diagnostics: "full" });
    const diags = (res.diagnostics || []).map((d) => {
      const m = /^(\d+):(\d+)/.exec(d.range || "");
      const path = (d.path || "").replace(/^\//, "");
      let line = m ? +m[1] : 0;
      if (ins && path === "main.typ") line = ins.map[line] != null ? ins.map[line] : line;
      return { path, line, col: m ? +m[2] : 0, severity: d.severity, message: d.message };
    });
    const ok = !diags.some((d) => d.severity === "error");
    if (ins && ok) {
      try {
        const q = await compiler.query({ mainFilePath: "/main.typ", selector: "<__src>", field: "value" });
        const list = typeof q === "string" ? JSON.parse(q) : q;
        markers = list.map((v) => ({ l: v.l, z: v.z, page: v.p.page, x: parseFloat(v.p.x), y: parseFloat(v.p.y) }));
      } catch (e) { markers = []; }
    }
    return { pdf: res.result || null, diags, ok };
  }

  // the marked compile first; if it fails, a plain one so the messages point at your own text
  async function compileBest() {
    const r = await compileOnce(true);
    return r.ok ? r : compileOnce(false);
  }

  // Replace main.typ lines the compiler rejects with their plain text (as many rounds as needed)
  async function compileWithRepair() {
    let r = await compileBest();
    // one line per round, the earliest: an unclosed bracket also makes the compiler complain about the
    // lines after it, and those are fine once the first one is fixed
    for (let round = 0; round < 40; round++) {
      const bad = r.diags.filter((d) => d.severity === "error" && d.path === "main.typ" && project.fallback[d.line] != null && !repaired.has(d.line));
      if (!bad.length) break;
      const lines = project.files["main.typ"].split("\n");
      const line = Math.min(...bad.map((d) => d.line));
      const fb = project.fallback[line];
      lines[line] = fb ? "#" + JSON.stringify(fb).replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))) : "";
      repaired.add(line);
      project.files["main.typ"] = lines.join("\n");
      if (docs["main.typ"]) docs["main.typ"].setValue(project.files["main.typ"]);
      r = await compileBest();
    }
    return r;
  }

  async function compile(withRepair) {
    if (!project) return;
    if (compiling) { again = true; return; }
    compiling = true;
    setStatus("busy", "Compiling…");
    const t0 = performance.now();
    try {
      await compilerReady;
      const r = withRepair ? await compileWithRepair() : await compileBest();
      const errors = r.diags.filter((d) => d.severity === "error");
      showProblems(r.diags);
      if (r.pdf && r.pdf.length && !errors.length) {
        lastPdf = r.pdf;
        await root.PdfView.show(r.pdf);
        $("preview-empty").hidden = true;
        $("dl-pdf").disabled = false;
      }
      $("dl-zip").disabled = false;
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (errors.length) setStatus("err", `${errors.length} error${errors.length > 1 ? "s" : ""} — showing the last good PDF`);
      else setStatus("ok", `Compiled in ${secs}s`);
      root.__typstDone = { ok: !errors.length, errors: errors.map((e) => `${e.path}:${e.line + 1}: ${e.message}`), repaired: repaired.size, pdf: lastPdf, secs: +secs };
    } catch (e) {
      console.error(e);
      setStatus("err", "The compiler failed to load: " + (e && e.message ? e.message : e));
      root.__typstDone = { error: String((e && e.stack) || e) };
    } finally {
      compiling = false;
      if (again) { again = false; compile(false); }
    }
  }

  function setStatus(kind, text) {
    const s = $("status");
    s.className = "status-pill " + (kind || "");
    s.textContent = text;
  }

  function showProblems(diags) {
    const box = $("problems");
    box.textContent = "";
    for (const doc of Object.values(docs)) for (let i = 0; i < doc.lineCount(); i++) doc.removeLineClass(i, "background", "cm-err-line");
    if (repaired.size) {
      const n = document.createElement("div");
      n.className = "problem note";
      n.innerHTML = `<span class="where">auto-repair</span><span class="msg">${repaired.size} line${repaired.size > 1 ? "s" : ""} the compiler could not read ${repaired.size > 1 ? "were" : "was"} replaced by plain text (marked in yellow in main.typ).</span>`;
      box.appendChild(n);
      if (docs["main.typ"]) for (const l of repaired) docs["main.typ"].addLineClass(l, "background", "cm-fixed-line");
    }
    for (const d of diags) {
      const el = document.createElement("div");
      el.className = "problem " + (d.severity === "error" ? "error" : "note");
      const where = document.createElement("span");
      where.className = "where";
      where.textContent = `${d.path}:${d.line + 1}`;
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = d.message;
      el.append(where, msg);
      if (TEXT_FILES.includes(d.path)) {
        el.addEventListener("click", () => { open(d.path); cm.setCursor({ line: d.line, ch: d.col }); cm.focus(); });
        if (d.severity === "error" && docs[d.path]) docs[d.path].addLineClass(d.line, "background", "cm-err-line");
      }
      box.appendChild(el);
    }
    document.querySelectorAll(".files .badge").forEach((b) => b.remove());
    const count = {};
    for (const d of diags) if (d.severity === "error") count[d.path] = (count[d.path] || 0) + 1;
    for (const [p, n] of Object.entries(count)) {
      const btn = document.querySelector(`.files button.file[data-path="${CSS.escape(p)}"]`);
      if (btn) { const b = document.createElement("span"); b.className = "badge"; b.textContent = n; btn.appendChild(b); }
    }
  }

  // ---------- preview <-> code ----------
  // A click on the page: the block whose marker is the nearest one above the click, in the same column
  // (MCQ/CQ parts are two columns; a block may have started in the left column or on the page before).
  function lineAt(c) {
    const half = c.w / 2;
    const colOf = (x) => (x > half ? 1 : 0);
    const col = colOf(c.x);
    const above = (list) => list.reduce((best, m) => (!best || m.y > best.y ? m : best), null);
    const onPage = markers.filter((m) => m.page === c.page && m.y <= c.y + 3);
    let m = above(onPage.filter((k) => k.z === 0 || colOf(k.x) === col));
    if (m && m.z === 0 && col === 1) {
      // a full-width block above a two-column part: the part's left column may hold the start
      const left = above(onPage.filter((k) => k.z === 1 && colOf(k.x) === 0 && k.y > m.y));
      if (left) m = left;
    }
    if (!m && col === 1) m = above(onPage.filter((k) => k.z === 1 && colOf(k.x) === 0));
    if (!m) { const before = markers.filter((k) => k.page < c.page); m = before.length ? before.reduce((a, b) => (b.page > a.page || (b.page === a.page && b.y >= a.y) ? b : a)) : null; }
    return m ? m.l : null;
  }

  let suppressSync = false, lastSynced = null;
  function jumpToLine(l) {
    open("main.typ");
    suppressSync = true;
    cm.setCursor({ line: l, ch: 0 });
    cm.scrollIntoView({ line: l, ch: 0 }, 160);
    cm.focus();
    const doc = docs["main.typ"];
    doc.addLineClass(l, "background", "cm-jump-line");
    setTimeout(() => doc.removeLineClass(l, "background", "cm-jump-line"), 1500);
    lastSynced = l;
    setTimeout(() => (suppressSync = false), 400);
  }

  // the editor's cursor -> the matching place in the preview
  let syncTimer = null;
  function syncPreview() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (suppressSync || current !== "main.typ" || !markers.length) return;
      const line = cm.getCursor().line;
      let m = null;
      for (const k of markers) if (k.l <= line && (!m || k.l > m.l)) m = k;
      if (!m || m.l === lastSynced) return;
      lastSynced = m.l;
      root.PdfView.scrollTo(m.page, m.y, m.z ? m.x : null);
    }, 250);
  }

  // ---------- editor ----------
  function defineMode() {
    CodeMirror.defineMode("typst", () => ({
      startState: () => ({ math: false }),
      token(stream, st) {
        if (st.math) { if (stream.skipTo("$")) { stream.next(); st.math = false; } else stream.skipToEnd(); return "string-2"; }
        if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
        if (stream.match(/^\\./)) return null;
        if (stream.match(/^#[A-Za-z][\w.-]*/)) return "keyword";
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
        if (stream.peek() === "$") { stream.next(); st.math = true; return "string-2"; }
        if (stream.match(/^[\[\]]/)) return "bracket";
        stream.next();
        return null;
      },
    }));
  }

  function open(path) {
    current = path;
    cm.swapDoc(docs[path]);
    $("editing").textContent = path;
    document.querySelectorAll(".files button.file").forEach((b) => b.classList.toggle("on", b.dataset.path === path));
  }

  // project list: Code, then one folder per top-level folder (media/, media_color/ …), each opened and
  // closed like in VS Code. A folder's thumbnails are made only when it is first opened.
  let thumbs = [];
  function buildFiles() {
    const box = $("files");
    box.textContent = "";
    thumbs.forEach((u) => URL.revokeObjectURL(u));
    thumbs = [];
    const code = WorkspaceUI.folder(box, "Code", TEXT_FILES.length, true);
    for (const p of TEXT_FILES) {
      const b = document.createElement("button");
      b.className = "file";
      b.type = "button";
      b.dataset.path = p;
      b.textContent = p;
      b.addEventListener("click", () => open(p));
      code.appendChild(b);
    }
    const folders = {};
    for (const p of Object.keys(project.binaries)) { const f = p.split("/")[0]; (folders[f] = folders[f] || []).push(p); }
    for (const [f, list] of Object.entries(folders)) {
      WorkspaceUI.folder(box, f + "/", list.length, false, (body) => {
        for (const p of list) {
          const d = document.createElement("div");
          d.className = "asset";
          if (/\.(png|jpe?g|gif|svg)$/i.test(p)) {
            const im = document.createElement("img");
            im.loading = "lazy";
            im.src = URL.createObjectURL(new Blob([project.binaries[p]], { type: /svg$/.test(p) ? "image/svg+xml" : "image/" + p.split(".").pop().replace("jpg", "jpeg") }));
            thumbs.push(im.src);
            d.appendChild(im);
          }
          const s = document.createElement("span");
          s.textContent = p.split("/").pop();
          s.title = p;
          d.appendChild(s);
          body.appendChild(d);
        }
      });
    }
  }

  // ---------- picture names (class / subject / chapter, like the Python converter) ----------
  // blank fields are guessed from the file name when it is loaded
  const metaFields = () => ({ className: $("meta-class").value.trim(), subjectName: $("meta-subject").value.trim(), chapterNumber: $("meta-chapter").value.trim() });
  function showPrefix(meta) {
    const m = Object.assign({}, meta, Object.fromEntries(Object.entries(metaFields()).filter(([, v]) => v)));
    $("meta-sample").textContent = TypstGen.mediaPrefix(m) + "_img001.png";
    for (const [id, k] of [["meta-class", "className"], ["meta-subject", "subjectName"], ["meta-chapter", "chapterNumber"]]) if (m[k]) $(id).placeholder = String(m[k]);
  }
  // the fields and the greyscale switch are remembered in this browser
  const PREF = "word-typst-prefs";
  try {
    const pr = JSON.parse(localStorage.getItem(PREF) || "{}");
    for (const id of ["meta-class", "meta-subject", "meta-chapter"]) if (pr[id]) $(id).value = pr[id];
    if (typeof pr.grey === "boolean") $("grey").checked = pr.grey;
  } catch (e) { /* storage blocked: defaults */ }
  const savePrefs = () => {
    try { localStorage.setItem(PREF, JSON.stringify({ "meta-class": $("meta-class").value, "meta-subject": $("meta-subject").value, "meta-chapter": $("meta-chapter").value, grey: $("grey").checked })); } catch (e) { /* ignore */ }
  };
  ["meta-class", "meta-subject", "meta-chapter"].forEach((id) => $(id).addEventListener("input", () => { showPrefix({}); savePrefs(); }));
  $("grey").addEventListener("change", savePrefs);
  showPrefix({});

  // ---------- load a .docx ----------
  // Word file -> project (code, media, fallback lines); no compiling here
  async function makeProject(file, say) {
    say("Reading " + file.name + "…");
    const data = await file.arrayBuffer();
    const model = await DocxReader.read(data);
    say("Finding MCQ and CQ parts…");
    const segs = Classify.segment(model.blocks);
    say("Writing the Typst code and the media folder…");
    const gen = await TypstGen.generate(model, segs, { greyscale: $("grey").checked, name: file.name, meta: metaFields() });
    return Object.assign({ data, fileName: file.name, name: file.name.replace(/\.(docx|docm)$/i, "") }, gen);
  }

  async function load(file) {
    $("loading").hidden = false;
    const say = (t) => ($("loading-text").textContent = t);
    try {
      const p = await makeProject(file, say);
      showPrefix(p.meta);
      say("Loading the Typst compiler (first time only, about 20 MB)…");
      await openProject(p, []);
    } catch (e) {
      console.error(e);
      say("Could not convert this file: " + (e && e.message ? e.message : e));
      root.__typstDone = { error: String((e && e.stack) || e) };
      return;
    }
    $("loading").hidden = true;
  }

  // show a project in the workspace and compile it (repairs: main.typ lines already replaced by plain text)
  async function openProject(p, repairs) {
    project = p;
    repaired.clear();
    for (const l of repairs || []) repaired.add(l);
    await compilerReady;
    await typst.resetShadow();
    await mapProject();

    $("start").hidden = true;
    $("workspace").hidden = false;
    if (!cm) {
      defineMode();
      cm = CodeMirror($("editor"), { lineNumbers: true, lineWrapping: true, mode: "typst", tabSize: 2, indentUnit: 2 });
      cm.on("change", () => {
        if (current === "main.typ") project.files["main.typ"] = cm.getValue();
        clearTimeout(timer);
        timer = setTimeout(() => compile(false), 900);
        autosave();
      });
      // Ctrl/Cmd+F find, Shift+Ctrl/Cmd+F (Cmd+Alt+F on a Mac) replace, Alt+G go to line: CodeMirror's search addon
      cm.setOption("extraKeys", { "Cmd-S": () => compile(false), "Ctrl-S": () => compile(false), "Alt-G": "jumpToLine" });
      cm.on("cursorActivity", syncPreview);
      WorkspaceUI.init($("workspace"), () => cm.refresh());
      $("fold-open").addEventListener("click", () => WorkspaceUI.setAll($("files"), true));
      $("fold-close").addEventListener("click", () => WorkspaceUI.setAll($("files"), false));
      root.PdfView.init($("viewer"), (c) => {
        const l = lineAt(c);
        if (l != null) jumpToLine(l);
      }, (n, total) => { $("page-no").value = n; $("page-no").max = total; $("page-count").textContent = total; });
    }
    for (const k of TEXT_FILES) docs[k] = CodeMirror.Doc(project.files[k], "typst");
    buildFiles();
    open("main.typ");
    $("project-name").textContent = project.name;
    if (project.meta) showPrefix(project.meta);
    if (project.warnings && project.warnings.length) setStatus("", project.warnings[0]);
    await compile(!(repairs && repairs.length));
    autosave(true);
  }

  // ---------- autosave: the open project (code, pictures, the Word file) is kept in this browser ----------
  // Reopening the page offers to continue where you left off. Nothing leaves the browser.
  const DB = { name: "word-typst", store: "projects", key: "last" };
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB.name, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(DB.store);
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => {
        const tx = rq.result.transaction(DB.store, mode);
        const r = fn(tx.objectStore(DB.store));
        tx.oncomplete = () => { rq.result.close(); res(r && r.result); };
        tx.onerror = () => { rq.result.close(); rej(tx.error); };
      };
    });
  }
  let saveTimer = null;
  function autosave(now) {
    if (!project) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const files = {};
      for (const k of TEXT_FILES) files[k] = docs[k] ? docs[k].getValue() : project.files[k];
      const keep = { name: project.name, fileName: project.fileName, data: project.data, files, binaries: project.binaries, fallback: project.fallback,
        warnings: project.warnings, meta: project.meta, prefix: project.prefix, repaired: [...repaired], savedAt: Date.now() };
      try { await idb("readwrite", (st) => st.put(keep, DB.key)); } catch (e) { console.warn("autosave failed", e); }
    }, now ? 0 : 1500);
  }
  async function showResume() {
    let last = null;
    try { last = await idb("readonly", (st) => st.get(DB.key)); } catch (e) { return; }
    if (!last || !last.files) return;
    $("resume").hidden = false;
    $("resume-name").textContent = last.name;
    $("resume-when").textContent = new Date(last.savedAt).toLocaleString();
    $("resume-go").onclick = async () => {
      $("resume").hidden = true;
      $("loading").hidden = false;
      $("loading-text").textContent = "Opening " + last.name + "…";
      try { await openProject(Object.assign({}, last), last.repaired); $("loading").hidden = true; }
      catch (e) { console.error(e); $("loading-text").textContent = "Could not open the saved project: " + (e && e.message ? e.message : e); }
    };
    $("resume-forget").onclick = async () => { $("resume").hidden = true; try { await idb("readwrite", (st) => st.delete(DB.key)); } catch (e) { /* ignore */ } };
  }

  // ---------- batch: several Word files -> one zip with a Typst project and a PDF for each ----------
  // compile a project on its own, replacing lines the compiler rejects by their plain text (as the editor does)
  async function buildPdf(p, say) {
    await compilerReady;
    await typst.resetShadow();
    for (const [k, data] of Object.entries(p.binaries)) await typst.mapShadow("/" + k, data);
    const files = Object.assign({}, p.files);
    const lines = files["main.typ"].split("\n");
    const fixed = new Set();
    const compiler = await typst.getCompiler();
    for (let round = 0; round < 60; round++) {
      files["main.typ"] = lines.join("\n");
      for (const k of TEXT_FILES) await typst.addSource("/" + k, files[k]);
      const res = await compiler.compile({ mainFilePath: "/main.typ", format: "pdf", diagnostics: "full" });
      const errs = (res.diagnostics || []).filter((d) => d.severity === "error");
      if (!errs.length) return { pdf: res.result, files, repaired: fixed.size };
      const bad = errs.map((d) => ((d.path || "").replace(/^\//, "") === "main.typ" && /^(\d+):/.test(d.range || "") ? +/^(\d+):/.exec(d.range)[1] : -1))
        .filter((l) => l >= 0 && p.fallback[l] != null && !fixed.has(l));
      if (!bad.length) return { pdf: null, files, repaired: fixed.size, error: errs[0].message };
      const l = Math.min(...bad);
      const fb = p.fallback[l];
      lines[l] = fb ? "#" + JSON.stringify(fb) : "";
      fixed.add(l);
      say(`${p.name}: repairing line ${l + 1}…`);
    }
    return { pdf: null, files, repaired: fixed.size, error: "too many lines the compiler could not read" };
  }

  async function batch(list) {
    const box = $("batch");
    $("loading").hidden = false;
    box.hidden = false;
    box.textContent = "";
    const say = (t) => ($("loading-text").textContent = t);
    const zip = new JSZip();
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const row = document.createElement("li");
      row.textContent = f.name + " — waiting";
      box.appendChild(row);
      rows.push(row);
    }
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i], row = rows[i];
      row.className = "busy";
      row.textContent = f.name + " — converting…";
      try {
        say(`(${i + 1}/${list.length}) ${f.name}`);
        const p = await makeProject(f, (t) => say(`(${i + 1}/${list.length}) ${t}`));
        say(`(${i + 1}/${list.length}) Compiling ${p.name}…`);
        const r = await buildPdf(p, (t) => say(`(${i + 1}/${list.length}) ${t}`));
        const dir = zip.folder(p.name + "_typst");
        for (const [k, v] of Object.entries(r.files)) dir.file(k, v);
        for (const [k, v] of Object.entries(p.binaries)) dir.file(k, v);
        if (r.pdf) { dir.file(p.name + ".pdf", r.pdf); zip.file(p.name + ".pdf", r.pdf); ok++; }
        row.className = r.pdf ? "ok" : "err";
        row.textContent = `${f.name} — ${r.pdf ? "done" : "project only, the PDF failed: " + r.error}${r.repaired ? ` (${r.repaired} line${r.repaired > 1 ? "s" : ""} repaired)` : ""} · pictures ${p.prefix}_img…`;
      } catch (e) {
        console.error(e);
        row.className = "err";
        row.textContent = `${f.name} — could not convert: ${e && e.message ? e.message : e}`;
      }
    }
    say("Packing the zip…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    save(blob, `typst_${list.length}_chapters.zip`);
    say(`Done: ${ok} of ${list.length} PDFs. The zip has a PDF for each chapter at the top and a project folder for each.`);
    $("loading").querySelector(".spinner").hidden = true;
    root.__batchDone = { ok, total: list.length };
    // the open project (if any) needs its own files back in the compiler
    if (project) { await typst.resetShadow(); await mapProject(); }
  }

  function take(files) {
    const list = [...(files || [])].filter((x) => /\.(docx|docm)$/i.test(x.name));
    if (!list.length) return;
    $("workspace").hidden = true;
    $("start").hidden = false;
    $("batch").hidden = true;
    $("loading").querySelector(".spinner").hidden = false;
    if (list.length === 1) load(list[0]); else batch(list);
  }

  // ---------- downloads ----------
  async function downloadZip() {
    const zip = new JSZip();
    const dir = zip.folder(project.name + "_typst");
    for (const p of TEXT_FILES) dir.file(p, docs[p].getValue());
    for (const [p, data] of Object.entries(project.binaries)) dir.file(p, data);
    if (lastPdf) dir.file(project.name + ".pdf", lastPdf);
    // questions/: MCQ / CQ sheets, cropped question pictures, media and media_color (scraper + Typst converter layout)
    setStatus("busy", "Extracting the questions…");
    try {
      const model = await DocxReader.read(project.data);
      const segs = Classify.segment(model.blocks);
      const q = await QuestionExport.build(project.data, model, segs, { name: project.fileName, prefix: project.prefix, onProgress: (t) => setStatus("busy", t) });
      QuestionExport.addTo(dir.folder("questions"), q.files);
      root.__questions = q.summary;
      setStatus("ok", `Zip ready: ${q.summary.mcq} MCQs, ${q.summary.sq} short and ${q.summary.cq} creative questions in questions/`);
    } catch (e) {
      console.error(e);
      setStatus("err", "Questions could not be extracted (the rest of the project is in the zip): " + (e && e.message ? e.message : e));
    }
    dir.file("README.txt", "Compile with Typst 0.13:  typst compile main.typ\nOr open the folder in https://typst.app (upload all files, keep the folders).\nThe fonts/ folder holds Kalpurush; pass --font-path fonts if it is not installed.\n");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    save(blob, project.name + "_typst.zip");
  }
  function save(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- wiring ----------
  $("file").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; take(f); });
  $("drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
  document.addEventListener("drop", (e) => take(e.dataTransfer.files));
  $("compile").addEventListener("click", () => compile(false));
  $("zoom-in").addEventListener("click", () => root.PdfView.zoom(1));
  $("zoom-out").addEventListener("click", () => root.PdfView.zoom(-1));
  $("zoom-fit").addEventListener("click", () => root.PdfView.zoom(0));
  $("dl-zip").addEventListener("click", downloadZip);
  $("dl-pdf").addEventListener("click", () => lastPdf && save(new Blob([lastPdf], { type: "application/pdf" }), project.name + ".pdf"));
  $("new").addEventListener("click", () => { autosave(true); $("workspace").hidden = true; $("start").hidden = false; $("loading").hidden = true; $("file").click(); });
  $("page-no").addEventListener("change", () => root.PdfView.goTo(parseInt($("page-no").value, 10) || 1));
  showResume();

  root.TypstApp = { attachCompiler, load, batch, compile, project: () => project, editorDoc: (p) => docs[p], markers: () => markers, lineAt, cursorLine: () => cm && cm.getCursor().line };
})(typeof globalThis !== "undefined" ? globalThis : this);
