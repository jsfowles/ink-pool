// A glyph's key names it: "text:A", "word:INK", "line:INK RUNS", "shape:ring".
import type { Draw } from "./pool";

// The shapes, as paths in a 200-unit box centred on 0, 0.
const SHAPES: Record<string, string> = {
  disc: "M62 0A62 62 0 1 1 -62 0A62 62 0 1 1 62 0Z",
  ring: "M69 0A69 69 0 1 1 -69 0A69 69 0 1 1 69 0ZM47 0A47 47 0 1 0 -47 0A47 47 0 1 0 47 0Z",
  triangle: "M0 -70L66 52L-66 52Z",
  square: "M-54 -54H54V54H-54Z",
  cross: "M-14 -70h28v56h56v28h-56v56h-28v-56h-56v-28h56z",
  // A disc with a smaller one cut from it.
  crescent: "M13.4 -67.6A68 68 0 1 0 62.4 37.5A58 58 0 0 1 13.4 -67.6Z",
  bars: "M-66 -60h30v120h-30zM-15 -60h30v120h-30zM36 -60h30v120h-30z",
};
const paths = new Map<string, Path2D>();
// A sentence's line height, in its own font size.
const LEAD = 1.08;

// The band a sentence fits in, top and bottom in the stage's px, clear of
// whatever lies over the glyph; the whole stage until the page says.
let band: () => { top: number; bottom: number } | null = () => null;
export const setBand = (measure: typeof band) => (band = measure);

export type GlyphSet = { id: string; label: string; keys: string[] };

export const SETS: GlyphSet[] = [
  {
    id: "words",
    label: "Words",
    keys: [
      "INK",
      "POOL",
      "MELT",
      "FLOW",
      "TIDE",
      "DRIFT",
      "ECHO",
      "BLOOM",
      "STILL",
      "GLASS",
      "FORM",
      "SIGN",
    ].map((w) => `word:${w}`),
  },
  {
    id: "lines",
    label: "Lines",
    keys: [
      "INK RUNS INTO INK",
      "EVERY LETTER WAS A POOL",
      "THE NEXT ONE FORMS",
      "NOTHING HERE IS DRY",
      "WHAT SINKS COMES BACK",
      "Two glyphs blur together until their ink runs into one pool, a threshold keeps its edge hard, and the next glyph firms up out of it.",
      "THE EDGE IS A DECISION",
      "EACH WORD WAS ONCE A STAIN",
      "THE GLASS REMEMBERS",
      "Every letter starts as a pool. It spreads until it touches the next, and for a moment there is only ink. Then an edge decides itself, and something you can read comes up out of the dark.",
      "READ IT BEFORE IT RUNS",
      "ALL OF IT POOLS",
      "SOFT UNTIL IT ISN’T",
      "Nothing here is written twice. The last word sinks, the next one rises, and the ink between them is the only thing that stays.",
      "A SHAPE IS A POOL THAT HELD",
      "Read slowly. By the time you reach the end, the beginning has already gone back to ink.",
    ].map((k) => `line:${k}`),
  },
  {
    id: "type",
    label: "Type",
    keys: [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => `text:${c}`),
  },
  {
    id: "shapes",
    label: "Shapes",
    keys: Object.keys(SHAPES).map((k) => `shape:${k}`),
  },
];

// Pause and play, in a unit box centred on 0, 0.
const ICONS: Record<string, string> = {
  pause: "M-0.36 -0.4h0.25v0.8h-0.25zM0.11 -0.4h0.25v0.8h-0.25z",
  play: "M-0.3 -0.42L0.42 0L-0.3 0.42z",
};

/** Draws the pause or play icon, about a capital's height. */
export const drawIcon: Draw = (ctx, key, { width, height, size }) => {
  const k = size * 0.52;
  ctx.setTransform(
    ctx
      .getTransform()
      .translate(width / 2, height / 2)
      .scale(k, k),
  );
  ctx.fill(new Path2D(ICONS[key]));
};

/** What a glyph is, in words, for screen readers. */
export const describe = (key: string) => key.split(/:(.*)/s)[1] ?? "";

/** Draws a glyph into the pool's canvas, centred, at the stage's size. */
export const draw: Draw = (ctx, key, { width, height, size, font }) => {
  const [kind, value = ""] = key.split(/:(.*)/s);
  const cx = width / 2;
  const cy = height / 2;
  if (kind === "shape") {
    const d = SHAPES[value];
    if (!d) return;
    let path = paths.get(d);
    if (!path) paths.set(d, (path = new Path2D(d)));
    const k = (size * 1.2) / 200;
    ctx.setTransform(ctx.getTransform().translate(cx, cy).scale(k, k));
    ctx.fill(path, "evenodd");
    return;
  }
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Words run smaller than a letter, tracked; wide ones fit the width, and a
  // sentence wraps into balanced lines. Each returns how much smaller than
  // usual it drew, so the pool's spread shrinks with it.
  const word = kind === "word" || kind === "line";
  const set = (px: number) => {
    ctx.font = font.replace(`${size}px`, `${px}px`);
    ctx.letterSpacing = word ? `${px * 0.02}px` : "0px";
  };
  const max = word ? size * 0.72 : size;
  const room = width * 0.9;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    set(max);
    const wide = ctx.measureText(value).width;
    const px = wide > room ? (max * room) / wide : max;
    set(px);
    ctx.fillText(value, cx, cy);
    return px / max;
  }
  const lines = (w: number) => {
    const out = [words[0]];
    for (const next of words.slice(1)) {
      const line = `${out.at(-1)} ${next}`;
      if (ctx.measureText(line).width <= w) out[out.length - 1] = line;
      else out.push(next);
    }
    return out;
  };
  const free = band();
  const tall = Math.min(size * 0.85, free ? free.bottom - free.top : size);
  const fits = (px: number) => {
    set(px);
    const all = lines(room);
    return (
      all.length * px * LEAD <= tall &&
      all.every((l) => ctx.measureText(l).width <= room)
    );
  };
  let lo = 8;
  let hi = max;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  set(lo);
  // As many lines as the size needs, each as even as the words allow.
  const count = lines(room).length;
  let narrow = 0;
  let wide = room;
  while (wide - narrow > 1) {
    const mid = (narrow + wide) / 2;
    if (lines(mid).length <= count) wide = mid;
    else narrow = mid;
  }
  const rows = lines(wide);
  // Centred where a capital's ink would be, inside the free band.
  const block = rows.length * lo * LEAD;
  const middle = free
    ? Math.min(
        Math.max(cy - 0.065 * size, free.top + block / 2),
        free.bottom - block / 2,
      )
    : cy;
  for (const [i, row] of rows.entries())
    ctx.fillText(row, cx, middle + (i - (rows.length - 1) / 2) * lo * LEAD);
  return lo / max;
};
