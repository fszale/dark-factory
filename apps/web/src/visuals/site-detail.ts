import type { Scene, TransformNode } from '@babylonjs/core';
import type { VehicleVector } from './robotaxi';

export interface SiteDetailApi {
  scene: Scene;
  shell: TransformNode;
  roof: TransformNode;
  box(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, rotation?: VehicleVector, glow?: boolean): void;
  cyl(position: VehicleVector, diameter: number, height: number, color: string, parent?: TransformNode, rotation?: VehicleVector): void;
  brick(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, studs?: boolean): void;
  label(text: string, position: VehicleVector, width?: number, height?: number, color?: string, ground?: boolean): void;
}
const C = { frame: '#253c48', cream: '#e8e6d9', steel: '#81949b', glass: '#60777b', dark: '#152b36', gold: '#dab04b', leaf: '#608673', lightLeaf: '#7b9d7f', soil: '#705d49', flower: '#ebc968' };

/** Architectural and landscape detail only: never creates simulated material or vehicles. */
export function buildSiteDetail(api: SiteDetailApi): void {
  const { box, cyl, brick, shell, roof } = api;
  // Glazed bays follow the existing six-metre structural grid. All tall facade
  // detail participates in the same camera cutaway as the original columns.
  for (const side of [-1, 1]) {
    const z = side * 17.5;
    for (let bay = 0; bay < 6; bay++) {
      const x = -15 + bay * 6;
      for (const offset of [-1.43, 1.43]) {
        box([x + offset, 3.37, z], [2.68, 3.44, .045], C.glass, shell);
        box([x + offset, 5.48, z], [2.68, .56, .045], C.glass, shell);
      }
      for (const dx of [-2.86, 0, 2.86]) box([x + dx, 3.65, z], [.10, 4.35, .12], C.steel, shell);
      for (const y of [1.52, 5.16, 5.83]) box([x, y, z], [5.82, .11, .16], C.steel, shell);
      box([x, 1.39, z], [5.72, .16, .78], C.cream, shell);
      box([x, 5.98, z], [5.72, .14, .45], C.cream, shell);
      // Small opaque sill vents bring a manufactured scale to otherwise flat glazing.
      for (const dx of [-1.6, 0, 1.6]) box([x + dx, 1.64, z + side * .095], [.72, .065, .055], C.frame, shell);
    }
    for (const x of [-18, -6, 6, 18]) {
      box([x, .32, z], [1.08, .24, 1.08], C.cream, shell);
      box([x, 1.03, z], [.94, 1.14, .94], C.cream, shell);
      box([x, 1.65, z], [1.04, .12, 1.04], C.steel, shell);
      cyl([x + .51, 3.45, z + side * .20], .12, 5.8, C.steel, shell);
      for (const y of [1.4, 3.7, 5.8]) box([x + .51, y, z + side * .20], [.20, .075, .22], C.frame, shell);
    }
  }
  // Front plinth tiles use staggered seams; the original rear wall is retained.
  for (let course = 0; course < 2; course++) {
    for (let i = 0; i < 29; i++) {
      const x = -17.1 + i * 1.18 + (course ? .59 : 0);
      brick([x, .48 + course * .43, 17.52], [1.155, .405, .60], C.cream, shell, false);
    }
  }
  // A low permanent cap provides scale when the upper facade is cut away.
  for (let i = 0; i < 30; i++) box([-17.4 + i * 1.2, 1.82, -17.5], [1.17, .09, .70], C.steel);

  // Roof steelwork remains on the roof toggle, so production closeups stay clear.
  const diagonalLength = Math.hypot(2.8, .64), diagonalAngle = Math.atan2(.64, 2.8);
  for (const x of [-15, -3, 9]) {
    for (const y of [5.79, 6.43]) box([x, y, 0], [.14, .12, 33.6], C.steel, roof);
    for (let segment = 0; segment < 12; segment++) {
      const z = -15.4 + segment * 2.8;
      box([x, 6.11, z], [.09, .09, diagonalLength], C.steel, roof, [segment % 2 ? diagonalAngle : -diagonalAngle, 0, 0]);
      box([x, 6.11, z - 1.4], [.12, .72, .12], C.frame, roof);
    }
    box([x + .32, 5.64, 0], [.34, .11, 33.4], C.dark, roof);
  }

  // Shallow curb/drain assemblies do not cross the material cart corridor x=-18
  // or the outbound routes at x=23/31, and leave all parking bay entrances clear.
  for (const z of [-18.5, 18.5]) {
    for (let i = 0; i < 15; i++) {
      const x = -15 + i * 2;
      box([x, .19, z], [1.96, .21, .27], C.cream);
    }
  }
  for (const x of [-14, -6, 2, 10]) {
    box([x, .17, 19.0], [1.35, .07, .42], C.dark);
    for (let i = 0; i < 5; i++) box([x - .5 + i * .25, .214, 19.0], [.07, .028, .38], C.steel);
  }

  // Brick-edged beds with layered round leaf clusters and flower heads contrast
  // with the existing square tree canopies, without introducing a bespoke asset.
  const planter = (x: number, z: number) => {
    box([x, .3, z], [3.3, .40, 1.28], C.cream);
    box([x, .512, z], [3.02, .04, 1.02], C.soil);
    for (const side of [-1, 1]) {
      box([x, .55, z + side * .63], [3.42, .11, .16], C.steel);
    }
    for (let i = 0; i < 5; i++) {
      const px = x - 1.16 + i * .58, pz = z + (i % 2 ? -.16 : .16);
      cyl([px, .75, pz], .63, .42, C.leaf);
      cyl([px + .12, 1.01, pz + .06], .47, .23, C.lightLeaf);
      cyl([px - .17, .96, pz - .14], .38, .22, C.leaf);
      cyl([px + .08, 1.145, pz + .07], .10, .045, C.flower);
    }
    // Exposed end studs and regular course divisions keep the miniature brick language.
    for (const end of [-1, 1]) {
      box([x + end * 1.6, .55, z], [.16, .11, 1.18], C.steel);
      for (const dz of [-.39, 0, .39]) cyl([x + end * 1.6, .64, z + dz], .16, .06, C.cream);
    }
  };
  for (const x of [-12, -4, 4, 12]) planter(x, 20.5);
  for (const x of [-12, 0, 12]) planter(x, -21.8);
  // Compact bollards protect landscaping, outside the road and dock envelopes.
  for (const x of [-14.3, -9.7, 1.7, 6.3, 14.3]) {
    cyl([x, .57, 20.5], .18, .9, C.frame);
    cyl([x, .86, 20.5], .185, .10, C.gold);
    cyl([x, 1.035, 20.5], .20, .045, C.steel);
  }
}
