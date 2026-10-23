// Ink pool: a glyph that melts into the next. WebGL2, no dependencies.
// Docs: https://ink-pool.jsfowles.com/llms-full.txt
//
//   const pool = inkPool(el, { spread: 0.1 }); // el's CSS sets size, font, color
//   await pool.show("A");              // the first glyph just appears
//   pool.show("B");                    // A pools into B; resolves when B settles
//   pool.show("C", { replace: true }); // skips the line and starts now
//   pool.hold("pooled");               // freezes at a phase or 0–1; null lets go
//   pool.set({ sink: 12 });            // eases to new settings; { ease: 0 } snaps
//   pool.set({ turn: 1 });             // turns it to run up the page
//   pool.phases();                     // where each phase falls, as shares
//   pool.teardown();
//
// Options: draw (your own glyphs), queue (how many may wait, 3; 0 cuts short),
// room (where text may sit), onPhase, onProgress.

export type Settings = {
  duration: number; // ms
  spread: number; // em
  hardness: number;
  threshold: number; // 0–1
  sink: number; // % of the glyph's size
  rise: number; // % of the glyph's size
  rest: number; // em
  opacity: number;
  fadeStart: number; // %, 100 is off
  fadeEnd: number; // %
  breathe: number; // s to settle dimmer at rest, 0 is off
  turn: number; // 0 runs across, 1 up the page
};

export const DEFAULTS: Settings = {
  duration: 950,
  spread: 0.05,
  hardness: 24,
  threshold: 0.42,
  sink: 7,
  rise: 4,
  rest: 0,
  opacity: 1,
  fadeStart: 100,
  fadeEnd: 100,
  breathe: 0,
  turn: 0,
};

// Where a morph's phases fall, as shares of it: `at` is the moment that shows
// each best, `until` where it ends. These are the defaults'; a pool reads its
// own from its settings (`pool.phases()`).
export const PHASES = {
  start: { at: 0.06, until: 0.12 },
  melting: { at: 0.3, until: 0.42 },
  pooled: { at: 0.5, until: 0.62 },
  forming: { at: 0.8, until: 1 },
};

export type Phases = typeof PHASES;
export type Phase = keyof Phases | "settled";

export type Room = { top: number; bottom: number };

export type Stage = {
  width: number;
  height: number;
  size: number;
  font: string;
  room?: Room; // px down the stage
};

// Draws `key` centred on the stage, in any color. Drawn smaller than
// stage.size (a sentence, say), it returns that share, and the effect scales.
export type Draw = (
  ctx: CanvasRenderingContext2D,
  key: string,
  stage: Stage,
) => number | void;

export type Options = {
  draw?: Draw;
  onPhase?: (phase: Phase) => void;
  onProgress?: (t: number) => void;
  queue?: number; // how many glyphs may wait; 0 cuts a morph short instead
  room?: () => Room | null; // where text may sit, read as each glyph shows
};

export type Pool = {
  show: (glyph: string, options?: { replace?: boolean }) => Promise<boolean>;
  hold: (at: Phase | number | null) => void;
  set: (settings: Partial<Settings>, options?: { ease?: number }) => void;
  phases: () => Phases;
  teardown: () => void;
};

// A show's promise: true once its glyph settles, false if it never does.
type Ticket = {
  key: string;
  done: (settled: boolean) => void;
  settled: Promise<boolean>;
};
type Morph = {
  from: string;
  to: string;
  progress: number;
  duration: number;
  ticket?: Ticket;
};
type View = { morph: Morph | null; current: string };
// width and height are device pixels.
type Layout = { dpr: number; width: number; height: number; stage: Stage };
// Where a glyph's ink sits, in the stage's px from its middle, y down: the
// middle of the ink and how far it runs from there, across and down; and how
// much larger the glyph shows turned, as far up the box as it lets it run.
type Turn = { middle: [number, number]; reach: [number, number]; grow: number };
// scale: the share of stage.size it was drawn at.
type Glyph = { texture: WebGLTexture; scale: number | null; turn: Turn };
type Renderer = {
  resize: (layout: Layout) => void;
  render: (view: View, settings: Settings, ink: number[]) => number;
  clearGlyphs: () => void;
  dispose: () => void;
};

// How long set() eases, in ms.
const EASE = 500;

const clamp = (x: number, min: number, max: number) =>
  Math.min(Math.max(x, min), max);

const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;

const phaseAt = (t: number, phases: Phases): Phase =>
  (Object.keys(phases) as (keyof Phases)[]).find(
    (name) => t < phases[name].until,
  ) ?? "settled";

