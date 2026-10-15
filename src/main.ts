import { paintFog } from "./fog";
import { describe, draw, drawIcon, setBand, SETS } from "./glyphs";
import { startLedger } from "./ledger";
import { inkMark, inkRun, inkSwap, inkText, RUN } from "./ink";
import { DEFAULTS, inkPool, PHASES, type Phase } from "./pool";
import source from "./pool.ts?raw";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// Left alone, a glyph each morph plus this long.
const PAUSE = 1700;
// Quiet this long after a key or a click.
const IDLE = 9000;
// And a line stays up long enough to read: this long a word.
const READ = 300;

const phases = [...$("phases").querySelectorAll<HTMLElement>("[data-phase]")];
const holds = [
  ...$("phases").querySelectorAll<HTMLButtonElement>("[data-hold]"),
];
// The phase dot runs down the names with the morph, then back up to
// "start" a beat after it settles. Upright, the names are a row, and it runs
// along it.
const mark = $("phase-mark");
const stops = [...Object.values(PHASES).map((p) => p.at), 1];
const BEAT = 600;
let centres: number[] = [];
let across = false;
let lastY = 0;
let parked = false;
let parking = 0;
const near: string[] = [];
const measureStops = () => {
  across = phases[0].offsetTop === phases[1].offsetTop;
  centres = phases.map((li) =>
    across
      ? li.offsetLeft + li.offsetWidth / 2
      : li.offsetTop + li.offsetHeight / 2,
  );
};
const runMark = (by: number, move?: boolean) =>
  across ? inkRun(mark, by, 0, move) : inkRun(mark, 0, by, move);
const moveMark = (y: number) => {
  // By translate, apart from transform, so a run's stretch scales the dot
  // and never its distance down the list.
  mark.style.translate = across ? `${y.toFixed(1)}px 0` : `0 ${y.toFixed(1)}px`;
  lastY = y;
  const row = centres[1] - centres[0] || 1;
  for (const [i, li] of phases.entries()) {
    const n = Math.max(0, 1 - Math.abs(y - centres[i]) / row).toFixed(2);
    if (n === near[i]) continue;
    near[i] = n;
    li.style.setProperty("--near", n);
  }
};
const showProgress = (t: number) => {
  if (!centres.length) measureStops();
  if (t >= 1) {
    if (parked) return;
    moveMark(centres.at(-1)!);
    clearTimeout(parking);
    parking = setTimeout(() => {
      if (root.dataset.held) return;
      parked = true;
      const from = lastY;
      const to = centres[0];
      if (reduced.matches) return moveMark(to);
      runMark(to - from, false);
      const begun = performance.now();
      const run = (now: number) => {
        if (!parked) return;
        const k = Math.min((now - begun) / RUN, 1);
        moveMark(from + (to - from) * (1 - (1 - k) ** 4));
        if (k < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    }, BEAT);
    return;
  }
  clearTimeout(parking);
  const i = Math.max(
    stops.findIndex((s) => t <= s),
    0,
  );
  const from = Math.max(i - 1, 0);
  const span = stops[i] - stops[from];
  const k = span > 0 ? (t - stops[from]) / span : 1;
  const y = centres[from] + (centres[i] - centres[from]) * k;
  // A new morph before the dot got back up: it runs, not jumps.
  const back = !parked && y < lastY - 1 && lastY === centres.at(-1);
  const was = lastY;
  parked = false;
  moveMark(y);
  if (back) runMark(y - was);
};
new ResizeObserver(measureStops).observe($("phases"));

const note = $("phase-note");
const explain = (name?: string) => {
  const b = holds.find((h) => h.dataset.hold === (name ?? root.dataset.held));
  const held = b && b.dataset.hold === root.dataset.held;
  inkSwap(
    note,
    b ? `${b.dataset.note}${held ? " Click it again to let go." : ""}` : "",
  );
};

// A sentence sits between the sets and whatever lies under the glyph:
// upright, the presets. Measured from the glyph's untransformed box, so an
// open sheet doesn't skew it.
setBand(() => {
  const ink = $("ink");
  const stage = ink.parentElement!.getBoundingClientRect();
  const top = stage.top + ink.offsetTop;
  const left = stage.left + ink.offsetLeft;
  const over = (r: DOMRect) =>
    r.right > left + ink.offsetWidth * 0.2 &&
    r.left < left + ink.offsetWidth * 0.8;
  let bottom = innerHeight;
  for (const el of document.querySelectorAll(".presets .rail")) {
    const r = el.getBoundingClientRect();
    if (over(r)) bottom = Math.min(bottom, r.top - 16);
  }
  const head = $("sets").getBoundingClientRect().bottom;
  return { top: head + 16 - top, bottom: bottom - top };
});
const pool = inkPool($("pool"), undefined, {
  draw,
  onProgress: showProgress,
});
let touring = true;
let tourStep = false;
const ledger = startLedger((settings, { live, preset }) => {
  pool.set(settings);
  if (!tourStep) touring = false;
  // Letting go of a slider or choosing a preset writes the next glyph. A
  // preset also lets go of a hold; a slider keeps it, to tune the held frame.
  if (live) return;
  if (preset && root.dataset.held) holdAt(null);
  next();
  keepWriting();
}, source);
pool.set(ledger.settings());

let set = 0;
let at = 0;
const setButtons = [
  ...$("sets").querySelectorAll<HTMLButtonElement>("[data-set]"),
];
const now = $("now");

// Typed glyphs queue so each finishes; the page's own replace the queue.
let last = "";
const write = (key: string, announce = false, replace = false) => {
  last = key;
  if (announce) now.textContent = describe(key);
  pool.show(key, { replace });
};
const choose = (index: number) => {
  set = index;
  for (const [i, b] of setButtons.entries())
    b.ariaPressed = String(i === index);
};
inkMark($("sets-mark"), setButtons, (b) => [
  b.offsetLeft + b.offsetWidth / 2 - 2.5,
  b.offsetTop + b.offsetHeight - 5,
]);
const presets = [...document.querySelectorAll<HTMLElement>("[data-preset]")];
// Beside the name in a list, under it in a row.
inkMark($("preset-mark"), presets, (b) =>
  presets[0].offsetTop === presets[1].offsetTop
    ? [b.offsetLeft + b.offsetWidth / 2 - 2.5, b.offsetTop + b.offsetHeight - 5]
    : [b.offsetLeft - 14, b.offsetTop + b.offsetHeight / 2 - 2.5],
);
const step = (by: number, announce = false, replace = false) => {
  const keys = SETS[set].keys;
  at = (at + by + keys.length) % keys.length;
  write(keys[at], announce, replace);
};
function next() {
  step(1, false, true);
}

let quietUntil = 0;
let written = 0;
let timer = 0;
const touched = () => (quietUntil = performance.now() + IDLE);
const reading = () =>
  last.startsWith("line:") ? last.split(/\s+/).length * READ : 0;
const keepWriting = () => {
  clearTimeout(timer);
  const writes = $<HTMLInputElement>("auto").checked && !reduced.matches;
  timer = setTimeout(
    () => {
      const free = performance.now() > quietUntil && !root.dataset.held;
      if (writes && free && !document.hidden) {
        // Every third glyph, the next preset (which writes one itself).
        if (touring && ++written % 3 === 0) {
          tourStep = true;
          ledger.tour();
          tourStep = false;
          return;
        }
        next();
      }
      keepWriting();
    },
    ledger.settings().duration + PAUSE + reading(),
  );
};
// Pause in the header and the switch in the settings are one control.
const auto = $<HTMLInputElement>("auto");
const pause = $<HTMLButtonElement>("pause");
// Its icon pools from one to the other, on the Glass preset.
const icon = inkPool($("pause-icon"), DEFAULTS, { draw: drawIcon, queue: 0 });
const showPause = () => {
  icon.show(auto.checked ? "pause" : "play");
  pause.ariaLabel = `${auto.checked ? "Pause" : "Play"} the writing`;
};
pause.addEventListener("click", () => {
  auto.checked = !auto.checked;
  showPause();
  keepWriting();
});
auto.addEventListener("change", () => {
  showPause();
  keepWriting();
});
showPause();

const holdAt = (name: string | null) => {
  const held = name && name !== "settled" ? name : "";
  root.dataset.held = held;
  for (const b of holds) b.ariaPressed = String(b.dataset.hold === held);
  pool.hold((held || null) as Phase | null);
};
for (const b of holds) {
  b.addEventListener("click", () => {
    touched();
    holdAt(root.dataset.held === b.dataset.hold ? null : b.dataset.hold!);
    explain(b.dataset.hold);
  });
  for (const type of ["pointerenter", "focus"])
    b.addEventListener(type, () => explain(b.dataset.hold));
  for (const type of ["pointerleave", "blur"])
    b.addEventListener(type, () => explain());
}

$("ink").addEventListener("click", () => {
  touched();
  step(1, true);
});
for (const [i, b] of setButtons.entries())
  b.addEventListener("click", () => {
    quietUntil = 0;
    choose(i);
    at = 0;
    write(SETS[i].keys[0], true, true);
    keepWriting();
  });

const writeChar = (char: string) => {
  const type = SETS.findIndex((s) => s.id === "type");
  const found = SETS[type].keys.indexOf(`text:${char.toUpperCase()}`);
  if (found >= 0) {
    choose(type);
    at = found;
  }
  write(`text:${char}`, true);
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.matches("input, textarea, select") || target.isContentEditable);
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
  if (root.dataset.ledger === "open" && e.target !== document.body) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    touched();
    step(e.key === "ArrowRight" ? 1 : -1, true);
    return;
  }
  if (e.key.length === 1 && e.key !== " ") {
    touched();
    writeChar(e.key);
  }
});

