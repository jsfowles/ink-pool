/*
 * Ink pool: a glyph that melts into the next one.
 *
 * Both glyphs blur out together until their ink runs into one pool, an
 * alpha threshold keeping that pool's edge hard, then the new glyph firms
 * up out of it as the old one sinks away.
 *
 * One file, no dependencies. It draws with WebGL2 into a canvas that fills
 * the element you give it: the glyph centred, at the element's font-size,
 * in its color. Every length here is a share of that size (em), so leave
 * the element room around the glyph for the ink to spread and sink into.
 * Glyphs that change faster than a morph wait their turn, and a backlog
 * plays quicker so it keeps up.
 *
 *   const pool = inkPool(el, DEFAULTS);
 *   pool.show("A");
 *   pool.show("B");      // A pools into B
 *   pool.hold("pooled"); // glides to the pool's height and stays there
 *   pool.hold(null);     // and lets it finish
 */

export type Settings = {
  /** One morph, ms. */
  duration: number;
  /** How far the ink spreads at the morph's height, em. */
  spread: number;
  /** How sharply the threshold cuts the pool's edge. Low leaves smoke. */
  hardness: number;
  /** Where the cut falls, 0–1 of the ink's density. Lower is bolder. */
  threshold: number;
  /** How far the old glyph sinks as it goes, % of the glyph's size. */
  sink: number;
  /** How far above its place the new glyph starts, % of the glyph's size. */
  rise: number;
  /** The resting softness, em. */
  rest: number;
  /** The glyph's opacity, as a whole. */
  opacity: number;
  /** A fade downward: solid to fadeStart %, gone by fadeEnd %. 100 is none. */
  fadeStart: number;
  fadeEnd: number;
  /** A slow pulse at rest, one breath in seconds. 0 is off. */
  breathe: number;
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

/** The morph's phases: where a hold stops in each, and where each ends. */
export const PHASES = {
  start: { at: 0.06, until: 0.12 },
  melting: { at: 0.3, until: 0.42 },
  pooled: { at: 0.5, until: 0.62 },
  forming: { at: 0.8, until: 1 },
} as const;

export type Phase = keyof typeof PHASES | "settled";

/** The canvas a glyph is drawn into, CSS px, and the glyph's size and font. */
export type Stage = {
  width: number;
  height: number;
  size: number;
  font: string;
};

/** Draws a glyph, named by its key, centred in the stage, in any opaque color. */
export type Draw = (
  ctx: CanvasRenderingContext2D,
  key: string,
  stage: Stage,
) => void;

export type Options = {
  /** Draws a glyph. By default the key is the text. */
  draw?: Draw;
  /** Called as the morph passes from phase to phase. */
  onPhase?: (phase: Phase) => void;
  /** Called each frame with how far the morph has got, 0–1; 1 at rest. */
  onProgress?: (t: number) => void;
  /** How many glyphs may wait for a morph to finish; older ones drop. 0
   *  cuts a morph short instead. */
  queue?: number;
};

const drawText: Draw = (ctx, key, { width, height, font }) => {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(key, width / 2, height / 2);
};

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
};
const out = (t: number) => 1 - (1 - t) ** 3;
const phaseAt = (t: number): Phase =>
  (Object.keys(PHASES) as (keyof typeof PHASES)[]).find(
    (p) => t < PHASES[p].until,
  ) ?? "forming";

