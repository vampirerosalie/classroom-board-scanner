import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import {
  createState, activeSession, activeQuestion, addSession, addQuestion,
  captureRecord, applyRecognition, confirmAnswer, armRescan, cancelRescan,
  counts, csvCell, exportCSV, restoreState, normalise,
} from '../src/state.js';
import {
  BOARD, rectCorners, homography, project, fromQR, answerCorners,
  checkGeometry, warpAnswer, assessQuality, StabilityGate,
} from '../src/geometry.js';

const payload = (label = 'first') => ({ crop: `data:image/png;base64,${label}`, quality: { ink: 0.1 }, source: 'synthetic' });
function context() {
  const state = createState();
  return { state, session: activeSession(state), question: activeQuestion(state) };
}
function capture(session, question, pupil = 'S001', label = 'first') {
  const result = captureRecord(session, question, pupil, payload(label));
  assert.equal(result.accepted, true);
  return result.record;
}
function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function pointsNear(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((point, i) => { near(point.x, expected[i].x, tolerance); near(point.y, expected[i].y, tolerance); });
}
const physicalQR = rectCorners({ x: 20, y: 18, width: 42, height: 42 });
const pixelQR = physicalQR.map(({ x, y }) => ({ x: x * 4, y: y * 4 }));
function fixture(name) {
  const png = PNG.sync.read(fs.readFileSync(new URL(`../public/samples/${name}`, import.meta.url)));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}
function decodedCorners(image) {
  const qr = jsQR(image.data, image.width, image.height);
  assert.ok(qr, 'fixture QR must decode');
  const p = qr.location;
  return { id: qr.data, corners: [p.topLeftCorner, p.topRightCorner, p.bottomRightCorner, p.bottomLeftCorner] };
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; i += 1;
    } else cell += c;
  }
  assert.equal(quoted, false, 'CSV quotation must be balanced');
  row.push(cell); rows.push(row);
  return rows;
}

test('first capture locks a record; duplicate frames and unknown pupils cannot overwrite it', () => {
  const { session, question } = context();
  const first = capture(session, question);
  assert.equal(first.locked, true);
  assert.equal(first.status, 'processing');
  assert.equal(first.transcription, null);
  assert.equal(first.result, null);
  assert.equal(captureRecord(session, question, 'S001', payload('duplicate')).accepted, false);
  assert.strictEqual(question.records.S001, first);
  assert.equal(captureRecord(session, question, 'S040', payload()).accepted, false);
  assert.equal(captureRecord(session, question, '=S001', payload()).accepted, false);
  assert.deepEqual(Object.keys(question.records), ['S001']);
});

test('explicitly armed rescans replace once and retain ordered capture history', () => {
  const { session, question } = context();
  const first = capture(session, question);
  applyRecognition(question, 'S001', first.token, { suggestion: 'A' });
  confirmAnswer(question, 'S001', 'A');
  assert.equal(armRescan(question, 'missing'), false);
  assert.equal(armRescan(question, 'S001'), true);
  const second = capture(session, question, 'S001', 'second');
  assert.notEqual(second.token, first.token);
  assert.equal(second.history.length, 1);
  assert.equal(second.history[0].crop, first.crop);
  assert.equal(second.history[0].transcription, 'A');
  assert.equal(second.history[0].result, 'correct');
  assert.equal(second.rescanArmed, false);
  assert.equal(second.transcription, null);
  assert.equal(second.result, null);
  assert.equal(captureRecord(session, question, 'S001', payload('unauthorized-third')).accepted, false);
  armRescan(question, 'S001');
  const third = capture(session, question, 'S001', 'third');
  assert.deepEqual(third.history.map(r => r.token), [first.token, second.token]);
  assert.ok(third.history.every(r => r.history === undefined), 'history must not grow recursively');
  armRescan(question, 'S001'); cancelRescan(question, 'S001');
  assert.equal(captureRecord(session, question, 'S001', payload('cancelled')).accepted, false);
});

test('late recognition from a replaced capture cannot overwrite the replacement', () => {
  const { session, question } = context();
  const first = capture(session, question);
  armRescan(question, 'S001');
  const second = capture(session, question, 'S001', 'second');
  assert.equal(applyRecognition(question, 'S001', first.token, { suggestion: 'B' }), false);
  assert.equal(second.status, 'processing');
  assert.equal(second.suggestion, null);
  assert.equal(applyRecognition(question, 'S001', second.token, { suggestion: 'C' }), true);
  assert.equal(second.suggestion, 'C');
  assert.equal(applyRecognition(question, 'S999', second.token, { suggestion: 'A' }), false);
});

