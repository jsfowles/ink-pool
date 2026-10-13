// The glyph sets the playground morphs between, and how each kind is drawn.
// A glyph's key names it: "text:A", "word:INK", "shape:ring".
import type { Draw } from "./pool";

// The shapes, as paths in a 200-unit box centred on 0, 0.
const SHAPES: Record<string, string> = {
  disc: "M62 0A62 62 0 1 1 -62 0A62 62 0 1 1 62 0Z",
  ring: "M69 0A69 69 0 1 1 -69 0A69 69 0 1 1 69 0ZM47 0A47 47 0 1 0 -47 0A47 47 0 1 0 47 0Z",
  triangle: "M0 -70L66 52L-66 52Z",
  square: "M-54 -54H54V54H-54Z",
  cross: "M-14 -70h28v56h56v28h-56v56h-28v-56h-56v-28h56z",
  // A disc with a smaller one cut from its upper right, centred on its box.
  crescent: "M13.4 -67.6A68 68 0 1 0 62.4 37.5A58 58 0 0 1 13.4 -67.6Z",
  bars: "M-66 -60h30v120h-30zM-15 -60h30v120h-30zM36 -60h30v120h-30z",
};
const paths = new Map<string, Path2D>();

export type GlyphSet = { id: string; label: string; keys: string[] };

export const SETS: GlyphSet[] = [
  {
    id: "type",
    label: "Type",
    keys: [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => `text:${c}`),
  },
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
    id: "shapes",
    label: "Shapes",
    keys: Object.keys(SHAPES).map((k) => `shape:${k}`),
  },
];

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
  // As large as the size allows and no wider than the stage: a wide letter
  // (M, W) or a word fits itself to the width. A word runs a little smaller,
  // with a touch of tracking.
  const word = kind === "word";
  const fit = (px: number) => {
    ctx.font = font.replace(`${size}px`, `${px}px`);
    ctx.letterSpacing = word ? `${px * 0.02}px` : "0px";
    return ctx.measureText(value).width;
  };
  const max = word ? size * 0.72 : size;
  const wide = fit(max);
  if (wide > width * 0.9) fit((max * width * 0.9) / wide);
  ctx.fillText(value, cx, cy);
};
