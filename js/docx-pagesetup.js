/* The Typst page setup (page_setup_template.typ) written into a .docx: page size and margins on every
 * section, and new header / footer parts.
 *   header  odd: logo | chapter text      even: chapter text | logo      rule underneath
 *   footer  odd: logo | page number       even: page number | logo       rule above
 * Page numbers can be shown in Bangla digits: Word has no Bangla number format, so each digit is
 * picked by a small IF field ({ IF { = MOD(INT({ PAGE }/10),10) } = 3 "৩" "" } …), which Word
 * works out on every page like any other header field. */
(function (root) {
  "use strict";

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  const BN = "০১২৩৪৫৬৭৮৯";
  const kids = (el) => Array.from((el && el.children) || []);
  const wkid = (el, name) => kids(el).find((c) => c.localName === name && c.namespaceURI === W) || null;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hex = (c) => String(c || "#000000").replace("#", "").toUpperCase();
  const tw = (inch) => Math.round(inch * 1440);

  // ---------- page size and margins ----------
  function geometry(sp, S, h) {
    const p = S.page;
    h.setChild(sp, h.wel("pgSz", { w: tw(p.width), h: tw(p.height) }), h.SPR);
    h.setChild(sp, h.wel("pgMar", {
      top: tw(p.top), right: tw(p.right), bottom: tw(p.bottom), left: tw(p.left),
      header: tw(p.headerTop), footer: tw(p.footerBottom), gutter: 0,
    }), h.SPR);
  }

  // ---------- parts ----------
  async function xmlOf(zip, path) {
    const f = zip.file(path);
    return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
  }
  const ser = (d) => {
    const s = new XMLSerializer().serializeToString(d);
    return s.startsWith("<?xml") ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
  };

  async function logoOf(dataUrl) {
    const m = /^data:(image\/(png|jpeg|jpg|gif));base64,(.*)$/.exec(dataUrl || "");
    if (!m) return null;
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: m[1] }));
    const out = { bytes, ext: m[2] === "jpg" ? "jpeg" : m[2], w: bmp.width, h: bmp.height };
    bmp.close && bmp.close();
    return out;
  }

  const NSDECL = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

  function runProps(font, size, color) {
    const f = esc(font || "Kalpurush");
    const sz = Math.round(size * 2);
    return `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/><w:color w:val="${hex(color)}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  }

  let docPr = 90000;
  function logoRun(logo, heightIn) {
    if (!logo) return "";
    const cy = Math.round(heightIn * 914400), cx = Math.round((cy * logo.w) / logo.h);
    const id = ++docPr;
    return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Logo ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  // one ruled line of the header or footer: left content, a right tab, right content
  function line(left, right, side, rulePt, ruleColor, width, rPr) {
    const border = rulePt > 0 ? `<w:pBdr><w:${side} w:val="single" w:sz="${Math.max(2, Math.round(rulePt * 8))}" w:space="1" w:color="${hex(ruleColor)}"/></w:pBdr>` : "";
    return `<w:p><w:pPr>${border}<w:tabs><w:tab w:val="right" w:pos="${width}"/></w:tabs>` +
      `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/>${rPr}</w:pPr>` +
      `${left}<w:r><w:tab/></w:r>${right}</w:p>`;
  }

  // ---------- page number fields ----------
  function pageNumber(rPr, bangla) {
    const r = (inner) => `<w:r>${rPr}${inner}</w:r>`;
    const field = (parts, result) =>
      r('<w:fldChar w:fldCharType="begin"/>') +
      parts.map((p) => (p.startsWith("<") ? p : r(`<w:instrText xml:space="preserve">${p}</w:instrText>`))).join("") +
      r('<w:fldChar w:fldCharType="separate"/>') + (result ? r(`<w:t xml:space="preserve">${result}</w:t>`) : "") +
      r('<w:fldChar w:fldCharType="end"/>');
    const PAGE = () => field([" PAGE "], "1");
    if (!bangla) return PAGE();
    const digitAt = (place) => field([" = MOD(INT(", PAGE(), ` /${place}),10) `], "1");
    const digit = (place) => Array.from({ length: 10 }, (_, v) =>
      field([" IF ", digitAt(place), ` = ${v} "${BN[v]}" "" `], place === 1 && v === 1 ? BN[1] : "")).join("");
    const onlyIf = (min, inner) => field([" IF ", PAGE(), ` > ${min} "`, inner, '" "" '], "");
    return onlyIf(99, digit(100)) + onlyIf(9, digit(10)) + digit(1);
  }

  // ---------- main ----------
  async function headersFooters({ doc, zip, mainPath, body, S, labelOf, docPrStart }) {
    docPr = docPrStart || 90000;
    const dir = mainPath.slice(0, mainPath.lastIndexOf("/") + 1);
    const relsPath = `${dir}_rels/${mainPath.slice(dir.length)}.rels`;
    const rels = await xmlOf(zip, relsPath);
    const types = await xmlOf(zip, "[Content_Types].xml");
    const sects = Array.from(body.getElementsByTagNameNS(W, "sectPr"));
    if (!rels || !types || !sects.length) return;

    // text width of the first section, for the right-hand tab stop
    const g = (el, a, d) => (el && parseInt(el.getAttributeNS(W, a), 10)) || d;
    const sz = wkid(sects[0], "pgSz"), mar = wkid(sects[0], "pgMar");
    const width = g(sz, "w", 12240) - g(mar, "left", 1440) - g(mar, "right", 1440);

    let relN = 0;
    const relIds = new Set(Array.from(rels.getElementsByTagNameNS(PKG, "Relationship")).map((r) => r.getAttribute("Id")));
    const newRel = (type, target) => {
      let id;
      do id = "rIdTypst" + ++relN; while (relIds.has(id));
      relIds.add(id);
      const r = rels.createElementNS(PKG, "Relationship");
      r.setAttribute("Id", id);
      r.setAttribute("Type", REL + type);
      r.setAttribute("Target", target);
      rels.documentElement.appendChild(r);
      return id;
    };
    const ctRoot = types.documentElement;
    const hasDefault = (ext) => Array.from(types.getElementsByTagNameNS(CT, "Default")).some((d) => d.getAttribute("Extension").toLowerCase() === ext);
    const addDefault = (ext, type) => {
      if (hasDefault(ext)) return;
      const d = types.createElementNS(CT, "Default");
      d.setAttribute("Extension", ext);
      d.setAttribute("ContentType", type);
      ctRoot.insertBefore(d, ctRoot.firstChild);
    };
    const addOverride = (part, type) => {
      const o = types.createElementNS(CT, "Override");
      o.setAttribute("PartName", "/" + dir + part);
      o.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml." + type + "+xml");
      ctRoot.appendChild(o);
    };
    // a header/footer part, with its logo
    let partN = 0;
    const makePart = async (kind, paraXml, logo, logoName) => {
      const name = `typst_${kind}${++partN}.xml`;
      zip.file(dir + name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:${kind} ${NSDECL}>${paraXml}</w:${kind}>`);
      if (logo) {
        zip.file(`${dir}_rels/${name}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="${PKG}">` +
          `<Relationship Id="rIdLogo" Type="${REL}image" Target="media/${logoName}"/></Relationships>`);
      }
      addOverride(name, kind === "hdr" ? "header" : "footer");
      return newRel(kind === "hdr" ? "header" : "footer", name);
    };

    const H = S.header, F = S.footer;
    const refs = new Map(); // sectPr -> { header: {odd, even}, footer: {odd, even} }

    if (H.enabled) {
      const logo = await logoOf(H.logo || (root.ASSETS && root.ASSETS.headerLogo));
      const logoName = logo ? `typst_header_logo.${logo.ext}` : "";
      if (logo) { zip.file(dir + "media/" + logoName, logo.bytes); addDefault(logo.ext, "image/" + logo.ext); }
      const rPr = runProps(H.font, H.fontSize, H.color);
      const byLabel = new Map();
      for (const sp of sects) {
        // ▶ has an emoji form that Word on a Mac draws as a blue icon; ► is always a plain black triangle
        const label = (H.label || labelOf(sp) || "") /* no chapter text in the Word header: logo only */.replace(/[▶▸]️?/g, "►");
        if (!byLabel.has(label)) {
          const text = label ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(label)}</w:t></w:r>` : "";
          const pic = logoRun(logo, H.logoHeight);
          const odd = await makePart("hdr", line(pic, text, "bottom", H.rule, H.ruleColor, width, rPr), logo, logoName);
          const even = H.mirror ? await makePart("hdr", line(text, logoRun(logo, H.logoHeight), "bottom", H.rule, H.ruleColor, width, rPr), logo, logoName) : odd;
          byLabel.set(label, { odd, even });
        }
        refs.set(sp, Object.assign(refs.get(sp) || {}, { header: byLabel.get(label) }));
      }
    }
    if (F.enabled) {
      const logo = await logoOf(F.logo || (root.ASSETS && root.ASSETS.footerLogo));
      const logoName = logo ? `typst_footer_logo.${logo.ext}` : "";
      if (logo) { zip.file(dir + "media/" + logoName, logo.bytes); addDefault(logo.ext, "image/" + logo.ext); }
      const rPr = runProps(F.font, F.fontSize, F.color);
      const num = pageNumber(rPr, F.banglaDigits);
      const odd = await makePart("ftr", line(logoRun(logo, F.logoHeight), num, "top", F.rule, F.ruleColor, width, rPr), logo, logoName);
      const even = F.mirror ? await makePart("ftr", line(num, logoRun(logo, F.logoHeight), "top", F.rule, F.ruleColor, width, rPr), logo, logoName) : odd;
      for (const sp of sects) refs.set(sp, Object.assign(refs.get(sp) || {}, { footer: { odd, even } }));
    }

    // point every section at the new parts (first-page references too, so "different first page"
    // sections get them as well)
    const mirror = (H.enabled && H.mirror) || (F.enabled && F.mirror);
    for (const sp of sects) {
      const r = refs.get(sp) || {};
      for (const [kind, tag] of [["header", "headerReference"], ["footer", "footerReference"]]) {
        if (!r[kind]) {
          // not replaced: make sure even pages still have one once odd/even headers are switched on
          if (mirror) {
            const own = kids(sp).filter((c) => c.localName === tag);
            const def = own.find((c) => c.getAttributeNS(W, "type") === "default");
            if (def && !own.some((c) => c.getAttributeNS(W, "type") === "even")) {
              const e = def.cloneNode(true);
              e.setAttributeNS(W, "w:type", "even");
              sp.insertBefore(e, def.nextSibling);
            }
          }
          continue;
        }
        for (const c of kids(sp)) if (c.localName === tag) sp.removeChild(c);
        const anchor = tag === "headerReference" ? sp.firstChild : kids(sp).find((c) => c.localName !== "headerReference") || null;
        for (const [type, id] of [["default", r[kind].odd], ["even", r[kind].even], ["first", r[kind].odd]]) {
          const e = doc.createElementNS(W, "w:" + tag);
          e.setAttributeNS(W, "w:type", type);
          e.setAttributeNS(R, "r:id", id);
          sp.insertBefore(e, anchor);
        }
      }
    }

    // odd/even headers switch (settings.xml)
    const settingsRel = Array.from(rels.getElementsByTagNameNS(PKG, "Relationship")).find((x) => /\/settings$/.test(x.getAttribute("Type")));
    const settingsPath = settingsRel ? dir + settingsRel.getAttribute("Target").replace(/^\.\//, "") : dir + "settings.xml";
    const settings = await xmlOf(zip, settingsPath);
    if (settings) {
      const st = settings.documentElement;
      for (const c of kids(st)) if (c.localName === "evenAndOddHeaders") st.removeChild(c);
      if (mirror) {
        const AFTER = ["bookFoldRevPrinting", "bookFoldPrinting", "bookFoldPrintingSheets", "drawingGridHorizontalSpacing", "drawingGridVerticalSpacing", "displayHorizontalDrawingGridEvery", "displayVerticalDrawingGridEvery", "doNotUseMarginsForDrawingGridOrigin", "drawingGridHorizontalOrigin", "drawingGridVerticalOrigin", "doNotShadeFormData", "noPunctuationKerning", "characterSpacingControl", "printTwoOnOne", "strictFirstAndLastChars", "noLineBreaksAfter", "noLineBreaksBefore", "savePreviewPicture", "doNotValidateAgainstSchema", "saveInvalidXml", "ignoreMixedContent", "alwaysShowPlaceholderText", "doNotDemarcateInvalidXml", "saveXmlDataOnly", "useXSLTWhenSaving", "saveThroughXslt", "showXMLTags", "alwaysMergeEmptyNamespace", "updateFields", "hdrShapeDefaults", "footnotePr", "endnotePr", "compat", "docVars", "rsids", "mathPr", "attachedSchema", "themeFontLang", "clrSchemeMapping", "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions", "readModeInkLockDown", "smartTagType", "schemaLibrary", "shapeDefaults", "doNotEmbedSmartTags", "decimalSymbol", "listSeparator"];
        const e = settings.createElementNS(W, "w:evenAndOddHeaders");
        st.insertBefore(e, kids(st).find((c) => AFTER.includes(c.localName)) || null);
      }
      zip.file(settingsPath, ser(settings));
    }
    zip.file(relsPath, ser(rels));
    zip.file("[Content_Types].xml", ser(types));
  }

  root.DocxPageSetup = { geometry, headersFooters };
})(typeof globalThis !== "undefined" ? globalThis : this);
