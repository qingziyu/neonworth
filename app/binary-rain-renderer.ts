// Independently authored decorative renderer. The only glyph inputs are 0/1;
// no report, financial value, account identifier or source text enters this API.
export const RAIN_LIMITS = Object.freeze({
  fps: 30, dpr: 1.5, pixels: 2_000_000, columns: 72, narrowColumns: 32,
  cells: 24, maxDimension: 16_384, maxDeltaMs: 80,
});
type Dimensions = { width: number; height: number; pixelWidth: number; pixelHeight: number; scale: number };
type Stream = {
  x: number; y: number; depth: number; length: number; speed: number; spacing: number;
  color: number; glyphs: Uint8Array; changes: Float64Array;
};
export type BinaryRainModel = { width: number; height: number; age: number; seed: number; streams: Stream[] };
export type BinaryRainRenderer = { setActive(active: boolean): void; dispose(): void };

export function binaryRainDimensions(width: number, height: number, dpr: number): Dimensions | null {
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= RAIN_LIMITS.maxDimension)) return null;
  const scale = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, RAIN_LIMITS.dpr,
    Math.sqrt(RAIN_LIMITS.pixels / (width * height)));
  const pixelWidth = Math.max(1, Math.floor(width * scale));
  const pixelHeight = Math.max(1, Math.floor(height * scale));
  if (pixelWidth * pixelHeight > RAIN_LIMITS.pixels) return null;
  return { width, height, pixelWidth, pixelHeight, scale };
}
function random(model: BinaryRainModel) {
  model.seed = (Math.imul(model.seed, 1664525) + 1013904223) >>> 0;
  return model.seed / 4294967296;
}
function configureStream(model: BinaryRainModel, stream: Stream) {
  stream.length = 8 + Math.floor(random(model) * 17);
  stream.speed = [65, 105, 150][stream.depth] + random(model) * 35;
  for (let index = 0; index < RAIN_LIMITS.cells; index++) {
    stream.glyphs[index] = random(model) < .5 ? 0 : 1;
    stream.changes[index] = model.age + 90 + random(model) * 640;
  }
}
export function createBinaryRainModel(width: number, height: number): BinaryRainModel {
  const model: BinaryRainModel = { width, height, age: 0, seed: 0x6d617472, streams: [] };
  if (!binaryRainDimensions(width, height, 1)) return model;
  const count = Math.min(width <= 600 ? RAIN_LIMITS.narrowColumns : RAIN_LIMITS.columns,
    Math.max(6, Math.floor(width / 23)));
  for (let index = 0; index < count; index++) {
    const depth = index % 3;
    const stream: Stream = { x: (index + .35 + random(model) * .3) * width / count, y: 0,
      depth, length: 0, speed: 0, spacing: [16, 19, 22][depth], color: random(model) < .5 ? 0 : 1,
      glyphs: new Uint8Array(RAIN_LIMITS.cells), changes: new Float64Array(RAIN_LIMITS.cells) };
    configureStream(model, stream);
    stream.y = random(model) * (height + stream.length * stream.spacing);
    model.streams.push(stream);
  }
  return model;
}
export function advanceBinaryRain(model: BinaryRainModel, elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  const delta = Math.min(elapsedMs, RAIN_LIMITS.maxDeltaMs);
  model.age += delta;
  for (const stream of model.streams) {
    stream.y += stream.speed * delta / 1000;
    if (stream.y > model.height + stream.length * stream.spacing + 30) {
      configureStream(model, stream);
      stream.y = -30 - random(model) * 90;
    }
    // Independent deadlines change cells inside a moving tail, rather than
    // sliding an unchanged string through an entire stream period.
    for (let index = 0; index < stream.length; index++) if (model.age >= stream.changes[index]) {
      stream.glyphs[index] ^= 1;
      stream.changes[index] = model.age + 90 + random(model) * 640;
    }
  }
}

