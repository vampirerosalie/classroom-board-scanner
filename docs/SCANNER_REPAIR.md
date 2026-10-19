# v0.2.2: full-screen camera and bounded QR checks

This release keeps the v0.2 handwriting matcher and all geometry, quality and stability thresholds unchanged. It does not incorporate the experimental trained model or preprocessing research.

## What changed

- Starting the camera opens a viewport-filling scanner with the camera image, captured count, readable status and **Exit scanner**. Exit stops the camera tracks and returns to the dashboard. Teacher review remains separate.
- The video and outline canvas use the same contained image geometry. Black space may remain around the image when camera and phone aspect ratios differ; the image is not cropped to fill the screen.
- This is an in-page camera view, not the browser Fullscreen API. Safari's own browser controls may remain. Safe-area padding and visualViewport resize/scroll handling accommodate the available screen area.
- An unanswered QR-worker request stops after ten seconds with a retry instruction. Worker errors, unreadable messages and processing exceptions also stop safely. Restart creates a fresh QR worker; existing saved answers and recognition jobs remain separate.
- Stop invalidates pending frames and cancels the animation loop. Late replies cannot unlock or mutate a newer scan. Exit clears an old green flash.
- Each new frame no longer replaces the last useful message with “Checking board locally…”. Saved confirmation stays readable for about 1.1 seconds. Green outlines/feedback are shown only after local persistence succeeds.
- Frame canvases are reused when dimensions are unchanged. This avoids unnecessary canvas resets, but no phone speed improvement has yet been measured.
- Entry assets, module imports, workers, worker dependencies and the template-page link have explicit release query versions to avoid mixing cached releases. Database names and saved-record schema are unchanged.

## What the slow-camera report established

The phone screenshot showed multiple boards viewed through a laptop display. The current QR library returns one QR per frame. Which QR it chose, its processing time, and the precise rejection reason cannot be determined from that screenshot.

Controlled software reproduction found two distinct problems: the old generic “Checking” message hid actionable status, and a worker that never replied could leave scanning busy even after Stop. Both are repaired.

Another constraint remains deliberately unchanged: stability needs the same ID with limited motion for at least 240 ms, and sample gaps below 700 ms. Repeated samples 700 ms apart cannot pass, even for a stationary synthetic board. Alternating QR IDs also cannot pass. This does not prove the user's phone hit either condition. It means actual timings are needed before changing resolution or capture safeguards.

## Reading the new diagnostics

After exiting the scanner, open **Latest scan timings** below Camera & quality tips. It shows source/processing dimensions, frame preparation, worker round-trip, QR decoding, geometry, crop warp, quality check and sample gap. A successful save additionally shows JPEG encoding and storage duration. The latest rejected frame may replace those successful-frame timings.

These are local elapsed-time measurements for diagnosis, not accuracy scores or a benchmark. They contain no image pixels and are not uploaded or continuously saved. Recognition still runs asynchronously after capture persistence; it is not included in QR timing.

## Verification and remaining device checks

Automated coverage includes real jsQR on synthetic board pixels, unchanged stability gates, worker timeout/retry/epoch isolation, stop/start camera races, permission/play cancellation, delayed storage, no premature green, viewport lifecycle/accessibility mocks, existing capture locks/exports and original-crop sharing fallbacks. Standalone syntax and CSP hashes are also checked.

Real iPhone rendering, rear-camera performance, Safari save/share behavior and sustained multi-board classroom scanning are not verified by these tests. Check portrait and landscape; Exit must stop camera use and restore the page. Test one printed board first, then a screen display, keeping the complete answer area visible. If acquisition remains slow, record the latest timing text and status before changing any safeguards. Recognition accuracy remains a separate open problem; confirm every transcription.
