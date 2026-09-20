# Graphics review — 2026-09-19

Actual Codex in-app browser captures from the production application at localhost:3009 are stored in `docs/review`. The scene uses procedural brick geometry, plastic/gold/glazing materials, local environment reflections, PCF shadows, ambient occlusion, restrained bloom, and original site assemblies.

Reviewed at 1920 × 1080 (assembly captures precede the final added sorting conveyor; site, receiving/sorting, and stress captures include it): `delivery-arrival-1080p.png`, `sorting-1080p.png`, `site-1080p.png`, `receiving-1080p.png`, `storage-1080p.png`, `robot-1080p.png`, `assembly-1080p.png`, `parking-1080p.png`, `fault-1080p.png`, `exploded-1080p.png`, and `dusk-1080p.png`. The exploded capture demonstrates all five separated modules and their genealogy; other vehicles remain assembled. Parking uses twelve individually accessible bays. Dusk keeps operations readable. This is a stylized brick model, not a photorealistic factory or certified physical build.

## Rendering performance

Host: MacBook Pro, Apple M5, 10-core CPU/GPU, 24 GB unified memory. Browser: Codex in-app browser. Resolution: 1920 × 1080. No claim is made for other hardware.

The dedicated `/benchmark.html` scene contains twenty animated in-process full vehicle assemblies and twelve parked vehicles, with 3,184 scene meshes. Vehicle geometry is merged by module/material and reused as instances. Static scenery uses thin instances.

The saved `stress-1080p.png` records **95 one-second FPS samples**, **90.5 FPS mean**, **45.9 FPS minimum**, and **92.4 FPS current**. These are sampled Babylon engine FPS readings, not a full per-frame percentile distribution. They exceed the requested 30 FPS stress target on this host. The integrated operating site capture records 97 FPS; close-up captures range from 82 to 120 FPS. Browser activity, other applications, and startup can affect these readings.

The stress fleet is explicitly a synthetic graphics load. It is excluded from material conservation, production metrics, and AI policy comparisons. Real manufacturing progression is tested separately by the authoritative simulation and live server soak.

## Reproduction

Build and start the application, then open `/benchmark.html` at a 1920 × 1080 viewport. Leave it running for at least 90 samples, then record the displayed mean, minimum, current FPS, and mesh count. For the operational review, follow `docs/guided-tour.md` and use the camera presets. Browser audio controls and automated source/voice checks are recorded separately; these screenshots do not establish subjective sound quality.

## Final foreground graphics window — 2026-09-19

Latest shared module/vehicle geometry and constrained gripper carry were reviewed in the real browser at 10 and 15 simulated seconds. Captures: `review/gripper-carry-1080p.png` and `review/gripper-place-1080p.png`. Parts are positioned from the computed wrist while carried, then remain in their authored placement. The module and vehicle use the same dimensions and materials.

On the documented Apple M5 machine, foreground `http://localhost:3010/benchmark.html` at **1920×1080** displayed 20 animated in-process full vehicle models plus 12 parked cars, **3,184 meshes**. After shader warm-up and stopping builds, the saved **72-second / 72-sample** window measured **107.6 FPS mean**, **86.9 FPS minimum**, and **102.6 FPS fifth percentile**. Page-load minimum, preserved across measurement resets, was also **86.9 FPS** at capture. Evidence: `review/final-stress-1080p.png`. This synthetic rendering test does not count as manufacturing throughput or AI evidence.

An earlier uncontrolled background run while builds were active had a 11.9 FPS sampled minimum; it was not accepted as the reproducible foreground result. The benchmark now exposes an explicit measurement-window reset and preserves the lifetime minimum rather than concealing startup/other-window samples. For reproduction, keep the benchmark tab visible, set 1920×1080, stop compilation, allow warm-up, then start a window of at least 60 seconds. Temporary viewport overrides were reset after this review.
