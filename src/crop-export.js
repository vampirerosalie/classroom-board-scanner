// Local-only crop export. Never fetch, re-encode, upload, or choose a share target.
export const CROP_URL_GRACE_MS = 60_000;

export function prepareCropAsset(record, question, env = globalThis) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/.exec(record?.crop || '');
  if (!match || !match[2]) throw new Error('This saved crop could not be opened.');
  const raw = env.atob(match[2]);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const extension = match[1] === 'image/png' ? 'png' : 'jpg';
  const pupil = String(record.pupil || 'board').replace(/[^A-Za-z0-9_-]/g, '_');
  const number = String(question.number || '').replace(/[^0-9]/g, '');
  const name = `boardlight-q${number}-${pupil}-original-crop.${extension}`;
  const blob = new env.Blob([bytes], {type: match[1]});
  let file = null;
  if (typeof env.File === 'function') {
    try { file = new env.File([blob], name, {type: match[1]}); } catch { /* Download remains available. */ }
  }
  return {source: record.crop, name, blob, file, pupil, number};
}

export function canShareCrop(asset, navigator) {
  try {
    return Boolean(asset.file && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function' && navigator.canShare({files: [asset.file]}));
  } catch { return false; }
}

export function createCropViewer(env = globalThis) {
  const doc = env.document, byId = id => doc.getElementById(id);
  const panel = byId('cropViewer'), image = byId('cropOriginal'), status = byId('cropExportStatus');
  const shareButton = byId('shareCrop'), downloadLink = byId('downloadCropFile'), sizeButton = byId('cropActualSize');
  let current = null, returnFocus = null, sharing = false;
  const setStatus = text => { status.textContent = text; };
  function retire(asset) {
    // Do not revoke on click, image load, visibilitychange, or pagehide: an iOS
    // save/share prompt may still be using the URL. While visible it never expires.
    if (asset?.url) env.setTimeout(() => env.URL.revokeObjectURL(asset.url), CROP_URL_GRACE_MS);
  }
  function close() {
    const old = current; current = null;
    panel.hidden = true; image.removeAttribute('src'); downloadLink.removeAttribute('href');
    retire(old);
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function open(record, question, trigger) {
    const asset = prepareCropAsset(record, question, env);
    // Rendering the saved data URL needs no popup, download permission or Blob API.
    try { asset.url = env.URL.createObjectURL(asset.blob); } catch { asset.url = null; }
    retire(current); current = asset; returnFocus = trigger || doc.activeElement;
    image.src = asset.source; image.alt = `Original saved answer crop for ${asset.pupil}, question ${asset.number}`;
    image.classList.remove('actual-pixels'); sizeButton.setAttribute('aria-pressed', 'false');
    sizeButton.textContent = 'Show actual pixels';
    byId('cropViewerTitle').textContent = `${asset.pupil} · Question ${asset.number} · Original crop`;
    byId('cropFilename').textContent = asset.name;
    downloadLink.href = asset.url || asset.source; downloadLink.download = asset.name;
    shareButton.hidden = !canShareCrop(asset, env.navigator); shareButton.disabled = sharing;
    setStatus('Original saved image, unchanged. Nothing is sent unless you choose a destination in Share.');
    panel.hidden = false; panel.focus(); panel.scrollIntoView?.({block: 'start'});
  }
  async function share() {
    const asset = current;
    if (!asset || sharing) return;
    if (!canShareCrop(asset, env.navigator)) {
      setStatus('File sharing is unavailable here. Use Download image, or touch and hold the image for browser options.');
      return;
    }
    sharing = true; shareButton.disabled = true;
    try {
      // No await before share(): retain the Share button's transient user activation.
      await env.navigator.share({files: [asset.file], title: 'Boardlight original crop'});
      if (current === asset) setStatus('Share sheet finished. Check the destination you selected; the app cannot verify that a file was saved.');
    } catch (error) {
      if (current === asset) setStatus(error?.name === 'AbortError'
        ? 'Sharing was cancelled or no share target was available. Your crop is still here.'
        : 'The share sheet could not complete. Try Download image, or touch and hold the image for browser options.');
      // Never auto-download after an asynchronous error or user cancellation.
      // The visible fallback gets its own fresh user gesture.
    } finally { sharing = false; shareButton.disabled = false; }
  }
  byId('closeCropViewer').onclick = close;
  shareButton.onclick = share;
  downloadLink.onclick = () => setStatus('Download requested. If no file appears, try Share image → Save to Files, or touch and hold the image. Browser options vary.');
  sizeButton.onclick = () => {
    const actual = image.classList.toggle('actual-pixels');
    sizeButton.setAttribute('aria-pressed', String(actual));
    sizeButton.textContent = actual ? 'Fit image to screen' : 'Show actual pixels';
  };
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  return {open, close, share};
}
