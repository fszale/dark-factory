# Verification evidence

This document records checks actually executed. Simulation evidence is not proof of physical buildability, real machine reliability, browser frame rate, or successful paid-provider operation.

## Simulation acceptance — PASS

Executed from the project root:

```sh
npx vitest run --root . tests/simulation*.test.ts
```

Result: **52 tests passed across 6 files** on Apple M5 / macOS arm64. The installed runtime used for this measurement was **Node v26.4.0**, rather than the deployment target of Node 22. Node 22/container verification is a separate deployment check.

Verified behaviors:

- All five production lines begin work concurrently. Final assembly reserves exactly one accepted module of each type.
- Empty start consumes no material until a delivery has arrived and unloaded. Materials retain their receiving-lot identity through manufacturing, assembly, and dispatch.
- Warehouse stock, line-side stock, cart cargo, consumed kits, rejected modules, live modules, live vehicles, and dispatched vehicles conserve material.
- Twelve physical parking bays are enforced in configuration and imported checkpoints. Finite parking capacity blocks final assembly and eventually upstream lines. Repairing dispatch releases the backlog. Both road directions share one exclusive, oldest-ready reservation; tests found no overlapping reservations while cycling through dispatch blockage and recovery.
- Front/rear/battery/interior/exterior inputs are not duplicated or consumed twice.
- Interrupted station work resumes after maintenance. An assembly outage now freezes the committed vehicle's remaining joining/testing duration; repair does not instantly finish previously interrupted work.
- Every canonical scenario runs and makes production/dispatch progress after applicable recovery: balanced, shortage, slow exterior, gripper degradation, congestion, assembly outage, dispatch blockage, and empty start.
- A recorded schedule of Astra/Jev-attributed actions produces identical states and metrics when reapplied at the same simulation times and seed, without invoking providers. These records are deterministic test fixtures, not evidence of live AI.
- Control revisions track accepted commands rather than clock ticks; normal production does not falsely reject operator controls. An intervening control mutation invalidates an earlier revision. Pausing, changing mode, and resetting invalidate earlier epochs/revisions. Repeated command IDs do not repeat maintenance or its cost.
- Checkpoints resume paused, discard pending decisions, preserve random streams, lot ledgers, and the bounded command-idempotency ledger, and reproduce future manufacturing outcomes. Reusing a retained command ID with different content remains rejected after import.
- Malformed/nonfinite checkpoints, duplicate component ownership, invalid parking reservations, and fractional material/capacity settings are rejected.
- Finite three-vehicle orders terminate without unlimited component production.

## Production-order scheduling — PASS

Six additional regression tests verify actual first-vehicle assignment after an order priority change, no committed-job preemption, recipe-defined joining order, finite completion across multiple orders, 20-order admission limits, malformed commands, checkpoint restoration and corruption rejection, legacy v1 migration, and deterministic replay of an order-creation schedule. A 7,200-second accelerated simulation with one-unit rolling orders completed more than 100 orders while retaining at most one active showcase order, preserving every completion and dispatched order ID in the audit subscription, and reconciling material and order ledgers throughout. This is simulated-time evidence, not another two-hour wall-clock browser soak.

## Material priority, detailed history, and decision aftermath — PASS

Focused tests show that an exterior priority of 1 changes the first real material allocation from front to exterior when one shared loader is available. Changing rear priority then changes the next eligible allocation while the committed exterior cart remains uninterrupted. A two-loader case proves concurrent capacity enforcement, same-family destinations, rejection of shrinking below committed work, conservation, and identical checkpoint continuation.

Successful reworked modules retain `inspection-rejected → rework-started → inspection-passed` with simulation timestamps in active state, dispatched vehicle genealogy, disk-stream lineage entries, and checkpoints. Failed rework retains both rejected inspections and the terminal scrap event. History length is bounded at four entries per module.

A recorded observational decision aftermath survives checkpoint import and archive replay without invoking a provider. Its baseline, later measurement, deltas, and `observational-not-causal` interpretation are preserved. This verifies audit mechanics with a test fixture; it does not establish a real model decision or causal benefit.

The numerical soak samples below were taken before configurable material loading priorities and detailed history were added. Current simulation regression tests still include a two-hour simulated conservation/retention run; the earlier numerical samples remain labeled historical measurements rather than a new full-runtime acceptance claim.

