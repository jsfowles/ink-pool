// What agents read: llms.txt, llms-full.txt and the raw pool.ts, built from
// the README and the source so they can't drift.
import readme from "../README.md?raw";
import source from "./pool.ts?raw";

export const SITE = "https://ink-pool.jsfowles.com";
const REPO = "https://github.com/jsfowles/ink-pool";

const SUMMARY =
  "A glyph transition for the web: two glyphs blur into one pool of ink, a threshold keeps the edge hard, and the next glyph firms up out of it. One TypeScript file, WebGL2, no dependencies.";

export const text = (body: string, type = "text/plain") =>
  new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8` } });

export const brief = `# Ink pool

> ${SUMMARY}

To use it, copy pool.ts into the project, give it an element whose CSS sets the size, font and color, and show it glyphs:

\`\`\`ts
import { inkPool } from "./pool";

const pool = inkPool(document.querySelector<HTMLElement>(".glyph")!);
await pool.show("A"); // the first glyph just appears
pool.show("B"); // A pools into B
\`\`\`

## Docs

- [Full docs](${SITE}/llms-full.txt): the README and the source of pool.ts in one file
- [pool.ts](${SITE}/pool.ts): the file to copy
- [README](${REPO}#readme): the same docs on GitHub

## Optional

- [Playground](${SITE}): start from a preset (Glass, Backdrop, Syrup, Drip, Crisp, Mercury or Smoke), tune the settings, then copy them and the file
`;

// The README without its picture header and folds, with links that work
// from anywhere, then the file itself.
export const full = `# Ink pool

> ${SUMMARY}

${readme
  .replace(/^<div align="center">[\s\S]*?<\/div>\n+/, "")
  .replace(/<details>\n<summary><b>(.+?)<\/b><\/summary>\n/g, "### $1\n")
  .replace(/\n<\/details>\n/g, "\n")
  .replace(/\]\((src|media)\//g, `](${REPO}/blob/main/$1/`)}
## Source: pool.ts

\`\`\`ts
${source}\`\`\`
`;

export { source };
