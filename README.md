# Boardlight — v0.2 diagnostic capture pilot

A local-only prototype for collecting written classroom responses using one teacher camera and ID-only QR boards. Original interface and board design. **Use dummy IDs and test responses only.** This is a capture-and-review pilot, not a validated classroom assessment product.

## Open the hosted pilot

[Open Boardlight v0.2](https://vampirerosalie.github.io/classroom-board-scanner/) in a browser. GitHub Pages serves the static application; answer crops and records remain in that browser. Use dummy IDs and test responses only. HTTPS permits camera access but does not establish device compatibility or recognition accuracy.

## Start locally

1. Extract the whole ZIP into a folder.
2. With Node.js 20 or newer installed, open a terminal in that folder and run `node server.mjs` (or `npm start`). No package installation is needed to run the app; browser dependencies are included.
3. Open **http://localhost:4173** on that same computer.
4. Choose **Try a synthetic sample**, then **S001 · A**. It uses real QR decoding and the same crop pipeline as the camera. Open **Teacher check**, check the crop, and confirm the transcription.
5. Print `public/templates/boards-S001-S005.pdf` on A4 landscape, actual size / 100%. Use the fixed geometry without moving the QR or answer frame.

`START-HERE.html` is a bundled alternative with embedded code, workers and synthetic samples. It is provided for convenience but **file-opening behavior has not been browser-verified**. The supported development route is the local server above. Printing links in it expect the extracted folder structure. If a browser blocks workers or storage when opening a local file, use the server route. Do not weaken browser security settings.

**Phone camera testing needs a trusted HTTPS origin.** Opening a computer's ordinary LAN HTTP address on a phone is usually insufficient; phone “localhost” means the phone itself. The static pilot is published at [https://vampirerosalie.github.io/classroom-board-scanner/](https://vampirerosalie.github.io/classroom-board-scanner/). See `docs/PHONE_TEST.md` for the acceptance checklist.

## What works in this implementation

- Bundled jsQR 1.4.0 decoding in a dedicated worker; no dependency on native BarcodeDetector support.
- Fixed QR-to-board homography, perspective-rectified answer crop, geometry/size, stability and image-quality heuristics.
- Local capture save and immediate green feedback independent of recognition; recognition runs in a second worker.
- Locked records per session + question + pupil; explicit **Rescan** replaces a crop and retains the old record in history.
- IndexedDB storage on the device. Camera frames are discarded; only answer crops and record metadata are retained.
- **Teacher check** with editable transcription, A–D shortcuts, explicit confirmation, later corrections, and exact-answer comparison.
- Separate questions and sessions; prior question answer keys are retained.
- CSV of all sessions/questions, including missing pupils and capture source. Formula-like cell prefixes are escaped. JSON archival backup includes crops, rescans and corrections; there is no backup-import UI in v0.2.
- 40 individual QR SVG boards, 5/10/40-page printable PDF sets, and six clearly labelled synthetic fixtures.
- Exclusive-tab guard with Web Locks when supported. Otherwise a warning to use only one scanner tab; simultaneous writers can overwrite whole-state snapshots.

## What changed in v0.2

Teacher check now has **Download original crop** and expandable **Match diagnostics**. Downloads are the saved answer JPEG/PNG, not a photograph of the app screen. Diagnostics show experimental template scores, why the matcher abstained, acquisition metrics and the normalized ink mask. These features help distinguish capture/preprocessing faults from template limitations. The recognition thresholds and geometric matcher have not been loosened or claimed fixed.

A user trial on a laptop demonstrated QR capture and answer crops, but clear handwritten letters still abstained. Recolouring synthetic test letters red did not reproduce the failure; changing their proportions or stroke width did. Those are diagnostic checks, not handwriting validation. Raw original crops are needed to measure the actual failure without screen-photo distortion. No user photos are included in this package.

## Recognition: intentionally modest

The local choice provider is a pixel-based experimental A–D template matcher. It may propose a letter or abstain. It is not a trained handwriting model, its similarity scores are not probabilities, and it has not been validated on pupils' handwriting. Some typeset fixtures also abstain. **Every suggestion needs teacher confirmation.** A suggestion alone never produces “incorrect”.

Word/fixed-answer mode has **manual transcription**, not automatic word OCR. No Tesseract, paid API, credentials, cloud AI service or semantic marking is present. A provider can later be replaced behind `recognize(image, {mode})` / the recognition worker protocol. Any external service would need separate authorization, privacy review and backend credential protection; it must not be added to frontend code.

## Quality and geometry limits

The board and QR must be flat and coplanar. All geometry is extrapolated from one QR, which amplifies corner error at the far end of the answer box. The quality gate checks coarse darkness, visible writing, contrast, sharpness, size and stability. It cannot reliably detect glare that erased part of a letter, board overlap, occlusion, or a wrong crop. View and verify every answer crop. There is no proven capture-distance, speed or accuracy claim. One board at a time is the pilot workflow.

## Privacy and retention

There are no analytics, external fonts, remote dependencies, telemetry, uploads or recognition endpoints. The page's CSP restricts requests to its own origin. The server is loopback-only and read-only; it does not receive or store responses. All application data remains in the browser profile's IndexedDB. This is not encryption or access control: anyone using that browser profile may see the data. Private browsing, browser-data clearing, device loss or quota failure can lose records. Export before clearing data. The erase action is irreversible and asks for confirmation.

Keep this pilot to dummy IDs and dummy answers until the school's privacy requirements, retention plan, device security and real-world tests are agreed. Do not put pupil names or other personal information in session labels, prompts or test files.

## Testing

```
npm install
npm test
```

Tests cover true QR pixels and crop geometry, rotation/skew/bounds, quality rejection, duplicate locking, teacher confirmation, late-worker races, session/question isolation, persistence normalization, export escaping, and experimental recognition. Synthetic performance is not handwriting accuracy evidence.

For a real browser on a suitable machine:

```
npx playwright install chromium
npm run test:browser
```

You can use a preinstalled Chromium with `CHROMIUM_PATH=/path/to/chromium npm run test:browser`. Browser test installation is development-only, not needed to run the app. The acceptance script saves screenshots on a successful run.

**Verification limits:** The cloud shell could run Node tests and render/inspect the printable PDFs. Its browser process was blocked by the execution environment; the available cloud browser could not reach the isolated loopback server, and file URLs were policy-blocked. Therefore actual DOM/browser acceptance, responsive screenshots, physical print measurement, live camera, and iOS/Android behavior remain unverified. The browser acceptance suite is included, not reported as passed.

## Source map

- `src/app.js`: camera lifecycle, UI, capture and recognition coordination
- `src/scan-worker.js`: local QR acquisition and quality gate
- `src/geometry.js`: board dimensions, homography, perspective crop, image checks
- `src/state.js`: question/session identity, locks, history, confirmation, CSV
- `src/storage.js`: IndexedDB persistence
- `src/recognition.js` and `src/recognition-worker.js`: local provider interface and experimental matcher
- `scripts/build-standalone.mjs`: builds self-contained HTML from current sources
- `scripts/generate-templates.cjs`: regenerates PDF/SVG/fixtures (requires Python, ReportLab, Pillow and a supported font)

## Technical references and licenses

- [jsQR API and license](https://github.com/cozmo/jsQR) — vendored Apache-2.0 code; license in `vendor/jsQR-LICENSE.txt`.
- [Camera permissions and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- [Native BarcodeDetector compatibility caveats](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) — this prototype does not depend on it.
- [node-qrcode](https://github.com/soldair/node-qrcode) — template generation only, MIT license retained with templates.
- Embedded PDF font license is retained in `public/templates/FONT-LICENSE.txt`.
