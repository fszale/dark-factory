import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandResult, FactoryCommand } from "../../../../packages/contracts/src/index.ts";
import type { OrderUpdate } from "../../../../packages/contracts/src/orders.ts";
import { FactorySimulation, type AuditEntry } from "../../../../packages/simulation/src/index.ts";
import {
  OrderDesk,
  OrderDeskError,
  type CarrierAction,
  type DeskArchiveRecord,
  type DeskLogger,
  type DeskState,
  type FloorPort,
} from "../../../../packages/orders/src/desk.ts";
import type { Forecaster, OrderDeskConfig } from "./config.ts";

export const FLOOR_SESSION_ID = "order-floor";
/** Fixed tick quantum in real seconds. Forecast forks advance with the same quantum, which keeps quotes exact. */
export const FLOOR_STEP_SECONDS = 0.125;
const STEP_MS = FLOOR_STEP_SECONDS * 1000;
const MAX_CATCH_UP_STEPS = 40;
const PERSIST_EVERY_SIM_SECONDS = 30;
const ARCHIVE_ROTATE_BYTES = 64 * 1024 * 1024;
export const FLOOR_STATE_FILE = "order-floor.json";
export const FLOOR_ARCHIVE_FILE = "order-floor-archive.ndjson";

/** Commands the operator may send to the shared floor. Mode, layout and config changes are never allowed. */
const OPERATOR_COMMANDS = new Set<FactoryCommand["type"]>([
  "start",
  "pause",
  "speed",
  "fault",
  "repair",
  "order-create",
  "order-priority",
  "order-cancel",
  "reset",
]);
/** The desk's whole authority over the factory. */
const DESK_COMMANDS = new Set<FactoryCommand["type"]>(["order-agent-create", "order-cancel"]);

export interface FloorFile {
  formatVersion: 1;
  writtenAt: string;
  desk: DeskState;
  floorCheckpoint: unknown;
}

/** The floor's own NDJSON archive: one checkpoint line, then factory entries and desk records in order. */
class FloorArchive {
  private buffer: string[] = [];
  constructor(private readonly path: string) {}
  begin(checkpoint: Record<string, unknown>) {
    if (existsSync(this.path)) renameSync(this.path, `${this.path}.prev`);
    writeFileSync(this.path, `${JSON.stringify({ kind: "checkpoint", ...checkpoint })}\n`, { mode: 0o600 });
  }
  write(item: AuditEntry | DeskArchiveRecord) {
    this.buffer.push(JSON.stringify({ ...item, recordedAt: Date.now() }));
  }
  /** Returns true when the file grew past the rotation size. */
  flush() {
    if (!this.buffer.length) return false;
    appendFileSync(this.path, `${this.buffer.join("\n")}\n`);
    this.buffer = [];
    try {
      return statSync(this.path).size > ARCHIVE_ROTATE_BYTES;
    } catch {
      return false;
    }
  }
}

export interface FloorDeps {
  config: OrderDeskConfig;
  forecaster: Forecaster;
  now: () => number;
  logger: DeskLogger;
}

/**
 * The pinned shared order floor: one continuous FactorySimulation owned by
 * the server, outside the visitor session map (no expiry, no session cap),
 * locked to manual mode, observed by the order desk.
 */
export class OrderFloor {
  sim!: FactorySimulation;
  desk!: OrderDesk;
  readonly port: FloorPort;
  private archive: FloorArchive;
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private stepsDone = 0;
  private origin = 0;
  private lastPersistSimTime = 0;
  private lastPrune = 0;
  private closed = false;
  restoredFrom: "fresh" | "file" | "corrupt-file" = "fresh";
  private readonly updateListeners = new Set<(update: OrderUpdate) => void>();

  constructor(private readonly deps: FloorDeps) {
    mkdirSync(deps.config.dataDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(deps.config.dataDir, 0o700);
    } catch {
      // Best effort on filesystems without POSIX modes.
    }
    this.archive = new FloorArchive(join(deps.config.dataDir, FLOOR_ARCHIVE_FILE));
    const floor = () => this.sim;
    this.port = {
      snapshot: () => floor().snapshot(),
      exportRun: () => floor().exportRun(),
      command: (command) => {
        if (!DESK_COMMANDS.has(command.type)) throw new Error(`The order desk may not issue ${command.type}`);
        return floor().command(command);
      },
      stepSeconds: FLOOR_STEP_SECONDS,
      seed: deps.config.seed,
    };
  }

