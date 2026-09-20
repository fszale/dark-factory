# Browser controls acceptance

Date: 2026-09-19. Browser verification used an isolated Chrome tab at `http://localhost:5173`; it did not use the graphical-review tab or production server.

## Evidence

- [Controls capture](review/controls.png) is a 1544 × 825 PNG captured from the isolated live session. It shows the world view, 10× simulation control, line status, the bounded configuration form, separate audio channels, and graphical replay.
- The screen reader/accessibility tree reported live visual frame rates between 22 and 113 FPS during the run. This is an observed development-server reading, not a performance claim for another host or production deployment.

## Observed results

| Check | Result | Observation |
| --- | --- | --- |
| Start, pause, speed | PASS | Started from paused; the header changed to `LIVE SIMULATION`. A subsequent 10× selection applied without a stale-revision error. Replay later returned a paused session at the requested 1:40 simulated time. |
| Site fault and repair | PASS | Invoked Supply then Clear all site faults while running. The controls stayed usable and no command error was shown. |
| Metrics and units | PASS | The Metrics drawer showed grouped production, quality, logistics, operations, AI/archive, and line condition data. It identified inspection rejects and rework as modules and labeled time, energy, and cost as simulated units. |
| Paired comparison | PASS | The configured-profile comparison completed with 10 named seeds, all returned baseline/candidate/difference rows, candidate standard deviations, configuration disclosure, and a per-seed variation disclosure. It stated that it does not call or imitate an AI policy. |
| Configuration and manual surface | PASS | Verified site faults, line profile, buffer (1–8), paused-only layout edit, release/reorder/delivery/dwell/parking/order settings, and continuous orders. Parking capacity visibly caps at 12. |
| Audio enable and mix | PASS, visual control behavior | Enabled the top-bar factory sound control, adjusted Master to 40%, and reloaded the isolated tab. Master persisted at 40%; the other persisted defaults were represented exactly (22%, 36%, 58%) after changing the range step to 1%. Audible output and spatial balance were not independently instrumented in this pass. |
| Vehicle genealogy and follow | PASS | Followed `taxi-9`; Inspector showed phase, quality, slot, creation/completion times and all five module rows with line, module ID, lot, timestamp, and rework count. |
| Graphical replay | PASS | Entered 100 simulation seconds. The application switched to a new paused session at 1:40, with controls and snapshot state restored. |

## Limitations

This pass did not exercise quota-truncated replay rejection, a failed command-boundary assertion, full-history download contents, capture/download persistence, real Astra/Jev requests, browser audio output quality, or deployed/Node 22/Replit behavior. Those remain separate acceptance checks.

## Keyboard baseline — production-local check

On 2026-09-19, an isolated browser tab at `http://localhost:3008` tabbed first to the canvas and then to the named `Toggle dusk` button. Space activated that control. Four further Tab presses reached `Toggle details`; Enter opened the details panel and exposed its Inspector, Metrics, Controls, and Intelligence tabs. This demonstrates native keyboard focus and activation for those tested controls on the pre-polish production-local build.

The current source adds explicit `aria-label`/state attributes to icon controls, a high-contrast `:focus-visible` outline, and a `prefers-reduced-motion` rule. Those source changes passed TypeScript checking but were deliberately not rebuilt or visually rechecked while the active soak remains in progress. This is a bounded keyboard smoke check, not accessibility certification.


## Final receiving and recovery acceptance — 2026-09-19

Against the final production runtime on localhost:3009, reviewed the truck with five colored brick pallets at 23 simulated seconds and paused at 35 seconds to capture actual sorting. The pallets visibly separate on the receiving conveyor toward their line-specific racks (`review/delivery-arrival-1080p.png`, `review/sorting-1080p.png`). Authoritative sorting holds warehouse acceptance until completion; its focused test is included in the 66-test suite.

Two repeated browser reloads at 35 seconds reconnected to the same paused factory. Server health remained exactly one active session and one viewer. The production server was then terminated and restarted while the browser remained open; the socket recovered automatically into a new paused session at the saved 35-second checkpoint. Server health again showed one session/one viewer. This distinguishes normal-tab reconnect from restart recovery and avoids session-cap exhaustion on reload. The saved checkpoint is retained on connection/import failure. Session authentication is held in tab-scoped sessionStorage; provider API credentials never enter browser storage.

## Integrated release review — 2026-09-19, port 3010

