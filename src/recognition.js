/**
 * An entirely local, experimental matcher for a single dark, block-capital
 * A/B/C/D on a light background. No OCR service, model download, canvas, or
 * network is used. Prototypes below are original geometric stroke drawings,
 * not a handwriting training set. Neat printing may work; handwriting,
 * joined letters, arbitrary words, shadows and complex backgrounds are not
 * supported reliably.
 *
 * Scores measure similarity to these prototypes. They are NOT calibrated
 * confidence values or probabilities. Thresholds are conservative heuristics,
 * not an accuracy claim. A suggestion always requires teacher confirmation;
 * callers must never treat it as a mark or an accepted answer automatically.
 */

export const provider = 'local-template-v1';
export const PROVIDER = provider;

const LETTERS = Object.freeze(['A', 'B', 'C', 'D']);
// These are abstention references, never answer labels. A tiny alphabet should
// not force a round O/0 into D or a two-loop 8 into B just because it is closest.
const REJECTION_SHAPES = Object.freeze(['O', '8']);
const GRID_WIDTH = 32;
const GRID_HEIGHT = 40;
const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT;
const MAX_PROCESSING_SIDE = 224;
const MAX_INPUT_PIXELS = 32_000_000;
const MIN_MATCH_SCORE = 0.73;
const MIN_MATCH_MARGIN = 0.045;
const MIN_REJECTION_MARGIN = 0.025;
const REVIEW_NOTE = 'Experimental local shape match; scores are similarities, not probabilities. A teacher must confirm every answer.';
let prototypeCache;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Make the common result shape explicit, including when we abstain. */
function result(suggestion = null, candidates = [], note = REVIEW_NOTE, diagnostics = {}) {
  return { provider, suggestion, candidates, needsReview: true, note, diagnostics };
}

function validateImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1) {
    throw new TypeError('Recognition needs positive integer image dimensions.');
  }
  const pixels = image.width * image.height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_INPUT_PIXELS) {
    throw new RangeError('Image is too large for the local matcher. Crop or resize it first.');
  }
  if (!image.data || typeof image.data.length !== 'number' || image.data.length < pixels * 4) {
    throw new TypeError('Recognition needs one RGBA value for every image pixel.');
  }
}

/** Otsu threshold; alpha is composited over white before calling this. */
function otsuThreshold(histogram, count) {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 0;
  for (let i = 0; i < 255; i += 1) {
    backgroundCount += histogram[i];
    backgroundSum += i * histogram[i];
    if (!backgroundCount) continue;
    const foregroundCount = count - backgroundCount;
    if (!foregroundCount) break;
    const difference = backgroundSum / backgroundCount - (sum - backgroundSum) / foregroundCount;
    const variance = backgroundCount * foregroundCount * difference * difference;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = i;
    }
  }
  return threshold;
}

function percentile(histogram, fraction, total) {
  let count = 0;
  for (let i = 0; i < 256; i += 1) {
    count += histogram[i];
    if (count >= total * fraction) return i;
  }
  return 255;
}

/** Find 8-connected foreground regions without depending on browser APIs. */
function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = index;
    visited[index] = 1;
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const current = queue[head++];
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (!visited[next] && mask[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    components.push({ pixels, minX, minY, maxX, maxY });
  }
  return components.sort((a, b) => b.pixels.length - a.pixels.length);
}

/** Area resampling retains thin strokes, with a centered aspect-preserving fit. */
function normalizeMask(mask, width, bounds) {
  const sourceWidth = bounds.maxX - bounds.minX + 1;
  const sourceHeight = bounds.maxY - bounds.minY + 1;
  const scale = Math.min((GRID_WIDTH - 6) / sourceWidth, (GRID_HEIGHT - 6) / sourceHeight);
  const left = (GRID_WIDTH - sourceWidth * scale) / 2;
  const top = (GRID_HEIGHT - sourceHeight * scale) / 2;
  const normalized = new Uint8Array(GRID_SIZE);
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    const y0 = Math.max(bounds.minY, (y - top) / scale + bounds.minY);
    const y1 = Math.min(bounds.maxY + 1, (y + 1 - top) / scale + bounds.minY);
    if (y1 <= y0) continue;
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const x0 = Math.max(bounds.minX, (x - left) / scale + bounds.minX);
      const x1 = Math.min(bounds.maxX + 1, (x + 1 - left) / scale + bounds.minX);
      if (x1 <= x0) continue;
      let ink = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const overlapY = Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const overlapX = Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx));
          ink += (mask[sy * width + sx] || 0) * overlapX * overlapY;
        }
      }
      // The full pixel area avoids enlarging partially covered edge pixels.
      normalized[y * GRID_WIDTH + x] = ink * scale * scale >= 0.3 ? 1 : 0;
    }
  }
  return normalized;
}