  private deskOptions() {
    const { config, now, logger, forecaster } = this.deps;
    return {
      floor: this.port,
      now,
      forecaster,
      quoteTtlMs: config.quoteTtlMs,
      deliveryTimeScale: config.deliveryTimeScale,
      record: (record: DeskArchiveRecord) => this.archive.write(record),
      logger,
    };
  }

  private freshSim() {
    return new FactorySimulation(
      { seed: this.deps.config.seed, scenario: this.deps.config.scenario, continuous: true, orderSize: 2, dispatchDwell: 30 },
      FLOOR_SESSION_ID,
    );
  }

  /** Restore from order-floor.json when it parses, otherwise start a fresh floor. Never invents data. */
  open() {
    const path = join(this.deps.config.dataDir, FLOOR_STATE_FILE);
    let restored = false;
    if (existsSync(path)) {
      try {
        const file = JSON.parse(readFileSync(path, "utf8")) as FloorFile;
        if (file?.formatVersion !== 1 || !file.desk || !file.floorCheckpoint) throw new Error("unsupported floor file");
        const sim = FactorySimulation.fromExport(file.floorCheckpoint);
        this.sim = sim;
        this.desk = new OrderDesk(this.deskOptions(), file.desk);
        const failed = this.desk.reconcile(sim.snapshot());
        this.restoredFrom = "file";
        restored = true;
        this.deps.logger.info({ simTime: sim.snapshot().time, failedOnRestore: failed }, "order floor restored");
      } catch (error) {
        const aside = `${path}.corrupt-${Date.now()}`;
        try {
          renameSync(path, aside);
        } catch {
          // If it cannot be moved it will be overwritten by the next persist.
        }
        this.restoredFrom = "corrupt-file";
        this.deps.logger.warn({ reason: error instanceof Error ? error.message.slice(0, 200) : "unknown", setAside: aside }, "order floor file unreadable; starting a fresh floor");
      }
    }
    if (!restored) {
      this.sim = this.freshSim();
      this.desk = new OrderDesk(this.deskOptions());
    }
    this.attach();
    this.sim.command({ id: `floor-start-${Date.now()}`, type: "start" });
    this.lastPersistSimTime = this.sim.snapshot().time;
    this.persist();
    if (!this.deps.config.manualClock) this.startClock();
    return this;
  }

  private attach() {
    this.unsubscribe?.();
    this.archive.begin({ run: this.sim.exportRun(), desk: this.desk.serialize(), seed: this.deps.config.seed, deliveryTimeScale: this.deps.config.deliveryTimeScale });
    this.unsubscribe = this.sim.subscribeEvents((entry) => {
      this.archive.write(entry);
      this.desk.ingest(entry);
    });
    this.desk.onUpdate((update) => {
      this.schedulePersist();
      for (const listener of this.updateListeners) listener(update);
    });
  }

