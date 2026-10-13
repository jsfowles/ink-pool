import { CONTROLS, print } from "./controls";
import { DEFAULTS, type Settings } from "./pool";
import { inkSwap, inkText } from "./ink";
import { PRESETS } from "./presets";

type Key = keyof Settings;

const changes = (a: Settings, b: Settings) =>
  (Object.keys(a) as Key[]).filter((key) => a[key] !== b[key]);

// Only what differs from DEFAULTS, ready to paste into inkPool.
const asCode = (settings: Settings) => {
  const lines = changes(settings, DEFAULTS).map(
    (key) => `  ${key}: ${settings[key]},`,
  );
  return lines.length
    ? `{\n  ...DEFAULTS,\n${lines.join("\n")}\n}`
    : "DEFAULTS";
};

// `live`: a slider mid-drag. `preset`: a preset was just chosen.
type Change = (
  settings: Settings,
  how: { live: boolean; preset: boolean },
) => void;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const copy = async (button: HTMLButtonElement, text: string) => {
  const label = button.dataset.label!;
  const ok = await navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
  inkText(button, ok ? "Copied" : "Couldn’t copy");
  setTimeout(() => inkText(button, label), 1600);
  return ok;
};

export const startLedger = (onChange: Change, source: string) => {
  const ledger = $<HTMLElement>("ledger");
  const form = $<HTMLFormElement>("settings");
  const presets = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-preset]"),
  ];
  const openers = [...document.querySelectorAll<HTMLElement>("[data-opens]")];

  let baseName = "Glass";
  let base = PRESETS[baseName].settings;
  let settings = { ...base };
  let opener: HTMLElement | null = null;

  // The "was 0.05em" button beside a changed value, which resets it.
  const mark = (key: Key) => {
    const field = form.querySelector(`[data-field="${key}"]`)!;
    let was = field.querySelector<HTMLButtonElement>(".was");
    if (settings[key] === base[key]) return was?.remove();
    if (!was) {
      was = Object.assign(document.createElement("button"), {
        type: "button",
        className: "was",
      });
      was.dataset.reset = key;
      field.querySelector("output")!.before(was);
    }
    const old = print(key, base[key]);
    was.textContent = `was ${old}`;
    was.ariaLabel = `Reset ${field.querySelector("label")!.textContent} to ${old}`;
  };

  const show = () => {
    for (const c of CONTROLS) {
      const input = form.elements.namedItem(c.key) as HTMLInputElement;
      input.value = String(settings[c.key]);
      form.querySelector(`output[for="${c.key}"]`)!.textContent = print(
        c.key,
        settings[c.key],
      );
      mark(c.key);
    }
    for (const b of presets)
      b.ariaPressed = String(
        !changes(settings, PRESETS[b.dataset.preset!].settings).length,
      );
    // The fade's end only matters once it starts.
    form.querySelector<HTMLElement>('[data-field="fadeEnd"]')!.hidden =
      settings.fadeStart >= 100;
    const changed = changes(settings, base).length;
    $("base").textContent = changed
      ? `${baseName}, ${changed} changed`
      : baseName;
  };

  const update = (next: Settings, live = false, preset = false) => {
    // The fade always ends at or below where it starts.
    if (next.fadeEnd < next.fadeStart && next.fadeStart < 100)
      next = { ...next, fadeEnd: next.fadeStart };
    settings = next;
    show();
    onChange(settings, { live, preset });
  };

  form.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.type !== "range") return;
    update({ ...settings, [input.name]: Number(input.value) }, true);
  });
  form.addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).type === "range")
      onChange(settings, { live: false, preset: false });
  });
  form.addEventListener("click", (e) => {
    const key = (e.target as Element).closest<HTMLElement>(".was")?.dataset
      .reset as Key | undefined;
    if (key) update({ ...settings, [key]: base[key] });
  });
  // The note says what a preset does only while it's pointed at.
  const note = $("preset-note");
  const choose = (name: string) => {
    baseName = name;
    base = PRESETS[baseName].settings;
    update({ ...base }, false, true);
  };
  for (const b of presets) {
    b.addEventListener("click", () => choose(b.dataset.preset!));
    for (const type of ["pointerenter", "focus"])
      b.addEventListener(type, () => inkSwap(note, b.dataset.note!));
    for (const type of ["pointerleave", "blur"])
      b.addEventListener(type, () => inkSwap(note, ""));
  }

  $<HTMLButtonElement>("copy-settings").addEventListener("click", (e) =>
    copy(e.currentTarget as HTMLButtonElement, asCode(settings)),
  );
  $<HTMLButtonElement>("copy-file").addEventListener("click", (e) =>
    copy(e.currentTarget as HTMLButtonElement, source),
  );

  const isOpen = () => document.documentElement.dataset.ledger === "open";
  const open = (focus?: Key) => {
    document.documentElement.dataset.ledger = "open";
    ledger.inert = false;
    for (const b of openers) if (b.ariaExpanded) b.ariaExpanded = "true";
    const target = focus
      ? (form.elements.namedItem(focus) as HTMLInputElement)
      : $("ledger-title");
    target.focus({ preventScroll: true });
  };
  const close = () => {
    document.documentElement.dataset.ledger = "";
    ledger.inert = true;
    for (const b of openers) if (b.ariaExpanded) b.ariaExpanded = "false";
    opener?.focus({ preventScroll: true });
    opener = null;
  };

  for (const b of openers)
    b.addEventListener("click", () => {
      const key = b.dataset.opens as Key | "";
      if (isOpen() && !key) return close();
      opener = b;
      open(key || undefined);
    });
  $("close-ledger").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  ledger.inert = true;
  show();
  return {
    settings: () => settings,
    refresh: () => update(settings),
    /** The next preset, for the page's own tour. */
    tour: () => {
      const names = Object.keys(PRESETS);
      choose(names[(names.indexOf(baseName) + 1) % names.length]);
    },
  };
};
