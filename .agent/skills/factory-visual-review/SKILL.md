---
name: factory-visual-review
description: Improve or review Brickworks 3D models, materials, animation, cameras, audio and browser performance against the approved factory reference.
---

# Factory Visual Review

Read `docs/plans/reference-graphics-upgrade.md` for scope and review gates, `docs/graphics-review.md` for prior measurements, and `docs/assets/README.md` for provenance. Paths are relative to the repository root.

The target is a dense, premium brick-built miniature factory: convincing gold robotaxi silhouette, detailed articulated machinery, rich material separation, composed lighting and a complete inbound-to-parking world. Existing shadows/PBR/bloom are not proof of visual acceptance.

- Establish one finished robotaxi and assembly cell in real browser renders before replicating detail site-wide. Compare reference and current/new shots at the same documented resolution.
- Vehicle, in-process modules, joining and exploded view must share coherent geometry and dimensions. Do not copy complete-car lanes from the concept sheet into the five-module manufacturing model.
- Preserve visible truck arrival, attached pallet handling, sorting and kit distribution, actual gripper transfers, vehicle exit and reserved-bay parking. Decorative stock must not masquerade as simulated inventory.
- Prefer original procedural parts; use Blender/glTF for geometry that benefits from authored modeling. Generated imagery can support concepts, decals or textures, never substitute for interactive machinery.
- Label concept art separately from actual screenshots. Record licensing/provenance, including generated assets. Do not redistribute arbitrary user references without established rights.
- Profile in the foreground after warm-up at fixed resolution. Record hardware, quality settings, draw/geometry costs, memory and frame-time distribution where available. Preserve poor samples and explain controlled reruns.
- Use instancing, LOD, bounded mesh retirement, shadow budgets and limited transparency. The existing 1080p goals are 60 FPS normal and 30 FPS stress; previous results are not evidence for new assets.
- Verify pause, speed, camera interruption, selection/follow, cutaway, audio gesture/mute and fault indications alongside visual quality.

Respect the user's current mode: a request for a plan produces a plan and no renderer changes. The reference upgrade remains plan-only until explicitly approved and its preceding release checks are reconciled.
