/**
 * One in-flight QR request, with a bounded wait and replaceable worker.
 * This transport does not change capture, geometry, stability or quality rules.
 *
 * onResult({ data }, { roundTripMs }) runs after releasing the pending request.
 * onFault({ id, reason, error, message, roundTripMs }) runs after cleanup.
 * reset() silently invalidates pending work; the next send creates a worker.
 */
export function createScanChannel({
  workerFactory,
  onResult = () => {},
  onFault = () => {},
  timeoutMs = 10000,
  setTimeout: schedule = (...args) => globalThis.setTimeout(...args),
  clearTimeout: cancel = handle => globalThis.clearTimeout(handle),
  now = () => performance.now(),
} = {}) {
  if (typeof workerFactory !== 'function') throw new TypeError('A QR worker factory is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('The QR timeout must be a positive finite duration.');

  let active = null;
  let pending = null;
  let disposed = false;

  const elapsed = job => job ? Math.max(0, now() - job.startedAt) : 0;

  function clearPending() {
    const job = pending;
    pending = null;
    if (job?.timer !== null && job?.timer !== undefined) cancel(job.timer);
    if (job) job.timer = null;
  }

  function retireWorker() {
    const old = active;
    // Invalidate the worker identity before termination or external callbacks.
    active = null;
    if (!old) return;
    old.worker.onmessage = null;
    old.worker.onerror = null;
    old.worker.onmessageerror = null;
    try { old.worker.terminate(); } catch { /* Already unusable; never reuse it. */ }
  }

  function fault(reason, cause, job, slot) {
    // A queued event or timer from an old request must not affect its successor.
    if (disposed || active !== slot || pending !== job) return;
    const roundTripMs = elapsed(job);
    const error = cause instanceof Error ? cause : new Error(String(cause || 'QR worker failed.'));
    const id = job?.id ?? null;
    clearPending();
    retireWorker();
    onFault({ id, reason, error, message: error.message, roundTripMs });
  }

  function createWorker() {
    const worker = workerFactory();
    if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function') {
      throw new TypeError('The QR worker factory did not return a worker.');
    }
    // A distinct slot is also an epoch, even if a test factory reuses an object.
    const slot = { worker };
    active = slot;
    worker.onmessage = ({ data }) => {
      const job = pending;
      if (disposed || active !== slot || !job || job.slot !== slot || data?.id !== job.id) return;
      const roundTripMs = elapsed(job);
      clearPending();
      onResult({ data }, { roundTripMs });
    };
    worker.onerror = event => {
      if (active !== slot || disposed) return;
      const cause = event?.error || new Error(event?.message || 'The QR worker stopped unexpectedly.');
      fault('worker-error', cause, pending, slot);
    };
    worker.onmessageerror = () => {
      if (active !== slot || disposed) return;
      fault('message-error', new Error('The QR worker response could not be read.'), pending, slot);
    };
    return slot;
  }

  function send(message, transfer = []) {
    if (disposed || pending) return false;
    if (!message || !((typeof message.id === 'number' && Number.isFinite(message.id))
      || (typeof message.id === 'string' && message.id.length > 0))) {
      throw new TypeError('Every QR request needs a finite number or nonempty string ID.');
    }
    const job = { id: message.id, startedAt: now(), timer: null, slot: null };
    pending = job;
    let slot;
    try {
      slot = active || createWorker();
    } catch (error) {
      fault('worker-create-error', error, job, active);
      return false;
    }
    job.slot = slot;
    job.timer = schedule(() => fault('timeout', new Error('The QR worker did not respond in time. Stop and start the camera to retry.'), job, slot), timeoutMs);
    try {
      slot.worker.postMessage(message, transfer);
    } catch (error) {
      fault('send-error', error, job, slot);
      return false;
    }
    return true;
  }

  function reset() {
    clearPending();
    retireWorker();
  }

  function dispose() {
    reset();
    disposed = true;
  }

  return { send, reset, dispose, get busy() { return pending !== null; } };
}
