# Phone pilot handoff

## Before a live camera trial

The authorized static pilot is hosted on [GitHub Pages](https://vampirerosalie.github.io/classroom-board-scanner/) at a trusted **HTTPS** origin. Open that address on the phone before live mobile testing. This deployment has no answer-upload backend, analytics or third-party scripts. Hosting does not establish phone compatibility or recognition accuracy. Do not expose a development directory, `node_modules`, test artifacts or real data. The current loopback server is intentionally not shared on your network.

Do not bypass certificate warnings, install ad-hoc trust certificates or disable browser security to test. “localhost” is a secure-context exception only on the device actually running the server. A laptop's `http://192.168...` address on a phone usually cannot use getUserMedia.

A sample/photo-import trial can establish part of the pipeline, but is not a substitute for continuous camera testing. Camera permission must be granted by the person operating the phone. Audio is never requested.

## First practical trial: dummy boards only

1. Print S001–S005 at actual size. Measure the active QR: 42 × 42 mm. Verify the answer frame and QR have not been repositioned. Mount flat on a rigid board; keep the 8 mm QR quiet zone blank.
2. Use thick black marker, large A–D responses, even lighting and matte surfaces where possible. Keep all strokes inside the frame with generous margins; the outer 6 mm is excluded from the crop.
3. Test current iPhone Safari and Android Chrome, noting exact OS/browser/device versions. Do not assume either is supported until it passes.
4. Start one session, one question, one scanner tab. Grant rear-camera access. Face the board relatively square-on and keep the full answer area in frame.
5. Sweep one board at a time. Confirm that green “CAPTURED” feedback appears only after saving. Check that the camera continues while recognition is processing.
6. Hold S001 in view for several seconds. It must remain one capture. Arm Rescan explicitly; the next accepted crop must replace it once and preserve history.
7. Review every crop for the right ID, complete writing, perspective distortion and glare. Verify unconfirmed suggestions remain Teacher check. Confirm a transcription and check the expected exact-match result. Save a correction and ensure it changes the result.
8. Create a word question, e.g. “Past tense of go”, accepted answer “went”. Capture and manually transcribe. Verify case/spacing normalization, alternatives, wrong answers, and unreadable crops left unconfirmed.
9. Create a second question and a new session. The same ID must be capturable independently. Return to the old question; its captures and answer key must remain.
10. Reload, export CSV and archival backup, stop the camera, switch tabs/apps, rotate the device, deny and re-grant permissions, and interrupt a pending camera prompt. The camera must not unexpectedly start or continue after cancellation/navigation.

## Measure separately

Record **capture latency** independently of **recognition latency**. Log time between successful captures, missed QRs, duplicate captures, wrong-ID association, clipped/incorrect crops, glare acceptance, unreadable writing accepted, false quality rejections, recognition errors, abstentions and manual review time. No numeric speed target has yet been demonstrated.

Try 1 m, 1.5 m, 2 m and 3 m only as an experiment; no distance is guaranteed. Test straight-on and modest tilt, slight motion, different lighting, reflected glare and partly blocked boards. Reject an otherwise fast system if it saves the wrong board/ID pairing. Do not progress to pupil data or 20–40-pupil use until the basic capture, privacy and storage tests are satisfactory.

## Expected current limitations

- One QR/board per processed frame; no reliable multi-board acquisition.
- Single-QR perspective extrapolation can crop incorrectly at angles or on bent surfaces.
- Quality thresholds are experimental; glare/occlusion can evade them.
- Letter matching is experimental and may abstain, including on typeset fixtures.
- Words require manual transcription. There is no semantic AI marking.
- Tab must remain foreground during capture. Camera stops when hidden.
- Storage is per browser/device/origin, unencrypted, subject to quota and clearing.
- Browser acceptance and real hardware have not yet been verified in this build.

Stop the trial if records are lost, an ID is associated with the wrong crop, recognition is graded before confirmation, camera permission behavior is unexpected, or any response is transmitted externally.
