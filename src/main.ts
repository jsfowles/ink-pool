import { paintFog } from "./fog";
import { describe, draw, drawIcon, inkBottom, SETS } from "./glyphs";
import { startLedger } from "./ledger";
import { createArrange } from "./arrange";
import { inkDot, inkRun, inkSwap, inkText, RUN } from "./ink";
import { inkPool, type Phase } from "./pool";
import source from "./pool.ts?raw";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// Left alone, a glyph each morph plus this long.
const PAUSE = 1700;
// The first, once the page is in.
const FIRST = 600;
// Quiet this long after a key or a click.
const IDLE = 9000;
// And a line stays up long enough to read: this long a word.
const READ = 300;

const phases = [...$("phases").querySelectorAll<HTMLElement>("[data-phase]")];
const holds = [
  ...$("phases").querySelectorAll<HTMLButtonElement>("[data-hold]"),
];
// The phase dot runs down the names with the morph, then back up to
// "start" a beat after it settles. Each name brightens as it passes. It's on
// a name while the pool's phases say so: leaving the start as the glyph starts
// melting, and reaching "settled" as it settles, for the settings it has.
const stopsNow = () => {
  const { start, melting, pooled, forming } = pool.phases();
  return [start.until, melting.at, pooled.at, forming.at, forming.until];
};
const END = phases.length - 1;
const BEAT = 600;
const phaseDot = inkDot($("phase-mark"), holds);
// It waits at the start until the first glyph is written.
let parked = true;
let parking = 0;
const near: string[] = [];
const moveDot = (at: number) => {
  phaseDot.to(at);
  for (const [i, li] of phases.entries()) {
    const n = Math.max(0, 1 - Math.abs(at - i)).toFixed(2);
    if (n === near[i]) continue;
    near[i] = n;
    li.style.setProperty("--near", n);
  }
};
moveDot(0);
// Stretched like a drop over the run from one place to another.
const pull = (from: number, to: number, move?: boolean) => {
  const [x, y] = phaseDot.spot(from);
  const [nx, ny] = phaseDot.spot(to);
  inkRun(phaseDot.mark, nx - x, ny - y, move);
};
const showProgress = (t: number) => {
  if (t >= 1) {
    if (parked) return;
    moveDot(END);
    clearTimeout(parking);
    parking = setTimeout(() => {
      if (root.dataset.held) return;
      parked = true;
      const from = phaseDot.at;
      if (reduced.matches) return moveDot(0);
      pull(from, 0, false);
      const begun = performance.now();
      const run = (now: number) => {
        if (!parked) return;
        const k = Math.min((now - begun) / RUN, 1);
        moveDot(from * (1 - k) ** 4);
        if (k < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    }, BEAT);
    return;
  }
  clearTimeout(parking);
  const stops = stopsNow();
  const i = stops.findIndex((s) => t <= s);
  const from = Math.max(i - 1, 0);
  const span = stops[i] - stops[from];
  const at =
    i < 0 ? END : from + (i - from) * (span > 0 ? (t - stops[from]) / span : 1);
  // A new morph before the dot got back up: it runs, not jumps.
  const back = !parked && at < phaseDot.at - 0.01 && phaseDot.at === END;
  const was = phaseDot.at;
  parked = false;
  moveDot(at);
  if (back) pull(was, at);
};
const note = $("phase-note");
const explain = (name?: string) => {
  const b = holds.find((h) => h.dataset.hold === (name ?? root.dataset.held));
  const held = b && b.dataset.hold === root.dataset.held;
  inkSwap(
    note,
    b ? `${b.dataset.note}${held ? " Click it again to let go." : ""}` : "",
  );
};

// The glyph's untransformed top on the page, so an open sheet doesn't skew
// what's measured from it.
const glyphTop = () => {
  const ink = $("ink");
  return ink.parentElement!.getBoundingClientRect().top + ink.offsetTop;
};
// A sentence sits between the sets and whatever lies under the glyph:
// upright, the presets, with room above them for the phases to hang.
const room = () => {
  if (root.hasAttribute("data-turn")) return null;
  const ink = $("ink");
  const top = glyphTop();
  const left = ink.parentElement!.getBoundingClientRect().left + ink.offsetLeft;
  const r = document.querySelector(".presets .rail")!.getBoundingClientRect();
  const over =
    r.right > left + ink.offsetWidth * 0.2 &&
    r.left < left + ink.offsetWidth * 0.8;
  const bottom = over ? r.top - 28 - $("phases").offsetHeight : innerHeight;
  const head = $("sets").getBoundingClientRect().bottom;
  return { top: head + 16 - top, bottom: bottom - top };
};
const pool = inkPool(
  $("pool"),
  {},
  {
    draw,
    room,
    onProgress: (t) => {
      if (!entering) showProgress(t);
      hang();
    },
  },
);
let touring = true;
let tourStep = false;
// How far the glyph is turned: 1 runs it up the page.
let turned = 0;
// Paused, the glyph holds its breath too.
const breathing = ({ breathe }: { breathe: number }) =>
  $<HTMLInputElement>("auto").checked ? breathe : 0;
const ledger = startLedger((settings, { live, preset }) => {
  // A preset eases in; a slider follows the hand. Either keeps the turn.
  pool.set(
    { ...settings, turn: turned, breathe: breathing(settings) },
    { ease: preset ? 600 : 0 },
  );
  if (!tourStep) touring = false;
  // Letting go of a slider or choosing a preset writes the next glyph. A
  // preset also lets go of a hold; a slider keeps it, to tune the held frame.
  if (live) return;
  if (preset && root.dataset.held) holdAt(null);
  next();
  keepWriting();
}, source);
pool.set(
  { ...ledger.settings(), breathe: breathing(ledger.settings()) },
  { ease: 0 },
);

let set = 0;
let at = 0;
const setButtons = [
  ...$("sets").querySelectorAll<HTMLButtonElement>("[data-set]"),
];
const now = $("now");

// Typed glyphs queue so each finishes; the page's own replace the queue.
let last = "";
let settled = Promise.resolve(true);
// The first glyph inks in with the page, out of nothing; the timeline waits
// at the start for the morph after it.
let entering = true;
const write = (key: string, announce = false, replace = false) => {
  if (last) entering = false;
  last = key;
  if (announce) now.textContent = describe(key);
  settled = pool.show(key, { replace });
};
// Upright, the phases hang just under the glyph's ink, moving when it does.
// Where the ink ends is found by drawing the glyph unseen at the glyph's own
// size, so it's known before the pool has drawn it, even just as it turns.
const sizer = document.createElement("canvas").getContext("2d")!;
let hung = "";
function hang(key = last) {
  // Turned, they stand in a column beside it instead.
  if (root.hasAttribute("data-turn")) return;
  const el = $("pool");
  const at = `${key}@${el.clientWidth}x${el.clientHeight}`;
  if (at === hung) return;
  hung = at;
  const style = getComputedStyle(el);
  const size = parseFloat(style.fontSize);
  const free = room();
  draw(sizer, key, {
    width: el.clientWidth,
    height: el.clientHeight,
    size,
    font: `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`,
    room: free
      ? { top: Math.round(free.top), bottom: Math.round(free.bottom) }
      : undefined,
  });
  const bottom = inkBottom(key);
  if (bottom !== undefined)
    root.style.setProperty("--ink-depth", `${Math.round(bottom)}px`);
}

// The sets and presets dots keep to the pressed one.
inkDot($("sets-mark"), setButtons, { follow: true });
const presets = [...document.querySelectorAll<HTMLElement>("[data-preset]")];
const presetDot = inkDot($("preset-mark"), presets, { follow: true });

// The glyph can run vertically: the pool turns it, softening into ink on the
// way round, while its box slides to the other middle; a press mid-turn turns
// it straight back from where it got to. Upright, the presets and phases
// swing between rows and columns with it.
const turn = $<HTMLButtonElement>("turn");
const TURN = 700;
const arrange = createArrange({
  items: () => [
    ...document.querySelectorAll<HTMLElement>(
      ".presets li :is(.ink-a, .ink-b), .phases .drops",
    ),
  ],
  dots: [presetDot, phaseDot],
  hold: [document.querySelector<HTMLElement>(".phases")!],
  duration: 640,
  // The same ease out as the pool's own and the glyph box's slide.
  easing: "cubic-bezier(0.33, 1, 0.68, 1)",
});
// A letter or a shape turned is just itself on its side, so Type and Shapes
// stand upright and the button has nothing to turn. The presets and phases sit
// as they do across, except on a phone, where they stand in columns.
const phone = matchMedia("(max-width: 699px)");
let turning = false;
const turnTo = () => {
  const upright = !["words", "lines"].includes(SETS[set].id);
  const columns = upright ? phone.matches : turning;
  turn.disabled = upright;
  turn.ariaPressed = String(turning && !upright);
  turn.ariaLabel = upright
    ? `${SETS[set].label} stand upright`
    : turning
      ? "Run the glyph across"
      : "Run the glyph vertically";
  if (columns !== root.hasAttribute("data-turn"))
    arrange(
      () => root.toggleAttribute("data-turn", columns),
      // Back to a row, the phases hang under the glyph now, so they glide there.
      () => {
        hung = "";
        hang();
      },
    );
  const next = turning && !upright ? 1 : 0;
  if (next === turned) return;
  turned = next;
  pool.set({ turn: turned }, { ease: TURN });
};
turn.addEventListener("click", () => {
  turning = !turning;
  turnTo();
});
phone.addEventListener("change", turnTo);
addEventListener("resize", () => {
  hung = "";
  hang();
});
const choose = (index: number) => {
  set = index;
  for (const [i, b] of setButtons.entries())
    b.ariaPressed = String(i === index);
  turnTo();
};
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
// Each glyph sits this long once it settles, then the next is written.
let writing = 0;
const keepWriting = (pause = PAUSE) => {
  clearTimeout(timer);
  const run = ++writing;
  void settled.then(() => {
    if (run !== writing) return;
    timer = setTimeout(() => {
      const writes = $<HTMLInputElement>("auto").checked && !reduced.matches;
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
    }, pause + reading());
  });
};
// Pause in the header and the switch in the settings are one control.
const auto = $<HTMLInputElement>("auto");
const pause = $<HTMLButtonElement>("pause");
// The header's icons pool from one to the next, quick and inky enough to see
// at that size.
const iconPool = (id: string) =>
  inkPool(
    $(id),
    { duration: 600, spread: 0.09, threshold: 0.28 },
    { draw: drawIcon, queue: 0 },
  );
const icon = iconPool("pause-icon");

// Settings' sliders melt into a cross while the sheet is open.
const settingsButton = $<HTMLButtonElement>("settings-button");
const settingsIcon = iconPool("settings-icon");
const showSettings = () => {
  const open = settingsButton.ariaExpanded === "true";
  settingsIcon.show(open ? "close" : "sliders");
  settingsButton.ariaLabel = open ? "Close the settings" : "Settings";
};
new MutationObserver(showSettings).observe(settingsButton, {
  attributeFilter: ["aria-expanded"],
});
showSettings();
// A press says what it did for a beat, then the word fades.
const word = $("pause-word");
let saying = 0;
let fades: Animation[] = [];
const say = (text: string) => {
  clearTimeout(saying);
  fades.forEach((f) => f.cancel());
  inkSwap(word, text);
  now.textContent = text;
  saying = setTimeout(() => {
    fades = [...word.querySelectorAll(".ink-a, .ink-b")].map((c) =>
      c.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 300,
        fill: "forwards",
      }),
    );
    void fades[0]?.finished.then(() => {
      inkText(word, "");
      fades.forEach((f) => f.cancel());
    });
  }, 1100);
};
const showPause = (pressed = false) => {
  icon.show(auto.checked ? "pause" : "play");
  pool.set({ breathe: breathing(ledger.settings()) });
  pause.ariaLabel = `${auto.checked ? "Pause" : "Play"} the writing`;
  if (!pressed) return;
  say(auto.checked ? "Writing" : "Paused");
  if (!reduced.matches)
    $("pause-icon").animate([{ scale: 1 }, { scale: 0.78 }, { scale: 1 }], {
      duration: 280,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
};
// Play writes the next glyph at once rather than after the usual pause.
const toggle = () => {
  showPause(true);
  if (auto.checked) {
    quietUntil = 0;
    next();
  }
  keepWriting();
};
pause.addEventListener("click", () => {
  auto.checked = !auto.checked;
  toggle();
});
auto.addEventListener("change", toggle);
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
// The glass it switches to: a sun from the dark, a moon from the light.
const themeIcon = iconPool("theme-icon");
const themeColor = document.querySelector('meta[name="theme-color"]');
const showTheme = () => {
  const dark = root.dataset.theme === "dark";
  // It inks in the text's color, which it reads as the glass changes.
  themeIcon.set({}, { ease: 0 });
  themeIcon.show(dark ? "sun" : "moon");
  themeButton.ariaLabel = `Switch to the ${dark ? "light" : "dark"} glass`;
  themeColor?.setAttribute(
    "content",
    getComputedStyle(root).getPropertyValue("--fog").trim(),
  );
  // The pool sees a new color on its own, but a beat late for the view
  // transition's picture of the new glass.
  pool.set({}, { ease: 0 });
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
// The icon stays out of the fog (theme.scss), so its morph shows as the glass
// changes rather than blurring away with it.
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

reduced.addEventListener("change", () => keepWriting());

paintFog([...document.querySelectorAll<HTMLElement>(".fog")]);

// Wait for the font (at most 1.5s) so the first glyph is drawn in it.
void Promise.race([
  document.fonts.load('700 1em "Poppins"'),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(() => {
  choose(0);
  pool.show("");
  // The timeline hangs under the first glyph before it's written, so it
  // enters where it stays.
  const timeline = $("phases");
  timeline.style.transition = "none";
  hang(SETS[0].keys[0]);
  getComputedStyle(timeline).top;
  timeline.style.transition = "";
  root.classList.add("ready");
  const entered = Promise.allSettled(
    document
      .getAnimations()
      .filter((a) => a instanceof CSSAnimation && a.animationName === "enter")
      .map((a) => a.finished),
  );
  // Written first; the next waits until it has settled and the page is in.
  setTimeout(
    () => {
      write(SETS[0].keys[0]);
      void Promise.all([entered, settled]).then(() => {
        entering = false;
        keepWriting(FIRST);
      });
    },
    reduced.matches ? 0 : 300,
  );
});