## Authoritative receiving/sorting boundary — PASS

Accepted cargo now remains in a discrete `sorting` phase for **14 simulated seconds** after receiving inspection. Its lot remains in truck custody, the receiving dock remains occupied, and no kit enters warehouse stock or production until sorting completes. Sorting fans the five kit families into dedicated storage destinations. Rejected lots skip sorting and leave with their cargo.

The focused test observes an empty-start truck enter sorting at time 30, verifies zero received/consumed kits at time 43.99, restores a checkpoint during sorting, and verifies the same 75-kit warehouse transfer at time 44 in both executions. Checkpoints cannot claim sorting cargo without accepted inspection.

A new source-engine two-hour accelerated smoke after this change completed **162 vehicles**, dispatched **159**, received **900 kits**, consumed **829**, and sorted **12 deliveries** across **168 simulated sorting seconds**. Both material-conservation deltas were zero; road occupancy was one; history remained capped at 2,000 events and 720 samples. The headless check took approximately **106.6 ms** on the concurrently used development host, and the checkpoint was 608,211 bytes. This does not replace the independent wall-clock browser soak or claim stable runtime benchmarking.

## Earlier accelerated baseline soak — PASS

Before the explicit 14-second sorting stage was introduced, a two-hour **simulated-time** baseline was executed in 120 increments of 60 simulated seconds. Conservation was checked at every increment by the test suite. An additional standalone measurement, with explicit garbage collection, produced:

| Measurement | Observed result |
| --- | ---: |
| Simulated duration | 7,200 seconds |
| Standalone engine elapsed time | 58.6 ms |
| Vehicles completed | 162 |
| Vehicles dispatched | 159 |
| Received module kits | 900 |
| Opening module-kit inventory | 80 |
| Consumed module kits | 829 |
| Scrapped module kits | 1 |
| Material conservation delta | 0 |
| Live vehicles / carts / trucks | 4 / 0 / 0 |
| Retained events / chart samples | 2,000 / 720 |
| First retained event ID | 1,862 |
| Checkpoint size | 606,076 bytes |

The 58.6 ms value measures only headless simulation and does not include rendering, network traffic, model inference, or two hours of wall-clock operation.

A separate 24-hour accelerated engine run further exercised retention:

| Simulated hour | Completed vehicles | Conservation delta | Retained events / samples / dispatched genealogies | Observed process heap after GC | Export bytes |
| --- | ---: | ---: | --- | ---: | ---: |
| 6 | 485 | 0 | 2,000 / 720 / 200 | 10.66 MiB | 658,289 |
| 12 | 966 | 0 | 2,000 / 720 / 200 | 13.27 MiB | 662,894 |
| 18 | 1,450 | 0 | 2,000 / 720 / 200 | 13.31 MiB | 650,594 |
| 24 | 1,935 | 0 | 2,000 / 720 / 200 | 13.31 MiB | 677,286 |

Heap measurements are observations of this headless Node process, not guarantees for a browser or deployed multi-session server.

## Streaming archive and replay — engine boundary PASS

The archive-boundary tests captured more than 4,000 consecutive events and more than 200 dispatched genealogies while the live snapshot retained its bounded windows. All event IDs were contiguous; every dispatched vehicle had a complete externally streamed lineage. Subscription callbacks survive factory reset, cannot mutate authoritative state, and can unsubscribe. Sink exceptions increment `metrics.archiveErrors` without interrupting manufacturing.

`subscribeEvents(listener, {replayRetained:true})` can emit discriminated retained event and lineage records before continuing with command and new-event records synchronously. Command records contain execution results and their original pre-execution simulation time/epoch. Decision events include the complete structured `DecisionRecord`. The server writes an initial checkpoint header, then subscribes only to new records because the checkpoint already contains the retained windows; this avoids duplicating those records at the archive boundary.

The authenticated `GET /api/sessions/:id/history` endpoint requires `x-session-token`. It returns NDJSON with `x-archive-records` and `x-archive-truncated` headers. Periodic and final watermarks record the observed upper time bound across intervals with no manufacturing event. Default storage is `.data/archives`, with a 24-hour retention window, 64 MiB per session, and 256 MiB globally. Quota truncation is reported explicitly; an archive beyond its retention/quota limits is not a full trace. The existing `/export` endpoint remains a bounded runnable checkpoint.