// Where the phases fall for these settings, read off a pair of small words
// put through the same mix, blur, sink, rise and cut as a morph: the old word
// melting once it stops matching itself, pooled once neither reads, forming
// once the new one reads, and settled once it matches itself.
const W = 128;
const H = 56;
const FONT = 32;
// As the pool measures a word: by the size it would draw a letter at.
const UNIT = FONT / 0.72;
const STEPS = 40;
let words: [Float32Array, Float32Array] | undefined;
const known = new Map<string, Phases>();
const phasesFor = (settings: Settings): Phases => {
  const { spread, hardness, threshold, sink, rise } = settings;
  const id = [spread, hardness, threshold, sink, rise].join();
  const seen = known.get(id);
  if (seen) return seen;

  words ??= (["INK", "POOL"] as const).map((text) => {
    const ctx = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true })!;
    ctx.canvas.width = W;
    ctx.canvas.height = H;
    ctx.font = `700 ${FONT}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, H / 2);
    const { data } = ctx.getImageData(0, 0, W, H);
    return Float32Array.from(
      { length: W * H },
      (_, i) => data[i * 4 + 3] / 255,
    );
  }) as [Float32Array, Float32Array];
  const [from, to] = words;

  const at = (a: Float32Array, x: number, y: number) => {
    const y0 = Math.floor(y);
    const k = y - y0;
    const row = (r: number) => (r < 0 || r >= H ? 0 : a[r * W + x]);
    return row(y0) * (1 - k) + row(y0 + 1) * k;
  };
  const field = new Float32Array(W * H);
  const pass = new Float32Array(W * H);
  const blur = (
    src: Float32Array,
    out: Float32Array,
    sigma: number,
    across: boolean,
  ) => {
    const reach = Math.ceil(sigma * 3);
    const weights = Array.from({ length: reach * 2 + 1 }, (_, i) =>
      Math.exp(-((i - reach) ** 2) / (2 * sigma * sigma)),
    );
    const total = weights.reduce((a, b) => a + b);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let i = -reach; i <= reach; i++) {
          const u = across ? clamp(x + i, 0, W - 1) : x;
          const v = across ? y : clamp(y + i, 0, H - 1);
          sum += weights[i + reach] * src[v * W + u];
        }
        out[y * W + x] = sum / total;
      }
  };
  const cut = threshold + 0.5 / hardness;
  const shape = (t: number) => {
    const blend = smoothstep(0.28, 0.72, t);
    const down = (smoothstep(0, 1, t) * sink * UNIT) / 100;
    const up = ((1 - easeOut(t)) * rise * UNIT) / 100;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const a = at(from, x, y - down) * (1 - blend);
        const b = at(to, x, y + up) * blend;
        field[y * W + x] = 1 - (1 - a) * (1 - b);
      }
    const sigma = Math.sin(Math.PI * t) ** 1.4 * spread * UNIT;
    if (sigma > 0.35) {
      blur(field, pass, sigma, true);
      blur(pass, field, sigma, false);
    }
    return field.map((v) => (v > cut ? 1 : 0));
  };
  const overlap = (a: Float32Array, b: Float32Array) => {
    let both = 0;
    let either = 0;
    for (let i = 0; i < a.length; i++) {
      both += a[i] * b[i];
      either += Math.max(a[i], b[i]);
    }
    return either ? both / either : 1;
  };
  const before = shape(0);
  const after = shape(1);
  const apart = overlap(before, after);
  // How much like the old word and the new one, 0 (no more than each other)
  // to 1, at each step.
  const like = Array.from({ length: STEPS + 1 }, (_, i) => {
    const now = shape(i / STEPS);
    return [before, after].map(
      (word) => (overlap(now, word) - apart) / (1 - apart || 1),
    );
  });
  // The first share where `pass` holds, between steps.
  const when = (pass: (i: number) => number) => {
    for (let i = 1; i <= STEPS; i++)
      if (pass(i) >= 0) {
        const was = pass(i - 1);
        return (i - 1 + (was < 0 ? was / (was - pass(i)) : 0)) / STEPS;
      }
    return 1;
  };
  const melting = when((i) => 0.94 - like[i][0]);
  const pooled = Math.max(
    when((i) => 0.35 - like[i][0]),
    melting,
  );
  const forming = Math.max(
    when((i) => like[i][1] - 0.35),
    pooled,
  );
  const settled = Math.max(
    when((i) => like[i][1] - 0.975),
    forming,
  );
  const mid = (a: number, b: number) => (a + b) / 2;
  const phases = {
    start: { at: mid(0, melting), until: melting },
    melting: { at: mid(melting, pooled), until: pooled },
    pooled: { at: mid(pooled, forming), until: forming },
    forming: { at: mid(forming, settled), until: settled },
  };
  known.set(id, phases);
  return phases;
};

// Long text wraps, and shrinks until its lines fit.
const drawText: Draw = (ctx, text, { width, height, size, font }) => {
  const maxWidth = width * 0.9;
  let px = size * 1.05;
  let lines: string[];
  do {
    px /= 1.05;
    ctx.font = font.replace(`${size}px`, `${px}px`);
    const [first, ...rest] = text.split(/\s+/);
    lines = [first];
    for (const word of rest) {
      const longer = `${lines[lines.length - 1]} ${word}`;
      if (ctx.measureText(longer).width <= maxWidth)
        lines[lines.length - 1] = longer;
      else lines.push(word);
    }
  } while (
    px > 4 &&
    ((lines.length > 1 && lines.length * px * 1.1 > size) ||
      lines.some((line) => ctx.measureText(line).width > maxWidth))
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    const y = height / 2 + (i - (lines.length - 1) / 2) * px * 1.1;
    ctx.fillText(line, width / 2, y);
  });
  return px / size;
};

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;`;

const MIX = `${HEADER}
uniform sampler2D fromGlyph, toGlyph;
uniform vec2 fromOffset, toOffset, fromAt, toAt, fromInk, toInk, frame;
uniform mat2 fromSpin, toSpin;
uniform float fromWeight, toWeight;
// From the canvas to a glyph's own picture, in px from the middle: from where
// its ink shows, turned and scaled back to where its picture has it.
vec2 spun(mat2 spin, vec2 at, vec2 ink, vec2 offset) {
  return (spin * ((uv - 0.5) * frame - at + offset) + ink) / frame + 0.5;
}
void main() {
  float a = texture(fromGlyph, spun(fromSpin, fromAt, fromInk, fromOffset)).r;
  float b = texture(toGlyph, spun(toSpin, toAt, toInk, toOffset)).r;
  a *= fromWeight;
  b *= toWeight;
  color = vec4(1.0 - (1.0 - a) * (1.0 - b));
}`;

// One direction of a Gaussian blur. Each read lands between two texels,
// weighted so the texture's own filtering takes both: half the reads.
const BLUR = `${HEADER}
uniform sampler2D field;
uniform vec2 uvScale, uvMax, direction;
uniform float sigma;
float density(vec2 p) { return texture(field, clamp(p, vec2(0.0), uvMax)).r; }
void main() {
  vec2 here = uv * uvScale;
  float sum = density(here), total = 1.0, falloff = -0.5 / (sigma * sigma);
  int reach = int(ceil(sigma * 3.0));
  for (int i = 1; i <= 48; i += 2) {
    if (i > reach) break;
    float near = exp(float(i * i) * falloff);
    float far = i < reach ? exp(float((i + 1) * (i + 1)) * falloff) : 0.0;
    float weight = near + far;
    vec2 shift = direction * (float(i) + far / weight);
    sum += weight * (density(here + shift) + density(here - shift));
    total += 2.0 * weight;
  }
  color = vec4(sum / total);
}`;

// A glyph's picture down to the one channel it's read by.
const ALPHA = `${HEADER}
uniform sampler2D picture;
void main() {
  color = vec4(texture(picture, uv).a);
}`;

// A hard threshold, antialiased with fwidth, then the fade and opacity.
const CUT = `${HEADER}
uniform sampler2D field;
uniform vec2 uvScale, uvMax;
uniform vec3 ink;
uniform float hardness, threshold, opacity, fadeStart, fadeEnd;
void main() {
  float inside = hardness * (texture(field, min(uv * uvScale, uvMax)).r - threshold);
  float alpha = clamp((inside - 0.5) / max(fwidth(inside), 1.0) + 0.5, 0.0, 1.0);
  float down = 1.0 - uv.y;
  alpha *= 1.0 - clamp((down - fadeStart) / max(fadeEnd - fadeStart, 1e-4), 0.0, 1.0);
  alpha *= opacity;
  color = vec4(ink * alpha, alpha);
}`;

// Compiles a shader into a function that binds its textures, sets its
// uniforms, and draws.
const createPass = (gl: WebGL2RenderingContext, fragment: string) => {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);

  const locations = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!locations.has(name))
      locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };

  return (
    textures: Record<string, WebGLTexture>,
    uniforms: Record<string, number | number[]>,
  ) => {
    gl.useProgram(program);
    Object.entries(textures).forEach(([name, texture], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(at(name), unit);
    });
    for (const [name, v] of Object.entries(uniforms)) {
      if (typeof v === "number") gl.uniform1f(at(name), v);
      else if (v.length === 2) gl.uniform2f(at(name), v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(at(name), v[0], v[1], v[2]);
      else gl.uniformMatrix2fv(at(name), false, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
};

let probe: CanvasRenderingContext2D | undefined;

// How a glyph turns, read from a small drawing of it across.
const measureTurn = (drawGlyph: Draw, key: string, stage: Stage): Turn => {
  const k = Math.min(1, 200 / Math.max(stage.width, stage.height));
  probe ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true })!;
  const w = (probe.canvas.width = Math.max(1, Math.ceil(stage.width * k)));
  const h = (probe.canvas.height = Math.max(1, Math.ceil(stage.height * k)));
  probe.setTransform(k, 0, 0, k, 0, 0);
  drawGlyph(probe, key, stage);
  const { data } = probe.getImageData(0, 0, w, h);
  let [left, top, right, bottom] = [w, h, 0, 0];
  for (let i = 3; i < data.length; i += 4) {
    if (!data[i]) continue;
    const x = ((i - 3) / 4) % w;
    const y = Math.floor((i - 3) / 4 / w);
    left = Math.min(left, x);
    right = Math.max(right, x + 1);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y + 1);
  }
  if (right <= left) return { middle: [0, 0], reach: [0, 0], grow: 1 };
  const reach: [number, number] = [
    ((right - left) / 2 + 1) / k,
    ((bottom - top) / 2 + 1) / k,
  ];
  return {
    middle: [
      (left + right) / 2 / k - stage.width / 2,
      (top + bottom) / 2 / k - stage.height / 2,
    ],
    reach,
    grow: Math.min(
      Math.max(1, stage.height / stage.width),
      (0.45 * stage.height) / reach[0],
      (0.45 * stage.width) / reach[1],
    ),
  };
};

