<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/hero-dark.webp" />
  <img src="media/hero-light.webp" alt="The word INK pools into POOL, then MELT, then back into INK" width="100%" />
</picture>

# Ink pool

A glyph transition. Two glyphs blur into one pool of ink, a threshold keeps the edge sharp, and the next one firms up out of it.

**[Play with it](https://ink-pool.jsfowles.com)** · [Quick start](#quick-start) · [API](#api) · [Settings](#settings)

<sub>One file, <a href="src/pool.ts"><code>src/pool.ts</code></a>. No dependencies. WebGL2.</sub>

</div>

## Quick start

Copy [`src/pool.ts`](src/pool.ts) into your project, or hit **Copy pool.ts** in the playground. Give it an element whose CSS sets the size, font and color, with room for the ink to spread:

```css
.glyph {
  width: 600px; /* about 2× the font size */
  height: 500px; /* and 1.7× */
  font: 700 300px/1 "Poppins", sans-serif;
  color: #111;
}
```

```ts
import { inkPool } from "./pool";

const pool = inkPool(document.querySelector<HTMLElement>(".glyph")!);
pool.show("A"); // the first glyph appears as is
pool.show("B"); // A pools into B
```

## Recipes

**Cycle words.** `show` resolves once its glyph settles, or `false` if something replaced it first.

```ts
for (let i = 0; ; i++) {
  await pool.show(words[i % words.length]);
  await sleep(1500);
}
```

**Your settings.** Tune them in the playground and hit **Copy settings** to get the ones you changed. `set` eases to new ones over 500ms; `{ ease: 0 }` snaps.

```ts
const pool = inkPool(el, { spread: 0.1, sink: 12 });
pool.set({ hardness: 8 });
```

**Sentences** wrap and shrink to fit. If something covers part of the element, `room` says where text may go, in px down it.

```ts
const pool = inkPool(el, {}, { room: () => ({ top: 80, bottom: 420 }) });
pool.show("Ink runs into ink");
```

**Freeze it** at `start`, `melting`, `pooled`, `forming` or `settled`, or anywhere from 0 to 1. The stops fall in different places for different settings, and `pool.phases()` says where.

```ts
pool.hold("pooled");
pool.hold(null); // lets it finish
```

**Run it up the page.** The glyph turns inside the element and grows to its height, so make the element tall. A sentence keeps its lines.

```ts
pool.set({ turn: 1 });
```

<details>
<summary><b>Your own shapes</b></summary>

Pass `draw` and draw anything, in any color. If it's smaller than `size`, return the share (`0.5`, say) and the effect scales with it.

```ts
import { inkPool, type Draw } from "./pool";

const draw: Draw = (ctx, key, { width, height, size }) => {
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, size * (key === "big" ? 0.45 : 0.2), 0, 7);
  ctx.fill();
};

const pool = inkPool(el, {}, { draw });
pool.show("big");
```

</details>

<details>
<summary><b>React</b></summary>

Make it once, `show` when the text changes, `teardown` when it unmounts.

```tsx
import { useEffect, useRef } from "react";
import { inkPool, type Pool } from "./pool";

export const InkGlyph = ({ text }: { text: string }) => {
  const el = useRef<HTMLDivElement>(null);
  const pool = useRef<Pool | null>(null);

  useEffect(() => {
    pool.current = inkPool(el.current!);
    return () => pool.current?.teardown();
  }, []);

  useEffect(() => {
    pool.current?.show(text);
  }, [text]);

  return <div ref={el} className="glyph" role="img" aria-label={text} />;
};
```

</details>

## API

| Call                             | Does                                                             |
| -------------------------------- | ---------------------------------------------------------------- |
| `inkPool(el, settings, options)` | Starts a pool in `el`. Both after `el` are optional.             |
| `pool.show(glyph, { replace })`  | Shows a glyph after any still morphing; `replace` starts it now. |
| `pool.hold(stop)`                | Freezes it at a stop. `null` lets go.                            |
| `pool.set(settings, { ease })`   | Eases to the settings you pass. `ease` is in ms; `0` snaps.      |
| `pool.phases()`                  | Where each stop falls in a morph, as shares of it.               |
| `pool.teardown()`                | Stops it and removes the canvas.                                 |

Options: `draw`, `room`, `queue` (how many glyphs can wait, `3`; `0` cuts a morph short instead), and `onPhase` / `onProgress` to follow a morph.

## Settings

| Setting     | Default | Range      | Does                                        |
| ----------- | ------- | ---------- | ------------------------------------------- |
| `duration`  | `950`   | 150–3000ms | How long a morph takes.                     |
| `spread`    | `0.05`  | 0–0.15em   | How far the ink spreads.                    |
| `sink`      | `7`     | 0–30%      | How far the old glyph drops on the way out. |
| `rise`      | `4`     | 0–30%      | How far above its spot the new one starts.  |
| `hardness`  | `24`    | 1–60       | How sharp the edge is. Low gets smoky.      |
| `threshold` | `0.42`  | 0.1–0.9    | Where the edge falls. Lower is bolder.      |
| `rest`      | `0`     | 0–0.04em   | Blur when it's sitting still.               |
| `opacity`   | `1`     | 0.02–1     | Overall opacity.                            |
| `fadeStart` | `100`   | 0–100%     | Fades out downward from here. `100` is off. |
| `fadeEnd`   | `100`   | 0–100%     | Gone by here.                               |
| `breathe`   | `0`     | 0–6s       | Settles dimmer at rest over this long, and brightens as the next morph starts. `0` is off. |
| `turn`      | `0`     | 0–1        | `1` runs it up the page.                    |

The playground's presets make good starting points: Glass (the defaults), Backdrop (faint, for behind copy), Syrup, Drip, Crisp, Mercury and Smoke.

## Good to know

- The ink is the element's `color`, and the pool picks up changes to it, so dark mode needs no code.
- With reduced motion, glyphs swap without the morph. Without WebGL2, each one shows at rest.
- The canvas is hidden from screen readers, so label the element.
- Every pool on a page draws through one shared WebGL2 context, so use as many as you like; browsers allow only about 16 contexts at once. If the browser takes it away, each pool keeps its last frame and shows new glyphs at rest until it's back.
- It draws only while something moves and is on screen, and a morph cut short picks up the pool where it is.
- Agents can read [llms.txt](https://ink-pool.jsfowles.com/llms.txt), or [llms-full.txt](https://ink-pool.jsfowles.com/llms-full.txt) for this README and the source in one file.

> [!NOTE]
> I've mostly tested it in Chrome. Safari and Firefox should be fine, but check.

## The playground

```bash
npm install
npm run dev
```

An Astro page around `src/pool.ts`. Pick a set (Words, Lines, Type or Shapes), then press any key to write it, <kbd>←</kbd> <kbd>→</kbd> to step through the set, or click the glyph for another. The turn button runs words and lines up the page.

Beside the glyph, the presets change the feel, and the phases show where each morph is as its dot runs down them. Click one to hold the morph there. **Settings** has every value, with **Copy settings** and **Copy pool.ts**.

`npm run check` typechecks and formats; `npm test` runs the morph timeline on a fake clock.

## License

MIT. Poppins and DM Mono are under the SIL Open Font License.
