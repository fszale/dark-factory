import { createActor, createMachine, type AnyActorRef } from "xstate";
import { performance } from "node:perf_hooks";
import { ROBOTAXI_RECIPE } from "../../assets/src/design.ts";
import { checkpointSchema } from "./checkpoint.ts";
import {
  commandSchema,
  DEFAULT_CONFIG,
  LINE_IDS,
  LINE_META,
  SCENARIOS,
  type CommandResult,
  type DecisionRecord,
  type DecisionAftermath,
  type DefectClass,
  type FactoryCommand,
  type FactoryConfig,
  type FactoryEvent,
  type FactorySnapshot,
  type LineId,
  type RunExport,
  type StationStatus,
  type ProductionOrder,
} from "../../contracts/src/index.ts";

const STATUSES: StationStatus[] = [
  "idle",
  "loading",
  "processing",
  "unloading",
  "starved",
  "blocked",
  "faulted",
  "maintenance",
  "paused",
];
const controller = createMachine({
  id: "station",
  initial: "idle",
  states: Object.fromEntries(
    STATUSES.map((status) => [
      status,
      {
        on: Object.fromEntries(
          STATUSES.map((next) => [next, { target: next }]),
        ),
      },
    ]),
  ),
});
type Lot = { id: string; amount: number };
type Resume = { status: StationStatus; remaining: number };
const CAPACITY = 60;
const clone = <T>(value: T): T => structuredClone(value);

export type AuditEntry =
  | { kind: "event"; event: FactoryEvent }
  | { kind: "lineage"; lineage: Record<string, unknown> }
  | {
      kind: "command";
      command: FactoryCommand;
      result: CommandResult;
      time: number;
      epoch: number;
    };

/** Authoritative deterministic discrete-event factory. No mesh or provider owns manufacturing state. */
export class FactorySimulation {
  private state: FactorySnapshot;
  private actors: Record<string, AnyActorRef> = {};
  private warehouseLots: Record<LineId, Lot[]> = {
    front: [],
    rear: [],
    battery: [],
    interior: [],
    exterior: [],
  };
  private stationLots: Record<LineId, Lot[]> = {
    front: [],
    rear: [],
    battery: [],
    interior: [],
    exterior: [],
  };
  private streams: Record<string, number> = {};
  private counters: Record<string, number> = {};
  private resumes: Partial<Record<LineId, Resume>> = {};
  private seen = new Map<string, CommandResult>();
  private commandPayloads = new Map<string, FactoryCommand>();
  private nextSample = 0;
  private nextRelease = 0;
  private leadTotal = 0;
  private audit: Record<string, unknown>[] = [];
  private listeners = new Set<(entry: AuditEntry) => void>();
  constructor(config: Partial<FactoryConfig> = {}, id = "local") {
    const cfg = {
      ...clone(DEFAULT_CONFIG),
      ...clone(config),
      profiles: { ...DEFAULT_CONFIG.profiles, ...config.profiles },
      materialPriority: {
        ...DEFAULT_CONFIG.materialPriority!,
        ...config.materialPriority,
      },
    };
    this.validateConfig(cfg);
    const empty = cfg.scenario === "empty";
    const stations = Object.fromEntries(
      LINE_IDS.map((line) => [
        line,
        {
          id: line,
          status: "idle",
          progress: 0,
          phaseStart: 0,
          phaseEnd: 0,
          queue: [],
          current: null,
          stock: empty ? 0 : 4,
          capacity: cfg.bufferCapacity,
          profile: cfg.profiles[line],
          completed: 0,
          rejects: 0,
          reworked: 0,
          scrapped: 0,
          cycles: 0,
          busyTime: 0,
          blockedTime: 0,
          starvedTime: 0,
          downTime: 0,
          pausedTime: 0,
          temperature: 24,
          vibration: 0.1,
          currentAmps: 0,
          fault: null,
          maintenanceUntil: 0,
          offset: 0,
          wear: 0,
        },
      ]),
    ) as unknown as FactorySnapshot["stations"];
    this.state = {
      version: 1,
      id,
      time: 0,
      revision: 0,
      epoch: 0,
      running: false,
      speed: 1,
      mode: "manual",
      config: cfg,
      stations,
      warehouse: {
        front: empty ? 0 : 12,
        rear: empty ? 0 : 12,
        battery: empty ? 0 : 12,
        interior: empty ? 0 : 12,
        exterior: empty ? 0 : 12,
      },
      trucks: [],
      carts: [],
      vehicles: [],
      orders: [],
      events: [],
      samples: [],
      decisions: [],
      metrics: {
        qualityEscapes: 0,
        perfectDetectionAssumption: 1,
        orderedUnits: 0,
        ordersCreated: 0,
        ordersCompleted: 0,
        received: 0,
        initial: empty ? 0 : 80,
        consumed: 0,
        scrap: 0,
        completed: 0,
        dispatched: 0,
        deliveries: 0,
        rejectedDeliveries: 0,
        energy: 0,
        materialCost: empty ? 0 : 80 * 1.4,
        maintenanceCost: 0,
        throughput: 0,
        yield: 100,
        leadTime: 0,
        costPerVehicle: 0,
        dockWait: 0,
        cartTravel: 0,
        cartWait: 0,
        assemblyWait: 0,
        parkingWait: 0,
        inspectionCount: 0,
        inspectionRejects: 0,
        simulationMs: 0,
      },
      faults: {
        supply: cfg.scenario === "shortage",
        congestion: cfg.scenario === "congestion",
        assembly: cfg.scenario === "assembly-outage",
        dispatch: cfg.scenario === "dispatch-blockage",
      },
      providers: { astra: false, jev: false },
      nextDelivery: 0,
    };
    for (const line of LINE_IDS) {
      this.actors[line] = createActor(controller).start();
      if (!empty) {
        this.warehouseLots[line].push({ id: "warm-start", amount: 12 });
        this.stationLots[line].push({ id: "warm-start", amount: 4 });
      }
    }
    if (cfg.scenario === "gripper") this.state.stations.front.wear = 0.85;
    this.event(
      "initialized",
      "factory",
      empty
        ? "Empty factory: awaiting first material delivery."
        : "Warm-start: 80 module kits are explicitly in opening inventory.",
      { config: clone(cfg), initialKitInventory: empty ? 0 : 80 },
    );
    this.createOrder(cfg.orderSize, 3, "showcase");
    this.sample();
  }
  private validateConfig(c: FactoryConfig) {
    if (
      c.materialLoadingCapacity !== undefined &&
      (!Number.isInteger(c.materialLoadingCapacity) ||
        c.materialLoadingCapacity < 1 ||
        c.materialLoadingCapacity > 3)
    )
      throw new Error("Material loading capacity must be 1–3");
    if (
      c.materialPriority &&
      LINE_IDS.some(
        (line) =>
          !Number.isInteger(c.materialPriority![line]) ||
          c.materialPriority![line] < 1 ||
          c.materialPriority![line] > 5,
      )
    )
      throw new Error("Material priorities must be 1–5");
    if (
      !SCENARIOS.includes(c.scenario) ||
      typeof c.continuous !== "boolean" ||
      LINE_IDS.some(
        (line) => !["gentle", "normal", "fast"].includes(c.profiles[line]),
      )
    )
      throw new Error("Invalid production recipe");
    for (const key of [
      "seed",
      "orderSize",
      "reorderPoint",
      "deliverySize",
      "parkingCapacity",
      "bufferCapacity",
    ] as const)
      if (!Number.isInteger(c[key]))
        throw new Error(`${key} must be an integer`);
    for (const k of [
      "seed",
      "orderSize",
      "releaseRate",
      "reorderPoint",
      "deliverySize",
      "deliveryLead",
      "dispatchDwell",
      "parkingCapacity",
      "bufferCapacity",
    ] as const)
      if (!Number.isFinite(c[k])) throw new Error(`Invalid ${k}`);
    if (
      c.parkingCapacity < 1 ||
      c.parkingCapacity > 12 ||
      c.bufferCapacity < 1 ||
      c.bufferCapacity > 8 ||
      c.deliverySize < 1 ||
      c.deliverySize > CAPACITY ||
      c.deliveryLead < 1 ||
      c.orderSize < 1 ||
      c.orderSize > 1000 ||
      c.releaseRate < 0.1 ||
      c.releaseRate > 3 ||
      c.reorderPoint < 1 ||
      c.reorderPoint > 40 ||
      c.dispatchDwell < 5
    )
      throw new Error("Configuration outside supported physical limits");
  }
  /** Streaming archive boundary. Listeners must persist synchronously in order or queue safely. */
  subscribeEvents(
    listener: (entry: AuditEntry) => void,
    options: { replayRetained?: boolean } = {},
  ): () => void {
    this.listeners.add(listener);
    if (options.replayRetained) {
      for (const event of this.state.events)
        this.deliver(listener, { kind: "event", event });
      for (const lineage of this.audit)
        this.deliver(listener, { kind: "lineage", lineage });
    }
    return () => this.listeners.delete(listener);
  }
  private deliver(listener: (entry: AuditEntry) => void, entry: AuditEntry) {
    try {
      listener(clone(entry));
    } catch {
      // Storage failure must be visible without corrupting manufacturing or recursively logging.
      this.state.metrics.archiveErrors =
        (this.state.metrics.archiveErrors || 0) + 1;
    }
  }
  private emit(entry: AuditEntry) {
    for (const listener of this.listeners) this.deliver(listener, entry);
  }
  snapshot(): FactorySnapshot {
    return clone(this.state);
  }
  /** Cheap scheduler metadata; never exposes mutable engine state. */
  status() {
    const s = this.state;
    return { id: s.id, epoch: s.epoch, time: s.time, running: s.running,
      speed: s.speed, mode: s.mode, lastEventId: s.events.at(-1)?.id ?? 0 };
  }
  hasOperationalEventAfter(id: number) {
    return this.state.events.some(event => event.id > id &&
      !["ai-decision", "ai-aftermath"].includes(event.type));
  }
  /** Recent display events only; complete retained charts and export history are unchanged. */
  liveSnapshot(): FactorySnapshot {
    return clone({ ...this.state, events: this.state.events.slice(-200) });
  }

