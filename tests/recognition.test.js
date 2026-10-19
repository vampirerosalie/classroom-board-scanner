import test from 'node:test';
import assert from 'node:assert/strict';
import { recognize, rasterizeLetter, provider, PROVIDER } from '../src/recognition.js';

function blank(width = 100, height = 120, value = 255, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = value;
    data[index + 3] = alpha;
  }
  return { width, height, data };
}

function draw(image, predicate) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (predicate(x, y)) {
        const index = (y * image.width + x) * 4;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = 0;
      }
    }
  }
  return image;
}

function circleFixture() {
  return draw(blank(), (x, y) => {
    const distance = Math.sqrt(((x - 50) / 31) ** 2 + ((y - 60) / 45) ** 2);
    return distance > 0.86 && distance < 1.03;
  });
}

function assertReview(result) {
  assert.equal(result.provider, provider);
  assert.equal(result.needsReview, true, 'every result must remain unconfirmed');
  assert.match(result.note, /teacher|manually/i);
  assert.ok(result.suggestion === null || 'ABCD'.includes(result.suggestion));
  assert.ok(Array.isArray(result.candidates));
  assert.equal(new Set(result.candidates.map(({ text }) => text)).size, result.candidates.length);
  for (let i = 0; i < result.candidates.length; i += 1) {
    const { text, score } = result.candidates[i];
    assert.match(text, /^[ABCD]$/);
    assert.ok(Number.isFinite(score) && score >= 0 && score <= 1);
    if (i) assert.ok(result.candidates[i - 1].score >= score);
  }
  assert.equal('grade' in result, false);
  assert.equal('correct' in result, false);
}

test('recognizes synthetic A–D from their pixels, always requiring teacher confirmation', async () => {
  assert.equal(PROVIDER, provider);
  for (const letter of 'ABCD') {
    const result = await recognize(rasterizeLetter(letter));
    assertReview(result);
    assert.equal(result.suggestion, letter);
    assert.equal(result.candidates[0].text, letter);
    assert.equal(result.candidates.length, 4);
    assert.match(result.note, /similarities, not probabilities/);
  }
});

test('handles modest synthetic size, slant, stroke and lighting changes without browser APIs', async () => {
  // These are synthetic regression fixtures, not a handwriting accuracy test.
  const variations = [
    { thickness: 0.055 },
    { thickness: 0.125 },
    { slant: 0.12 },
    { rotation: 5 },
    { width: 160, height: 200, padding: 0.2 },
    { width: 320, height: 400, padding: 0.14 },
  ];
  for (const letter of 'ABCD') {
    for (const options of variations) {
      const image = rasterizeLetter(letter, options);
      for (let i = 0; i < image.data.length; i += 4) {
        if (image.data[i] === 0) image.data[i] = image.data[i + 1] = image.data[i + 2] = 110;
      }
      const result = await recognize(image);
      assertReview(result);
      assert.equal(result.suggestion, letter, `${letter} with ${JSON.stringify(options)}`);
    }
  }
});

test('blank, transparent, solid, low-contrast and tiny-noise crops abstain', async () => {
  const lowContrast = rasterizeLetter('A');
  for (let i = 0; i < lowContrast.data.length; i += 4) {
    if (lowContrast.data[i] === 0) lowContrast.data[i] = lowContrast.data[i + 1] = lowContrast.data[i + 2] = 245;
  }
  const images = [
    blank(), blank(100, 120, 0, 0), blank(100, 120, 0),
    lowContrast,
    draw(blank(), (x, y) => x === 50 && y === 60),
    draw(blank(), (x, y) => x > 10 && x < 90 && y > 59 && y < 62),
  ];
  for (const image of images) {
    const result = await recognize(image);
    assertReview(result);
    assert.equal(result.suggestion, null);
  }
});

test('unknown X, round O/0 and ambiguous two-letter crops are not forced into A–D', async () => {
  const xShape = draw(blank(), (x, y) => y > 15 && y < 105 && (
    Math.abs(x - (20 + (y - 15) * 2 / 3)) < 4
    || Math.abs(x - (80 - (y - 15) * 2 / 3)) < 4
  ));
  const left = rasterizeLetter('A');
  const right = rasterizeLetter('D');
  const pair = blank(left.width + right.width + 20, Math.max(left.height, right.height));
  for (const [image, offset] of [[left, 0], [right, left.width + 20]]) {
    for (let y = 0; y < image.height; y += 1) {
      pair.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), (y * pair.width + offset) * 4);
    }
  }
  for (const image of [xShape, circleFixture(), pair]) {
    const result = await recognize(image);
    assertReview(result);
    assert.equal(result.suggestion, null);
  }
});

