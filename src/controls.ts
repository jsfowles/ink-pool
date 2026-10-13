import type { Settings } from "./pool";

type Key = keyof Settings;

// One setting's slider. `off` names the value that turns it off.
export type Control = {
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  off?: number;
};

export type Group = { id: string; label: string; controls: Control[] };

const range = (
  key: Key,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
  off?: number,
): Control => ({ key, label, min, max, step, unit, off });

export const GROUPS: Group[] = [
  {
    id: "morph",
    label: "Morph",
    controls: [
      range("duration", "Duration", 150, 3000, 10, "ms"),
      range("spread", "Spread", 0, 0.15, 0.005, "em"),
      range("sink", "Sink", 0, 30, 0.5, "%"),
      range("rise", "Rise", 0, 30, 0.5, "%"),
    ],
  },
  {
    id: "edge",
    label: "Edge",
    controls: [
      range("hardness", "Hardness", 1, 60, 0.5),
      range("threshold", "Threshold", 0.1, 0.9, 0.01),
      range("rest", "Rest blur", 0, 0.04, 0.001, "em"),
    ],
  },
  {
    id: "rest",
    label: "At rest",
    controls: [
      range("opacity", "Opacity", 0.02, 1, 0.01),
      range("fadeStart", "Fade from", 0, 100, 1, "%", 100),
      range("fadeEnd", "Fade to", 0, 100, 1, "%"),
      range("breathe", "Breathe", 0, 6, 0.1, "s", 0),
    ],
  },
];

export const CONTROLS = GROUPS.flatMap((g) => g.controls);

const byKey = Object.fromEntries(CONTROLS.map((c) => [c.key, c])) as Record<
  Key,
  Control
>;

/** A value as the page prints it: "950ms", "0.05em", "off". */
export const print = (key: Key, value: number) => {
  const c = byKey[key];
  if (c.off !== undefined && value === c.off) return "off";
  return `${value}${c.unit ?? ""}`;
};
