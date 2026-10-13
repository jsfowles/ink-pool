# Ink pool

A glyph transition: two glyphs blur together until their ink runs into one pool, a threshold keeps the pool's edge hard, and the next glyph firms up out of it as the old one sinks away.

**[Try the playground →](https://ink-pool.jsfowles.com)**

This repo is the effect and a playground to tune it. The effect itself is one file, [`src/pool.ts`](src/pool.ts), with no dependencies. It draws with WebGL2 into a canvas.

## Install

Copy [`src/pool.ts`](src/pool.ts) into your project. That's all; the playground's **Copy pool.ts** copies the same file.

## Use

Give `inkPool` an element and a settings object, then show it glyphs. Each new one pools in from the last.

```ts
import { inkPool, DEFAULTS } from "./pool";

const pool = inkPool(document.querySelector<HTMLElement>(".glyph")!, DEFAULTS);

document.fonts.ready.then(() => pool.show("A"));

// Later:
pool.show("B"); // A pools into B
```

The canvas fills the element, and the element sets the look:

- **Size.** The glyph is drawn at the element's `font-size`, centred, in its font family and weight.
- **Colour.** The ink is the element's `color`. After a theme change, call `pool.set(settings)` and it picks the colour up again.
- **Room.** Every length is a share of the font size (em), and the ink spreads and sinks past the glyph's own outline. Leave the element room around it; the playground's is twice the glyph's size wide and 1.7 times tall.

A few more things worth knowing:

- **Wait for your fonts.** Glyphs are drawn once into a texture. Ones drawn before their font arrived are redrawn when it loads, but the first frame looks better with it already there.
- **Queueing.** Glyphs shown faster than a morph wait their turn, and a backlog plays quicker, down to about a third of `duration`, so it keeps up. `show(key, { replace: true })` drops whatever was waiting, so the new glyph is next and runs at full length.
- **Your own settings.** Tune the pool in the playground, then use **Copy settings** to get them as code. It copies only what differs from the defaults, as `{ ...DEFAULTS, spread: 0.1 }`, ready to pass to `inkPool` or `pool.set`.
- **Clean up.** `pool.teardown()` stops the frame loop and its observers and removes the canvas.

### Hold a moment

`hold` freezes the morph at one of its phases, gliding there, so you can see or show a single moment of it. While held, each glyph you show morphs to that same point and stops.

```ts
pool.hold("pooled"); // one pool of ink, at its widest
pool.hold(0.3); // or any point from 0 to 1
pool.hold(null); // lets it finish
```

The phases, in order, are `start`, `melting`, `pooled`, `forming` and `settled`.

### Options

A third argument takes options:

```ts
const pool = inkPool(el, DEFAULTS, {
  draw, // draws a glyph from its key; by default the key is the text
  onPhase: (phase) => {}, // as the morph passes from phase to phase
  onProgress: (t) => {}, // each frame, how far the morph has got, 0 to 1
  queue: 3, // how many glyphs may wait; 0 cuts a morph short instead
});
```

### Glyphs that aren't text

By default a glyph's key is the text it draws. Pass `draw` to draw anything else into the 2D canvas the pool keeps for each glyph, centred, in any opaque colour. The pool inks it in the element's colour.

```ts
import type { Draw } from "./pool";

const draw: Draw = (ctx, key, { width, height, size, font }) => {
  if (key === "dot") {
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(key, width / 2, height / 2);
};
```

If you draw a glyph smaller than `size` (a sentence wrapped into lines, say), return that share of the size from `draw`. The spread, sink, rise and resting blur scale with it, so small text pools the way a big glyph does instead of dissolving.

The playground's [`src/glyphs.ts`](src/glyphs.ts) draws words, sentences and SVG shapes this way.

## Settings

Ranges are the ones the playground offers; values outside them work too.

| Setting     | Default | Range         | What it does                                                                     |
| ----------- | ------- | ------------- | -------------------------------------------------------------------------------- |
| `duration`  | `950`   | 150–3000 (ms) | One morph.                                                                       |
| `spread`    | `0.05`  | 0–0.15 (em)   | How far the ink spreads at the morph's height.                                   |
| `sink`      | `7`     | 0–30 (%)      | How far the old glyph sinks as it goes, as a share of the glyph's size.          |
| `rise`      | `4`     | 0–30 (%)      | How far above its place the new glyph starts.                                    |
| `hardness`  | `24`    | 1–60          | How sharply the threshold cuts the pool's edge. Low values leave smoke.          |
| `threshold` | `0.42`  | 0.1–0.9       | Where the cut falls, as a share of the ink's density. Lower is bolder.           |
| `rest`      | `0`     | 0–0.04 (em)   | Softness at rest: a blur over the whole glyph.                                   |
| `opacity`   | `1`     | 0.02–1        | The glyph's opacity, as a whole.                                                 |
| `fadeStart` | `100`   | 0–100 (%)     | A fade downward: solid down to here, from the top. `100` is no fade.             |
| `fadeEnd`   | `100`   | 0–100 (%)     | Gone by here, further down than `fadeStart`.                                     |
| `breathe`   | `0`     | 0–6 (s)       | A slow pulse at rest, one breath in seconds, down to 40% opacity. `0` is off.    |

The playground's presets show what they do together:

- **Glass**: the defaults, full ink and no blur at rest.
- **Backdrop**: half strength behind your copy, fading down and breathing.
- **Syrup**: slow and heavy, one big round pool.
- **Snap**: nearly a cut; it barely pools.
- **Mercury**: strands snap into hard, bright beads.
- **Smoke**: a soft edge that drifts.

## Good to know

- **Reduced motion.** The pool checks `prefers-reduced-motion` for you: each glyph simply replaces the last, and the breath stays still. A hold still works, so you can show a single moment.
- **Screen readers.** The canvas is hidden from them. Say what the glyph is somewhere they can read it; the playground keeps a polite live region.
- **Without WebGL2.** The pool falls back to a plain 2D canvas that shows each glyph at rest, with no morph.
- **Cost.** It draws only while a morph runs, then stops, on a canvas capped at twice the screen's pixel density. The spread runs at a fraction of that size, so a wide spread costs about the same as a narrow one.
- **Browsers.** Built and tested in Chromium. Check Safari and Firefox with your own glyphs and settings.

## The playground

```bash
npm install
npm run dev
npm run check   # typecheck and formatting
npm run build
```

The playground is an [Astro](https://astro.build) page that builds to static HTML. Type to write a glyph, Enter to write the whole line (a word, a sentence or a pasted paragraph), the arrow keys to step through a set, and pick a phase to hold the morph there. Left alone it writes on its own, touring the sets and presets; Pause stops it.

- `src/pool.ts`: the effect.
- `src/pages/index.astro`: the page, with `src/components/` for the presets, the settings sheet and the text that inverts over the ink.
- `src/main.ts`: starts the playground: the glyph sets, the writing line, the phases and the theme.
- `src/glyphs.ts`: the glyph sets and how words, sentences and shapes are drawn.
- `src/ledger.ts`, `src/controls.ts`, `src/presets.ts`: the settings sheet, its controls and its presets.
- `src/ink.ts`: the inverting text and the ink dots that mark what's chosen.
- `src/fog.ts`: the drifting fog behind the glass.
- `src/styles/`: the global styles (tokens, fonts, reset, sliders, the page) and the layout mixins.

## Licence

MIT, see [LICENSE](LICENSE). The fonts in `public/fonts`, Poppins and DM Mono, are under the SIL Open Font License.