function preprocess(image) {
  const resize = Math.min(1, MAX_PROCESSING_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * resize));
  const height = Math.max(1, Math.round(image.height * resize));
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      // Multiple samples reduce aliasing when shrinking a camera crop.
      const samples = resize < 1 ? 2 : 1;
      for (let sy = 0; sy < samples; sy += 1) {
        const sourceY = Math.min(image.height - 1, Math.floor((y + (sy + 0.5) / samples) * image.height / height));
        for (let sx = 0; sx < samples; sx += 1) {
          const sourceX = Math.min(image.width - 1, Math.floor((x + (sx + 0.5) / samples) * image.width / width));
          const index = (sourceY * image.width + sourceX) * 4;
          const alpha = image.data[index + 3] / 255;
          const luminance = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
          value += luminance * alpha + 255 * (1 - alpha);
        }
      }
      value = Math.round(value / (samples * samples));
      gray[y * width + x] = value;
      histogram[value] += 1;
    }
  }
  let darkest = 0;
  while (darkest < 255 && !histogram[darkest]) darkest += 1;
  const background = percentile(histogram, 0.9, gray.length);
  if (background - darkest < 20) return { reason: 'No clear dark letter was found. Use a well-lit, light background or enter the answer manually.' };
  const threshold = Math.min(otsuThreshold(histogram, gray.length), background - 12);
  const mask = Uint8Array.from(gray, (value) => value <= threshold ? 1 : 0);
  const components = connectedComponents(mask, width, height);
  const largest = components[0];
  if (!largest || largest.pixels.length < 8) return { reason: 'Not enough visible ink was found. Move closer or enter the answer manually.' };

  const minimumRegion = Math.max(3, largest.pixels.length * 0.02);
  const retained = components.filter((component) => component.pixels.length >= minimumRegion);
  const majorRegions = retained.filter((component) => component.pixels.length >= largest.pixels.length * 0.2);
  if (majorRegions.length > 1) return { reason: 'More than one separate ink shape was found. Crop to one A, B, C or D, or enter the answer manually.' };

  const clean = new Uint8Array(mask.length);
  // Use the largest connected shape, excluding isolated dust and margin marks.
  for (const index of largest.pixels) clean[index] = 1;
  const boxWidth = largest.maxX - largest.minX + 1;
  const boxHeight = largest.maxY - largest.minY + 1;
  const aspect = boxWidth / boxHeight;
  const density = largest.pixels.length / (boxWidth * boxHeight);
  if (boxWidth < 4 || boxHeight < 8 || aspect < 0.22 || aspect > 1.6 || density > 0.82) {
    return { reason: 'Could not confidently recognise this writing. Please confirm the letter.' };
  }
  if (largest.pixels.length / mask.length > 0.7) return { reason: 'Too much of the crop is dark. Use a light background and include space around one letter.' };
  return { mask: normalizeMask(clean, width, largest), aspect, density };
}

