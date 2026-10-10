import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunExport } from "../../packages/contracts/src/index.ts";
import type { DeskState } from "../../packages/orders/src/desk.ts";
import { rebuildDesk, type FloorArchiveItem } from "../../packages/orders/src/replay.ts";

/** Rebuild the desk from the floor's NDJSON archive alone and return its update log digest. */
export function rebuildFromFloorArchive(dataDir: string, endSimTime: number) {
  const lines = readFileSync(join(dataDir, "order-floor-archive.ndjson"), "utf8").split("\n").filter(Boolean);
  const [head, ...rest] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  if (head.kind !== "checkpoint") throw new Error("archive has no checkpoint");
  const checkpoint = head as unknown as { run: RunExport; desk: DeskState; seed: number; deliveryTimeScale: number };
  const items = rest.map(({ recordedAt: _recordedAt, ...item }) => item as unknown as FloorArchiveItem);
  const desk = rebuildDesk(checkpoint.run.snapshot, items, {
    now: () => 0,
    seed: checkpoint.seed,
    deliveryTimeScale: checkpoint.deliveryTimeScale,
    deskState: checkpoint.desk,
    endSimTime,
  });
  return { desk, items };
}
