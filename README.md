---
title: MCQ CQ Styler
emoji: 📄
colorFrom: blue
colorTo: gray
sdk: static
app_file: index.html
pinned: false
---

# MCQ / CQ styler

Give it a Word file and you get the same Word file back. Only the MCQ and CQ parts are restyled the way the Typst template did it. Everything else stays exactly as in the original: headers, footers, page size, theory text, tables, pictures and fonts.

Everything runs in the browser tab. No Typst, no Python, no server, and the file is never uploaded.

## Use

1. Open `index.html` in Chrome or Edge. Double-clicking it works.
2. Choose the `.docx`, or drop it on the page.
3. `<name>_styled.docx` downloads. Open it in Word.

`pdf.html` is the older tool, which makes a PDF in the full Typst page design.

## Settings

The **Settings** tab has the same values you would edit in the Typst templates. Each field shows the Typst token it stands for (`opt-circle-size`, `cq-indent`, `header-ascent` …). A live preview of an odd or even page updates as you type. Values save automatically in this browser. **Export** / **Import** move them to another computer, and **Reset** goes back to the Typst values.

| Section | Typst file | What you can change |
|---|---|---|
| Page setup | `page_setup_template.typ` | **off by default** (the Word file's own page is kept). When on: page size, four margins, header/footer distance |
| Header | `page_setup_template.typ` | **off by default**. When on:  odd/even mirroring, text (blank = each chapter's own Word header), font, size, colour, logo (upload your own), logo height, rule thickness and colour |
| Footer | `page_setup_template.typ` | **off by default**. When on:  mirroring, Bangla or English page numbers, font, size, colour, logo, logo height, rule |
| MCQ | `tags/mcq.typ` | columns, column gap, text size, hanging indent, question/option colours, when options go one per row, row gap, circle size/line/colours/letter size, answer circle fill/letter size/colour, board reference size/italic/colour/right-push, keep question with options |
| CQ | `tags/cq.typ` | columns, column gap, text size, sub-question indent, text and sub-question colours |

Bangla page numbers are made of Word fields, so Word works them out on every page by itself. They also continue from the Word file's own starting page number.

## What changes

| Part | Styling (from `tags/mcq.typ` / `tags/cq.typ`) |
|---|---|
| **MCQ** | Two columns. The rest of the page stays one column, using continuous section breaks.<br>9pt text with a 1.8em hanging indent.<br>Options become circled ক খ গ ঘ, two per row. When an option is long (over 20 letters), they go one per row.<br>The answer becomes a black circle beside the second row, and the `উত্তর: ক` line is removed.<br>Board references `[ঢা. বো. ২৫]` move to the right edge, at 7pt italic.<br>A question is kept together with its options. |
| **CQ** | Two columns.<br>10pt text.<br>(ক)–(ঘ) sub-questions are indented 0.4in. |

Options can come from separate paragraphs, from one line (`(ক) … (খ) …`), or from a borderless table with the answer letter in a cell. All three come out the same way. Options in a table replace the table.

## No tags needed

You don't need `mcq (start)` / `cq (start)` markers. If a file still has them, they are removed. Parts are found from the text itself:

| Found as | When the document has |
|---|---|
| **MCQ** | `১।` question + `(ক)…(ঘ)` options. The options are in pairs on a line, followed by `উত্তর: ক`, or short phrases. `উদ্দীপকটি পড়ো … উত্তর দাও` passages also count. |
| **CQ** | `প্রশ্ন-০১:` stems with `(ক)…(ঘ)` instructions, `১নং প্রশ্নের উত্তর`, `জ্ঞানমূলক / অনুধাবনমূলক প্রশ্নোত্তর`, or short questions answered by `উত্তর: <sentence>`. |

On two tagged books, the parts found matched the hand-placed tags exactly.

## Files

| File | Role |
|---|---|
| `index.html`, `js/docx-app.js`, `css/app.css` | the app: Convert and Settings views |
| `js/settings.js` | all style values with the Typst defaults, and the Settings form layout |
| `js/preview.js` | the live sample page |
| `js/docx-writer.js` | edits the Word XML in place: section breaks, circles, tab stops, indents, sizes, colours |
| `js/docx-pagesetup.js` | page size/margins, new header and footer parts, Bangla page-number fields |
| `js/docx-reader.js` | reads the .docx into a model that points back to each XML paragraph/table |
| `js/classify.js` | finds MCQ / CQ parts and the parts of each question |
| `js/omml.js` | Word equations → LaTeX (used by the PDF tool) |
| `pdf.html` + `js/render.js`, `js/shapes.js`, `js/paginate.js`, `js/app.js`, `css/style.css`, `js/assets.js` | the PDF tool |

## Questions export

The styler's **Download questions (.zip)** button, and the `questions/` folder in the Typst and HTML Studio zips, contain the questions extracted the way the MCQ/SQ scrapper does it (its own code, in `js/scrapper/`), laid out like the Typst converter's output folder:

| File / folder | Content |
|---|---|
| `mcq_questions.csv` | MCQs in the Typst converter's columns (title, image, explanation, options_N_answer / _is_correct / _image) |
| `mcq_questions.xlsx` | the same MCQs in the MCQ scrapper's sheet (status, SI, type, chapter, Board, …), pictures inside |
| `short_questions.xlsx` | জ্ঞানমূলক / অনুধাবনমূলক short questions with answers (SQ scrapper) |
| `cq_questions.csv` | creative questions: stem, all four parts (ক–ঘ) with their answers, stem picture |
| `cq_ka_kha.csv` | only the জ্ঞানমূলক / অনুধাবনমূলক rows |
| `images.csv` | every picture with the text around it and its base64 |
| `question_images/` | cropped question and option pictures: `mcq_001.png`, `mcq_001_a.png` …, `cq_001.png` |
| `media/`, `media_color/` | every picture of the document in greyscale and in colour |
