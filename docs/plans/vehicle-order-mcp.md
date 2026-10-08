# Vehicle Order MCP (the factory as a seller)

Status: **proposed spec**. Not implemented. No order desk, MCP endpoint, or agent key exists in the codebase yet.
Date: 2026-10-08
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)
ID: `DF-ORDER-001`
Related: [Shop-as-MCP Sourcing, DF-SHOP-001](shop-mcp-sourcing.md) (buyer-side counterpart), [Joint Design Loop, DF-LOOP-001](spacex-design-loop.md), [architecture](../architecture.md), [simulation behavior](../simulation.md), [station adapter boundary](../station-adapters.md), [test strategy](../test-strategy.md), [Replit deployment](../replit-deployment.md), [people tracker: Caleb Chamberlain, OSH Cut](../people/oshbuilt-caleb-osh-cut.md)

DF-SHOP-001 makes Brickworks a buyer that sources parts from shops through their endpoints. This spec makes Brickworks a seller. The dark factory exposes its own MCP server so an external AI agent can discover what the factory builds, ask whether a configuration is buildable, get a virtual price and a simulated lead time, place a virtual order, and then follow that order through the simulated stations, end-of-line test, parking, dispatch, and a simulated delivery leg, receiving status updates the whole way.

Everything is virtual. No money moves, nothing ships, and no real person's data is collected.

## Where the idea comes from

