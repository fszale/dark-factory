import { describe, it, expect } from "vitest";
import {
  FactorySimulation,
  type AuditEntry,
} from "../packages/simulation/src/index.ts";
import {
  DEFECT_CLASSES,
  type ModuleInstance,
} from "../packages/contracts/src/index.ts";
const start = (sim: FactorySimulation) =>
  sim.command({ id: "factory-start", type: "start" });
const conserve = (sim: FactorySimulation) => {
  const s = sim.snapshot();
  expect(s.metrics.initial + s.metrics.received).toBe(
    s.metrics.consumed +
      Object.values(s.warehouse).reduce((a, b) => a + b, 0) +
      Object.values(s.stations).reduce((a, b) => a + b.stock, 0) +
      s.carts.reduce((a, b) => a + b.amount, 0),
  );
};
describe("station-specific operator hold and restart", () => {
  it("freezes module ownership, phase progress and remaining time while other lines continue", () => {
    const sim = new FactorySimulation();
    start(sim);
    sim.advance(10);
    const before = sim.snapshot().stations.front,
      remaining = before.phaseEnd - 10;
    expect(before.status).toBe("processing");
    expect(
      sim.command({ id: "hold-front", type: "pause", station: "front" }).ok,
    ).toBe(true);
    sim.advance(300);
    const held = sim.snapshot();
    expect(held.running).toBe(true);
    expect(held.stations.front.status).toBe("paused");
    expect(held.stations.front.current).toEqual(before.current);
    expect(held.stations.front.progress).toBe(before.progress);
    expect(held.stations.front.phaseEnd - held.time).toBeCloseTo(remaining);
    expect(held.stations.front.busyTime).toBe(before.busyTime);
    expect(held.stations.front.downTime).toBe(before.downTime);
    expect(held.stations.front.rejects).toBe(before.rejects);
    expect(held.stations.front.pausedTime).toBeCloseTo(300);
    expect(held.stations.rear.completed).toBeGreaterThan(0);
    expect(
      sim.command({ id: "resume-front", type: "start", station: "front" }).ok,
    ).toBe(true);
    sim.advance(remaining - 0.1);
    expect(sim.snapshot().stations.front.cycles).toBe(before.cycles);
    sim.advance(0.2);
    expect(sim.snapshot().stations.front.cycles).toBe(before.cycles + 1);
    conserve(sim);
  });
  it("restores a paused checkpoint without losing remaining work or starting the globally paused factory", () => {
    const sim = new FactorySimulation();
    start(sim);
    sim.advance(10);
    sim.command({ id: "station-stop", type: "pause", station: "front" });
    sim.advance(120);
    const restored = FactorySimulation.fromExport(sim.exportRun()),
      held = restored.snapshot().stations.front;
    expect(
      restored.command({
        id: "station-resume",
        type: "start",
        station: "front",
      }).ok,
    ).toBe(true);
    expect(restored.snapshot().running).toBe(false);
    restored.advance(50);
    expect(restored.snapshot().time).toBe(130);
    expect(restored.snapshot().stations.front.progress).toBe(held.progress);
    restored.command({ id: "global-resume", type: "start" });
    restored.advance(600);
    expect(restored.snapshot().metrics.completed).toBeGreaterThan(0);
    conserve(restored);
    const invalid = sim.exportRun();
    delete invalid.snapshot.stations.front.pause;
    expect(() => FactorySimulation.fromExport(invalid)).toThrow(
      /pause metadata/,
    );
  });
  it("does not bypass a fault or maintenance and freezes an already scheduled repair", () => {
    const sim = new FactorySimulation();
    start(sim);
    sim.advance(10);
    sim.command({ id: "fault-front", type: "fault", station: "front" });
    sim.command({ id: "pause-fault", type: "pause", station: "front" });
    expect(
      sim.command({ id: "repair-held", type: "repair", station: "front" }).ok,
    ).toBe(false);
    expect(
      sim.command({ id: "fault-held", type: "fault", station: "front" }).ok,
    ).toBe(false);
    sim.command({ id: "resume-fault", type: "start", station: "front" });
    expect(sim.snapshot().stations.front.status).toBe("faulted");
    sim.command({ id: "repair-front", type: "repair", station: "front" });
    sim.advance(5);
    sim.command({ id: "pause-repair", type: "pause", station: "front" });
    sim.advance(100);
    expect(sim.snapshot().stations.front.pause?.previousStatus).toBe(
      "maintenance",
    );
    expect(
      sim.snapshot().stations.front.maintenanceUntil - sim.snapshot().time,
    ).toBe(15);
    sim.command({ id: "resume-repair", type: "start", station: "front" });
    sim.advance(14);
    expect(sim.snapshot().stations.front.status).toBe("maintenance");
    sim.advance(1);
    expect(sim.snapshot().stations.front.status).toBe("processing");
    expect(sim.snapshot().stations.front.fault).toBeNull();
    conserve(sim);
  });
  it("keeps global pause semantics and prevents a held station from receiving new cart reservations", () => {
    const sim = new FactorySimulation({ scenario: "empty" });
    sim.command({ id: "hold-empty", type: "pause", station: "front" });
    start(sim);
    sim.advance(70);
    expect(sim.snapshot().carts.some((c) => c.line === "front")).toBe(false);
    expect(sim.snapshot().stations.front.stock).toBe(0);
    const at = sim.snapshot().time;
    sim.command({ id: "global-hold", type: "pause" });
    sim.advance(60);
    expect(sim.snapshot().time).toBe(at);
    sim.command({ id: "station-resume", type: "start", station: "front" });
    expect(sim.snapshot().running).toBe(false);
    sim.command({ id: "resume-all", type: "start" });
    sim.advance(100);
    expect(sim.snapshot().stations.front.cycles).toBeGreaterThan(0);
    conserve(sim);
  });
});
describe("explicit simulated defect classes", () => {
  it("reconciles classified rejects and preserves class evidence through lineage and checkpoints", () => {
    const sim = new FactorySimulation({
        profiles: {
          front: "fast",
          rear: "fast",
          battery: "fast",
          interior: "fast",
          exterior: "fast",
        },
      }),
      archive: AuditEntry[] = [];
    sim.subscribeEvents((e) => archive.push(e));
    start(sim);
    sim.advance(7200);
    const s = sim.snapshot(),
      classes = Object.entries(s.metrics).filter(([key]) =>
        key.startsWith("defect_"),
      );
    expect(classes.length).toBeGreaterThan(2);
    expect(classes.reduce((sum, [, count]) => sum + count, 0)).toBe(
      s.metrics.inspectionRejects + s.metrics.rejectedDeliveries,
    );
    const rejects = archive.filter(
      (e) =>
        e.kind === "event" &&
        ["inspection-reject", "vehicle-rework", "shipment-rejected"].includes(
          e.event.type,
        ),
    );
    expect(rejects.length).toBeGreaterThan(0);
    for (const record of rejects) {
      if (record.kind === "event")
        expect(DEFECT_CLASSES).toContain(record.event.data?.defectClass);
    }
    const modules = archive
      .filter((e) => e.kind === "lineage")
      .flatMap((e) => e.lineage.modules as ModuleInstance[]);
    const rejectedHistory = modules
      .flatMap((m) => m.reworkHistory ?? [])
      .filter((h) => h.event === "inspection-rejected");
    expect(rejectedHistory.length).toBeGreaterThan(0);
    expect(
      rejectedHistory.every((h) => DEFECT_CLASSES.includes(h.defectClass!)),
    ).toBe(true);
    expect(s.metrics.qualityEscapes).toBe(0);
    expect(s.metrics.perfectDetectionAssumption).toBe(1);
    expect(
      FactorySimulation.fromExport(sim.exportRun()).exportRun().internal.audit,
    ).toEqual(sim.exportRun().internal.audit);
    conserve(sim);
  });
});
