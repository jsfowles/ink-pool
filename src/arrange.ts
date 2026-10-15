import type { Dot } from "./ink";

const still = matchMedia("(prefers-reduced-motion: reduce)");

/** Moves lists from one layout to another as one motion. Each item glides
 *  from where it shows to where it lands, a little after the one before it
 *  in its list, and the lists' dots wait out the move unseen and ink back in
 *  where they land. Items move themselves, not their lists, so they keep
 *  their blend with whatever is under them. A change mid-move starts each
 *  item from wherever it had got to. */
export const createArrange = ({
  items,
  dots,
  hold,
  duration,
  easing,
}: {
  items: () => HTMLElement[]; // what glides
  dots: Dot[];
  hold: HTMLElement[]; // lists whose own transitions would fight the glide
  duration: number;
  easing: string;
}) => {
  let glides: Animation[] = [];

  /** Applies `change`, then `then` once the dots are placed and before
   *  anything is measured where it lands. */
  return (change: () => void, then?: () => void) => {
    const moving = items();
    const was = moving.map((el) => el.getBoundingClientRect());
    glides.forEach((a) => a.cancel());
    glides = [];
    for (const el of hold) el.style.transition = "none";
    change();
    for (const dot of dots) dot.place();
    then?.();
    const release = () => {
      for (const el of hold) el.style.transition = "";
    };
    if (still.matches) return release();

    for (const [i, el] of moving.entries()) {
      const now = el.getBoundingClientRect();
      const dx = was[i].left - now.left;
      const dy = was[i].top - now.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      const item = el.closest("li") ?? el;
      const at = [...item.parentElement!.children].indexOf(item);
      glides.push(
        el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
          duration,
          delay: at * 28,
          easing,
          fill: "backwards",
        }),
      );
    }
    if (glides.length)
      for (const { mark } of dots)
        mark.animate(
          [
            { opacity: 0 },
            {
              opacity: 0,
              offset: 0.7,
              easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            },
            {},
          ],
          { duration: duration + 120 },
        );
    setTimeout(release, duration);
  };
};