/** Two-pass chamfer distance transform in grid-pixel units. */
function distanceTransform(mask) {
  const distances = Float32Array.from(mask, (value) => value ? 0 : 1000);
  const diagonal = Math.SQRT2;
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const i = y * GRID_WIDTH + x;
      let d = distances[i];
      if (x) d = Math.min(d, distances[i - 1] + 1);
      if (y) {
        d = Math.min(d, distances[i - GRID_WIDTH] + 1);
        if (x) d = Math.min(d, distances[i - GRID_WIDTH - 1] + diagonal);
        if (x + 1 < GRID_WIDTH) d = Math.min(d, distances[i - GRID_WIDTH + 1] + diagonal);
      }
      distances[i] = d;
    }
  }
  for (let y = GRID_HEIGHT - 1; y >= 0; y -= 1) {
    for (let x = GRID_WIDTH - 1; x >= 0; x -= 1) {
      const i = y * GRID_WIDTH + x;
      let d = distances[i];
      if (x + 1 < GRID_WIDTH) d = Math.min(d, distances[i + 1] + 1);
      if (y + 1 < GRID_HEIGHT) {
        d = Math.min(d, distances[i + GRID_WIDTH] + 1);
        if (x) d = Math.min(d, distances[i + GRID_WIDTH - 1] + diagonal);
        if (x + 1 < GRID_WIDTH) d = Math.min(d, distances[i + GRID_WIDTH + 1] + diagonal);
      }
      distances[i] = d;
    }
  }
  return distances;
}

function countHoles(mask) {
  const visited = new Uint8Array(GRID_SIZE);
  const queue = new Int32Array(GRID_SIZE);
  const holes = [];
  for (let index = 0; index < GRID_SIZE; index += 1) {
    if (mask[index] || visited[index]) continue;
    let head = 0;
    let tail = 1;
    let touchesEdge = false;
    let area = 0;
    let centerY = 0;
    queue[0] = index;
    visited[index] = 1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % GRID_WIDTH;
      const y = Math.floor(current / GRID_WIDTH);
      touchesEdge ||= x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1;
      area += 1;
      centerY += y;
      // Four-connected background preserves diagonally closed ink loops.
      const neighbors = [];
      if (x) neighbors.push(current - 1);
      if (x + 1 < GRID_WIDTH) neighbors.push(current + 1);
      if (y) neighbors.push(current - GRID_WIDTH);
      if (y + 1 < GRID_HEIGHT) neighbors.push(current + GRID_WIDTH);
      for (const next of neighbors) {
        if (!mask[next] && !visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (!touchesEdge && area >= 5) holes.push({ area, centerY: centerY / area / GRID_HEIGHT });
  }
  return holes;
}

function features(mask) {
  const row = new Float32Array(GRID_HEIGHT);
  const column = new Float32Array(GRID_WIDTH);
  const ink = [];
  for (let i = 0; i < GRID_SIZE; i += 1) {
    if (mask[i]) {
      ink.push(i);
      row[Math.floor(i / GRID_WIDTH)] += 1;
      column[i % GRID_WIDTH] += 1;
    }
  }
  return { mask, row, column, ink, distances: distanceTransform(mask), holes: countHoles(mask) };
}

function lineDistanceSquared(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return (px - a[0] - t * dx) ** 2 + (py - a[1] - t * dy) ** 2;
}

function arc(cx, cy, rx, ry, start, end, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + (end - start) * i / steps;
    return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
  });
}

function letterPaths(letter, variant) {
  if (letter === 'A') {
    const crossbar = variant === 1 ? 0.56 : variant === 2 ? 0.68 : 0.62;
    return [
      variant === 2 ? [[0.12, 0.92], [0.43, 0.09], [0.57, 0.09], [0.88, 0.92]] : [[0.12, 0.92], [0.5, 0.08], [0.88, 0.92]],
      [[0.12 + (0.92 - crossbar) * 0.38 / 0.84, crossbar], [0.88 - (0.92 - crossbar) * 0.38 / 0.84, crossbar]],
    ];
  }
  if (letter === 'B') {
    const middle = variant === 1 ? 0.46 : 0.5;
    const right = variant === 2 ? 0.78 : 0.84;
    return [
      [[0.18, 0.08], [0.18, 0.92]],
      [[0.18, 0.08], [0.51, 0.08], ...arc(0.51, (0.08 + middle) / 2, right - 0.51, (middle - 0.08) / 2, -Math.PI / 2, Math.PI / 2), [0.18, middle]],
      [[0.18, middle], [0.53, middle], ...arc(0.53, (middle + 0.92) / 2, right + 0.035 - 0.53, (0.92 - middle) / 2, -Math.PI / 2, Math.PI / 2), [0.18, 0.92]],
    ];
  }
  if (letter === 'C') {
    const gap = variant === 1 ? 0.31 * Math.PI : variant === 2 ? 0.18 * Math.PI : 0.24 * Math.PI;
    return [arc(0.51, 0.5, 0.37, 0.42, -gap, -(Math.PI * 2 - gap), 42)];
  }
  if (letter === 'D') {
    const centerX = variant === 1 ? 0.35 : variant === 2 ? 0.47 : 0.42;
    return [
      [[0.18, 0.08], [0.18, 0.92]],
      [[0.18, 0.08], [centerX, 0.08], ...arc(centerX, 0.5, 0.88 - centerX, 0.42, -Math.PI / 2, Math.PI / 2, 32), [0.18, 0.92]],
    ];
  }
  if (letter === 'O') {
    return [arc(0.5, 0.5, variant === 1 ? 0.3 : variant === 2 ? 0.4 : 0.36, 0.42, 0, Math.PI * 2, 48)];
  }
  if (letter === '8') {
    const middle = variant === 1 ? 0.46 : 0.5;
    return [
      arc(0.5, (0.08 + middle) / 2, variant === 2 ? 0.29 : 0.32, (middle - 0.08) / 2, 0, Math.PI * 2, 32),
      arc(0.5, (middle + 0.92) / 2, 0.35, (0.92 - middle) / 2, 0, Math.PI * 2, 32),
    ];
  }
  throw new RangeError('The local matcher only has A, B, C and D prototypes.');
}

