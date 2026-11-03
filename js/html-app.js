/* HTML Studio: .docx -> HTML + CSS project, live paged preview, print to PDF, zip download. */
(function (root) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TEXT_FILES = ["index.html", "style.css", "engine.js"];
  const MODES = { "index.html": "htmlmixed", "style.css": "css", "engine.js": "javascript" };
  let project = null, cm = null, current = "index.html", timer = null;
  const docs = {};
  const urls = {}; // binaries as blob addresses for the preview

  function setStatus(kind, text) {
    const s = $("status");
    s.className = "status-pill " + (kind || "");
    s.textContent = text;
  }

  // the preview is the exported page with its files swapped in (styles and engine inline, pictures as blobs)
  function preview() {
    if (!project) return;
    setStatus("busy", "Laying out pages…");
    let html = docs["index.html"].getValue();
    const inline = (tag, text) => (tag === "style" ? `<style>\n${text}\n</style>` : `<script>\n${text.replace(/<\/script/gi, "<\\/script")}\n</script>`);
    html = html.replace(/<link rel="stylesheet" href="fonts\.css">/, () => inline("style", project.extraText["fonts.css"]));
    html = html.replace(/<link rel="stylesheet" href="style\.css">/, () => inline("style", docs["style.css"].getValue()));
    html = html.replace(/<script src="engine\.js"><\/script>/, () => inline("script", docs["engine.js"].getValue()));
    html = html.replace(/(src|href)="((?:images|templates)\/[^"]+)"/g, (m, a, p) => (urls[p] ? `${a}="${urls[p]}"` : m));
    html = html.replace(/"templates\/(header_logo|10ms-logo)\.png"/g, (m) => { const p = m.slice(1, -1); return urls[p] ? `"${urls[p]}"` : m; });
    // engine.js points the header/footer logos at templates/; in the preview they are blobs
    html = html.replace("</head>", `<script>window.__logoMap = ${JSON.stringify({ "templates/header_logo.png": urls["templates/header_logo.png"], "templates/10ms-logo.png": urls["templates/10ms-logo.png"] })};</script></head>`);
    html = html.replace(/window\.ASSETS = \{[^}]*\};/, `window.ASSETS = { headerLogo: window.__logoMap["templates/header_logo.png"], footerLogo: window.__logoMap["templates/10ms-logo.png"] };`);
    const frame = $("preview");
    // fit the 8.5in pages to the pane (screen only; printing uses the real size)
    const zoom = Math.min(1, Math.max(0.3, (frame.clientWidth - 48) / 816)).toFixed(3);
    html = html.replace("</head>", `<style>@media screen { #pages { zoom: ${zoom}; } .toolbar { display: none; } }</style></head>`);
    frame.onload = () => {
      const t0 = performance.now();
      const wait = () => {
        let n;
        try { n = frame.contentDocument.documentElement.dataset.ready; } catch (e) { n = null; }
        if (n) {
          setStatus("ok", `${n} pages`);
          $("print").disabled = false;
          root.__htmlDone = { pages: +n };
        } else if (performance.now() - t0 < 240000) setTimeout(wait, 300);
        else setStatus("err", "Layout did not finish — check engine.js");
      };
      wait();
    };
    frame.srcdoc = html;
  }

  function open(path) {
    current = path;
    cm.swapDoc(docs[path]);
    $("editing").textContent = path;
    document.querySelectorAll(".files button.file").forEach((b) => b.classList.toggle("on", b.dataset.path === path));
  }

  function buildFiles() {
    const box = $("files");
    box.textContent = "";
    const grp = (t) => { const d = document.createElement("div"); d.className = "grp"; d.textContent = t; box.appendChild(d); };
    grp("Code");
    for (const p of TEXT_FILES) {
      const b = document.createElement("button");
      b.className = "file";
      b.type = "button";
      b.dataset.path = p;
      b.textContent = p;
      b.addEventListener("click", () => open(p));
      box.appendChild(b);
    }
    const d0 = document.createElement("div");
    d0.className = "asset";
    d0.innerHTML = "<span>fonts.css (Kalpurush, embedded)</span>";
    box.appendChild(d0);
    const folders = {};
    for (const p of Object.keys(project.binaries)) { const f = p.split("/")[0]; (folders[f] = folders[f] || []).push(p); }
    for (const [f, list] of Object.entries(folders)) {
      grp(`${f}/ · ${list.length}`);
      for (const p of list.slice(0, 60)) {
        const d = document.createElement("div");
        d.className = "asset";
        const im = document.createElement("img");
        im.src = urls[p];
        const s = document.createElement("span");
        s.textContent = p.split("/").pop();
        d.append(im, s);
        box.appendChild(d);
      }
      if (list.length > 60) { const d = document.createElement("div"); d.className = "asset"; d.textContent = `… ${list.length - 60} more`; box.appendChild(d); }
    }
  }

  async function load(file) {
    $("loading").hidden = false;
    const say = (t) => ($("loading-text").textContent = t);
    try {
      say("Reading the Word file…");
      const data = await file.arrayBuffer();
      const model = await DocxReader.read(data);
      say("Finding MCQ and CQ parts…");
      const segs = Classify.segment(model.blocks);
      say("Writing the HTML, CSS and images…");
      const gen = await HTMLGen.generate(model, segs, { greyscale: $("grey").checked, name: file.name.replace(/\.(docx|docm)$/i, "") });
      project = Object.assign({ data, fileName: file.name, name: file.name.replace(/\.(docx|docm)$/i, "") }, gen);
      for (const [p, data] of Object.entries(project.binaries)) {
        urls[p] = URL.createObjectURL(new Blob([data], { type: /svg$/.test(p) ? "image/svg+xml" : /jpe?g$/.test(p) ? "image/jpeg" : "image/png" }));
      }
      $("start").hidden = true;
      $("workspace").hidden = false;
      if (!cm) {
        cm = CodeMirror($("editor"), { lineNumbers: true, lineWrapping: true, tabSize: 2, indentUnit: 2 });
        cm.on("change", () => { clearTimeout(timer); timer = setTimeout(preview, 1200); });
        cm.setOption("extraKeys", { "Cmd-S": preview, "Ctrl-S": preview });
      }
      for (const p of TEXT_FILES) docs[p] = CodeMirror.Doc(project.files[p], MODES[p]);
      buildFiles();
      open("index.html");
      $("dl-zip").disabled = false;
      preview();
    } catch (e) {
      console.error(e);
      say("Could not convert this file: " + (e && e.message ? e.message : e));
      root.__htmlDone = { error: String((e && e.stack) || e) };
      return;
    }
    $("loading").hidden = true;
  }

  async function downloadZip() {
    const zip = new JSZip();
    const dir = zip.folder(project.name + "_html");
    for (const p of TEXT_FILES) dir.file(p, docs[p].getValue());
    for (const [p, t] of Object.entries(project.extraText)) dir.file(p, t);
    for (const [p, data] of Object.entries(project.binaries)) dir.file(p, data);
    // questions/: MCQ / CQ sheets, cropped question pictures, media and media_color (scraper + Typst converter layout)
    setStatus("busy", "Extracting the questions…");
    try {
      const model = await DocxReader.read(project.data);
      const segs = Classify.segment(model.blocks);
      const q = await QuestionExport.build(project.data, model, segs, { name: project.fileName, onProgress: (t) => setStatus("busy", t) });
      QuestionExport.addTo(dir.folder("questions"), q.files);
      root.__questions = q.summary;
      setStatus("ok", `Zip ready: ${q.summary.mcq} MCQs, ${q.summary.sq} short and ${q.summary.cq} creative questions in questions/`);
    } catch (e) {
      console.error(e);
      setStatus("err", "Questions could not be extracted (the rest of the project is in the zip): " + (e && e.message ? e.message : e));
    }
    dir.file("README.txt", "Open index.html in Chrome or Edge. The pages are laid out when it opens.\nEdit index.html (text) or style.css (sizes, colours, spacing) and reload.\nTo save a PDF: the 'Print / Save as PDF' button, then Destination: Save as PDF.\n");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = project.name + "_html.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  $("file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) load(f); });
  $("drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); $("drop").classList.remove("over"); }));
  document.addEventListener("drop", (e) => {
    const f = [...(e.dataTransfer.files || [])].find((x) => /\.(docx|docm)$/i.test(x.name));
    if (f && !project) load(f);
  });
  $("refresh").addEventListener("click", preview);
  $("print").addEventListener("click", () => { const w = $("preview").contentWindow; w.document.title = project.name; w.focus(); w.print(); });
  $("dl-zip").addEventListener("click", downloadZip);
  // the picture cache of the renderer belongs to one document, so a new file starts from a fresh page
  $("new").addEventListener("click", () => location.reload());

  root.HTMLStudio = { load, project: () => project, preview };
})(typeof globalThis !== "undefined" ? globalThis : this);
