# v0.2.1: original crop access and PDF opening

This small repair does not change capture safeguards, recognition models, thresholds, answer records, or grading. Recognition still needs teacher confirmation.

## Original images

In Teacher check, choose **View / save original crop**. The unchanged saved image appears inside the page, without a popup. **Show actual pixels** gives a scrollable native-pixel view.

- **Share image…** appears only when the browser reports that it supports sharing this image file. On iPhone, choose **Save to Files** in the system sheet if available. You choose the destination; the app does not select one or upload the crop itself.
- **Download image** is a normal, attached image-file link. If the browser does not save it, try Share or touch and hold the preview for the browser's own image options.
- Cancelling Share never starts a download. A failed Share leaves the preview and Download link available for a new tap.
- The image is never re-encoded. Its original JPEG/PNG bytes are preserved. No new capture is needed, including for old records.

The old action clicked a detached `data:` anchor, with no visible alternative. It did not use a Blob URL, so early Blob revocation was not its cause. The new Download link uses a Blob URL while the preview is open; it is released 60 seconds after closing/replacing the preview, not on click, image load or opening a system sheet. Browser save completion cannot be verified by the app.

## PDF boards

The existing five-, ten-, and forty-board PDF filenames and relative paths were already correct. The template page now offers ordinary **Open … PDF** links as well as **Download … PDF**, so a browser can use its PDF viewer and print/save controls. PDF content is unchanged.

## Clearer recognition message

The size/aspect/density guard now says: “Could not confidently recognise this writing. Please confirm the letter.” Old saved messages are normalized for display without rewriting the records. No thresholds changed. This export repair does not improve handwriting recognition.

## Verification limits

Automated Node/jsdom checks cover exact byte preservation, in-page preview persistence, asynchronous URL lifetime, native-share activation, cancellation/failure fallback, and old-record behavior. They are not real iOS Safari tests. Real phone save/share behavior and visual layout still require a device check. No user captures were transmitted for these tests.

API references: [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [Blob URL lifetime](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static).
