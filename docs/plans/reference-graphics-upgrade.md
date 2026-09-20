# Reference-led graphics upgrade

Status: PLAN ONLY. Requested 2026-09-20. No graphics implementation authorized by this document.

## Target and sequencing

The user's four-panel reference is the visual acceptance target: a dense, premium brick-built miniature factory, a convincing gold robotaxi, detailed articulated production robots, and a richly lit assembly hall. The current visual release is a functional foundation, not acceptance against this new target. The user's assessment is approximately 25% of the desired quality; this is qualitative feedback, not a measured score.

Finish publication and close out the original goal's outstanding checks before graphics execution. The Replit app is published; provider configuration and unauthenticated access rejection have been verified. Authenticated Astra/Jev calls on the published deployment remain to be demonstrated. Reconcile the original acceptance checklist and identify unresolved items explicitly; do not equate publication with completing the entire original goal. The proposed custom domain is a separate, unapproved DNS change.

Present this plan for review before implementation. Once approved, work locally in an isolated branch, keep the existing public release available, and publish the graphics upgrade after visual and functional acceptance.

Reference: user attachment `codex-clipboard-3d36afd8-7f38-4a0c-b8e2-5c4c3842d3b2.png`. Use for visual direction, not as a texture or redistributed repository asset without established rights. Ignore the screenshot's image-editor toolbar. Original code/models remain reproducible and distributable.

## What must change

| Area | Reference characteristics | Planned change |
| --- | --- | --- |
| Composition | Factory fills the image; dense parallel lanes; roads and parking frame the building | Recompose default camera and site, reduce empty visual space, establish foreground/midground/background |
| Robotaxi | Low wedge profile, coherent gold paneling, panoramic canopy, visible seats, expressive wheel arches and tires | Rebuild the shared five-module vehicle asset; prioritize silhouette, proportion, glazing, panel seams and wheel detail |
| Machinery | Substantial articulated arms, recognizable joints, tool heads, cable runs, rails and fixtures | Replace simplified arms with reusable articulated assemblies and authored tooling |
| Building | Glazed perimeter, substantial columns, repeated trusses, visible interior illumination | Add a layered architectural shell with selective cutaways and useful interior sightlines |
| Material response | Small edge highlights, distinct plastic/rubber/glass/metal, believable scale | Named material library, consistent bevels, controlled roughness variation, correct transparent surfaces |
| Lighting | Warm practical lights, neutral fill, grounded contact shadows, readable reflections | Calibrated daylight/studio lighting, local baked detail and selective dynamic effects |
| Site | Finished curbs, planting, markings, lamps, loading infrastructure | Detailed inbound road/docks and outbound test road/parking with coherent landscape assets |

The reference is a still-image target, not proof of achievable real-time performance. Aim to match its visual language and detail closely, then document browser-render differences rather than promise pixel-identical results.

## 1. Baseline and art specification

- Capture the current production build at fixed 1920×1080 settings: site, vehicle front three-quarter, robot handling, final assembly, receiving/sorting, and parking.
- Establish stud spacing, brick/plate heights, panel gaps, bevel widths, vehicle dimensions, material palette, machinery colors and signage typography in a checked-in art specification.
- Extract the four reference compositions into shot descriptions. Record camera target, lens/framing, lighting direction and detail requirements for reproducible comparisons.
- Keep five distinct component lines. Do not populate each line with complete cars just to mimic the image. Human figures in the reference are not required: autonomous operation remains the subject.
- Audit `apps/web/src/world.ts` and separate asset builders, materials, lighting, layout and animation bindings behind its existing public interface. Preserve entity selection, cameras and snapshot contracts.

Deliverable: baseline captures, shot list, asset inventory, implementation ownership map and visual rubric.

## 2. Robotaxi and one assembly cell: prove the quality first

Build a representative scene containing one detailed robotaxi, one articulated robot, a conveyor/fixture, a building bay, floor markings and final-quality lighting.

Robotaxi:
- Sloped nose and windscreen, gold wedge panels and wheel arches, black sill/bumpers, a crisp front lightbar and rear lamp treatment.
- Molded-looking tires with tread, detailed hubs, visible seats and console through a fitted transparent canopy.
- Visible brick and tile structure at the right scale; use studs where exposed rather than covering every smooth panel.
- Hinged doors with actual pivots; modular seams and attachment points consistent with front, rear, battery/floor, interior and exterior assets.
- Reuse the same component geometry in station work, final joining, exploded view and the finished vehicle. No high-quality display-only car that differs from the simulation's product.

Cell:
- Robot base, shoulder, elbow, wrist, end effector, cable routing and clear joint pivots.
- Conveyor rollers/rails, clamps, pallet locator pins, safety barriers, inspection camera, stack lights and tool cabinet.
- Approach/grip/lift/transfer/place/release/return animation; carried parts stay attached to the end effector and align with physical receiving fixtures.
- Use the existing constrained motion envelope; add checks for major mesh intersections and unreachable poses.

Deliverable: real-browser vehicle and assembly-cell captures plus a short motion recording. Review these against the reference before spending effort on full-site replication. If the quality still reads as a schematic, revise here.

## 3. Asset and material production pipeline