const THEME = "ink-pool:theme";
const themeButton = $<HTMLButtonElement>("theme");
const themeColor = document.querySelector('meta[name="theme-color"]');
const showTheme = () => {
  const dark = root.dataset.theme === "dark";
  inkText(themeButton, dark ? "Light" : "Dark");
  themeButton.ariaLabel = `Switch to the ${dark ? "light" : "dark"} glass`;
  themeColor?.setAttribute(
    "content",
    getComputedStyle(root).getPropertyValue("--fog").trim(),
  );
  pool.set(ledger.settings());
};
const chosen = () => {
  try {
    return localStorage.getItem(THEME);
  } catch {
    return null;
  }
};
// Without View Transitions, or with reduced motion, it simply changes.
const setTheme = (next: string) => {
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME, next);
  } catch {}
  showTheme();
};
themeButton.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  if (!document.startViewTransition || reduced.matches) return setTheme(next);
  document.startViewTransition(() => setTheme(next));
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (chosen()) return;
  root.dataset.theme = e.matches ? "dark" : "light";
  showTheme();
});
showTheme();

reduced.addEventListener("change", () => {
  pool.set(ledger.settings());
  keepWriting();
});

paintFog([...document.querySelectorAll<HTMLElement>(".fog")]);

// Wait for the font (at most 1.5s) so the first glyph is drawn in it.
void Promise.race([
  document.fonts.load('700 1em "Poppins"'),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(() => {
  choose(0);
  pool.show("");
  root.classList.add("ready");
  setTimeout(() => write(SETS[0].keys[0]), reduced.matches ? 0 : 450);
  keepWriting();
});