const TILE_WIDTH = 32, TILE_HEIGHT = 40;
const COLORS = ['#38de89', '#28c4af', '#e5fff6'];
type Atlas = { canvas: HTMLCanvasElement; scale: number };
function makeAtlas(document: Document, scale: number): Atlas | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(TILE_WIDTH * 6 * scale);
  canvas.height = Math.ceil(TILE_HEIGHT * 3 * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.textAlign = 'center'; context.textBaseline = 'alphabetic';
  for (let depth = 0; depth < 3; depth++) {
    context.font = `600 ${[12, 15, 18][depth]}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
    for (let color = 0; color < COLORS.length; color++) for (let digit = 0; digit < 2; digit++) {
      const x = (color * 2 + digit) * TILE_WIDTH + 16, y = depth * TILE_HEIGHT + 26;
      context.fillStyle = COLORS[color];
      if (color === 2) {
        context.shadowColor = '#63ffd4'; context.shadowBlur = 4;
        context.fillText(digit === 0 ? '0' : '1', x, y);
      }
      context.shadowBlur = 0;
      context.fillText(digit === 0 ? '0' : '1', x, y);
    }
  }
  return { canvas, scale };
}
function paint(context: CanvasRenderingContext2D, dimensions: Dimensions, atlas: Atlas, model: BinaryRainModel) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, dimensions.pixelWidth, dimensions.pixelHeight);
  context.setTransform(dimensions.pixelWidth / dimensions.width, 0, 0, dimensions.pixelHeight / dimensions.height, 0, 0);
  for (const stream of model.streams) for (let index = stream.length - 1; index >= 0; index--) {
    const y = stream.y - index * stream.spacing;
    if (y < -TILE_HEIGHT || y > dimensions.height + TILE_HEIGHT) continue;
    const color = index === 0 ? 2 : stream.color;
    const depthOpacity = [.42, .66, .94][stream.depth];
    context.globalAlpha = index === 0 ? depthOpacity : depthOpacity * .8 * Math.pow(1 - index / stream.length, 1.35);
    context.drawImage(atlas.canvas, (color * 2 + stream.glyphs[index]) * TILE_WIDTH * atlas.scale,
      stream.depth * TILE_HEIGHT * atlas.scale, TILE_WIDTH * atlas.scale, TILE_HEIGHT * atlas.scale,
      stream.x - 16, y - 26, TILE_WIDTH, TILE_HEIGHT);
  }
  context.globalAlpha = 1;
}

/** Owns one canvas, one small atlas and at most one RAF. Policy stays external. */
export function createBinaryRainRenderer(canvas: HTMLCanvasElement): BinaryRainRenderer | null {
  const document = canvas.ownerDocument, ownerView = document.defaultView;
  if (!ownerView || typeof ownerView.requestAnimationFrame !== 'function' || typeof ownerView.cancelAnimationFrame !== 'function' ||
    typeof ownerView.addEventListener !== 'function' || typeof ownerView.removeEventListener !== 'function' ||
    typeof canvas.addEventListener !== 'function' || typeof canvas.removeEventListener !== 'function') return null;
  const view = ownerView;
  let context: CanvasRenderingContext2D | null;
  try { context = canvas.getContext('2d', { alpha: true }); } catch { return null; }
  if (!context) return null;
  const context2d = context;
  let dimensions: Dimensions | null = null, atlas: Atlas | null = null, model: BinaryRainModel | null = null;
  let active = false, disposed = false, failed = false, dirty = true, pending: number | null = null;
  let lastPaint: number | null = null, generation = 0;
  const clearReady = () => { delete canvas.dataset.ready; };
  const cancel = () => {
    generation++;
    if (pending !== null) { try { view.cancelAnimationFrame(pending); } catch { /* Stale callback remains generation-guarded. */ } }
    pending = null; lastPaint = null;
  };
  const fail = () => {
    if (disposed || failed) return;
    failed = true; active = false; cancel(); clearReady();
  };
  const resize = () => {
    if (disposed || failed) return;
    dirty = true;
    // Keep paused resizing free of layout/atlas/paint work. The fixed-unit SVG
    // fallback fits the new viewport; retain model phase for an allowed resume.
    if (active) schedule();
    else clearReady();
  };
  const prepare = () => {
    dirty = false;
    const rect = canvas.getBoundingClientRect();
    const next = binaryRainDimensions(rect.width, rect.height, view.devicePixelRatio);
    if (!next) { clearReady(); return false; }
    if (dimensions && dimensions.width === next.width && dimensions.height === next.height &&
      dimensions.pixelWidth === next.pixelWidth && dimensions.pixelHeight === next.pixelHeight) {
      canvas.dataset.ready = 'true';
      return true;
    }
    const atlasScale = Math.max(1, next.scale);
    if (!atlas || atlas.scale !== atlasScale) atlas = makeAtlas(document, atlasScale);
    if (!atlas) throw new Error('Decorative canvas unavailable');
    if (model) {
      // Preserve phase on real viewport changes; regenerate only when the column
      // budget changes (e.g. orientation crosses the narrow-screen threshold).
      const replacement = createBinaryRainModel(next.width, next.height);
      if (replacement.streams.length === model.streams.length) {
        for (const stream of model.streams) { stream.x *= next.width / model.width; stream.y *= next.height / model.height; }
        model.width = next.width; model.height = next.height;
      } else model = replacement;
    } else model = createBinaryRainModel(next.width, next.height);
    dimensions = next;
    canvas.width = next.pixelWidth; canvas.height = next.pixelHeight;
    paint(context2d, next, atlas, model);
    canvas.dataset.ready = 'true';
    return true;
  };
  function schedule() {
    if (!active || disposed || failed || pending !== null) return;
    const current = generation;
    try { pending = view.requestAnimationFrame(timestamp => frame(timestamp, current)); } catch { fail(); }
  }
  function frame(timestamp: number, current: number) {
    if (disposed || failed || !active || current !== generation) return;
    pending = null;
    try {
      if (dirty && !prepare()) { lastPaint = null; return; }
      if (!dimensions || !atlas || !model) return;
      if (!Number.isFinite(timestamp)) { fail(); return; }
      if (lastPaint === null) lastPaint = timestamp;
      else if (timestamp - lastPaint >= 1000 / RAIN_LIMITS.fps - .01) {
        advanceBinaryRain(model, timestamp - lastPaint);
        paint(context2d, dimensions, atlas, model);
        lastPaint = timestamp;
      }
      schedule();
    } catch { fail(); }
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true; active = false; cancel();
    try { view.removeEventListener('resize', resize); } catch { /* Detached target. */ }
    try { canvas.removeEventListener('contextlost', fail); } catch { /* Detached target. */ }
    clearReady(); atlas = null; model = null;
  };
  try {
    // Register transactionally: remove even if an unusual host throws after add.
    view.addEventListener('resize', resize);
    canvas.addEventListener('contextlost', fail);
    prepare();
  } catch { dispose(); return null; }
  return {
    setActive(next) {
      if (disposed || failed || active === next) return;
      active = next;
      if (next) { dirty = true; lastPaint = null; schedule(); }
      else cancel();
    },
    dispose,
  };
}
