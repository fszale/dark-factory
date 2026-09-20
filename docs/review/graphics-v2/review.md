# Reference upgrade — first visual checkpoint

2026-09-20. Work in progress on `feat/reference-graphics`; not published to Replit and not final visual acceptance.

## Implemented

Shared five-module robotaxi rebuilt with profiled/sloped panels, canopy, hinged doors, wheel arches, tread, layered hubs and cabin detail. Robot joint covers, fasteners, cable guides and end-effector detail remain attached to existing kinematic transforms. Conveyor motor/rail detail and assembly fixtures added. Glazed facade, brick courses, roof lattice, curbs, drainage and planting added using shared geometry. Lighting/material response and close-up cutaways revised.

`/atelier.html` supplies repeatable synthetic review shots. Its product shot rotates the fixture car and hides two foreground robots; the full cell shot restores the robots. No synthetic object contributes to live production metrics. New module geometry also runs through the live renderer's existing station, joining, road and exploded-view paths.

## Actual browser captures

- `robotaxi-1080p.png`: shared vehicle silhouette/material review.
- `cell-1080p.png`: complete assembly-cell framing and rig detail.
- `site-1080p.png`: architectural/site pass, explicitly without live inventory in the synthetic fixture.
- `stress-1080p.png`, `stress-window.txt`: 32-vehicle rendering stress measurement.

Host context: same local Apple M5 MacBook Pro, 24 GB, Codex in-app browser used by the baseline review. Foreground 1920×1080, development Vite build with builds stopped during measurement. This is an early development measurement, not the final production-build performance acceptance.

Stress window: 76 seconds, 75 FPS samples, 5,088 scene meshes; mean 53.8 FPS, minimum 42.0 FPS, fifth percentile 48.5 FPS. 4,056 foreground frame intervals: p95 20.9 ms, p99 24.2 ms. Lifetime startup minimum 23.3 FPS remains visible. Frame interval includes browser scheduling; it is not a GPU-only timing measurement. Baseline measurements used different geometry and conditions and must not be presented as a controlled A/B comparison.

## Assessment

| Area | Status | Evidence / next action |
| --- | --- | --- |
| Vehicle silhouette and component detail | Improved; needs aesthetic review | Clear wedge nose, canopy, seams and detailed wheels replace the simpler body; still below the reference's fine modeling richness |
| Robot mechanics | Improved; needs work | Pivots/tooling read more clearly; cable forms, fixtures and handling closeups need further refinement |
| Architecture and site | First pass | Glazing/plinth/planting added; hall remains sparser and less layered than the reference |
| Lighting and materials | Needs work | Better separation and reflections; target has warmer practical illumination and richer fine surface variation |
| Reference composition | Partial | Product camera improved; reference matching across the complete operational world remains outstanding |
| Performance | Early stress pass | Above 30 FPS stress threshold during saved window; final normal/stress production runs and richer-asset soak still needed |
| Functional correctness | 110 tests passed across 13 files | TypeScript and production build passed after all checkpoint changes, including three geometry checks. A full animated runtime pass remains part of checkpoint closure |

Next: obtain visual direction on the product/cell, finish practical lights, smaller fixtures and scene density, enhance delivery assets, then validate all operational camera routes, animated transfers, quality tiers/LOD and bounded rendering memory. This checkpoint is not the completed graphics upgrade. Authenticated production Astra/Jev calls also remain pending user access-code validation, distinct from the passed public simulation smoke checks.
