const still = matchMedia("(prefers-reduced-motion: reduce)");

/** How long an ink dot takes to run from one place to the next. */
export const RUN = 420;

/** Writes text into an element drawn with Ink, both copies, or plainly. */
export const inkText = (el: Element, text: string) => {
  const copies = el.querySelectorAll(".ink-a, .ink-b");
  if (!copies.length) el.textContent = text;
  for (const c of copies) c.textContent = text;
};

/** Writes new text that comes into focus out of a slight blur. Each copy
 *  animates itself, so both keep blending with the page as they do. */
export const inkSwap = (el: Element, text: string) => {
  const was = (el.querySelector(".ink-a") ?? el).textContent;
  if (was === text) return;
  inkText(el, text);
  if (!text) return;
  const from = still.matches
    ? { opacity: 0 }
    : { opacity: 0, filter: "blur(3px)", translate: "0 3px" };
  for (const c of el.querySelectorAll(".ink-a, .ink-b"))
    c.animate([from, { opacity: 1, filter: "blur(0)", translate: "0 0" }], {
      duration: 220,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
};

/** Runs an ink dot over from where it was to where it now is, dx and dy
 *  back. The run is added onto whatever places the dot, so the place can
 *  keep moving under it. Mid-way the dot is drawn out along its path, like
 *  a drop pulled across, and rounds up as it lands. With `move` false it is
 *  only drawn out, for a dot whose caller moves it frame by frame. */
export const inkRun = (mark: Element, dx: number, dy: number, move = true) => {
  if (still.matches || (!dx && !dy)) return;
  const pull = Math.min(Math.hypot(dx, dy) / 5, 14) * 0.45 + 1;
  const drawn = Math.abs(dx) >= Math.abs(dy) ? `${pull} 0.7` : `0.7 ${pull}`;
  const timing = { duration: RUN, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
  if (!move) {
    mark.animate(
      [{ scale: "1 1" }, { scale: drawn, offset: 0.45 }, { scale: "1 1" }],
      timing,
    );
    return;
  }
  mark.animate(
    [
      { transform: `translate(${-dx}px, ${-dy}px) scale(1, 1)` },
      {
        transform: `translate(${-dx / 2}px, ${-dy / 2}px) scale(${drawn.replace(" ", ", ")})`,
        offset: 0.45,
      },
      { transform: "translate(0px, 0px) scale(1, 1)" },
    ],
    { ...timing, composite: "add" },
  );
};

/** Keeps an ink dot by whichever of the buttons is pressed, at the place
 *  `at` gives (relative to the dot's own box), running to the next one
 *  pressed. With none pressed, it fades away. */
export const inkMark = (
  mark: HTMLElement,
  buttons: HTMLElement[],
  at: (b: HTMLElement) => [number, number],
) => {
  let was: [number, number] | null = null;
  const place = (run: boolean) => {
    const b = buttons.find((b) => b.ariaPressed === "true");
    mark.style.opacity = b ? "" : "0";
    if (!b) return void (was = null);
    const [x, y] = at(b);
    mark.style.transform = `translate(${x}px, ${y}px)`;
    if (run && was) inkRun(mark, x - was[0], y - was[1]);
    was = [x, y];
  };
  const pressed = new MutationObserver(() => place(true));
  for (const b of buttons)
    pressed.observe(b, { attributeFilter: ["aria-pressed"] });
  new ResizeObserver(() => place(false)).observe(mark.parentElement!);
  place(false);
};
