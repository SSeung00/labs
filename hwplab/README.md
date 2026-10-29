# HwpLab

A local web editor for Hangul word processor documents. It opens **HWP 5.0** (binary) and
**HWPX** (OWPML, KS X 6101) files, lets you edit them in a paged view, and saves **HWPX**,
which Hangul opens directly.

Everything is built from the formats' public specifications. Hancom publishes the HWP 5.0
format document, and HWPX is a national open standard. No Hancom software is reverse
engineered or needed.

## Run

```
start-hwplab.bat
```

This serves http://127.0.0.1:8004 and builds the web app on first run. It needs `uv` and Node.js.

### Linux

`./setup.sh` once (and again after pulling changes: `uv sync`, `npm ci`, web build; needs
[uv](https://docs.astral.sh/uv/) and Node.js 20+), then `./start-hwplab.sh`. It runs the server in the
terminal (Ctrl+C stops it) and opens the app window (a Chromium-family browser in `--app` mode, falling
back to the default browser); if HwpLab is already running, it just opens the window.

Development: the backend runs on 8004 (no auto-reload, so restart it after backend edits) and
Vite on 5177 (`frontend`: `npm run dev`).

## What works

- **Open:** HWP 5.0 and HWPX. Covers text runs, fonts, sizes, colours, bold/italic/underline/strike,
  super/subscript, highlight, paragraph alignment, indents, spacing and line spacing, page
  breaks, tables (merged cells, borders, fills, vertical alignment), pictures (BMP/WMF/EMF are
  converted to PNG), equations (rendered with KaTeX via python-hwpx's EqEdit to LaTeX
  converter), footnotes and endnotes, header/footer (shown from the page that holds the
  control), page numbers, page setup, and floating tables/pictures (in front of or behind
  text, anchored to paper/page/paragraph; objects fully covered by a later one are hidden).
- **Page view:** the page geometry follows Hangul (top margin + header area / bottom margin +
  footer area). Pages break between blocks, between table rows, between lines of a
  paragraph, and inside table rows taller than a page. Line spacing follows Hangul's model:
  text sits at the top of its line and the spacing goes below. Table cells leave out their
  last line's spacing.
- **Edit:** toolbar and dialogs for character shape (Alt+L), paragraph shape (Alt+T), page
  setup (F7), tables (insert, add/delete rows and columns, merge/split, cell fill, borders,
  vertical alignment), pictures (insert, paste or drop, resize), equations (Hangul script
  with live preview), footnotes, find and replace (Ctrl+F / Ctrl+H), page break (Ctrl+Enter),
  and zoom.
- **Save:** autosave to the local library (with 20 earlier versions kept), download as
  HWPX, and print or save as PDF (one sheet per page). The original file is never changed.

## Known gaps

- Hangul's own fonts (함초롬, 휴먼 …) are rarely installed, so text falls back to similar fonts.
  Line breaks, and therefore page breaks, can differ slightly from Hangul. Installing the
  free 함초롬체 fonts brings the layout closer.
- Not yet supported: tab stops with leaders and right/centre alignment (e.g. tables of contents),
  automatic paragraph numbering and bullets, multiple columns, drawing shapes (lines,
  rectangles; text inside text boxes is kept as paragraphs), charts/OLE, editing headers
  and footers, and per-section page setups (sections are merged and use the first section's
  page).
- Distribution (배포용) and password-protected documents can't be opened.
- Saving writes HWPX only. Writing the HWP 5.0 binary format is not implemented.

## Layout

```
backend/app/hwp/
  records.py      HWP 5.0 record stream (tag/level/size) helpers
  hwp5.py         HWP 5.0 reader -> editor model
  hwpx_reader.py  HWPX reader -> editor model
  hwpx_writer.py  editor model -> HWPX (built on python-hwpx's skeleton package)
  model.py        the editor document model (resolved formatting, pt units)
  equation.py     equation script -> LaTeX
  layout_ref.py   Hangul's cached line layout, used to compare pagination
backend/app/store.py   document library in data/docs/<id>/
frontend/src/editor/   TipTap schema (extensions.ts), pagination, find/replace
```

Tests: `cd backend && .venv\Scripts\python -m pytest`. They round-trip sample documents
(HWPLAB_SAMPLES lists the paths) and check the output with python-hwpx's package,
editor-open-safety and OWPML schema validators.

## Licences

python-hwpx (Apache-2.0) provides the HWPX skeleton, the validators and the equation
converter. The editor is built on TipTap/ProseMirror (MIT), and equations are rendered with
KaTeX (MIT).

## App window and taskbar

`start-hwplab.bat` opens the app in its own Edge window at `http://hwplab.localhost:8004`: Edge names an app window's taskbar entry after its host (not the port), so each app gets its own taskbar icon.