// Turned, a glyph is its picture across, turned up the page about the middle
// of its ink, moved to the middle of the box, and grown.
const drawTurned = (
  ctx: CanvasRenderingContext2D,
  drawGlyph: Draw,
  key: string,
  stage: Stage,
  { middle: [x, y], grow }: Turn,
) => {
  const [cx, cy] = [stage.width / 2, stage.height / 2];
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.scale(grow, grow);
  ctx.translate(-cx - x, -cy - y);
  return drawGlyph(ctx, key, stage);
};

// Every pool draws through one WebGL2 context, onto its own 2D canvas: a
// browser keeps only so many contexts (Chrome about 16, losing the least
// used), and a page may want more pools than that. A pool keeps its last
// frame while the context is lost and shows new glyphs at rest; if the
// browser doesn't give it back soon, a new context takes over.
type Pass = ReturnType<typeof createPass>;
type Shared = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  mix: Pass;
  blur: Pass;
  cut: Pass;
  alpha: Pass;
  empty: WebGLTexture;
  halfFloat: boolean;
};
let shared: Shared | null | undefined;
// What each pool does when a lost context comes back.
const restorers = new Set<() => void>();

const createTexture = (
  gl: WebGL2RenderingContext,
  minFilter: number = gl.LINEAR,
) => {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

const getShared = (): Shared | null => {
  if (shared === undefined) {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) return (shared = null);
    const build = (): Shared => {
      const triangle = new Float32Array([-1, -1, 3, -1, -1, 3]);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, triangle, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      // No glyph: one clear pixel, read by its alpha like the rest.
      const empty = createTexture(gl);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(4),
      );
      return {
        gl,
        canvas,
        mix: createPass(gl, MIX),
        blur: createPass(gl, BLUR),
        cut: createPass(gl, CUT),
        alpha: createPass(gl, ALPHA),
        empty,
        // Half floats keep a hard edge from stepping, where the browser
        // allows.
        halfFloat: !!gl.getExtension("EXT_color_buffer_float"),
      };
    };
    const restoreAll = () => {
      for (const restore of restorers) restore();
    };
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setTimeout(() => {
        if (shared?.gl !== gl || !gl.isContextLost()) return;
        shared = undefined;
        restoreAll();
      }, 1000);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      // Back after a new one took over, it gives its place up.
      if (shared?.gl !== gl)
        return gl.getExtension("WEBGL_lose_context")?.loseContext();
      shared = build();
      restoreAll();
    });
    shared = build();
  }
  return shared && !shared.gl.isContextLost() ? shared : null;
};

