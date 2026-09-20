# Visual provenance

- `visual-target.png`: original concept sheet generated for this project with the built-in OpenAI image-generation tool on 2026-09-19. Direction: premium miniature brick factory, five color-coded module lines, gold two-seat robotaxi, receiving road and parking. This is a design reference, not a screenshot or a physical-build certification. No corporate logos are included.
- Runtime geometry, signs, materials and audio: original procedural code in `apps/web/src/world.ts` and `audio.ts`, MIT.
- `apps/web/public/assets/studio.env`: unmodified BabylonJS Assets studio environment, downloaded from https://github.com/BabylonJS/Assets/blob/master/environments/studio.env. Credit: Babylon.js contributors. Licensed CC BY 4.0; license included at `studio.LICENSE.txt`. https://creativecommons.org/licenses/by/4.0/ . Used as reflection/lighting data, served locally without runtime network dependency. The app footer provides attribution.
- Interface icons: Lucide, ISC licensed through the `lucide-react` package. Dependency license remains in its distribution.

The generated reference supplements the functioning Babylon.js world. All reviewed application captures are separate from the concept sheet.

Brick and station dimensions are inspectable in `packages/assets/src/design.ts`. Final joining visual order is floor, front, rear, cabin, exterior. Autonomous module carriers support subassemblies during the late joining animation; final assembly reserves all five accepted modules before those transfers begin.