test('word mode explicitly requires manual entry and never fabricates text', async () => {
  const result = await recognize(rasterizeLetter('A'), { mode: 'word' });
  assertReview(result);
  assert.equal(result.suggestion, null);
  assert.deepEqual(result.candidates, []);
  assert.match(result.note, /Word recognition is not available/);
});

test('diagnostics describe the actual foreground and abstention without changing review requirements', async () => {
  const match = await recognize(rasterizeLetter('A'));
  assert.equal(match.diagnostics.stage, 'template comparison');
  assert.equal(match.diagnostics.inkPreview.length, 32 * 40);
  assert.match(match.diagnostics.inkPreview, /^[01]+$/);
  assert.equal(match.diagnostics.minimumScore, 0.73);
  assert.ok(Number.isFinite(match.diagnostics.aspectRatio));
  assert.equal(match.needsReview, true);
  const wide = await recognize(rasterizeLetter('B', {width:150,height:100}));
  assert.equal(wide.suggestion, null);
  assert.match(wide.diagnostics.decision, /threshold|too close|too similar/);
  const empty = await recognize(blank());
  assert.equal(empty.diagnostics.stage, 'preprocessing');
  const word = await recognize(blank(), {mode:'word'});
  assert.equal(word.diagnostics.stage, 'manual');
});

test('red recolouring alone preserves baseline synthetic letter matches', async () => {
  for(const letter of 'ABCD'){
    const image=rasterizeLetter(letter);
    for(let i=0;i<image.data.length;i+=4)if(image.data[i]===0){image.data[i]=180;image.data[i+1]=45;image.data[i+2]=45;}
    const recognized=await recognize(image);
    assert.equal(recognized.suggestion,letter);
    assert.equal(recognized.needsReview,true);
  }
});

test('does not modify the source RGBA buffer and produces repeatable pixel-based results', async () => {
  const image = rasterizeLetter('C');
  const original = image.data.slice();
  const first = await recognize(image);
  const second = await recognize(image);
  assert.deepEqual(image.data, original);
  assert.deepEqual(first, second);
  const differentPixels = await recognize(rasterizeLetter('D'));
  assert.notEqual(first.suggestion, differentPixels.suggestion);
});

test('validates image shape, memory limits and unsupported mode', async () => {
  await assert.rejects(recognize(null), /dimensions/);
  await assert.rejects(recognize({ width: 0, height: 10, data: [] }), /dimensions/);
  await assert.rejects(recognize({ width: 10.5, height: 10, data: [] }), /dimensions/);
  await assert.rejects(recognize({ width: 10, height: 10, data: new Uint8ClampedArray(3) }), /RGBA/);
  await assert.rejects(recognize({ width: 10000, height: 10000, data: [] }), /too large/);
  await assert.rejects(recognize(blank(), { mode: 'unavailable' }), /Mode/);
});

test('worker preserves request IDs and reports results and errors through its documented protocol', async () => {
  const previousSelf = globalThis.self;
  let handler;
  const messages = [];
  globalThis.self = {
    addEventListener(type, listener) {
      assert.equal(type, 'message');
      handler = listener;
    },
    postMessage(message) { messages.push(message); },
  };
  try {
    await import(`../src/recognition-worker.js?test=${Date.now()}`);
    assert.equal(typeof handler, 'function');
    await handler({ data: { id: 'choice-12', image: rasterizeLetter('B'), mode: 'choice' } });
    assert.equal(messages[0].id, 'choice-12');
    assertReview(messages[0].result);
    assert.equal(messages[0].result.suggestion, 'B');
    await handler({ data: { id: 13, image: null, mode: 'choice' } });
    assert.equal(messages[1].id, 13);
    assert.match(messages[1].error, /dimensions/);
    assert.equal('result' in messages[1], false);
    await handler({ data: { id: 'word-14', mode: 'word' } });
    assert.equal(messages[2].id, 'word-14');
    assert.equal(messages[2].result.suggestion, null);
    assert.equal(messages[2].result.needsReview, true);
  } finally {
    if (previousSelf === undefined) delete globalThis.self;
    else globalThis.self = previousSelf;
  }
});
