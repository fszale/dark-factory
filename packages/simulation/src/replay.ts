import {
  commandSchema,
  type DecisionRecord,
  type DecisionAftermath,
  type RunExport,
} from "../../contracts/src/index.ts";
import { FactorySimulation, type AuditEntry } from "./index.ts";

/**
 * Reconstruct manufacturing from a session's initial checkpoint and ordered archive.
 * No provider is invoked. Recorded successful actions are executed at their original
 * simulation times through the same bounded command/optimistic-concurrency ledger.
 * Caller must supply one complete archive segment and its final simulation time.
 */
export function replayArchive(
  initial: RunExport,
  entries: Iterable<AuditEntry>,
  finalTime: number,
): FactorySimulation {
  if (!Number.isFinite(finalTime) || finalTime < 0)
    throw new Error("Invalid replay end time");
  // Explicit offline replay keeps the source epoch and running flag. Ordinary imports remain paused.
  const simulation = FactorySimulation.fromExport(initial, { replay: true });
  const initialDecisions = new Set(
    initial.snapshot.decisions.map((decision) => decision.id),
  );
  const advanceTo = (time: number) => {
    if (!Number.isFinite(time) || time < simulation.snapshot().time - 1e-7)
      throw new Error("Archive timestamps are out of sequence");
    while (simulation.snapshot().time < time - 1e-7) {
      const current = simulation.snapshot();
      if (!current.running)
        throw new Error(
          "Archive advances a paused simulation without a start or step command",
        );
      simulation.advance(Math.min(7200, (time - current.time) / current.speed));
    }
  };
  for (const entry of entries) {
    if (entry.kind === "command") {
      advanceTo(entry.time);
      const command = commandSchema.parse(entry.command);
      const result = simulation.command(command);
      if (result.ok !== entry.result.ok)
        throw new Error(`Recorded action result diverged: ${result.message}`);
      if (result.ok && command.type === "reset") initialDecisions.clear();
    } else if (entry.kind === "event" && entry.event.type === "ai-aftermath") {
      const decisionId = entry.event.data?.decisionId;
      const aftermath = entry.event.data?.aftermath as
        DecisionAftermath | undefined;
      if (typeof decisionId !== "string" || !aftermath)
        throw new Error("Archive decision aftermath is missing");
      const initial = simulation
        .snapshot()
        .decisions.find((decision) => decision.id === decisionId)?.aftermath;
      if (initial && initial.measurement.time >= aftermath.measurement.time)
        continue;
      advanceTo(entry.event.time);
      if (!simulation.updateDecisionAftermath(decisionId, aftermath))
        throw new Error("Archive aftermath references an unavailable decision");
    } else if (entry.kind === "event" && entry.event.type === "ai-decision") {
      const decision = entry.event.data?.decision;
      if (!decision || typeof decision !== "object")
        throw new Error("Archive decision payload is missing");
      if (initialDecisions.has((decision as DecisionRecord).id)) continue;
      advanceTo(entry.event.time);
      simulation.addDecision(structuredClone(decision) as DecisionRecord);
    }
  }
  advanceTo(finalTime);
  simulation.setProviders({ astra: false, jev: false });
  return simulation;
}
