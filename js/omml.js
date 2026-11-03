/* Word equations (OMML) -> LaTeX for KaTeX. Taken from the MCQ scraper (parser.js). */
(function (root) {
  "use strict";

  const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

  const kids = (el) => Array.from(el.children || []);
  const local = (el) => el.localName || "";
  function kid(el, name, ns) {
    if (!el) return null;
    for (const c of kids(el)) if (c.localName === name && c.namespaceURI === (ns || M)) return c;
    return null;
  }
  function mval(el, dflt) {
    if (!el) return dflt;
    const v = el.getAttributeNS(M, "val");
    return v === null || v === undefined ? dflt : v;
  }
  function descendants(el) { return Array.from(el.getElementsByTagName("*")); }

  // ---------- Word equations (OMML) -> KaTeX ----------
  const GREEK = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ϵ": "epsilon",
    "ζ": "zeta", "η": "eta", "θ": "theta", "ϑ": "vartheta", "ι": "iota", "κ": "kappa",
    "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho", "σ": "sigma",
    "ς": "varsigma", "τ": "tau", "υ": "upsilon", "φ": "phi", "ϕ": "varphi", "χ": "chi",
    "ψ": "psi", "ω": "omega", "Γ": "Gamma", "Δ": "Delta", "∆": "Delta", "Θ": "Theta",
    "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma", "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
  };
  const SYMBOLS = {
    "×": "\\times", "÷": "\\div", "±": "\\pm", "∓": "\\mp", "·": "\\cdot", "⋅": "\\cdot",
    "∗": "\\ast", "∘": "\\circ", "∙": "\\bullet", "≤": "\\leq", "≥": "\\geq", "≠": "\\neq",
    "≈": "\\approx", "∼": "\\sim", "≅": "\\cong", "≡": "\\equiv", "∝": "\\propto",
    "≪": "\\ll", "≫": "\\gg", "→": "\\rightarrow", "←": "\\leftarrow", "↔": "\\leftrightarrow",
    "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "⟶": "\\longrightarrow",
    "⟵": "\\longleftarrow", "⇌": "\\rightleftharpoons", "↑": "\\uparrow", "↓": "\\downarrow",
    "↦": "\\mapsto", "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "∅": "\\emptyset",
    "∀": "\\forall", "∃": "\\exists", "∈": "\\in", "∉": "\\notin", "⊂": "\\subset",
    "⊃": "\\supset", "⊆": "\\subseteq", "⊇": "\\supseteq", "∩": "\\cap", "∪": "\\cup",
    "∧": "\\land", "∨": "\\lor", "¬": "\\neg", "∠": "\\angle", "△": "\\triangle",
    "°": "^{\\circ}", "′": "'", "″": "''", "−": "-", "–": "-", "—": "-", "∑": "\\sum",
    "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint",
    "⋃": "\\bigcup", "⋂": "\\bigcap", "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots",
    "⋱": "\\ddots", "∴": "\\therefore", "∵": "\\because", "⊥": "\\perp", "∥": "\\parallel",
    "⊕": "\\oplus", "⊗": "\\otimes", "ℏ": "\\hbar", "ℓ": "\\ell", "ℝ": "\\mathbb{R}",
    "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}",
    "⟨": "\\langle", "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil",
    "⌉": "\\rceil", "‖": "\\|", "∣": "|", " ": "\\ ", " ": "\\,", " ": "\\ ",
    "%": "\\%", "#": "\\#", "$": "\\$", "{": "\\{", "}": "\\}", "_": "\\_",
    "~": "\\sim", "^": "\\hat{}", "\\": "\\backslash ",
  };
  const SUB_CHARS = {};
  [..."₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎"].forEach((c, i) => (SUB_CHARS[c] = "0123456789+-=()"[i]));
  const SUP_CHARS = {};
  [..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ"].forEach((c, i) => (SUP_CHARS[c] = "0123456789+-=()ni"[i]));
  const ACCENTS = {
    "̂": "hat", "^": "hat", "̃": "tilde", "~": "tilde", "̄": "bar",
    "¯": "bar", "̅": "bar", "⃗": "vec", "→": "vec", "̇": "dot",
    "˙": "dot", "̈": "ddot", "¨": "ddot", "̌": "check", "ˇ": "check",
    "́": "acute", "´": "acute", "̀": "grave", "`": "grave", "̆": "breve",
  };
  const NARY = {
    "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint",
    "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap", "⨁": "\\bigoplus",
  };
  const ARROWS = new Set(["→", "⟶", "⟵", "←", "↔", "⇌", "⇒", "⇐", "⇔"]);
  const XARROW = {
    "→": "xrightarrow", "⟶": "xrightarrow", "←": "xleftarrow", "⟵": "xleftarrow",
    "↔": "xleftrightarrow", "⇒": "xRightarrow", "⇐": "xLeftarrow", "⇔": "xLeftrightarrow",
    "⇌": "rightleftharpoons",
  };
  const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim",
    "max", "min", "sup", "inf", "det", "gcd", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh"]);
  const DELIMS = {
    "": ".", "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|",
    "‖": "\\|", "⟨": "\\langle", "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor",
    "⌈": "\\lceil", "⌉": "\\rceil", "〈": "\\langle", "〉": "\\rangle",
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // join LaTeX pieces, adding a space where a control word meets a letter
  function cat(...parts) {
    let out = "";
    for (const p of parts) {
      if (!p) continue;
      if (out && /\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(p)) out += " ";
      out += p;
    }
    return out;
  }
  function balanced(t) {
    let d = 0;
    for (const c of t) {
      d += (c === "{") - (c === "}");
      if (d < 0) return false;
    }
    return d === 0;
  }
  // wrap in braces unless already a single token
  function group(tex) {
    if (/^(\\[A-Za-z]+|[^\\{}])$/.test(tex) || (tex.startsWith("{") && tex.endsWith("}") && balanced(tex.slice(1, -1)))) {
      return tex ? tex : "{}";
    }
    return tex ? "{" + tex + "}" : "{}";
  }
  function charTex(ch) {
    if (has(GREEK, ch)) return "\\" + GREEK[ch];
    if (has(SUB_CHARS, ch)) return "_{" + SUB_CHARS[ch] + "}";
    if (has(SUP_CHARS, ch)) return "^{" + SUP_CHARS[ch] + "}";
    return has(SYMBOLS, ch) ? SYMBOLS[ch] : ch;
  }

  function runMath(r, inEqArr) {
    const pr = kid(r, "rPr");
    let sty = null, nor = false;
    if (pr) {
      const s = kid(pr, "sty");
      sty = s ? mval(s, null) : null;
      const n = kid(pr, "nor");
      nor = !!n && !["0", "false"].includes(mval(n, "1"));
    }
    const text = kids(r).filter((c) => c.localName === "t" && c.namespaceURI === M).map((c) => c.textContent).join("");
    if (!text.trim()) return text && !nor ? "\\ " : "";
    if (nor) return "\\text{" + text.replace(/[\\{}$^~]/g, "").replace(/[%&#_]/g, "\\$&") + "}";
    let body = "";
    for (const ch of text) {
      if (ch === " " || ch === "\t") continue;
      if (ch === "&" && inEqArr) body += "&";
      else if (ch === "&") body += "\\&";
      else body = cat(body, charTex(ch));
    }
    if (FUNCS.has(text) && sty !== "i") return "\\" + text;
    const simple = /^[A-Za-z0-9.]+$/.test(body);
    if (sty === "p") return simple ? "\\mathrm{" + body + "}" : body;
    return body; // bold / bold-italic are not marked up: plain letters are enough
  }

  function kidTex(el, name, eq) { const k = kid(el, name); return k ? tex(k, eq) : ""; }
  function chrOf(el, prop, dflt) {
    const pr = kid(el, prop);
    if (!pr) return dflt;
    const c = kid(pr, "chr");
    return c ? mval(c, null) : dflt;
  }
  function flag(pr, name) {
    if (!pr) return false;
    const f = kid(pr, name);
    return !!f && !["0", "false"].includes(mval(f, "1"));
  }
  const allText = (el) => (el ? descendants(el).filter((t) => t.localName === "t" && t.namespaceURI === M).map((t) => t.textContent).join("").trim() : "");

  function tex(el, eq) {
    const tag = local(el);
    if (tag === "r" && el.namespaceURI === M) return runMath(el, eq);
    if (tag === "sSub") return cat(group(kidTex(el, "e", eq)), "_{" + kidTex(el, "sub", eq) + "}");
    if (tag === "sSup") return cat(group(kidTex(el, "e", eq)), "^{" + kidTex(el, "sup", eq) + "}");
    if (tag === "sSubSup") {
      return cat(group(kidTex(el, "e", eq)), "_{" + kidTex(el, "sub", eq) + "}^{" + kidTex(el, "sup", eq) + "}");
    }
    if (tag === "sPre") {
      return cat("{}_{" + kidTex(el, "sub", eq) + "}^{" + kidTex(el, "sup", eq) + "}", group(kidTex(el, "e", eq)));
    }
    if (tag === "f") {
      const num = kidTex(el, "num", eq), den = kidTex(el, "den", eq);
      const t = kid(kid(el, "fPr"), "type");
      const ftype = t ? mval(t, "bar") : "bar";
      if (ftype === "noBar") return "\\binom{" + num + "}{" + den + "}";
      if (ftype === "lin") return cat(group(num), "/", group(den));
      return "\\frac{" + num + "}{" + den + "}";
    }
    if (tag === "rad") {
      const e = kidTex(el, "e", eq);
      const hide = flag(kid(el, "radPr"), "degHide");
      const deg = kidTex(el, "deg", eq);
      return hide || !deg ? "\\sqrt{" + e + "}" : "\\sqrt[" + deg + "]{" + e + "}";
    }
    if (tag === "d") {
      const pr = kid(el, "dPr");
      const pick = (name, dflt) => { const c = pr ? kid(pr, name) : null; return c ? mval(c, "") : dflt; };
      const beg = pick("begChr", "("), end = pick("endChr", ")"), sep = pick("sepChr", "|");
      const items = kids(el).filter((c) => c.localName === "e" && c.namespaceURI === M).map((e) => tex(e, eq));
      const dl = (c) => (has(DELIMS, c) ? DELIMS[c] : c);
      const inner = items.join(" " + dl(sep) + " ");
      return "\\left" + dl(beg) + " " + inner + " \\right" + dl(end);
    }
    if (tag === "nary") {
      const pr = kid(el, "naryPr");
      const c = chrOf(el, "naryPr", "∫");
      const op = has(NARY, c) ? NARY[c] : (c === "" || c === null ? "\\int" : charTex(c));
      const sub = kidTex(el, "sub", eq), sup = kidTex(el, "sup", eq);
      const ll = pr ? kid(pr, "limLoc") : null;
      const und = !!ll && mval(ll, null) === "undOvr";
      let out = op;
      if (und) out += "\\limits";
      if (sub && !flag(pr, "subHide")) out += "_{" + sub + "}";
      if (sup && !flag(pr, "supHide")) out += "^{" + sup + "}";
      return cat(out, kidTex(el, "e", eq));
    }
    if (tag === "func") {
      const fn = kid(el, "fName");
      const raw = allText(fn);
      const simple = !!fn && !kid(fn, "limLow") && !kid(fn, "limUpp");
      let name;
      if (simple && FUNCS.has(raw)) name = "\\" + raw;
      else if (simple && /^\p{L}+$/u.test(raw)) name = "\\operatorname{" + raw + "}";
      else name = kidTex(el, "fName", eq);
      return cat(name, kidTex(el, "e", eq));
    }
    if (tag === "acc") {
      const c = chrOf(el, "accPr", "̂");
      const cmd = has(ACCENTS, c) ? ACCENTS[c] : "hat";
      return "\\" + cmd + "{" + kidTex(el, "e", eq) + "}";
    }
    if (tag === "bar") {
      const p = kid(kid(el, "barPr"), "pos");
      const pos = p ? mval(p, "top") : "top";
      return (pos === "bot" ? "\\underline{" : "\\overline{") + kidTex(el, "e", eq) + "}";
    }
    if (tag === "borderBox") return "\\boxed{" + kidTex(el, "e", eq) + "}";
    if (tag === "groupChr") {
      const c = chrOf(el, "groupChrPr", "⏟");
      const p = kid(kid(el, "groupChrPr"), "pos");
      const pos = p ? mval(p, "bot") : "bot";
      const e = kidTex(el, "e", eq);
      if (ARROWS.has(c)) return allText(kid(el, "e")) ? "\\" + (pos === "top" ? "overset" : "underset") + "{" + charTex(c) + "}{" + e + "}" : charTex(c);
      return c === "⏞" || c === "︷" || pos === "top" ? "\\overbrace{" + e + "}" : "\\underbrace{" + e + "}";
    }
    if (tag === "limLow" || tag === "limUpp") {
      const eEl = kid(el, "e");
      let base = allText(eEl);
      const gc = kid(eEl, "groupChr"); // Word draws a reaction arrow as an arrow-character group over blanks
      if (gc && !base && ARROWS.has(chrOf(gc, "groupChrPr", ""))) base = chrOf(gc, "groupChrPr", "");
      const lim = kidTex(el, "lim", eq);
      const e = eEl ? tex(eEl, eq) : "";
      if (ARROWS.has(base)) {
        const cmd = XARROW[base];
        if (cmd === "rightleftharpoons") {
          return tag === "limUpp" ? "\\overset{" + lim + "}{\\rightleftharpoons}" : "\\underset{" + lim + "}{\\rightleftharpoons}";
        }
        return tag === "limUpp" ? "\\" + cmd + "{" + lim + "}" : "\\" + cmd + "[" + lim + "]{}";
      }
      if (FUNCS.has(base)) return "\\" + base + (tag === "limLow" ? "_{" + lim + "}" : "^{" + lim + "}");
      return tag === "limLow" ? "\\underset{" + lim + "}{" + e + "}" : "\\overset{" + lim + "}{" + e + "}";
    }
    if (tag === "m") {
      const rows = kids(el).filter((c) => c.localName === "mr").map((mr) =>
        kids(mr).filter((c) => c.localName === "e").map((e) => tex(e, eq)).join(" & "));
      return "\\begin{matrix} " + rows.join(" \\\\ ") + " \\end{matrix}";
    }
    if (tag === "eqArr") {
      const rows = kids(el).filter((c) => c.localName === "e").map((e) => tex(e, true));
      return "\\begin{aligned} " + rows.join(" \\\\ ") + " \\end{aligned}";
    }
    if (tag === "phant") {
      const show = kid(kid(el, "phantPr"), "show");
      const e = kidTex(el, "e", eq);
      return show && ["0", "false"].includes(mval(show, null)) ? "\\phantom{" + e + "}" : e;
    }
    // containers (oMath, e, num, den, sub, sup, lim, deg ...) and unknown elements
    let out = "";
    for (const k of kids(el)) {
      const n = local(k);
      if (n.endsWith("Pr") || n === "ctrlPr") continue;
      out = cat(out, tex(k, eq));
    }
    return out;
  }

  // "10¹²" arrives one script character at a time: 10^{1}^{2} -> 10^{12}
  function joinScripts(s) {
    let prev;
    do {
      prev = s;
      s = s.replace(/\^\{([^{}]*)\}\^\{([^{}]*)\}/g, "^{$1$2}").replace(/_\{([^{}]*)\}_\{([^{}]*)\}/g, "_{$1$2}");
    } while (s !== prev);
    return s;
  }

  root.OMML = { tex: (el, eq) => joinScripts(tex(el, eq)) };
})(typeof globalThis !== "undefined" ? globalThis : this);