// One drawing canvas for every pool's glyphs, drawn one at a time.
let scratch: HTMLCanvasElement | undefined;
const NO_TURN: Turn = { middle: [0, 0], reach: [0, 0], grow: 1 };

const createRenderer = (
  out: CanvasRenderingContext2D,
  drawGlyph: Draw,
  redraw: () => void,
): Renderer => {
  const flat = createFlat(out, drawGlyph);
  const glyphs = new Map<string, Glyph>();
  let targets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];
  let layout: Layout;

  const createTarget = ({ gl, halfFloat }: Shared, w: number, h: number) => {
    const texture = createTexture(gl);
    const [format, type] = halfFloat
      ? [gl.R16F, gl.HALF_FLOAT]
      : [gl.R8, gl.UNSIGNED_BYTE];
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RED, type, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return { texture, framebuffer };
  };

  const clearGlyphs = () => {
    const gl = getShared()?.gl;
    for (const { texture } of glyphs.values()) gl?.deleteTexture(texture);
    glyphs.clear();
  };

  const clearTargets = () => {
    const gl = getShared()?.gl;
    for (const { texture, framebuffer } of targets) {
      gl?.deleteTexture(texture);
      gl?.deleteFramebuffer(framebuffer);
    }
    targets = [];
  };

  // A lost context took its textures with it; they're made again as needed.
  const restore = () => {
    glyphs.clear();
    targets = [];
    redraw();
  };
  restorers.add(restore);

  const resize = (next: Layout) => {
    layout = next;
    flat.resize(next);
    clearTargets();
    clearGlyphs();
  };

  // A large glyph on a dense screen is drawn, mixed and blurred at half the
  // device's pixels, then cut at all of them: the cut makes the hard edge, so
  // it shows as sharp, for a quarter of the memory and the work.
  const coarse = () => (layout.dpr >= 1.5 && layout.stage.size >= 96 ? 2 : 1);
  const sized = () => {
    const k = coarse();
    return [Math.ceil(layout.width / k), Math.ceil(layout.height / k), k];
  };

  const getGlyph = (
    { gl, empty, alpha }: Shared,
    key: string,
    turned = false,
  ) => {
    if (!key) return { texture: empty, scale: null, turn: NO_TURN };
    const id = turned ? `turned:${key}` : key;
    let glyph = glyphs.get(id);
    if (glyph) {
      glyphs.delete(id);
      glyphs.set(id, glyph);
      return glyph;
    }
    const { dpr, stage } = layout;
    const [width, height, k] = sized();
    scratch ??= document.createElement("canvas");
    if (scratch.width !== width) scratch.width = width;
    if (scratch.height !== height) scratch.height = height;
    const ctx = scratch.getContext("2d")!;
    ctx.setTransform(dpr / k, 0, 0, dpr / k, 0, 0);
    ctx.clearRect(0, 0, stage.width, stage.height);
    const turn = measureTurn(drawGlyph, key, stage);
    const drawn = turned
      ? drawTurned(ctx, drawGlyph, key, stage, turn)
      : drawGlyph(ctx, key, stage);
    // Uploaded whole, which browsers do fastest, then kept as its alpha
    // alone: a quarter of the memory, and a quarter to read.
    const picture = createTexture(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      scratch,
    );
    const texture = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null,
    );
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.viewport(0, 0, width, height);
    alpha({ picture }, {});
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(picture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    glyph = { texture, scale: drawn && drawn > 0 ? drawn : 1, turn };
    glyphs.set(id, glyph);
    // Keep the four most recent: a morph's two, and the two turned.
    for (const [oldKey, old] of glyphs) {
      if (glyphs.size <= 4) break;
      gl.deleteTexture(old.texture);
      glyphs.delete(oldKey);
    }
    return glyph;
  };

  const render = (view: View, settings: Settings, ink: number[]) => {
    const pool = getShared();
    if (!pool) return flat.render(view, settings, ink);
    const { gl, canvas, mix, blur, cut } = pool;
    const { morph, current } = view;
    const { dpr, width, height, stage } = layout;
    // The shared canvas grows to the largest pool and draws each in its
    // corner; sized first, since sizing clears it.
    if (canvas.width < width) canvas.width = width;
    if (canvas.height < height) canvas.height = height;
    const [tw, th, k] = sized();
    if (!targets.length) targets = [0, 1].map(() => createTarget(pool, tw, th));
    const t = morph ? morph.progress : 1;
    // Turning, a glyph's picture across turns about the middle of its ink,
    // which moves to the middle of the box, and grows as the box lets it. Past
    // halfway its picture up the page, drawn the same way, shows instead.
    const turn = clamp(settings.turn, 0, 1);
    const turned = turn >= 0.5;
    const toKey = morph ? morph.to : current;
    const fromKey = morph ? morph.from : "";
    const to = getGlyph(pool, toKey, turned);
    const from = getGlyph(pool, fromKey, turned);
    const blend = morph ? smoothstep(0.28, 0.72, t) : 1;

    // How a glyph shows: turned and scaled, as a matrix from the canvas to its
    // picture; where its ink shows and where its picture has it, in device px
    // from the middle, y up; and how large, against its picture across.
    const show = ({ turn: { middle, reach, grow } }: Glyph) => {
      const angle = (Math.PI / 2) * turn;
      const [cos, sin] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))];
      const [x, y] = middle.map((v) => v * (1 - turn));
      // Smaller at a slant, as much as keeps its corners in the box.
      const size = Math.min(
        1 + (grow - 1) * turn,
        (stage.width / 2 - Math.abs(x)) / (reach[0] * cos + reach[1] * sin),
        (stage.height / 2 - Math.abs(y)) / (reach[0] * sin + reach[1] * cos),
      );
      const k = turned ? size / grow : size;
      const a = turned ? angle - Math.PI / 2 : angle;
      const [c, s] = [Math.cos(a) / k, Math.sin(a) / k];
      return {
        spin: [c, -s, s, c],
        at: [x * dpr, -y * dpr],
        ink: turned ? [0, 0] : [middle[0] * dpr, -middle[1] * dpr],
        size,
      };
    };
    const fromShow = show(from);
    const toShow = show(to);

    // Lengths scale with the size each glyph shows at.
    const unit = (glyph: Glyph, size: number) =>
      glyph.scale === null ? null : glyph.scale * stage.size * size;
    const fromUnit =
      unit(from, fromShow.size) ?? unit(to, toShow.size) ?? stage.size;
    const toUnit = unit(to, toShow.size) ?? fromUnit;
    const size = (fromUnit + (toUnit - fromUnit) * blend) * dpr;
    const sigma = morph
      ? Math.sin(Math.PI * t) ** 1.4 * settings.spread * size
      : 0;
    const sink = morph
      ? (smoothstep(0, 1, t) * settings.sink * fromUnit * dpr) / 100
      : 0;
    const rise = morph
      ? ((1 - easeOut(t)) * settings.rise * toUnit * dpr) / 100
      : 0;

    // The mix and blur run on a smaller image, so a wide blur stays cheap:
    // as small as keeps the blur two of its pixels wide, which still reads
    // as smooth once the cut draws it out at full size.
    const shrink = Math.max(k, clamp(Math.floor(sigma / 2), 1, 64));
    const w = Math.ceil(width / shrink);
    const h = Math.ceil(height / shrink);
    const uvScale = [w / tw, h / th];
    const uvMax = [(w - 0.5) / tw, (h - 0.5) / th];

    // 1. Mix the two glyphs.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
    gl.viewport(0, 0, w, h);
    mix(
      { fromGlyph: from.texture, toGlyph: to.texture },
      {
        fromOffset: [0, sink],
        toOffset: [0, -rise],
        fromAt: fromShow.at,
        toAt: toShow.at,
        fromInk: fromShow.ink,
        toInk: toShow.ink,
        frame: [width, height],
        fromSpin: fromShow.spin,
        toSpin: toShow.spin,
        fromWeight: 1 - blend,
        toWeight: blend,
      },
    );

    // 2. Blur across, then down.
    const s = sigma / shrink;
    if (s > 0.35) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1].framebuffer);
      blur(
        { field: targets[0].texture },
        { uvScale, uvMax, sigma: s, direction: [1 / tw, 0] },
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
      blur(
        { field: targets[1].texture },
        { uvScale, uvMax, sigma: s, direction: [0, 1 / th] },
      );
    }

    // 3. Cut at the threshold, then onto the pool's own canvas. The cut
    // writes every pixel it covers, so there's nothing to clear.
    const { hardness, threshold, opacity, fadeStart, fadeEnd } = settings;
    const fade = fadeStart < 100;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    cut(
      { field: targets[0].texture },
      {
        uvScale,
        uvMax,
        ink,
        hardness,
        threshold,
        opacity,
        fadeStart: fade ? fadeStart / 100 : 2,
        fadeEnd: fade ? fadeEnd / 100 : 3,
      },
    );
    out.save();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = "copy";
    out.drawImage(
      canvas,
      0,
      canvas.height - height,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    out.restore();
    return size / dpr / stage.size;
  };

  const dispose = () => {
    clearTargets();
    clearGlyphs();
    restorers.delete(restore);
  };

  return { resize, render, clearGlyphs, dispose };
};

