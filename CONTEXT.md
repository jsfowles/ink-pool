# Ink pool

- **Glyph**: what a pool shows. A key string; `draw` turns it into a picture.
- **Morph**: one glyph becoming the next: both blur into a pool, the threshold cuts its edge, and the new glyph firms up.
- **Pool**: one running effect on one element (`inkPool`). Its interface is `show`, `hold`, `set` and `teardown`.
- **Stage**: the element's box and font, as `draw` sees it.
- **Room**: the part of the stage text may use, when something sits over the rest.
- **Settings**: the numbers that shape a morph. `set` eases between them.
- **Preset**: a named set of settings in the playground.
- **Phase**: a stretch of a morph: start, melting, pooled, forming, settled.
- **Hold**: a morph frozen at a phase or a point from 0 to 1.
- **Timeline**: the morphs over time: what shows, what waits, how far along. Runs on a clock it's given, so it's tested without a browser.
- **Renderer**: draws the timeline's view. WebGL is the morph; the 2D renderer shows each glyph at rest where WebGL2 isn't there.
- **Playground**: the site around the pool, for tuning it. Everything in `src/` but `pool.ts`.
