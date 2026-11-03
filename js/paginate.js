/* Page layout engine: places rendered blocks on fixed-size pages, the way the Typst output is laid out.
 *
 * Geometry (page_setup_template.typ): 8.5in x 10.6in, margins top/bottom 0.68in, left/right 0.58in;
 * the running header sits in the top margin and the footer in the bottom margin; odd and even pages
 * mirror them. MCQ and CQ parts are set in two columns (Typst `#columns(2)`, gutter 4%), everything
 * else in one. A new chapter (a Word section with a different page header) starts a new page. */
(function (root) {
  "use strict";

  const IN = 96;
  const PAGE_W = 8.5 * IN, PAGE_H = 10.6 * IN;
  const MT = 0.68 * IN, MB = 0.68 * IN, ML = 0.58 * IN, MR = 0.58 * IN;
  const CW = PAGE_W - ML - MR, CH = PAGE_H - MT - MB;
  const GUT = 0.04 * CW;
  const COLW = (CW - GUT) / 2;
  const REGION_GAP = 10;
  const BN = "০১২৩৪৫৬৭৮৯";
  const bnNum = (n) => String(n).replace(/\d/g, (d) => BN[d]);

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  class Paginator {
    constructor(host, measureHost, opts) {
      this.host = host;
      this.meas = measureHost;
      this.opts = opts || {};
      this.label = this.opts.label || "";
      this.pageNo = 0;
      this.page = null;
      this.usedH = 0;
      this.region = null;
    }

    // ---------- pages ----------
    newPage() {
      this.pageNo++;
      const odd = this.pageNo % 2 === 1;
      const page = el("div", "page " + (odd ? "odd" : "even"));
      const hdr = el("div", "hdr");
      const row = el("div", "hdr-row");
      const logo = el("img", "hdr-logo");
      logo.src = root.ASSETS.headerLogo;
      const lab = el("div", "hdr-label");
      lab.textContent = this.label;
      if (odd) row.append(logo, lab); else row.append(lab, logo);
      hdr.append(row, el("div", "rule"));
      const body = el("div", "body");
      const ftr = el("div", "ftr");
      const frow = el("div", "ftr-row");
      const flogo = el("img", "ftr-logo");
      flogo.src = root.ASSETS.footerLogo;
      const num = el("div", "ftr-num");
      num.textContent = bnNum(this.pageNo);
      if (odd) frow.append(flogo, num); else frow.append(num, flogo);
      ftr.append(el("div", "rule"), frow);
      page.append(hdr, body, ftr);
      this.host.appendChild(page);
      this.page = page;
      this.body = body;
      this.usedH = 0;
      this.region = null;
    }

    setLabel(label) {
      if (!label || label === this.label) return;
      this.label = label;
      if (this.page && this.usedH > 0) this.pendingBreak = true;
      else if (this.page) this.page.querySelector(".hdr-label").textContent = label;
    }

    openRegion(cols, zone) {
      if (!this.page || this.pendingBreak) { this.pendingBreak = false; this.newPage(); }
      let top = this.usedH ? this.usedH + REGION_GAP : 0;
      if (CH - top < 60) { this.newPage(); top = 0; }
      const reg = el("div", "region zone-" + zone + (cols === 2 ? " two" : ""));
      reg.style.top = top + "px";
      const colEls = [];
      for (let i = 0; i < cols; i++) { const c = el("div", "col"); reg.appendChild(c); colEls.push(c); }
      this.body.appendChild(reg);
      this.region = { el: reg, cols: colEls, used: new Array(cols).fill(0), items: colEls.map(() => []), ci: 0, top, colH: CH - top, n: cols, zone };
    }

    closeRegion(balance) {
      const r = this.region;
      if (!r) return;
      if (balance && r.n === 2) this.balance(r);
      const h = Math.max(...r.used);
      r.el.style.height = h + "px";
      this.usedH = r.top + h;
      this.region = null;
    }

    // even out the two columns of the last page of a two-column part
    balance(r) {
      const all = r.items[0].concat(r.items[1]);
      if (all.length < 2) return;
      const total = all.reduce((s, x) => s + x.h, 0);
      let best = -1, bestMax = Infinity, acc = 0;
      for (let s = 1; s < all.length; s++) {
        acc += all[s - 1].h;
        const left = acc, right = total - acc;
        if (left > r.colH + 0.5 || right > r.colH + 0.5) continue;
        if (all[s - 1].keepnext) continue;
        const m = Math.max(left, right);
        if (m < bestMax - 0.5 || (Math.abs(m - bestMax) <= 0.5 && left >= right)) { bestMax = m; best = s; }
      }
      if (best < 0) return;
      r.items = [all.slice(0, best), all.slice(best)];
      r.cols.forEach((c, i) => { c.textContent = ""; r.items[i].forEach((x) => c.appendChild(x.el)); });
      r.used = r.items.map((list) => list.reduce((s, x) => s + x.h, 0));
    }

    nextColumn() {
      const r = this.region;
      if (r.ci < r.n - 1) { r.ci++; return; }
      const { n, zone } = r;
      r.used = r.used.map(() => r.colH);
      this.closeRegion(false);
      this.newPage();
      this.openRegion(n, zone);
    }

    put(item) {
      const r = this.region;
      r.cols[r.ci].appendChild(item.el);
      r.items[r.ci].push(item);
      r.used[r.ci] += item.h;
    }

    // ---------- measuring ----------
    measureBox(cols, zone) {
      const box = el("div", "measure zone-" + zone);
      box.style.width = (cols === 2 ? COLW : CW) + "px";
      this.meas.textContent = "";
      this.meas.appendChild(box);
      return box;
    }

    static height(e) { return e.getBoundingClientRect().height; }

    async measureAll(box, els) {
      for (const e of els) box.appendChild(e);
      fitDrawings(box);
      await document.fonts.ready;
      await nextFrame();
      // MCQ options: pairs that wrap become one option per row (Typst: mcq-options-stacked)
      let changed = false;
      for (const g of box.querySelectorAll('.opts[data-mode="pairs"]')) {
        if (g.querySelector("img, .drawing-holder")) continue;
        const lh = parseFloat(getComputedStyle(g).fontSize) * 1.9;
        if (Array.from(g.querySelectorAll(".opt")).some((c) => c.getBoundingClientRect().height > lh)) {
          root.Render.layoutOptions(g, "stacked");
          changed = true;
        }
      }
      if (changed) await nextFrame();
      return els.map((e) => ({ el: e, h: Paginator.height(e), split: e.dataset.split || "none", keepnext: e.dataset.keepnext === "1" }));
    }

    // ---------- flowing a part ----------
    async flow(seg, units) {
      const cols = seg.type === "normal" ? 1 : 2;
      const zone = seg.type;
      const box = this.measureBox(cols, zone);
      this.mbox = box;
      const queue = await this.measureAll(box, units);
      this.openRegion(cols, zone);
      let guard = 0;
      while (queue.length) {
        if (++guard > 200000) throw new Error("layout did not converge");
        const item = queue.shift();
        const r = this.region;
        const rem = r.colH - r.used[r.ci];
        const fresh = r.used[r.ci] === 0 && r.top === 0; // an empty column on an empty page
        let need = item.h;
        if (item.keepnext && queue.length) need += Math.min(queue[0].h, 36);
        if (need <= rem + 0.5) { this.put(item); continue; }

        // a whole MCQ is moved to the next column unless that would leave a big gap
        const worthSplitting = item.split === "kids" ? rem > r.colH * 0.2 || item.h > r.colH : rem >= 34;
        if (item.split !== "none" && worthSplitting && !(item.keepnext && !fresh)) {
          const parts = this.split(item, rem);
          if (parts) {
            this.put(parts[0]);
            this.nextColumn();
            queue.unshift(parts[1]);
            continue;
          }
        }
        // a picture or drawing that nearly fits is drawn a little smaller instead of leaving the space empty
        if (item.el.classList.contains("fig") && rem > 60 && rem >= item.h * 0.8 && this.shrink(item, rem)) {
          this.put(item);
          continue;
        }
        if (fresh) { // does not fit even an empty column and cannot be cut: place it anyway
          if (item.h > rem + 0.5) shrinkToFit(item, rem);
          this.put(item);
          this.nextColumn();
          continue;
        }
        this.nextColumn();
        queue.unshift(item);
      }
      this.closeRegion(cols === 2);
    }

    shrink(item, target) {
      const e = item.el;
      this.mbox.appendChild(e);
      const pad = parseFloat(getComputedStyle(e).paddingBottom) || 0;
      const ratio = (target - pad - 1) / (item.h - pad);
      for (const img of e.querySelectorAll("img.pic")) {
        img.style.width = img.getBoundingClientRect().width * ratio + "px";
        img.style.height = "auto";
      }
      for (const h of e.querySelectorAll(".drawing-holder")) {
        if (h.parentElement.closest(".drawing")) continue;
        const w = parseFloat(h.style.width) * ratio, hh = parseFloat(h.style.height) * ratio;
        h.style.width = w + "px";
        h.style.height = hh + "px";
        h.firstChild.style.transform = `scale(${w / parseFloat(h.dataset.w)})`;
      }
      item.h = Paginator.height(e);
      return item.h <= target + 0.5;
    }

    // ---------- splitting a block across columns ----------
    split(item, limit) {
      const box = this.mbox;
      box.textContent = "";
      box.appendChild(item.el);
      let parts = null;
      if (item.split === "text") parts = splitText(item.el, limit);
      else if (item.split === "table") parts = splitTable(item.el, limit);
      else if (item.split === "kids") parts = splitKids(item.el, limit);
      if (!parts) return null;
      return parts.map((e) => {
        box.textContent = "";
        box.appendChild(e);
        const h = Paginator.height(e);
        return { el: e, h, split: e.dataset.split || "none", keepnext: e.dataset.keepnext === "1" };
      });
    }
  }

  // text nodes a paragraph may be cut in (never inside an equation or an option circle)
  function cuttable(rootEl) {
    const out = [];
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(".katex, .oc, .ac, .drawing") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }

  function cutAt(src, ni, ci, keepHead) {
    const c = src.cloneNode(true);
    const nodes = cuttable(c);
    const node = nodes[ni];
    const range = document.createRange();
    if (keepHead) {
      node.data = node.data.slice(0, ci).replace(/\s+$/, "");
      range.setStart(node, node.data.length);
      range.setEndAfter(c.lastChild);
    } else {
      node.data = node.data.slice(ci + 1);
      range.setStartBefore(c.firstChild);
      range.setEnd(node, 0);
    }
    range.deleteContents();
    return c;
  }

  function splitText(p, limit) {
    const nodes = cuttable(p);
    const cands = [];
    nodes.forEach((n, ni) => {
      const re = /\s/g;
      for (let m = re.exec(n.data); m; m = re.exec(n.data)) cands.push([ni, m.index]);
    });
    if (!cands.length) return null;
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 18;
    const host = p.parentNode;
    const tryHead = (k) => {
      const h = cutAt(p, cands[k][0], cands[k][1], true);
      h.classList.add("brk");
      host.appendChild(h);
      const hh = h.getBoundingClientRect().height;
      host.removeChild(h);
      return hh;
    };
    let lo = 0, hi = cands.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tryHead(mid) <= limit + 0.5) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    const headH = tryHead(best);
    if (headH < lh * 1.9) return null; // keep at least two lines together (Typst orphan control)
    const head = cutAt(p, cands[best][0], cands[best][1], true);
    const tail = cutAt(p, cands[best][0], cands[best][1], false);
    head.classList.add("brk");
    tail.classList.add("cont");
    delete head.dataset.keepnext;
    if (!tail.textContent.trim() && !tail.querySelector("img, .katex, .drawing-holder")) return null;
    return [head, tail];
  }

  function splitTable(t, limit) {
    const rows = Array.from(t.rows);
    if (rows.length < 2) return null;
    const top = t.getBoundingClientRect().top;
    let k = -1;
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].getBoundingClientRect().bottom - top <= limit - 2) k = i; else break;
    }
    if (k < 0) return null;
    const a = t.cloneNode(true), b = t.cloneNode(true);
    Array.from(a.rows).slice(k + 1).forEach((r) => r.remove());
    Array.from(b.rows).slice(0, k + 1).forEach((r) => r.remove());
    b.classList.add("cont");
    return [a, b];
  }

  function splitKids(box, limit) {
    const kids = Array.from(box.children);
    if (kids.length < 2) return null;
    const top = box.getBoundingClientRect().top;
    let k = 0;
    for (let i = 0; i < kids.length - 1; i++) {
      if (kids[i].getBoundingClientRect().bottom - top <= limit - 1) { if (kids[i].dataset.keepnext !== "1") k = i + 1; } else break;
    }
    // the first child that does not fit may itself be cut between lines
    let cut = null;
    const next = kids[k];
    if (next && next.dataset.split === "text") {
      const used = k ? kids[k - 1].getBoundingClientRect().bottom - top : next.getBoundingClientRect().top - top;
      if (limit - used >= 34) cut = splitText(next, limit - used - 1);
    }
    if (k === 0 && !cut) return null;
    const a = box.cloneNode(false), b = box.cloneNode(false);
    kids.slice(0, k).forEach((c) => a.appendChild(c));
    if (cut) { a.appendChild(cut[0]); b.appendChild(cut[1]); kids.slice(k + 1).forEach((c) => b.appendChild(c)); }
    else kids.slice(k).forEach((c) => b.appendChild(c));
    a.classList.add("brk");
    b.classList.add("cont");
    a.dataset.split = b.dataset.split = "kids";
    return [a, b];
  }

  // drawings are laid out at their Word size; scale them down to the column
  function fitDrawings(scope) {
    for (const h of scope.querySelectorAll(".drawing-holder")) {
      const w = parseFloat(h.dataset.w), hh = parseFloat(h.dataset.h);
      const parent = h.parentElement.closest(".shape-text, td, .opt, p, .fig, .measure, .col") || h.parentElement;
      let avail = parent.clientWidth || w;
      if (h.classList.contains("fl-left") || h.classList.contains("fl-right")) avail *= 0.45;
      const s = Math.min(1, avail / w);
      h.style.width = w * s + "px";
      h.style.height = hh * s + "px";
      h.firstChild.style.transform = s < 1 ? `scale(${s})` : "";
    }
  }

  function shrinkToFit(item, limit) {
    const img = item.el.querySelector("img.pic");
    if (img && item.el.matches(".fig")) {
      img.style.maxHeight = Math.max(80, limit - 8) + "px";
      img.style.width = "auto";
      item.h = Math.min(item.h, limit);
    }
  }

  root.Paginator = Paginator;
  root.PageGeom = { PAGE_W, PAGE_H, MT, MB, ML, MR, CW, CH, GUT, COLW };
})(typeof globalThis !== "undefined" ? globalThis : this);
