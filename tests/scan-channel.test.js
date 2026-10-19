import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanChannel } from '../src/scan-channel.js';

class Clock {
  time = 1000;
  nextId = 0;
  timers = new Map();
  callbacks = new Map();
  now = () => this.time;
  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, callback });
    this.callbacks.set(id, callback);
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  advance(ms) {
    const target = this.time + ms;
    while (true) {
      const next = [...this.timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

class Worker {
  messages = [];
  terminated = 0;
  postMessage(message, transfer) { this.messages.push({ message, transfer }); }
  terminate() { this.terminated += 1; }
  reply(data) { this.onmessage?.({ data }); }
}

function setup(options = {}) {
  const clock = new Clock(), workers = [], results = [], faults = [];
  const channel = createScanChannel({
    workerFactory: () => { const worker = new Worker(); workers.push(worker); return worker; },
    onResult: (event, timing) => results.push({ event, timing, busy: channel.busy }),
    onFault: fault => faults.push({ ...fault, busy: channel.busy }),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now,
    ...options,
  });
  return { clock, workers, results, faults, channel };
}

test('workers are lazy; one request is in flight and buffers are passed through', () => {
  const b = setup(), transfer = [new ArrayBuffer(4)], first = { id: 0, image: 'pixels' };
  assert.equal(b.workers.length, 0);
  assert.equal(b.channel.send(first, transfer), true);
  assert.equal(b.channel.busy, true);
  assert.equal(b.channel.send({ id: 2 }), false);
  assert.equal(b.workers.length, 1);
  assert.deepEqual(b.workers[0].messages, [{ message: first, transfer }]);
  b.workers[0].reply({ id: 999 });
  assert.equal(b.channel.busy, true, 'a mismatched response cannot release the pending frame');
  b.workers[0].reply({ id: 0, ok: false });
  assert.equal(b.channel.busy, false);
  assert.equal(b.results.length, 1);
  assert.equal(b.results[0].busy, false, 'callback runs after cleanup');
  assert.equal(b.channel.send({ id: 2 }), true);
  assert.equal(b.workers.length, 1, 'successful workers are reused');
});

test('a missing response times out after the default 10 seconds and does not auto-retry', () => {
  const b = setup();
  b.channel.send({ id: 1 });
  b.clock.advance(9999);
  assert.equal(b.channel.busy, true);
  assert.equal(b.faults.length, 0);
  b.clock.advance(1);
  assert.equal(b.channel.busy, false);
  assert.equal(b.workers[0].terminated, 1);
  assert.equal(b.faults.length, 1);
  assert.equal(b.faults[0].id, 1);
  assert.equal(b.faults[0].reason, 'timeout');
  assert.equal(b.faults[0].roundTripMs, 10000);
  assert.equal(b.faults[0].busy, false);
  assert.match(b.faults[0].message, /did not respond/);
  b.clock.advance(60000);
  assert.equal(b.workers.length, 1);
  assert.equal(b.faults.length, 1);
  assert.equal(b.channel.send({ id: 2 }), true);
  assert.equal(b.workers.length, 2, 'explicit retry gets a fresh worker');
});

test('successful response cancels even timer handle zero and reports monotonic round-trip time', () => {
  const b = setup({ timeoutMs: 100 });
  b.channel.send({ id: 'frame-a' });
  b.clock.advance(37.5);
  b.workers[0].reply({ id: 'frame-a', ok: true, crop: 'unchanged' });
  assert.deepEqual(b.results[0].event, { data: { id: 'frame-a', ok: true, crop: 'unchanged' } });
  assert.equal(b.results[0].timing.roundTripMs, 37.5);
  assert.equal(b.clock.timers.size, 0);
  b.clock.advance(1000);
  assert.equal(b.faults.length, 0);
  assert.equal(b.workers[0].terminated, 0);
});

test('reset silences old replies/errors/timers without clearing a newer request, even with a reused ID', () => {
  const b = setup({ timeoutMs: 100 });
  b.channel.send({ id: 1 });
  const old = b.workers[0], lateReply = old.onmessage, lateError = old.onerror,
    lateMessageError = old.onmessageerror, lateTimeout = b.clock.callbacks.get(0);
  b.channel.reset();
  assert.equal(old.terminated, 1);
  assert.equal(b.channel.busy, false);
  assert.equal(b.clock.timers.size, 0);
  assert.equal(b.workers.length, 1, 'reset itself does not create a worker');
  b.channel.send({ id: 1 });
  lateReply({ data: { id: 1, ok: true } });
  lateError({ message: 'old worker' });
  lateMessageError();
  lateTimeout();
  assert.equal(b.channel.busy, true);
  assert.equal(b.clock.timers.size, 1);
  assert.equal(b.faults.length, 0);
  assert.equal(b.results.length, 0);
  b.workers[1].reply({ id: 1, ok: false });
  assert.equal(b.channel.busy, false);
  assert.equal(b.results.length, 1);
});

test('a canceled timer from a prior successful request cannot end a later request on the same worker', () => {
  const b = setup();
  b.channel.send({ id: 1 });
  const oldTimeout = b.clock.callbacks.get(0);
  b.workers[0].reply({ id: 1 });
  b.channel.send({ id: 2 });
  oldTimeout();
  b.workers[0].reply({ id: 1 });
  assert.equal(b.channel.busy, true);
  assert.equal(b.faults.length, 0);
  assert.equal(b.results.length, 1);
  b.workers[0].reply({ id: 2 });
  assert.equal(b.results.length, 2);
});

test('synchronous postMessage failure clears and terminates, preserving the failing ID and error', () => {
  const error = new Error('DataCloneError: test transport failed'), worker = new Worker();
  worker.postMessage = () => { throw error; };
  const b = setup({ workerFactory: () => worker });
  assert.equal(b.channel.send({ id: 8 }), false);
  assert.equal(b.channel.busy, false);
  assert.equal(worker.terminated, 1);
  assert.equal(b.clock.timers.size, 0);
  assert.equal(b.faults[0].error, error);
  assert.equal(b.faults[0].id, 8);
  assert.equal(b.faults[0].reason, 'send-error');
});

for (const [handler, reason] of [['onerror', 'worker-error'], ['onmessageerror', 'message-error']]) {
  test(`${handler} releases pending state and a later send creates a new worker`, () => {
    const b = setup();
    b.channel.send({ id: 4 });
    b.clock.advance(12);
    b.workers[0][handler]({ message: 'worker crashed' });
    assert.equal(b.channel.busy, false);
    assert.equal(b.clock.timers.size, 0);
    assert.equal(b.workers[0].terminated, 1);
    assert.equal(b.faults[0].reason, reason);
    assert.equal(b.faults[0].id, 4);
    assert.equal(b.faults[0].roundTripMs, 12);
    assert.equal(b.channel.send({ id: 5 }), true);
    assert.equal(b.workers.length, 2);
  });
}

test('factory errors report a useful fault and permit a later retry', () => {
  let attempts = 0;
  const worker = new Worker();
  const b = setup({ workerFactory: () => { if (!attempts++) throw new Error('Worker blocked'); return worker; } });
  assert.equal(b.channel.send({ id: 2 }), false);
  assert.equal(b.channel.busy, false);
  assert.equal(b.faults[0].reason, 'worker-create-error');
  assert.equal(b.faults[0].id, 2);
  assert.equal(b.clock.timers.size, 0);
  assert.equal(b.channel.send({ id: 3 }), true);
  worker.reply({ id: 3 });
  assert.equal(b.results.length, 1);
});

test('multiple resets and disposal are safe and never start additional workers', () => {
  const b = setup();
  b.channel.reset(); b.channel.reset();
  assert.equal(b.workers.length, 0);
  b.channel.send({ id: 1 });
  const late = b.workers[0].onmessage;
  b.channel.reset(); b.channel.reset();
  assert.equal(b.workers[0].terminated, 1);
  assert.equal(b.faults.length, 0);
  b.channel.send({ id: 2 });
  b.channel.dispose(); b.channel.dispose(); b.channel.reset();
  late({ data: { id: 1 } });
  assert.equal(b.workers[1].terminated, 1);
  assert.equal(b.channel.busy, false);
  assert.equal(b.channel.send({ id: 3 }), false);
  assert.equal(b.workers.length, 2);
  assert.equal(b.clock.timers.size, 0);
  assert.equal(b.results.length, 0);
});

test('missing or invalid IDs fail before creating a worker', () => {
  const b = setup();
  for (const message of [undefined, {}, { id: null }, { id: '' }, { id: NaN }, { id: {} }]) {
    assert.throws(() => b.channel.send(message), /request needs/);
  }
  assert.equal(b.channel.busy, false);
  assert.equal(b.workers.length, 0);
  assert.throws(() => createScanChannel(), /factory is required/);
  assert.throws(() => setup({ timeoutMs: 0 }), /positive finite/);
});

test('result and fault callbacks may explicitly submit another request after cleanup', () => {
  let channel;
  const clock = new Clock(), workers = [];
  channel = createScanChannel({
    workerFactory: () => { const worker = new Worker(); workers.push(worker); return worker; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now,
    onResult: () => { assert.equal(channel.busy, false); assert.equal(channel.send({ id: 2 }), true); },
    onFault: () => { assert.equal(channel.busy, false); assert.equal(channel.send({ id: 3 }), true); },
  });
  channel.send({ id: 1 });
  workers[0].reply({ id: 1 });
  assert.equal(channel.busy, true);
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].messages.map(entry => entry.message.id), [1, 2]);
  workers[0].onerror({ message: 'test failure' });
  assert.equal(channel.busy, true);
  assert.equal(workers.length, 2);
  assert.equal(workers[1].messages[0].message.id, 3);
  channel.dispose();
});

test('worker epoch guards remain effective even when a test factory reuses the worker object', () => {
  const worker = new Worker(), b = setup({ workerFactory: () => worker });
  b.channel.send({ id: 1 });
  const oldReply = worker.onmessage;
  b.channel.reset();
  b.channel.send({ id: 1 });
  oldReply({ data: { id: 1 } });
  assert.equal(b.channel.busy, true);
  assert.equal(b.results.length, 0);
  worker.reply({ id: 1 });
  assert.equal(b.channel.busy, false);
  assert.equal(b.results.length, 1);
});