  /** Order updates from whichever desk is current; survives an operator import. */
  onUpdate(listener: (update: OrderUpdate) => void) {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  private startClock() {
    this.origin = this.deps.now();
    this.stepsDone = 0;
    this.timer = setInterval(() => this.onTimer(), STEP_MS);
    this.timer.unref();
  }

  private onTimer() {
    if (this.closed) return;
    const due = Math.floor((this.deps.now() - this.origin) / STEP_MS) - this.stepsDone;
    let steps = due;
    if (steps > MAX_CATCH_UP_STEPS) {
      // A long stall (host sleep) is dropped rather than replayed in one burst.
      this.stepsDone += steps - MAX_CATCH_UP_STEPS;
      steps = MAX_CATCH_UP_STEPS;
    }
    for (let i = 0; i < steps; i++) this.step();
    this.afterSteps();
  }

  private step() {
    this.sim.advance(FLOOR_STEP_SECONDS);
    this.stepsDone++;
    this.desk.advanceClock(this.sim.snapshot().time);
  }

  private afterSteps() {
    if (this.archive.flush()) this.archive.begin({ run: this.sim.exportRun(), desk: this.desk.serialize(), seed: this.deps.config.seed, deliveryTimeScale: this.deps.config.deliveryTimeScale });
    const time = this.sim.snapshot().time;
    if (time - this.lastPersistSimTime >= PERSIST_EVERY_SIM_SECONDS) this.persist();
    if (this.desk.needsReforecast())
      void this.desk.reforecast().catch((error) => this.deps.logger.warn({ reason: String(error).slice(0, 200) }, "order re-forecast failed"));
    const now = this.deps.now();
    if (now - this.lastPrune > 60_000) {
      this.lastPrune = now;
      this.desk.prune();
    }
  }

  /** Manual clock (tests and scenario runner): advance in fixed quanta of real time. */
  advance(realSeconds: number) {
    const steps = Math.round(realSeconds / FLOOR_STEP_SECONDS);
    for (let i = 0; i < steps; i++) this.step();
    this.afterSteps();
  }

  /** Operator command on the shared floor. */
  operatorCommand(command: FactoryCommand): CommandResult {
    if (!OPERATOR_COMMANDS.has(command.type)) return { ok: false, message: `The order floor does not accept ${command.type}.`, revision: this.sim.snapshot().revision };
    if (command.type === "reset" && this.desk.hasActiveAgentOrders())
      return { ok: false, message: "Reset is blocked while agent orders are active.", revision: this.sim.snapshot().revision };
    const result = this.sim.command(command);
    this.archive.flush();
    this.schedulePersist();
    return result;
  }

  carrierControl(action: CarrierAction, orderId: string, unitIndex: number) {
    const changed = this.desk.carrierControl(action, orderId, unitIndex);
    this.archive.flush();
    return changed;
  }

  /** Floor plus desk as one document, so they can never disagree after a crash. */
  exportState(): FloorFile {
    return { formatVersion: 1, writtenAt: new Date(this.deps.now()).toISOString(), desk: this.desk.serialize(), floorCheckpoint: this.sim.exportRun() };
  }

  /** Operator import: validates fully before replacing anything. */
  importState(file: unknown) {
    const value = file as FloorFile;
    if (value?.formatVersion !== 1 || !value.desk || !value.floorCheckpoint) throw new OrderDeskError("VALIDATION_FAILED", "Not an order floor export.");
    let sim: FactorySimulation;
    let desk: OrderDesk;
    try {
      sim = FactorySimulation.fromExport(value.floorCheckpoint);
      if (sim.snapshot().id !== FLOOR_SESSION_ID) throw new Error("not an order floor checkpoint");
      const previous = this.sim;
      this.sim = sim;
      try {
        desk = new OrderDesk(this.deskOptions(), value.desk);
      } catch (error) {
        this.sim = previous;
        throw error;
      }
    } catch (error) {
      throw new OrderDeskError("VALIDATION_FAILED", `Import rejected: ${error instanceof Error ? error.message.slice(0, 160) : "invalid"}`);
    }
    this.desk = desk;
    desk.reconcile(sim.snapshot());
    this.attach();
    sim.command({ id: `floor-start-${Date.now()}`, type: "start" });
    this.persist();
  }

  private schedulePersist() {
    if (this.persistTimer || this.closed) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, this.deps.config.persistDebounceMs);
    this.persistTimer.unref();
  }

  /** Atomic write: temporary file, then rename. */
  persist() {
    const path = join(this.deps.config.dataDir, FLOOR_STATE_FILE);
    const tmp = `${path}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(this.exportState()), { mode: 0o600 });
      renameSync(tmp, path);
      this.lastPersistSimTime = this.sim.snapshot().time;
    } catch (error) {
      this.deps.logger.warn({ reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }, "order floor persist failed");
    }
  }

  /** Kill switch: stop the clock and persist; the floor is not advanced again until re-enabled. */
  stopClock() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  resumeClock() {
    if (!this.timer && !this.deps.config.manualClock && !this.closed) this.startClock();
  }
  get clockRunning() {
    return this.timer !== null;
  }

  close() {
    if (this.closed) return;
    this.stopClock();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.archive.flush();
    this.persist();
    this.closed = true;
    this.unsubscribe?.();
  }
}