  setProviders(providers: { astra: boolean; jev: boolean }) {
    this.state.providers = { ...providers };
  }
  addDecision(record: DecisionRecord) {
    this.state.decisions.push(clone(record));
    this.state.decisions = this.state.decisions.slice(-200);
    this.state.metrics.aiCalls = (this.state.metrics.aiCalls || 0) + 1;
    this.state.metrics.aiTokens =
      (this.state.metrics.aiTokens || 0) + record.tokens;
    this.state.metrics.aiLatency = record.latency;
    this.event("ai-decision", record.provider, record.summary, {
      status: record.status,
      decision: clone(record),
    });
  }
  updateDecisionAftermath(id: string, aftermath: DecisionAftermath): boolean {
    const decision = this.state.decisions.find((record) => record.id === id);
    if (!decision) return false;
    decision.aftermath = clone(aftermath);
    this.event(
      "ai-aftermath",
      decision.provider,
      "Observed production results recorded after the decision; attribution is not causal.",
      { decisionId: id, aftermath: clone(aftermath) },
    );
    return true;
  }
  private uid(prefix: string) {
    this.counters[prefix] = (this.counters[prefix] || 0) + 1;
    return `${prefix}-${this.counters[prefix]}`;
  }
  private rng(key: string) {
    let seed = this.streams[key];
    if (seed === undefined) {
      seed = this.state.config.seed >>> 0;
      for (const c of key)
        seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
    }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    this.streams[key] = seed;
    return seed / 4294967296;
  }
  private event(
    type: string,
    entity: string,
    message: string,
    data?: Record<string, unknown>,
  ) {
    const id = (this.counters.event || 0) + 1;
    this.counters.event = id;
    this.state.events.push({
      id,
      time: this.state.time,
      type,
      entity,
      message,
      data: { ...data, epoch: this.state.epoch },
    });
    this.emit({
      kind: "event",
      event: this.state.events[this.state.events.length - 1],
    });
    if (this.state.events.length > 2000)
      this.state.events.splice(0, this.state.events.length - 2000);
  }
  private recordDefect(defectClass: DefectClass) {
    const key = `defect_${defectClass.replaceAll("-", "_")}`;
    this.state.metrics[key] = (this.state.metrics[key] || 0) + 1;
  }
  private transition(line: LineId, status: StationStatus, duration = 0) {
    const s = this.state.stations[line];
    this.actors[line].send({ type: status });
    s.status = this.actors[line].getSnapshot().value as StationStatus;
    s.phaseStart = this.state.time;
    s.phaseEnd = this.state.time + duration;
    s.progress = 0;
  }
  private take(lots: Lot[], amount: number): Lot[] {
    const out: Lot[] = [];
    while (amount > 0) {
      const lot = lots[0];
      if (!lot) throw new Error("Material ledger underflow");
      const n = Math.min(amount, lot.amount);
      out.push({ id: lot.id, amount: n });
      lot.amount -= n;
      amount -= n;
      if (lot.amount === 0) lots.shift();
    }
    return out;
  }
  private createOrder(
    quantity: number,
    priority: number,
    source: ProductionOrder["source"],
  ) {
    const w = this.state;
    if (w.orders.length >= 20)
      throw new Error("At most 20 active production orders are allowed");
    const order: ProductionOrder = {
      id: this.uid("order"),
      quantity,
      completed: 0,
      priority,
      status: "queued",
      createdAt: w.time,
      source,
    };
    w.orders.push(order);
    w.metrics.orderedUnits = (w.metrics.orderedUnits || 0) + quantity;
    w.metrics.ordersCreated = (w.metrics.ordersCreated || 0) + 1;
    this.event(
      "order-created",
      order.id,
      `${quantity} robotaxis ordered at priority ${priority}.`,
      { order: clone(order) },
    );
    return order;
  }
  private uncompletedCommitments(orderId: string) {
    return this.state.vehicles.filter(
      (v) => v.orderId === orderId && v.completedAt === null,
    ).length;
  }
  private nextOrder() {
    return this.state.orders
      .filter(
        (o) => o.completed + this.uncompletedCommitments(o.id) < o.quantity,
      )
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      )[0];
  }
  private completeOrderUnit(orderId: string | undefined) {
    const w = this.state,
      order = w.orders.find((o) => o.id === orderId);
    if (!order)
      throw new Error("Completed vehicle has no active production order");
    order.completed++;
    if (order.completed === order.quantity) {
      w.metrics.ordersCompleted = (w.metrics.ordersCompleted || 0) + 1;
      this.event(
        "order-completed",
        order.id,
        `All ${order.quantity} ordered robotaxis passed end-of-line inspection.`,
        {
          order: { ...clone(order), status: "completed", completedAt: w.time },
        },
      );
      w.orders.splice(w.orders.indexOf(order), 1);
    }
  }
  private finiteMet(line: LineId) {
    const s = this.state.stations[line];
    return (
      !this.state.config.continuous &&
      s.completed + (s.current ? 1 : 0) >= this.state.metrics.orderedUnits
    );
  }
  private cycle(line: LineId) {
    const s = this.state.stations[line];
    return (
      LINE_META[line].cycle *
      { gentle: 1.25, normal: 1, fast: 0.78 }[s.profile] *
      (line === "exterior" && this.state.config.scenario === "slow-exterior"
        ? 1.8
        : 1)
    );
  }
  private release() {
    const w = this.state;
    if (
      w.config.continuous &&
      w.orders.length < 20 &&
      !w.orders.some((o) => o.source === "showcase")
    )
      this.createOrder(w.config.orderSize, 3, "showcase");
    for (const line of LINE_IDS) {
      const s = w.stations[line];
      if (
        ["idle", "starved", "blocked"].includes(s.status) &&
        !s.current &&
        !s.fault
      ) {
        if (s.queue.length >= s.capacity) {
          if (s.status !== "blocked") this.transition(line, "blocked");
          continue;
        }
        if (this.finiteMet(line)) {
          if (s.status !== "idle") this.transition(line, "idle");
          continue;
        }
        if (s.stock === 0) {
          if (s.status !== "starved") this.transition(line, "starved");
          continue;
        }
        const lot = this.take(this.stationLots[line], 1)[0];
        s.stock--;
        w.metrics.consumed++;
        s.current = {
          id: this.uid(`module-${line}`),
          line,
          lot: lot.id,
          created: w.time,
          accepted: false,
          rework: 0,
          reworkHistory: [],
        };
        this.transition(line, "loading", 3 / w.config.releaseRate);
        this.event(
          "module-start",
          line,
          `${LINE_META[line].name}: material kit loaded.`,
          { module: s.current.id, lot: lot.id },
        );
      }
    }
    // Dedicated kit destinations compete for a bounded pool of warehouse loaders.
    // A committed cart is never preempted, and materials never change their eligible line.
    const loadingCapacity = w.config.materialLoadingCapacity ?? 2;
    const eligible = LINE_IDS.filter(
      (line) =>
        w.stations[line].status !== "paused" &&
        w.stations[line].stock <= 2 &&
        !w.carts.some((cart) => cart.line === line) &&
        w.warehouse[line] > 0 &&
        !this.finiteMet(line),
    ).sort(
      (a, b) =>
        (w.config.materialPriority?.[a] ?? 3) -
          (w.config.materialPriority?.[b] ?? 3) ||
        LINE_IDS.indexOf(a) - LINE_IDS.indexOf(b),
    );
    for (const line of eligible) {
      if (
        w.carts.filter((cart) => cart.phase === "loading").length >=
        loadingCapacity
      )
        break;
      const station = w.stations[line],
        lot = this.warehouseLots[line][0];
      const amount = Math.min(5, lot.amount, 8 - station.stock);
      if (amount > 0) {
        this.take(this.warehouseLots[line], amount);
        w.warehouse[line] -= amount;
        const id = this.uid("cart");
        w.carts.push({
          id,
          line,
          phase: "loading",
          start: w.time,
          end: w.time + 3,
          amount,
          lot: lot.id,
          charge: 100,
        });
        this.event(
          "kit-pick",
          line,
          `Warehouse loader allocated ${amount} kits to ${line}.`,
          {
            cart: id,
            lot: lot.id,
            amount,
            priority: w.config.materialPriority?.[line] ?? 3,
            policy: "material-priority-then-line-order",
            loadingCapacity,
            destination: line,
          },
        );
      }
    }
    // Single receiving dock and one in-flight shipment; each bin has a hard capacity.
    if (
      w.time >= w.nextDelivery &&
      w.trucks.length === 0 &&
      LINE_IDS.some((l) => w.warehouse[l] <= w.config.reorderPoint) &&
      !this.allOrdersMet()
    ) {
      const amount = Object.fromEntries(
        LINE_IDS.map((l) => [
          l,
          Math.min(w.config.deliverySize, CAPACITY - w.warehouse[l]),
        ]),
      ) as Record<LineId, number>;
      if (Object.values(amount).some((v) => v > 0)) {
        const lot = this.uid("lot");
        w.trucks.push({
          id: this.uid("truck"),
          inspection: "pending",
          phase: "approach",
          start: w.time,
          end: w.time + w.config.deliveryLead,
          amount,
          lot,
        });
        w.nextDelivery = w.time + w.config.deliveryLead + 30;
        this.event(
          "shipment-dispatched",
          lot,
          "Supplier dispatched a replenishment truck.",
          { amount },
        );
      }
    }
    const order = this.nextOrder();
    if (
      order &&
      !w.faults.assembly &&
      !w.vehicles.some((v) => v.phase === "joining" || v.phase === "testing") &&
      w.vehicles.length < w.config.parkingCapacity &&
      w.time >= this.nextRelease &&
      ROBOTAXI_RECIPE.modules.every(
        ({ line, kits }) => w.stations[line].queue.length >= kits,
      )
    ) {
      const modules = ROBOTAXI_RECIPE.joiningOrder.flatMap((line) =>
        Array.from(
          {
            length: ROBOTAXI_RECIPE.modules.find((m) => m.line === line)!.kits,
          },
          () => w.stations[line].queue.shift()!,
        ),
      );
      order.status = "in-progress";
      if (!modules.every((m) => m.accepted))
        throw new Error("Uninspected module cannot enter final assembly");
      const used = new Set(w.vehicles.map((v) => v.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const vehicle = {
        id: this.uid("taxi"),
        orderId: order.id,
        phase: "joining" as const,
        start: w.time,
        end: w.time + 24,
        slot,
        modules,
        created: Math.min(...modules.map((m) => m.created)),
        completedAt: null,
        quality: "pending" as const,
      };
      w.vehicles.push(vehicle);
      this.nextRelease = w.time + 8 / w.config.releaseRate;
      this.event(
        "assembly-start",
        vehicle.id,
        "Five accepted modules atomically reserved for joining.",
        {
          modules: modules.map((m) => m.id),
          lots: modules.map((m) => m.lot),
          orderId: order.id,
          priority: order.priority,
          recipe: ROBOTAXI_RECIPE.id,
          joiningOrder: ROBOTAXI_RECIPE.joiningOrder,
        },
      );
    }
  }
  private canReserveRoad(vehicleId: string): boolean {
    const w = this.state;
    if (
      w.vehicles.some((vehicle) =>
        ["outbound", "parking", "dispatching"].includes(vehicle.phase),
      )
    )
      return false;
    const waiting = w.vehicles
      .filter(
        (vehicle) =>
          vehicle.end <= w.time + 1e-8 &&
          ((vehicle.phase === "testing" &&
            vehicle.quality === "passed" &&
            !w.faults.assembly) ||
            (vehicle.phase === "parked" && !w.faults.dispatch)),
      )
      .sort(
        (a, b) =>
          a.end - b.end || a.created - b.created || a.id.localeCompare(b.id),
      );
    return waiting[0]?.id === vehicleId;
  }
  private reserveRoad(vehicleId: string, direction: "parking" | "dispatch") {
    this.state.metrics.roadReservations =
      (this.state.metrics.roadReservations || 0) + 1;
    this.event(
      "road-reserved",
      vehicleId,
      `Exclusive shared road reserved for ${direction}.`,
      { resource: "outbound-road", direction },
    );
  }
  private allOrdersMet() {
    return (
      !this.state.config.continuous && LINE_IDS.every((l) => this.finiteMet(l))
    );
  }
  private deadlines() {
    const w = this.state;
    const times = [this.nextSample, w.nextDelivery];
    for (const s of Object.values(w.stations)) {
      if (
        ["loading", "processing", "unloading", "maintenance"].includes(s.status)
      )
        times.push(s.phaseEnd);
    }
    for (const t of w.trucks)
      if (t.phase !== "waiting" || !w.faults.supply) times.push(t.end);
    for (const c of w.carts) times.push(c.end);
    for (const v of w.vehicles)
      if (
        !(v.phase === "parked" && w.faults.dispatch) &&
        !(["joining", "testing"].includes(v.phase) && w.faults.assembly)
      )
        times.push(v.end);
    return times.filter((t) => t > w.time + 1e-8);
  }
  private accrue(dt: number) {
    const w = this.state;
    const m = w.metrics;
    // A joining outage freezes the committed operation's remaining duration.
    // Keeping timestamps relative to simulation time also freezes its visual progress.
    if (w.faults.assembly)
      for (const vehicle of w.vehicles) {
        if (
          vehicle.phase === "joining" ||
          (vehicle.phase === "testing" && vehicle.quality !== "passed")
        ) {
          vehicle.start += dt;
          vehicle.end += dt;
        }
      }
    for (const s of Object.values(w.stations)) {
      if (s.status === "paused") {
        s.pausedTime = (s.pausedTime || 0) + dt;
        s.phaseStart += dt;
        s.phaseEnd += dt;
        if (s.pause?.previousStatus === "maintenance") s.maintenanceUntil += dt;
      }
      const busy = ["loading", "processing", "unloading"].includes(s.status);
      if (busy) s.busyTime += dt;
      if (s.status === "blocked") s.blockedTime += dt;
      if (s.status === "starved") s.starvedTime += dt;
      if (["faulted", "maintenance"].includes(s.status)) s.downTime += dt;
      s.currentAmps = busy ? 1.5 + (s.profile === "fast" ? 1 : 0) : 0.12;
      s.temperature +=
        ((busy ? 36 + s.wear * 12 : 23) - s.temperature) *
        (1 - Math.exp(-dt / 60));
      s.vibration =
        (busy ? 0.14 + s.wear * 0.8 : 0.025) +
        Math.sin((w.time + dt) * 0.13 + LINE_IDS.indexOf(s.id)) * 0.01;
      m.energy += (s.currentAmps * 24 * dt) / 3600000;
      if (busy)
        s.progress = Math.min(
          1,
          Math.max(
            0,
            (w.time + dt - s.phaseStart) / (s.phaseEnd - s.phaseStart || 1),
          ),
        );
    }
    m.cartTravel +=
      w.carts.filter((c) => c.phase === "outbound" || c.phase === "returning")
        .length * dt;
    m.cartWait += w.faults.congestion
      ? w.carts.filter((c) => c.phase === "outbound").length * dt
      : 0;
    m.dockWait += w.trucks.filter((t) => t.phase === "waiting").length * dt;
    m.sortingTime =
      (m.sortingTime || 0) +
      w.trucks.filter((t) => t.phase === "sorting").length * dt;
    m.energy +=
      (w.trucks.filter((t) => t.phase === "sorting").length * 0.12 * dt) / 3600;
    if (
      !w.vehicles.some(
        (v) =>
          v.phase === "joining" ||
          (v.phase === "testing" && v.quality !== "passed"),
      )
    )
      m.assemblyWait += dt;
    if (w.vehicles.length >= w.config.parkingCapacity) m.parkingWait += dt;
    const waitingRoad = w.vehicles.filter(
      (vehicle) =>
        vehicle.end <= w.time + 1e-8 &&
        ((vehicle.phase === "testing" && vehicle.quality === "passed") ||
          (vehicle.phase === "parked" && !w.faults.dispatch)),
    ).length;
    m.roadWait = (m.roadWait || 0) + waitingRoad * dt;
    m.energy +=
      ((w.carts.length * 0.08 +
        w.vehicles.filter((v) => ["joining", "testing"].includes(v.phase))
          .length *
          0.2) *
        dt) /
      3600;
  }
  private processEvents() {
    const w = this.state;
    for (const t of [...w.trucks])
      if (t.end <= w.time + 1e-8) {
        if (t.phase === "approach" || t.phase === "waiting") {
          if (w.faults.supply) {
            if (t.phase !== "waiting") {
              t.phase = "waiting";
              t.start = w.time;
              t.end = w.time;
              this.event(
                "supply-hold",
                t.id,
                "Delivery held at receiving gate.",
              );
            }
          } else {
            t.phase = "unloading";
            t.start = w.time;
            t.end = w.time + 10;
            this.event(
              "dock-start",
              t.id,
              "Dock reserved; unloading and receiving inspection.",
            );
          }
        } else if (t.phase === "unloading") {
          const amount = Object.values(t.amount).reduce((a, b) => a + b, 0);
          w.metrics.receivingInspectionCount =
            (w.metrics.receivingInspectionCount || 0) + 1;
          // Inspection and sorting precede inventory acceptance; the truck remains custodian throughout.
          if (this.rng("quality:receiving") < 0.02) {
            t.inspection = "rejected";
            w.metrics.rejectedDeliveries++;
            this.recordDefect("incoming-kit-damage");
            w.metrics.rejectedIncomingKits =
              (w.metrics.rejectedIncomingKits || 0) + amount;
            this.event(
              "shipment-rejected",
              t.id,
              "Receiving inspection rejected this lot; cargo is returning to supplier.",
              {
                lot: t.lot,
                amount: t.amount,
                reason: "Damaged or incompatible kit detected",
                defectClass: "incoming-kit-damage",
                replacement: true,
              },
            );
            w.nextDelivery = Math.min(w.nextDelivery, w.time + 15);
            t.phase = "departing";
            t.start = w.time;
            t.end = w.time + 15;
          } else {
            t.inspection = "accepted";
            w.metrics.receivingInspectionPasses =
              (w.metrics.receivingInspectionPasses || 0) + 1;
            this.event(
              "receiving-inspection-passed",
              t.id,
              "Receiving inspection passed; material is not yet available to production.",
              { lot: t.lot, amount: t.amount },
            );
            t.phase = "sorting";
            t.start = w.time;
            t.end = w.time + 14;
            this.event(
              "sorting-start",
              t.id,
              "Five kit families are being sorted and routed to their dedicated storage racks.",
              { lot: t.lot, amount: t.amount, duration: 14, custodian: t.id },
            );
          }
        } else if (t.phase === "sorting") {
          for (const line of LINE_IDS) {
            w.warehouse[line] += t.amount[line];
            if (t.amount[line] > 0)
              this.warehouseLots[line].push({
                id: t.lot,
                amount: t.amount[line],
              });
            w.metrics.received += t.amount[line];
            w.metrics.materialCost += t.amount[line] * 1.4;
          }
          w.metrics.deliveries++;
          w.metrics.sortedDeliveries = (w.metrics.sortedDeliveries || 0) + 1;
          this.event(
            "shipment-received",
            t.id,
            "Sorting complete; all five material families accepted into their warehouse racks.",
            { lot: t.lot, amount: t.amount, from: t.id, to: "warehouse" },
          );
          t.phase = "departing";
          t.start = w.time;
          t.end = w.time + 15;
        } else {
          const returned = t.inspection === "rejected";
          if (returned)
            w.metrics.supplierReturnKits =
              (w.metrics.supplierReturnKits || 0) +
              Object.values(t.amount).reduce((a, b) => a + b, 0);
          w.trucks.splice(w.trucks.indexOf(t), 1);
          this.event(
            "truck-departed",
            t.id,
            returned
              ? "Rejected lot crossed supplier return boundary."
              : "Empty truck crossed supplier exit boundary.",
            {
              lot: t.lot,
              inspection: t.inspection || "accepted",
              returnedKits: returned
                ? Object.values(t.amount).reduce((a, b) => a + b, 0)
                : 0,
            },
          );
        }
      }
    for (const c of [...w.carts])
      if (c.end <= w.time + 1e-8) {
        if (c.phase === "loading") {
          c.phase = "outbound";
          c.start = w.time;
          c.end =
            w.time + (w.faults.congestion ? 30 : 8) + LINE_IDS.indexOf(c.line);
          c.charge = 98;
        } else if (c.phase === "outbound") {
          c.phase = "unloading";
          c.start = w.time;
          c.end = w.time + 3;
          c.charge = 94;
        } else if (c.phase === "unloading") {
          w.stations[c.line].stock += c.amount;
          this.stationLots[c.line].push({ id: c.lot, amount: c.amount });
          this.event(
            "kit-delivered",
            c.line,
            `${c.amount} kits delivered to line-side storage.`,
            { cart: c.id, lot: c.lot },
          );
          c.amount = 0;
          c.phase = "returning";
          c.start = w.time;
          c.end = w.time + 8;
          c.charge = 92;
        } else w.carts.splice(w.carts.indexOf(c), 1);
      }
    for (const line of LINE_IDS) {
      const s = w.stations[line];
      if (s.phaseEnd > w.time + 1e-8) continue;
      if (s.status === "maintenance") {
        s.wear = 0.05;
        s.fault = null;
        const resume = this.resumes[line];
        delete this.resumes[line];
        if (s.current && resume)
          this.transition(line, resume.status, resume.remaining);
        else this.transition(line, "idle");
        this.event(
          "maintenance-complete",
          line,
          "Equipment service complete; work safely resumed.",
        );
      } else if (s.status === "loading")
        this.transition(line, "processing", this.cycle(line));
      else if (s.status === "processing" && s.current) {
        s.cycles++;
        s.wear = Math.min(1, s.wear + (s.profile === "fast" ? 0.025 : 0.01));
        w.metrics.inspectionCount++;
        if (s.current.rework === 0)
          w.metrics.firstInspections = (w.metrics.firstInspections || 0) + 1;
        const bad =
          this.rng(`quality:${line}`) <
          (s.profile === "gentle"
            ? 0.008
            : s.profile === "fast"
              ? 0.055
              : 0.022) +
            Math.max(0, s.wear - 0.6) * 0.12;
        const defectClass: DefectClass = (
          {
            front: "axle-alignment",
            rear: "drive-fit",
            battery: "floor-connection",
            interior: "seat-fit",
            exterior: "panel-alignment",
          } as const
        )[line];
        (s.current.reworkHistory ??= []).push({
          time: w.time,
          event: bad ? "inspection-rejected" : "inspection-passed",
          ...(bad ? { defectClass } : {}),
          attempt: s.current.rework,
        });
        if (bad) {
          this.recordDefect(defectClass);
          if (s.current.rework === 0)
            w.metrics.firstRejects = (w.metrics.firstRejects || 0) + 1;
          s.rejects++;
          w.metrics.inspectionRejects++;
          this.event(
            "inspection-reject",
            line,
            "Inspection rejected module; isolated from accepted queue.",
            { module: s.current.id, rework: s.current.rework, defectClass },
          );
          if (s.current.rework === 0) {
            s.current.rework = 1;
            s.current.reworkHistory!.push({
              time: w.time,
              event: "rework-started",
              defectClass,
              attempt: 1,
            });
            s.reworked++;
            this.transition(line, "processing", this.cycle(line) * 0.65);
          } else {
            s.scrapped++;
            w.metrics.scrap++;
            s.current.reworkHistory!.push({
              time: w.time,
              event: "scrapped",
              defectClass,
              attempt: 1,
            });
            this.event(
              "module-scrapped",
              line,
              "Failed rework scrapped; a replacement kit will be consumed.",
              {
                module: s.current.id,
                lot: s.current.lot,
                reworkHistory: clone(s.current.reworkHistory),
              },
            );
            s.current = null;
            this.transition(line, "idle");
          }
        } else {
          s.current.accepted = true;
          this.transition(line, "unloading", 4);
        }
      } else if (s.status === "unloading" && s.current) {
        if (s.queue.length < s.capacity) {
          s.queue.push(s.current);
          s.completed++;
          this.event(
            "module-accepted",
            line,
            "Inspected component transferred to final-assembly buffer.",
            {
              module: s.current.id,
              reworkHistory: clone(s.current.reworkHistory || []),
            },
          );
          s.current = null;
          this.transition(line, "idle");
        } else this.transition(line, "blocked");
      } else if (
        s.status === "blocked" &&
        s.current &&
        s.queue.length < s.capacity
      ) {
        this.transition(line, "unloading", 1);
      }
    }
    for (const v of [...w.vehicles])
      if (v.end <= w.time + 1e-8) {
        if (v.phase === "joining") {
          if (w.faults.assembly) continue;
          v.phase = "testing";
          v.start = w.time;
          v.end = w.time + 8;
          this.event(
            "assembly-joined",
            v.id,
            "Front, rear, floor, interior and exterior joined.",
          );
        } else if (v.phase === "testing") {
          if (w.faults.assembly) continue;
          if (v.quality !== "passed") {
            w.metrics.inspectionCount++;
            if (v.quality === "pending" && this.rng("quality:final") < 0.025) {
              v.quality = "rework";
              v.start = w.time;
              v.end = w.time + 12;
              w.metrics.inspectionRejects++;
              this.recordDefect("door-operation");
              this.event(
                "vehicle-rework",
                v.id,
                "End-of-line check requires adjustment; dispatch held.",
                {
                  defectClass: "door-operation",
                  inspectionStage: "end-of-line",
                },
              );
              continue;
            }
            v.quality = "passed";
            v.completedAt = w.time;
            w.metrics.completed++;
            this.completeOrderUnit(v.orderId);
            this.leadTotal += w.time - v.created;
            this.event(
              "vehicle-complete",
              v.id,
              "Vehicle passed end-of-line checks; awaiting its exclusive road reservation.",
              { orderId: v.orderId },
            );
          }
          // A passed vehicle stays at the test exit until both directions of the shared road are clear.
          if (this.canReserveRoad(v.id)) {
            this.reserveRoad(v.id, "parking");
            v.phase = "outbound";
            v.start = w.time;
            v.end = w.time + 12;
          }
        } else if (v.phase === "outbound") {
          v.phase = "parking";
          v.start = w.time;
          v.end = w.time + 7 + v.slot * 0.4;
          this.event(
            "parking-route",
            v.id,
            `Following reserved route into parking bay ${v.slot + 1}.`,
          );
        } else if (v.phase === "parking") {
          this.event(
            "road-released",
            v.id,
            "Vehicle parked clear of the shared road.",
            { resource: "outbound-road" },
          );
          v.phase = "parked";
          v.start = w.time;
          v.end = w.time + w.config.dispatchDwell;
          this.event(
            "vehicle-parked",
            v.id,
            `Parked in reserved bay ${v.slot + 1}.`,
          );
        } else if (v.phase === "parked") {
          if (w.faults.dispatch || !this.canReserveRoad(v.id)) continue;
          this.reserveRoad(v.id, "dispatch");
          v.phase = "dispatching";
          v.start = w.time;
          v.end = w.time + 18;
          this.event(
            "dispatch-start",
            v.id,
            "Customer dispatch released; driving to exit.",
          );
        } else {
          this.event(
            "road-released",
            v.id,
            "Dispatched vehicle crossed the shared-road exit boundary.",
            { resource: "outbound-road" },
          );
          w.metrics.dispatched++;
          this.audit.push({
            id: v.id,
            orderId: v.orderId,
            created: v.created,
            completedAt: v.completedAt,
            dispatchedAt: w.time,
            modules: v.modules,
          });
          this.emit({
            kind: "lineage",
            lineage: this.audit[this.audit.length - 1],
          });
          this.audit = this.audit.slice(-200);
          w.vehicles.splice(w.vehicles.indexOf(v), 1);
          this.event(
            "vehicle-dispatched",
            v.id,
            "Finished robotaxi crossed customer exit boundary.",
          );
        }
      }
  }
  private sample() {
    const w = this.state,
      m = w.metrics;
    m.throughput = w.time > 0 ? (m.completed * 3600) / w.time : 0;
    m.yield = m.inspectionCount
      ? (100 * (m.inspectionCount - m.inspectionRejects)) / m.inspectionCount
      : 100;
    m.leadTime = m.completed ? this.leadTotal / m.completed : 0;
    m.costPerVehicle = m.completed
      ? (m.materialCost + m.energy * 0.18 + m.maintenanceCost) / m.completed
      : 0;
    m.warehouseOccupancy = Object.values(w.warehouse).reduce(
      (a, b) => a + b,
      0,
    );
    m.parkingOccupancy = w.vehicles.filter((v) => v.phase === "parked").length;
    m.wip =
      Object.values(w.stations).reduce(
        (a, s) => a + s.queue.length + (s.current ? 1 : 0),
        0,
      ) +
      w.vehicles.filter(
        (v) =>
          v.phase === "joining" ||
          (v.phase === "testing" && v.quality !== "passed"),
      ).length *
        5;
    m.stationStock = Object.values(w.stations).reduce((a, s) => a + s.stock, 0);
    m.materialInTransit = w.carts.reduce((a, c) => a + c.amount, 0);
    m.firstPassYield = m.firstInspections
      ? 100 * (1 - (m.firstRejects || 0) / m.firstInspections)
      : 100;
    m.reworkCount = Object.values(w.stations).reduce(
      (sum, s) => sum + s.reworked,
      0,
    );
    m.reworkSuccessRate = m.reworkCount
      ? (100 * (m.reworkCount - m.scrap)) / m.reworkCount
      : 100;
    m.warehouseCapacity = CAPACITY * LINE_IDS.length;
    m.parkingCapacity = w.config.parkingCapacity;
    m.roadOccupancy = w.vehicles.filter((vehicle) =>
      ["outbound", "parking", "dispatching"].includes(vehicle.phase),
    ).length;
    m.roadQueue = w.vehicles.filter(
      (vehicle) =>
        vehicle.end <= w.time + 1e-8 &&
        ((vehicle.phase === "testing" && vehicle.quality === "passed") ||
          (vehicle.phase === "parked" && !w.faults.dispatch)),
    ).length;
    m.dockQueue = w.trucks.filter((t) => t.phase === "waiting").length;
    m.dockUtilization = w.trucks.some(
      (t) => t.phase === "unloading" || t.phase === "sorting",
    )
      ? 100
      : 0;
    m.sortingUtilization = w.trucks.some((t) => t.phase === "sorting")
      ? 100
      : 0;
    m.sortingKits = w.trucks
      .filter((t) => t.phase === "sorting")
      .reduce(
        (sum, t) => sum + Object.values(t.amount).reduce((a, b) => a + b, 0),
        0,
      );
    m.cartUtilization = (100 * w.carts.length) / LINE_IDS.length;
    m.materialLoadingCapacity = w.config.materialLoadingCapacity ?? 2;
    m.materialLoadersBusy = w.carts.filter(
      (cart) => cart.phase === "loading",
    ).length;
    m.materialLoaderUtilization =
      (100 * m.materialLoadersBusy) / m.materialLoadingCapacity;
    m.materialLoaderQueue = LINE_IDS.filter(
      (line) =>
        w.stations[line].status !== "paused" &&
        w.stations[line].stock <= 2 &&
        !w.carts.some((cart) => cart.line === line) &&
        w.warehouse[line] > 0 &&
        !this.finiteMet(line),
    ).length;
    m.cartCharge = w.carts.length
      ? w.carts.reduce((sum, c) => sum + c.charge, 0) / w.carts.length
      : 100;
    m.finishedStock = w.vehicles.filter((v) => v.completedAt !== null).length;
    m.committedParking = w.vehicles.length;
    m.inboundKits = w.trucks
      .filter((t) =>
        ["approach", "waiting", "unloading", "sorting"].includes(t.phase),
      )
      .reduce(
        (sum, t) => sum + Object.values(t.amount).reduce((a, b) => a + b, 0),
        0,
      );
    m.rejectedCargoInTransit = w.trucks
      .filter((t) => t.inspection === "rejected")
      .reduce(
        (sum, t) => sum + Object.values(t.amount).reduce((a, b) => a + b, 0),
        0,
      );
    m.receivingConservationDelta =
      (m.rejectedIncomingKits || 0) -
      (m.supplierReturnKits || 0) -
      m.rejectedCargoInTransit;
    m.operatorPausedTime = Object.values(w.stations).reduce(
      (sum, s) => sum + (s.pausedTime || 0),
      0,
    );
    m.downtime = Object.values(w.stations).reduce(
      (sum, s) => sum + s.downTime,
      0,
    );
    m.blockedTime = Object.values(w.stations).reduce(
      (sum, s) => sum + s.blockedTime,
      0,
    );
    m.starvedTime = Object.values(w.stations).reduce(
      (sum, s) => sum + s.starvedTime,
      0,
    );
    for (const s of Object.values(w.stations)) {
      m[`${s.id}Utilization`] = w.time ? (100 * s.busyTime) / w.time : 0;
      m[`${s.id}Queue`] = s.queue.length;
      m[`${s.id}Stock`] = s.stock;
      m[`${s.id}Temperature`] = s.temperature;
      m[`${s.id}Vibration`] = s.vibration;
    }
    m.conservationDelta =
      m.initial +
      m.received -
      m.consumed -
      m.warehouseOccupancy -
      m.stationStock -
      m.materialInTransit;
    w.samples.push({
      time: w.time,
      completed: m.completed,
      throughput: m.throughput,
      wip: m.wip,
      yield: m.yield,
      stock: m.warehouseOccupancy + m.stationStock,
      parked: m.parkingOccupancy,
      energy: m.energy,
      cost: m.costPerVehicle,
      blocked: Object.values(w.stations).filter((s) => s.status === "blocked")
        .length,
    });
    w.samples = w.samples.slice(-720);
    this.nextSample = w.time + 5;
  }
  private runUntil(target: number) {
    let iterations = 0;
    while (this.state.time < target - 1e-8) {
      if (++iterations > 200000) throw new Error("Simulation event limit");
      this.release();
      const next = Math.min(target, ...this.deadlines());
      const dt = next - this.state.time;
      this.accrue(dt);
      this.state.time = next;
      this.processEvents();
      this.release();
      if (this.nextSample <= this.state.time + 1e-8) this.sample();
    }
    // Revision tracks accepted operator/AI control changes, not clock motion.
    // Live material/capacity predicates are still revalidated by every command.
  }
  advance(realSeconds: number) {
    if (
      !this.state.running ||
      !Number.isFinite(realSeconds) ||
      realSeconds <= 0
    )
      return;
    const begin = performance.now();
    this.runUntil(
      this.state.time + Math.min(realSeconds, 7200) * this.state.speed,
    );
    this.state.metrics.simulationMs = performance.now() - begin;
  }
  step() {
    this.release();
    const next = Math.min(...this.deadlines());
    this.runUntil(Number.isFinite(next) ? next : this.state.time + 1);
  }
  command(input: FactoryCommand): CommandResult {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        message: "Invalid command payload",
        revision: this.state.revision,
      };
    const c = parsed.data;
    const requestedAt = this.state.time;
    const requestedEpoch = this.state.epoch;
    const previous = this.seen.get(c.id);
    if (previous) {
      const payload = this.commandPayloads.get(c.id);
      const result =
        payload && JSON.stringify(payload) !== JSON.stringify(c)
          ? {
              ok: false,
              message: "Command id was already used for a different command.",
              revision: this.state.revision,
            }
          : previous;
      this.emit({
        kind: "command",
        command: c,
        result,
        time: requestedAt,
        epoch: requestedEpoch,
      });
      return clone(result);
    }
    let message = "Applied";
    let ok = true;
    try {
      if (c.epoch !== undefined && c.epoch !== this.state.epoch)
        throw new Error("Stale factory epoch");
      if (c.revision !== undefined && c.revision !== this.state.revision)
        throw new Error("Stale state revision");
      const w = this.state;
      const s = c.station ? w.stations[c.station] : undefined;
      switch (c.type) {
        case "start":
          if (s) {
            if (s.status !== "paused" || !s.pause)
              throw new Error("Station is not operator-paused");
            const previous = s.pause.previousStatus;
            this.actors[s.id].send({ type: previous });
            s.status = previous;
            delete s.pause;
            this.event(
              "station-resumed",
              s.id,
              "Station resumed with its remaining operation preserved.",
              {
                status: previous,
                module: s.current?.id,
                remaining: Math.max(0, s.phaseEnd - w.time),
              },
            );
            message = `${s.id} station resumed`;
            break;
          }
          w.running = true;
          message = "Production running";
          break;
        case "pause":
          if (s) {
            if (s.status === "paused")
              throw new Error("Station is already operator-paused");
            s.pause = { previousStatus: s.status, since: w.time };
            this.actors[s.id].send({ type: "paused" });
            s.status = "paused";
            w.epoch++;
            this.event(
              "station-paused",
              s.id,
              "Station held; material ownership and remaining work preserved.",
              {
                status: s.pause.previousStatus,
                module: s.current?.id,
                remaining: Math.max(0, s.phaseEnd - w.time),
              },
            );
            message = `${s.id} station paused`;
            break;
          }
          w.running = false;
          w.epoch++;
          message = "Production paused";
          break;
        case "step":
          this.step();
          break;
        case "speed":
          if (![1, 2, 5, 10].includes(Number(c.value)))
            throw new Error("Unsupported speed");
          w.speed = Number(c.value);
          break;
        case "mode":
          if (!["manual", "advisory", "autonomous"].includes(String(c.value)))
            throw new Error("Invalid control mode");
          w.mode = c.value as FactorySnapshot["mode"];
          w.epoch++;
          break;
        case "reset": {
          const replacement = new FactorySimulation(
            { ...w.config, scenario: c.scenario || w.config.scenario },
            w.id,
          );
          const epoch = w.epoch + 1;
          const providers = w.providers;
          const listeners = this.listeners;
          for (const actor of Object.values(this.actors)) actor.stop();
          Object.assign(this, replacement);
          this.state.epoch = epoch;
          this.state.providers = providers;
          this.listeners = listeners;
          this.event(
            "reset",
            "factory",
            "New simulation epoch; material ledger reinitialized.",
            { config: clone(this.state.config) },
          );
          message = "Factory reset";
          break;
        }
        case "fault":
          if (s?.status === "paused")
            throw new Error("Resume the station before injecting a fault");
          if (s && c.station) {
            if (s.status === "maintenance")
              throw new Error("Station already in maintenance");
            if (!s.fault)
              this.resumes[c.station] = {
                status: s.status,
                remaining: Math.max(0, s.phaseEnd - w.time),
              };
            s.fault = String(c.value || "gripper fault");
            this.transition(c.station, "faulted");
            this.event("station-fault", c.station, s.fault);
          } else {
            const key = String(c.value) as keyof typeof w.faults;
            if (!(key in w.faults)) throw new Error("Unknown fault");
            w.faults[key] = true;
            this.event("site-fault", key, `${key} disruption active.`);
          }
          break;
        case "repair":
          if (s?.status === "paused")
            throw new Error("Resume the station before scheduling maintenance");
          if (s && c.station) {
            if (s.status === "maintenance")
              throw new Error("Maintenance already scheduled");
            if (!s.fault)
              this.resumes[c.station] = {
                status: s.status,
                remaining: Math.max(0, s.phaseEnd - w.time),
              };
            s.maintenanceUntil = w.time + 20;
            this.transition(c.station, "maintenance", 20);
            w.metrics.maintenanceCost += 3;
            this.event(
              "maintenance-start",
              c.station,
              "Maintenance scheduled; station held for 20 simulated seconds.",
            );
          } else {
            w.faults = {
              supply: false,
              congestion: false,
              assembly: false,
              dispatch: false,
            };
            this.processEvents();
            this.event("site-repaired", "factory", "Site disruptions cleared.");
          }
          break;
        case "profile":
          if (!s || !["gentle", "normal", "fast"].includes(String(c.value)))
            throw new Error("Select station and valid operating profile");
          s.profile = c.value as typeof s.profile;
          w.config.profiles[s.id] = s.profile;
          break;
        case "order-create": {
          const match =
            typeof c.value === "string" && /^(\d+):([1-5])$/.exec(c.value);
          if (!match || Number(match[1]) < 1 || Number(match[1]) > 1000)
            throw new Error(
              "Use quantity:priority, with 1–1000 units and priority 1–5",
            );
          if (c.station)
            throw new Error("Production orders do not select a station");
          const order = this.createOrder(
            Number(match[1]),
            Number(match[2]),
            "manual",
          );
          message = `Created ${order.id}`;
          break;
        }
        case "order-priority": {
          const match =
            typeof c.value === "string" && /^([^:]+):([1-5])$/.exec(c.value);
          const order = match && w.orders.find((o) => o.id === match[1]);
          if (!order || c.station)
            throw new Error(
              "Select an active order with order-id:priority (1–5)",
            );
          order.priority = Number(match[2]);
          this.event(
            "order-priority-changed",
            order.id,
            `Order priority changed to ${order.priority}; committed assembly is unchanged.`,
            { priority: order.priority },
          );
          break;
        }
        case "priority":
          if (
            !s ||
            !Number.isInteger(c.value) ||
            Number(c.value) < 1 ||
            Number(c.value) > 5
          )
            throw new Error("Select a station and material priority 1–5");
          w.config.materialPriority = {
            front: 3,
            rear: 3,
            battery: 3,
            interior: 3,
            exterior: 3,
            ...w.config.materialPriority,
            [s.id]: Number(c.value),
          };
          this.event(
            "material-priority-changed",
            s.id,
            `Material allocation priority changed to ${c.value} (1 is highest).`,
            { priority: c.value, policy: "material-priority-then-line-order" },
          );
          break;
        case "buffer":
          if (
            !s ||
            !Number.isInteger(c.value) ||
            Number(c.value) < 1 ||
            Number(c.value) > 8
          )
            throw new Error("Buffer capacity must be 1–8");
          if (Number(c.value) < s.queue.length)
            throw new Error("Cannot shrink below occupied capacity");
          s.capacity = Number(c.value);
          break;
        case "layout":
          if (w.running) throw new Error("Pause before editing station layout");
          if (!s || ![-1, 0, 1].includes(Number(c.value)))
            throw new Error("Select a valid reserved station pad");
          s.offset = Number(c.value);
          break;
        case "config": {
          const [key, raw] = String(c.value).split(":");
          const allowed = [
            "releaseRate",
            "reorderPoint",
            "deliverySize",
            "deliveryLead",
            "dispatchDwell",
            "parkingCapacity",
            "orderSize",
            "continuous",
            "materialLoadingCapacity",
          ];
          if (!allowed.includes(key)) throw new Error("Unsupported setting");
          const cfg = {
            ...w.config,
            [key]: key === "continuous" ? raw === "true" : Number(raw),
          };
          if (key === "continuous" && !["true", "false"].includes(raw))
            throw new Error("Invalid continuous setting");
          this.validateConfig(cfg);
          if (
            key === "parkingCapacity" &&
            w.vehicles.some((v) => v.slot >= cfg.parkingCapacity)
          )
            throw new Error(
              "Reserved parking spaces prevent capacity reduction",
            );
          if (
            key === "materialLoadingCapacity" &&
            w.carts.filter((cart) => cart.phase === "loading").length >
              cfg.materialLoadingCapacity!
          )
            throw new Error(
              "Cannot reduce loader capacity below committed carts",
            );
          if (key === "orderSize") {
            const pending = w.orders.find(
              (o) => o.source === "showcase" && o.status === "queued",
            );
            if (pending) {
              w.metrics.orderedUnits += cfg.orderSize - pending.quantity;
              pending.quantity = cfg.orderSize;
              this.event(
                "order-resized",
                pending.id,
                "Uncommitted showcase order quantity updated.",
                { quantity: pending.quantity },
              );
            } else
              message =
                "Order size saved for the next showcase batch; committed orders are unchanged";
          }
          w.config = cfg;
          break;
        }
      }
      this.state.revision++;
    } catch (error) {
      ok = false;
      message = error instanceof Error ? error.message : "Command rejected";
    }
    const result = { ok, message, revision: this.state.revision };
    this.seen.set(c.id, result);
    this.commandPayloads.set(c.id, clone(c));
    if (this.seen.size > 500) {
      const oldest = this.seen.keys().next().value!;
      this.seen.delete(oldest);
      this.commandPayloads.delete(oldest);
    }
    this.emit({
      kind: "command",
      command: c,
      result,
      time: requestedAt,
      epoch: requestedEpoch,
    });
    return clone(result);
  }
  exportRun(): RunExport {
    return clone({
      format: "brickworks-run",
      version: 1,
      snapshot: this.state,
      internal: {
        warehouseLots: this.warehouseLots,
        stationLots: this.stationLots,
        streams: this.streams,
        counters: this.counters,
        resumes: this.resumes,
        nextSample: this.nextSample,
        nextRelease: this.nextRelease,
        leadTotal: this.leadTotal,
        audit: this.audit,
        commands: [...this.seen.entries()],
        commandPayloads: [...this.commandPayloads.entries()],
      },
    });
  }
  static fromExport(
    input: unknown,
    options: { replay?: boolean } = {},
  ): FactorySimulation {
    if (!input || typeof input !== "object")
      throw new Error("Invalid checkpoint");
    const parsed = checkpointSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(
        `Invalid checkpoint: ${parsed.error.issues[0]?.message || "schema mismatch"}`,
      );
    const value = parsed.data as unknown as RunExport;
    if (
      value.format !== "brickworks-run" ||
      value.version !== 1 ||
      !value.snapshot ||
      !value.internal
    )
      throw new Error("Unsupported checkpoint version");
    const s = value.snapshot;
    const sim = new FactorySimulation(s.config, s.id);
    if (
      !Number.isFinite(s.time) ||
      s.time < 0 ||
      !Number.isInteger(s.epoch) ||
      !Number.isInteger(s.revision) ||
      !Array.isArray(s.events) ||
      s.events.length > 2000 ||
      !Array.isArray(s.vehicles) ||
      s.vehicles.length > 12 ||
      !Array.isArray(s.carts) ||
      s.carts.length > 5 ||
      !Array.isArray(s.trucks) ||
      s.trucks.length > 1
    )
      throw new Error("Checkpoint outside supported bounds");
    if (
      s.trucks.some(
        (truck) => truck.phase === "sorting" && truck.inspection !== "accepted",
      )
    )
      throw new Error("Sorting cargo must have passed receiving inspection");
    if (
      s.config.materialLoadingCapacity !== undefined &&
      s.carts.filter((cart) => cart.phase === "loading").length >
        s.config.materialLoadingCapacity
    )
      throw new Error("Checkpoint exceeds committed material-loader capacity");
    for (const line of LINE_IDS) {
      const st = s.stations[line];
      if (
        (st.status === "paused") !== Boolean(st.pause) ||
        (st.pause && st.pause.since > s.time)
      )
        throw new Error("Checkpoint station pause metadata is inconsistent");
      if (
        st.pause &&
        ["loading", "processing", "unloading"].includes(
          st.pause.previousStatus,
        ) &&
        !st.current
      )
        throw new Error("Checkpoint paused operation has no owned module");
      if (
        !st ||
        !STATUSES.includes(st.status) ||
        !Number.isInteger(st.stock) ||
        st.stock < 0 ||
        st.stock > 8 ||
        !Number.isInteger(st.capacity) ||
        st.capacity < 1 ||
        st.capacity > 8 ||
        st.queue.length > st.capacity ||
        !Number.isInteger(s.warehouse[line]) ||
        s.warehouse[line] < 0 ||
        s.warehouse[line] > CAPACITY
      )
        throw new Error("Invalid material checkpoint");
    }
    // v1 checkpoints before explicit orders migrate to one remaining-demand order.
    if (!s.orders) {
      const pending = s.vehicles.filter((v) => v.completedAt === null);
      const remaining = s.config.continuous
        ? Math.max(s.config.orderSize, pending.length)
        : Math.max(0, s.config.orderSize - s.metrics.completed, pending.length);
      s.orders = remaining
        ? [
            {
              id: "order-legacy",
              quantity: remaining,
              completed: 0,
              priority: 3,
              status: pending.length ? "in-progress" : "queued",
              createdAt: 0,
              source: "showcase",
            },
          ]
        : [];
      for (const vehicle of pending) vehicle.orderId = "order-legacy";
      s.metrics.orderedUnits = s.metrics.completed + remaining;
      s.metrics.ordersCreated = s.orders.length;
      s.metrics.ordersCompleted = 0;
    }
    if (
      new Set(s.orders.map((o) => o.id)).size !== s.orders.length ||
      !Number.isSafeInteger(s.metrics.orderedUnits) ||
      s.metrics.orderedUnits < s.metrics.completed ||
      s.orders.reduce((total, o) => total + o.quantity - o.completed, 0) !==
        s.metrics.orderedUnits - s.metrics.completed
    )
      throw new Error("Checkpoint production-order ledger mismatch");
    for (const order of s.orders) {
      const committed = s.vehicles.filter(
        (v) => v.orderId === order.id && v.completedAt === null,
      ).length;
      if (
        order.createdAt > s.time ||
        order.completed + committed > order.quantity ||
        (order.status === "queued" && (committed > 0 || order.completed > 0))
      )
        throw new Error(
          "Checkpoint production order overcommitted or inconsistent",
        );
    }
    if (
      s.vehicles.some(
        (v) =>
          v.completedAt === null && !s.orders.some((o) => o.id === v.orderId),
      )
    )
      throw new Error("Unfinished vehicle lacks an active production order");
    sim.state = clone(s);
    sim.state.running = options.replay ? s.running : false;
    if (!options.replay) sim.state.epoch++;
    sim.state.decisions = sim.state.decisions.filter(
      (d) => d.status !== "pending",
    );
    sim.state.providers = { astra: false, jev: false };
    const i = value.internal;
    for (const name of [
      "warehouseLots",
      "stationLots",
      "streams",
      "counters",
      "resumes",
      "nextSample",
      "nextRelease",
      "leadTotal",
      "audit",
    ] as const) {
      if (i[name] === undefined) throw new Error(`Missing checkpoint ${name}`);
      (sim as unknown as Record<string, unknown>)[name] = clone(i[name]);
    }
    const commandHistory = i.commands as [string, CommandResult][];
    if (commandHistory.some(([, result]) => result.revision > s.revision))
      throw new Error("Checkpoint command revision exceeds source state");
    sim.seen = new Map(clone(commandHistory));
    const payloads = (i.commandPayloads || []) as [string, FactoryCommand][];
    if (
      payloads.some(([id, command]) => command.id !== id || !sim.seen.has(id))
    )
      throw new Error(
        "Checkpoint command payload does not match a retained result",
      );
    sim.commandPayloads = new Map(clone(payloads));
    for (const line of LINE_IDS) {
      for (const [lots, total] of [
        [sim.warehouseLots[line], s.warehouse[line]],
        [sim.stationLots[line], s.stations[line].stock],
      ] as [Lot[], number][]) {
        if (
          !Array.isArray(lots) ||
          lots.some(
            (l) =>
              !Number.isInteger(l.amount) ||
              l.amount <= 0 ||
              typeof l.id !== "string",
          ) ||
          lots.reduce((n, l) => n + l.amount, 0) !== total
        )
          throw new Error("Checkpoint lot ledger mismatch");
      }
      sim.actors[line].send({ type: s.stations[line].status });
    }
    const m = s.metrics;
    const accounted =
      Object.values(s.warehouse).reduce((a, b) => a + b, 0) +
      Object.values(s.stations).reduce((a, v) => a + v.stock, 0) +
      s.carts.reduce((a, c) => a + c.amount, 0) +
      m.consumed;
    if (m.initial + m.received !== accounted)
      throw new Error("Checkpoint violates material conservation");
    const modules = [
      ...Object.values(s.stations).flatMap((st) => [
        ...st.queue,
        ...(st.current ? [st.current] : []),
      ]),
      ...s.vehicles.flatMap((v) => v.modules),
    ];
    if (
      modules.some((module) =>
        (module.reworkHistory || []).some(
          (event, index, history) =>
            event.time < module.created ||
            event.time > s.time ||
            (index > 0 && event.time < history[index - 1].time),
        ),
      )
    )
      throw new Error("Checkpoint module history violates its timeline");
    if (
      new Set(modules.map((module) => module.id)).size !== modules.length ||
      modules.length + m.dispatched * 5 + m.scrap !== m.consumed
    )
      throw new Error("Checkpoint violates component ownership");
    if (
      s.vehicles.filter((vehicle) =>
        ["outbound", "parking", "dispatching"].includes(vehicle.phase),
      ).length > 1
    )
      throw new Error(
        "Checkpoint contains conflicting shared-road reservations",
      );
    if (s.vehicles.some((vehicle) => vehicle.slot >= s.config.parkingCapacity))
      throw new Error("Checkpoint parking reservation exceeds capacity");
    for (const line of LINE_IDS)
      if (
        [
          ...s.stations[line].queue,
          ...(s.stations[line].current ? [s.stations[line].current!] : []),
        ].some((module) => module.line !== line)
      )
        throw new Error("Checkpoint module is on the wrong line");
    return sim;
  }
}
