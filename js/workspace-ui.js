/* Workspace layout for the Typst and HTML pages, like VS Code:
 *   - drag the bars between the project list, the editor and the preview to resize them
 *     (double-click a bar to go back to the default widths)
 *   - collapse the project list to a slim rail and open it again
 *   - open / close each folder of the project list
 * Widths and open folders are remembered in this browser (one set per page). */
(function (root) {
  "use strict";

  const KEY = "workspace-ui:" + location.pathname.split("/").pop();
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { state = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ } };

  let ws = null, onResize = () => {};

  function apply() {
    ws.style.setProperty("--side", (state.side || 220) + "px");
    ws.style.setProperty("--ed", (state.ed || 1) + "fr");
    ws.style.setProperty("--pv", (state.pv || 1) + "fr");
    ws.classList.toggle("side-collapsed", !!state.collapsed);
    const t = ws.querySelector(".side-toggle");
    if (t) { t.title = state.collapsed ? "Show the project list" : "Hide the project list"; t.setAttribute("aria-expanded", String(!state.collapsed)); }
  }

  function gutter(cls, onDrag) {
    const g = document.createElement("div");
    g.className = "gutter " + cls;
    g.setAttribute("role", "separator");
    g.title = "Drag to resize · double-click to reset";
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      ws.classList.add("dragging");
      const move = (ev) => onDrag(ev.clientX);
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        ws.classList.remove("dragging");
        save();
        onResize();
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
    });
    g.addEventListener("dblclick", () => { delete state.side; delete state.ed; delete state.pv; save(); apply(); onResize(); });
    return g;
  }

  // workspace: the grid holding  aside.pane | .pane-editor | .pane-preview ;  resized(): called after a resize
  function init(el, resized) {
    ws = el;
    onResize = resized || (() => {});
    const side = ws.querySelector("aside.pane"), editor = ws.querySelector(".pane-editor"), preview = ws.querySelector(".pane-preview");
    if (!side || !editor || !preview || ws.querySelector(".gutter")) return;

    // project list | editor
    side.after(gutter("g-side", (x) => {
      if (state.collapsed) { state.collapsed = false; }
      state.side = Math.round(Math.min(560, Math.max(150, x - ws.getBoundingClientRect().left)));
      apply();
    }));
    // editor | preview: the split as a ratio, so it follows the window width
    editor.after(gutter("g-split", (x) => {
      const a = editor.getBoundingClientRect().left, b = preview.getBoundingClientRect().right;
      const f = Math.min(0.85, Math.max(0.15, (x - a) / Math.max(1, b - a)));
      state.ed = +f.toFixed(3);
      state.pv = +(1 - f).toFixed(3);
      apply();
      onResize();
    }));

    // collapse button in the project list's header
    const head = side.querySelector(".pane-head");
    if (head && !head.querySelector(".side-toggle")) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "side-toggle";
      t.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      t.addEventListener("click", () => { state.collapsed = !state.collapsed; save(); apply(); onResize(); });
      head.prepend(t);
    }
    apply();
  }

  // a folder of the project list: a header that opens / closes its body. Returns the body.
  // open: the default when this folder's state was never changed; fill(body): called the first time it opens
  const filled = (wrap) => { if (wrap._fill) { const f = wrap._fill; wrap._fill = null; f(wrap.querySelector(".folder-body")); } };
  function folder(box, name, count, open, fill) {
    const id = "f:" + name;
    const isOpen = state[id] === undefined ? open !== false : !!state[id];
    const wrap = document.createElement("div");
    wrap.className = "folder" + (isOpen ? " open" : "");
    const h = document.createElement("button");
    h.type = "button";
    h.className = "grp";
    h.setAttribute("aria-expanded", String(isOpen));
    h.innerHTML = '<svg class="chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const label = document.createElement("span");
    label.textContent = name;
    h.appendChild(label);
    if (count != null) { const c = document.createElement("span"); c.className = "count"; c.textContent = count; h.appendChild(c); }
    const body = document.createElement("div");
    body.className = "folder-body";
    h.addEventListener("click", () => {
      const o = !wrap.classList.contains("open");
      wrap.classList.toggle("open", o);
      h.setAttribute("aria-expanded", String(o));
      if (o) filled(wrap);
      state[id] = o;
      save();
    });
    wrap.append(h, body);
    box.appendChild(wrap);
    wrap._fill = fill || null;
    if (isOpen) filled(wrap);
    return body;
  }

  // open or close every folder at once
  function setAll(box, open) {
    for (const w of box.querySelectorAll(".folder")) {
      w.classList.toggle("open", open);
      if (open) filled(w);
      const h = w.querySelector(".grp");
      h.setAttribute("aria-expanded", String(open));
      state["f:" + h.querySelector("span").textContent] = open;
    }
    save();
  }

  root.WorkspaceUI = { init, folder, setAll };
})(typeof globalThis !== "undefined" ? globalThis : this);
