# Typst Studio and HTML Studio

Two pages next to the styler (`index.html`, unchanged). Open them in Chrome or Edge. Double-clicking works.

## typst.html: Word → Typst project

1. Choose a .docx.
2. The page writes the Typst code and compiles it in the browser (Typst 0.13 via typst.ts). The first visit downloads the compiler, about 20 MB, once.
3. Edit any file. The PDF on the right recompiles after a short pause. Press Ctrl/Cmd + S to compile at once. The preview is the compiled PDF itself, and it keeps your scroll position.
   - **Click anywhere on a page** to jump to that block's line in `main.typ`.
   - **Move the cursor in `main.typ`** to scroll the preview to that place; a blue bar marks it.
   - **− / + / Fit** zoom the preview.

   This works through invisible position markers that are added only while compiling. Your files and downloads never contain them, and tests showed they move no word on any page.
4. **Download project (.zip)** gives the folder. **Download PDF** gives the current PDF.

```
main.typ                  the document, one block per line
page_setup_template.typ   base tokens, page size and margins, header, footer, option grids
tags/mcq.typ  tags/cq.typ MCQ and CQ tokens (circle sizes, hanging indent, cq-indent …)
media/                    pictures from the Word file
templates/                logos
fonts/kalpurush.ttf
<name>.pdf
```

The code is written straight from the Word file, not through Pandoc. Equations become real Typst math, and drawings such as flowcharts become placed Typst boxes and lines.

If the compiler rejects a line, that line is replaced by its plain text and marked yellow in `main.typ`. Errors in your own edits are listed under the editor; click one to jump to the line.

The downloaded folder also compiles with the Typst program: `typst compile --font-path fonts main.typ`.

## html.html: Word → HTML + CSS project

1. Choose a .docx.
2. The pages are laid out by the browser in the Typst template layout.
3. Edit `index.html` (the text) or `style.css` (sizes, colours, spacing). The pages update.
4. **Print / Save PDF** saves the PDF.
5. **Download project (.zip)** gives the folder. Open its `index.html` in Chrome to see the pages, edit, reload, and print.

```
index.html   the content, one element per block
style.css    page, header, footer, MCQ and CQ styles
engine.js    lays the content out on pages when index.html opens
fonts.css    Kalpurush (embedded)
images/      pictures        templates/  logos
```

## Rebuilding the HTML export files

`js/html-export-assets.js` is generated from `css/style.css` and `js/paginate.js`. Run `node tools/build-html-export.js` after changing either of them. The script adds two fixes to the exported copy of the layout engine:

- block margins are counted in heights
- a box can break inside its table

The styler's own files are left as they are.
