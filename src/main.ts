import { paintFog } from "./fog";
import { describe, draw, SETS } from "./glyphs";
import { startLedger } from "./ledger";
import { inkMark, inkRun, inkSwap, inkText, RUN } from "./ink";
import { inkPool, PHASES, type Phase } from "./pool";
import source from "./pool.ts?raw";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// Left alone, a glyph each morph plus this long.
const PAUSE = 1700;
// Quiet this long after a key or a click.
const IDLE = 9000;

const phases = [...$("phases").querySelectorAll<HTMLElement>("[data-phase]")];
const holds = [
  ...$("phases").querySelectorAll<HTMLButtonElement>("[data-hold]"),
];
// The phase dot runs down the names with the morph, then back up to
// "start" a beat after it settles.
const mark = $("phase-mark");
const stops = [...Object.values(PHASES).map((p) => p.at), 1];
const BEAT = 600;
let centres: number[] = [];
let lastY = 0;
let parked = false;
let parking = 0;
const near: string[] = [];
const measureStops = () => {
  centres = phases.map((li) => li.offsetTop + li.offsetHeight / 2);
};
const moveMark = (y: number) => {
  // By translate, apart from transform, so a run's stretch scales the dot
  // and never its distance down the list.
  mark.style.translate = `0 ${y.toFixed(1)}px`;
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
      inkRun(mark, 0, to - from, false);
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
  if (back) inkRun(mark, 0, y - was);
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

const pool = inkPool($("pool"), undefined, {
  draw,
  onProgress: showProgress,
});
let touring = true;
let tourStep = false;
const ledger = startLedger((settings, { live, preset }) => {
  pool.set(settings);
  if (!tourStep && touring) {
    touring = false;
    ledger.endTour();
  }
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
const write = (key: string, announce = false, replace = false) => {
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
inkMark(
  $("preset-mark"),
  [...document.querySelectorAll<HTMLElement>("[data-preset]")],
  (b) => [b.offsetLeft - 14, b.offsetTop + b.offsetHeight / 2 - 2.5],
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
const keepWriting = () => {
  clearTimeout(timer);
  const writes = $<HTMLInputElement>("auto").checked && !reduced.matches;
  timer = setTimeout(() => {
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
  }, ledger.settings().duration + PAUSE);
};
$("auto").addEventListener("change", keepWriting);

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
  stopDemo();
  step(1, true);
});
for (const [i, b] of setButtons.entries())
  b.addEventListener("click", () => {
    stopDemo();
    quietUntil = 0;
    choose(i);
    at = 0;
    write(SETS[i].keys[0], true, true);
    keepWriting();
  });

const form = $<HTMLFormElement>("write");
const field = $<HTMLInputElement>("write-text");
let typed = "";

const writeChar = (char: string) => {
  const type = SETS.findIndex((s) => s.id === "type");
  const found = SETS[type].keys.indexOf(`text:${char.toUpperCase()}`);
  if (found >= 0) {
    choose(type);
    at = found;
  }
  write(`text:${char}`, true);
};

field.addEventListener("input", () => {
  touched();
  stopDemo();
  const value = field.value;
  form.toggleAttribute("data-word", [...value.trim()].length > 1);
  // The key just typed, or after a delete, the last one left.
  const grew = value.length > typed.length;
  const char = grew
    ? value.slice(0, field.selectionStart ?? value.length).slice(-1)
    : value.slice(-1);
  typed = value;
  if (char.trim()) writeChar(char);
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = field.value.trim();
  if (!value) return;
  touched();
  write([...value].length > 1 ? `word:${value}` : `text:${value}`, true);
  field.value = typed = "";
  form.removeAttribute("data-word");
});
field.addEventListener("keydown", (e) => {
  if (e.key === "Escape") field.blur();
});

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.matches("input, textarea, select") || target.isContentEditable);
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
  if (root.dataset.ledger === "open" && e.target !== document.body) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    touched();
    stopDemo();
    step(e.key === "ArrowRight" ? 1 : -1, true);
    return;
  }
  // Focused now, the field takes this very key.
  if (e.key.length === 1 && e.key !== " ") field.focus({ preventScroll: true });
});

// First visit only: the line types a word by itself, to show that typing
// is how you play.
const SEEN = "ink-pool:wrote";
let demo: number[] = [];
const seen = () => {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return true;
  }
};
const remember = () => {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {}
};
function stopDemo() {
  if (!demo.length) return;
  demo.forEach(clearTimeout);
  demo = [];
  if (!typed) field.value = "";
  form.removeAttribute("data-word");
  remember();
}
const playDemo = () => {
  if (seen() || reduced.matches) return;
  const word = "INK";
  let t = 1800;
  const later = (ms: number, fn: () => void) => {
    t += ms;
    demo.push(setTimeout(fn, t));
  };
  touched();
  quietUntil = Infinity;
  [...word].forEach((char, i) =>
    later(i ? 900 : 0, () => {
      field.value = word.slice(0, i + 1);
      form.toggleAttribute("data-word", i > 0);
      writeChar(char);
    }),
  );
  later(1400, () => write(`word:${word}`));
  later(2200, () => {
    field.value = "";
    form.removeAttribute("data-word");
    demo = [];
    remember();
    touched();
  });
};

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
  playDemo();
});
