# Build verification — 19 October 2026

## Passed: 35 automated Node tests

Final command: `npm test` (35 passed, 0 failed).

- 5 mocked-DOM lifecycle tests (including exact saved-crop download and diagnostic rendering): app/IndexedDB initialization, cancellation during camera permission and video playback, stale-frame and delayed-photo rejection, preservation of a teacher's draft against late recognition, explicit-confirmation marking.
- 19 core tests: capture locking, explicit rescan/history, stale recognition tokens, teacher confirmation protection, session/question separation, exact matching, CSV escaping/formula neutralization, interrupted restore, fixed board coordinates, projective geometry, crop bounds, real QR decoding from synthetic full-board pixels, blank rejection, stability, malformed saved state, invalid image shapes, and 90/180/270-degree rotation.
- 10 experimental recognition tests (including diagnostic output and red-ink baseline regression): synthetic A–D and controlled variants, abstention on blank/noise/unknown/ambiguous shapes, word-mode manual review, deterministic pixel processing, validation, worker protocol.
- 1 local server test: all required runtime assets return successfully; writes return HTTP 405; node_modules exposure is rejected.

Mocked-DOM tests do not verify browser rendering, physical cameras, actual permissions or browser media APIs. Synthetic recognition tests are not pupil-handwriting accuracy measurements.

## Also verified

- Final JavaScript syntax checks pass, including the standalone module.
- Standalone script CSP hash matches emitted script contents.
- QR fallback library and license are bundled; no runtime package installation required.
- Five-, ten- and forty-page PDFs have A4 landscape page boxes. All 40 board QR payloads and six synthetic fixture QRs were decoded correctly. Blank answer crops and QR quiet zones were checked.
- First PDF page rendered and visually inspected. `screenshots/pilot-board-preview.png` is a template preview, not a scanner UI screenshot.
- Independent read-only review of capture/state/recognition found camera lifecycle and teacher-draft races; these were corrected and checked again. A delayed-photo context race was also corrected and verified.

## Not verified / blockers

- Real browser acceptance and UI screenshots: standalone Chromium was blocked by the execution environment; the cloud browser could not reach the isolated local development server; its URL policy blocked file URLs. These restrictions were not bypassed.
- `npm run test:browser` is included for a suitable machine but has not passed here.
- Live camera capture, camera autofocus/exposure, permissions on a phone, iOS/Safari, Android/Chrome, responsive layout rendering, vibration, physical prints, real classroom glare and handwriting remain untested.
- START-HERE.html is bundled and syntax-checked; file-origin worker/storage behavior has not been verified.
- No site deployed, no real pupil data used, no AI service connected, no OCR accuracy or capture-speed claim established.

The next acceptance step is a separately authorized trusted-HTTPS setup, followed by the dummy-board checks in PHONE_TEST.md.

## v0.2 diagnostic update

Original-crop download returns the stored answer image without screen-photo recompression. Expandable diagnostics show the normalized ink mask, experimental scores, abstention reason and capture metrics. Recognition thresholds were not loosened. A user-reported laptop trial established basic camera capture with visible crops but handwritten A/B abstention; this is limited user evidence, not a full browser or phone acceptance pass. The user photos were inspected locally and are not included in the source or package. No training, model download or external inference was performed.
