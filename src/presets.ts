import { DEFAULTS, type Settings } from "./pool";

export const PRESETS: Record<string, { note: string; settings: Settings }> = {
  Glass: {
    note: "The defaults: full ink, no blur at rest",
    settings: DEFAULTS,
  },
  Backdrop: {
    note: "Half strength behind your copy, fading down, breathing",
    settings: {
      ...DEFAULTS,
      opacity: 0.5,
      rest: 0.008,
      fadeStart: 25,
      fadeEnd: 90,
      breathe: 2.4,
    },
  },
  Syrup: {
    note: "Slow and heavy: one big round pool",
    settings: {
      ...DEFAULTS,
      duration: 2200,
      spread: 0.1,
      hardness: 30,
      threshold: 0.38,
      sink: 12,
      rise: 8,
    },
  },
  Snap: {
    note: "Nearly a cut: barely pools",
    settings: { ...DEFAULTS, duration: 560, spread: 0.015, sink: 2, rise: 1 },
  },
  Mercury: {
    note: "Strands snap into hard, bright beads",
    settings: {
      ...DEFAULTS,
      duration: 1200,
      spread: 0.07,
      hardness: 60,
      threshold: 0.5,
    },
  },
  Smoke: {
    note: "A soft edge that drifts",
    settings: {
      ...DEFAULTS,
      duration: 1300,
      spread: 0.06,
      hardness: 7,
      threshold: 0.32,
      rest: 0.003,
    },
  },
};