`replayArchive(initialCheckpoint, orderedEntries, finalSimulationTime)` in `packages/simulation/src/replay.ts` reconstructs production from recorded commands and decision records without a provider call. Tests cover speed changes, reset, active-checkpoint continuation, and duplicate action IDs already applied before a checkpoint. For a downloaded NDJSON file, the first `kind:checkpoint` record supplies the initial run and subsequent event/lineage/command records are ordered inputs. The authenticated server replay endpoint runs that reconstruction in a worker and returns a new paused graphical session. Requested time belongs to the latest reset epoch; complete earlier epochs are replayed first. A file marked `archive-truncated` is rejected.

## Server and provider boundaries — PASS, source tests

The final source run reported **89 tests across 10 files** and `npm run typecheck` passed. The production dependency audit reported zero known vulnerabilities. Server/provider coverage verifies session-token isolation, WebSocket first-message authentication, public access-code gating, truthful absent-provider responses, generic provider failures, stale autonomous-action rejection after operator control, and sequential optimistic guards for accepted autonomous commands.

Additional regression cases verify one process-wide in-flight request per provider, token-budget admission while usage is outstanding, strict allowlisting and numeric validation of provider decisions, and a `409` response when one command ID is reused for different content. Any schema-valid operator command invalidates an outstanding autonomous proposal, including retries and rejected ID collisions. Checkpoint imports accept a bounded 16 MiB request rather than Fastify's 1 MiB default, while simulation validation still rejects malformed or physically invalid state. Archive tests cover token hashes across restart, explicit quota truncation, replay rejection for truncated files, and a single checkpoint record without duplicated retained events.

Each successful provider response now records the operational KPI view sent to the provider, its simulation-time evaluation point, and an outcome for every proposed command. After at most 120 further simulated seconds, the engine records baseline and measured KPIs plus their deltas under the literal `observational-not-causal` label; pause/mode epoch changes close the window as interrupted. The `ai-aftermath` event is included in the durable archive and replay path. These measurements describe what followed a decision and do not attribute the change to that decision.

Recorded-AI comparison mode accepts only actions from genuine provider decisions that were applied live in the current server session. Imported/replayed decision history and actions before a factory reset are not eligible. Ten paired seeds replay eligible manufacturing actions open-loop over the same 1,800 simulated seconds; no provider is invoked, and the result explicitly reports its policy source, source decision IDs, and applied/rejected action counts.

Astra may request at most one bounded `experiment` action in a response using a candidate such as `front:gentle`. The coordinator runs the existing paired simulation worker without sending that action to the manufacturing engine or changing live inventory. A fresh result is retained with deterministic-simulation provenance and becomes bounded evidence in the next provider view. If an operator changes control or pauses while the worker is pending, the result is discarded without retaining its metrics. Applying a candidate still requires a separate validated `profile` command. Worker capacity and timeout limits are shared with manual experiment requests.

Live WebSocket snapshot messages include the authenticated `sessionId` and a per-session monotonic `sequence`. All clients observe the same sequence for a simulation tick; each connection suppresses duplicate sequence delivery. Shared runtime schemas validate REST and WebSocket payloads, and the browser rejects mismatched-session or stale-sequence snapshots.

The earlier port 3008 soak was superseded after the receiving/sorting and boundary fixes. Its partial trace is `docs/review/baseline-soak.json`. A fresh two-hour real server/WebSocket run started on port 3009 at 2026-09-19T20:06:41Z and writes `docs/review/wall-clock-soak.json`; it remains RUNNING until the final report and checks pass. The decision-aftermath, recorded-action comparison, provider-requested experiment, order-priority, and WebSocket sequence source changes above were made after that process started and are covered by the separate 89-test source run rather than the active runtime evidence.

## Checkpoint command idempotency — PASS

Checkpoint exports preserve the latest **500 command IDs, their validated results, and original command payloads**. Imports restore this same bounded ledger, validate unique IDs and result revisions, and reject malformed or oversized histories. Retrying a retained reset or maintenance command cannot perform it again. A restored checkpoint remains paused: retrying its historical start command does not resume it; resumption requires a new command ID. New checkpoints also preserve different-payload conflict detection. Older v1 checkpoints without the optional `commandPayloads` field remain readable but cannot recover payload fingerprints they never recorded.

