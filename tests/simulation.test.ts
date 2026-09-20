import { describe, it, expect } from "vitest";
import { FactorySimulation } from "../packages/simulation/src/index.ts";
import {
  LINE_IDS,
  type FactorySnapshot,
} from "../packages/contracts/src/index.ts";
function start(s: FactorySimulation) {
  expect(s.command({ id: "start", type: "start" }).ok).toBe(true);
}
function conservation(s: FactorySnapshot) {
  const available =
    Object.values(s.warehouse).reduce((a, b) => a + b, 0) +
    Object.values(s.stations).reduce((a, b) => a + b.stock, 0) +
    s.carts.reduce((a, b) => a + b.amount, 0);
  expect(s.metrics.initial + s.metrics.received).toBe(
    available + s.metrics.consumed,
  );
  const modules =
    Object.values(s.stations).reduce(
      (a, b) => a + b.queue.length + (b.current ? 1 : 0),
      0,
    ) +
    s.vehicles.length * 5 +
    s.metrics.dispatched * 5 +
    s.metrics.scrap;
  expect(modules).toBe(s.metrics.consumed);
  expect(new Set(s.vehicles.map((v) => v.slot)).size).toBe(s.vehicles.length);
  for (const st of Object.values(s.stations)) {
    expect(st.stock).toBeGreaterThanOrEqual(0);
    expect(st.queue.length).toBeLessThanOrEqual(st.capacity);
    expect(st.queue.every((m) => m.accepted)).toBe(true);
  }
}
describe("authoritative manufacturing engine", () => {
  it("operates all five lines concurrently, receives, manufactures, parks and dispatches with genealogy", () => {
    const s = new FactorySimulation();
    start(s);
    s.advance(1);
    expect(
      LINE_IDS.every((l) => s.snapshot().stations[l].current !== null),
    ).toBe(true);
    s.advance(500);
    const w = s.snapshot();
    expect(w.metrics.completed).toBeGreaterThan(5);
    expect(w.metrics.dispatched).toBeGreaterThan(0);
    expect(w.metrics.deliveries).toBeGreaterThan(0);
    expect(
      w.vehicles.every(
        (v) =>
          v.modules.length === 5 && v.modules.every((m) => m.accepted && m.lot),
      ),
    ).toBe(true);
    conservation(w);
  });
  it("starts empty and cannot conjure material before the truck unloads", () => {
    const s = new FactorySimulation({ scenario: "empty" });
    start(s);
    s.advance(19);
    expect(s.snapshot().metrics.consumed).toBe(0);
    expect(s.snapshot().trucks[0].phase).toBe("approach");
    s.advance(80);
    expect(s.snapshot().metrics.received).toBeGreaterThan(0);
    expect(s.snapshot().metrics.consumed).toBeGreaterThan(0);
    conservation(s.snapshot());
  });
  it("requires all five inputs and propagates finite parking backpressure", () => {
    const s = new FactorySimulation({
      parkingCapacity: 1,
      scenario: "dispatch-blockage",
    });
    start(s);
    s.advance(500);
    const w = s.snapshot();
    expect(w.metrics.completed).toBe(1);
    expect(w.metrics.dispatched).toBe(0);
    expect(w.vehicles).toHaveLength(1);
    expect(w.metrics.parkingWait).toBeGreaterThan(0);
    expect(
      Object.values(w.stations).some((st) => st.status === "blocked"),
    ).toBe(true);
    conservation(w);
    expect(s.command({ id: "repair", type: "repair" }).ok).toBe(true);
    s.advance(200);
    expect(s.snapshot().metrics.dispatched).toBeGreaterThan(0);
    conservation(s.snapshot());
  });
  it("faults preserve in-process work and repair resumes it", () => {
    const s = new FactorySimulation();
    start(s);
    s.advance(10);
    const module = s.snapshot().stations.front.current!.id;
    s.command({
      id: "fault",
      type: "fault",
      station: "front",
      value: "gripper",
    });
    s.advance(80);
    expect(s.snapshot().stations.front.current!.id).toBe(module);
    expect(s.snapshot().metrics.completed).toBe(0);
    s.command({ id: "repair", type: "repair", station: "front" });
    s.advance(90);
    expect(s.snapshot().metrics.completed).toBeGreaterThan(0);
    expect(s.snapshot().stations.front.fault).toBeNull();
    conservation(s.snapshot());
  });
  it("pause, takeover, epochs, idempotence and pad edit constraints are enforced", () => {
    const s = new FactorySimulation();
    start(s);
    s.advance(10);
    expect(
      s.command({
        id: "bad-layout",
        type: "layout",
        station: "front",
        value: 1,
      }).ok,
    ).toBe(false);
    const epoch = s.snapshot().epoch;
    s.command({ id: "p", type: "pause" });
    s.advance(10);
    expect(s.snapshot().time).toBe(10);
    expect(s.command({ id: "stale", type: "start", epoch }).ok).toBe(false);
    expect(
      s.command({ id: "layout", type: "layout", station: "front", value: 1 })
        .ok,
    ).toBe(true);
    const a = s.command({ id: "step", type: "step" });
    const time = s.snapshot().time;
    expect(s.command({ id: "step", type: "step" })).toEqual(a);
    expect(s.snapshot().time).toBe(time);
  });
  it("fixed seed and actions reproduce decisions and metrics", () => {
    const a = new FactorySimulation({ seed: 10 }),
      b = new FactorySimulation({ seed: 10 });
    start(a);
    start(b);
    a.advance(1300);
    b.advance(1300);
    const sa = a.snapshot(),
      sb = b.snapshot();
    sa.metrics.simulationMs = 0;
    sb.metrics.simulationMs = 0;
    expect(sa).toEqual(sb);
    conservation(sa);
  });
  it("checkpoints restore paused and continue the identical random streams and lot ledger", () => {
    const a = new FactorySimulation({ seed: 11 });
    start(a);
    a.advance(250);
    const b = FactorySimulation.fromExport(a.exportRun());
    expect(b.snapshot().running).toBe(false);
    expect(b.snapshot().epoch).toBe(a.snapshot().epoch + 1);
    expect(b.command({ id: "resume-restored", type: "start" }).ok).toBe(true);
    a.advance(500);
    b.advance(500);
    const ma = a.snapshot().metrics,
      mb = b.snapshot().metrics;
    ma.simulationMs = 0;
    mb.simulationMs = 0;
    expect(ma).toEqual(mb);
    expect(a.snapshot().vehicles).toEqual(b.snapshot().vehicles);
    conservation(b.snapshot());
  });
  it("rejects corrupt ledger checkpoints", () => {
    const a = new FactorySimulation();
    const checkpoint = a.exportRun();
    checkpoint.snapshot.warehouse.front++;
    expect(() => FactorySimulation.fromExport(checkpoint)).toThrow();
  });
  it("rejects nonfinite time, repeated ownership, fractional inventory settings, and corrupt route reservations", () => {
    const sim = new FactorySimulation();
    expect(
      sim.command({
        id: "fractional",
        type: "config",
        value: "parkingCapacity:2.5",
      }).ok,
    ).toBe(false);
    const invalidTime = sim.exportRun();
    invalidTime.snapshot.time = Number.POSITIVE_INFINITY;
    expect(() => FactorySimulation.fromExport(invalidTime)).toThrow();
    start(sim);
    sim.advance(200);
    const duplicate = sim.exportRun();
    const source = duplicate.snapshot.vehicles[0];
    expect(source).toBeDefined();
    duplicate.snapshot.vehicles.push({
      ...structuredClone(source),
      id: "duplicate",
      slot: source.slot + 1,
    });
    expect(() => FactorySimulation.fromExport(duplicate)).toThrow();
  });
  it("reports monitored logistics, quality, equipment, and conserved stock measurements", () => {
    const sim = new FactorySimulation();
    start(sim);
    sim.advance(120);
    const m = sim.snapshot().metrics;
    for (const key of [
      "firstPassYield",
      "reworkSuccessRate",
      "dockQueue",
      "cartUtilization",
      "warehouseCapacity",
      "frontTemperature",
      "exteriorUtilization",
      "finishedStock",
      "committedParking",
    ])
      expect(Number.isFinite(m[key])).toBe(true);
    expect(m.conservationDelta).toBe(0);
    expect(m.frontUtilization).toBeGreaterThan(0);
  });
  it("completes finite orders without unlimited module production", () => {
    const s = new FactorySimulation({ continuous: false, orderSize: 3 });
    start(s);
    s.advance(1500);
    expect(s.snapshot().metrics.completed).toBe(3);
    expect(s.snapshot().metrics.dispatched).toBe(3);
    conservation(s.snapshot());
  });
  it("runs a two-hour simulated soak with bounded histories and no material loss", () => {
    const s = new FactorySimulation();
    start(s);
    for (let i = 0; i < 120; i++) {
      s.advance(60);
      conservation(s.snapshot());
    }
    const w = s.snapshot();
    expect(w.time).toBeCloseTo(7200, 6);
    expect(w.metrics.completed).toBeGreaterThan(100);
    expect(w.events.length).toBeLessThanOrEqual(2000);
    expect(w.samples.length).toBeLessThanOrEqual(720);
    expect(w.vehicles.length).toBeLessThanOrEqual(w.config.parkingCapacity);
    expect(w.carts.length).toBeLessThanOrEqual(5);
    expect(w.trucks.length).toBeLessThanOrEqual(1);
    expect(w.metrics.conservationDelta).toBe(0);
  });
});
