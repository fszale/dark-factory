# Simulation behavior

## Inputs, states, and outputs

The deterministic seed, active scenario, order size, release rate, reorder point, delivery size and lead, dispatch dwell, capacities, and each line's `gentle`, `normal`, or `fast` profile define a run. A snapshot records WIP, warehouse inventory, trucks, carts, vehicles, station states, events, time-series samples, provider decisions, metrics, and faults.

Metrics include received and consumed material, scrap, completed and dispatched vehicles, delivery quality, energy and cost, throughput, yield, lead time, dock/cart/assembly/parking waits, and simulation time. A metric represents simulation output, not measured factory telemetry.

## Scenarios

| ID | Intent |
| --- | --- |
| `balanced` | Reference material flow with normal operations. |
| `shortage` | Supply constraint. |
| `slow-exterior` | Exterior line bottleneck. |
| `gripper` | Material handling fault. |
| `congestion` | Cart or buffer congestion. |
| `assembly-outage` | Joining disruption. |
| `dispatch-blockage` | Parking or dispatch constraint. |
| `empty` | Empty starting condition. |

Fault flags model supply, congestion, assembly, and dispatch conditions. Scenario names and flags are simulation controls, not diagnoses of a physical factory.

`balanced` is the reference journey. The other seven canonical scenarios are the required fault or edge-condition demonstrations: shortage, slow exterior, gripper, congestion, assembly outage, dispatch blockage, and empty start. They remain simulation exercises and do not validate physical equipment.

## Experiments and comparison

Experiments compare a baseline and candidate through the same explicit seed list. The result includes every per-seed baseline/candidate row, per-seed deltas, aggregate means, and population standard deviations for the baseline, candidate, and paired differences. The UI must disclose the seeds, run count, configuration differences, metric deltas, and variation. A ten-run paired comparison is the standard demonstration: each baseline/candidate pair uses the same one of ten seeds for 1,800 simulated seconds, so observed differences are less likely to be caused solely by stochastic variation. It is a deterministic configured-profile comparison, not a live or imitated AI-policy run, a claim of statistical significance, or physical validation.

## Material allocation priority

Dedicated carts preserve their destination kit family. Eligible requests have line-side stock at or below two kits, warehouse stock for that same line, no already committed cart, and remaining production demand. They compete for a shared warehouse loading resource: `materialLoadingCapacity` is 1–3 and defaults to two loaders. Once loading completes, a cart releases its loader and follows its fixed route.

`materialPriority` is a five-line map of integers: 1 is highest priority and 5 is lowest; each defaults to 3. Eligible requests sort first by this configured priority and then by the stable front/rear/battery/interior/exterior line order. This policy does not preempt a cart already loading, transfer another family's kits, or claim to optimize general road traffic. The separate outbound road keeps its oldest-ready reservation policy.

Use a `priority` command with `station` and integer `value` to change allocation. Use a `config` command with `value: "materialLoadingCapacity:1"` to change the loader count. Shrinking below the count of already committed loading carts is rejected. Every `kit-pick` event records the policy, priority, loader capacity, destination, lot, cart, and quantity. Loading utilization and eligible queue size appear in metrics.

## Inspection and rework history

New modules retain `reworkHistory`: ordered records with simulation time, attempt number, and `inspection-passed`, `inspection-rejected`, `rework-started`, or `scrapped`. A first-pass acceptance has one record; a successful rework has three; a rejected rework followed by scrapping has four. Accepted modules retain this history through vehicle genealogy and checkpoint export. Scrapped-module events include the complete history before the module leaves active state. Older checkpoints without the optional history field remain supported; history that was never recorded is not fabricated.

## Production orders and final joining

Production orders are separate from material-line priorities. `snapshot.orders` holds at most 20 active orders with ID, quantity, completed units, priority (1 highest, 5 lowest), queued/in-progress status, creation time, and showcase/manual source. `order-create` accepts `value: "quantity:priority"` (1–1000 units); `order-priority` accepts `value: "order-id:priority"`. Neither command accepts a station target.

When the assembly cell and parking reservation are available, the controller selects the highest-priority order with unassigned units, breaking ties by creation time and numeric order ID. It atomically reserves the required accepted modules from `ROBOTAXI_RECIPE.modules` and stores them in the recipe's `joiningOrder`. A changed priority affects subsequent assignments; an already committed vehicle retains its order. End-of-line acceptance increments that order's completed units exactly once. Every live vehicle and new dispatched genealogy record carries `orderId`.

Finite mode starts with one `orderSize` order and supports additional explicit orders. Its lines stop once cumulative accepted modules meet cumulative ordered units (replacement work for rejected modules still occurs). Continuous showcase mode replaces a finished showcase order with one new batch, keeping rolling demand bounded while honoring manually added orders. Switching continuous mode off finishes existing orders. `orderSize` changes resize an uncommitted queued showcase order, or apply to the next showcase batch when assembly has already started; they never rewrite committed demand.

Completed orders retire immediately from active memory into `order-completed` events containing the complete order and completion time. `orderedUnits`, `ordersCreated`, and `ordersCompleted` remain cumulative. Full history downloads preserve retired records subject to the documented archive quotas. Older v1 checkpoints without orders migrate remaining demand and unfinished vehicles to an explicit legacy order; historical order records that were never collected are not fabricated. Checkpoint validation rejects duplicate orders, inconsistent remaining demand, overcommitment, and unfinished vehicles without an active order.

## Station operator pause and resume

`pause` with a `station` target holds only that station. `start` with the same target restores its previous state and the exact remaining operation; neither changes the factory's global running flag. The active module, its progress, quality history, queue, and material ownership are retained. Other lines and previously committed logistics continue; new cart reservations to the held station are suppressed. A paused station accumulates `pausedTime` and the factory's `operatorPausedTime`, separately from fault/maintenance downtime.

Global `pause`/`start` without a station retain their existing behavior. Resuming a station while the factory is globally paused leaves global production paused. Pausing maintenance freezes the remaining repair duration; pausing a faulted station does not clear the fault. Fault injection and maintenance scheduling on an operator-paused station reject until the station is resumed. Optional station `pause` metadata stores the prior status and hold start time in checkpoints; imports reject a paused station missing this metadata. Old v1 checkpoints whose stations were not paused need no migration field.

## Defect-class assumptions

Rejects now carry deterministic, inspectable class labels by manufacturing stage: front axle alignment, rear drive fit, battery/floor connection, interior seat fit, exterior panel alignment, final door operation, and incoming kit damage. These labels add no random draws and do not change the existing seeded reject probabilities. They describe simulated fault categories, not sensor-based diagnoses. Rejection/rework/scrap module history retains `defectClass` through vehicle lineage and checkpoint exports; receiving and final-test events carry their own class labels.

Counters use `defect_axle_alignment`, `defect_drive_fit`, `defect_floor_connection`, `defect_seat_fit`, `defect_panel_alignment`, `defect_door_operation`, and `defect_incoming_kit_damage`. For newly initialized runs their sum equals module/final inspection rejects plus rejected deliveries. Failed reinspection counts as another detected defect occurrence; repair and scrap handling do not count a third detection. Historical checkpoints/events without class labels are not retroactively classified.

The quality model assumes perfect detection at the modeled inspection stage. `qualityEscapes` is zero by construction and `perfectDetectionAssumption` is one; the simulation does not generate hidden latent product defects, false negatives, or real classifier accuracy evidence. Equipment wear remains separately hidden from AI observations. Future physical validation must replace these assumptions with measured defect distributions and detection performance.
