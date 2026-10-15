// Ink pool: a glyph that melts into the next. WebGL2, no dependencies.
// Docs: https://ink-pool.jsfowles.com/llms-full.txt
//
//   const pool = inkPool(el, { spread: 0.1 }); // el's CSS sets size, font, color
//   await pool.show("A");              // the first glyph just appears
//   pool.show("B");                    // A pools into B; resolves when B settles
//   pool.show("C", { replace: true }); // skips the line and starts now
//   pool.hold("pooled");               // freezes at a phase or 0–1; null lets go
//   pool.set({ sink: 12 });            // eases to new settings; { ease: 0 } snaps
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
  breathe: number; // s, 0 is off
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
};

export const PHASES = {
  start: { at: 0.06, until: 0.12 },
  melting: { at: 0.3, until: 0.42 },
  pooled: { at: 0.5, until: 0.62 },
  forming: { at: 0.8, until: 1 },
} as const;

export type Phase = keyof typeof PHASES | "settled";

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
type Glyph = { texture: WebGLTexture; scale: number | null };
type Renderer = {
  resize: (layout: Layout) => void;
  render: (view: View, settings: Settings, ink: number[]) => number;
  clearGlyphs: () => void;
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

const phaseAt = (t: number): Phase =>
  (Object.keys(PHASES) as (keyof typeof PHASES)[]).find(
    (name) => t < PHASES[name].until,
  ) ?? "forming";

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
uniform vec2 fromOffset, toOffset;
uniform float fromWeight, toWeight;
void main() {
  float a = texture(fromGlyph, uv + fromOffset).a * fromWeight;
  float b = texture(toGlyph, uv + toOffset).a * toWeight;
  color = vec4(1.0 - (1.0 - a) * (1.0 - b));
}`;

// One direction of a Gaussian blur.
const BLUR = `${HEADER}
uniform sampler2D field;
uniform vec2 uvScale, uvMax, direction;
uniform float sigma;
float density(vec2 p) { return texture(field, clamp(p, vec2(0.0), uvMax)).r; }
void main() {
  vec2 here = uv * uvScale;
  float sum = density(here), total = 1.0, falloff = -0.5 / (sigma * sigma);
  int reach = int(ceil(sigma * 3.0));
  for (int i = 1; i <= 48; i++) {
    if (i > reach) break;
    float weight = exp(float(i * i) * falloff);
    vec2 shift = direction * float(i);
    sum += weight * (density(here + shift) + density(here - shift));
    total += 2.0 * weight;
  }
  color = vec4(sum / total);
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
      else gl.uniform3f(at(name), v[0], v[1], v[2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
};

const createRenderer = (
  gl: WebGL2RenderingContext,
  drawGlyph: Draw,
): Renderer => {
  const createTexture = (minFilter: number = gl.LINEAR) => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };

  const createBlank = (w: number, h: number, half = false) => {
    const texture = createTexture();
    const [format, type] = half
      ? [gl.R16F, gl.HALF_FLOAT]
      : [gl.R8, gl.UNSIGNED_BYTE];
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RED, type, null);
    return texture;
  };

  const createTarget = (w: number, h: number) => {
    const texture = createBlank(w, h, halfFloat);
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

  const mix = createPass(gl, MIX);
  const blur = createPass(gl, BLUR);
  const cut = createPass(gl, CUT);
  const triangle = new Float32Array([-1, -1, 3, -1, -1, 3]);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, triangle, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // Half floats keep a hard edge from stepping, where the browser allows.
  const halfFloat = !!gl.getExtension("EXT_color_buffer_float");
  const empty: Glyph = { texture: createBlank(1, 1), scale: null };

  const glyphs = new Map<string, Glyph>();
  const scratch = document.createElement("canvas");
  let targets: ReturnType<typeof createTarget>[] = [];
  let layout: Layout;

  const clearGlyphs = () => {
    for (const { texture } of glyphs.values()) gl.deleteTexture(texture);
    glyphs.clear();
  };

  const resize = (next: Layout) => {
    layout = next;
    for (const { texture, framebuffer } of targets) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
    }
    targets = [0, 1].map(() => createTarget(next.width, next.height));
    clearGlyphs();
  };

  const getGlyph = (key: string) => {
    if (!key) return empty;
    let glyph = glyphs.get(key);
    if (glyph) {
      glyphs.delete(key);
      glyphs.set(key, glyph);
      return glyph;
    }
    const { dpr, width, height, stage } = layout;
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.width, stage.height);
    const drawn = drawGlyph(ctx, key, stage);
    const texture = createTexture(gl.LINEAR_MIPMAP_LINEAR);
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
    gl.generateMipmap(gl.TEXTURE_2D);
    glyph = { texture, scale: drawn && drawn > 0 ? drawn : 1 };
    glyphs.set(key, glyph);
    // Keep the four most recent.
    for (const [oldKey, old] of glyphs) {
      if (glyphs.size <= 4) break;
      gl.deleteTexture(old.texture);
      glyphs.delete(oldKey);
    }
    return glyph;
  };

  const render = (
    { morph, current }: View,
    settings: Settings,
    ink: number[],
  ) => {
    const { dpr, width, height, stage } = layout;
    const t = morph ? morph.progress : 1;
    const to = getGlyph(morph ? morph.to : current);
    const from = getGlyph(morph ? morph.from : "");
    const blend = morph ? smoothstep(0.28, 0.72, t) : 1;

    // Lengths scale with the size each glyph was drawn at.
    const fromScale = from.scale ?? to.scale ?? 1;
    const toScale = to.scale ?? fromScale;
    const scale = fromScale + (toScale - fromScale) * blend;
    const fontPx = stage.size * dpr;
    const sigma = morph
      ? Math.sin(Math.PI * t) ** 1.4 * settings.spread * (fontPx * scale)
      : 0;
    const sink = morph
      ? (smoothstep(0, 1, t) * settings.sink * fontPx * fromScale) /
        100 /
        height
      : 0;
    const rise = morph
      ? ((1 - easeOut(t)) * settings.rise * fontPx * toScale) / 100 / height
      : 0;

    // The mix and blur run on a smaller image, so a wide blur stays cheap.
    const shrink = clamp(Math.floor(sigma / 4), 1, 32);
    const w = Math.ceil(width / shrink);
    const h = Math.ceil(height / shrink);
    const uvScale = [w / width, h / height];
    const uvMax = [(w - 0.5) / width, (h - 0.5) / height];

    // 1. Mix the two glyphs.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
    gl.viewport(0, 0, w, h);
    mix(
      { fromGlyph: from.texture, toGlyph: to.texture },
      {
        fromOffset: [0, sink],
        toOffset: [0, -rise],
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
        { uvScale, uvMax, sigma: s, direction: [1 / width, 0] },
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
      blur(
        { field: targets[1].texture },
        { uvScale, uvMax, sigma: s, direction: [0, 1 / height] },
      );
    }

    // 3. Cut at the threshold, onto the canvas.
    const { hardness, threshold, opacity, fadeStart, fadeEnd } = settings;
    const fade = fadeStart < 100;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
    return scale;
  };

  return { resize, render, clearGlyphs };
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
      return drawGlyph(ctx, current, stage) || 1;
    },
    clearGlyphs: () => {},
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
}: {
  now: () => number;
  duration: () => number; // ms
  queue?: number;
  reduced?: () => boolean;
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
      holdAt = typeof at === "string" ? PHASES[at].at : at;
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
  });

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // The color transition is only there to say when the color changes.
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;transition:color 1ms";
  if (getComputedStyle(root).position === "static")
    root.style.position = "relative";
  root.append(canvas);

  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true,
    antialias: false,
  });
  let renderer = gl
    ? createRenderer(gl, draw)
    : createFlat(canvas.getContext("2d")!, draw);

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

  const render = () => soften(renderer.render(timeline.view(), settings, ink));

  // Drawn already while a morph runs; otherwise now.
  const paint = () => {
    if (!frame) render();
  };

  const report = () => {
    const { morph } = timeline.view();
    const t = morph ? morph.progress : 1;
    const next = morph ? phaseAt(t) : "settled";
    if (next !== phase) onPhase?.((phase = next));
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

  const breathe = () => {
    const ms = target.breathe * 1000;
    const on = ms > 0 && !reducedMotion.matches;
    const timing = breath?.effect?.getComputedTiming();
    if (on && breath && timing) {
      // A new pace keeps its place in the breath.
      const at = (timing.progress ?? 0) + (timing.currentIteration ?? 0);
      breath.effect!.updateTiming({ duration: ms });
      breath.currentTime = at * ms;
    } else if (on) {
      const easing = "cubic-bezier(0.37, 0, 0.63, 1)";
      breath = canvas.animate(
        [{ opacity: 1, easing }, { opacity: 0.4, easing }, { opacity: 1 }],
        { duration: ms, iterations: Infinity },
      );
    } else if (breath) {
      const opacity = getComputedStyle(canvas).opacity;
      breath.cancel();
      breath = undefined;
      canvas.animate([{ opacity }, { opacity: 1 }], {
        duration: 400,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      });
    }
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
    paint();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(root);

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

  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    renderer = createRenderer(gl!, draw);
    renderer.resize(layout);
    render();
  });

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
    teardown: () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(easing);
      timeline.clear();
      breath?.cancel();
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", refont);
      reducedMotion.removeEventListener("change", onReduced);
      canvas.remove();
    },
  };
};