// Without WebGL2, a 2D canvas shows each glyph at rest.
const createFlat = (
  ctx: CanvasRenderingContext2D,
  drawGlyph: Draw,
): Renderer => {
  let layout: Layout;
  return {
    resize: (next) => (layout = next),
    render: ({ current }, settings, ink) => {
      const { dpr, stage } = layout;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, stage.width, stage.height);
      ctx.fillStyle = ctx.strokeStyle = `rgb(${ink.map((c) => c * 255)})`;
      ctx.globalAlpha = settings.opacity;
      if (settings.turn < 0.5) return drawGlyph(ctx, current, stage) || 1;
      const turn = measureTurn(drawGlyph, current, stage);
      return (
        (drawTurned(ctx, drawGlyph, current, stage, turn) || 1) * turn.grow
      );
    },
    clearGlyphs: () => {},
    dispose: () => {},
  };
};

const ticket = (key: string): Ticket => {
  let done!: (settled: boolean) => void;
  const settled = new Promise<boolean>((resolve) => (done = resolve));
  return { key, done, settled };
};

// The morphs over time: what shows, what waits, how far along. It runs on the
// clock it's given, so it steps without a browser.
export const createTimeline = ({
  now,
  duration,
  queue: limit = 3,
  reduced = () => false,
  phases = () => PHASES,
}: {
  now: () => number;
  duration: () => number; // ms
  queue?: number;
  reduced?: () => boolean;
  phases?: () => Phases;
}) => {
  let current = "";
  let previous = "";
  let started = false;
  let morph: Morph | null = null;
  let holdAt: number | null = null;
  let moving = false;
  let tween = { from: 0, to: 1, start: 0, duration: 0 };
  const queue: Ticket[] = [];

  const clearQueue = () => queue.splice(0).forEach((t) => t.done(false));

  const animateTo = (to: number, ms: number) => {
    if (!morph) return;
    const duration = reduced() ? 0 : ms;
    tween = { from: morph.progress, to, start: now(), duration };
    moving = true;
  };

  const glideTo = (to: number) => {
    const ms = Math.abs(to - (morph?.progress ?? 0)) * duration();
    animateTo(to, Math.max(180, ms));
  };

  const start = (next: Ticket) => {
    // Quicker with a backlog, down to a third of the duration.
    const pace = Math.max(0.35, 1 / (1 + queue.length * 0.6));
    const ms = duration() * pace;
    // Cut short, it picks up the pool as it is: from whichever glyph shows
    // more, as far in as the old morph had melted.
    const t = morph ? morph.progress : 0;
    const from = morph && t < 0.5 ? morph.from : current;
    const progress = Math.min(t, 1 - t);
    morph?.ticket?.done(false);
    previous = from;
    morph = { from, to: next.key, progress, duration: ms, ticket: next };
    current = next.key;
    if (holdAt !== null) glideTo(holdAt);
    else animateTo(1, (1 - progress) * ms);
  };

  const finish = () => {
    morph?.ticket?.done(true);
    morph = null;
    const next = queue.shift();
    if (next) start(next);
  };

  // What a show of `key` waits on when it's already shown or on its way.
  const pending = (key: string) => {
    const last = queue.at(-1);
    if (key !== (last?.key ?? current)) return null;
    return last?.settled ?? morph?.ticket?.settled ?? Promise.resolve(true);
  };

  return {
    show: (key: string, replace = false) => {
      const next = ticket(key);
      // The first glyph just appears, and with reduced motion so does each one.
      if (!started || (reduced() && holdAt === null)) {
        started = true;
        previous = current;
        current = key;
        morph?.ticket?.done(false);
        morph = null;
        moving = false;
        clearQueue();
        next.done(true);
        return next.settled;
      }
      if (holdAt !== null) {
        clearQueue();
        if (key === current) return pending(key)!;
        start(next);
        return next.settled;
      }
      if (replace) clearQueue();
      const waiting = pending(key);
      if (waiting) return waiting;
      if (morph && limit > 0 && !replace) {
        queue.push(next);
        if (queue.length > limit) queue.shift()!.done(false);
        return next.settled;
      }
      start(next);
      return next.settled;
    },

    hold: (at: Phase | number | null) => {
      if (at === "settled") at = null;
      holdAt = typeof at === "string" ? phases()[at].at : at;
      clearQueue();
      if (holdAt === null) {
        if (morph) animateTo(1, (1 - morph.progress) * morph.duration);
        return;
      }
      // At rest, replay the last morph to hold it.
      if (!morph) {
        if (!started) return;
        morph = {
          from: previous,
          to: current,
          progress: 0,
          duration: duration(),
        };
      }
      glideTo(holdAt);
    },

    // Moves to now. True while there's more to come.
    step: () => {
      if (!morph || !moving) return (moving = false);
      const { from, to, start: begun, duration: ms } = tween;
      const k = ms ? Math.min((now() - begun) / ms, 1) : 1;
      // Linear when playing through, eased when gliding to a hold.
      morph.progress = from + (to - from) * (holdAt === null ? k : easeOut(k));
      if (k < 1) return true;
      moving = false;
      if (morph.progress >= 1) finish();
      return moving;
    },

    // Reduced motion came on: whatever's playing ends now.
    hurry: () => {
      if (morph && holdAt === null) animateTo(1, 0);
    },

    clear: () => {
      clearQueue();
      morph?.ticket?.done(false);
    },

    view: (): View => ({ morph, current }),
    moving: () => moving,
  };
};