Production build passed TypeScript and all 89 automated tests. In the actual browser, added a three-vehicle priority-2 order and observed `order-2` queued alongside the showcase order. Paused at 31 simulated seconds and selected Sorting: the truck and five colored loads are visible between the receiving dock and dedicated racks; screenshot `review/sorting-release.png`. Truck inspector showed accepted lot-1, five cargo families of 15 kits each, sorting start 0:30/end 0:44. Cart inspector showed five front-line kits, warm-start lot, loading phase, simulated charge, and scheduled transfer time.

Metrics showed 75 sorting kits and zero receiving/material conservation deltas. Application monitoring showed 14 ms approximate stream lag, 0.3 ms validation, zero rejected updates, zero reconnects and zero reported errors in this review. These are a short observation, not an endurance result. Current-configuration comparison completed ten paired seeds, returned per-seed variation and captured configuration provenance; identical configurations produced zero differences. CSV and JSON controls produced download notifications; saved-file contents were not inspected in this browser review.

At the time of this integrated browser review, live providers were unconfigured. Subsequent authorized checks exercised both adapters and are recorded under “Live provider follow-up” below. The new `review/release-soak.json` is the current production runtime endurance report; the older `review/wall-clock-soak.json` pertains to an earlier server runtime. Neither is a passed two-hour result until its status says passed.

The expanded history selector was browser-verified on the same 3010 session at 7:41 simulated time: selecting Parking occupancy changed the chart, accessible chart label, units, 0–3 vehicle range, latest value of 2, and simulation-time axis. The live-policy experiment card correctly reflected provider availability in that historical run; this UI observation itself is not provider evidence.

## Live provider follow-up — 2026-09-19

Authorized local checks later returned genuine Astra and Jev advisories. Astra autonomously applied a validated front-station repair; a distinct run retained a complete 120-simulated-second observational aftermath. A browser Astra response requested a bounded ten-seed `front:gentle` experiment without changing the live factory profile. Jev completed an authenticated adaptive comparison with ten paired seeds, two checkpoints per seed, and twenty live decisions under the twelve-per-minute limit. Jev chose hold throughout, so all sixteen candidate metrics matched baseline exactly. The sanitized traces and their limits are linked from [release evidence](release-evidence.md); these results do not establish broad provider quality or long-run reliability.

## Station pause and staged assembly — final integrated build

On the rebuilt 3010 runtime (2026-09-19), browser restart recovery restored the prior session at 7:41 simulation time in a paused state. Battery & floor was paused independently at 46.7% processing progress; starting the factory left that module held while the other lines loaded/processed, vehicles parked, and a new truck approached. After 19.9 simulated seconds, resuming the line advanced the same module from 46.7% to 47.1% without replacing its ID or lot. The inspector showed current draw changing from 0.12 simulated A during hold to 1.5 simulated A on resume. Screenshot `review/staged-battery-paused.png` shows a partially constructed battery tray, deposited cells, the paused station, and the live equipment timing panel. This was a real UI/API check, not an injected browser state.

The displayed module and finished-vehicle geometry now use the same authored component helper. Battery cells are individually staged; station pause uses the held phase and timestamp for graphics as well as authoritative scheduling. The global simulation continued during the held-line review.

## Download diagnostics

The final client uses attached download anchors and retains blob URLs for 30 seconds while the browser begins its transfer. On 2026-09-19 the embedded browser emitted `Page.downloadWillBegin` for `brickworks-5b690180.json`, reporting an 18,041-byte checkpoint, then `Page.downloadProgress` with `state: canceled` and zero received bytes. Its supported download-event helper timed out; changing download behavior is unsupported by this browser tool. No download preference was changed. Therefore local browser file saving remains **unverified in this embedded browser**, despite successful authenticated API export/import/history-content tests. Do not treat the UI’s export notice as proof of a saved file. The normal-browser download path remains implemented with standard Blob/anchor behavior.

## Rework genealogy — production browser, 2026-09-19

Paused the independent browser session at 6:25 and selected retained module `module-front-9` using Follow active entity. The inspector showed its warm-start lot, creation at 4:18, accepted status, and exactly one rework. Its visible timeline was: inspection rejected at 4:45, attempt 1, axle alignment; rework started at 4:45, attempt 2, axle alignment; inspection passed at 5:00, attempt 2. Saved `review/rework-inspector.png` and `review/rework-inspector.txt`. Resumed the browser factory after inspection. The separate endurance session was untouched.
