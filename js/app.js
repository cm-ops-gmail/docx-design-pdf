/* Page glue: pick a .docx, lay it out, print to PDF. */
(function (root) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const status = $("status"), summary = $("summary"), pagesEl = $("pages"), pdfBtn = $("pdf");
  let stem = "output", busy = false, lastFile = null;

  function progress(msg, isErr) {
    status.textContent = msg;
    status.classList.toggle("err", !!isErr);
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const fontReady = (async () => {
    const face = new FontFace("Kalpurush", `url(${root.ASSETS.kalpurush})`);
    document.fonts.add(await face.load());
    // KaTeX fonts load on first use; render one equation so measuring sees the real glyphs
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;left:-9999px";
    root.katex.render("x^2+\\frac{a}{b}\\sqrt{c}\\sum\\int", probe, { throwOnError: false });
    document.body.appendChild(probe);
    await document.fonts.ready;
    probe.remove();
  })();

  function unitsFor(seg) {
    if (seg.type === "mcq") return Classify.mcqUnits(seg.blocks).map((u) => Render.mcqUnit(u));
    if (seg.type === "cq") {
      const roles = Classify.cqRoles(seg.blocks);
      return seg.blocks.map((b, i) => Render.cqBlock(b, roles[i]));
    }
    return seg.blocks.map((b) => Render.block(b));
  }

  async function convert(file) {
    if (busy) return;
    busy = true;
    lastFile = file;
    pdfBtn.disabled = true;
    summary.textContent = "";
    pagesEl.textContent = "";
    $("drop").style.display = "none";
    stem = file.name.replace(/\.(docx|docm)$/i, "");
    const t0 = performance.now();
    try {
      await fontReady;
      progress("Reading document…");
      const model = await DocxReader.read(await file.arrayBuffer());
      progress("Preparing pictures…");
      await Render.prepareImages(model, $("grey").checked);
      progress("Finding MCQ and CQ parts…");
      const segs = Classify.segment(model.blocks);
      const nMcq = segs.filter((s) => s.type === "mcq").length, nCq = segs.filter((s) => s.type === "cq").length;

      const override = $("label").value.trim();
      const firstLabel = (segs.find((s) => s.type === "section" && s.label) || {}).label;
      const pager = new Paginator(pagesEl, $("measure"), { label: override || firstLabel || stem });
      let done = 0;
      for (const seg of segs) {
        if (seg.type === "section") { if (!override) pager.setLabel(seg.label); continue; }
        await pager.flow(seg, unitsFor(seg));
        done += seg.blocks.length;
        progress(`Laying out… page ${pager.pageNo}`);
        await tick();
      }
      $("measure").textContent = "";
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      progress(`Done: ${pager.pageNo} pages in ${secs}s.`);
      summary.textContent = `Found ${nMcq} MCQ part${nMcq === 1 ? "" : "s"} and ${nCq} CQ part${nCq === 1 ? "" : "s"}.`;
      pdfBtn.disabled = false;
      root.__layoutDone = {
        pages: pager.pageNo, mcq: nMcq, cq: nCq,
        segs: segs.map((s) => [s.type, s.blocks.length, s.blocks[0] ? Classify.clean(s.blocks[0]).slice(0, 40) : s.label || "",
          s.blocks.slice(0, 6).map((b) => b.kind + ":" + Classify.clean(b).slice(0, 30)).join(" | ")]),
      };
    } catch (e) {
      console.error(e);
      progress("Could not convert: " + (e && e.message ? e.message : e), true);
      root.__layoutDone = { error: String(e && e.stack || e) };
    } finally {
      busy = false;
    }
  }

  $("file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) convert(f); e.target.value = ""; });
  $("grey").addEventListener("change", () => { if (lastFile && !busy) convert(lastFile); });
  $("label").addEventListener("change", () => { if (lastFile && !busy) convert(lastFile); });
  pdfBtn.addEventListener("click", () => {
    const title = document.title;
    document.title = stem; // Chrome uses the page title as the PDF file name
    progress('In the print window, set Destination to "Save as PDF" and click Save.');
    window.print();
    setTimeout(() => (document.title = title), 1000);
  });

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  document.addEventListener("drop", (e) => {
    const f = [...(e.dataTransfer.files || [])].find((x) => /\.(docx|docm)$/i.test(x.name));
    if (f) convert(f);
  });

  // ?src=<url of a .docx> converts that file straight away (handy for testing)
  const src = new URLSearchParams(location.search).get("src");
  if (src) {
    fetch(src).then((r) => r.blob()).then((b) => convert(new File([b], decodeURIComponent(src.split("/").pop()))));
  }

  root.App = { progress, convert };
})(typeof globalThis !== "undefined" ? globalThis : this);
