/* Word equations (OMML) -> Typst math. The output is built so it always parses: commas, semicolons,
 * brackets and any character Typst math does not know are written as escapes or quoted text. */
(function (root) {
  "use strict";

  const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const kids = (el) => Array.from((el && el.children) || []);
  const kid = (el, name) => kids(el).find((c) => c.localName === name && c.namespaceURI === M) || null;
  const mval = (el, d) => { if (!el) return d; const v = el.getAttributeNS(M, "val"); return v == null ? d : v; };
  const flag = (pr, name) => { const f = kid(pr, name); return !!f && !["0", "false", "off"].includes(mval(f, "1")); };
  const quote = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

  const GREEK = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon.alt", "ϵ": "epsilon", "ζ": "zeta", "η": "eta",
    "θ": "theta", "ϑ": "theta.alt", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi",
    "π": "pi", "ρ": "rho", "σ": "sigma", "ς": "sigma.alt", "τ": "tau", "υ": "upsilon", "φ": "phi.alt", "ϕ": "phi",
    "χ": "chi", "ψ": "psi", "ω": "omega", "Γ": "Gamma", "Δ": "Delta", "∆": "Delta", "Θ": "Theta", "Λ": "Lambda",
    "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma", "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
  };
  const SYM = {
    "+": "+", "−": "-", "-": "-", "=": "=", "<": "<", ">": ">", "×": "times", "÷": "div", "±": "plus.minus",
    "∓": "minus.plus", "·": "dot.op", "⋅": "dot.op", "∙": "dot.op", "∗": "ast", "*": "ast", "∘": "compose",
    "≤": "lt.eq", "≥": "gt.eq", "≠": "eq.not", "≈": "approx", "∼": "tilde.op", "~": "tilde.op", "≅": "tilde.equiv",
    "≡": "equiv", "∝": "prop", "≪": "lt.double", "≫": "gt.double", "→": "arrow.r", "←": "arrow.l",
    "↔": "arrow.l.r", "⇒": "arrow.r.double", "⇐": "arrow.l.double", "⇔": "arrow.l.r.double", "⟶": "arrow.r.long",
    "⟵": "arrow.l.long", "⇌": "harpoons.rtlb", "↑": "arrow.t", "↓": "arrow.b", "↦": "arrow.r.bar",
    "∞": "infinity", "∂": "diff", "∇": "nabla", "∅": "emptyset", "∀": "forall", "∃": "exists", "∈": "in",
    "∉": "in.not", "⊂": "subset", "⊃": "supset", "⊆": "subset.eq", "⊇": "supset.eq", "∩": "sect", "∪": "union",
    "∧": "and", "∨": "or", "¬": "not", "∠": "angle", "△": "triangle.stroked.t", "°": "degree", "′": "prime",
    "″": "prime.double", "…": "dots.h", "⋯": "dots.h.c", "⋮": "dots.v", "⋱": "dots.down", "∴": "therefore",
    "∵": "because", "⊥": "perp", "∥": "parallel", "⊕": "plus.circle", "⊗": "times.circle", "ℏ": "ℏ",
    "ℓ": "ell", "ℝ": "RR", "ℕ": "NN", "ℤ": "ZZ", "ℚ": "QQ", "ℂ": "CC", "!": "!", "|": "bar.v", "‖": "bar.v.double",
    "%": "percent", "'": "prime", ":": "colon", "?": quote("?"), "#": quote("#"), "&": quote("&"),
  };
  const NARY = { "∑": "sum", "∏": "product", "∫": "integral", "∬": "integral.double", "∭": "integral.triple", "∮": "integral.cont", "⋃": "union.big", "⋂": "sect.big", "⨁": "plus.circle.big" };
  const ACC = { "̂": "hat", "^": "hat", "̃": "tilde", "~": "tilde", "̄": "macron", "¯": "macron", "̅": "overline", "⃗": "arrow", "→": "arrow", "̇": "dot", "˙": "dot", "̈": "dot.double", "¨": "dot.double", "̌": "caron", "ˇ": "caron", "́": "acute", "´": "acute", "̀": "grave", "`": "grave", "̆": "breve" };
  const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "mod"]);
  const ARROWS = { "→": "arrow.r", "⟶": "arrow.r.long", "←": "arrow.l", "⟵": "arrow.l.long", "↔": "arrow.l.r", "⇒": "arrow.r.double", "⇐": "arrow.l.double", "⇔": "arrow.l.r.double", "⇌": "harpoons.rtlb" };
  // letters and marks of scripts Typst math has no names for (Bangla, Devanagari …), plus ZWJ / ZWNJ
  const WORD = /[ऀ-෿‌‍]/;
  const SUBS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", SUBS_TO = "0123456789+-=()";
  const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ", SUPS_TO = "0123456789+-=()ni";

  // one character of a math run
  function ch(c) {
    if (/[0-9.]/.test(c)) return c;
    if (/[A-Za-z]/.test(c)) return c;
    if (GREEK[c]) return GREEK[c];
    if (SYM[c]) return SYM[c];
    if (c === "(" || c === ")" || c === "[" || c === "]" || c === "{" || c === "}") return "\\" + c;
    if (c === "," || c === ";") return quote(c);
    if (c === "/") return "slash";
    if (c === "\\") return "backslash";
    return quote(c); // Bangla and anything else: upright text
  }

  // a run of characters: digits stay together, letters are separate variables, scripts merge
  function runText(text, upright) {
    if (!text.trim()) return "";
    if (upright) return quote(text);
    const out = [];
    let i = 0;
    const chars = [...text];
    while (i < chars.length) {
      const c = chars[i];
      if (c === " " || c === "\t") { i++; continue; }
      if (SUBS.includes(c) || SUPS.includes(c)) {
        const set = SUBS.includes(c) ? SUBS : SUPS, to = SUBS.includes(c) ? SUBS_TO : SUPS_TO;
        let s = "";
        while (i < chars.length && set.includes(chars[i])) { s += to[set.indexOf(chars[i])]; i++; }
        const prev = out.length ? out.pop() : '""';
        out.push(`${prev}${set === SUBS ? "_" : "^"}(${[...s].map(ch).join(" ")})`);
        continue;
      }
      if (/[0-9]/.test(c)) { let s = ""; while (i < chars.length && /[0-9.]/.test(chars[i])) s += chars[i++]; out.push(s); continue; }
      // Bangla (and other script) words stay one quoted string with their spaces, so conjuncts and vowel
      // signs shape together instead of coming out letter by letter
      if (WORD.test(c)) {
        let j = i;
        while (j < chars.length && (WORD.test(chars[j]) || (chars[j] === " " && WORD.test(chars[j + 1] || "")))) j++;
        out.push(quote(chars.slice(i, j).join("")));
        i = j;
        continue;
      }
      out.push(ch(c));
      i++;
    }
    const word = text.trim();
    if (FUNCS.has(word)) return word;
    return out.join(" ");
  }

  function run(r) {
    const pr = kid(r, "rPr");
    const nor = !!pr && flag(pr, "nor");
    const sty = pr && kid(pr, "sty") ? mval(kid(pr, "sty"), "") : "";
    const text = kids(r).filter((c) => c.localName === "t").map((c) => c.textContent).join("");
    if (!text.trim()) return "";
    if (nor) return quote(text);
    if (sty === "p" && /^[A-Za-z]{2,}$/.test(text.trim()) && !FUNCS.has(text.trim())) return `upright(${quote(text.trim())})`;
    return runText(text, false);
  }

  const g = (s) => (s && s.trim() ? s : '""');
  const sub = (el, name) => { const k = kid(el, name); return k ? conv(k) : ""; };
  const chrOf = (el, prop, d) => { const pr = kid(el, prop); const c = pr && kid(pr, "chr"); return c ? mval(c, d) : d; };

  function conv(el) {
    const t = el.localName;
    if (t === "r") return run(el);
    if (t === "sSub") return `${g(sub(el, "e"))}_(${g(sub(el, "sub"))})`;
    if (t === "sSup") return `${g(sub(el, "e"))}^(${g(sub(el, "sup"))})`;
    if (t === "sSubSup") return `${g(sub(el, "e"))}_(${g(sub(el, "sub"))})^(${g(sub(el, "sup"))})`;
    if (t === "sPre") return `attach(${g(sub(el, "e"))}, tl: ${g(sub(el, "sup"))}, bl: ${g(sub(el, "sub"))})`;
    if (t === "f") {
      const type = mval(kid(kid(el, "fPr"), "type"), "bar");
      fracDepth++;
      const n = g(sub(el, "num")), d = g(sub(el, "den"));
      fracDepth--;
      if (type === "noBar") return `binom(${n}, ${d})`;
      if (type === "lin") return `(${n}) slash (${d})`;
      // Word (smallFrac off) keeps a fraction inside a display fraction full size; Typst would shrink it
      return fullNested && fracDepth > 0 ? `display(frac(${n}, ${d}))` : `frac(${n}, ${d})`;
    }
    if (t === "rad") {
      const deg = sub(el, "deg");
      return flag(kid(el, "radPr"), "degHide") || !deg.trim() ? `sqrt(${g(sub(el, "e"))})` : `root(${deg}, ${g(sub(el, "e"))})`;
    }
    if (t === "d") {
      const pr = kid(el, "dPr");
      const pick = (n, d) => { const c = pr && kid(pr, n); return c ? mval(c, "") : d; };
      const beg = pick("begChr", "("), end = pick("endChr", ")"), sep = pick("sepChr", "|");
      const parts = kids(el).filter((c) => c.localName === "e").map((e) => conv(e));
      const inner = parts.join(` ${ch(sep)} `);
      const D = { "(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}", "|": "|", "‖": "‖", "⟨": "⟨", "⟩": "⟩", "〈": "⟨", "〉": "⟩", "⌊": "⌊", "⌋": "⌋", "⌈": "⌈", "⌉": "⌉", "": "" };
      const b = D[beg] !== undefined ? D[beg] : "", e = D[end] !== undefined ? D[end] : "";
      if (b === "|" && e === "|") return `abs(${g(inner)})`;
      if (b === "‖" && e === "‖") return `norm(${g(inner)})`;
      if (b === "(" && e === ")") return `(${inner})`;
      if (b === "[" && e === "]") return `[${inner}]`;
      if (b === "{" && e === "}") return `{${inner}}`;
      return `lr(${b ? quote(b) : '""'} ${inner} ${e ? quote(e) : '""'})`.replace(/^lr\(""/, 'lr(""');
    }
    if (t === "nary") {
      const pr = kid(el, "naryPr");
      const c = chrOf(el, "naryPr", "∫");
      let op = NARY[c] || (c ? ch(c) : "integral");
      const lo = sub(el, "sub"), hi = sub(el, "sup");
      if (mval(kid(pr, "limLoc"), "") === "undOvr" && /^(integral)/.test(op)) op = `limits(${op})`;
      let s = op;
      if (lo.trim() && !flag(pr, "subHide")) s += `_(${lo})`;
      if (hi.trim() && !flag(pr, "supHide")) s += `^(${hi})`;
      return `${s} ${sub(el, "e")}`;
    }
    if (t === "func") {
      const fn = kid(el, "fName");
      const raw = fn ? Array.from(fn.getElementsByTagNameNS(M, "t")).map((x) => x.textContent).join("").trim() : "";
      const simple = fn && !kid(fn, "limLow") && !kid(fn, "limUpp");
      const name = simple && FUNCS.has(raw) ? raw : simple && /^[A-Za-z]+$/.test(raw) ? `op(${quote(raw)})` : g(sub(el, "fName"));
      return `${name} ${sub(el, "e")}`;
    }
    if (t === "acc") return `${ACC[chrOf(el, "accPr", "̂")] || "hat"}(${g(sub(el, "e"))})`;
    if (t === "bar") return `${mval(kid(kid(el, "barPr"), "pos"), "top") === "bot" ? "underline" : "overline"}(${g(sub(el, "e"))})`;
    if (t === "borderBox" || t === "box" || t === "phant") return sub(el, "e");
    if (t === "groupChr") {
      const c = chrOf(el, "groupChrPr", "⏟");
      const pos = mval(kid(kid(el, "groupChrPr"), "pos"), "bot");
      const e = sub(el, "e");
      if (ARROWS[c]) return e.trim() ? `limits(${ARROWS[c]})${pos === "top" ? "^" : "_"}(${e})` : ARROWS[c];
      return pos === "top" ? `overbrace(${g(e)})` : `underbrace(${g(e)})`;
    }
    if (t === "limLow" || t === "limUpp") {
      const eEl = kid(el, "e");
      const baseText = eEl ? Array.from(eEl.getElementsByTagNameNS(M, "t")).map((x) => x.textContent).join("").trim() : "";
      const gc = eEl && kid(eEl, "groupChr");
      const arrow = ARROWS[baseText] || (gc && !baseText ? ARROWS[chrOf(gc, "groupChrPr", "")] : null);
      const lim = g(sub(el, "lim"));
      const base = arrow || (FUNCS.has(baseText) ? baseText : g(sub(el, "e")));
      return `limits(${base})${t === "limLow" ? "_" : "^"}(${lim})`;
    }
    if (t === "m") {
      const rows = kids(el).filter((c) => c.localName === "mr").map((mr) => kids(mr).filter((c) => c.localName === "e").map((e) => g(conv(e))).join(", "));
      return `mat(${rows.join("; ")})`;
    }
    if (t === "eqArr") return kids(el).filter((c) => c.localName === "e").map((e) => conv(e).replace(/"&"/g, "&")).join(" \\ ");
    let out = "";
    for (const k of kids(el)) {
      const n = k.localName;
      if (n.endsWith("Pr") || n === "ctrlPr") continue;
      const piece = conv(k);
      if (!piece) continue;
      out += (out && !/\s$/.test(out) ? " " : "") + piece;
    }
    return out;
  }

  let fracDepth = 0, fullNested = false;

  /** <m:oMath> -> Typst math body (without the $ signs). o.display: a display equation */
  function typst(oMath, o) {
    fracDepth = 0;
    fullNested = !!(o && o.display);
    const s = conv(oMath).replace(/\s+/g, " ").trim();
    return s || '""';
  }

  root.OMMLTypst = { typst, quote };
})(typeof globalThis !== "undefined" ? globalThis : this);