Commands older than the 500-entry window may be treated as new actions, so callers must use fresh globally unique IDs and should not retry an arbitrarily old command. Archived replay uses the same bounded engine ledger and original epoch/control revisions in an explicit offline replay mode. A regression test passes more than 500 commands, reuses an evicted ID, and verifies replay reproduces the new action rather than suppressing it through an unbounded replay-only ID cache.

## Retention and modeling limits

The simulation intentionally retains **2,000 events, 720 chart samples, 200 AI decision records, and the latest 200 dispatched-vehicle genealogies**. Active work retains full current ownership and material-lot lineage. Cumulative counters survive history truncation.

Checkpoint exports contain retained history, active state, random streams, lot ledgers, and recent dispatched genealogy. Complete historical evidence belongs to the separate disk archive, subject to its explicit retention and quota policies. Histories evicted before an imported checkpoint was created cannot be reconstructed from that checkpoint alone.

Material quantities represent **component kits**, not individually counted loose bricks. Incoming receiving inspection has an independent seeded 2% whole-lot rejection assumption. Rejected cargo stays on the departing truck, never enters accepted inventory, and triggers replenishment; supplier-return kit counters have their own conservation equation. A seed-147 empty-start test rejects the first 75 kits, verifies their return, and produces vehicles from replacement lots. The 24-hour seed-42 soak observed five rejected incoming lots with zero receiving-conservation delta. Transportation uses one receiving truck, one dedicated cart per production line, twelve physical parking bays, and one exclusive shared outbound/parking/dispatch road. Oldest-ready requests are served first across both directions. Completed vehicles wait at the end-of-line station until the road is free; dispatching vehicles wait in their bays. Road reservation/release events, occupancy, queue, and accumulated waiting time are monitored. Tests audit all reservation transitions for overlap and demonstrate recovery after all twelve bays fill during a dispatch outage. This conservative single-resource road does not model general multi-intersection traffic or physical collision dynamics.

## Checks requiring separate evidence

The simulation checks above do not certify the following:

- Broad provider quality, stability, cost, or long-duration autonomous behavior beyond the bounded live traces below.
- Actual 1080p rendering performance, twenty-vehicle stress rendering, visual/camera quality, or audio quality.
- Two hours of browser/server operation in real wall-clock time.
- Node 22/container startup, Replit deployment, or public session behavior.
- Physical mechanism feasibility, gripping forces, tolerances, safety systems, or commissioning.

Those checks must be recorded by the responsible integration, browser, and deployment verification steps. Do not infer PASS from the headless simulation tests.

## Bounded adaptive comparison runner — PASS, including bounded live Jev evidence

`npx vitest run --root . tests/adaptive-experiments.test.ts`: **7 tests passed**. Ten paired-seed runner behavior is verified with explicitly labeled injected fixtures: evolving candidate observations, deterministic re-execution, paired variation, rejected commands, bounded calls, provider refusal, cancellation, and timeout propagation. Server tests cover asynchronous job isolation, access/configuration checks, provenance, and cancellation.

The authenticated live Jev run completed twenty decisions over ten paired seeds and two checkpoints in 62.672 seconds under the twelve-per-minute limit. All decisions selected hold, with zero applied/rejected actions and exact equality across all sixteen baseline/candidate metrics. This is a successful live-boundary and pacing check with a neutral policy outcome, not evidence of improvement. See [`review/live-adaptive-jev.json`](review/live-adaptive-jev.json) and [adaptive comparison boundary](adaptive-comparison.md).

Separate live traces preserve Astra and Jev advisory responses, an applied Astra front-station repair, a complete 120-simulated-second Astra aftermath labeled observational, and a provider-requested paired profile experiment that did not change live configuration. See `review/live-provider-check.json`, `review/live-astra-autonomous.json`, `review/live-astra-aftermath.json`, and `review/live-astra-browser.txt`.

## Station holds and defect classes — PASS

Five further regression tests verify operator station pause/resume, unchanged active module/progress/remaining time during a 300-second station hold, continuing production on other lines, preserved checkpoint ownership, global-pause independence, paused maintenance timing, fault preservation, and suppression of new cart allocations to held lines. Classified module, final-test, and receiving rejects reconcile to their aggregate counters over a 7,200-second accelerated simulation. Class labels survive genealogy/checkpoint export. Escapes are explicitly zero by model construction under perfect detection; no measured classifier or latent-defect detection claim is made.
