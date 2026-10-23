const still = matchMedia("(prefers-reduced-motion: reduce)");
const pointer = matchMedia("(hover: hover) and (pointer: fine)");

export const RUN = 420;

/** Writes text into both of an Ink element's copies, or plainly. */
export const inkText = (el: Element, text: string) => {
  const copies = el.querySelectorAll(".ink-a, .ink-b");
  if (!copies.length) el.textContent = text;
  for (const c of copies) c.textContent = text;
};

/** Swaps in text out of a slight blur. Each copy animates itself, so both
 *  keep their blend. */
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

/** Runs a dot over from dx, dy back, drawn out mid-way like a pulled drop.
 *  The run adds onto its place, which can keep moving under it. With
 *  `move` false it only stretches, for a dot moved frame by frame. */
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

export type Dot = {
  mark: HTMLElement;
  /** Where it is: an item's index, or a point between two. */
  at: number;
  /** Moves to a place, running there like a pulled drop if asked. */
  to: (at: number, options?: { run?: boolean }) => void;
  /** Where a place is, in the list's px. */
  spot: (at: number) => [number, number];
  /** Re-places it at once, after the list's layout changed. */
  place: () => void;
};

/** A dot that marks a place in a list: under the item in a row, beside it in
 *  a column, on the side facing the nearer edge of the screen. It re-places
 *  itself whenever the list's layout changes. With `follow`, it keeps to the
 *  pressed item, and fades with none pressed. */
export const inkDot = (
  mark: HTMLElement,
  items: HTMLElement[],
  { follow = false } = {},
): Dot => {
  let spots: [number, number][] = [];
  const measure = () => {
    // Out of the way while the list is measured: left in its old place, it
    // could sit past the edge, and a touch screen would widen the page.
    mark.style.translate = "0 0";
    const row = items[0].offsetTop === items[1].offsetTop;
    spots = items.map((b) => {
      if (row)
        return [
          b.offsetLeft + b.offsetWidth / 2 - 2.5,
          b.offsetTop + b.offsetHeight - 5,
        ];
      const r = b.getBoundingClientRect();
      const right = r.left + r.width / 2 > innerWidth / 2;
      return [
        right ? b.offsetLeft + b.offsetWidth + 9 : b.offsetLeft - 14,
        b.offsetTop + b.offsetHeight / 2 - 2.5,
      ];
    });
  };
  const spot = (at: number): [number, number] => {
    if (!spots.length) measure();
    const i = Math.min(Math.max(Math.floor(at), 0), spots.length - 1);
    const j = Math.min(i + 1, spots.length - 1);
    const k = Math.min(Math.max(at - i, 0), 1);
    return [
      spots[i][0] + (spots[j][0] - spots[i][0]) * k,
      spots[i][1] + (spots[j][1] - spots[i][1]) * k,
    ];
  };
  // By translate, apart from transform, so a run's stretch scales the dot and
  // never its distance along the list.
  const put = (at: number) => {
    const [x, y] = spot(at);
    mark.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  };
  const dot: Dot = {
    mark,
    at: 0,
    to: (at, { run = false } = {}) => {
      const [x, y] = spot(dot.at);
      const [nx, ny] = spot(at);
      dot.at = at;
      put(at);
      if (run) inkRun(mark, nx - x, ny - y);
    },
    spot,
    place: () => {
      measure();
      put(dot.at);
    },
  };
  new ResizeObserver(dot.place).observe(mark.parentElement!);
  if (follow) {
    const show = (run: boolean) => {
      const i = items.findIndex((b) => b.ariaPressed === "true");
      const shown = mark.style.opacity !== "0";
      mark.style.opacity = i < 0 ? "0" : "";
      if (i >= 0) dot.to(i, { run: run && shown });
    };
    const pressed = new MutationObserver(() => show(true));
    for (const b of items)
      pressed.observe(b, { attributeFilter: ["aria-pressed"] });
    show(false);
  }
  return dot;
};

/** A ring that keeps to the item the pointer is on, where the list's dot
 *  would sit: it inks in on the first, glides along to the next as the
 *  pointer moves, stays over the gaps between them, and fades as the pointer
 *  leaves the list. */
export const inkHover = (mark: HTMLElement, items: HTMLElement[]) => {
  const dot = inkDot(mark, items);
  const show = (i: number) => {
    if (!pointer.matches) return;
    if (mark.hasAttribute("data-on")) return dot.to(i);
    // Inks in where it is, without gliding over from where it last was.
    mark.style.transition = "opacity 150ms, scale 150ms";
    dot.to(i);
    void mark.offsetWidth;
    mark.style.transition = "";
    mark.toggleAttribute("data-on", true);
  };
  for (const [i, item] of items.entries())
    item.addEventListener("pointerenter", () => show(i));
  mark.parentElement!.addEventListener("pointerleave", () =>
    mark.toggleAttribute("data-on", false),
  );
};
