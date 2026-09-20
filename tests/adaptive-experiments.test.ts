import { describe, it, expect, vi } from "vitest";
import {
  adaptivePairedExperiment,
  type AdaptiveOptions,
  type AdaptiveProposal,
} from "../packages/simulation/src/adaptive-experiments.ts";
const proposal = (
  commands: AdaptiveProposal["commands"] = [],
): AdaptiveProposal => ({
  provider: "astra",
  source: "test-fixture",
  summary: "Explicit deterministic test policy",
  commands,
  tokens: 7,
});
describe("bounded adaptive paired comparisons", () => {
  it("observes consequences of earlier decisions across ten paired seeds and reports honest fixture provenance", async () => {
    const observations: number[] = [];
    const decide: AdaptiveOptions["decide"] = async (request) => {
      expect(JSON.stringify(request.observation)).not.toMatch(
        /"wear"|"streams"|"counters"/,
      );
      const exterior = request.observation.stations.find(
        (s) => s.id === "exterior",
      )!;
      if (request.checkpoint === 1) {
        expect(exterior.profile).toBe("fast");
        observations.push(exterior.completed);
      }
      return proposal([
        {
          id: "same-proposal-id",
          type: "profile",
          station: "exterior",
          value: request.checkpoint === 0 ? "fast" : "gentle",
          revision: request.revision,
          epoch: request.epoch,
        },
      ]);
    };
    const result = await adaptivePairedExperiment({}, { decide });
    expect(result.runs).toBe(10);
    expect(result.trace).toHaveLength(20);
    expect(result.policySource).toBe("adaptive-test-fixture");
    expect(result.note).toContain("not live AI evidence");
    expect(result.tokens).toBe(140);
    expect(observations.every((count) => count > 0)).toBe(true);
    expect(
      result.perSeed.every(
        (row) => row.appliedActions === 2 && row.rejectedActions === 0,
      ),
    ).toBe(true);
    expect(result.trace[1].observation.time).toBe(900);
    const key = "throughput",
      deltas = result.perSeed.map((row) => row.differences[key]),
      mean = deltas.reduce((a, b) => a + b, 0) / 10;
    expect(result.standardDeviation.differences[key]).toBeCloseTo(
      Math.sqrt(
        deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 10,
      ),
      10,
    );
    expect(
      result.perSeed.every(
        (row) => row.candidate.receivingConservationDelta === 0,
      ),
    ).toBe(true);
  });
  it("has identical baseline/candidate outcomes for no actions and deterministically reproduces adaptive fixture outcomes", async () => {
    const empty = await adaptivePairedExperiment(
      { decisionTimes: [0] },
      { decide: async () => proposal() },
    );
    expect(Object.values(empty.differences).every((value) => value === 0)).toBe(
      true,
    );
    const policy: AdaptiveOptions["decide"] = async (request) =>
      proposal([
        {
          id: "repair",
          type: "repair",
          station:
            request.observation.stations.find((s) => s.temperature > 25)?.id ??
            "front",
        },
      ]);
    const first = await adaptivePairedExperiment(
      { decisionTimes: [300] },
      { decide: policy },
    );
    const second = await adaptivePairedExperiment(
      { decisionTimes: [300] },
      { decide: policy },
    );
    expect(first.perSeed).toEqual(second.perSeed);
    expect(first.differences.maintenanceCost).toBeGreaterThan(0); // Harmful costs are retained, not filtered out.
  });
  it("rejects stale, unfair playback, demand-changing and physically invalid actions while permitting valid later actions", async () => {
    const result = await adaptivePairedExperiment(
      { decisionTimes: [300] },
      {
        decide: async (request) =>
          proposal([
            { id: "reset", type: "reset" },
            { id: "speed", type: "speed", value: 10 },
            { id: "demand", type: "config", value: "orderSize:1" },
            {
              id: "stale",
              type: "profile",
              station: "front",
              value: "fast",
              revision: request.revision + 1,
            },
            { id: "overflow", type: "buffer", station: "rear", value: 99 },
            {
              id: "valid",
              type: "profile",
              station: "exterior",
              value: "fast",
            },
          ]),
      },
    );
    expect(
      result.perSeed.every(
        (row) => row.rejectedActions === 5 && row.appliedActions === 1,
      ),
    ).toBe(true);
    expect(result.trace.every((row) => row.simulationTime === 300)).toBe(true);
    expect(result.trace[0].actions[4].message).toContain("1–8");
  });
  it("bounds checkpoint/seed counts before calling the authorized decision boundary", async () => {
    const decide = vi.fn(async () => proposal());
    await expect(
      adaptivePairedExperiment({ decisionTimes: [0, 10, 20, 30] }, { decide }),
    ).rejects.toThrow(/one to three/);
    await expect(
      adaptivePairedExperiment({ decisionTimes: [30, 10] }, { decide }),
    ).rejects.toThrow(/increasing/);
    await expect(
      adaptivePairedExperiment({ seeds: Array(10).fill(42) }, { decide }),
    ).rejects.toThrow(/distinct/);
    expect(decide).not.toHaveBeenCalled();
  });
  it("stops after provider refusal with no scripted substitution or additional requests", async () => {
    const decide = vi.fn(async () => {
      throw new Error("Server global budget exhausted");
    });
    try {
      await adaptivePairedExperiment({}, { decide });
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AdaptiveComparisonError",
        progress: {
          completedPairs: 0,
          requestedDecisions: 1,
          completedDecisions: 0,
        },
      });
    }
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it("propagates cancellation into an in-flight decision and never starts another seed", async () => {
    const controller = new AbortController();
    let aborted = false;
    const decide = vi.fn(
      (request: Parameters<AdaptiveOptions["decide"]>[0]) =>
        new Promise<AdaptiveProposal>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
          queueMicrotask(() => controller.abort());
        }),
    );
    await expect(
      adaptivePairedExperiment({}, { decide, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
    expect(aborted).toBe(true);
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it("aborts timed-out decisions even when the callback never resolves", async () => {
    let aborted = false;
    const decide = vi.fn(
      (request: Parameters<AdaptiveOptions["decide"]>[0]) =>
        new Promise<AdaptiveProposal>(() => {
          request.signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    await expect(
      adaptivePairedExperiment({}, { decide, decisionTimeoutMs: 1000 }),
    ).rejects.toThrow(/unavailable/);
    expect(aborted).toBe(true);
    expect(decide).toHaveBeenCalledTimes(1);
  });
});
