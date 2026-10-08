# DF-ORDER-001 Orders tab browser check

Status: local evidence only. **Not deployed.** Replit publish requires Filip's yes.

- Date: 2026-10-08 (run at about 01:38 to 01:40 EDT; the timestamps in `browser-check-notes.txt` are UTC).
- Branch: `feat/df-order-mcp`.
- Server: bundled `node dist/server/index.js` after `npm run build`, on `127.0.0.1:3917`.
- Env: `ORDER_DESK_ENABLED=true` and `ORDER_FLOOR_PUBLIC_VIEW=true`, with a temporary `ORDER_DATA_DIR`. A throwaway `BRICKWORKS_ACCESS_CODE` and a throwaway agent key were generated in memory. Only the key's sha256 reached the server, and neither value was written or printed.
- Browser: headless Google Chrome 154 driven by `playwright-core` with SwiftShader WebGL, so the 3D view renders at about 1 FPS. The driver is [`browser-check.mjs`](browser-check.mjs). It is not part of CI.
- Order: one robotaxi placed through the REST mirror (`zone-metro`, `expedite`) by "Test Agent". The floor runs at speed 1 until the vehicle is linked in the Inspector, then the operator route sets speed 10 to finish delivery quickly.

## Screenshots

| File | What it shows | Result |
| --- | --- | --- |
| [01-floor-read-only.png](01-floor-read-only.png) | "Watch order floor" is on. The banner reads "Shared order floor, read-only. Agent orders run here." The control dock is dimmed and `inert` without the operator code. | PASS |
| [02-incoming-order-toast.png](02-incoming-order-toast.png) | Toast and feed row: "New agent order ao-2bgjiz6ru5 from Test Agent: 1 robotaxi, expedite, zone-metro." The card shows status text, price in `BWC-VIRTUAL`, promised and latest ETA, and the stepper. | PASS |
| [03-projected-chips.png](03-projected-chips.png) | Before commitment, all five line chips are dashed with `binding: projected`. | PASS |
| [04-bound-chips.png](04-bound-chips.png) | After `assembly-start`, the chips are solid with module id and lot; the stepper is at "joining". | PASS |
| [05-inspector-link.png](05-inspector-link.png) | Clicking the vehicle id selects `taxi-1` in the Inspector. The new "Agent order" row shows the order id and agent label, with a "Follow vehicle" button. | PASS |
| [06-tracking-strip.png](06-tracking-strip.png) | In transit: a virtual carrier tracking strip with legs, planned and actual times, delay flag and ETA, plus recent updates with factory event ids. | PASS |
| [07-delivered.png](07-delivered.png) | The status chip reads "Delivered" and the stepper is complete. | PASS |
| [08-metrics-agent-orders.png](08-metrics-agent-orders.png) | Metrics drawer, "Agent orders" group (active, delivered, cancelled, failed, mean quoted and actual ship, on-time share), labeled simulated. | PASS |
| [09-operator-unlocked.png](09-operator-unlocked.png) | After the operator code is entered and checked against `/api/order-floor/status`, the controls are no longer inert. | PASS |
| [10-this-session.png](10-this-session.png) | Back on the visitor session: the "This session" order list, with Cancel offered for queued orders that have no completed units. | PASS |

Other observations from the run:

- Browser console errors: none.
- The server log contained neither the key, its hash, nor the operator code.

## Notes and limits

- The optional 3D order tag and carrier cue (spec task 17, "optional") are not implemented. The reduced-motion rule therefore applies only to the toast entrance animation, which the existing `prefers-reduced-motion` block already shortens.
- Malformed `orders` frames are covered by `tests/order-web-floor.test.ts` against the same `parseLiveFrame` the client uses. It was not exercised by injecting frames into the browser.
- Promised versus latest ETA differ in 06 and 07 because the operator changed floor speed after the quote. That is an input the forecast could not know about, and `estimate.revised` reports it as the spec intends. With no other inputs the ship time matches the quote exactly (see the smoke run in `docs/release-evidence.md`).
- When the linked vehicle has already left the floor, clicking its id shows a notice pointing to the tracking strip instead of opening an empty Inspector.
