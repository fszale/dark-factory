import { describe, expect, it } from "vitest";
import {
  createFrameBatcher,
  newToastClock,
  reduceLiveBatch,
  toastExpired,
  toastFrame,
  TOAST_MAX_FOREGROUND_MS,
  TOAST_MIN_FRAMES,
  TOAST_VISIBLE_MS,
  type ToastClock,
} from "../apps/web/src/orderFloor.ts";
import { agentA, config, createHarness } from "./helpers/order-harness.ts";

/** Runs frames every `intervalMs` until the toast expires; returns the wall time it stayed up. */
function lifetime(intervalMs: number, held: (t: number) => boolean = () => false, limitMs = 120_000) {
  let clock: ToastClock = newToastClock();
  const start = 1000;
  for (let t = start; t - start <= limitMs; t += intervalMs) {
    clock = toastFrame(clock, t, held(t - start));
    if (toastExpired(clock)) return { wallMs: t - start, frames: clock.frames };
  }
  return { wallMs: Infinity, frames: clock.frames };
}

describe("incoming-order toast lifecycle (DF-ORDER-001 item 34)", () => {
  it("does not start counting until the first painted frame", () => {
    expect(toastExpired(newToastClock())).toBe(false);
    const first = toastFrame(newToastClock(), 50_000);
    expect(first).toMatchObject({ firstPaintAt: 50_000, frames: 1, visibleMs: 0 });
    expect(toastExpired(first)).toBe(false);
  });

  it("stays up for its full 6 seconds at 60 fps", () => {
    const { wallMs } = lifetime(1000 / 60);
    expect(wallMs).toBeGreaterThanOrEqual(TOAST_VISIBLE_MS - 20);
    expect(wallMs).toBeLessThan(TOAST_VISIBLE_MS + 50);
  });

  it("is not burned by a starved main thread: at 1.5 fps it outlives 6 wall seconds and gets many paints", () => {
    const { wallMs, frames } = lifetime(1000 / 1.5);
    expect(wallMs).toBeGreaterThan(TOAST_VISIBLE_MS * 2);
    expect(frames).toBeGreaterThanOrEqual(20);
  });

  it("never expires before the minimum number of painted frames, even with huge gaps", () => {
    const { frames } = lifetime(10_000);
    expect(frames).toBeGreaterThanOrEqual(TOAST_MIN_FRAMES);
  });

  it("is bounded on an extremely slow client", () => {
    const { wallMs } = lifetime(5000);
    expect(wallMs).toBeLessThanOrEqual(TOAST_MAX_FOREGROUND_MS + 5000);
  });

  it("pauses while held (hidden tab, hover or focus) and resumes afterwards", () => {
    const heldFor = 20_000;
    const { wallMs } = lifetime(1000 / 60, (t) => t > 1000 && t < 1000 + heldFor);
    expect(wallMs).toBeGreaterThan(heldFor + TOAST_VISIBLE_MS - 100);
    expect(wallMs).toBeLessThan(heldFor + TOAST_VISIBLE_MS + 100);
  });

  it("credits at most one capped frame for a long background gap", () => {
    let clock = newToastClock();
    clock = toastFrame(clock, 0);
    clock = toastFrame(clock, 100);
    clock = toastFrame(clock, 600_000); // tab came back after 10 minutes in the background
    expect(clock.visibleMs).toBeLessThanOrEqual(350);
    expect(toastExpired(clock)).toBe(false);
  });
});

describe("live frame batching", () => {
  it("delivers one batch per scheduled flush, in arrival order", () => {
    const flushes: Array<() => void> = [];
    const batches: string[][] = [];
    const batcher = createFrameBatcher<string>((batch) => batches.push(batch), (flush) => flushes.push(flush));
    batcher.push("a");
    batcher.push("b");
    batcher.push("c");
    expect(flushes).toHaveLength(1);
    flushes[0]();
    batcher.push("d");
    expect(flushes).toHaveLength(2);
    flushes[1]();
    expect(batches).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("validates every frame, counts each malformed one, and keeps only the newest snapshot and desk", async () => {
    const h = createHarness();
    h.tick(20);
    const quote = await h.desk.quote(agentA, { config, quantity: 1, destinationZone: "zone-metro", leadOptions: ["standard", "expedite"] });
    h.desk.placeOrder(agentA, { quoteId: quote.quoteId, leadOption: "expedite", idempotencyKey: "web-batch-0001" });
    h.tick(5);
    const desk = h.desk.deskView();
    const snapshot = (sequence: number) => JSON.stringify({ type: "snapshot", sessionId: "order-floor", sequence, sentAt: 1, snapshot: h.sim.liveSnapshot() });
    const orders = (sequence: number) => JSON.stringify({ type: "orders", sessionId: "order-floor", sequence, sentAt: 1, desk });
    const raws = [
      snapshot(1),
      orders(2),
      "{truncated",
      snapshot(3),
      JSON.stringify({ type: "orders", sessionId: "order-floor", sequence: 4, desk: { ...desk, virtual: false } }),
      orders(5),
      snapshot(2), // stale sequence: ignored, not an error
      snapshot(6),
    ];
    const result = reduceLiveBatch(raws, "order-floor", 0);
    expect(result.rejected).toBe(2);
    expect(result.accepted).toBe(5);
    expect(result.lastSequence).toBe(6);
    expect(result.snapshot?.sequence).toBe(6);
    expect(result.orders?.sequence).toBe(5);
    // Frames for another session or at or below the last applied sequence are skipped.
    expect(reduceLiveBatch([snapshot(6)], "order-floor", 6)).toMatchObject({ snapshot: null, accepted: 0, rejected: 0, lastSequence: 6 });
  });
});
