# Classroom response boards

These original, simple response boards pair an ID-only QR with a large blank writing area. They do not use Plickers assets or encode an answer through card orientation.

## Ready-to-print files

- `public/templates/index.html`: print view with 1-, 10-, and 40-board choices.
- `public/templates/boards-S001-S005.pdf`: five-page pilot set, S001 through S005.
- `public/templates/boards-S001-S010.pdf`: ten-page starter set, S001 through S010.
- `public/templates/boards-S001-S040.pdf`: optional forty-page set, S001 through S040.
- `public/templates/S001.svg` through `S040.svg`: individual vector boards.
- `public/templates/geometry.json`: machine-readable coordinate contract.

Print on A4 landscape at **100% / actual size**. Disable browser headers and footers; do not use fit-to-page. Check the active black QR square with a ruler: it must measure 42 by 42 mm. Ordinary printer margins are sufficient because all marks are inset. Use matte cards or sleeves, dark thick strokes, even lighting, and an unobstructed QR. Glossy lamination can introduce glare.

The teacher maps `S001` to a student locally. No student names, answers, class names, or personal information are inside a QR. The entire QR payload is the four-character ID, such as `S001`.

## Exact geometry

All coordinates are in millimetres from the page's top-left, with x increasing rightward and y downward.

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| A4 landscape sheet | 0 | 0 | 297 | 210 |
| Active QR square | 20 | 18 | 42 | 42 |
| QR including blank quiet zone | 12 | 10 | 58 | 58 |
| Outside answer border | 20 | 82 | 257 | 108 |
| Scanner's inner answer crop | 26 | 88 | 245 | 96 |

QR configuration is version 1, error correction M, 21 by 21 modules, 2 mm per module. The four-module quiet zone is 8 mm on every side and remains completely blank. The answer frame is 0.6 mm wide; the inner crop stays 6 mm from its bounding edges. Nothing is preprinted in the crop. All titles, instructions, IDs, borders, and footer text lie outside it.

Header text begins at x = 90 mm. Pupils write within the frame; teachers should encourage a generous margin, because writing in the outer 6 mm is excluded from recognition.

At the synthetic fixtures' scale of 4 px/mm:

- Sheet: 1188 by 840 pixels.
- Active QR corners: (80, 72), (248, 72), (248, 240), (80, 240).
- Answer crop: x = 104, y = 352, width = 980, height = 384 pixels.

When estimating perspective from the detected QR, map its *active-square* corners to the coordinates above. The quiet-zone edge is not a QR detection corner. The page and writing area must be approximately planar. Estimating a large writing area from one small QR can amplify perspective errors; reject weak detections and require teacher review. Scaling a print preserves relative geometry but reduces usable physical size and can harm capture quality.

## Synthetic fixtures

`public/samples/manifest.json` lists the answer-bearing fixtures and their expected outputs:

| File | ID | Expected answer |
| --- | --- | --- |
| `synthetic-S001-A.png` | S001 | A |
| `synthetic-S002-B.png` | S002 | B |
| `synthetic-S003-C.png` | S003 | C |
| `synthetic-S004-D.png` | S004 | D |
| `synthetic-S005-went.png` | S005 | went |

`synthetic-S001-blank.png` is an additional blank-board negative/control image. Every PNG is a full 1188 by 840 board with an actual encoded QR. Answer glyphs are black, typeset DejaVu Sans Bold, centered inside the inner crop. No photograph or real handwriting is represented.

**These images are pipeline/geometry smoke tests, not handwriting-accuracy evidence.** Performance on typeset synthetic samples does not establish performance on children’s writing, physical prints, camera motion, glare, perspective, classroom distance, or multiple simultaneous boards. Evaluate those conditions separately with consent and human-reviewed results.

## Regeneration

From the project directory:

```sh
npm install
python3 -m pip install reportlab Pillow
npm run templates
```

The generator is `scripts/generate-templates.cjs`. It uses the project's `qrcode` dependency, Python 3, ReportLab, Pillow, and DejaVu Sans (or Liberation Sans if DejaVu is unavailable). It produces vector PDFs with embedded fonts, vector SVGs, the print view, geometry, licensing files, and synthetic PNGs. The files are generated locally; there are no remote fonts, QR endpoints, or image requests. The checked-in PDFs and SVGs can be used without installing Python.

The QR encoder's MIT license is retained at `public/templates/QRCODE-LICENSE.txt`. The supplied PDFs embed DejaVu Sans; its license is retained at `public/templates/FONT-LICENSE.txt`.

## Verification performed

- The delivered PDFs have exact A4-landscape page boxes, with 5, 10 and 40 pages respectively.
- The rendered first PDF page was visually inspected for clear fonts, clipping, collisions, and blank writing area. Fonts are embedded to avoid substitute-font layout errors.
- The blank synthetic answer crop contains only pure white pixels.
- All four sides of the 8 mm QR quiet zone contain only pure white pixels.
- All six PNGs are exactly 1188 by 840 pixels and decode to their filename's ID with jsQR 1.4.0.
- All 40 pages of the vector PDF were rendered to PNG and their QR payloads decoded to the correct sequential IDs with jsQR.
- SVG QR matrices are fixed at 21 by 21 modules and share the same data used by the PDFs and samples.

Browser print pagination was not verified in this shell because local Chromium launch was blocked by environment permissions. The browser print view specifies zero-margin A4 landscape pages and per-board page breaks; use the page-count-verified PDFs when print-dialog behavior is uncertain. Physical-print measurement and real-camera tests remain necessary.
