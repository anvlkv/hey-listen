import { expect, it } from "vitest";
import { createMute, createPusher, type PushTimer } from "../state/project/pushQueue";

/**
 * Unit checks for the project-state push's pure primitives
 * (`src/state/project/pushQueue.ts`): the leading/trailing coalescer that keeps a burst
 * of edits to one send, and the remote-apply mute flag that keeps a restore from being
 * pushed back as a new edit.
 */

/** A deterministic clock: `advance` runs whatever came due, oldest first. */
function fakeTimer() {
  let time = 0;
  let nextId = 1;
  const jobs = new Map<number, { at: number; run: () => void }>();
  const timer: PushTimer = {
    now: () => time,
    set(run, ms) {
      const id = nextId++;
      jobs.set(id, { at: time + ms, run });
      return id;
    },
    clear(handle) {
      jobs.delete(handle as number);
    },
  };
  function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      const due = [...jobs.entries()]
        .filter(([, job]) => job.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      jobs.delete(due[0]);
      time = due[1].at;
      due[1].run();
    }
    time = end;
  }
  return { timer, advance };
}

/** Let the pusher's async send chain finish (its `send` awaits). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("sends the leading edge at once and the latest value once a burst settles", async () => {
  const { timer, advance } = fakeTimer();
  let value = 1;
  const sent: number[] = [];
  const pusher = createPusher(() => void sent.push(value), { timer, throttleMs: 60 });

  pusher.request();
  await settle();
  expect(sent).toEqual([1]);

  // A burst inside the window collapses into one trailing send of the newest value.
  value = 2;
  pusher.request();
  value = 3;
  pusher.request();
  await settle();
  expect(sent).toEqual([1]);

  advance(60);
  await settle();
  expect(sent).toEqual([1, 3]);
});

it("spaces the leading edges by the throttle window", async () => {
  const { timer, advance } = fakeTimer();
  const sent: number[] = [];
  const pusher = createPusher(() => void sent.push(sent.length), { timer, throttleMs: 60 });

  pusher.request();
  await settle();
  advance(60);
  pusher.request();
  await settle();
  expect(sent).toHaveLength(2);
});

it("flush sends a queued change without waiting for the window to close", async () => {
  const { timer } = fakeTimer();
  const sent: number[] = [];
  const pusher = createPusher(() => void sent.push(sent.length), { timer, throttleMs: 60 });

  pusher.request();
  await settle();
  pusher.request();
  await pusher.flush();
  expect(sent).toHaveLength(2);

  // Nothing queued: a flush sends nothing extra.
  await pusher.flush();
  expect(sent).toHaveLength(2);
});

it("drops requests while muted and sends again once released", async () => {
  const { timer } = fakeTimer();
  const mute = createMute();
  const sent: number[] = [];
  const pusher = createPusher(() => void sent.push(sent.length), {
    timer,
    throttleMs: 60,
    muted: () => mute.active,
  });

  const release = mute.hold();
  pusher.request();
  await settle();
  expect(sent).toHaveLength(0);

  release();
  pusher.request();
  await settle();
  expect(sent).toHaveLength(1);
});

it("counts mute holds and ignores a repeated release", () => {
  const mute = createMute();
  expect(mute.active).toBe(false);

  const first = mute.hold();
  const second = mute.hold();
  expect(mute.active).toBe(true);

  first();
  first();
  expect(mute.active).toBe(true);

  second();
  expect(mute.active).toBe(false);
});
