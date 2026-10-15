import assert from "node:assert/strict";
import { test } from "node:test";
import { createTimeline } from "../src/pool.ts";

const setup = (options: { queue?: number; reduced?: boolean } = {}) => {
  let time = 0;
  const timeline = createTimeline({
    now: () => time,
    duration: () => 1000,
    queue: options.queue,
    reduced: () => options.reduced ?? false,
  });
  // Steps the clock in frames, like requestAnimationFrame would.
  const run = (ms: number) => {
    for (const end = time + ms; time < end;) {
      time = Math.min(time + 16, end);
      timeline.step();
    }
  };
  const progress = () => timeline.view().morph?.progress ?? 1;
  return { timeline, run, progress };
};

const state = async (promise: Promise<boolean>) =>
  Promise.race([promise, Promise.resolve("pending" as const)]);

test("the first glyph appears at once", async () => {
  const { timeline } = setup();
  assert.equal(await timeline.show("A"), true);
  assert.equal(timeline.view().current, "A");
  assert.equal(timeline.moving(), false);
});

test("a morph runs its duration and settles", async () => {
  const { timeline, run, progress } = setup();
  timeline.show("A");
  const b = timeline.show("B");
  run(500);
  assert.ok(Math.abs(progress() - 0.5) < 0.02);
  assert.equal(await state(b), "pending");
  run(500);
  assert.equal(await b, true);
  assert.equal(timeline.view().morph, null);
});

test("waiting glyphs play in turn, quicker with a backlog", async () => {
  const { timeline, run } = setup();
  timeline.show("A");
  const b = timeline.show("B");
  const c = timeline.show("C");
  const d = timeline.show("D");
  run(1000);
  assert.equal(await b, true);
  // C starts with D still waiting: 1 / 1.6 of the duration.
  assert.equal(timeline.view().morph?.to, "C");
  assert.equal(timeline.view().morph?.duration, 625);
  run(640);
  assert.equal(await c, true);
  run(1000);
  assert.equal(await d, true);
});

test("a full queue drops its oldest", async () => {
  const { timeline } = setup({ queue: 1 });
  timeline.show("A");
  timeline.show("B");
  const c = timeline.show("C");
  timeline.show("D");
  assert.equal(await c, false);
});

test("showing what's on its way waits on the same glyph", async () => {
  const { timeline, run } = setup();
  timeline.show("A");
  const b = timeline.show("B");
  const again = timeline.show("B");
  run(1000);
  assert.equal(await b, true);
  assert.equal(await again, true);
});

test("replace cuts in and picks up the pool as it is", async () => {
  const { timeline, run, progress } = setup();
  timeline.show("A");
  const b = timeline.show("B");
  run(300);
  const t = progress();
  const c = timeline.show("C", true);
  assert.equal(await b, false);
  // Before the middle, A still shows more: it carries on from A, as melted.
  assert.equal(timeline.view().morph?.from, "A");
  assert.equal(progress(), t);
  run(1000);
  assert.equal(await c, true);
});

test("cut in late, it carries on from the glyph that was forming", () => {
  const { timeline, run, progress } = setup({ queue: 0 });
  timeline.show("A");
  timeline.show("B");
  run(800);
  const t = progress();
  timeline.show("C");
  assert.equal(timeline.view().morph?.from, "B");
  assert.ok(Math.abs(progress() - (1 - t)) < 1e-9);
});

test("a hold stops at its phase until let go", async () => {
  const { timeline, run, progress } = setup();
  timeline.show("A");
  const b = timeline.show("B");
  timeline.hold("pooled");
  run(2000);
  assert.equal(progress(), 0.5);
  assert.equal(timeline.moving(), false);
  assert.equal(await state(b), "pending");
  timeline.hold(null);
  run(1000);
  assert.equal(await b, true);
});

test("holding at rest replays the last morph", () => {
  const { timeline, run, progress } = setup();
  timeline.show("A");
  timeline.show("B");
  run(1000);
  timeline.hold(0.3);
  run(1000);
  assert.deepEqual(
    { ...timeline.view().morph, ticket: undefined },
    { from: "A", to: "B", progress: 0.3, duration: 1000, ticket: undefined },
  );
  assert.equal(progress(), 0.3);
});

test("with reduced motion, glyphs swap", async () => {
  const { timeline } = setup({ reduced: true });
  timeline.show("A");
  assert.equal(await timeline.show("B"), true);
  assert.equal(timeline.view().morph, null);
});

test("clear lets every waiting show go", async () => {
  const { timeline } = setup();
  timeline.show("A");
  const b = timeline.show("B");
  const c = timeline.show("C");
  timeline.clear();
  assert.equal(await b, false);
  assert.equal(await c, false);
});