Caleb Chamberlain (OSH Cut) argues that every shop should expose an owned API, likely an MCP server, that "fully define[s] shop capabilities" and returns "real-time, first principles, shop-specific DFM, prices, and lead-times", so agents can source by searching for the right combination of capability, speed, and price. Quotes and sources are collected in [DF-SHOP-001](shop-mcp-sourcing.md#where-the-idea-comes-from) and the [people tracker](../people/oshbuilt-caleb-osh-cut.md).

DF-SHOP-001 tests that thesis from the buyer side. DF-ORDER-001 tests it from the shop side, on the one factory we fully control: if Brickworks were a shop, what would its endpoint have to say, and can the factory's own simulation answer instantly and truthfully?

## What is real and what is proposed

| Item | Status | Notes |
| --- | --- | --- |
| Runtime production orders (`order-create`, priority 1 to 5, at most 20 active) | **Real, in code** | `packages/simulation/src/index.ts` `createOrder` (line 423), `nextOrder` (456), `completeOrderUnit` (468), command case `order-create` (1581). Covered by `tests/simulation-orders.test.ts`. |
| Vehicle genealogy carrying `orderId` | **Real, in code** | `assembly-start` event data (index.ts:680), `Vehicle.orderId` (`packages/contracts/src/index.ts:112`), dispatched lineage audit entry (index.ts:1193). |
| Ordered event stream for listeners | **Real, in code** | `FactorySimulation.subscribeEvents` (index.ts:290), already used by the NDJSON archive in `apps/server/src/app.ts` `createSession` (line 533). |
| Order cancellation | **Does not exist** | No cancel command. This spec adds `order-cancel`. |
| Agent-sourced orders, order desk, carrier simulation | **Proposed** | This spec. |
| MCP endpoint on the Fastify server | **Proposed** | Official TypeScript SDK `@modelcontextprotocol/sdk` (1.32.1 on npm on 2026-10-08, protocol up to `2025-11-25`). |
| A standard "shop sells to agents" schema | **Does not exist** | Same gap DF-SHOP-001 records. The schema below is our draft and deliberately reuses DF-SHOP-001 shapes. |
| MCP discovery documents (server card, catalog) | **Draft standards** | SEP-2127 server cards are an experimental extension; paths are still moving. See [Agent discovery](#agent-discovery). |

## Goals

1. An external agent with a Brickworks agent key can, over MCP or plain HTTPS: list vehicle configurations, read factory capabilities, get a feasibility check plus virtual price plus simulated lead time, place an order with an idempotency key, list and read its orders, cancel an order that has not been committed to assembly, and receive ordered status updates through delivery.
2. Orders run through the **existing** deterministic simulation as ordinary production orders. The factory is not faked for agents; the same joining, inspection, rework, parking, road, and dispatch rules apply.
3. Every status an agent sees is traceable to a factory event id or a seeded carrier event, with an explicit `source` (`simulated` or `forecast`).
4. The order flow is deterministic under test and replayable from the session archive.
5. Operators and visitors can watch incoming agent orders and their progress in the web app.
6. One contract, two transports: MCP tools and a REST mirror built from the same Zod schemas and the same service.

## Non-goals

- **No payments.** Prices are virtual credits (`BWC-VIRTUAL`). There is no card, invoice, wallet, balance, or settlement field anywhere in the schema, and strict schemas reject unknown fields.
- **No real shipping.** Destinations are four fictional zones. There are no address, postal code, phone, or name fields.
- **No real PII.** Agents are identified by an operator-assigned id and label. The only free text an agent can send is an optional `agentReference` that rejects emails, URLs, spaces, and long digit runs.
- **No new authority over the factory.** Agents cannot pause, reset, fault, repair, reprioritize, pick stations, or choose modules. The order desk issues exactly two command types.
- **No changes to manufacturing physics,** cycle times, `LINE_META`, or the recipe.
- **No public listing** in any MCP registry, and no Replit publication, without Filip's explicit yes.
- **No OAuth 2.1 authorization server** in v1. Bearer agent keys only (see [Auth](#auth-rate-limits-and-caps)).
- **No A2A protocol endpoint** in v1.

## Design principles

Inherited from DF-SHOP-001, applied to the seller side:

1. **Feasibility is the compiler.** A rejected configuration returns the DF-SHOP-001 issue shape: code, severity, feature reference, measured value, limit, and a machine-actionable suggestion. "Not buildable" without a reason is useless to an agent.
2. **Forecast is not observed.** A quoted lead time is a `forecast` from a forked simulation run. A status change is `simulated` (observed in the authoritative session). Nothing is `measured`; the factory is virtual. These are separate fields and never merged.
3. **Idempotent and versioned.** Writes carry an idempotency key. Quotes carry an id, a price book version, a basis (epoch, revision, simulation time), and an expiry. Orders reference a quote id, not a recomputed price.
4. **Few tools.** Eight tools, detail in resources. DF-SHOP-001 targets eight or fewer because model coherence drops with large tool lists.
5. **Protocol neutral.** MCP is one adapter. The REST mirror and OpenAPI document come from the same Zod schemas.

Brickworks rules that apply unchanged ([architecture](../architecture.md), `.agent/skills/factory-development/SKILL.md`):

6. **The server owns production state.** The order desk observes the simulation and submits schema-checked commands. It never mutates `FactorySnapshot` directly. Babylon never advances an order.
7. **Agents are a lower-authority command source than operators.** They get less than Astra and Jev, not more.
8. **Models see observations, not hidden state.** Agent responses omit the seed, station wear, random streams, and checkpoint internals, the same boundary documented for providers in [configuration](../configuration.md).

## How it hooks into the existing simulation

### What the code already does

| Need | Existing mechanism | Location |
| --- | --- | --- |
| Inject a work order at runtime | `order-create` command, `value: "quantity:priority"`, applies while running or paused | `packages/simulation/src/index.ts:1581`; schema `packages/contracts/src/index.ts:285` |
| Order record | `ProductionOrder { id, quantity, completed, priority, status: "queued" \| "in-progress", createdAt, source: "showcase" \| "manual" }` | `packages/contracts/src/index.ts:102`; checkpoint schema `packages/contracts/src/runtime.ts:102` |
| Order selection | Highest priority with unassigned units, then `createdAt`, then numeric id | `nextOrder`, index.ts:456 |
| Binding modules to an order | Five accepted modules are atomically reserved at joining and the vehicle gets `orderId` | `release`, index.ts:640 to 692 (`assembly-start` event at 680) |
| Unit completion | End-of-line pass increments `order.completed`; full order retires into an `order-completed` event | `completeOrderUnit`, index.ts:468 (event at 477); called from `processEvents` at 1134 |
| Station state machine | XState `controller` machine, one actor per line, states `idle`, `loading`, `processing`, `unloading`, `starved`, `blocked`, `faulted`, `maintenance`, `paused` | index.ts:25 to 49; actors created at 205; `transition` at 402 |
| Event stream | `subscribeEvents(listener, { replayRetained })` delivers `AuditEntry` (`event`, `lineage`, `command`) in order | index.ts:290 |
| Command idempotency | Command id ledger; same id plus different payload is rejected | index.ts:1409 (engine), `apps/server/src/app.ts:1247` (server fingerprint) |
| Replay | Archive commands re-executed at their recorded simulation times | `packages/simulation/src/replay.ts` |
| Fork for forecasting | `exportRun()` and `FactorySimulation.fromExport()` | index.ts:1736 and 1756 |
| Worker isolation | Experiment and replay workers via `worker_threads` with 30 s timeout | `apps/server/src/app.ts` `runExperiment` (329), `runReplay` (364) |
| Sessions | In-memory `Map`, max 10, 30 minute idle expiry, 125 ms tick | app.ts:407, `expireSessions` (513), `createSession` (533), tick (1154) |

**Answer to "can the sim accept new work orders at runtime?"** Yes. `order-create` already does it and is tested. What is missing is (a) a source tag and external reference so the desk can find its order, (b) cancellation, and (c) `orderId` on the post-test vehicle events.

### Simulation changes required

All additive. Snapshot and checkpoint stay `version: 1`; old checkpoints remain valid because new fields are optional.

1. `ProductionOrder.source` gains `"agent"`, and `ProductionOrder` gains optional `externalRef?: string` (the desk order id, for example `ao-7k2m9q4x1c`). Update `productionOrderSchema` in `runtime.ts:102`.
2. New command `order-agent-create`, `value: "<quantity>:<priority>:<externalRef>"`, quantity 1 to 3, priority 2 to 5, no station. Emits the existing `order-created` event with the order (including `externalRef`) in `data.order`.
3. New command `order-cancel`, `value: "<order-id>"`. Allowed only when the order is `queued`, `completed === 0`, and no live vehicle carries its id (`uncompletedCommitments` is 0, index.ts:451). Retires the order, subtracts remaining units from `metrics.orderedUnits`, increments a new `ordersCancelled` counter, and emits `order-cancelled`. The checkpoint ledger check at index.ts:1860 (remaining demand equals `orderedUnits - completed`) must still hold.
4. Add `orderId` to the `data` of `parking-route` (index.ts:1155), `vehicle-parked` (1170), `dispatch-start` (1181), and `vehicle-dispatched` (1208). Today those events carry only the vehicle id as `entity`, and the order has usually retired already (it retires at end-of-line, before parking), so the desk would otherwise need its own vehicle map.
5. Both new command types are **not** added to the provider allowlist (`allowedCommandSchema`, `packages/providers/src/index.ts:83`), and the generic `POST /api/sessions/:id/command` route rejects `order-agent-create` with 403. Only the order desk issues it.

### The order floor

Visitor sessions are private, capped at 10, and expire after 30 idle minutes. Agent orders need a factory that is always there. The desk therefore owns one pinned session, the **order floor**:

| Property | Value |
| --- | --- |
| Id | `order-floor` (fixed, so URLs and resources are stable) |
| Created | At boot when `ORDER_DESK_ENABLED=true`, or restored from the floor snapshot |
| Lifetime | Exempt from `expireSessions` and from the `maxSessions` count |
| Config | `ORDER_FLOOR_SCENARIO` (default `balanced`), `ORDER_FLOOR_SEED` (default 42), `continuous: true`, `orderSize: 2`, `dispatchDwell: 30` |
| Clock | Started at boot, speed fixed at 1 (one simulated second per wall second), so ETAs translate to wall time |
| Mode | Locked to `manual`. No Astra or Jev calls on the floor, so no model can touch agent orders |
| Operator control | `POST /api/order-floor/command` with `BRICKWORKS_ACCESS_CODE`; allowlist: station `pause`/`start`, `fault`, `repair`, `speed`, `order-cancel`. `reset` is rejected while any agent order is non-terminal |
| Viewing | Read-only live stream for anyone when `ORDER_FLOOR_PUBLIC_VIEW=true` |

Why `orderSize: 2`: the showcase order is created at priority 3 (index.ts:511). A `standard` agent order is also priority 3, ties break by creation time, so it waits for at most the current two-unit showcase batch. `expedite` is priority 2 and takes the next complete module set ahead of showcase work. Priority 1 stays reserved for the operator. Committed vehicles are never preempted, as today.

### Event to order mapping

The desk subscribes to the floor with `subscribeEvents` (not snapshot polling, so the 2,000-event retention window at index.ts:395 never drops an update). A pure reducer, the **bridge**, turns factory events into lifecycle events.

| Factory event (file: line) | Correlation | Lifecycle event | Public status after |
| --- | --- | --- | --- |
| `order-created` (index.ts:444) with `data.order.source === "agent"` | `data.order.externalRef` | `FACTORY_ORDER_CREATED` | `scheduled` |
| Queue-head check after each tick (derived from snapshot using the `nextOrder` rule) | factory order id | `QUEUE_HEAD` / `QUEUE_DEMOTED` | `in_production` stage `modules` (projected) / back to `scheduled` |
| `assembly-start` (680) | `data.orderId` | `UNIT_COMMITTED` (vehicle id, module ids, lots) | `in_production` stage `joining` |
| `assembly-joined` (1106) | vehicle id | `UNIT_JOINED` | `quality_check` stage `end_of_line_test` |
| `vehicle-rework` (1121) | vehicle id | `UNIT_REWORK` (`defectClass`) | `quality_check` stage `rework` |
| `vehicle-complete` (1137) | `data.orderId` | `UNIT_PASSED` | `completed` (unit) |
| `order-completed` (477) | `data.order.id` | `FACTORY_ORDER_RETIRED` (bookkeeping only) | unchanged |
| `parking-route` (1155) | `data.orderId` (new) | `UNIT_STAGING` | `completed` stage `staging` |
| `vehicle-parked` (1170) | `data.orderId` (new) | `UNIT_PARKED` | `ready_for_pickup` |
| `dispatch-start` (1181) | `data.orderId` (new) | `UNIT_DISPATCH_STARTED` | `ready_for_pickup` stage `dispatching` |
| `vehicle-dispatched` (1208) and lineage entry (1193) | `data.orderId` (new) | `UNIT_SHIPPED` (hands unit to carrier) | `shipped` |
| `order-cancelled` (new) | `data.order.externalRef` | `CANCEL_CONFIRMED` | `cancelled` |
| `site-fault` (1542), `station-fault` (1537), `station-paused` (1472), `supply-hold` (843) | affects all non-terminal orders before `shipped` | `RISK_RAISED` | unchanged, `atRisk` set |
| `site-repaired` (1572), `maintenance-complete`, `station-resumed` | same | `RISK_CLEARED` | unchanged |
| `reset` (1516) on the floor (only reachable if forced) | all non-terminal orders | `FAIL` reason `floor_reset` | `failed` |

Events that never change an agent order's status: `module-scrapped` and `inspection-reject` (the line consumes a replacement kit; the order waits longer, which shows up in the next re-forecast), receiving events, cart events.

### Per-station progress: projected versus bound

Modules are line-fungible until joining. A front module being built right now is not anyone's until `assembly-start` reserves it. The spec does not pretend otherwise:

- **Before commitment** (`binding: "projected"`): when an agent order is the head of the selection queue, each line shows `waiting`, `building` (station `current` exists), or `ready` (an accepted module sits in the assembly buffer). This is what the next `assembly-start` would take if priorities do not change.
- **After commitment** (`binding: "bound"`): the vehicle's five modules are known, so each line shows `reserved` with module id, lot, created time, and `reworkHistory` (inspection passed, rejected, rework started) from genealogy. This is true per-station history for the unit, retroactively exact.

## Order lifecycle state machine

### Public statuses

```ts
export const ORDER_STATUSES = [
  "placed",            // request validated and persisted; idempotency recorded
  "accepted",          // desk re-checked quote, caps, and floor epoch; command about to be issued
  "scheduled",         // factory ProductionOrder exists (order-created observed)
  "in_production",     // stage "modules" (queue head, projected) or "joining" (bound)
  "quality_check",     // end-of-line test, including one rework loop
  "completed",         // passed end-of-line; includes "staging" on the shared road
  "ready_for_pickup",  // parked in a bay; includes "dispatching" to the customer exit
  "shipped",           // crossed the customer exit boundary; carrier has custody
  "in_transit",        // carrier legs; substate "delayed" possible
  "out_for_delivery",  // final leg
  "delivered",         // terminal
  "cancelled",         // terminal
  "failed",            // terminal
] as const;
```

Quotes have their own statuses: `quoted`, `expired`, `converted`.

An order of quantity N has N units. Order status is the order machine state until production starts, then the **least advanced unit's** status (by array index above), so an order only reads `delivered` when every unit is delivered. Terminal `cancelled` and `failed` apply to the whole order.

### Machines (XState 5, sketch)

Use `setup(...).createMachine(...)` with the pure `initialTransition` and `transition` functions (available since XState 5.19; the lockfile pins 5.33.2). The desk stores serializable snapshots and never depends on live actors, so persistence and replay are just data.

```ts
// packages/orders/src/lifecycle.ts (sketch, not code to ship as-is)
export const agentOrderMachine = setup({
  types: {
    context: {} as { orderId: string; quantity: number; committedUnits: number; reason: string | null },
    events: {} as
      | { type: "DESK_ACCEPTED" }
      | { type: "DESK_REJECTED"; reason: RejectReason }
      | { type: "FACTORY_ORDER_CREATED"; factoryOrderId: string }
      | { type: "INJECTION_FAILED"; message: string }
      | { type: "UNIT_COMMITTED"; unitIndex: number }
      | { type: "ALL_UNITS_DELIVERED" }
      | { type: "CANCEL_REQUESTED"; by: "agent" | "operator" }
      | { type: "CANCEL_CONFIRMED" }
      | { type: "FAIL"; reason: FailReason },
  },
  guards: { noUnitCommitted: ({ context }) => context.committedUnits === 0 },
}).createMachine({
  id: "agentOrder",
  initial: "placed",
  states: {
    placed:     { on: { DESK_ACCEPTED: "accepted", DESK_REJECTED: "failed" } },
    accepted:   { on: { FACTORY_ORDER_CREATED: "scheduled", INJECTION_FAILED: "failed" } },
    scheduled:  {
      on: {
        CANCEL_REQUESTED: { guard: "noUnitCommitted", target: "cancelling" },
        UNIT_COMMITTED: "fulfilling",
        FAIL: "failed",
      },
    },
    cancelling: { on: { CANCEL_CONFIRMED: "cancelled", UNIT_COMMITTED: "fulfilling" } }, // engine is the referee
    fulfilling: { on: { ALL_UNITS_DELIVERED: "delivered", FAIL: "failed" } },
    delivered:  { type: "final" },
    cancelled:  { type: "final" },
    failed:     { type: "final" },
  },
});

export const agentOrderUnitMachine = setup({ /* types elided */ }).createMachine({
  id: "agentOrderUnit",
  initial: "queued",
  states: {
    queued:           { on: { QUEUE_HEAD: "modules", UNIT_COMMITTED: "joining" } },        // public: scheduled
    modules:          { on: { QUEUE_DEMOTED: "queued", UNIT_COMMITTED: "joining" } },      // public: in_production (projected)
    joining:          { on: { UNIT_JOINED: "end_of_line_test" } },                         // public: in_production (bound)
    end_of_line_test: { on: { UNIT_REWORK: "rework", UNIT_PASSED: "passed" } },            // public: quality_check
    rework:           { on: { UNIT_PASSED: "passed" } },                                   // public: quality_check
    passed:           { on: { UNIT_STAGING: "staging" } },                                 // public: completed
    staging:          { on: { UNIT_PARKED: "parked" } },                                   // public: completed
    parked:           { on: { UNIT_DISPATCH_STARTED: "dispatching" } },                    // public: ready_for_pickup
    dispatching:      { on: { UNIT_SHIPPED: "shipped" } },                                 // public: ready_for_pickup
    shipped:          { on: { CARRIER_DEPARTED: "in_transit" } },
    in_transit: {
      initial: "moving",
      states: {
        moving:  { on: { CARRIER_DELAYED: "delayed" } },
        delayed: { on: { CARRIER_RECOVERED: "moving" } },
      },
      on: { CARRIER_OUT_FOR_DELIVERY: "out_for_delivery", CARRIER_LOST: "failed" },
    },
    out_for_delivery: { on: { CARRIER_DELIVERED: "delivered" } },
    delivered:        { type: "final" },
    failed:           { type: "final" },
  },
});
```

`cancelling` exists because cancellation is a command to the engine, and the engine decides. In practice the desk issues `order-cancel` synchronously in the same tick, so `cancelling` lasts zero simulated time; the state still makes a race with `assembly-start` explicit instead of impossible-by-assumption.

### Reason codes

| Terminal | Reason | When |
| --- | --- | --- |
| `cancelled` | `agent_requested` | `cancel_order` before any unit is committed |
| `cancelled` | `operator_cancelled` | Operator `order-cancel` on the floor |
| `failed` | `injection_rejected` | Engine refused `order-agent-create` (for example the 20 active order cap was hit between check and command) |
| `failed` | `floor_reset` | Floor reset while the order was active (blocked by default) |
| `failed` | `floor_state_lost` | Restart found desk state newer than the floor checkpoint and could not reconcile |
| `failed` | `carrier_lost` | Test or operator injection only. The seeded carrier never loses vehicles on its own in v1 |

Placement-time refusals (`QUOTE_EXPIRED`, `AGENT_ORDER_CAP`, and so on) are errors, not orders. No order record is created.

Scrap, rework, faults, and blockages never fail an order. The simulation replaces scrapped modules automatically ("Failed rework scrapped; a replacement kit will be consumed", index.ts:1058). They delay it, and the order carries `atRisk: { value: true, reasons: ["site_fault:assembly", ...] }` until cleared.

## Catalog, feasibility, price, and lead time

### Catalog

The factory builds exactly one product: recipe `gold-two-seat-v1` (`ROBOTAXI_RECIPE`, `packages/assets/src/design.ts`). The catalog does not invent options the factory cannot honor.

| Model id | Recipe | Options offered | Options listed as not offered |
| --- | --- | --- | --- |
| `robotaxi-gold-two-seat` | `gold-two-seat-v1`, version 1 | `finish: "gold"`, `seats: 2` | Other finishes and seat counts, so an agent learns the boundary from a feasibility issue instead of a schema error |

When DF-LOOP-001 phase 3 lands (`scenarios/exterior-sku-collapse.json`), the catalog can add a recipe variant. Until then the catalog stays at one model.

### Feasibility checks

Same issue shape as DF-SHOP-001 `dfmIssue`, with factory units. Feasibility runs on every quote and again at placement.

| Code | Severity | Feature ref | Trigger |
| --- | --- | --- | --- |
| `MODEL_UNKNOWN` | error | `config.modelId` | Model id not in catalog |
| `OPTION_NOT_OFFERED` | error | `config.options.<key>` | Option value the recipe cannot build; suggestion names offered values |
| `QUANTITY_ABOVE_LIMIT` | error | `quantity` | Above `ORDER_MAX_QUANTITY` (3) |
| `ZONE_UNKNOWN` | error | `destinationZone` | Not one of the four zones |
| `AGENT_ORDER_CAP` | error | `agent` | Agent already has `maxActiveOrders` non-terminal orders |
| `FLOOR_ORDER_SLOTS_FULL` | error | `floor` | Desk active cap (10) or engine cap (20) reached |
| `ORDER_DESK_PAUSED` | error | `floor` | Operator paused intake |
| `ASSEMBLY_OUTAGE_ACTIVE` | warning | `site:assembly` | `faults.assembly` |
| `SUPPLY_HOLD_ACTIVE` | warning | `site:supply` | `faults.supply` |
| `DISPATCH_BLOCKAGE_ACTIVE` | warning | `site:dispatch` | `faults.dispatch` |
| `CONGESTION_ACTIVE` | warning | `site:congestion` | `faults.congestion` |
| `STATION_FAULTED` | warning | `line:<id>` | Station `faulted` or `maintenance` |
| `STATION_PAUSED` | warning | `line:<id>` | Station operator-paused |
| `LOW_LINE_STOCK` | info | `line:<id>` | Warehouse plus line-side stock below one kit per ordered unit |
| `FORECAST_HORIZON_EXCEEDED` | warning | `leadOptions.<name>` | Forked run did not deliver within the horizon |

`manufacturable` is false if any error is present.

### Price (virtual)

A declared, versioned price book, not derived from the simulation's cost estimates (those are simulated observations, and reusing them would imply economics the project does not claim).

| Line | Amount (`BWC-VIRTUAL`) |
| --- | --- |
| `robotaxi-gold-two-seat`, per unit | 1,000 |
| `expedite` premium, per unit | 250 |
| Carrier, per unit: `zone-local` / `zone-metro` / `zone-regional` / `zone-remote` | 20 / 40 / 80 / 120 |

Price book id `pb-2026-10-v1`. Dynamic load pricing is an open question.

### Lead time (forecast)

A quote forks the floor and runs it forward. Because the simulation is deterministic with resource-specific random streams, the forked run is exactly what the floor will do if nothing new happens: no new orders, no operator faults or repairs. That is a real first-principles lead time in Caleb's sense, with an honest condition attached.

1. Take `exportRun()` of the floor (index.ts:1736).
2. In a worker (`apps/server/src/forecast-worker.ts`, same pattern as `runExperiment`), call `FactorySimulation.fromExport` once per requested lead option, issue `order-agent-create` with a placeholder ref, `start`, and advance in bounded steps until every unit emits `vehicle-dispatched` or the horizon (3,600 simulated seconds) is reached.
3. Read `completeBySimTime` (last `vehicle-complete`), `shipBySimTime` (last `vehicle-dispatched`), and add the zone's nominal carrier time for `deliverBySimTime`.
4. Convert to wall time at floor speed 1. `confidence` is `firm-if-no-new-inputs`, or `at-risk` if any warning is present, or `unknown` on horizon overrun.

One forked run also re-forecasts all active agent orders at once, which the desk uses for `estimate.revised` updates (at most every 30 wall seconds, only after a fault, repair, pause, resume, or new order on the floor).

Carrier delays cannot be forecast at quote time because they are seeded by the order id, which does not exist yet. The quote states the nominal transit and the maximum delay factor (1.6 per leg).

## MCP surface

### Tools

| Tool | Auth scope | Annotations | Purpose |
| --- | --- | --- | --- |
| `list_vehicle_configs` | none (if `ORDER_DESK_ANON_READ`) | readOnly | Catalog with offered and not-offered option values, base prices, price book id |
| `get_capabilities` | none (if `ORDER_DESK_ANON_READ`) | readOnly | Lines, recipe, zones, limits, live floor status (faults, station statuses, throughput, active agent orders) |
| `quote_vehicle` | `quote` | readOnly | Feasibility plus virtual price plus forecast lead options; returns `quoteId` |
| `place_order` | `order:write` | idempotent with key, not destructive, closed world | Convert a quote into a virtual order |
| `get_order` | `order:read` | readOnly | Full order view with units, stations, tracking |
| `list_orders` | `order:read` | readOnly | Caller's orders, filterable by status, paginated |
| `cancel_order` | `order:write` | destructive, idempotent with key | Cancel before any unit is committed |
| `get_order_updates` | `order:read` | readOnly | Cursor-paged update feed with optional long poll; the protocol-independent way to follow orders |

Eight tools, matching the DF-SHOP-001 ceiling.

### Zod schemas (sketch)

Sketch only. Zod style matches `packages/contracts`. Proposed home: `packages/contracts/src/orders.ts`, shared by server, web, and tests. Not added to the codebase in this commit.

```ts
import { z } from "zod";
import { LINE_IDS } from "./index.ts";

// ---------- shared ----------
export const valueSource = z.enum(["declared", "simulated", "forecast"]); // DF-SHOP-001 enum minus "measured", plus "forecast"
export const ORDER_STATUSES = [/* see lifecycle section */] as const;
export const orderStatus = z.enum(ORDER_STATUSES);
export const DESTINATION_ZONES = ["zone-local", "zone-metro", "zone-regional", "zone-remote"] as const;
export const LEAD_OPTIONS = ["standard", "expedite"] as const;

const agentOrderId = z.string().regex(/^ao-[0-9a-z]{10}$/);
const quoteId = z.string().regex(/^aq-[0-9a-z]{10}$/);
const isoTime = z.string().datetime();
const simTime = z.number().finite().nonnegative();
export const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const agentReference = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9._:-]*$/)                     // no "@", spaces, "/", "+"
  .refine((v) => !/\d{7,}/.test(v), "Looks like a phone or account number; do not send personal data");
export const virtualAmount = z
  .object({ amount: z.number().finite().nonnegative(), currency: z.literal("BWC-VIRTUAL") })
  .strict();
const virtualNotice = { virtual: z.literal(true), disclaimer: z.string() };

export const feasibilityIssue = z.object({
  code: z.enum([
    "MODEL_UNKNOWN", "OPTION_NOT_OFFERED", "QUANTITY_ABOVE_LIMIT", "ZONE_UNKNOWN",
    "AGENT_ORDER_CAP", "FLOOR_ORDER_SLOTS_FULL", "ORDER_DESK_PAUSED",
    "ASSEMBLY_OUTAGE_ACTIVE", "SUPPLY_HOLD_ACTIVE", "DISPATCH_BLOCKAGE_ACTIVE", "CONGESTION_ACTIVE",
    "STATION_FAULTED", "STATION_PAUSED", "LOW_LINE_STOCK", "FORECAST_HORIZON_EXCEEDED",
  ]),
  severity: z.enum(["error", "warning", "info"]),
  featureRef: z.string().max(80).nullable(),  // "config.options.finish", "line:exterior", "site:assembly"
  measured: z.number().nullable(),
  limit: z.number().nullable(),
  unit: z.enum(["units", "orders", "kits", "s"]).nullable(),
  message: z.string().max(300),
  suggestion: z.string().max(300).nullable(),
});

// Permissive strings on input so an unsupported option becomes a feasibility issue, not a schema error.
export const vehicleConfigInput = z
  .object({
    modelId: z.string().max(60),
    options: z.record(z.string().max(30), z.union([z.string().max(30), z.number().int()])).default({}),
  })
  .strict();

// ---------- list_vehicle_configs ----------
export const listVehicleConfigsInput = z.object({}).strict();
export const listVehicleConfigsOutput = z.object({
  priceBookVersion: z.string(),
  models: z.array(z.object({
    modelId: z.string(),
    name: z.string(),
    recipeId: z.string(),             // "gold-two-seat-v1"
    recipeVersion: z.number().int(),
    description: z.string(),
    basePrice: virtualAmount,
    options: z.array(z.object({
      key: z.string(),
      values: z.array(z.object({ value: z.union([z.string(), z.number()]), offered: z.boolean(), note: z.string().nullable() })),
    })),
  })),
  ...virtualNotice,
});

// ---------- get_capabilities ----------
export const getCapabilitiesInput = z.object({}).strict();
export const getCapabilitiesOutput = z.object({
  factory: z.object({
    name: z.literal("Brickworks dark factory (virtual)"),
    floorId: z.literal("order-floor"),
    lines: z.array(z.object({ id: z.enum(LINE_IDS), name: z.string(), nominalCycleSeconds: z.number() })), // from LINE_META
    recipe: z.object({ id: z.string(), joiningOrder: z.array(z.enum(LINE_IDS)), inspection: z.array(z.string()) }),
    parkingBays: z.number().int(),
    destinationZones: z.array(z.object({ id: z.enum(DESTINATION_ZONES), nominalTransitSeconds: z.number() })),
    leadOptions: z.array(z.object({ name: z.enum(LEAD_OPTIONS), productionPriority: z.number().int() })),
  }),
  floorStatus: z.object({
    running: z.boolean(),
    simTime,
    speed: z.number(),
    faults: z.object({ supply: z.boolean(), congestion: z.boolean(), assembly: z.boolean(), dispatch: z.boolean() }),
    stations: z.record(z.enum(LINE_IDS), z.string()),  // StationStatus; no wear, no seed
    activeAgentOrders: z.number().int(),
    throughputPerHour: z.number(),
    source: z.literal("simulated"),
  }),
  limits: z.object({
    maxQuantityPerOrder: z.number().int(),
    maxActiveOrdersPerAgent: z.number().int(),
    quoteTtlSeconds: z.number().int(),
    rateLimits: z.record(z.string(), z.string()),     // human-readable, e.g. "place_order": "3/min, 20/day"
  }),
  transports: z.object({ mcp: z.string().url(), rest: z.string().url(), openapi: z.string().url() }),
  ...virtualNotice,
});

// ---------- quote_vehicle ----------
export const quoteVehicleInput = z
  .object({
    config: vehicleConfigInput,
    quantity: z.number().int().min(1).max(10),       // schema bound; feasibility enforces the real cap (3)
    destinationZone: z.string().max(40),
    leadOptions: z.array(z.enum(LEAD_OPTIONS)).min(1).max(2).default(["standard", "expedite"]),
  })
  .strict();
export const leadOptionQuote = z.object({
  name: z.enum(LEAD_OPTIONS),
  productionPriority: z.number().int().min(2).max(3),
  completeBySimTime: simTime.nullable(),
  shipBySimTime: simTime.nullable(),
  deliverBySimTime: simTime.nullable(),
  estimatedDeliveryAt: isoTime.nullable(),         // wall clock at floor speed 1
  maxCarrierDelayFactor: z.number(),               // 1.6
  price: virtualAmount,
  source: z.literal("forecast"),
  confidence: z.enum(["firm-if-no-new-inputs", "at-risk", "unknown"]),
});
export const quoteVehicleOutput = z.object({
  quoteId,
  status: z.enum(["quoted", "expired", "converted"]),
  expiresAt: isoTime,                              // also void if the floor epoch changes
  feasibility: z.object({ manufacturable: z.boolean(), issues: z.array(feasibilityIssue) }),
  lines: z.array(z.object({ code: z.string(), description: z.string(), quantity: z.number().int(), unitPrice: virtualAmount, total: virtualAmount })),
  leadOptions: z.array(leadOptionQuote),
  basis: z.object({
    floorId: z.literal("order-floor"),
    epoch: z.number().int(),
    revision: z.number().int(),
    simTime,
    basisHash: z.string(),                         // opaque hash of the forked checkpoint; seed is never exposed
    priceBookVersion: z.string(),
    forecastHorizonSeconds: z.number(),
  }),
  ...virtualNotice,
});

// ---------- order views ----------
export const stationProgress = z.object({
  state: z.enum(["waiting", "building", "ready", "reserved"]),
  binding: z.enum(["projected", "bound"]),
  moduleId: z.string().nullable(),
  lot: z.string().nullable(),
  rework: z.number().int().min(0).max(1).nullable(),
  history: z.array(z.object({ simTime, event: z.string(), defectClass: z.string().optional() })).max(4),
});
export const trackingLeg = z.object({
  from: z.string(), to: z.string(),
  plannedStart: simTime, plannedEnd: simTime, actualEnd: simTime.nullable(),
  delayed: z.boolean(), delayReason: z.enum(["virtual-weather", "virtual-road-closure", "virtual-hub-backlog"]).nullable(),
});
export const trackingView = z.object({
  carrier: z.literal("Brickworks Virtual Freight"),
  trackingId: z.string(),                          // "bvf-ao-7k2m9q4x1c-0"
  zone: z.enum(DESTINATION_ZONES),
  legs: z.array(trackingLeg).max(5),
  etaSimTime: simTime.nullable(),
  etaAt: isoTime.nullable(),
  source: z.literal("simulated"),
});
export const unitView = z.object({
  index: z.number().int().min(0).max(2),
  status: orderStatus,
  stage: z.enum(["queued", "modules", "joining", "end_of_line_test", "rework", "staging", "parked", "dispatching", "carrier", "delivered"]).nullable(),
  vehicleId: z.string().nullable(),                // "taxi-12" after commitment
  stations: z.record(z.enum(LINE_IDS), stationProgress),
  tracking: trackingView.nullable(),
});
export const orderView = z.object({
  orderId: agentOrderId,
  agentId: z.string(),
  quoteId,
  status: orderStatus,
  statusReason: z.string().nullable(),
  atRisk: z.object({ value: z.boolean(), reasons: z.array(z.string()).max(10) }),
  config: z.object({ modelId: z.string(), options: z.record(z.string(), z.union([z.string(), z.number()])) }),
  quantity: z.number().int().min(1).max(3),
  destinationZone: z.enum(DESTINATION_ZONES),
  leadOption: z.enum(LEAD_OPTIONS),
  price: virtualAmount,
  agentReference: z.string().nullable(),
  placedAt: isoTime,
  placedAtSimTime: simTime,
  factoryOrderId: z.string().nullable(),           // "order-7"
  promised: leadOptionQuote.pick({ completeBySimTime: true, shipBySimTime: true, deliverBySimTime: true, estimatedDeliveryAt: true }),
  latestEstimate: leadOptionQuote.pick({ completeBySimTime: true, shipBySimTime: true, deliverBySimTime: true, estimatedDeliveryAt: true, confidence: true }),
  units: z.array(unitView).max(3),
  lastUpdateSeq: z.number().int().nonnegative(),
  ...virtualNotice,
});
export const orderSummary = orderView.pick({
  orderId: true, status: true, quantity: true, leadOption: true, destinationZone: true,
  placedAt: true, atRisk: true, lastUpdateSeq: true,
}).extend({ etaAt: isoTime.nullable() });

// ---------- place_order ----------
export const placeOrderInput = z
  .object({ quoteId, leadOption: z.enum(LEAD_OPTIONS), idempotencyKey, agentReference: agentReference.optional() })
  .strict();                                       // no approval token: no money moves (contrast DF-SHOP-001 placeOrderInput)
export const placeOrderOutput = z.object({ order: orderView, replayed: z.boolean() });

// ---------- get_order / list_orders ----------
export const getOrderInput = z.object({ orderId: agentOrderId }).strict();
export const getOrderOutput = z.object({ order: orderView });
export const listOrdersInput = z
  .object({ status: z.array(orderStatus).max(13).optional(), cursor: z.string().max(64).optional(), limit: z.number().int().min(1).max(50).default(20) })
  .strict();
export const listOrdersOutput = z.object({ orders: z.array(orderSummary), nextCursor: z.string().nullable() });

// ---------- cancel_order ----------
export const cancelOrderInput = z.object({ orderId: agentOrderId, idempotencyKey }).strict();
export const cancelOrderOutput = z.object({ order: orderView, cancelled: z.boolean(), replayed: z.boolean() });

// ---------- get_order_updates ----------
export const ORDER_UPDATE_TYPES = [
  "order.placed", "order.accepted", "order.scheduled", "order.at_risk", "order.risk_cleared",
  "unit.queue_head", "unit.queue_demoted", "unit.committed", "unit.joined", "unit.rework", "unit.passed",
  "order.completed", "unit.staging", "unit.parked", "unit.dispatch_started", "unit.shipped",
  "carrier.departed_hub", "carrier.arrived_hub", "carrier.delayed", "carrier.recovered",
  "carrier.out_for_delivery", "unit.delivered", "order.delivered",
  "order.cancelled", "order.failed", "estimate.revised",
] as const;
export const orderUpdate = z.object({
  seq: z.number().int().positive(),                // desk-wide monotonic; the cursor is derived from it
  orderId: agentOrderId,
  unitIndex: z.number().int().min(0).max(2).nullable(),
  type: z.enum(ORDER_UPDATE_TYPES),
  status: orderStatus,
  previousStatus: orderStatus.nullable(),
  at: isoTime,
  simTime,
  message: z.string().max(300),
  factoryEvent: z.object({ id: z.number().int(), type: z.string() }).nullable(), // provenance link to FactoryEvent
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  source: z.enum(["simulated", "forecast"]),
});
export const getOrderUpdatesInput = z
  .object({
    orderId: agentOrderId.optional(),              // omit for all of the caller's orders
    cursor: z.string().max(64).optional(),         // omit to start from the oldest retained update
    limit: z.number().int().min(1).max(100).default(50),
    waitSeconds: z.number().int().min(0).max(20).default(0), // long poll when no updates are pending
  })
  .strict();
export const getOrderUpdatesOutput = z.object({
  updates: z.array(orderUpdate),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  oldestRetainedSeq: z.number().int(),             // a cursor older than this returns CURSOR_EXPIRED
});

// ---------- errors (MCP isError structuredContent and REST body) ----------
export const orderDeskError = z.object({
  error: z.object({
    code: z.enum([
      "UNAUTHORIZED", "FORBIDDEN_SCOPE", "RATE_LIMITED", "VALIDATION_FAILED", "ORDER_DESK_DISABLED", "ORDER_DESK_PAUSED",
      "FLOOR_UNAVAILABLE", "QUOTE_NOT_FOUND", "QUOTE_EXPIRED", "QUOTE_INFEASIBLE", "IDEMPOTENCY_KEY_REUSED",
      "AGENT_ORDER_CAP", "FLOOR_FULL", "ORDER_NOT_FOUND", "CANCEL_NOT_ALLOWED", "CURSOR_EXPIRED",
    ]),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().optional(),
    issues: z.array(feasibilityIssue).optional(),
  }),
});
```

Rules the schemas encode or the desk enforces:

- **Idempotency.** Keys are scoped per agent. Same key plus same payload fingerprint returns the original result with `replayed: true`. Same key plus different payload returns `IDEMPOTENCY_KEY_REUSED`. This mirrors the command fingerprint ledger (app.ts:1247) and the station adapter rule that duplicate operation ids return the original acknowledgement ([station-adapters](../station-adapters.md)). Keys are kept for the life of the order or 24 hours, whichever is longer.
- **Ownership.** An agent can only see its own orders. Another agent's id returns `ORDER_NOT_FOUND`, not `FORBIDDEN`, to avoid enumeration.
- **Quote validity.** A quote is valid for `ORDER_QUOTE_TTL_MS` (10 minutes) and only within the floor epoch it was computed in. Placement re-runs feasibility; it does not re-price. A quote converts at most once.
- **Cancellation.** Allowed in `placed`, `accepted`, `scheduled`, and `in_production` stage `modules` (projected), because none of those has a committed vehicle. After `UNIT_COMMITTED` the answer is `CANCEL_NOT_ALLOWED` with the committed vehicle id. Partial cancel of a multi-unit order is an open question.

### Resources

| URI | MIME | Auth | Content |
| --- | --- | --- | --- |
| `brickworks://catalog` | `application/json` | anon read | `listVehicleConfigsOutput` |
| `brickworks://capabilities` | `application/json` | anon read | `getCapabilitiesOutput` |
| `brickworks://orders/{orderId}` (template) | `application/json` | owner | `orderView` |
| `brickworks://orders/{orderId}/updates` (template) | `application/json` | owner | last 50 `orderUpdate` |
| `brickworks://docs/ordering-guide` | `text/markdown` | anon read | Short how-to an agent can read before calling tools (same text as the ordering section of `llms.txt`) |

`resources/list` returns the static resources plus the caller's non-terminal orders. The 2026-07-28 spec allows the list to vary by authorization, not by connection, which this satisfies.

### Notifications

- **Protocol `2025-11-25` (what SDK 1.32.x speaks):** the server declares `resources: { subscribe: true, listChanged: false }`. A client calls `resources/subscribe` on `brickworks://orders/{orderId}` and receives `notifications/resources/updated` on its stream whenever that order gets an update (debounced to one per order per second), then calls `resources/read` or `get_order_updates`.
- **Protocol `2026-07-28` (when the SDK supports it):** the same URIs through `subscriptions/listen` with `resourceSubscriptions`. That revision removed protocol sessions, the GET stream, and `resources/subscribe`. The tool design already fits it: every call carries explicit handles (`orderId`, `cursor`), so nothing depends on connection state.
- **`notifications/progress`** on `quote_vehicle` when the client sends a progress token (the forecast can take one to two seconds).
- **Polling is the baseline.** `get_order_updates` with `waitSeconds` works on every client, every protocol revision, and the REST mirror. Notifications are an optimization.

## Transport

- **Endpoint:** `/mcp` on the existing Fastify server and port (3000 locally, 80/443 on Replit). No new process or port.
- **SDK:** add `@modelcontextprotocol/sdk` `^1.32` (peer `zod ^3.25 || ^4`; the lockfile already resolves zod 3.25.76). One `McpServer` per MCP session, tools registered with `registerTool` and Zod input and output schemas so results carry `structuredContent`, resources with `registerResource` and `ResourceTemplate`.
- **Fastify mount:** `app.route({ method: ["GET", "POST", "DELETE"], url: "/mcp" })`. A `preHandler` authenticates the bearer key and validates `Origin` and `Host` (DNS rebinding protection, required by the Streamable HTTP spec; also pass `allowedHosts` to the SDK transport). The handler calls `reply.hijack()` and `transport.handleRequest(request.raw, reply.raw, request.body)` on `StreamableHTTPServerTransport`.
- **Session mode:** stateful (`sessionIdGenerator: randomUUID`) so the 2025-11-25 GET stream and resource subscriptions work. Sessions are bound to the authenticating agent (another key presenting the same `Mcp-Session-Id` gets 404), capped at 50, closed after 15 idle minutes or on `DELETE /mcp`. When the SDK ships 2026-07-28 support, switch to sessionless and `subscriptions/listen`.
- **Limits:** 64 KB request body for `/mcp` and `/api/agent/v1/*`. SSE keepalive comment every 25 seconds so the Replit proxy does not drop idle streams.
- **Routing caveat:** the SPA fallback in `setNotFoundHandler` (app.ts:1693) serves `index.html` for unknown GETs outside `/api/`. `/mcp`, `/llms.txt`, `/mcp/server-card`, and `/.well-known/*` must be registered routes so they never fall through to the SPA. Add Vite dev proxy entries for the same paths (`vite.config.ts` proxies only `/api` today).

## REST and webhook mirror

For agents without an MCP client. Same `OrderDesk` service, same Zod schemas, same errors, same auth.

| Method and path | Equivalent tool |
| --- | --- |
| `GET /api/agent/v1/catalog` | `list_vehicle_configs` |
| `GET /api/agent/v1/capabilities` | `get_capabilities` |
| `POST /api/agent/v1/quotes` | `quote_vehicle` |
| `POST /api/agent/v1/orders` (`Idempotency-Key` header or body field) | `place_order` |
| `GET /api/agent/v1/orders?status=&cursor=&limit=` | `list_orders` |
| `GET /api/agent/v1/orders/:orderId` | `get_order` |
| `POST /api/agent/v1/orders/:orderId/cancel` | `cancel_order` |
| `GET /api/agent/v1/updates?orderId=&cursor=&limit=&wait=` | `get_order_updates` (long poll) |
| `GET /api/agent/v1/orders/:orderId/events` | Server-sent events stream of `orderUpdate`, resumable with `Last-Event-ID` = `seq` |
| `GET /api/agent/v1/openapi.json` | OpenAPI 3.1 generated from the Zod schemas |

HTTP status mapping: `VALIDATION_FAILED` 400, `UNAUTHORIZED` 401, `FORBIDDEN_SCOPE` 403, `ORDER_NOT_FOUND`/`QUOTE_NOT_FOUND` 404, `IDEMPOTENCY_KEY_REUSED`/`CANCEL_NOT_ALLOWED` 409, `QUOTE_EXPIRED`/`CURSOR_EXPIRED` 410, `QUOTE_INFEASIBLE` 422, `RATE_LIMITED` 429 with `Retry-After`, `ORDER_DESK_DISABLED`/`FLOOR_UNAVAILABLE`/`ORDER_DESK_PAUSED` 503.

**Webhooks** (off by default, `ORDER_WEBHOOKS_ENABLED=false`). Outbound calls from the server are an SSRF surface, so the URL is not agent-supplied. Filip sets it per agent key in the key configuration. HTTPS only, resolved address must not be private, loopback, or link-local, body is one `orderUpdate`, header `X-Brickworks-Signature: sha256=<HMAC of body with the agent's webhook secret>`, three retries with backoff (5, 30, 120 seconds), then the update is still available by polling. Delivery is at least once; receivers dedupe by `seq`.

## Auth, rate limits, and caps

**Keys.** Filip generates a random 32-byte key per agent (`bwk_<agentId>_<base64url>`), gives it to the agent owner out of band, and stores only its SHA-256 in the `BRICKWORKS_AGENT_KEYS` secret:

```json
[{ "id": "test-agent", "label": "Test Agent", "sha256": "<hex>", "scopes": ["quote", "order:write", "order:read"], "maxActiveOrders": 3, "webhook": null }]
```

Comparison uses SHA-256 plus `timingSafeEqual`, as `secretMatches` already does (app.ts:205). Keys arrive as `Authorization: Bearer`. Fastify logger redacts `authorization`. Revocation is removing the entry and restarting (or an operator-only reload route). OAuth 2.1 per the MCP authorization spec is deferred until there is a reason for third-party agents to self-register.

**Anonymous reads.** With `ORDER_DESK_ANON_READ=true` (default), `list_vehicle_configs`, `get_capabilities`, the catalog and capabilities resources, the ordering guide, and the discovery documents need no key. Everything else does.

**Rate limits** (in-process sliding windows, same approach as `withinRate`, app.ts:633):

| Bucket | Limit |
| --- | --- |
| Any call, per agent | 60 per minute |
| `quote_vehicle`, per agent | 10 per minute |
| `place_order`, per agent | 3 per minute, 20 per day |
| Concurrent long polls or SSE streams, per agent | 2 |
| Anonymous, per client IP (Fastify `trustProxy` on Replit) | 20 per minute |
| Forecast worker, global | concurrency 1, queue 5, then `RATE_LIMITED` with `retryAfterSeconds` |

**Caps:** quantity 1 to 3 per order; 3 non-terminal orders per agent (overridable per key); 10 non-terminal agent orders on the floor (the engine allows 20; the rest stay for showcase and operator orders); update log retains 5,000 desk-wide and 500 per order; terminal orders kept 7 days, then summarized.

## Safety rules

1. **Virtual everywhere.** Every response carries `virtual: true` and a disclaimer: "Virtual order in the Brickworks simulation. No payment, no physical vehicle, no shipment." Currency is the literal `BWC-VIRTUAL`.
2. **Strict schemas.** Unknown keys are rejected, so payment, address, or contact fields cannot be smuggled in.
3. **No PII stored or logged.** Logs contain agent id, order id, update type, and simulation time only.
4. **Minimal authority.** The desk can issue only `order-agent-create` and `order-cancel`. Agents cannot set priority 1, cannot target stations or modules, and cannot affect other orders. The floor runs in manual mode with no provider calls.
5. **Factory invariants unchanged.** Material conservation, exclusive reservations, one rework attempt, and the checkpoint ledger checks keep applying; the new commands participate in them.
6. **Deterministic.** The floor is seeded. Forecasts are a pure function of the forked checkpoint. Carrier draws use their own random streams (same construction as `FactorySimulation.rng`, index.ts:364, but a separate namespace seeded from the floor seed and the order id), so delivery randomness never perturbs manufacturing replay. Tests drive a manual clock.
7. **Replayable.** Every floor-affecting desk action is an engine command, so it lands in the NDJSON archive with its simulation time. Carrier events are a pure function of the dispatch time, zone, order id, and seed. The desk state can be rebuilt from the archive alone; the persisted desk state is a cache.
8. **Honest provenance.** Every time value says `simulated` or `forecast`. Nothing is labeled measured.
9. **Kill switches.** `ORDER_DESK_ENABLED=false` turns off `/mcp` and `/api/agent/v1/*` (503) and stops the floor. Operator "pause intake" makes `place_order` return `ORDER_DESK_PAUSED` while reads and tracking continue.
10. **Nothing goes live without Filip.** No Replit publish, no keys issued, no registry listing without his explicit yes.

## Delivery simulation

**Hand-off.** Custody passes to the carrier at `vehicle-dispatched`, when the vehicle crosses the customer exit boundary (`SITE_PORTS.customerExit`, `packages/assets/src/design.ts`). `dispatch-start` (driving from the bay to the exit) is still factory custody.

**Carrier.** "Brickworks Virtual Freight", a pure module `packages/orders/src/carrier.ts` advanced on the floor's simulation clock.

| Zone | Legs | Nominal transit (simulated s) |
| --- | --- | --- |
| `zone-local` | customer exit to Local Depot, depot to destination | 120 |
| `zone-metro` | exit to Brickworks Hub, hub to Metro Depot, depot to destination | 300 |
| `zone-regional` | exit to hub, hub to Regional Sort, sort to Regional Depot, depot to destination | 600 |
| `zone-remote` | exit to hub, hub to Regional Sort, sort to Remote Crossdock, crossdock to Remote Depot, depot to destination | 900 |

Leg durations split the nominal total in fixed proportions per zone, scaled by `ORDER_DELIVERY_TIME_SCALE` (default 1).

**Tracking events.** `unit.shipped` (picked up), then per leg `carrier.departed_hub` and `carrier.arrived_hub`, `carrier.out_for_delivery` at the start of the last leg, and `unit.delivered` at its end. `order.delivered` follows the last unit.

**Delays.** Per leg, draw from the carrier stream keyed `carrier:<orderId>:<unit>:<leg>`. Below 0.08 the leg is delayed by a factor drawn in 1.2 to 1.6 with a reason from `virtual-weather`, `virtual-road-closure`, `virtual-hub-backlog`. Emit `carrier.delayed` at the planned end and `carrier.recovered` when the leg completes. ETA is recomputed after every leg.

**Operator and test controls.** Operator `carrier-hold` and `carrier-release` per unit (for QA of the delayed path); test-only `carrier-lose` produces `failed` with `carrier_lost`. None of these are agent-reachable.

**Clock caveat.** If an operator globally pauses the floor, simulated time stops and the carrier stops with it. That keeps replay exact; it is documented in `get_capabilities` text.

**Visual cue (optional, renderer only).** In the 3D world the departing vehicle gets a small tag with its agent order id and zone during `dispatching` (world.ts already animates that phase near line 1841). For a few seconds after `vehicle-dispatched`, an outbound carrier transporter can reuse the delivery truck geometry (`apps/web/src/visuals/delivery-truck.ts`) at the customer exit. In the Orders panel a 2D route strip shows legs, the current position, and ETA. Disabled under reduced motion. Animation never advances an order.

## UI changes

All in `apps/web`. Validated with the same runtime-schema discipline the client already applies to live frames.

1. **Orders tab.** A fifth side-panel tab next to Inspector, Metrics, Controls, and AI (`App.tsx` tab buttons around lines 1478 to 1497, `panel === "orders"`).
2. **Two views in the tab.**
   - *This session:* the existing production order list (today inside Controls, `App.tsx` around 2283) plus a cancel button for queued manual orders using `order-cancel`.
   - *Order floor:* a "Watch order floor" toggle that switches the world and panels to the shared floor through a read-only live stream. A banner says "Shared order floor, read-only. Agent orders run here." Controls are disabled unless the operator enters the access code.
3. **Incoming order feed.** A toast and a feed row when an agent order arrives: "New agent order ao-7k2m9q4x1c from Test Agent: 1 robotaxi, expedite, zone-metro."
4. **Order cards.** Agent label, order id, quantity, lead option, price in `BWC-VIRTUAL`, status chip with text (not color only), at-risk badge with reasons, promised versus latest ETA, and a stepper: placed, scheduled, modules, joining, quality, parked, shipped, in transit, delivered.
5. **Unit detail.** Five line chips labeled from `LINE_META` showing `waiting`, `building`, `ready`, or `reserved`; dashed outline for projected, solid for bound with module id, lot, and rework history. Tracking strip with legs and ETA. The last 20 updates with simulation time and factory event id.
6. **Linking.** Clicking a vehicle id selects it in the Inspector and offers Follow, reusing the existing vehicle selection flow; the Inspector "Order" row (`App.tsx` around 1696) shows the agent order id and agent label when the vehicle belongs to an agent order.
7. **Metrics group "Agent orders"** in the Metrics drawer: active, delivered, cancelled, failed, mean quoted versus actual ship time, on-time share. Labeled simulated.
8. **Live data path.** The floor stream adds a second frame type on `/api/live`, `{ type: "orders", sessionId: "order-floor", sequence, desk: OrderDeskView }`, sent only to floor viewers and at most once per second. `FactorySnapshot` is not changed, so existing clients, checkpoints, and soak expectations stay valid. The web validator learns the new frame type and still rejects anything malformed.

## Agent discovery

Discovery conventions for MCP are still drafts (SEP-2127 server cards, experimental extension; the recommended card location moved from `.well-known` to `/server-card` during 2026, with `/.well-known/mcp/catalog.json` as the domain entry point and older paths treated as transitional). Brickworks serves one generated source in several places so it does not have to bet on one path:

| Path | Content |
| --- | --- |
| `/llms.txt` | Markdown: what Brickworks is, the virtual-only notice, MCP endpoint, REST base, how to request a key (open a GitHub issue; Filip decides), the eight tools with one line each, links to the server card, OpenAPI, and this spec |
| `/mcp/server-card` | SEP-2127 style card: `$schema`, `name` (`io.github.fszale/brickworks-order-desk`), `version`, `description`, `remotes: [{ type: "streamable-http", url: "<PUBLIC_BASE_URL>/mcp" }]`, `repository`, `websiteUrl`, and `_meta` with `virtual: true`, auth type `bearer`, docs link |
| `/.well-known/mcp/catalog.json` | Catalog listing the card URL |
| `/.well-known/mcp.json` | Transitional alias with the same card body (the path named in the request) |
| `/.well-known/agent-card.json` | **Optional, later.** An A2A agent card is only honest if an A2A endpoint exists. Until then, skip it rather than advertise a transport we do not serve |

Rules: all URLs come from `PUBLIC_BASE_URL` so a deployed card never says `localhost`; no keys, tokens, or internal hostnames in any document; GET with `Access-Control-Allow-Origin: *` and short cache headers; a test asserts the tool names in `llms.txt` and the server card equal the registered MCP tools.

## Persistence and recovery

The repo keeps sessions in memory and writes a private NDJSON archive under `.data/archives` ([architecture](../architecture.md), [configuration](../configuration.md)). The order desk follows the same model.

- **In memory:** desk state (quotes, orders with machine snapshots, idempotency index, update log, carrier states, cursor sequence).
- **On disk:** `ORDER_DATA_DIR` (default `.data/orders`, private, never static) holds `order-floor.json` with `{ formatVersion: 1, writtenAt, desk, floorCheckpoint }`, where `floorCheckpoint` is `exportRun()` of the floor. One file, written atomically (temporary file then rename), so desk and factory can never disagree after a crash. Written on every order state change (debounced 1 second), every 30 simulated seconds, and in the `onClose` hook.
- **Archive:** the floor is a normal archived session, so `order-agent-create` and `order-cancel` appear in its NDJSON history with simulation times, and replay reproduces them.
- **Boot:** if `order-floor.json` exists and parses, restore the floor with `FactorySimulation.fromExport` (which imports paused), restore the desk, reconcile (every non-terminal desk order must map to a factory order, a live vehicle, or carrier state; anything that cannot is marked `failed` with `floor_state_lost`), then `start`. Otherwise create a fresh floor.
- **Operator export and import:** `GET /api/order-floor/export` and `POST /api/order-floor/import` (access code required), so the state can be saved before a Replit republish.

## Replit deployment notes

Replit Reserved VM is the final target ([replit-deployment](../replit-deployment.md), `.replit`).

- Same single process and port. `/mcp` and `/api/agent/v1/*` ride the existing `0.0.0.0:3000` to public 80/443 mapping. Do not add replicas: the floor and desk are in memory.
- New secrets (workspace and deployment): `BRICKWORKS_AGENT_KEYS`, optional per-key webhook secrets. New env: `ORDER_DESK_ENABLED` (keep `false` in `.replit` until Filip says yes), `PUBLIC_BASE_URL`, `ORDER_FLOOR_PUBLIC_VIEW`, `ORDER_DESK_ANON_READ`.
- `.data/orders` can be lost on republish, the same caveat that applies to `.data/archives`. Export the floor before replacing a deployment; durable external storage (for example Replit Object Storage) is future work and needs its own yes.
- The always-running floor adds steady CPU even with zero visitors. Re-run the soak (`scripts/soak.mjs`) with the desk enabled before publishing and compare `tickProcessingMs` and memory against the [corrected soak](../review/release-soak-corrected-assessment.md).
- Verify SSE and long polling through the public URL (proxy idle timeouts).
- Published-URL acceptance: discovery documents show the https public URL; `/mcp` without a key returns 401; with a dedicated QA key, a test agent quotes, orders, and sees delivery; then the QA key is revoked; logs contain no keys.
- **Nothing is published, no key is issued, and nothing is listed in an MCP registry without Filip's explicit yes.**

## Test plan

Follows the layers in [test strategy](../test-strategy.md). Do not report anything as passed without evidence; use `NOT RUN` or `BLOCKED` until it exists.

| File (new) | Layer | What it proves |
| --- | --- | --- |
| `tests/order-contracts.test.ts` | Contract unit | Every tool input and output schema accepts the documented examples and rejects unknown keys, PII-looking `agentReference`, bad ids, payment-like fields, and out-of-range values |
| `tests/simulation-agent-orders.test.ts` | Simulation unit | `order-agent-create` and `order-cancel` semantics; `externalRef` round-trips through `exportRun`/`fromExport`; old v1 checkpoints still import; conservation and order-ledger invariants (reuse the `conserve` helper from `tests/simulation-orders.test.ts`); `replayArchive` reproduces a run with agent orders exactly; cancel after `assembly-start` is rejected; `orderId` present on the four post-test vehicle events |
| `tests/order-lifecycle.test.ts` | Unit | Every legal transition; illegal events ignored; terminals final; aggregate status is the least advanced unit; cancel guard |
| `tests/order-bridge.test.ts` | Unit | A seeded floor run's `AuditEntry` stream maps to the expected status sequence; mapping survives order retirement at end-of-line; queue-head projection matches the `nextOrder` rule; rework and fault paths |
| `tests/delivery-sim.test.ts` | Unit | Same seed and order id give identical tracking; delivered exactly once; ETA never earlier than nominal; delay factor within 1.2 to 1.6; carrier draws do not change factory RNG streams |
| `tests/order-quote.test.ts` | Unit | Same checkpoint gives the same quote (byte-equal after removing wall times); expedite is never later than standard; feasibility codes under each scenario fault; the seed never appears in output |
| `tests/order-desk.test.ts` | Service | Placement, idempotent replay, key reuse conflict, caps, quote expiry and epoch invalidation, cancel windows, update cursor paging and `CURSOR_EXPIRED`, persistence round trip and boot reconcile |
| `tests/order-desk-server.test.ts` | Server integration (Fastify `inject`) | REST mirror auth (401, 403), anonymous reads, rate limits (429 with `Retry-After`), ownership (`ORDER_NOT_FOUND` for others), long poll, SSE resume, generic command route rejects `order-agent-create`, floor rejects `reset` with active orders, provider schema rejects both new command types, discovery documents match registered tools |
| `tests/order-mcp-e2e.test.ts` | End-to-end | See below |

**End-to-end scenario.** `buildApp({ orderDesk: { enabled: true, manualClock: true, seed: 42, scenario: "balanced", agentKeys: [testKey] } })`, listen on an ephemeral port, connect the SDK `Client` with `StreamableHTTPClientTransport` and the bearer header, then:

1. `tools/list` returns exactly the eight tools.
2. `list_vehicle_configs`, `get_capabilities`.
3. `quote_vehicle` for one unit, `zone-local`, both lead options; assert `manufacturable` and forecast fields.
4. `place_order` with an idempotency key; call it again with the same key and assert `replayed: true` and the same order id.
5. Subscribe to `brickworks://orders/{orderId}`.
6. Advance the floor through the manual clock until delivered (bounded loop, for example 3,600 simulated seconds).
7. Assert the `get_order_updates` status subsequence: `placed`, `accepted`, `scheduled`, `in_production`, `quality_check`, `completed`, `ready_for_pickup`, `shipped`, `in_transit`, `out_for_delivery`, `delivered`; every factory-sourced update links a real factory event id; at least one `notifications/resources/updated` arrived.
8. Assert actual ship time equals the quoted `shipBySimTime` (no other inputs happened, so the forecast must be exact).
9. Second agent cannot read the first agent's order.
10. Replay the floor archive and rebuild the desk; the update log hash matches.

A second e2e case uses the fault scenario file below and asserts `order.at_risk`, an `estimate.revised`, recovery after repair, and eventual delivery.

## Scenario files

Existing `scenarios/*.json` files are `POST /api/sessions` bodies validated by a strict schema (`createSessionSchema`, app.ts:71), so agent-order scenarios get their own folder and format and do not break that contract.

```jsonc
// scenarios/agent-orders/standard-delivery.json (sketch)
{
  "kind": "brickworks-agent-order-scenario",
  "version": 1,
  "floor": { "scenario": "balanced", "seed": 42 },
  "agents": [{ "id": "test-agent", "scopes": ["quote", "order:write", "order:read"] }],
  "steps": [
    { "at": 0, "agent": "test-agent", "tool": "quote_vehicle",
      "args": { "config": { "modelId": "robotaxi-gold-two-seat", "options": { "finish": "gold" } }, "quantity": 1, "destinationZone": "zone-local" } },
    { "at": 0, "agent": "test-agent", "tool": "place_order",
      "args": { "quoteId": "$steps[0].quoteId", "leadOption": "expedite", "idempotencyKey": "scenario-standard-1" } }
  ],
  "expect": { "finalStatus": "delivered", "maxSimSeconds": 3600, "statusSubsequence": ["scheduled", "in_production", "quality_check", "shipped", "delivered"] }
}
```

Also `scenarios/agent-orders/assembly-outage-delay.json` (operator `fault` `assembly` at a set time, `repair` later; expects `order.at_risk`, `estimate.revised`, then `delivered`) and `scenarios/agent-orders/cancel-before-commit.json` (place then cancel while `scheduled`; expects `cancelled`, engine `ordersCancelled` incremented, ledger intact). Add a section to `scenarios/README.md`.

## Requirements

Status for every row is `PROPOSED` until implementation evidence exists, following the legend in [tests/acceptance-checklist.md](../../tests/acceptance-checklist.md).

| ID | Requirement | Verification |
| --- | --- | --- |
| DF-ORDER-001-R01 | Agent orders enter the existing simulation as `ProductionOrder` records with `source: "agent"` and `externalRef`, through a desk-only `order-agent-create` command | `simulation-agent-orders`, `order-desk-server` |
| DF-ORDER-001-R02 | `order-cancel` cancels only queued orders with no committed vehicle and preserves the order ledger and checkpoint validation | `simulation-agent-orders` |
| DF-ORDER-001-R03 | Order status is derived only from factory events and seeded carrier events, each update linking its source event | `order-bridge`, e2e step 7 |
| DF-ORDER-001-R04 | Lifecycle is an XState 5 machine with the public statuses and reason codes in this spec; terminals are final | `order-lifecycle` |
| DF-ORDER-001-R05 | Pre-commit station progress is labeled `projected`; post-commit progress is `bound` and comes from genealogy | `order-bridge`, UI check |
| DF-ORDER-001-R06 | Exactly eight MCP tools with Zod input and output schemas and `structuredContent` results | e2e step 1, `order-contracts` |
| DF-ORDER-001-R07 | MCP resources for catalog, capabilities, order, and order updates; subscriptions send `notifications/resources/updated` | e2e step 7 |
| DF-ORDER-001-R08 | `get_order_updates` provides cursor paging, retention bounds, and long polling on MCP and REST | `order-desk`, `order-desk-server` |
| DF-ORDER-001-R09 | `place_order` and `cancel_order` are idempotent per agent; key reuse with a different payload is rejected | `order-desk`, e2e step 4 |
| DF-ORDER-001-R10 | Quotes include feasibility issues in the DF-SHOP-001 shape, a versioned virtual price, and forecast lead options; deterministic for a given floor checkpoint | `order-quote` |
| DF-ORDER-001-R11 | With no intervening inputs, actual ship time equals the quoted `shipBySimTime` | e2e step 8 |
| DF-ORDER-001-R12 | Streamable HTTP MCP endpoint at `/mcp` on the Fastify server using the official SDK, with Origin and Host validation | e2e, `order-desk-server` |
| DF-ORDER-001-R13 | REST mirror and OpenAPI generated from the same schemas and service as the MCP tools | `order-desk-server` |
| DF-ORDER-001-R14 | Bearer agent keys stored as hashes; scopes enforced; agents see only their own orders | `order-desk-server` |
| DF-ORDER-001-R15 | Rate limits and caps as tabled; 429 with `Retry-After` | `order-desk-server` |
| DF-ORDER-001-R16 | No payment, address, or contact fields; strict schemas; `virtual: true` and disclaimer on every response; no PII in logs | `order-contracts`, QA log review |
| DF-ORDER-001-R17 | Agents and providers cannot issue factory commands beyond the desk's two; the floor is locked to manual mode; floor reset blocked while agent orders are active | `order-desk-server` |
| DF-ORDER-001-R18 | Delivery leg is a deterministic virtual carrier with legs, ETA, seeded delays, and tracking events, independent of factory random streams | `delivery-sim` |
| DF-ORDER-001-R19 | Floor plus desk persist atomically to `ORDER_DATA_DIR` and restore on boot with reconciliation | `order-desk` |
| DF-ORDER-001-R20 | Floor archive replay rebuilds the same desk update log | e2e step 10 |
| DF-ORDER-001-R21 | Web app Orders tab shows incoming agent orders, per-unit station chips, tracking, and update feed on a read-only floor view | Browser check with screenshot in `docs/review/order-desk/` |
| DF-ORDER-001-R22 | `/llms.txt`, `/mcp/server-card`, `/.well-known/mcp/catalog.json`, `/.well-known/mcp.json` served from one source, matching registered tools, using `PUBLIC_BASE_URL`, with no secrets | `order-desk-server` |
| DF-ORDER-001-R23 | Order desk is off by default and has a kill switch and an intake pause | `order-desk-server` |
| DF-ORDER-001-R24 | Existing behavior unchanged: full prior test suite, typecheck, and build pass; visitor sessions unaffected | `npm test`, `npm run typecheck`, `npm run build` |

## Acceptance criteria

DF-ORDER-001 is done when all of the following have dated evidence:

1. `npm test`, `npm run typecheck`, and `npm run build` pass with the new tests included; prior tests are unchanged in count or the change is explained.
2. The MCP e2e test orders one robotaxi on seed 42 `balanced` and observes every public status through `delivered`, with ship time equal to the quote.
3. The assembly-outage and cancel scenario files run and meet their `expect` blocks.
4. A bundled production server (`npm start`) passes `scripts/agent-order-smoke.mjs`: an SDK client over real HTTP quotes, places, polls, and sees delivery at speed 1 within 20 wall minutes for `zone-local`.
5. A browser check of the Orders tab on the floor view shows an incoming agent order, projected and then bound station chips, the tracking strip, and delivery; screenshot and notes saved under `docs/review/order-desk/`.
6. A soak of at least 30 wall minutes with the desk enabled shows zero conservation deltas, bounded events and update log, and `tickProcessingMs` within 20 percent of the corrected soak's comparable figure.
7. Docs updated: architecture (order desk in the diagram), simulation (agent orders, `order-cancel`), configuration (new env vars), test strategy, acceptance checklist rows, Replit deployment section, and this spec's status.
8. Replit publication is a separate step and happens only after Filip's yes.

## Implementation plan

No application code in this commit. A plan does not authorize implementation ([AGENTS.md](../../AGENTS.md)); Filip's go is needed before work starts.

| Phase | What changes | Done when |
| --- | --- | --- |
| 0 | This spec, README link, DF-SHOP-001 cross-link. | Merged. |
| 1 | Contracts and simulation hooks (tasks 1 to 3). No runtime route. | Typecheck and all tests pass; new engine tests pass. |
| 2 | Pure order core: lifecycle, bridge, carrier, catalog, forecast (tasks 4 to 8). | Unit suites pass and are deterministic. |
| 3 | Desk, floor, auth, REST, MCP, persistence, webhooks (tasks 9 to 14). Flag off by default. | e2e passes on a manual clock. |
| 4 | Discovery, live floor stream, UI, scenarios (tasks 15 to 18). | Browser check recorded. |
| 5 | Docs and verification (tasks 19 and 20). | Acceptance criteria 1 to 7 have evidence. |
| 6 | Replit publish with the desk enabled. | Filip's yes, then published-URL acceptance. |

### Ordered tasks for a Software Engineer bot

Branch: `feat/df-order-mcp`. One commit or small PR per task, each leaving `npm test` and `npm run typecheck` green.

1. **Order contracts.** Add `packages/contracts/src/orders.ts` with the Zod schemas above and export them; add `orderDeskViewSchema` and the `orders` live frame schema to `packages/contracts/src/runtime.ts`. Test: `tests/order-contracts.test.ts`.
2. **Engine hooks.** `ProductionOrder.source` adds `"agent"` and optional `externalRef`; update `productionOrderSchema`; add `order-agent-create` and `order-cancel` to `commandSchema` and `FactorySimulation.command`; add `ordersCancelled` metric; add `orderId` to `parking-route`, `vehicle-parked`, `dispatch-start`, `vehicle-dispatched` data. Test: `tests/simulation-agent-orders.test.ts` (conservation, ledger, checkpoint round trip, old checkpoint import, replay).
3. **Command authority.** Generic `/api/sessions/:id/command` rejects `order-agent-create` (403); test that `validateProviderDecision` rejects both new types; floor-only rule that `reset` is rejected while agent orders are active. Tests in `tests/server.test.ts` or `tests/order-desk-server.test.ts`.
4. **Lifecycle machines.** New workspace `packages/orders` with `lifecycle.ts` (XState 5 `setup`, pure `initialTransition`/`transition`), public status projection, and aggregate status. Test: `tests/order-lifecycle.test.ts`.
5. **Bridge.** `packages/orders/src/bridge.ts`: reducer from `AuditEntry` to lifecycle events, vehicle-to-order map, queue-head projection, station progress (projected and bound), risk flags. Test: `tests/order-bridge.test.ts` using a recorded seeded event fixture.
6. **Carrier.** `packages/orders/src/carrier.ts`: zones, legs, seeded delays in a separate stream, ETA, operator hold and release, test-only lose. Test: `tests/delivery-sim.test.ts`.
7. **Catalog, feasibility, price book.** `catalog.ts`, `feasibility.ts`, `pricing.ts` (`pb-2026-10-v1`). Tests within `tests/order-quote.test.ts`.
8. **Forecast and quote.** `packages/orders/src/forecast.ts` (fork with `exportRun`/`fromExport`, inject, run to horizon, extract times) and `apps/server/src/forecast-worker.ts`; add its esbuild entry to the `build` script. Test: determinism, expedite not later than standard, seed absent.
9. **Order desk and floor.** `packages/orders/src/desk.ts` (quotes, placement, idempotency, cancel, update log, cursors, caps) and `apps/server/src/order-desk/floor.ts` (pinned `order-floor` session exempt from expiry and `maxSessions`, manual mode lock, operator command route, `BuildAppOptions.orderDesk` with `manualClock` for tests). Test: `tests/order-desk.test.ts`.
10. **Auth and limits.** `apps/server/src/order-desk/auth.ts`: parse `BRICKWORKS_AGENT_KEYS`, hash compare, scopes, sliding windows, caps, logger redaction, `trustProxy`. Tests in `tests/order-desk-server.test.ts`.
11. **REST mirror.** `apps/server/src/order-desk/rest.ts`: `/api/agent/v1/*`, long poll, SSE with `Last-Event-ID`, OpenAPI from Zod. Tests in `tests/order-desk-server.test.ts`.
12. **MCP endpoint.** Add `@modelcontextprotocol/sdk` `^1.32`; `apps/server/src/order-desk/mcp.ts` with eight tools, resources, subscriptions, progress on quotes; Fastify `/mcp` mount with hijack, session map bound to agent, Origin and Host checks, keepalive; Vite dev proxy entries for `/mcp`, `/llms.txt`, `/mcp/server-card`, `/.well-known`. Test: `tests/order-mcp-e2e.test.ts`.
13. **Persistence.** Atomic `order-floor.json` writes, boot restore and reconcile, operator export and import routes. Tests in `tests/order-desk.test.ts` (restart round trip, corrupted file, stale checkpoint).
14. **Webhooks (flag off).** Signed, allowlisted, private-address blocked, retries. Test with a local receiver.
15. **Discovery documents.** `apps/server/src/order-desk/discovery.ts` generating `/llms.txt`, `/mcp/server-card`, `/.well-known/mcp/catalog.json`, `/.well-known/mcp.json` from the tool registry and `PUBLIC_BASE_URL`. Test: parity with registered tools; no `localhost` when `PUBLIC_BASE_URL` is set; no secrets.
16. **Live floor stream.** `/api/live` accepts a read-only floor subscription when `ORDER_FLOOR_PUBLIC_VIEW=true`; sends `orders` frames at most once per second; web client validator accepts the new frame. Test in `tests/live-snapshot.test.ts` or a new file.
17. **Web Orders tab.** Tab, floor toggle, order cards, unit station chips, tracking strip, feed, toast, Inspector link, Metrics group; optional 3D tag and carrier cue honoring reduced motion. Evidence: browser screenshots and notes in `docs/review/order-desk/`.
18. **Scenarios.** `scenarios/agent-orders/standard-delivery.json`, `assembly-outage-delay.json`, `cancel-before-commit.json`, a scenario runner used by the e2e suite, and a `scenarios/README.md` section.
19. **Docs.** Update `docs/architecture.md`, `docs/simulation.md`, `docs/configuration.md`, `docs/test-strategy.md`, `tests/acceptance-checklist.md` (new rows `NOT RUN` until evidence), `docs/replit-deployment.md`, the README plan entry status, and this spec's status line.
20. **Verification.** `npm test`, `npm run typecheck`, `npm run build`, bundled-server run with `scripts/agent-order-smoke.mjs`, 30 minute soak with the desk enabled; record results in `docs/release-evidence.md` with the evidence legend. Do not publish to Replit.

## QA checklist

For a QA bot. Record each item as `PASS`, `PARTIAL`, `NOT RUN`, or `BLOCKED` with a dated note.

- [ ] Pull `feat/df-order-mcp`; `npm ci`, `npm test`, `npm run typecheck`, `npm run build` all pass; prior test count unchanged or the change is explained.
- [ ] With `ORDER_DESK_ENABLED` unset, `/mcp` and `/api/agent/v1/*` return 503, no `order-floor` session exists, and visitor sessions behave exactly as before.
- [ ] With the desk enabled, `/api/health` still returns 200 and visitor session capacity is still 10.
- [ ] `tools/list` over MCP returns exactly the eight tools, each with input and output schemas.
- [ ] Anonymous `list_vehicle_configs` and `get_capabilities` work; anonymous `quote_vehicle` returns 401 or `UNAUTHORIZED`.
- [ ] `get_capabilities` and quotes never contain the seed, station wear, or checkpoint internals.
- [ ] Unsupported finish or seat count returns `OPTION_NOT_OFFERED` with a suggestion, not a schema error.
- [ ] Quantity 4 returns `QUANTITY_ABOVE_LIMIT`; a fourth active order for one agent returns `AGENT_ORDER_CAP`.
- [ ] `agentReference` with an email, a URL, a space, or 7 or more consecutive digits is rejected.
- [ ] Unknown keys such as `payment`, `address`, or `phone` are rejected on every write.
- [ ] Every response has `virtual: true`, the disclaimer, and `BWC-VIRTUAL` amounts.
- [ ] `place_order` twice with the same key returns the same order and `replayed: true`; same key with a different lead option returns `IDEMPOTENCY_KEY_REUSED`.
- [ ] An expired quote returns `QUOTE_EXPIRED`; a quote from before a floor epoch change is refused.
- [ ] Cancel while `scheduled` succeeds; the engine shows `ordersCancelled` incremented and conservation and ledger deltas stay zero.
- [ ] Cancel after `unit.committed` returns `CANCEL_NOT_ALLOWED` naming the vehicle.
- [ ] Agent B cannot read, list, cancel, or subscribe to agent A's order (`ORDER_NOT_FOUND`).
- [ ] Rate limits trigger 429 with `Retry-After` at the documented thresholds.
- [ ] Update feed: `seq` strictly increasing, cursor resume works, a cursor older than retention returns `CURSOR_EXPIRED`.
- [ ] Long poll returns early when an update arrives and at `waitSeconds` otherwise.
- [ ] SSE stream resumes from `Last-Event-ID` without duplicates.
- [ ] Resource subscription delivers `notifications/resources/updated` for the subscribed order only.
- [ ] Every factory-sourced update's `factoryEvent.id` exists in the floor's archive with the same type.
- [ ] Standard delivery scenario: ship time equals quoted `shipBySimTime` with no other inputs.
- [ ] Assembly-outage scenario: `order.at_risk` appears, `estimate.revised` appears, risk clears after repair, order is delivered.
- [ ] Carrier: same seed and order id produce identical tracking across two runs; delays only within 1.2 to 1.6 per leg; ETA updates per leg.
- [ ] Floor rejects `reset` while an agent order is active; floor `mode` command is rejected; no provider call is ever made for the floor.
- [ ] Generic session command route rejects `order-agent-create` with 403.
- [ ] Restart: stop the server mid-production, restart, and the order continues from the same state; corrupt `order-floor.json` and confirm a clean fresh floor plus a logged warning; no silently invented data.
- [ ] Archive replay of the floor rebuilds an identical update log hash.
- [ ] Discovery: `/llms.txt`, `/mcp/server-card`, `/.well-known/mcp/catalog.json`, `/.well-known/mcp.json` return 200, list the same eight tools, use `PUBLIC_BASE_URL`, and contain no keys or `localhost` when the base URL is set.
- [ ] SPA fallback does not swallow `/mcp` or discovery paths.
- [ ] An `Origin` header from a foreign site is rejected on `/mcp`.
- [ ] Server logs contain no bearer keys or key hashes.
- [ ] Web Orders tab: incoming order toast; card with status text and ETA; projected chips dashed before commitment and bound chips with module id and lot after; tracking strip; Inspector link selects the right vehicle; read-only banner on the floor; controls disabled without the access code; reduced motion disables the carrier cue.
- [ ] A malformed `orders` live frame is rejected by the client without breaking the factory view.
- [ ] 30 minute soak with the desk enabled: zero conservation deltas, bounded memory, bounded update log, no stream errors.
- [ ] No Replit publish, key issuance, or registry listing happened during QA.

## Risks and open questions

1. **Modules are not order-specific until joining.** Per-station progress before `assembly-start` is a projection and can change if a higher-priority order arrives. The spec labels it; an agent that wants only facts should key on `binding: "bound"`.
2. **Engine cap of 20 active orders,** shared with showcase and operator orders. The desk caps agent orders at 10. Raising the engine cap is a separate simulation change.
3. **No cancellation exists today.** `order-cancel` is new engine behavior. In finite mode, cancelling can leave accepted modules in buffers with no demand; they are used by the next order or sit idle. Acceptable for v1, worth a test.
4. **Partial cancel of multi-unit orders** after some units commit: not supported in v1. Open question whether to allow cancelling uncommitted remaining units.
5. **Orders retire at end-of-line,** before parking and dispatch. The desk must keep tracking units after the factory order is gone; adding `orderId` to the four vehicle events removes the need for a fragile vehicle map.
6. **Reset wipes orders.** The floor blocks `reset` while agent orders are active; a forced reset fails them with `floor_reset`. Decide whether operators ever need a forced reset.
7. **Forecast is exact only absent new inputs.** Other agents' orders and operator faults change reality; `estimate.revised` reports that. Forecast cost is a forked run of up to 3,600 simulated seconds in a worker, bounded by concurrency 1 and per-agent quote limits. Measure actual latency before fixing the horizon.
8. **MCP spec churn.** SDK 1.32.1 speaks up to `2025-11-25`; spec `2026-07-28` removed protocol sessions, the GET stream, and `resources/subscribe`. Polling with cursors is the stable baseline; subscriptions must be revisited when the SDK moves.
9. **Discovery paths are not standardized.** Serving several aliases from one source hedges; expect to change paths when SEP-2127 graduates. The A2A agent card is deferred until there is an A2A endpoint. Filip to confirm that is acceptable.
10. **Always-on floor cost.** Steady CPU on the Reserved VM even with no visitors. Needs a soak before publishing.
11. **Data loss on republish.** `.data/orders` is not durable across Replit deployment replacement. Export first; durable storage is a later decision that needs Filip's yes.
12. **Public exposure.** Anonymous catalog reads and a public read-only floor are low risk but are still internet-facing surfaces. Keys are issued only by Filip. Should the floor view be public by default on Replit?
13. **Virtual price could be mistaken for an offer.** Mitigated by the literal currency, disclaimers, and no payment fields. Should the price book be tied to simulated cost estimates instead? This spec says no, to avoid implying economics.
14. **Wall time versus simulated time.** ETAs are given in both. If an operator changes floor speed, wall-clock ETAs shift; `estimate.revised` covers it.
15. **DF-SHOP-001 previously listed "Brickworks as a shop that exposes its own MCP" as out of scope until a physical plant exists.** This spec scopes it to the virtual factory only; a real-plant seller endpoint remains out of scope, and DF-SHOP-001 is updated to say so.

## Out of scope

- Real payments, credit, invoices, or any real currency.
- Real shipping, carriers, addresses, or contact data.
- Changing manufacturing physics, `LINE_META`, or the recipe.
- OAuth 2.1 authorization server and dynamic client registration.
- A2A protocol endpoint.
- Durable external storage and multi-instance deployment.
- Publishing to Replit, issuing agent keys, or listing in any MCP registry without Filip's explicit yes.
- Publishing a "standard". Like DF-SHOP-001, this is a draft for discussion.