- Keep procedural generation for reproducible brick primitives, repeated fixtures and parameterized assemblies.
- Add wedge plates, sloped bricks, curved panels, transparent canopy pieces, Technic-style beams/pins, gears, wheels and cable segments to the part library.
- Use Blender for difficult curved/slope surfaces, clean normals, pivots, UVs, light/occlusion baking and optimized glTF exports where available. Retain editable source assets and deterministic export instructions.
- Generate original signage, decals, material maps and art studies with available image tools where useful. Grok/Gemini are optional only if verified available. Generated images cannot replace 3D machinery or hide unfinished views.
- Separate colored plastic, gold plastic/body panels, rubber, glass, steel, concrete, asphalt and foliage materials. Avoid a single color-keyed material function being the entire art system.
- Use baked occlusion for static detail and dynamic contact shadows for moving assemblies. Keep glazing readable without alpha sorting artifacts.
- Record asset provenance, licenses and generation metadata. No corporate logos or unlicensed third-party assets.

## 4. Expand the factory and complete the surrounding world

- Apply the approved cell language across five color-coded lines, while giving each its own fixtures and recognizable module operations.
- Add credible receiving equipment, conveyors, inspection/sorting, labeled racks, totes and kit loading so the inbound story reads without opening a dashboard.
- Upgrade delivery trucks with tractor/trailer detail, visible cargo, dock alignment and physically continuous pallet handling.
- Make module buffers and final joining a focal point: five actual accepted components converge, align and become the same vehicle seen on the road.
- Add ceiling structure, overhead services, glazed walls, lighting fixtures and signage with camera-aware cutaway rules that do not make major structures pop abruptly.
- Finish road surfaces, turns, markings, crossings, curbs, bollards, planting, parking numbering and dispatch boundaries. Vehicles visibly leave assembly, follow the route and occupy their reserved spaces.
- Add richness through machinery, architecture and static detail; extra manufactured stock must still be backed by authoritative inventory. No decorative finished cars counted as real production or arbitrary material spawning.

## 5. Lighting, camera and presentation polish

- Tune exposure, environment reflections and material response together before increasing bloom or ambient occlusion. Preserve highlights in gold and detail in black tires.
- Keep daylight bright and operationally readable; add a warm presentation preset and an optional dusk preset with convincing practical lights.
- Use composed site overview, vehicle three-quarter, robot close-up and final-joining presets matching the reference's intent.
- Reserve shallow depth of field for cinematic close-ups; keep operating views sharp and legible. Camera movement must remain interruptible.
- Keep the world dominant in the interface; compact monitoring panels, preserve inspection/selection, and prevent panels from obscuring the hero subject.
- Synchronize existing procedural sound to the improved machinery and transfers; avoid replacing event-driven audio with an unrelated background track.

## 6. Performance engineering throughout

- Profile the representative cell before rolling it out. Use shared geometry/materials, thin instancing for static repeated parts, cached assemblies and spatial grouping for culling.
- Provide close/medium/far levels of detail: actual studs/treads/joints up close, reduced geometry at site scale. Hide internal detail only when genuinely occluded.
- Budget dynamic shadow casters, shadow resolution, transparency, reflection updates and post-processing. Do not add a shadow-casting light for every visible lamp.
- Proposed initial desktop targets: normal views at 60 FPS, stress scene at least 30 FPS at 1080p; report frame-time percentiles and hardware, not just a best-case FPS counter.
- Track draw calls, triangles, GPU/CPU frame time where measurable, memory, asset transfer size and loading time. Revise concrete geometry/texture budgets from measured prototype costs.
- Deliver balanced/high quality settings and a fallback for weaker GPUs. Reference comparisons use a documented quality setting.
- Keep production geometry counts and retained meshes bounded during continuous operation. The small Replit VM serves assets and simulation; graphics detail primarily consumes browser/GPU resources, while larger downloads also affect hosting traffic.

## 7. Acceptance and release gates

1. **Reference review:** side-by-side current/new/reference comparisons for the four principal shots. Score silhouette, brick detail, material separation, lighting, composition, machinery detail and site completeness. The user approves the aesthetic result; frame-rate success alone does not close this gate.
2. **Continuous visual story:** delivery arrival/unloading → inspection/sorting → storage/kit distribution → five module lines → final join/test → autonomous parking → dispatch. Capture actual running sequences, not disconnected posed stills.
3. **Close-up correctness:** no floating parts, gross intersections, detached loads, unusable camera views, obvious repeated placeholder shapes or broken transparent surfaces.
4. **Functional regression:** material conservation, genealogy, valid transfers, parking backpressure, disruption recovery, selection/follow, pause/speed/reset, checkpoint restore and provider controls still work. Asset changes cannot complete simulation jobs independently.
5. **Performance:** fixed normal/stress camera routes at 1080p, warmed foreground runs, measured frame-time distribution and memory. Repeat the continuous rendering soak to verify retirement of richer assets.
6. **Public deployment:** test build, review, push selected release to GitHub, pull/build/republish on Replit, then verify the published assets, controls and live connection. Keep rollback instructions and the preceding release commit.

## Work organization and handoff

After approval, parallelize bounded work across vehicle/part assets, factory/site assets, and lighting/performance review. The primary agent owns integration, shared scale/material contracts, animation bindings and final browser review. Avoid concurrent edits to the same renderer file; split interfaces first.

Deliver source assets and procedural generators, art specification, provenance, benchmark results, actual browser captures, motion recordings, a reproducible visual tour, updated acceptance status and release notes. Treat this as a substantial modeling and art-direction upgrade with review gates, not a quick filter adjustment. Estimate implementation effort after the representative cell establishes the asset and rendering cost.
