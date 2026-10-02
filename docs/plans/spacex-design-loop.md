# Joint Design Loop

Status: **proposed spec**. Not implemented in the simulation.
Date: 2026-10-02
Repo: [fszale/dark-factory](https://github.com/fszale/dark-factory) (Brickworks)

This document adds an operating process that redesigns the factory and the product together. It uses the public SpaceX iteration loop, in order, and it forbids skipping ahead to automation.

## Source of the loop

The loop below is the public SpaceX iteration sequence (often called the Algorithm), as restated in an a16z post and attributed to Elon Musk. It is an operating heuristic, not a licensed method and not a claim about any SpaceX factory.

1. Question every requirement.
2. Delete any part or process you can.
3. Simplify and optimize.
4. Accelerate cycle time.
5. Automate.

Most organizations skip to step 5. They take a process that should not exist and then automate it. Brickworks already has deterministic control, advisory AI (Astra and TypeSafe Jev), and autonomous mode. That is step 5 sitting on top of a factory that has not yet been forced through steps 1 to 4. This spec puts the missing process in front of any new automation.

## Why it has to be joint

The product and the factory are the same bill of process.

The learning product is a brick-built gold robotaxi. The factory path is delivery, receiving, sorting, kits, five parallel lines (`front`, `rear`, `battery`, `interior`, `exterior`), joining, test, drive-out, parking, and dispatch. See [architecture](../architecture.md). Line metadata lives in `packages/contracts` as `LINE_META`. Providers may only emit schema-checked commands. They cannot mutate the world directly.

A product feature that is not load-bearing creates a station, a kit, a cart move, an inspection, and a failure mode. Deleting the feature deletes the factory work. Simplifying the feature simplifies the station. Automating either one before that deletion just makes the waste faster.

Factory-only tweaks and product-only tweaks are allowed as notes. A candidate cannot be accepted unless it names both the product requirement and the factory element that exists to satisfy it.

## The process

Run the loop on one joint scope at a time. Triggers:

- a line is the constraint (queue growth, or an existing disruption scenario such as `scenarios/slow-exterior.json`)
- an operator asks for a redesign
- before any new autonomous policy is allowed to touch that scope

A candidate stores which step it is on. It cannot enter a later step without a written result for every earlier step. Reinstating a deleted requirement is allowed and is a success signal: if nothing ever comes back, the loop is not deleting honestly.

| Step | Factory question | Product question | Exit criterion |
| --- | --- | --- | --- |
| 1. Question | Who required this station, cart path, or inspection, and is that person still the customer of this learning model? | Is this feature required to learn material flow, or only to match the concept art? | Requirement written down, owner named, still-required marked true or false. |
| 2. Delete | Which move, buffer, or inspection can disappear this week? | Which feature can disappear without breaking the learning goal? | At least one concrete deletion, or a written reason nothing could be deleted. |
| 3. Simplify | One grip, one kit, one recipe for what remains. | One SKU instead of a sequence of features inside the module. | The surviving recipe is shorter than the current one. |
| 4. Accelerate | Shorten the surviving station cycle. Do not add a second copy of the old station. | Do not add features back in order to look faster. | Paired scenario shows a shorter critical path than the baseline scenario. |
| 5. Automate | Only the surviving recipe may be handed to Astra or Jev. | Do not automate a feature that step 2 deleted. | Advisory first. Autonomous only after the paired run holds yield. |

Deterministic controllers stay in charge. A provider recommendation that skips steps, or that targets a deleted requirement, is rejected the same way any other illegal command is rejected.

## Proposed modification: DF-LOOP-001

**Exterior SKU collapse.** Status: proposed. No physics change in this commit.

### What exists today

The exterior line contributes gold panels, doors, canopy, and roof as one module. Final assembly still needs one accepted module from each of the five lines. `scenarios/slow-exterior.json` already treats that line as a disruption. The concept image is a visual target, not a manufacturing requirement. The README says a successful simulation is not proof a plant is ready.

### Step 1, question

Requirement under review: "the exterior module includes gold panels, doors, a canopy, and a roof."

Owner of that requirement: the visual target and the first learning model, not a plant customer. The current learning goal is material flow (receiving, parallel lines, joining, quality, dispatch), not a road-legal vehicle and not a graphics milestone.

Still required for the learning goal: an exterior module that can be short, kitted, moved, joined, and failed. Not required yet: four distinct exterior features inside that module.

Parked, not part of DF-LOOP-001: whether autonomous drive-out is a factory requirement or a product demo. Dispatch can stay as it is until this exterior candidate is measured.

### Step 2, delete

Delete canopy as separate work content inside the exterior module.

Do not delete the exterior line. Joining still requires one module from `exterior`. Deleting the whole line would change the five-module vehicle contract before the simpler recipe is proven.

### Step 3, simplify

Collapse what remains to one exterior SKU: a single panel brick, one kit quantity, one grip, one inspection. Doors and roof stay in the visual model only if they are the same part as the panel. They are not extra factory steps.

Factory side of the same change: one recipe on `StationState` for `exterior`, one cart payload shape, no internal feature sequence.

### Step 4, accelerate

After the recipe is shorter, reduce the exterior cycle time in configuration. Compare against `scenarios/slow-exterior.json` and `scenarios/balanced.json`. Adding a second exterior station is out of scope. That would copy the old process.

### Step 5, automate

Not in this proposal. Astra and Jev may be shown the simplified recipe in advisory mode only after step 4 has a paired run. They may not be given the current four-feature exterior recipe as something to automate.

## Spec (contracts, not built yet)

Proposed shared type, to land later in `packages/contracts` beside `LINE_META`. Snapshots stay format version 1 until a real code change bumps them.

```ts
type DesignLoopStep = 1 | 2 | 3 | 4 | 5;

type DesignLoopStatus =
  | "proposed"
  | "shadow"
  | "accepted"
  | "reinstated"
  | "rejected";

interface DesignLoopCandidate {
  id: string; // DF-LOOP-001
  scope: "joint";
  productRequirement: string;
  factoryElement: string; // line id, station, cart path, or inspection
  step: DesignLoopStep;
  stillRequired: boolean;
  deletion: string | null;
  simplification: string | null;
  baselineScenario: string;
  candidateScenario: string;
  status: DesignLoopStatus;
}
```

DF-LOOP-001 filled in:

| Field | Value |
| --- | --- |
| id | `DF-LOOP-001` |
| scope | `joint` |
| productRequirement | Exterior module contains panels, doors, canopy, and roof as separate work. |
| factoryElement | Line `exterior` (`LINE_META`, `StationState`, cart payload into joining). |
| step | 3 (deletion named, simplification named, not yet measured) |
| stillRequired | Exterior module yes. Canopy as its own work content no. |
| deletion | Canopy work content. |
| simplification | One panel SKU, one kit, one grip, one inspection. |
| baselineScenario | `scenarios/slow-exterior.json` and `scenarios/balanced.json` |
| candidateScenario | `scenarios/exterior-sku-collapse.json` (not created yet) |
| status | `proposed` |

Shadow mode, when built, appends candidates to the session snapshot and the NDJSON history. It does not change inventory, cycle time, or the 3D scene.

## Implementation plan

No application code in this commit.

| Phase | What changes | Done when |
| --- | --- | --- |
| 0 | This spec. | Merged. |
| 1 | Add `DesignLoopCandidate` and a Zod object in `packages/contracts`. No simulation effect. | Typecheck and existing tests still pass. |
| 2 | Shadow log. The server can record a candidate on the snapshot. The UI can list it. Physics unchanged. | A session export shows DF-LOOP-001 as `shadow` and vehicle flow matches the current build. |
| 3 | Add `scenarios/exterior-sku-collapse.json` and a config flag that shortens exterior work content (canopy removed, one SKU). | Scenario loads in the existing scenario runner. |
| 4 | Paired runs: baseline `slow-exterior` and `balanced` versus the candidate. Record throughput, yield, exterior queue, and station count. | A short note in `docs/review/` with the measured deltas. No dollar claim. |
| 5 | Advisory only. Astra or Jev may recommend the simplified recipe. Commands that target canopy work, or that skip to automation of the old recipe, are rejected. | Provider path tests cover the rejection. |
| 6 | Tabletop consequence. Build one exterior gripper for the surviving SKU, not three feature tools. | A one-page bill of process before any hardware is bought. |

Phases 1 to 5 stay inside the virtual factory. Phase 6 is the first physical consequence and needs its own yes before parts are purchased.

## Potential outcomes

If the paired run supports the deletion:

- The exterior line stops being a four-feature sequence and becomes one part.
- The critical path is less likely to sit on `slow-exterior` style congestion, because there is less work there, not because a second station was added.
- The tabletop bill of process shrinks before any new automation is designed.
- The story for a later plant partner is that the factory deletes work. It does not automate a process that should not exist.

If the paired run does not support it:

- DF-LOOP-001 moves to `rejected` or `reinstated`.
- The current five-line, four-feature exterior recipe stays.
- No autonomous policy is pointed at a simplification that failed.

Known tension: the concept art and the graphics upgrade plan want a richer vehicle. That work stays on the visual track (`docs/plans/reference-graphics-upgrade.md`). It is not allowed to reintroduce factory steps that this loop deleted.

## ROI thesis

This is a thesis, not a measured return. The simulation's energy, wear, and cost figures are estimates. This spec does not add a dollar ROI.

**Claim.** The next dollar of effort is worth more on steps 2 and 3 of the exterior module than on step 5. Automating today's exterior recipe would spend engineering and, later, grippers on canopy, door, and roof work that the learning goal has not shown it needs.

**Mechanism.** Each extra feature is a kit line, a grip, an inspection, and a failure mode. Those costs show up twice: as simulated queue on `exterior`, and as real parts if the same recipe is copied onto the tabletop. Deleting canopy and collapsing the rest to one SKU removes that work before anyone buys a faster actuator or writes an autonomous policy for it.

**What would count as a win in the sim.** Phase 4 shows a shorter exterior cycle and a shorter time-to-joined-vehicle on the candidate scenario than on `slow-exterior`, with yield no worse than `balanced`. Station count for exterior does not go up.

**What would falsify it.**

- The candidate scenario does not shorten exterior queue or time-to-joined-vehicle.
- Yield drops versus `balanced`.
- The canopy has to be reinstated because joining or the learning goal actually depends on it.
- Time to a credible tabletop bill of process gets longer, not shorter.

**What this is not.** It is not a claim that Brickworks throughput, yield, or cost has changed. It is not a plant quote. It is not permission to automate the current factory.

## Out of scope

- Changing the live Replit deployment.
- Editing `LINE_META` cycle numbers in this commit.
- New provider prompts that tell Astra or Jev to redesign on their own.
- Industrial product selection. The robotaxi remains the learning model. The final industrial product is still unchosen.
