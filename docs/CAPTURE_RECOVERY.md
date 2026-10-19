# v0.2.3: capture recovery and bounded QR noise

## What the reports showed

The phone screenshots reached QR detection and geometry validation for S002/S003, but automatic capture remained at the temporal gate. The user reported holding the phone steady. That message was not proof of hand movement: decoder-coordinate jitter, sampling gaps and frame latency can affect the gate.

A separate screenshot showed an imported board photo successfully saved in Teacher check, followed by recognition abstention. Photo acquisition and handwriting recognition are separate stages. This release repairs acquisition; it does not upgrade the handwriting matcher.

## Capture now

Automatic capture remains on. When a current, geometry-valid, uncaptured pupil QR is found, the scanner also offers **Capture S00x now**.

- A tap queues exactly one **fresh** camera frame after any current QR job finishes. It does not save the displayed outline or reuse a previous crop.
- The fresh frame must decode the same pupil ID that was named on the button. A changed or missing ID is rejected.
- It bypasses only the automatic temporal waiting gate. Existing QR identity, geometry, answer visibility, resolution, contrast/ink/sharpness checks, duplicate locks and explicit-rescan rules still apply.
- It is not a promise to capture every tap: a failed geometry/quality check explains why the frame was refused.
- Stop, question/session changes, worker faults and timeouts cancel pending capture. Repeated taps cannot queue multiple shutters.
- Green feedback follows successful local storage. Recognition starts separately afterward, and every answer still needs teacher confirmation.
- Saved manual captures are labelled **Camera capture · manual shutter**. Old records remain compatible.

## Automatic gate correction

The previous gate compared each detected QR corner with the preceding frame and allowed less than 6.5% of the QR edge. For a stationary 72-pixel QR, alternating detection coordinates just ±2.34 pixels around a fixed centre could reset the gate forever. This was reproduced with controlled inputs; it does not establish the exact source of the user's phone failure.

The existing strict path and its numeric thresholds remain. An additional bounded-noise path needs three contiguous observations of the same pupil spanning at least 240 ms, with every sample gap below 700 ms. All observed QR corners **and projected answer corners** must lie within a common per-corner mean radius of 6.5% of the smallest observed QR edge. The answer-region requirement rejects small QR perspective errors that amplify into large crop displacement.

The averaged positions are used only for that stability decision. The saved crop always comes from the current raw frame and current homography. No images or crop pixels are averaged. Current-frame quality checks still run after either stability path accepts.

Manual/photo observations clear automatic history, so evidence cannot bridge a different board. Invalid IDs, lost QR, invalid geometry, non-monotonic timestamps and excessive gaps also break continuity as appropriate.

## Diagnostics and limits

**Latest scan timings** now includes the gate reason, adjacent corner displacement, three-observation QR/answer radius and sample count. These are local scalar diagnostics, not uploaded images. Automatic waiting messages no longer imply the user moved the phone. The outline represents a previously checked frame over a continuing live preview, so latency can make it trail the current image; the saved crop and homography still use the same checked frame.

The full-screen video and canvas retain identical contain-scaled boxes. Review uses contain scaling at the saved crop's 640:251 ratio. CSS does not meaningfully truncate its pixels. However, the standard saved/recognition crop deliberately omits 6 mm inside each visible printed answer-frame edge. Writing near that border can therefore be cut off in the source crop. This release does not change that margin or feed frame lines into recognition; a separate full-answer-context candidate is being investigated.

Sampling gaps of 700 ms or more can still prevent automatic capture; the shutter is a recovery route, not a claim of validated automatic classroom sweeping. Recognition of handwriting remains unreliable and unchanged.

## Verification

117 automated tests pass, including independent manual-shutter tests, actual jsQR/geometry/quality processing, controlled stationary corner noise, perspective-noise rejection, timing/ID resets, exact current-frame crop equality, and all earlier capture/export/race tests. Standalone scripts and CSP hashes are checked separately.

These tests are simulations and software execution, not real iPhone acceptance. After publishing, verify the shutter, automatic capture, saved count, Exit, photo import and review on the actual phone. No user screenshots were used as training examples or included in this package.