test('teacher-confirmed records resist late recognition and ordinary recapture', () => {
  const { session, question } = context();
  const r = capture(session, question);
  confirmAnswer(question, 'S001', 'B');
  const saved = structuredClone(r);
  assert.equal(applyRecognition(question, 'S001', r.token, { suggestion: 'A', result: 'correct' }), false);
  assert.equal(captureRecord(session, question, 'S001', payload('new')).accepted, false);
  assert.deepEqual(r, saved);
  assert.equal(r.result, 'incorrect');
  confirmAnswer(question, 'S001', 'a');
  assert.equal(r.result, 'correct');
  assert.deepEqual(r.corrections.map(x => x.text), ['B']);
});

test('session and question boundaries keep repeated pupil IDs independent', () => {
  const { state, session: firstSession, question: firstQuestion } = context();
  const old = capture(firstSession, firstQuestion);
  const secondQuestion = addQuestion(firstSession, { prompt: 'Second', mode: 'choice', answers: ['D'] });
  capture(firstSession, secondQuestion);
  const secondSession = addSession(state, 'Second class', 2);
  const secondSessionQuestion = activeQuestion(state);
  capture(secondSession, secondSessionQuestion);
  applyRecognition(firstQuestion, 'S001', old.token, { suggestion: 'A' });
  confirmAnswer(firstQuestion, 'S001', 'A');
  assert.equal(firstQuestion.records.S001.result, 'correct');
  assert.equal(secondQuestion.records.S001.suggestion, null);
  assert.equal(secondSessionQuestion.records.S001.suggestion, null);
  assert.notEqual(secondQuestion.records.S001.token, secondSessionQuestion.records.S001.token);
  assert.equal(activeSession(state), secondSession);
  assert.equal(firstSession.activeQuestionId, secondQuestion.id);
  const rows = parseCSV(exportCSV(state));
  const idColumn = rows[0].indexOf('session_id');
  const questionColumn = rows[0].indexOf('question_id');
  assert.equal(rows.length, 1 + 10 * 2 + 2);
  assert.equal(rows.filter(r => r[idColumn] === firstSession.id && r[questionColumn] === firstQuestion.id).length, 10);
});

test('recognition suggestions never mark answers; only teacher confirmation does', () => {
  const { session, question } = context();
  const a = capture(session, question, 'S001');
  const b = capture(session, question, 'S002');
  applyRecognition(question, 'S001', a.token, { suggestion: 'A', result: 'correct', confidence: 1 });
  applyRecognition(question, 'S002', b.token, { suggestion: 'B', result: 'incorrect', confidence: 1 });
  assert.deepEqual(counts(session, question), { captured: 2, total: 10, review: 2, correct: 0, incorrect: 0, missing: 8 });
  assert.equal(a.result, null);
  assert.equal(a.transcription, null);
  confirmAnswer(question, 'S001', 'A');
  confirmAnswer(question, 'S002', 'B');
  assert.deepEqual(counts(session, question), { captured: 2, total: 10, review: 0, correct: 1, incorrect: 1, missing: 8 });
});

test('confirmation validates choices and normalizes accepted words without auto-marking', () => {
  const { session, question } = context();
  capture(session, question);
  assert.throws(() => confirmAnswer(question, 'S002', 'A'), /Capture/);
  assert.throws(() => confirmAnswer(question, 'S001', ''), /Type/);
  assert.throws(() => confirmAnswer(question, 'S001', 'E'), /A, B, C or D/);
  assert.equal(question.records.S001.result, null);
  const words = addQuestion(session, { prompt: 'Past tense?', mode: 'word', answers: [' WENT ', 'has   gone'] });
  capture(session, words);
  confirmAnswer(words, 'S001', 'ＷＥＮＴ');
  assert.equal(words.records.S001.result, 'correct');
  assert.equal(normalise(' Has\t Gone '), 'has gone');
  assert.throws(() => addQuestion(session, { prompt: 'x', mode: 'choice', answers: ['E'] }), /Choice/);
  assert.throws(() => addQuestion(session, { prompt: 'x', mode: 'word', answers: ['  '] }), /accepted answer/);
});

