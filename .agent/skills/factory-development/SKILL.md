---
name: factory-development
description: Extend or debug Brickworks simulation, controllers, contracts, logistics, and AI orchestration while preserving material conservation and reproducibility.
---

# Factory Development

Read `docs/architecture.md`, then `docs/simulation.md` or `docs/station-adapters.md` for the subsystem being changed. Paths here are relative to the repository root.

- The server owns production state. Babylon renders snapshots; animation must not consume stock, complete jobs, or invent vehicles.
- Preserve the entire loop: inbound trucks, unloading, inspection/sorting, storage, kit transport, five parallel modules, late joining/testing, finite parking and dispatch. Receiving and distribution must remain visibly understandable.
- Front, rear, battery/floor, interior and exterior contribute accepted modules atomically to final assembly. Preserve exclusive reservations, finite capacity, one rework attempt, material balance and lot-to-vehicle genealogy.
- Keep seeded resource-specific randomness and replayable decisions. Models see observations/history, not hidden wear, seeds or future failures.
- Astra/Jev propose bounded validated commands. Preserve revisions, stale-response rejection, idempotency, manual takeover, provider call limits and truthful outage states. Never replace unavailable live AI with scripted responses labeled as AI.
- Keep cumulative counters while bounding live objects, chart samples, events and meshes. Do not silently truncate full-history exports without the documented marker.

Use targeted invariant tests for the affected behavior, then the repository's required checks. For broad engine/API changes run `npm test` and `npm run build`; run the soak only when state retention, timing, transport or long-run behavior changes justify it. Separate simulated estimates from measured software performance and real hardware evidence.

Future hardware belongs behind station adapters. A virtual result does not establish torque, grip, tolerances, guarding, electrical safety or physical reliability. See `docs/plans/reference-graphics-upgrade.md` for the separately scoped graphics work; a development request does not automatically authorize that plan.
