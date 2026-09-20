import { describe, it, expect } from "vitest";
import {
  adaptiveExperimentJobSchema,
  adaptiveExperimentRequestSchema,
  snapshotSchema,
  snapshotMessageSchema,
  experimentResultSchema,
  checkpointSchema,
} from "../packages/contracts/src/runtime.ts";
import { FactorySimulation } from "../packages/simulation/src/index.ts";
import { pairedExperiment } from "../packages/simulation/src/experiments.ts";
describe("shared runtime transport contracts", () => {
  it("validates authoritative snapshots through delivery, sorting, production and dispatch", () => {
    const sim = new FactorySimulation({ seed: 42 });
    sim.command({ id: "start", type: "start" });
    for (let i = 0; i < 100; i++) {
      sim.advance(10);
      expect(snapshotSchema.safeParse(sim.snapshot()).success).toBe(true);
    }
    expect(checkpointSchema.safeParse(sim.exportRun()).success).toBe(true);
  });
  it("rejects malformed transport sequence and ownership before rendering", () => {
    const snapshot = new FactorySimulation({}).snapshot();
    expect(
      snapshotMessageSchema.safeParse({
        type: "snapshot",
        sessionId: snapshot.id,
        sequence: 1,
        snapshot,
      }).success,
    ).toBe(true);
    expect(
      snapshotMessageSchema.safeParse({
        type: "snapshot",
        sessionId: snapshot.id,
        sequence: -1,
        snapshot,
      }).success,
    ).toBe(false);
    snapshot.stations.front.stock = -1;
    expect(snapshotSchema.safeParse(snapshot).success).toBe(false);
  });
  it("requires bounded complete paired-seed comparison results", () => {
    const report = pairedExperiment({});
    expect(experimentResultSchema.safeParse(report).success).toBe(true);
    expect(
      experimentResultSchema.safeParse({
        ...report,
        seeds: report.seeds.slice(1),
      }).success,
    ).toBe(false);
  });
  it("validates bounded adaptive job requests and progress", () => {
    expect(
      adaptiveExperimentRequestSchema.safeParse({
        provider: "astra",
        config: { scenario: "balanced" },
        decisionTimes: [300, 900],
      }).success,
    ).toBe(true);
    expect(
      adaptiveExperimentRequestSchema.safeParse({
        provider: "astra",
        config: { seed: 42 },
      }).success,
    ).toBe(false);
    expect(
      adaptiveExperimentRequestSchema.safeParse({
        provider: "astra",
        decisionTimes: [900, 300],
      }).success,
    ).toBe(false);
    expect(
      adaptiveExperimentJobSchema.safeParse({
        jobId: "adaptive-job",
        status: "queued",
        provider: "astra",
        createdAt: 1,
        updatedAt: 1,
        progress: {
          phase: "queued",
          completedPairs: 0,
          requestedDecisions: 0,
          completedDecisions: 0,
          simulationTime: 0,
        },
        bounds: {
          pairedSeeds: 10,
          decisionCheckpoints: 2,
          maximumProviderCalls: 20,
          providerCallsPerMinute: 2,
          timeoutMinutes: 15,
        },
      }).success,
    ).toBe(true);
  });
});
