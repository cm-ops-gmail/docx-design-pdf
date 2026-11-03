/* App controller: Convert view (docx in -> styled docx out) and Settings view (Typst template tokens). */
(function (root) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const { DEFAULTS, SCHEMA } = root.Settings;
  let S = root.Settings.load();
  let previewPage = 1;

  // Kalpurush for the previews
  try {
    const face = new FontFace("Kalpurush", `url(${root.ASSETS.kalpurush})`);
    face.load().then((f) => { document.fonts.add(f); drawPreviews(); });
  } catch (e) { /* previews fall back to a system Bangla font */ }

  // ---------- views ----------
  function showView() {
    const v = location.hash === "#settings" ? "settings" : "convert";
    $("view-convert").hidden = v !== "convert";
    $("view-settings").hidden = v !== "settings";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.view === v));
    requestAnimationFrame(drawPreviews);
  }
  window.addEventListener("hashchange", showView);

  // ---------- previews and summary ----------
  let drawQueued = false;
  function drawPreviews() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      if (!$("view-settings").hidden) root.Preview.render($("preview"), S, { page: previewPage });
      if (!$("view-convert").hidden) root.Preview.render($("preview-mini"), S, { page: 1 });
    });
  }
  new ResizeObserver(drawPreviews).observe(document.body);
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    previewPage = parseInt(b.dataset.page, 10);
    document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
    drawPreviews();
  }));

  function summary() {
    const chip = (k, v) => `<span class="chip">${k} <b>${v}</b></span>`;
    const cols = (n) => (Math.round(n) === 1 ? "1 column" : `${Math.round(n)} columns`);
    $("summary").innerHTML = [
      chip("MCQ", `${S.mcq.fontSize}pt · ${cols(S.mcq.columns)}`),
      chip("CQ", `${S.cq.fontSize}pt · ${cols(S.cq.columns)}`),
      chip("Page", S.page.enabled ? `${S.page.width} × ${S.page.height} in` : "from Word"),
      chip("Header", S.header.enabled ? "Typst" : "from Word"),
      chip("Footer", S.footer.enabled ? (S.footer.banglaDigits ? "Typst · ১২৩" : "Typst · 123") : "from Word"),
    ].join("");
  }

  // ---------- settings form ----------
  let savedTimer;
  function changed() {
    const ok = root.Settings.save(S);
    const s = $("saved");
    s.textContent = ok ? "Saved" : "Could not save in this browser";
    s.classList.add("show");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => s.classList.remove("show"), 1400);
    summary();
    drawPreviews();
  }

  function fieldEl(group, [key, label, type, extra]) {
    extra = extra || {};
    const wrap = document.createElement("div");
    wrap.className = "field" + (type === "text" || type === "image" ? " wide" : "") + (key === "enabled" ? " master wide" : "");
    const token = extra.typst ? `<span class="token" title="Typst: ${extra.typst}">${extra.typst}</span>` : "";
    const id = `f-${group}-${key}`;
    const val = () => S[group][key];
    const mark = () => wrap.classList.toggle("changed", JSON.stringify(val()) !== JSON.stringify(DEFAULTS[group][key]));
    const set = (v) => { S[group][key] = v; mark(); if (key === "enabled") sectionState(group); changed(); };

    if (type === "toggle") {
      wrap.innerHTML = `<label class="switch"><input type="checkbox" id="${id}"> <span>${label}</span></label>`;
      const i = wrap.querySelector("input");
      i.checked = !!val();
      i.addEventListener("change", () => set(i.checked));
      wrap._sync = () => { i.checked = !!val(); mark(); };
    } else if (type === "num") {
      wrap.innerHTML = `<label for="${id}"><span>${label}</span>${token}</label>
        <div class="input"><input id="${id}" type="number" inputmode="decimal" step="${extra.step || 1}" min="${extra.min ?? ""}" max="${extra.max ?? ""}">
        ${extra.unit ? `<span class="unit">${extra.unit}</span>` : ""}<button class="step" type="button" data-d="-1" aria-label="Decrease">−</button><button class="step" type="button" data-d="1" aria-label="Increase">+</button></div>`;
      const i = wrap.querySelector("input");
      i.value = val();
      const commit = (v) => {
        if (!isFinite(v)) return;
        if (extra.min != null) v = Math.max(extra.min, v);
        if (extra.max != null) v = Math.min(extra.max, v);
        v = Math.round(v * 1000) / 1000;
        i.value = v;
        set(v);
      };
      i.addEventListener("input", () => { const v = parseFloat(i.value); if (isFinite(v)) set(v); });
      i.addEventListener("change", () => commit(parseFloat(i.value)));
      wrap.querySelectorAll(".step").forEach((b) => b.addEventListener("click", () => commit(parseFloat(i.value || 0) + parseFloat(b.dataset.d) * (extra.step || 1))));
      wrap._sync = () => { i.value = val(); mark(); };
    } else if (type === "color") {
      wrap.innerHTML = `<label for="${id}"><span>${label}</span>${token}</label>
        <div class="color-input"><input type="color" id="${id}"><div class="input"><input type="text" spellcheck="false" maxlength="7"></div></div>`;
      const [pick, txt] = wrap.querySelectorAll("input");
      const show = () => { pick.value = val(); txt.value = val().toUpperCase(); };
      show();
      pick.addEventListener("input", () => { set(pick.value); txt.value = pick.value.toUpperCase(); });
      txt.addEventListener("change", () => {
        const v = txt.value.trim().replace(/^([0-9a-f]{6})$/i, "#$1");
        if (/^#[0-9a-f]{6}$/i.test(v)) { set(v.toLowerCase()); show(); } else show();
      });
      wrap._sync = () => { show(); mark(); };
    } else if (type === "text") {
      wrap.innerHTML = `<label for="${id}"><span>${label}</span>${token}</label><div class="input"><input id="${id}" type="text" placeholder="${extra.placeholder || ""}"></div>`;
      const i = wrap.querySelector("input");
      i.value = val();
      i.addEventListener("input", () => set(i.value));
      wrap._sync = () => { i.value = val(); mark(); };
    } else if (type === "image") {
      wrap.innerHTML = `<div class="lbl"><span>${label}</span>${token}</div>
        <div class="image-input"><span class="thumb"><img alt=""></span>
        <label class="btn btn-quiet">Upload…<input type="file" accept="image/png,image/jpeg" hidden></label>
        <button type="button" class="btn btn-quiet">Use default</button></div>`;
      const img = wrap.querySelector("img"), file = wrap.querySelector("input"), def = wrap.querySelector("button");
      const show = () => { img.src = val() || (group === "header" ? root.ASSETS.headerLogo : root.ASSETS.footerLogo); };
      show();
      file.addEventListener("change", () => {
        const f = file.files[0];
        file.value = "";
        if (!f) return;
        if (f.size > 800 * 1024) { alert("Please use a logo smaller than 800 KB."); return; }
        const rd = new FileReader();
        rd.onload = () => { set(rd.result); show(); };
        rd.readAsDataURL(f);
      });
      def.addEventListener("click", () => { set(""); show(); });
      wrap._sync = () => { show(); mark(); };
    }
    mark();
    return wrap;
  }

  const sections = {};
  function sectionState(group) {
    const sec = sections[group];
    if (sec && "enabled" in S[group]) sec.classList.toggle("off", !S[group].enabled);
  }

  function buildForm() {
    const form = $("form"), nav = $("section-nav");
    form.textContent = "";
    nav.textContent = "";
    for (const sec of SCHEMA) {
      const card = document.createElement("section");
      card.className = "card section";
      card.id = "sec-" + sec.id;
      card.innerHTML = `<div class="section-head"><h3>${sec.title}</h3><span class="file">${sec.file}</span></div>
        <p class="section-hint">${sec.hint} <button class="section-reset" type="button">Reset this section</button></p><div class="fields"></div>`;
      const fields = card.querySelector(".fields");
      const els = sec.fields.map((f) => fieldEl(sec.id, f));
      els.forEach((e) => fields.appendChild(e));
      card.querySelector(".section-reset").addEventListener("click", () => {
        S[sec.id] = JSON.parse(JSON.stringify(DEFAULTS[sec.id]));
        els.forEach((e) => e._sync && e._sync());
        sectionState(sec.id);
        changed();
      });
      sections[sec.id] = card;
      sectionState(sec.id);
      form.appendChild(card);
      const a = document.createElement("a");
      a.href = "#settings";
      a.dataset.sec = sec.id;
      a.innerHTML = `${sec.title}<small>${sec.file}</small>`;
      a.addEventListener("click", (e) => { e.preventDefault(); card.scrollIntoView({ behavior: "smooth", block: "start" }); });
      nav.appendChild(a);
    }
    const spy = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) nav.querySelectorAll("a").forEach((a) => a.classList.toggle("on", "sec-" + a.dataset.sec === en.target.id));
    }, { rootMargin: "-90px 0px -60% 0px" });
    Object.values(sections).forEach((s) => spy.observe(s));
  }

  // export / import / reset
  $("export").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: "application/json" }));
    a.download = "mcq-cq-style.json";
    a.click();
  });
  $("import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      S = root.Settings.merge(DEFAULTS, JSON.parse(await f.text()));
      buildForm();
      changed();
    } catch (err) { alert("That file is not a settings file exported from here."); }
  });
  let resetArmed = null;
  $("reset-all").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!resetArmed) {
      b.textContent = "Click again to reset everything";
      resetArmed = setTimeout(() => { b.textContent = "Reset all to Typst"; resetArmed = null; }, 3000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    b.textContent = "Reset all to Typst";
    S = root.Settings.merge(DEFAULTS, {});
    buildForm();
    changed();
  });

  // ---------- convert ----------
  let busy = false, lastUrl = null;
  const steps = () => Array.from(document.querySelectorAll("#steps li"));
  function step(name) {
    let reached = false;
    for (const li of steps()) {
      if (li.dataset.step === name) { li.className = "active"; reached = true; }
      else li.className = reached ? "" : "done";
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  async function convert(file) {
    if (busy) return;
    busy = true;
    $("drop").hidden = true;
    $("job").hidden = false;
    $("job-name").textContent = file.name;
    $("job-size").textContent = kb(file.size);
    $("job-error").hidden = true;
    $("job-result").hidden = true;
    const stem = file.name.replace(/\.(docx|docm)$/i, "");
    try {
      step("read"); await tick();
      const model = await DocxReader.read(await file.arrayBuffer());
      step("find"); await tick();
      const segs = Classify.segment(model.blocks);
      step("style"); await tick();
      const settings = JSON.parse(JSON.stringify(S));
      const out = DocxWriter.write(model, segs, settings, { stem });
      step("pack");
      const { blob, stats } = await out;
      steps().forEach((li) => (li.className = "done"));
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      const name = `${stem}_styled.docx`;
      const a = $("download");
      a.href = lastUrl;
      a.download = name;
      $("download-label").textContent = `Download ${name}`;
      $("st-mcq").textContent = stats.mcq;
      $("st-cq").textContent = stats.cq;
      $("st-q").textContent = stats.questions;
      $("job-result").hidden = false;
      a.click();
      lastFile = file;
      root.__docxDone = { mcq: stats.mcq, cq: stats.cq, questions: stats.questions, blob };
    } catch (e) {
      console.error(e);
      steps().forEach((li) => { if (li.className === "active") li.className = ""; });
      const err = $("job-error");
      err.textContent = "Could not convert this file: " + (e && e.message ? e.message : e);
      err.hidden = false;
      root.__docxDone = { error: String((e && e.stack) || e) };
    } finally {
      busy = false;
    }
  }

  // ---------- questions (MCQ / CQ sheets and cropped pictures, like the scraper and the Typst converter) ----------
  let lastFile = null;
  async function downloadQuestions() {
    if (!lastFile) return;
    const btn = $("dl-questions"), label = $("dl-questions-label"), was = label.textContent;
    btn.disabled = true;
    try {
      const data = await lastFile.arrayBuffer();
      // a fresh read: the styling step changed the first one
      const model = await DocxReader.read(data);
      const segs = Classify.segment(model.blocks);
      const { files, summary } = await QuestionExport.build(data, model, segs, { name: lastFile.name, onProgress: (t) => (label.textContent = t) });
      const zip = new JSZip();
      const stem = lastFile.name.replace(/\.(docx|docm)$/i, "");
      QuestionExport.addTo(zip.folder(stem + "_questions"), files);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = stem + "_questions.zip";
      a.click();
      label.textContent = `Downloaded: ${summary.mcq} MCQs, ${summary.sq} short questions, ${summary.cq} creative questions, ${summary.images} pictures`;
      root.__questionsDone = { summary, blob };
    } catch (e) {
      console.error(e);
      label.textContent = "Could not extract the questions: " + (e && e.message ? e.message : e);
      root.__questionsDone = { error: String((e && e.stack) || e) };
    } finally {
      btn.disabled = false;
      setTimeout(() => { if (!btn.disabled) label.textContent = was; }, 8000);
    }
  }
  $("dl-questions").addEventListener("click", downloadQuestions);

  $("file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) convert(f); });
  $("drop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  $("again").addEventListener("click", () => { $("job").hidden = true; $("drop").hidden = false; $("file").click(); });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  document.addEventListener("drop", (e) => {
    const f = [...(e.dataTransfer.files || [])].find((x) => /\.(docx|docm)$/i.test(x.name));
    if (f) { location.hash = "#convert"; convert(f); }
  });

  buildForm();
  summary();
  showView();
  root.App = { settings: () => S };
})(typeof globalThis !== "undefined" ? globalThis : this);
