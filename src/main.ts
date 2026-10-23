import { paintFog } from "./fog";
import { describe, draw, drawIcon, inkBottom, SETS } from "./glyphs";
import { startLedger } from "./ledger";
import { createArrange } from "./arrange";
import { inkDot, inkHover, inkSwap, inkText } from "./ink";
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
// The phase dot runs down the names with the morph and rests on "settled"
// with the glyph, reaching each name as its phase shows best, for the
// settings it has. It's drawn out by its speed like the presets' dot, and
// runs back up to the start as the next morph begins. Each name brightens as
// it passes.
const stopsNow = () => {
  const { start, melting, pooled, forming } = pool.phases();
  return [start.until, melting.at, pooled.at, forming.at, forming.until];
};
const phaseDot = inkDot($("phase-mark"), holds);
const END = phases.length - 1;
const glide = { at: 0, to: 0, v: 0, speed: 0, back: false, frame: 0, last: 0 };
const brighten = (at: number) => {
  for (const [i, li] of phases.entries())
    li.style.setProperty(
      "--near",
      Math.max(0, 1 - Math.abs(at - i)).toFixed(2),
    );
};
const settle = (at: number) => {
  cancelAnimationFrame(glide.frame);
  Object.assign(glide, { at, to: at, v: 0, speed: 0, back: false, frame: 0 });
  phaseDot.to(at);
  phaseDot.mark.style.scale = "";
  brighten(at);
};
const glideStep = (now: number) => {
  const dt = Math.min(Math.max(now - glide.last, 0) / 1000, 1 / 30);
  glide.last = now;
  const was = glide.at;
  if (glide.back) {
    // Back up on a quick spring, to be at the start before it melts.
    for (let i = 0; i < 4; i++) {
      glide.v += (1400 * (glide.to - glide.at) - 70 * glide.v) * (dt / 4);
      glide.at += glide.v * (dt / 4);
    }
    if (Math.abs(glide.to - glide.at) < 0.02) glide.back = false;
  } else glide.at = glide.to;
  const speed = dt > 0 ? Math.abs(glide.at - was) / dt : 0;
  glide.speed += (speed - glide.speed) * 0.5;
  if (!glide.back && glide.speed < 0.05) return settle(glide.at);
  phaseDot.to(glide.at);
  brighten(glide.at);
  const i = Math.min(Math.floor(glide.at), END - 1);
  const [ax, ay] = phaseDot.spot(i);
  const [bx, by] = phaseDot.spot(i + 1);
  const px = glide.speed * Math.hypot(bx - ax, by - ay);
  const pull = 1 + Math.min(px / 600, 1.3);
  const across = Math.max(0.72, 1 / Math.sqrt(pull));
  phaseDot.mark.style.scale =
    Math.abs(bx - ax) >= Math.abs(by - ay)
      ? `${pull.toFixed(3)} ${across.toFixed(3)}`
      : `${across.toFixed(3)} ${pull.toFixed(3)}`;
  glide.frame = requestAnimationFrame(glideStep);
};
const showProgress = (t: number) => {
  const stops = stopsNow();
  const i = stops.findIndex((s) => t <= s);
  const from = Math.max(i - 1, 0);
  const span = stops[i] - stops[from];
  const at =
    i < 0 ? END : from + (i - from) * (span > 0 ? (t - stops[from]) / span : 1);
  if (reduced.matches) return settle(at);
  if (at < glide.to - 0.5) glide.back = true;
  glide.to = at;
  if (glide.frame) return;
  glide.last = performance.now();
  glide.frame = requestAnimationFrame(glideStep);
};
// It waits at the start until the first glyph is written.
settle(0);
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
      hang(t);
    },
  },
);
let touring = true;
let tourStep = false;
// How far the glyph is turned: 1 runs it up the page.
let turned = 0;
const ledger = startLedger((settings, { live, preset }) => {
  // A preset eases in; a slider follows the hand. Either keeps the turn.
  pool.set({ ...settings, turn: turned }, { ease: preset ? 600 : 0 });
  if (!tourStep) touring = false;
  // Letting go of a slider or choosing a preset writes the next glyph. A
  // preset also lets go of a hold; a slider keeps it, to tune the held frame.
  if (live) return;
  if (preset && root.dataset.held) holdAt(null);
  next();
  keepWriting();
}, source);
pool.set(ledger.settings(), { ease: 0 });

let set = 0;
let at = 0;
const setButtons = [
  ...$("sets").querySelectorAll<HTMLButtonElement>("[data-set]"),
];
const now = $("now");