const mix = (from: Settings, to: Settings, k: number) => {
  const out = { ...to };
  for (const key of Object.keys(to) as (keyof Settings)[])
    if (key !== "duration" && key !== "breathe")
      out[key] = from[key] + (to[key] - from[key]) * k;
  return out;
};

export const inkPool = (
  root: HTMLElement,
  initial: Partial<Settings> = {},
  { draw = drawText, onPhase, onProgress, queue, room }: Options = {},
): Pool => {
  // Where the settings are headed, and where they are on the way there.
  let target: Settings = { ...DEFAULTS, ...initial };
  let settings = target;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const timeline = createTimeline({
    now: () => performance.now(),
    duration: () => target.duration,
    queue,
    reduced: () => reducedMotion.matches,
    phases: () => phasesFor(target),
  });

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // The color transition is only there to say when the color changes.
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;transition:color 1ms";
  if (getComputedStyle(root).position === "static")
    root.style.position = "relative";
  root.append(canvas);

  const renderer = createRenderer(canvas.getContext("2d")!, draw, () =>
    paint(),
  );

  let phase: Phase = "settled";
  let breath: Animation | undefined;
  let ink = [0, 0, 0];
  let filter = "";
  let frame = 0;
  let easing = 0;
  let layout: Layout;

  const readInk = (style = getComputedStyle(root)) => {
    const rgb = style.color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    ink = rgb.slice(0, 3).map((c) => c / 255);
  };

  const measure = () => {
    const style = getComputedStyle(root);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const { clientWidth: width, clientHeight: height } = root;
    const size = parseFloat(style.fontSize);
    const font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
    layout = {
      dpr,
      width: Math.max(1, Math.round(width * dpr)),
      height: Math.max(1, Math.round(height * dpr)),
      stage: { width, height, size, font },
    };
    readInk(style);
    canvas.width = layout.width;
    canvas.height = layout.height;
  };

  // Glyphs drawn for other room get drawn again.
  const measureRoom = () => {
    const free = room?.();
    const next = free && {
      top: Math.round(free.top),
      bottom: Math.round(free.bottom),
    };
    const was = layout.stage.room;
    if (next?.top === was?.top && next?.bottom === was?.bottom) return;
    layout.stage.room = next || undefined;
    renderer.clearGlyphs();
  };

  // The rest setting, as a CSS blur.
  const soften = (scale: number) => {
    const px = settings.rest * layout.stage.size * scale;
    const next = px > 0 ? `blur(${px.toFixed(2)}px)` : "";
    if (next !== filter) canvas.style.filter = filter = next;
  };

  // Drawn only while it shows; scrolled back, it draws where it's got to.
  let seen = true;
  const render = () => {
    if (seen) soften(renderer.render(timeline.view(), settings, ink));
  };

  // Drawn already while a morph runs; otherwise now.
  const paint = () => {
    if (!frame) render();
  };

  const report = () => {
    const { morph } = timeline.view();
    const t = morph ? morph.progress : 1;
    const next = morph ? phaseAt(t, phasesFor(target)) : "settled";
    if (next !== phase) {
      const crossed = (next === "settled") !== (phase === "settled");
      phase = next;
      onPhase?.(next);
      if (crossed) breathe();
    }
    onProgress?.(t);
  };

  const loop = () => {
    frame = 0;
    const moving = timeline.step();
    report();
    render();
    if (moving) frame = requestAnimationFrame(loop);
  };

  // After the timeline changes: run frames, or show where it stands.
  const wake = () => {
    if (timeline.moving()) {
      if (!frame) frame = requestAnimationFrame(loop);
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
    report();
    render();
  };

  // With breathe on, a settled glyph breathes out, easing down to a dimmer
  // rest over that long and staying there; the next morph breathes it back
  // in as it starts to melt.
  const breathe = () => {
    const out = target.breathe > 0 && !reducedMotion.matches;
    const resting = out && phase === "settled";
    if (!breath && !resting) return;
    const opacity = getComputedStyle(canvas).opacity;
    breath?.cancel();
    breath = canvas.animate([{ opacity }, { opacity: resting ? 0.4 : 1 }], {
      duration: resting
        ? target.breathe * 1000
        : out
          ? Math.min(400, target.duration * 0.35)
          : 400,
      easing: resting
        ? "cubic-bezier(0.37, 0, 0.63, 1)"
        : "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: "forwards",
    });
  };

  const set = (next: Partial<Settings>, { ease = EASE } = {}) => {
    const old = target;
    target = { ...target, ...next };
    readInk();
    if (old.breathe !== target.breathe) breathe();
    cancelAnimationFrame(easing);
    if (!ease || reducedMotion.matches) {
      settings = target;
      paint();
      return;
    }
    const from = settings;
    const begun = performance.now();
    const step = () => {
      const k = easeOut(Math.min((performance.now() - begun) / ease, 1));
      settings = mix(from, target, k);
      paint();
      easing = k < 1 ? requestAnimationFrame(step) : 0;
    };
    easing = requestAnimationFrame(step);
  };

  const resize = () => {
    measure();
    renderer.resize(layout);
    measureRoom();
    breathe();
    // Now, even mid-morph: sizing the canvas cleared it, and the next frame
    // would show it empty.
    render();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  const sight = new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting;
    if (seen) paint();
  });
  sight.observe(root);

  // Glyphs drawn before their font loaded get drawn again.
  const refont = () => {
    renderer.clearGlyphs();
    paint();
  };
  document.fonts.addEventListener("loadingdone", refont);

  canvas.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "color") return;
    readInk();
    paint();
  });

  const onReduced = () => {
    breathe();
    timeline.hurry();
    wake();
  };
  reducedMotion.addEventListener("change", onReduced);

  return {
    show: (glyph, { replace = false } = {}) => {
      measureRoom();
      const settled = timeline.show(glyph, replace);
      wake();
      return settled;
    },
    hold: (at) => {
      timeline.hold(at);
      wake();
    },
    set,
    phases: () => phasesFor(target),
    teardown: () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(easing);
      timeline.clear();
      breath?.cancel();
      observer.disconnect();
      sight.disconnect();
      renderer.dispose();
      document.fonts.removeEventListener("loadingdone", refont);
      reducedMotion.removeEventListener("change", onReduced);
      canvas.remove();
    },
  };
};
