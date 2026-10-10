import type { FactorySnapshot } from "../../contracts/src/index.ts";
import type { AuditEntry } from "../../simulation/src/index.ts";
import { OrderDesk, type DeskArchiveRecord, type DeskOptions, type DeskState } from "./desk.ts";

export type FloorArchiveItem = AuditEntry | DeskArchiveRecord;

export const isDeskRecord = (item: FloorArchiveItem): item is DeskArchiveRecord =>
  item.kind === "intake" || item.kind === "desk-action";

/**
 * Rebuild the order desk from a floor archive: the checkpoint snapshot plus the
 * ordered stream of factory entries and desk intake records. No floor or
 * forecaster is attached, so the result holds only simulated updates, which is
 * exactly what updateLogDigest() covers.
 */
export function rebuildDesk(
  checkpoint: FactorySnapshot,
  items: Iterable<FloorArchiveItem>,
  options: Pick<DeskOptions, "now" | "deliveryTimeScale" | "maxActiveAgentOrders"> & { seed: number; endSimTime?: number; deskState?: DeskState },
) {
  const desk = new OrderDesk(
    { floor: null, now: options.now, deliveryTimeScale: options.deliveryTimeScale, maxActiveAgentOrders: options.maxActiveAgentOrders },
    options.deskState ?? OrderDesk.initialState(checkpoint),
  );
  desk.carrierSeed = options.seed;
  let last = checkpoint.time;
  for (const item of items) {
    if (isDeskRecord(item)) {
      last = Math.max(last, item.simTime);
      if (item.kind === "intake" && item.action === "place") desk.applyIntake(item.order, item.simTime);
      else if (item.kind === "intake") desk.applyCancelRequest(item.orderId, item.simTime);
      else desk.applyCarrierControl(item.action, item.orderId, item.unitIndex, item.simTime);
      continue;
    }
    if (item.kind === "event") last = Math.max(last, item.event.time);
    else if (item.kind === "command") last = Math.max(last, item.time);
    desk.ingest(item);
  }
  desk.advanceClock(options.endSimTime ?? last);
  return desk;
}
