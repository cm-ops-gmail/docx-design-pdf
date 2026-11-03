/* Live sample page drawn from the settings: header, an MCQ part, a CQ part and the footer.
 * Sizes use real units (pt, in) on a page of the set size, scaled down to fit the panel. */
(function (root) {
  "use strict";

  const BN = "০১২৩৪৫৬৭৮৯";
  const SAMPLE_LABEL = "উৎপাদন ব্যবস্থাপনা ও বিপণন দ্বিতীয় পত্র ► অধ্যায় ০১ ► বিপণন পরিচিতি";
  const MCQS = [
    { q: "১। বিপণনের জনক কে?", src: "[ঢা. বো., রা. বো. ২৫]", opts: ["Philip Kotler", "McCarthy", "W. J. Stanton", "Gray Armstrong"], ans: "ক" },
    { q: "২। নিচের কোনটি বিপণনের মৌলিক বৈশিষ্ট্য?", src: "[ঢা. বো. '২৫]", opts: ["ভ্যালু", "বিনিময় প্রক্রিয়া", "চাহিদা", "প্রয়োজন"], ans: "খ" },
    { q: "৩। বিপণনের বৈশিষ্ট্য হলো—", src: "[ম. বো. '২৫]", lines: ["i. সামাজিক প্রক্রিয়া", "ii. ব্যবস্থাপকীয় প্রক্রিয়া", "iii. অর্থনৈতিক প্রক্রিয়া"], ask: "নিচের কোনটি সঠিক?", opts: ["i ও ii", "i ও iii", "ii ও iii", "i, ii ও iii"], ans: "ঘ" },
    { q: "৪। বিপণন কী?", src: "[দি. বো. ২১]", opts: ["ভোক্তাদের সন্তুষ্টি বিধানের প্রক্রিয়া", "ভোক্তাদের জন্য পণ্য উৎপাদন", "ভোক্তাদের নিকট পণ্য বণ্টন", "ভোক্তাদের জন্য পণ্য উন্নয়ন"], ans: "ক" },
  ];
  const LETTERS = ["ক", "খ", "গ", "ঘ"];

  const el = (tag, cls, css, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) Object.assign(e.style, css);
    if (text != null) e.textContent = text;
    return e;
  };
  const bn = (n) => String(n).replace(/\d/g, (d) => BN[d]);

  function circle(letter, m, filled) {
    const size = (filled ? m.answerEm : m.circleEm) * m.fontSize;
    return el("span", "pv-c", {
      width: size + "pt", height: size + "pt",
      border: filled ? "none" : `${m.circleStroke}pt solid ${m.circleColor}`,
      background: filled ? m.answerFill : "transparent",
      color: filled ? m.answerTextColor : m.circleTextColor,
      fontSize: (filled ? m.answerTextSize : m.circleTextSize) + "pt",
    }, letter);
  }

  function mcqBlock(item, m) {
    const box = el("div");
    const hang = m.hangingEm + "em";
    const line = (cls, text, css) => el("p", cls, Object.assign({ paddingLeft: hang, textIndent: "-" + hang }, css || {}), text);
    const t = line("pv-q", item.q, { color: m.questionColor });
    const src = el("span", "pv-src", {
      fontSize: m.sourceSize + "pt", fontStyle: m.sourceItalic ? "italic" : "normal", fontWeight: "normal",
      color: m.sourceColor, float: m.sourceRight ? "right" : "none", textIndent: "0",
    }, " " + item.src);
    t.appendChild(src);
    box.appendChild(t);
    for (const l of item.lines || []) box.appendChild(line("pv-line", l));
    if (item.ask) box.appendChild(line("pv-q", item.ask, { color: m.questionColor }));
    const stacked = Math.max(...item.opts.map((o) => o.length)) > m.stackAfter;
    const per = stacked ? 1 : 2;
    const grid = el("div", "pv-opts", {
      gridTemplateColumns: `${m.answerEm * m.fontSize}pt ${per === 2 ? "1fr 1fr" : "1fr"}`,
      columnGap: m.ansGapEm + "em", rowGap: m.rowGapEm + "em",
    });
    const ansRow = stacked ? 2 : 1;
    for (let i = 0, r = 0; i < item.opts.length; i += per, r++) {
      const a = el("div");
      if (r === ansRow) a.appendChild(circle(item.ans, m, true));
      grid.appendChild(a);
      for (let k = i; k < i + per; k++) {
        const o = el("div", "pv-opt", { color: m.optionColor });
        o.append(circle(LETTERS[k], m, false), el("span", null, null, item.opts[k]));
        grid.appendChild(o);
      }
    }
    box.appendChild(grid);
    return box;
  }

  function render(host, S, opts) {
    opts = opts || {};
    const pageNo = opts.page || 1;
    const P = S.page.enabled ? S.page : root.Settings.DEFAULTS.page;
    const W = P.width * 96, H = P.height * 96;
    const avail = host.parentElement.clientWidth - 2 * (parseFloat(getComputedStyle(host.parentElement).paddingLeft) || 0);
    const scale = Math.max(0.1, avail / W);
    host.textContent = "";
    host.style.width = W * scale + "px";
    host.style.height = (opts.crop ? Math.min(H, opts.crop * 96) : H) * scale + "px";

    const page = el("div", "pv-page", { width: W + "px", height: H + "px", transform: `scale(${scale})` });
    const textW = (P.width - P.left - P.right) * 96;
    const odd = pageNo % 2 === 1;

    // header
    const Hd = S.header;
    const hdr = el("div", "pv-hdr", { left: P.left + "in", right: P.right + "in", top: P.headerTop + "in", fontFamily: `"${Hd.font}", "Kalpurush", serif` });
    if (Hd.enabled) {
      const logo = el("img");
      logo.src = Hd.logo || root.ASSETS.headerLogo;
      logo.style.height = Hd.logoHeight + "in";
      const label = el("span", null, { fontSize: Hd.fontSize + "pt", color: Hd.color, overflow: "hidden", textOverflow: "clip" }, Hd.label || SAMPLE_LABEL);
      if (odd || !Hd.mirror) hdr.append(logo, label); else hdr.append(label, logo);
      hdr.style.borderBottom = Hd.rule > 0 ? `${Hd.rule}pt solid ${Hd.ruleColor}` : "none";
      hdr.style.paddingBottom = "1pt";
    } else hdr.append(el("span", "pv-muted", { fontSize: "9pt" }, "Word's own header"));
    page.appendChild(hdr);

    // body
    const body = el("div", "pv-body", { left: P.left + "in", top: P.top + "in", width: textW + "px" });
    body.appendChild(el("p", "pv-p pv-muted", { fontSize: "10pt" },
      "Theory pages and everything else from the Word file stay exactly as they are. Only the MCQ and CQ parts below change."));
    const m = S.mcq;
    const mcq = el("div", "pv-zone", { fontSize: m.fontSize + "pt", columnCount: Math.max(1, Math.round(m.columns)), columnGap: (textW * m.gutter) / 100 + "px" });
    for (const item of MCQS) mcq.appendChild(mcqBlock(item, m));
    body.appendChild(mcq);

    const c = S.cq;
    const cq = el("div", "pv-zone", { fontSize: c.fontSize + "pt", color: c.textColor, columnCount: Math.max(1, Math.round(c.columns)), columnGap: (textW * c.gutter) / 100 + "px" });
    cq.appendChild(el("p", "pv-stem", null, "প্রশ্ন-০১: সাজিয়া নাজনীন যশোরে 'লালপদ্ম' নামক শিশুদের পোশাকের একটি বিপণি প্রতিষ্ঠা করেন। তিনি সবসময় ক্রেতাদের প্রয়োজন, অভাব, রুচি ও পছন্দের প্রতি দৃষ্টি রেখে পোশাক তৈরি ও বিক্রয় করেন। [ঢা. বো. ২৫]"));
    ["(ক) বিপণন কী?", "(খ) ক্রেতা সন্তুষ্টি বলতে কী বোঝায়? ব্যাখ্যা করো।", "(গ) সাজিয়া নাজনীন বিপণনের কোন মৌলিক ধারণার ওপর গুরুত্ব দিয়েছেন? ব্যাখ্যা করো।", "(ঘ) সাজিয়া নাজনীনের সাফল্যের মূল কারণ বিশ্লেষণ করো।"]
      .forEach((t) => cq.appendChild(el("p", "pv-sub", { paddingLeft: c.subIndent + "in", color: c.subColor }, t)));
    cq.appendChild(el("p", "pv-hd", null, "১নং প্রশ্নের উত্তর"));
    cq.appendChild(el("p", "pv-stem", null, "(ক) বিপণন হচ্ছে একটি প্রক্রিয়া যার মাধ্যমে প্রতিষ্ঠানগুলো ক্রেতাদের জন্য ভ্যালু সৃষ্টি করে এবং বিনিময়ে ক্রেতাদের কাছ থেকে ভ্যালু পাওয়ার মাধ্যমে সুদৃঢ় ক্রেতা সম্পর্ক গড়ে তোলে।"));
    body.appendChild(cq);
    page.appendChild(body);

    // footer
    const Ft = S.footer;
    const ftr = el("div", "pv-ftr", { left: P.left + "in", right: P.right + "in", bottom: P.footerBottom + "in", fontFamily: `"${Ft.font}", "Kalpurush", serif` });
    if (Ft.enabled) {
      const logo = el("img");
      logo.src = Ft.logo || root.ASSETS.footerLogo;
      logo.style.height = Ft.logoHeight + "in";
      const num = el("span", null, { fontSize: Ft.fontSize + "pt", color: Ft.color }, Ft.banglaDigits ? bn(pageNo) : String(pageNo));
      if (odd || !Ft.mirror) ftr.append(logo, num); else ftr.append(num, logo);
      ftr.style.borderTop = Ft.rule > 0 ? `${Ft.rule}pt solid ${Ft.ruleColor}` : "none";
      ftr.style.paddingTop = "4pt";
    } else ftr.append(el("span", "pv-muted", { fontSize: "9pt" }, "Word's own footer"));
    page.appendChild(ftr);

    host.appendChild(page);
  }

  root.Preview = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