// The shaders. One triangle covers the target; `uv` runs 0–1 across it.
const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;`;
// The two glyphs laid together, each at its own opacity and offset.
const MIX = `${HEAD}
uniform sampler2D a, b; uniform vec2 ao, bo; uniform float am, bm;
void main() {
  float x = texture(a, uv + ao).r * am, y = texture(b, uv + bo).r * bm;
  o = vec4(1.0 - (1.0 - x) * (1.0 - y));
}`;
// One direction of the spread: a Gaussian over the field.
const BLUR = `${HEAD}
uniform sampler2D f; uniform vec2 scale, edge, dir; uniform float sigma;
float at(vec2 c) { return texture(f, clamp(c, vec2(0.0), edge)).r; }
void main() {
  vec2 c = uv * scale;
  float sum = at(c), total = 1.0, k = -0.5 / (sigma * sigma);
  int n = int(ceil(sigma * 3.0));
  for (int i = 1; i <= 48; i++) {
    if (i > n) break;
    float w = exp(float(i * i) * k);
    sum += w * (at(c + dir * float(i)) + at(c - dir * float(i)));
    total += 2.0 * w;
  }
  o = vec4(sum / total);
}`;
// The cut: the pool's edge, hard but never aliased, faded and inked.
const CUT = `${HEAD}
uniform sampler2D f; uniform vec2 scale, edge; uniform vec3 ink;
uniform float hardness, threshold, opacity, fadeStart, fadeEnd;
void main() {
  float e = hardness * (texture(f, min(uv * scale, edge)).r - threshold);
  float a = clamp((e - 0.5) / max(fwidth(e), 1.0) + 0.5, 0.0, 1.0);
  float down = 1.0 - uv.y;
  a *= 1.0 - clamp((down - fadeStart) / max(fadeEnd - fadeStart, 1e-4), 0.0, 1.0);
  a *= opacity;
  o = vec4(ink * a, a);
}`;

type Morph = { from: string; to: string; t: number; duration: number };
type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation> };

export const inkPool = (
  root: HTMLElement,
  initial: Settings = DEFAULTS,
  { draw = drawText, onPhase, onProgress, queue: limit = 3 }: Options = {},
) => {
  let settings = { ...initial };
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  if (getComputedStyle(root).position === "static")
    root.style.position = "relative";
  root.append(canvas);

  // What's on show: the glyph settled there, or the morph under way, and
  // the glyphs waiting for it.
  let shown = "";
  let before = "";
  let started = false;
  let morph: Morph | null = null;
  let held: number | null = null;
  const waiting: string[] = [];
  let frame = 0;
  let phase: Phase = "settled";
  let breath: Animation | undefined;

  // The stage, measured: CSS px, device px, and the glyph's size and ink.
  let dpr = 1;
  let W = 1;
  let H = 1;
  let stage: Stage = { width: 1, height: 1, size: 1, font: "" };
  let ink = [0, 0, 0];
  // The element's color, which the glyph is inked in.
  const readInk = (cs = getComputedStyle(root)) => {
    const rgb = cs.color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    ink = rgb.slice(0, 3).map((c) => c / 255);
  };
  const measure = () => {
    const cs = getComputedStyle(root);
    dpr = Math.min(devicePixelRatio || 1, 2);
    const width = root.clientWidth;
    const height = root.clientHeight;
    W = Math.max(1, Math.round(width * dpr));
    H = Math.max(1, Math.round(height * dpr));
    const size = parseFloat(cs.fontSize);
    stage = {
      width,
      height,
      size,
      font: `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`,
    };
    readInk(cs);
    canvas.width = W;
    canvas.height = H;
  };

  const toPhase = (next: Phase) => {
    if (next === phase) return;
    phase = next;
    onPhase?.(next);
  };

  // WebGL2, or a plain 2D canvas that only ever shows the glyph at rest.
  const gl = canvas.getContext("webgl2", {
    premultipliedAlpha: true,
    antialias: false,
  });
  const flat = gl ? null : canvas.getContext("2d");

  // GL: three programs, one triangle, two fields at the stage's size (the
  // spread runs in a corner of them, as small as its blur allows), and the
  // glyphs drawn so far.
  let mix: Program;
  let blur: Program;
  let cut: Program;
  let fields: { tex: WebGLTexture; fb: WebGLFramebuffer }[] = [];
  const glyphs = new Map<string, WebGLTexture>();
  let blank: WebGLTexture;
  let half = false;

  const compile = (frag: string, names: string[]): Program => {
    const g = gl!;
    const p = g.createProgram()!;
    for (const [type, src] of [
      [g.VERTEX_SHADER, VERT],
      [g.FRAGMENT_SHADER, frag],
    ] as const) {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      g.attachShader(p, s);
    }
    g.bindAttribLocation(p, 0, "p");
    g.linkProgram(p);
    const u: Program["u"] = {};
    for (const n of names) u[n] = g.getUniformLocation(p, n)!;
    return { p, u };
  };

  const texture = (filter: number) => {
    const g = gl!;
    const t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  };

  const setup = () => {
    const g = gl!;
    mix = compile(MIX, ["a", "b", "ao", "bo", "am", "bm"]);
    blur = compile(BLUR, ["f", "scale", "edge", "dir", "sigma"]);
    cut = compile(CUT, [
      "f",
      "scale",
      "edge",
      "ink",
      "hardness",
      "threshold",
      "opacity",
      "fadeStart",
      "fadeEnd",
    ]);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      g.STATIC_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    // Half floats keep a hard edge from stepping; bytes where a browser
    // can't draw into them.
    half = !!g.getExtension("EXT_color_buffer_float");
    blank = texture(g.LINEAR);
    g.texImage2D(g.TEXTURE_2D, 0, g.R8, 1, 1, 0, g.RED, g.UNSIGNED_BYTE, null);
  };

  const forget = () => {
    for (const t of glyphs.values()) gl?.deleteTexture(t);
    glyphs.clear();
  };

  const sizeFields = () => {
    const g = gl!;
    for (const f of fields) {
      g.deleteTexture(f.tex);
      g.deleteFramebuffer(f.fb);
    }
    fields = [0, 1].map(() => {
      const tex = texture(g.LINEAR);
      if (half)
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.R16F,
          W,
          H,
          0,
          g.RED,
          g.HALF_FLOAT,
          null,
        );
      else
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.R8,
          W,
          H,
          0,
          g.RED,
          g.UNSIGNED_BYTE,
          null,
        );
      const fb = g.createFramebuffer()!;
      g.bindFramebuffer(g.FRAMEBUFFER, fb);
      g.framebufferTexture2D(
        g.FRAMEBUFFER,
        g.COLOR_ATTACHMENT0,
        g.TEXTURE_2D,
        tex,
        0,
      );
      return { tex, fb };
    });
    forget();
  };

  // A glyph, drawn once at the stage's size and kept while it's in use.
  const scratch = document.createElement("canvas");
  const glyph = (key: string) => {
    const g = gl!;
    if (!key) return blank;
    const have = glyphs.get(key);
    if (have) {
      glyphs.delete(key);
      glyphs.set(key, have);
      return have;
    }
    scratch.width = W;
    scratch.height = H;
    const ctx = scratch.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.width, stage.height);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    draw(ctx, key, stage);
    const t = texture(g.LINEAR_MIPMAP_LINEAR);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.texImage2D(g.TEXTURE_2D, 0, g.R8, g.RED, g.UNSIGNED_BYTE, scratch);
    g.generateMipmap(g.TEXTURE_2D);
    glyphs.set(key, t);
    // Four drawn glyphs at most: the pair on show and a couple to come.
    for (const [k, old] of glyphs) {
      if (glyphs.size <= 4) break;
      g.deleteTexture(old);
      glyphs.delete(k);
    }
    return t;
  };

  // The frame at the morph's t, or the glyph at rest.
  const render = () => {
    const m = morph;
    const t = m ? m.t : 1;
    toPhase(m ? phaseAt(t) : "settled");
    onProgress?.(t);
    if (!gl) {
      if (!flat) return;
      flat.setTransform(dpr, 0, 0, dpr, 0, 0);
      flat.clearRect(0, 0, stage.width, stage.height);
      flat.fillStyle = flat.strokeStyle = `rgb(${ink.map((c) => c * 255)})`;
      flat.globalAlpha = settings.opacity;
      draw(flat, shown, stage);
      return;
    }
    const g = gl;
    const px = stage.size * dpr;
    const sigma = m ? Math.sin(Math.PI * t) ** 1.4 * settings.spread * px : 0;
    // The spread runs at 1/d of the stage, so its blur stays a few texels
    // wide however far the ink reaches.
    const d = Math.min(Math.max(Math.floor(sigma / 4), 1), 32);
    const w = Math.ceil(W / d);
    const h = Math.ceil(H / d);
    const fade = settings.fadeStart < 100;

    // The two glyphs, laid together: the old drawn lower (sampled higher),
    // the new higher.
    const mixed = m ? smooth(0.28, 0.72, t) : 1;
    const sink = m ? (smooth(0, 1, t) * settings.sink * px) / 100 / H : 0;
    const rise = m ? ((1 - out(t)) * settings.rise * px) / 100 / H : 0;
    g.bindFramebuffer(g.FRAMEBUFFER, fields[0].fb);
    g.viewport(0, 0, w, h);
    g.useProgram(mix.p);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, glyph(m ? m.to : shown));
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, glyph(m ? m.from : ""));
    g.uniform1i(mix.u.a, 0);
    g.uniform1i(mix.u.b, 1);
    g.uniform2f(mix.u.ao, 0, sink);
    g.uniform2f(mix.u.bo, 0, -rise);
    g.uniform1f(mix.u.am, 1 - mixed);
    g.uniform1f(mix.u.bm, mixed);
    g.drawArrays(g.TRIANGLES, 0, 3);

    // The spread, across then down.
    const scale = [w / W, h / H] as const;
    const edge = [(w - 0.5) / W, (h - 0.5) / H] as const;
    const low = sigma / d;
    if (low > 0.35) {
      g.useProgram(blur.p);
      g.uniform1i(blur.u.f, 0);
      g.uniform2f(blur.u.scale, ...scale);
      g.uniform2f(blur.u.edge, ...edge);
      g.uniform1f(blur.u.sigma, low);
      for (const [src, dst, dx, dy] of [
        [0, 1, 1 / W, 0],
        [1, 0, 0, 1 / H],
      ] as const) {
        g.bindFramebuffer(g.FRAMEBUFFER, fields[dst].fb);
        g.bindTexture(g.TEXTURE_2D, fields[src].tex);
        g.uniform2f(blur.u.dir, dx, dy);
        g.drawArrays(g.TRIANGLES, 0, 3);
      }
    }

    // The cut, onto the canvas.
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, W, H);
    g.useProgram(cut.p);
    g.bindTexture(g.TEXTURE_2D, fields[0].tex);
    g.uniform1i(cut.u.f, 0);
    g.uniform2f(cut.u.scale, ...scale);
    g.uniform2f(cut.u.edge, ...edge);
    g.uniform3f(cut.u.ink, ink[0], ink[1], ink[2]);
    g.uniform1f(cut.u.hardness, settings.hardness);
    g.uniform1f(cut.u.threshold, settings.threshold);
    g.uniform1f(cut.u.opacity, settings.opacity);
    g.uniform1f(cut.u.fadeStart, fade ? settings.fadeStart / 100 : 2);
    g.uniform1f(cut.u.fadeEnd, fade ? settings.fadeEnd / 100 : 3);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    g.drawArrays(g.TRIANGLES, 0, 3);
  };

  // Time: one frame loop moving the morph's t to `goal` over `span` ms,
  // then stopping there (held) or settling (at 1).
  let goal = 1;
  let from = 0;
  let t0 = 0;
  let span = 0;
  const tick = (now: number) => {
    if (!morph) return;
    const k = span ? Math.min((now - t0) / span, 1) : 1;
    // Played through, the pace is even; gliding to a hold, it eases out.
    morph.t = from + (goal - from) * (held === null ? k : out(k));
    render();
    if (k < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    frame = 0;
    if (morph.t >= 1) settle();
  };
  const moveTo = (to: number, ms: number) => {
    cancelAnimationFrame(frame);
    if (!morph) return;
    from = morph.t;
    goal = to;
    span = still.matches ? 0 : ms;
    t0 = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const glideMs = (to: number) =>
    Math.max(180, Math.abs(to - (morph?.t ?? 0)) * settings.duration);

  // Starts a morph to `key` from whatever is on show; quicker with a
  // backlog, down to a third of the duration.
  const begin = (key: string) => {
    const pace = Math.max(0.35, 1 / (1 + waiting.length * 0.6));
    before = shown;
    morph = { from: shown, to: key, t: 0, duration: settings.duration * pace };
    shown = key;
    if (held !== null) moveTo(held, glideMs(held));
    else moveTo(1, morph.duration);
  };

  // A morph done: the next glyph waiting goes in.
  const settle = () => {
    morph = null;
    render();
    const next = waiting.shift();
    if (next !== undefined) begin(next);
  };

  /** Shows a glyph: at once if nothing's under way, else after the morph.
   *  `replace` drops whatever was waiting, so it's next and runs at the
   *  full duration; by default it joins the queue. */
  const show = (key: string, { replace = false } = {}) => {
    // The first glyph is simply there; with reduced motion, every one is.
    if (!started || (still.matches && held === null)) {
      started = true;
      before = shown;
      shown = key;
      morph = null;
      waiting.length = 0;
      if (!frame) render();
      return;
    }
    // Held, a glyph goes straight in, to the held point.
    if (held !== null) {
      waiting.length = 0;
      if (key !== shown) begin(key);
      return;
    }
    if (replace) waiting.length = 0;
    const last = waiting.at(-1) ?? shown;
    if (key === last) return;
    if (morph && limit > 0) {
      waiting.push(key);
      if (waiting.length > limit) waiting.shift();
      return;
    }
    // A morph cut short starts the next from the glyph it was making.
    begin(key);
  };

  /** Freezes the morph at a phase or a point (0–1), gliding there, or lets
   *  it go with null or "settled". Held at rest, it holds the last morph
   *  again; each glyph shown while held morphs to the same point. */
  const hold = (at: Phase | number | null) => {
    const t =
      at === null || at === "settled"
        ? null
        : typeof at === "number"
          ? at
          : PHASES[at].at;
    held = t;
    waiting.length = 0;
    if (t === null) {
      if (morph) moveTo(1, (1 - morph.t) * morph.duration);
      return;
    }
    if (!morph) {
      if (!started) return;
      morph = { from: before, to: shown, t: 0, duration: settings.duration };
    }
    moveTo(t, glideMs(t));
  };

  // Applies the settings: what's cheap to change on the canvas itself
  // (rest blur, breath) only when it changed; the rest on the next frame.
  const dress = (prev: Settings | null) => {
    if (prev) readInk();
    const changed = (k: keyof Settings) => !prev || prev[k] !== settings[k];
    if (changed("rest")) {
      const soft = settings.rest * stage.size;
      canvas.style.filter = soft > 0 ? `blur(${soft.toFixed(2)}px)` : "";
    }
    if (changed("breathe")) {
      breath?.cancel();
      breath =
        settings.breathe > 0 && !still.matches
          ? canvas.animate([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], {
              duration: settings.breathe * 1000,
              iterations: Infinity,
              easing: "ease-in-out",
            })
          : undefined;
    }
    if (!frame) render();
  };

  const resize = () => {
    measure();
    if (gl) sizeFields();
    dress(null);
  };

  if (gl) setup();
  measure();
  if (gl) sizeFields();
  dress(null);
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  // Glyphs drawn before their font arrived are drawn again with it.
  const refont = () => {
    forget();
    if (!frame) render();
  };
  document.fonts.addEventListener("loadingdone", refont);
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    glyphs.clear();
    fields = [];
    setup();
    sizeFields();
    render();
  });

  return {
    show,
    hold,
    /** Changes the settings, for a morph under way too, all but its
     *  duration, and picks up the element's color again (after a theme
     *  change, say). */
    set: (next: Settings) => {
      const prev = settings;
      settings = { ...next };
      dress(prev);
    },
    teardown: () => {
      cancelAnimationFrame(frame);
      breath?.cancel();
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", refont);
      canvas.remove();
    },
  };
};
