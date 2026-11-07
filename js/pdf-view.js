/* PDF preview drawn with pdf.js: the exact compiled PDF, page by page, so a click can be traced back to
 * the code. Pages are drawn when they scroll into view; the scroll position survives a recompile. */
(function (root) {
  "use strict";

  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let host = null, doc = null, pages = [], scale = 0, fit = true, pageSize = null;
  let observer = null, generation = 0, onClick = null, onPage = null, shownPage = 0;
  let ready = null;

  // pdf.js and its worker (a cross-origin worker is not allowed, so it runs from a blob)
  function load() {
    if (ready) return ready;
    ready = (async () => {
      await new Promise((res, rej) => { const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const code = await (await fetch(PDFJS + "pdf.worker.min.js")).text();
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    })();
    return ready;
  }

  // pageHandler(n, total): the page at the middle of the view, whenever it changes
  function init(el, clickHandler, pageHandler) {
    host = el;
    onClick = clickHandler;
    onPage = pageHandler || null;
    load();
    new ResizeObserver(() => { if (fit && doc) relayout(); }).observe(host);
    host.addEventListener("scroll", reportPage, { passive: true });
  }

  function reportPage(force) {
    if (!onPage || !pages.length) return;
    const mid = host.scrollTop + host.clientHeight / 2;
    let n = 1;
    for (const p of pages) { if (p.wrap.offsetTop <= mid) n = p.wrap._n; else break; }
    if (n !== shownPage || force === true) { shownPage = n; onPage(n, pages.length); }
  }

  function goTo(n) {
    const p = pages[Math.min(Math.max(1, n), pages.length) - 1];
    if (p) host.scrollTo({ top: p.wrap.offsetTop - 12, behavior: "smooth" });
  }

  const fitScale = () => Math.max(0.2, (host.clientWidth - 36) / pageSize.w);

  async function show(bytes) {
    await load();
    const keepTop = host.scrollTop, oldH = host.scrollHeight || 1;
    const gen = ++generation;
    const next = await root.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    if (gen !== generation) return;
    if (doc) doc.destroy();
    doc = next;
    const p1 = await doc.getPage(1);
    const v = p1.getViewport({ scale: 1 });
    pageSize = { w: v.width, h: v.height };
    if (fit || !scale) scale = fitScale();
    build();
    // keep the reader where they were (by proportion when the page count changed)
    host.scrollTop = pages.length && Math.abs(host.scrollHeight - oldH) < 4 ? keepTop : keepTop * (host.scrollHeight / oldH);
  }

  function build() {
    if (observer) observer.disconnect();
    host.textContent = "";
    pages = [];
    const zoomBar = root.document.getElementById("zoom-label");
    if (zoomBar) zoomBar.textContent = Math.round((scale * 72 / 96) * 100) + "%";
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) draw(e.target._n);
    }, { root: host, rootMargin: "600px 0px" });
    for (let n = 1; n <= doc.numPages; n++) {
      const wrap = document.createElement("div");
      wrap.className = "pdfpage";
      wrap.style.width = pageSize.w * scale + "px";
      wrap.style.height = pageSize.h * scale + "px";
      wrap._n = n;
      wrap.title = "Click to show this place in the code";
      wrap.addEventListener("click", (ev) => {
        const r = wrap.getBoundingClientRect();
        if (onClick) onClick({ page: n, x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale, w: pageSize.w, h: pageSize.h });
      });
      host.appendChild(wrap);
      pages.push({ wrap, drawn: 0 });
      observer.observe(wrap);
    }
    requestAnimationFrame(() => reportPage(true));
  }

  async function draw(n) {
    const p = pages[n - 1];
    if (!p || p.drawn === scale) return;
    p.drawn = scale;
    const gen = generation;
    const page = await doc.getPage(n);
    if (gen !== generation) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: scale * dpr });
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width);
    cv.height = Math.ceil(vp.height);
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    if (gen !== generation) return;
    const old = p.wrap.querySelector("canvas");
    if (old) old.remove();
    p.wrap.prepend(cv);
  }

  function relayout() {
    const top = host.scrollTop / (host.scrollHeight || 1);
    scale = fitScale();
    build();
    host.scrollTop = top * host.scrollHeight;
  }

  function zoom(step) {
    if (!doc) return;
    const top = host.scrollTop / (host.scrollHeight || 1);
    if (step === 0) { fit = true; scale = fitScale(); }
    else { fit = false; scale = Math.min(4, Math.max(0.3, scale * (step > 0 ? 1.2 : 1 / 1.2))); }
    build();
    host.scrollTop = top * host.scrollHeight;
  }

  // scroll so that (page, y in pt) is near the top, and flash a bar there
  function scrollTo(page, y, x) {
    const p = pages[page - 1];
    if (!p) return;
    const top = p.wrap.offsetTop + y * scale - 60;
    host.scrollTo({ top, behavior: "smooth" });
    const bar = document.createElement("div");
    bar.className = "jump-bar";
    bar.style.top = y * scale - 3 + "px";
    if (x != null) { bar.style.left = Math.max(0, x * scale - 6) + "px"; bar.style.right = "auto"; bar.style.width = (pageSize.w * scale) / 2 + "px"; }
    p.wrap.appendChild(bar);
    setTimeout(() => bar.remove(), 1600);
  }

  root.PdfView = { init, show, zoom, scrollTo, goTo };
})(typeof globalThis !== "undefined" ? globalThis : this);