test('CSV preserves quotes, commas and newlines and neutralizes formula-like fields', () => {
  assert.equal(csvCell('a,"b"\r\nc'), '"a,""b""\r\nc"');
  for (const value of ['=1+2', '+SUM(A1:A2)', '-1+2', '@SUM(A1)', '\t=HYPERLINK("x")', ' \r\n=1']) {
    assert.equal(parseCSV(csvCell(value))[0][0], `'${value}`);
  }
  assert.equal(csvCell(null), '""');
  const { state, session } = context();
  session.name = '=HYPERLINK("https://example.invalid")';
  const q = addQuestion(session, { prompt: 'A "quoted", multiline\nquestion', mode: 'word', answers: ['=2+3'] });
  const r = capture(session, q);
  applyRecognition(q, 'S001', r.token, { suggestion: '+2+3' });
  confirmAnswer(q, 'S001', '=2+3');
  const csv = exportCSV(state);
  assert.ok(csv.startsWith('\uFEFF'));
  const rows = parseCSV(csv), header = rows[0];
  assert.ok(rows.every(row => row.length === 16));
  const row = rows.find(row => row[header.indexOf('question_id')] === q.id && row[header.indexOf('pupil_id')] === 'S001');
  assert.equal(row[header.indexOf('session')], `'${session.name}`);
  assert.equal(row[header.indexOf('question')], q.prompt);
  assert.equal(row[header.indexOf('accepted_answers')], "'=2+3");
  assert.equal(row[header.indexOf('suggestion_unconfirmed')], "'+2+3");
  assert.equal(row[header.indexOf('teacher_transcription')], "'=2+3");
  assert.equal(row[header.indexOf('result')], 'correct');
});

test('CSV leaves unconfirmed result/transcription empty even for confident suggestions', () => {
  const { state, session, question } = context();
  const r = capture(session, question);
  applyRecognition(question, 'S001', r.token, { suggestion: 'A', confidence: 1 });
  const rows = parseCSV(exportCSV(state)), header = rows[0], first = rows[1];
  assert.equal(first[header.indexOf('suggestion_unconfirmed')], 'A');
  assert.equal(first[header.indexOf('teacher_transcription')], '');
  assert.equal(first[header.indexOf('result')], '');
  assert.equal(first[header.indexOf('status')], 'review');
});

test('restoring interrupted processing preserves crops and locks while requiring review', () => {
  const { state, session, question } = context();
  const interrupted = capture(session, question);
  capture(session, question, 'S002'); confirmAnswer(question, 'S002', 'A');
  state.activeSessionId = 'missing-session';
  session.activeQuestionId = 'missing-question';
  const restored = restoreState(JSON.parse(JSON.stringify(state)));
  const restoredSession = activeSession(restored), q = activeQuestion(restored), r = q.records.S001;
  assert.equal(r.status, 'review');
  assert.equal(r.crop, interrupted.crop);
  assert.equal(r.token, interrupted.token);
  assert.equal(r.locked, true);
  assert.equal(r.transcription, null);
  assert.equal(r.result, null);
  assert.match(r.recognition.note, /interrupted/i);
  assert.equal(q.records.S002.status, 'confirmed');
  assert.equal(q.records.S002.result, 'correct');
  assert.equal(captureRecord(restoredSession, q, 'S001', payload('reload-duplicate')).accepted, false);
  assert.throws(() => restoreState({ version: 2, sessions: [] }), /Unsupported/);
  assert.throws(() => restoreState({ version: 1, sessions: [{ id: 'x' }] }), /Incomplete/);
});

test('board contract and QR homography map the full inner answer region exactly', () => {
  assert.deepEqual(BOARD, { width: 297, height: 210, qr: { x: 20, y: 18, size: 42 }, answer: { x: 26, y: 88, width: 245, height: 96 } });
  const h = fromQR(pixelQR);
  pointsNear(physicalQR.map(p => project(h, p)), pixelQR);
  const expected = [{ x: 104, y: 352 }, { x: 1084, y: 352 }, { x: 1084, y: 736 }, { x: 104, y: 736 }];
  pointsNear(answerCorners(pixelQR), expected);
  const fit = checkGeometry(pixelQR, 1188, 840);
  assert.equal(fit.ok, true);
  near(fit.qrPixels, 168);
  pointsNear(fit.answer, expected);
});