/**
 * Original geometric fixture renderer, also useful for transparent tests.
 * This is not a handwriting generator or evidence of real-world accuracy.
 */
export function rasterizeLetter(letter, options = {}) {
  if (!LETTERS.includes(letter)) throw new RangeError('Expected A, B, C or D.');
  return rasterizeGlyph(letter, options);
}

function rasterizeGlyph(letter, options = {}) {
  const width = options.width ?? 80;
  const height = options.height ?? 100;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width * height > 1_000_000) {
    throw new RangeError('Fixture dimensions must be integers of at least 8 pixels and at most one million total pixels.');
  }
  const thickness = options.thickness ?? 0.085;
  const slant = options.slant ?? 0;
  const variant = options.variant ?? 0;
  const angle = (options.rotation ?? 0) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const radiusSquared = (thickness / 2) ** 2;
  const paths = letterPaths(letter, variant);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const padding = options.padding ?? 0.08;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let px = ((x + 0.5) / width - padding) / (1 - 2 * padding);
      let py = ((y + 0.5) / height - padding) / (1 - 2 * padding);
      const rotatedX = (px - 0.5) * cosine + (py - 0.5) * sine + 0.5;
      py = -(px - 0.5) * sine + (py - 0.5) * cosine + 0.5;
      px = rotatedX - slant * (0.5 - py);
      let distance = Infinity;
      for (const path of paths) {
        for (let i = 1; i < path.length; i += 1) distance = Math.min(distance, lineDistanceSquared(px, py, path[i - 1], path[i]));
      }
      if (distance <= radiusSquared) {
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = 0;
      }
    }
  }
  return { width, height, data };
}

function prototypes() {
  if (prototypeCache) return prototypeCache;
  prototypeCache = [];
  for (const letter of [...LETTERS, ...REJECTION_SHAPES]) {
    for (const variant of [0, 1, 2]) {
      for (const thickness of [0.055, 0.09, 0.13, 0.17]) {
        for (const slant of [-0.1, 0, 0.1]) {
          const sample = preprocess(rasterizeGlyph(letter, { variant, thickness, slant }));
          if (sample.mask) prototypeCache.push({ letter, ...features(sample.mask) });
        }
      }
    }
  }
  return prototypeCache;
}

