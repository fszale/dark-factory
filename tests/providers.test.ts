import { describe, expect, it } from "vitest";
import { FactorySimulation } from "../packages/simulation/src/index.ts";
import {
  AstraProvider,
  createProviderSet,
  operationalView,
  ProviderUnavailableError,
  validateProviderCommands,
  validateProviderDecision,
} from "../packages/providers/src/index.ts";

describe("provider boundary", () => {
  it("excludes hidden wear and internal future state", () => {
    const simulation = new FactorySimulation({ scenario: "gripper" });
    const view = operationalView(simulation.snapshot());
    expect(view.stations[0]).not.toHaveProperty("wear");
    expect(view).not.toHaveProperty("internal");
    expect(view.configuration).toMatchObject({
      releaseRate: 1,
      reorderPoint: 12,
      deliverySize: 15,
      dispatchDwell: 80,
    });
    expect(view.configuration).not.toHaveProperty("seed");
    expect(JSON.stringify(view)).not.toContain("streams");
  });

  it("reports provider absence truthfully and does not pretend to decide", async () => {
    const astra = new AstraProvider("");
    expect(astra.configured).toBe(false);
    await expect(
      astra.decide(new FactorySimulation().snapshot()),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(
      astra.decideObservation(
        operationalView(new FactorySimulation().snapshot()),
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(createProviderSet({ astra }).status()).toMatchObject({
      astra: { configured: false, status: "not configured" },
    });
  });

  it("accepts only bounded operational configuration actions", () => {
    expect(
      validateProviderCommands([
        { type: "config", station: null, value: "deliverySize:20" },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "config", station: null, value: "continuous:false" },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "config", station: null, value: "materialLoadingCapacity:3" },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "priority", station: "front", value: 1 },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "priority", station: "front", value: 6 },
      ]),
    ).toBe(false);
    expect(
      validateProviderCommands([
        { type: "experiment", station: null, value: "front:gentle" },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "experiment", station: "rear", value: "front:gentle" },
      ]),
    ).toBe(false);
    expect(
      validateProviderCommands([
        { type: "experiment", station: null, value: "front:gentle" },
        { type: "experiment", station: null, value: "rear:normal" },
      ]),
    ).toBe(false);
    expect(
      validateProviderCommands([
        { type: "order-create", station: null, value: "25:1" },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "order-create", station: null, value: "1001:1" },
      ]),
    ).toBe(false);
    expect(
      validateProviderCommands([
        { type: "order-priority", station: null, value: "order-1:2" },
      ]),
    ).toBe(true);
    expect(
      validateProviderCommands([
        { type: "config", station: null, value: "deliverySize:200" },
      ]),
    ).toBe(false);
    expect(
      validateProviderCommands([
        { type: "config", station: null, value: "seed:1" },
      ]),
    ).toBe(false);
  });

  it("rejects malformed normalized provider decisions at the server boundary", () => {
    expect(
      validateProviderDecision({ summary: "Hold.", commands: [], tokens: 4 }),
    ).toBe(true);
    expect(
      validateProviderDecision({
        summary: "Sabotage.",
        commands: [{ id: "bad", type: "fault", station: "front" }],
        tokens: 4,
      }),
    ).toBe(false);
    expect(
      validateProviderDecision({ summary: "Hold.", commands: [], tokens: -1 }),
    ).toBe(false);
    expect(
      validateProviderDecision({
        summary: "Run too much.",
        commands: [
          { id: "exp-1", type: "experiment", value: "front:gentle" },
          { id: "exp-2", type: "experiment", value: "rear:normal" },
        ],
        tokens: 2,
      }),
    ).toBe(false);
  });

  it("exposes only completed bounded experiment evidence to the next provider view", () => {
    const simulation = new FactorySimulation();
    simulation.addDecision({
      id: "decision-experiment",
      provider: "astra",
      time: 0,
      summary: "Compared front handling.",
      status: "advisory",
      latency: 5,
      commands: [],
      tokens: 4,
      revision: 0,
      experiment: {
        status: "completed",
        requestedProfile: { line: "front", profile: "gentle" },
        completedAt: 0,
        provenance: "paired-deterministic-simulation",
        runs: 10,
        seeds: Array.from({ length: 10 }, (_, index) => 10_001 + index),
        baseline: { throughput: 20 },
        candidate: { throughput: 21 },
        differences: { throughput: 1 },
        note: "Observational paired result.",
      },
    });
    expect(operationalView(simulation.snapshot()).recentExperiments).toEqual([
      expect.objectContaining({
        decisionId: "decision-experiment",
        runs: 10,
        differences: { throughput: 1 },
        provenance: "paired-deterministic-simulation",
      }),
    ]);
  });
});