// Typed glyphs queue so each finishes; the page's own replace the queue.
let last = "";
// The glyph before it, for what moves between the two.
let was = "";
let settled = Promise.resolve(true);
// The first glyph inks in with the page, out of nothing; the timeline waits
// at the start for the morph after it.
let entering = true;
const write = (key: string, announce = false, replace = false) => {
  if (last) entering = false;
  was = last;
  last = key;
  if (announce) now.textContent = describe(key);
  settled = pool.show(key, { replace });
};
// Upright, the phases hang just under the glyph's ink, moving when it does.
// Where the ink ends is found by drawing the glyph unseen at the glyph's own
// size, so it's known before the pool has drawn it, even just as it turns.
const sizer = document.createElement("canvas").getContext("2d")!;
const depths = new Map<string, number | undefined>();
const depth = (key: string) => {
  const el = $("pool");
  const id = `${key}@${el.clientWidth}x${el.clientHeight}`;
  if (depths.has(id)) return depths.get(id);
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
  depths.set(id, inkBottom(key));
  return depths.get(id);
};
const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(Math.max((t - a) / (b - a || 1), 0), 1);
  return x * x * (3 - 2 * x);
};
// Mid-morph they move as the glyph does: from under the old one as it starts
// melting to under the new one as it settles.
function hang(t = 1, key = last) {
  // Turned, they stand in a column beside it instead.
  if (root.hasAttribute("data-turn")) return;
  const to = depth(key);
  if (to === undefined) return;
  const from = t < 1 ? (depth(was) ?? to) : to;
  const { start, forming } = pool.phases();
  const k = smooth(start.until, forming.until, t);
  document
    .querySelector("nav.phases")!
    .toggleAttribute("data-following", t < 1);
  root.style.setProperty(
    "--ink-depth",
    `${Math.round(from + (to - from) * k)}px`,
  );
}

// Each list's hover ring keeps to the item the pointer is on.
for (const mark of document.querySelectorAll<HTMLElement>(".hover-mark"))
  inkHover(mark, [
    ...mark.parentElement!.querySelectorAll<HTMLElement>("button, a"),
  ]);

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
// stand upright and the button has nothing to turn, with the presets and
// phases in columns close beside them.
const phone = matchMedia("(max-width: 699px)");
// A phone is taller than it is wide, so words start up the page there.
let turning = phone.matches;
// `instant` for the page's first layout, before it inks in.
const turnTo = (instant = false) => {
  const upright = !["words", "lines"].includes(SETS[set].id);
  const columns = upright || turning;
  const place = () => {
    root.toggleAttribute("data-turn", columns);
    root.toggleAttribute("data-upright", upright);
  };
  turn.disabled = upright;
  turn.ariaPressed = String(turning && !upright);
  turn.ariaLabel = upright
    ? `${SETS[set].label} stand upright`
    : turning
      ? "Run the glyph across"
      : "Run the glyph vertically";
  if (instant) {
    const box = $("ink");
    box.style.transition = "none";
    place();
    box.getBoundingClientRect();
    box.style.transition = "";
  } else if (
    columns !== root.hasAttribute("data-turn") ||
    upright !== root.hasAttribute("data-upright")
  )
    arrange(
      place,
      // Back to a row, the phases hang under the glyph now, so they glide there.
      () => {
        depths.clear();
        hang();
      },
    );
  const next = turning && !upright ? 1 : 0;
  if (next === turned) return;
  turned = next;
  pool.set({ turn: turned }, { ease: instant ? 0 : TURN });
};
turn.addEventListener("click", () => {
  turning = !turning;
  turnTo();
});
phone.addEventListener("change", () => turnTo());
addEventListener("resize", () => {
  depths.clear();
  hang();
});
const choose = (index: number, instant = false) => {
  set = index;
  for (const [i, b] of setButtons.entries())
    b.ariaPressed = String(i === index);
  turnTo(instant);
};
const step = (by: number, announce = false, replace = false) => {
  const keys = SETS[set].keys;
  at = (at + by + keys.length) % keys.length;
  write(keys[at], announce, replace);
};
// Type has no order worth reading it in, so it writes in any, never the same
// twice running; the arrows still step through it in order.
const ahead = () =>
  SETS[set].id === "type"
    ? 1 + Math.floor(Math.random() * (SETS[set].keys.length - 1))
    : 1;
function next() {
  step(ahead(), false, true);
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
  step(ahead(), true);
});
// A set takes over once the glyph on screen has settled, so one set never
// melts into another mid-way; pressed, it shows as chosen at once. Held, the
// glyph can't settle, so the set takes over now.
let choosing = 0;
const chooseSettled = (index: number, then = () => {}) => {
  const run = ++choosing;
  for (const [i, b] of setButtons.entries())
    b.ariaPressed = String(i === index);
  const go = () => {
    if (run !== choosing) return;
    choose(index);
    then();
  };
  if (root.dataset.held) go();
  else void settled.then(go);
};
for (const [i, b] of setButtons.entries())
  b.addEventListener("click", () => {
    quietUntil = 0;
    // The old set writes nothing more while the new one waits.
    clearTimeout(timer);
    writing++;
    chooseSettled(i, () => {
      at = 0;
      write(SETS[i].keys[0], true, true);
      keepWriting();
    });
  });

const writeChar = (char: string) => {
  const type = SETS.findIndex((s) => s.id === "type");
  const found = SETS[type].keys.indexOf(`text:${char.toUpperCase()}`);
  if (found >= 0) chooseSettled(type, () => (at = found));
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
  choose(0, true);
  pool.show("");
  // The timeline hangs under the first glyph before it's written, so it
  // enters where it stays.
  hang(0, SETS[0].keys[0]);
  getComputedStyle($("phases")).top;
  hang(1, SETS[0].keys[0]);
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
