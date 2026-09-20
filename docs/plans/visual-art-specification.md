# Brickworks art specification — first reference pass

Working branch: `feat/reference-graphics`. Public release remains separate. The original concept sheet in `docs/assets/visual-target.png` is the target; prior production screenshots in `docs/review` remain the baseline.

## Shared scale and palette

- Stud pitch: 0.4 world units; stud diameter 0.24; exposed stud height 0.09. Existing abstract miniature units remain unchanged.
- Robotaxi wheel centers: x ±1.45, z ±1.0, y 0.57. Shared five-module geometry stays within approximately 4.3 × 2.6 × 2.1 units including tire faces and roof sensor.
- Gold panels #dab04b / #ebc968; structural navy #253c48; rubber #1a2327; glazing #60777b; steel #81949b; warm cream #e8e6d9.
- Smooth body tiles alternate with exposed studs and explicit seams. No brand logos or invented physical certification.

## Fixed review shots

`/atelier.html` is a synthetic art-review fixture, excluded from simulation inventory and metrics. It uses the actual shared vehicle builder inside the actual assembly cell. The hero car is turned toward the hall for composition; the vehicle-detail shot hides the two foreground robots, while the cell shot restores them. These art-fixture choices do not alter live production.

| Shot | Target | Radius | Alpha / beta | Review question |
| --- | --- | --- | --- | --- |
| Robotaxi | (10, 2.15, 0) | 7.5 | 0.60 / 1.25 | Do silhouette, panel seams, wheels and canopy read as a cohesive premium brick-built vehicle? |
| Assembly cell | (10, 2.2, 0) | 16 | -2.05 / 1.10 | Do joints, tooling, fixtures and conveyor scale support a credible operation? |
| Robot detail | (7, 2, -3) | 7.5 | -2.20 / 1.20 | Are pivots, fasteners and the gripper intelligible? |
| Site | (0, 0.8, 0) | 88 | -1.28 / 0.67 | Are inbound, five lines, joining and parking readable in a coherent composition? |

Capture at 1920×1080 where the browser supports it; otherwise label the actual dimensions. Use warm-up before measurements. Never treat this synthetic fixture as evidence of material flow.

## Review rubric

For each shot record observed improvement, remaining defect and PASS / NEEDS WORK for silhouette, part detail, material response, lighting, composition and functional legibility. Do not turn subjective reference matching into an invented numerical completion percentage. User aesthetic review remains distinct from technical verification.

## Ownership

- `visuals/robotaxi.ts`: shared five-module asset and profile primitives.
- `world.ts`: simulation-to-scene bindings, reusable shape caching, kinematics, lighting and cameras.
- `visuals/site-detail.ts`: optional static architectural additions when integrated.
- `atelier.ts`: repeatable synthetic review setup.

After the representative vehicle/cell review, extend the approved visual treatment to the full site. The production simulation remains authoritative throughout.
