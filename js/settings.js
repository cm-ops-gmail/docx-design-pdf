/* Style settings: the same tokens the Typst templates expose (page_setup_template.typ, tags/mcq.typ,
 * tags/cq.typ), with the Typst values as defaults. Saved in this browser. */
(function (root) {
  "use strict";

  const DEFAULTS = {
    page: {
      enabled: false,                                   // off = keep the Word file's own page setup
      width: 8.5, height: 10.6,                       // in
      top: 0.68, bottom: 0.68, left: 0.58, right: 0.58, // in
      headerTop: 0.38,                                 // in, page edge to header
      footerBottom: 0.3,                               // in, page edge to footer
    },
    header: {
      enabled: false, mirror: true,                    // off = keep the Word file's own header
      label: "",                 // blank = the Word file's own header text per chapter
      font: "Kalpurush", fontSize: 10, color: "#000000",
      logo: "", logoHeight: 0.2,  // "" = 10 Minute School mark
      rule: 0.5, ruleColor: "#000000",
    },
    footer: {
      enabled: false, mirror: true,                    // off = keep the Word file's own footer
      font: "Kalpurush", fontSize: 10, color: "#000000",
      banglaDigits: true,
      logo: "", logoHeight: 0.28,
      rule: 0.5, ruleColor: "#000000",
    },
    mcq: {
      columns: 2, gutter: 4,
      fontSize: 9, hangingEm: 1.8,
      questionColor: "#000000", optionColor: "#000000",
      sourceRight: true, sourceSize: 7, sourceItalic: true, sourceColor: "#000000",
      circleEm: 1.45, circleStroke: 0.7, circleColor: "#000000", circleTextSize: 8, circleTextColor: "#000000",
      answerEm: 1.6, answerFill: "#000000", answerTextSize: 11, answerTextColor: "#FFFFFF",
      rowGapEm: 0.8, ansGapEm: 0.5, stackAfter: 20,
      keepTogether: true,
    },
    cq: {
      columns: 2, gutter: 4,
      fontSize: 10, subIndent: 0.4,
      textColor: "#000000", subColor: "#000000",
      keepHeaders: true,
    },
  };

  // UI description: [key, label, type, extra]; `typst` names the template token it mirrors
  const SCHEMA = [
    { id: "page", title: "Page setup", file: "page_setup_template.typ", hint: "Page size and margins. Turn this off to keep the Word file's own page setup.", fields: [
      ["enabled", "Use the Typst page size and margins (off = keep the Word file's)", "toggle"],
      ["width", "Page width", "num", { unit: "in", step: 0.05, min: 4, max: 17, typst: "width" }],
      ["height", "Page height", "num", { unit: "in", step: 0.05, min: 4, max: 17, typst: "height" }],
      ["top", "Top margin", "num", { unit: "in", step: 0.01, min: 0, max: 3, typst: "margin.top" }],
      ["bottom", "Bottom margin", "num", { unit: "in", step: 0.01, min: 0, max: 3, typst: "margin.bottom" }],
      ["left", "Left margin", "num", { unit: "in", step: 0.01, min: 0, max: 3, typst: "margin.left" }],
      ["right", "Right margin", "num", { unit: "in", step: 0.01, min: 0, max: 3, typst: "margin.right" }],
      ["headerTop", "Header from top", "num", { unit: "in", step: 0.01, min: 0, max: 2, typst: "header-ascent" }],
      ["footerBottom", "Footer from bottom", "num", { unit: "in", step: 0.01, min: 0, max: 2, typst: "footer-descent" }],
    ] },
    { id: "header", title: "Header", file: "page_setup_template.typ", hint: "Odd pages: logo left and chapter right. Even pages are mirrored. A rule runs underneath.", fields: [
      ["enabled", "Use the Typst header (off = keep the Word file's)", "toggle"],
      ["mirror", "Mirror on even pages", "toggle"],
      ["label", "Header text", "text", { placeholder: "Blank = read from each chapter's Word header", typst: "chapter-header" }],
      ["font", "Font", "text", { placeholder: "Kalpurush", typst: "base-font" }],
      ["fontSize", "Text size", "num", { unit: "pt", step: 0.5, min: 5, max: 20 }],
      ["color", "Text colour", "color"],
      ["logo", "Logo", "image"],
      ["logoHeight", "Logo height", "num", { unit: "in", step: 0.01, min: 0.05, max: 1 }],
      ["rule", "Rule thickness", "num", { unit: "pt", step: 0.25, min: 0, max: 3 }],
      ["ruleColor", "Rule colour", "color"],
    ] },
    { id: "footer", title: "Footer", file: "page_setup_template.typ", hint: "Odd pages: logo left and page number right. Even pages are mirrored. A rule runs above.", fields: [
      ["enabled", "Use the Typst footer (off = keep the Word file's)", "toggle"],
      ["mirror", "Mirror on even pages", "toggle"],
      ["banglaDigits", "Bangla page numbers (১২৩)", "toggle", { typst: "to-bangla-number" }],
      ["font", "Font", "text", { placeholder: "Kalpurush", typst: "footer-font" }],
      ["fontSize", "Text size", "num", { unit: "pt", step: 0.5, min: 5, max: 20, typst: "footer-size" }],
      ["color", "Text colour", "color"],
      ["logo", "Logo", "image", { typst: "footer-image" }],
      ["logoHeight", "Logo height", "num", { unit: "in", step: 0.01, min: 0.05, max: 1, typst: "footer-image-height" }],
      ["rule", "Rule thickness", "num", { unit: "pt", step: 0.25, min: 0, max: 3 }],
      ["ruleColor", "Rule colour", "color"],
    ] },
    { id: "mcq", title: "MCQ", file: "tags/mcq.typ", hint: "How multiple-choice parts are set.", fields: [
      ["columns", "Columns", "num", { step: 1, min: 1, max: 3 }],
      ["gutter", "Column gap", "num", { unit: "% of width", step: 0.5, min: 0, max: 15 }],
      ["fontSize", "Text size", "num", { unit: "pt", step: 0.5, min: 6, max: 16 }],
      ["hangingEm", "Question hanging indent", "num", { unit: "em", step: 0.1, min: 0, max: 5, typst: "question-hanging-indent" }],
      ["questionColor", "Question colour", "color"],
      ["optionColor", "Option text colour", "color"],
      ["stackAfter", "One option per row when an option is longer than", "num", { unit: "letters", step: 1, min: 1, max: 200 }],
      ["rowGapEm", "Gap between option rows", "num", { unit: "em", step: 0.1, min: 0, max: 3, typst: "mcq-row-gutter" }],
      ["circleEm", "Option circle size", "num", { unit: "em", step: 0.05, min: 0.8, max: 3, typst: "opt-circle-size" }],
      ["circleStroke", "Option circle line", "num", { unit: "pt", step: 0.1, min: 0.1, max: 3, typst: "circle-stroke" }],
      ["circleColor", "Option circle colour", "color"],
      ["circleTextSize", "Letter size in option circle", "num", { unit: "pt", step: 0.5, min: 4, max: 16, typst: "circle-text-size" }],
      ["circleTextColor", "Letter colour in option circle", "color"],
      ["answerEm", "Answer circle size", "num", { unit: "em", step: 0.05, min: 0.8, max: 3, typst: "ans-circle-size" }],
      ["answerFill", "Answer circle fill", "color"],
      ["answerTextSize", "Letter size in answer circle", "num", { unit: "pt", step: 0.5, min: 4, max: 18, typst: "ans-text-size" }],
      ["answerTextColor", "Letter colour in answer circle", "color"],
      ["ansGapEm", "Gap after answer circle", "num", { unit: "em", step: 0.1, min: 0, max: 3 }],
      ["sourceRight", "Push board references to the right", "toggle", { typst: "source-align" }],
      ["sourceSize", "Board reference size", "num", { unit: "pt", step: 0.5, min: 4, max: 14, typst: "source-size" }],
      ["sourceItalic", "Board reference in italics", "toggle"],
      ["sourceColor", "Board reference colour", "color"],
      ["keepTogether", "Keep each question with its options", "toggle"],
    ] },
    { id: "cq", title: "CQ", file: "tags/cq.typ", hint: "How creative-question parts are set.", fields: [
      ["columns", "Columns", "num", { step: 1, min: 1, max: 3 }],
      ["gutter", "Column gap", "num", { unit: "% of width", step: 0.5, min: 0, max: 15 }],
      ["fontSize", "Text size", "num", { unit: "pt", step: 0.5, min: 6, max: 16 }],
      ["subIndent", "(ক)–(ঘ) sub-question indent", "num", { unit: "in", step: 0.05, min: 0, max: 2, typst: "cq-indent" }],
      ["textColor", "Text colour", "color"],
      ["subColor", "Sub-question colour", "color"],
      ["keepHeaders", "Keep answer headers with the next line", "toggle"],
    ] },
  ];

  const KEY = "mcq-cq-styler.settings.v2";
  const OLD_KEY = "mcq-cq-styler.settings.v1"; // v1 switched the Typst page setup on by default
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function merge(base, over) {
    const out = clone(base);
    for (const g of Object.keys(out)) if (over && over[g]) for (const k of Object.keys(out[g])) if (over[g][k] !== undefined) out[g][k] = over[g][k];
    return out;
  }
  function load() {
    try {
      let saved = localStorage.getItem(KEY);
      if (!saved && localStorage.getItem(OLD_KEY)) {
        // keep the old choices, but page setup / header / footer go back to "keep the Word file's own"
        const old = JSON.parse(localStorage.getItem(OLD_KEY));
        for (const g of ["page", "header", "footer"]) if (old[g]) old[g].enabled = false;
        saved = JSON.stringify(old);
        localStorage.setItem(KEY, saved);
        localStorage.removeItem(OLD_KEY);
      }
      return merge(DEFAULTS, JSON.parse(saved || "{}"));
    } catch (e) { return clone(DEFAULTS); }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  root.Settings = { DEFAULTS, SCHEMA, load, save, merge, clone };
})(typeof globalThis !== "undefined" ? globalThis : this);