function similarity(sample, template) {
  let sampleDistance = 0;
  let templateDistance = 0;
  let intersection = 0;
  for (const index of sample.ink) {
    sampleDistance += Math.min(template.distances[index], 10);
    intersection += template.mask[index];
  }
  for (const index of template.ink) templateDistance += Math.min(sample.distances[index], 10);
  const distance = (sampleDistance / sample.ink.length + templateDistance / template.ink.length) / 2;
  const chamfer = Math.exp(-distance / 2.2);
  const overlap = intersection / (sample.ink.length + template.ink.length - intersection);
  let projectionDifference = 0;
  for (let i = 0; i < GRID_HEIGHT; i += 1) projectionDifference += Math.abs(sample.row[i] / sample.ink.length - template.row[i] / template.ink.length);
  for (let i = 0; i < GRID_WIDTH; i += 1) projectionDifference += Math.abs(sample.column[i] / sample.ink.length - template.column[i] / template.ink.length);
  const projection = Math.max(0, 1 - projectionDifference / 2);
  let structure = sample.holes.length === template.holes.length ? 1 : 0;
  if (sample.holes.length === 1 && template.holes.length === 1) {
    structure *= Math.max(0, 1 - Math.abs(sample.holes[0].centerY - template.holes[0].centerY) * 2);
  }
  // Penalize an open/closed mismatch instead of manufacturing certainty from
  // the closest member of an alphabet that only contains four possibilities.
  const topologyPenalty = sample.holes.length === template.holes.length ? 0 : 0.055;
  return clamp(0.55 * chamfer + 0.25 * overlap + 0.14 * projection + 0.06 * structure - topologyPenalty, 0, 1);
}

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image RGBA pixels
 * @param {{mode?:'choice'|'word'}} options
 * @returns {Promise<{provider:string,suggestion:string|null,candidates:Array<{text:string,score:number}>,needsReview:true,note:string}>}
 */
export async function recognize(image, { mode = 'choice' } = {}) {
  if (mode !== 'choice' && mode !== 'word') throw new RangeError('Mode must be choice or word.');
  if (mode === 'word') {
    return result(null, [], 'Word recognition is not available in this local provider. Read and enter the answer manually; a teacher must confirm it.', {stage:'manual',decision:'Word transcription is manual in this pilot.'});
  }
  validateImage(image);
  const prepared = preprocess(image);
  if (!prepared.mask) return result(null, [], `${prepared.reason} ${REVIEW_NOTE}`, {stage:'preprocessing',decision:prepared.reason});
  const sample = features(prepared.mask);
  const bestByLetter = Object.fromEntries(LETTERS.map((letter) => [letter, 0]));
  let rejectionScore = 0;
  for (const template of prototypes()) {
    const score = similarity(sample, template);
    if (REJECTION_SHAPES.includes(template.letter)) rejectionScore = Math.max(rejectionScore, score);
    else bestByLetter[template.letter] = Math.max(bestByLetter[template.letter], score);
  }
  const ranked = LETTERS.map((text) => ({ text, score: bestByLetter[text] })).sort((a, b) => b.score - a.score);
  const isClearEnough = ranked[0].score >= MIN_MATCH_SCORE
    && ranked[0].score - ranked[1].score >= MIN_MATCH_MARGIN
    && ranked[0].score - rejectionScore >= MIN_REJECTION_MARGIN;
  const candidates = ranked.map(({ text, score }) => ({ text, score: Math.round(score * 1000) / 1000 }));
  const failures=[];
  if(ranked[0].score<MIN_MATCH_SCORE)failures.push('Shape similarity is below the experimental threshold');
  if(ranked[0].score-ranked[1].score<MIN_MATCH_MARGIN)failures.push('Two letter shapes are too close to separate');
  if(ranked[0].score-rejectionScore<MIN_REJECTION_MARGIN)failures.push('An O/8 rejection shape is too similar');
  return result(isClearEnough ? ranked[0].text : null, candidates,
    isClearEnough ? REVIEW_NOTE : `No clear match. Read the image and choose the answer yourself. ${REVIEW_NOTE}`, {
      stage:'template comparison',decision:isClearEnough?'Suggested only; teacher confirmation still required.':failures.join('. ')+'.',
      bestScore:ranked[0].score,runnerUpScore:ranked[1].score,rejectionScore,
      minimumScore:MIN_MATCH_SCORE,minimumLetterMargin:MIN_MATCH_MARGIN,minimumRejectionMargin:MIN_REJECTION_MARGIN,
      aspectRatio:prepared.aspect,inkDensity:prepared.density,closedRegions:sample.holes.length,
      previewWidth:GRID_WIDTH,previewHeight:GRID_HEIGHT,inkPreview:Array.from(prepared.mask).join(''),
    });
}