test('homography recovers moderate projective skew and rejects degenerate inputs', () => {
  const known = [3.2, 0.12, 90, -0.05, 3.15, 70, 0.00015, 0.00005, 1];
  const corners = physicalQR.map(p => project(known, p));
  const estimated = homography(physicalQR, corners);
  for (const p of [{ x: 26, y: 88 }, { x: 271, y: 184 }, { x: 150, y: 120 }]) {
    pointsNear([project(estimated, p)], [project(known, p)]);
  }
  assert.equal(checkGeometry(corners, 1280, 900).ok, true);
  assert.throws(() => homography(physicalQR.slice(0, 3), corners), /Four corners/);
  assert.throws(() => homography(Array(4).fill({ x: 0, y: 0 }), corners), /Degenerate/);
  assert.throws(() => project([1, 0, 0, 0, 1, 0, 0, 0, 0], { x: 1, y: 1 }), /perspective/);
});

test('geometry rejects clipped answer areas, small QRs, extreme skew and mirrored order', () => {
  const clipped = checkGeometry(pixelQR, 1000, 840);
  assert.equal(clipped.ok, false);
  assert.match(clipped.reason, /whole answer area/);
  const small = physicalQR.map(({ x, y }) => ({ x: x * 1.4, y: y * 1.4 }));
  assert.match(checkGeometry(small, 1188, 840).reason, /too small/);
  assert.equal(checkGeometry([{ x: 80, y: 72 }, { x: 248, y: 72 }, { x: 165, y: 240 }, { x: 80, y: 240 }], 1188, 840).ok, false);
  assert.equal(checkGeometry([pixelQR[1], pixelQR[0], pixelQR[3], pixelQR[2]], 1600, 1200).ok, false);
  assert.equal(checkGeometry([{ x: NaN, y: 0 }, ...pixelQR.slice(1)], 1188, 840).ok, false);
  assert.equal(checkGeometry(null, 1188, 840).ok, false);
  const horizon = [4, 0, 200, 0, 4, 200, 0, -1 / 130, 1];
  assert.equal(checkGeometry(physicalQR.map(p => project(horizon, p)), 10000, 10000).ok, false);
});

test('all full-board synthetic fixtures decode and their warped answer crops pass quality', () => {
  // Typeset synthetic smoke tests only. They do not establish handwriting accuracy.
  for (const [id, answer] of [['S001', 'A'], ['S002', 'B'], ['S003', 'C'], ['S004', 'D'], ['S005', 'went']]) {
    const image = fixture(`synthetic-${id}-${answer}.png`);
    assert.equal(image.width, 1188); assert.equal(image.height, 840);
    const decoded = decodedCorners(image);
    assert.equal(decoded.id, id);
    pointsNear(decoded.corners, pixelQR, 0.01);
    const fit = checkGeometry(decoded.corners, image.width, image.height);
    assert.equal(fit.ok, true);
    const crop = warpAnswer(image, fit.h);
    assert.equal(crop.width, 640); assert.equal(crop.height, 251);
    assert.equal(crop.data.length, 640 * 251 * 4);
    const quality = assessQuality(crop);
    assert.equal(quality.ok, true, `${id}: ${quality.reason}`);
    assert.ok(Number.isFinite(quality.sharpness));
  }
});

test('blank board yields a pure-white crop and cannot pass quality checks', () => {
  const image = fixture('synthetic-S001-blank.png');
  const decoded = decodedCorners(image);
  const fit = checkGeometry(decoded.corners, image.width, image.height);
  assert.equal(fit.ok, true);
  const crop = warpAnswer(image, fit.h);
  assert.ok(crop.data.every(v => v === 255), 'no frame or instruction may leak into the crop');
  const quality = assessQuality(crop);
  assert.equal(quality.ok, false);
  assert.equal(quality.ink, 0);
  assert.match(quality.reason, /No clear dark writing/);
  const dark = { ...crop, data: new Uint8ClampedArray(crop.data.length) };
  assert.equal(assessQuality(dark).ok, false);
});

test('stability requires sustained same-pupil detection and resets for movement or gaps', () => {
  const gate = new StabilityGate();
  assert.equal(Boolean(gate.update('S001', pixelQR, 1000)), false);
  assert.equal(Boolean(gate.update('S001', pixelQR, 1100)), false);
  assert.equal(gate.update('S001', pixelQR, 1240), true);
  assert.equal(Boolean(gate.update('S002', pixelQR, 1300)), false);
  assert.equal(gate.update('S002', pixelQR, 1540), true);
  assert.equal(Boolean(gate.update('S002', pixelQR, 2300)), false);
  const moved = pixelQR.map(p => ({ x: p.x + 20, y: p.y }));
  assert.equal(Boolean(gate.update('S002', moved, 2400)), false);
  gate.reset();
  assert.equal(Boolean(gate.update('S002', moved, 2700)), false);
});

