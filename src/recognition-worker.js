import { recognize } from './recognition.js?v=0.2.1';

// A module worker keeps the experimental local matcher off the UI thread.
// It never approves an answer, assigns a grade, persists a photo, or sends it.
// The guard also permits importing this file from Node-based smoke tests.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', async ({ data }) => {
    const { id, image, mode } = data ?? {};
    try {
      const result = await recognize(image, { mode: mode ?? 'choice' });
      self.postMessage({ id, result });
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : 'Local recognition failed.' });
    }
  });
}
