import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../packages/simulation/src/index.ts";
import { bridgeReduce, createBridgeState, type BridgeSignal, type BridgeState } from "../packages/orders/src/bridge.ts";
import { newFloorSim, STEP } from "./helpers/order-harness.ts";

function record(seed = 42) {
  const sim = newFloorSim(seed);
  let state: BridgeState = createBridgeState(sim.snapshot());
  const signals: BridgeSignal[] = [];
  const headAtCommit: Array<{ head: string | null; actual: string }> = [];
  sim.subscribeEvents((entry: AuditEntry) => {
    if (entry.kind === "event" && entry.event.type === "assembly-start" && typeof entry.event.data?.orderId === "string")
      headAtCommit.push({ head: state.queueHead, actual: entry.event.data.orderId });
    const frozen = JSON.stringify(state);
    const result = bridgeReduce(state, entry);
    expect(JSON.stringify(state)).toBe(frozen);
    state = result.state;
    signals.push(...result.signals);
  });
  return { sim, signals, headAtCommit, state: () => state };
}

describe("factory to order desk bridge (task 5)", () => {
  it("maps an agent order's factory events to signals in order and ignores visitor orders", () => {
    const r = record();
    r.sim.command({ id: "start", type: "start" });
    r.sim.command({ id: "visitor", type: "order-create", value: "1:3" });
    r.sim.command({ id: "agent", type: "order-agent-create", value: "1:2:ao-0000000001" });
    for (let i = 0; i < 8000 && !r.signals.some((s) => s.type === "UNIT_SHIPPED"); i++) r.sim.advance(STEP);
    const mine = r.signals.filter((s) => "ref" in s && s.ref === "ao-0000000001").map((s) => s.type);
    const expected = ["FACTORY_ORDER_CREATED", "UNIT_COMMITTED", "UNIT_JOINED", "UNIT_PASSED", "UNIT_STAGING", "UNIT_PARKED", "UNIT_DISPATCH_STARTED", "UNIT_SHIPPED"];
    let cursor = 0;
    for (const type of mine) if (type === expected[cursor]) cursor++;
    expect(cursor).toBe(expected.length);
    expect(r.signals.every((s) => !("ref" in s) || s.ref.startsWith("ao-"))).toBe(true);
    const committed = r.signals.find((s) => s.type === "UNIT_COMMITTED") as Extract<BridgeSignal, { type: "UNIT_COMMITTED" }>;
    expect(committed.modules).toHaveLength(5);
    expect(committed.factoryEvent.type).toBe("assembly-start");
    expect(r.sim.snapshot().metrics.archiveErrors ?? 0).toBe(0);
  }, 60_000);

  it("derives the same queue head as the engine's nextOrder at every commit", () => {
    const r = record(7);
    r.sim.command({ id: "start", type: "start" });
    r.sim.command({ id: "a", type: "order-agent-create", value: "2:3:ao-000000000a" });
    r.sim.command({ id: "b", type: "order-create", value: "1:1" });
    r.sim.command({ id: "c", type: "order-agent-create", value: "1:2:ao-000000000c" });
    for (let i = 0; i < 6000; i++) r.sim.advance(STEP);
    expect(r.headAtCommit.length).toBeGreaterThan(3);
    for (const commit of r.headAtCommit) expect(commit.head).toBe(commit.actual);
  }, 60_000);

  it("raises and clears risks for site faults, station faults and pauses, and resyncs on reset", () => {
    const r = record();
    r.sim.command({ id: "f", type: "fault", value: "dispatch" });
    r.sim.command({ id: "sf", type: "fault", station: "rear", value: "test" });
    expect(r.state().risks).toEqual(expect.arrayContaining(["site_fault:dispatch", "station_fault:rear"]));
    r.sim.command({ id: "rep", type: "repair" });
    expect(r.state().risks).not.toContain("site_fault:dispatch");
    r.sim.command({ id: "agent", type: "order-agent-create", value: "1:2:ao-000000000r" });
    r.sim.command({ id: "reset", type: "reset" });
    expect(r.signals.some((s) => s.type === "FLOOR_RESET")).toBe(true);
    expect(r.state().risks).toEqual([]);
    expect(Object.keys(r.state().refs)).toHaveLength(0);
    expect(r.signals.filter((s) => s.type === "RISK_RAISED").map((s) => (s as { reason: string }).reason)).toEqual(
      expect.arrayContaining(["site_fault:dispatch", "station_fault:rear"]),
    );
  });

  it("confirms cancellation of an agent order", () => {
    const r = record();
    r.sim.command({ id: "agent", type: "order-agent-create", value: "1:3:ao-000000000x" });
    const id = r.sim.snapshot().orders.find((o) => o.externalRef === "ao-000000000x")!.id;
    r.sim.command({ id: "cancel", type: "order-cancel", value: id });
    expect(r.signals.at(-1)).toMatchObject({ type: "CANCEL_CONFIRMED", ref: "ao-000000000x", factoryOrderId: id });
  });
});