test('stale grades on unconfirmed saved records are never counted or exported and are cleared on restore', () => {
  const { state, session, question } = context();
  const processing = capture(session, question, 'S001');
  const review = capture(session, question, 'S002');
  const confirmed = capture(session, question, 'S003');
  processing.result = 'correct'; processing.transcription = 'stale A';
  review.status = 'review'; review.result = 'incorrect'; review.transcription = 'stale B';
  confirmAnswer(question, 'S003', 'A');
  const before = counts(session, question);
  assert.equal(before.correct, 1, 'only the genuinely confirmed grade may count');
  assert.equal(before.incorrect, 0);
  assert.equal(before.review, 2);
  const rows = parseCSV(exportCSV(state)), header = rows[0];
  const studentColumn = header.indexOf('pupil_id'), resultColumn = header.indexOf('result');
  assert.equal(rows.find(r => r[studentColumn] === 'S001')[resultColumn], '');
  assert.equal(rows.find(r => r[studentColumn] === 'S002')[resultColumn], '');
  assert.equal(rows.find(r => r[studentColumn] === 'S003')[resultColumn], 'correct');
  const restored = restoreState(structuredClone(state)), restoredQuestion = activeQuestion(restored);
  for (const id of ['S001', 'S002']) {
    assert.equal(restoredQuestion.records[id].status, 'review');
    assert.equal(restoredQuestion.records[id].transcription, null);
    assert.equal(restoredQuestion.records[id].result, null);
  }
  assert.equal(restoredQuestion.records.S003.transcription, confirmed.transcription);
  assert.equal(restoredQuestion.records.S003.result, 'correct');
  assert.equal(counts(activeSession(restored), restoredQuestion).correct, 1);
});

test('quality rejects tiny, malformed and missing pixel buffers instead of passing NaN metrics', () => {
  const tinyPreviouslyPassed = {
    width: 3, height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
  };
  const invalid = [
    tinyPreviouslyPassed, null, {},
    { width: 0, height: 0, data: new Uint8ClampedArray() },
    { width: 8.5, height: 8, data: new Uint8ClampedArray(272) },
    { width: -8, height: 8, data: new Uint8ClampedArray() },
    { width: 8, height: 8 },
    { width: 8, height: 8, data: new Uint8ClampedArray(255) },
    { width: 8, height: 8, data: new Uint8ClampedArray(257) },
    { width: NaN, height: 8, data: new Uint8ClampedArray(256) },
  ];
  for (const image of invalid) {
    const result = assessQuality(image);
    assert.equal(result.ok, false);
    assert.match(result.reason, /invalid|tiny/i);
  }
});

function rotateClockwise(image) {
  const width = image.height, height = image.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const target = (x * width + image.height - 1 - y) * 4;
      data.set(image.data.subarray(source, source + 4), target);
    }
  }
  return { width, height, data };
}

test('90, 180 and 270 degree full-board rotations decode and rectify upright answer crops', () => {
  // Pixel rotations exercise the real jsQR path, not fabricated corner arrays.
  for (const [id, answer] of [['S001', 'A'], ['S002', 'B'], ['S003', 'C'], ['S004', 'D'], ['S005', 'went']]) {
    const original = fixture(`synthetic-${id}-${answer}.png`);
    const baseline = warpAnswer(original, fromQR(pixelQR));
    let rotated = original, expectedCorners = pixelQR;
    for (const degrees of [90, 180, 270]) {
      expectedCorners = expectedCorners.map(({ x, y }) => ({ x: rotated.height - y, y: x }));
      rotated = rotateClockwise(rotated);
      const decoded = decodedCorners(rotated);
      assert.equal(decoded.id, id, `${id} at ${degrees} degrees`);
      pointsNear(decoded.corners, expectedCorners, 0.01);
      const fit = checkGeometry(decoded.corners, rotated.width, rotated.height);
      assert.equal(fit.ok, true, `${id} at ${degrees}: ${fit.reason}`);
      const crop = warpAnswer(rotated, fit.h);
      assert.equal(assessQuality(crop).ok, true);
      let difference = 0;
      for (let i = 0; i < crop.data.length; i += 4) difference += Math.abs(crop.data[i] - baseline.data[i]);
      const meanDifference = difference / (crop.width * crop.height);
      assert.ok(meanDifference < 4, `${id} at ${degrees}: upright crop differs by ${meanDifference}`);
    }
  }
});
