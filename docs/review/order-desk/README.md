# DF-ORDER-001 Orders tab browser check

Status: local evidence only. **Not deployed.** Replit publish requires Filip's yes.

- Date: 2026-10-08. The current screenshots and notes come from the re-run at about 04:43 to 04:46 EDT, after the toast fix (the timestamps in `browser-check-notes.txt` are UTC). The first run was at about 01:38 to 01:40 EDT.
- Branch: `feat/df-order-mcp`.
- Server: bundled `node dist/server/index.js` after `npm run build`, on `127.0.0.1:3917`.
- Env: `ORDER_DESK_ENABLED=true` and `ORDER_FLOOR_PUBLIC_VIEW=true`, with a temporary `ORDER_DATA_DIR`. A throwaway `BRICKWORKS_ACCESS_CODE` and a throwaway agent key were generated in memory. Only the key's sha256 reached the server, and neither value was written or printed.
- Browser: headless Google Chrome 154 driven by `playwright-core` with SwiftShader WebGL, so the 3D view renders at about 1 FPS. The driver is [`browser-check.mjs`](browser-check.mjs). It is not part of CI.
- Order: one robotaxi placed through the REST mirror (`zone-metro`, `expedite`) by "Test Agent". The floor runs at speed 1 until the vehicle is linked in the Inspector, then the operator route sets speed 10 to finish delivery quickly.

## Screenshots

| File | What it shows | Result |
| --- | --- | --- |
| [01-floor-read-only.png](01-floor-read-only.png) | "Watch order floor" is on. The banner reads "Shared order floor, read-only. Agent orders run here." The control dock is dimmed and `inert` without the operator code. | PASS |
| [02-incoming-order-toast.png](02-incoming-order-toast.png) | Captured while the toast is up (bottom right): "New agent order ao-7i3chnj5cs from Test Agent: 1 robotaxi, expedite, zone-metro.", plus the matching feed row and the card with status text, price in `BWC-VIRTUAL`, promised and latest ETA, and the stepper. Before the capture, the driver asserts the toast is really visible: Playwright `isVisible()`, a bounding box inside the 1600x1000 viewport (`x 1224, y 894, 360x50`), computed opacity 1, and the toast itself at `elementFromPoint` of its center, so nothing covers it. | PASS |
| [02b-incoming-order-toast-detail.png](02b-incoming-order-toast-detail.png) | Close-up of the same toast, taken after screenshot 03 while it is still up. The same assertions passed again after this capture and again 23.1 s after the toast appeared, all at opacity 1. The toast then dismissed itself after 31.5 wall seconds at this client's roughly 1 FPS (see the toast fix below). | PASS |
| [03-projected-chips.png](03-projected-chips.png) | Before commitment, all five line chips are dashed with `binding: projected`. The toast is still visible in this capture. | PASS |
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

## Toast fix (QA item 34)

QA could not see the toast on screen in three attempts at `7484161`, though it was in the DOM. The first `02` capture also showed only the feed row. Root cause, measured in this headless SwiftShader browser, where `requestAnimationFrame` ran at 1.5 FPS:

- The entrance keyframes started at `opacity: 0`. At about 1 FPS the 0.25 s animation barely advanced, so the toast's computed opacity stayed 0 for more than a second after mount. The old capture fired at exactly that moment.
- The 6 second `setTimeout` started at mount and ran on wall time, while the main thread was starved by the 3D render. A sampler in the page stalled for 5 s, and the toast reached opacity 1 only just before the timer removed it. So a slow client got essentially no painted frames of a visible toast.

Fix: the entrance animation now slides only and is fully opaque from its first frame (no animation under `prefers-reduced-motion`). `OrderToast` runs its countdown on painted animation frames (`toastFrame` and `toastExpired` in `apps/web/src/orderFloor.ts`, unit tested in `tests/order-web-toast.test.ts`):

- The countdown starts at first paint.
- Each frame credits at most 250 ms, so a starved main thread cannot burn the 6 seconds.
- No credit is given while the tab is hidden or the toast is hovered or focused.
- The toast never expires before 3 painted frames.
- A 30 second foreground ceiling bounds very slow clients.

At 60 FPS the toast stays up exactly 6 s. In this roughly 1 FPS browser it stayed up 31.5 wall seconds.

Live stream frames are now batched per task: every frame is still validated and counted if malformed, but only the newest snapshot and desk are rendered. A burst that queues behind a slow 3D frame therefore costs one React render instead of one per frame.

## Stream lag probe (QA item 34)

QA saw the page lag the live stream by 5 to 11 minutes at about 1 FPS. Stream handling does not depend on `requestAnimationFrame`: WebSocket messages are handled in their own tasks, and only the Babylon render loop runs on animation frames. `lag-probe.mjs` measures it. It opens the Orders tab in headless Chrome with SwiftShader, sets the floor to speed 10, places an order every 3 minutes, and compares the server floor clock with the page clocks once a minute.

Result at `b45981d` (2026-10-08, 04:53 to 05:04 EDT, [lag-probe-notes.txt](lag-probe-notes.txt)): rAF ran at 1.0 to 1.3 FPS for 10 minutes. The header clock trailed the server by 0 to 5 sim seconds, and the desk floor time by 1.3 to 10 sim seconds, which is at most about 1 wall second at speed 10. The gap did not grow over the run. Multi-minute lag did not reproduce here. A slower or more contended machine than this one, or a longer session than QA's, is still untested.

The notes come from the same measurement loop before it was moved into this folder. The committed copy adds only the console error and secret-in-log lines at the end, which the recorded run does not have.

## Notes and limits

- The optional 3D order tag and carrier cue (spec task 17, "optional") are not implemented. The reduced-motion rule therefore applies only to the toast entrance animation, which is turned off under `prefers-reduced-motion`.
- Malformed `orders` frames are covered by `tests/order-web-floor.test.ts` and `tests/order-web-toast.test.ts` (the batch reducer counts every malformed frame) against the same validator the client uses. This driver does not inject frames. QA Helper injected 6 malformed frames live at `7484161` and saw 6 rejections (item 35 PASS).
- Promised versus latest ETA differ in 06 and 07 because the operator changed floor speed after the quote. That is an input the forecast could not know about, and `estimate.revised` reports it as the spec intends. With no other inputs the ship time matches the quote exactly (see the smoke run in `docs/release-evidence.md`).
- When the linked vehicle has already left the floor, clicking its id shows a notice pointing to the tracking strip instead of opening an empty Inspector.
