# Session scenarios

These JSON request bodies can be submitted to `POST /api/sessions` or selected from the application scenario control. Each starts seed 42; change the seed to examine variation. `empty` starts without opening stock. Other cases use explicitly recorded opening kits.

`shortage`, `congestion`, `assembly-outage` and `dispatch-blockage` set sustained disruptions; repair them through the site controls to observe recovery. `slow-exterior` changes the exterior cycle profile and `gripper` starts degraded equipment. Use station maintenance to recover the gripper and an operating profile change to rebalance the slow line.

## Agent-order scenarios (DF-ORDER-001)

`scenarios/agent-orders/*.json` are not session bodies. They use their own format (`"kind": "brickworks-agent-order-scenario"`, `"version": 1`), so the strict `POST /api/sessions` schema is unchanged. They drive the virtual order desk on the shared order floor. Every order is virtual, with no payment, address, or shipment.

| File | What happens | Expectation |
| --- | --- | --- |
| `standard-delivery.json` | One gold robotaxi, expedite, `zone-local`, on seed 42 `balanced`, with no other inputs | `delivered`, and the actual ship time equals the quoted `shipBySimTime` |
| `assembly-outage-delay.json` | The same order, `standard`, `zone-metro`. An operator site fault `assembly` at 40 simulated seconds, then a site repair at 160 | `order.at_risk`, `estimate.revised` and `order.risk_cleared` appear, then `delivered` |
| `cancel-before-commit.json` | A two-unit order cancelled 5 simulated seconds after placement, while it is `scheduled` | `cancelled`, the engine `ordersCancelled` is at least 1, and conservation and ledger deltas are zero |

Format:

- `floor` holds `scenario` and `seed`.
- `agents` holds `id`, `label` and `scopes`. The runner generates a throwaway key for each agent and only the key's hash reaches the server.
- `steps` run in order of `at`, the floor simulated time:
  - a tool step names `agent`, `tool` (one of the eight MCP tools) and `args`;
  - an operator step names `operator`, a floor command such as `fault` or `repair`.
- An `args` string like `"$steps[0].quoteId"` or `"$steps[1].order.orderId"` resolves to a field of an earlier step's structured result.
- `expect` holds `finalStatus`, `maxSimSeconds`, `statusSubsequence` and `updateTypes`, plus optional `shipMatchesQuote`, `engine.ordersCancelledAtLeast` and `ledgerIntact`.

The runner is `tests/helpers/agent-order-scenario.ts`. It builds the app with the desk enabled on a manual clock, connects one MCP SDK client per agent over Streamable HTTP, and sends operator steps to `POST /api/order-floor/command`. It reports every unmet expectation. `tests/order-mcp-e2e.test.ts` runs all three files.
