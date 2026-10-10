# Test strategy

## Test layers

| Layer | Focus | Evidence |
| --- | --- | --- |
| Contract unit tests | schemas, IDs, default config, versioning | deterministic assertions |
| Simulation unit tests | station transitions, lots, carts, joining, metrics, faults | seeded snapshots and event sequences |
| Server integration tests | API, WebSocket, revision/epoch rejection, export/replay, provider isolation | Fastify test instance with fake adapters |
| Browser component tests | controls, mode affordances, status, charts, audio preference persistence | DOM behavior with mocked transport/audio |
| End-to-end acceptance | delivered user workflow through the visual factory | completed checklist with run evidence |
| Order desk tests (DF-ORDER-001) | order contracts, engine agent-order hooks, lifecycle, bridge, carrier, quote, desk, server, webhooks, web floor helpers, the virtual notice on every REST route, MCP tool, resource and transport error (`order-virtual-notice`), and rate-limit ordering (`order-rate-limits`) | `tests/order-*.test.ts`, `tests/simulation-agent-orders.test.ts`, `tests/delivery-sim.test.ts` with seeded floors and manual clocks; throwaway keys generated per run |
| Order desk end to end | MCP SDK over real HTTP against `buildApp`, plus the three `scenarios/agent-orders` files through `tests/helpers/agent-order-scenario.ts` | `tests/order-mcp-e2e.test.ts`; the bundled-server check is `scripts/agent-order-smoke.mjs` and the long run is `scripts/agent-order-soak.mjs` |
| Experiment tests | paired-seed comparison reproducibility | all ten seed rows, aggregate deltas, and population standard deviations; explicitly configured profiles with no simulated AI |

## Invariants

Tests should establish these properties for every supported seed and scenario: inventory never becomes negative; a joined vehicle has exactly one accepted module from each line; every module/vehicle/cart transition is valid; completed and dispatched counts are monotonic; a reset changes epoch; stale commands cannot apply; decisions never bypass command validation; and exports import to an equivalent replay checkpoint.

Test all eight scenarios and each operating mode. The seven non-`balanced` scenarios are the required fault or edge-condition demonstrations. A release needs one recorded paired baseline/candidate comparison using ten identical seeds. Do not describe an unexecuted test as passed; use `NOT RUN` or `BLOCKED` until evidence exists.

The executable and manual acceptance inventory is [tests/acceptance-checklist.md](../tests/acceptance-checklist.md).

Order desk invariants: a forecast with no intervening inputs equals the observed ship time; every factory-sourced order update links a real factory event id; archive replay rebuilds the same update log digest; one agent never sees another agent's orders; the seed and checkpoint internals never appear in agent output; and the desk is off unless `ORDER_DESK_ENABLED=true`.
