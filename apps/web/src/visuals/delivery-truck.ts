import type { TransformNode } from '@babylonjs/core';
import type { VehicleVector } from './robotaxi';

export interface DeliveryTruckBuildApi {
  box(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, rotation?: VehicleVector, glow?: boolean): void;
  brick(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, studs?: boolean): void;
  cyl(position: VehicleVector, diameter: number, height: number, color: string, parent?: TransformNode, rotation?: VehicleVector): void;
}
const C = {
  navy: '#253c48', dark: '#152b36', steel: '#81949b', rubber: '#1a2327', teal: '#4eb6a7',
  glass: '#60777b', cream: '#e8e6d9', white: '#f4f1e4', amber: '#ebc968', red: '#ee665b',
};

/**
 * Original brick-built delivery chassis. Negative Z is the cab/front.
 * Cargo belongs to the authoritative world: this builder does not add, reparent,
 * hide or reposition pallets, nor mutate root metadata or its moving transform.
 * All pieces are direct children, permitting the existing material compactor.
 */
export function buildDeliveryTruck(api: DeliveryTruckBuildApi, parent: TransformNode): void {
  const { box, brick, cyl } = api;
  // The .90 deck datum leaves clearance beneath existing pallet bases at 1.025.
  box([0, .70, 0], [2.52, .30, 7], C.navy, parent);
  for (const x of [-.87, .87]) box([x, .50, .18], [.17, .22, 6.45], C.dark, parent);
  for (const z of [-2.5, 0, 1.8, 2.7]) box([0, .58, z], [2.62, .14, .20], C.steel, parent);
  box([0, .895, .92], [2.48, .11, 5.08], C.steel, parent);
  // Repeated deck planks and longitudinal rub rails add surface scale without
  // placing a barrier across the lateral receiving-lift transfer path.
  for (let i = 0; i < 11; i++) box([0, .958, -1.37 + i * .46], [2.27, .025, .435], C.navy, parent);
  for (const side of [-1, 1]) {
    box([side * 1.30, .87, .92], [.10, .27, 5.10], C.cream, parent);
    box([side * 1.36, .79, .92], [.045, .065, 5.12], C.steel, parent);
    box([side * 1.17, .36, .30], [.14, .10, 1.73], C.steel, parent);
    for (const z of [-.38, .98]) box([side * 1.17, .55, z], [.12, .40, .12], C.navy, parent);
    for (const z of [-1.05, .30, 1.60, 3.08]) {
      box([side * 1.365, .92, z], [.035, .065, .17], C.amber, parent, undefined, true);
      box([side * 1.36, .78, z + .20], [.04, .10, .07], C.dark, parent);
    }
    // Tank, tool locker and mudguards sit outside the cargo floor.
    box([side * .98, .57, -.61], [.56, .42, .92], C.steel, parent);
    box([side * 1.27, .57, -.61], [.035, .28, .70], C.navy, parent);
    box([side * 1.30, .61, -.61], [.025, .045, .19], C.steel, parent);
    box([side * 1.38, .48, 3.18], [.39, .53, .07], C.rubber, parent);
  }
  box([0, .60, 3.54], [2.61, .19, .15], C.steel, parent);
  box([0, .33, 3.48], [2.3, .13, .12], C.dark, parent);
  for (const side of [-1, 1]) {
    box([side * 1.02, .76, 3.56], [.43, .16, .035], C.dark, parent);
    box([side * 1.08, .78, 3.582], [.23, .085, .02], C.red, parent, undefined, true);
    box([side * .88, .78, 3.582], [.08, .085, .02], C.amber, parent);
  }
  box([0, .73, 3.58], [.48, .13, .025], C.cream, parent);

  // Three axles keep the same centres used by the prior truck silhouette.
  for (const z of [-2.5, 1.8, 2.7]) {
    cyl([0, .65, z], .18, 2.80, C.dark, parent, [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) {
      const x = side * 1.4;
      cyl([x, .65, z], 1.10, .35, C.rubber, parent, [0, 0, Math.PI / 2]);
      for (let i = 0; i < 18; i++) {
        const a = i * Math.PI / 9;
        box([x, .65 + Math.cos(a) * .551, z + Math.sin(a) * .551], [.34, .025, .105], C.rubber, parent, [a, 0, 0]);
      }
      cyl([side * 1.59, .65, z], .76, .04, C.steel, parent, [0, 0, Math.PI / 2]);
      cyl([side * 1.617, .65, z], .57, .025, C.navy, parent, [0, 0, Math.PI / 2]);
      cyl([side * 1.64, .65, z], .27, .06, C.steel, parent, [0, 0, Math.PI / 2]);
      for (let bolt = 0; bolt < 5; bolt++) {
        const a = bolt * Math.PI * .4;
        cyl([side * 1.64, .65 + Math.sin(a) * .22, z + Math.cos(a) * .22], .065, .025, C.steel, parent, [0, 0, Math.PI / 2]);
      }
    }
  }
  // Segmented front wheel arches; rear tandem arches have an open lower edge.
  for (const side of [-1, 1]) {
    for (let segment = 0; segment < 7; segment++) {
      const a = segment * Math.PI / 6;
      box([side * 1.39, .65 + Math.sin(a) * .66, -2.5 + Math.cos(a) * .66], [.39, .13, .32], C.teal, parent, [a - Math.PI / 2, 0, 0]);
    }
    box([side * 1.40, 1.265, 2.24], [.42, .10, 1.98], C.navy, parent);
    box([side * 1.40, .96, 1.25], [.42, .10, .65], C.navy, parent, [-.65, 0, 0]);
    box([side * 1.40, .96, 3.24], [.42, .10, .65], C.navy, parent, [.65, 0, 0]);
  }

  // Cab shell is assembled around clear glazing and a visible two-seat interior.
  box([0, 1.14, -2.67], [2.58, .37, 2.02], C.teal, parent);
  box([0, 1.37, -3.55], [2.61, .48, .25], C.teal, parent);
  box([0, 1.99, -1.67], [2.57, 1.61, .14], C.teal, parent);
  brick([0, 2.77, -2.56], [2.66, .18, 1.98], C.teal, parent, false);
  box([0, 2.91, -2.23], [2.08, .10, 1.04], C.cream, parent);
  for (const x of [-.78, .78]) {
    box([x, 1.48, -2.28], [.59, .19, .58], C.cream, parent);
    box([x, 1.81, -2.01], [.59, .60, .15], C.cream, parent);
    box([x, 2.13, -2.01], [.36, .18, .18], C.cream, parent);
  }
  box([0, 1.80, -3.10], [2.22, .18, .37], C.dark, parent);
  box([0, 1.98, -3.04], [.46, .27, .04], C.glass, parent, [.18, 0, 0]);
  box([0, 2.18, -3.56], [2.34, .96, .045], C.glass, parent, [.12, 0, 0]);
  for (const x of [-1.23, 0, 1.23]) box([x, 2.18, -3.575], [.065, 1.02, .075], C.navy, parent, [.12, 0, 0]);
  box([0, 2.70, -3.50], [2.63, .13, .29], C.teal, parent);
  box([0, 1.69, -3.64], [2.55, .11, .09], C.cream, parent);
  for (const x of [-.59, .59]) box([x, 1.81, -3.655], [.74, .035, .035], C.dark, parent, [0, 0, -.10]);
  for (const side of [-1, 1]) {
    box([side * 1.285, 2.17, -2.60], [.045, .90, 1.48], C.glass, parent);
    box([side * 1.29, 1.55, -2.61], [.10, .29, 1.54], C.teal, parent);
    box([side * 1.35, 1.70, -2.61], [.04, .065, 1.55], C.cream, parent);
    for (const z of [-3.35, -1.85]) box([side * 1.29, 2.18, z], [.10, 1.02, .085], C.teal, parent);
    box([side * 1.347, 1.62, -1.98], [.03, .045, .23], C.dark, parent);
    box([side * 1.28, .91, -1.76], [.53, .11, .49], C.steel, parent);
    box([side * 1.31, .72, -1.73], [.53, .11, .46], C.dark, parent);
    // Narrow projecting mirrors remain within the existing lane clearance.
    box([side * 1.48, 2.17, -3.14], [.35, .065, .075], C.navy, parent);
    box([side * 1.64, 2.17, -3.15], [.11, .40, .23], C.navy, parent);
    box([side * 1.70, 2.17, -3.15], [.02, .31, .17], C.steel, parent);
  }
  box([0, .94, -3.70], [2.73, .20, .18], C.steel, parent);
  box([0, 1.27, -3.69], [1.22, .37, .055], C.dark, parent);
  for (let row = 0; row < 4; row++) box([0, 1.15 + row * .078, -3.727], [1.12, .023, .025], C.steel, parent);
  for (const side of [-1, 1]) {
    box([side * .99, 1.25, -3.70], [.49, .24, .055], C.navy, parent);
    box([side * 1.0, 1.28, -3.735], [.39, .09, .025], C.white, parent, undefined, true);
    box([side * 1.13, 1.17, -3.735], [.12, .055, .025], C.amber, parent, undefined, true);
    cyl([side * .62, .85, -3.74], .12, .07, C.dark, parent, [Math.PI / 2, 0, 0]);
  }
  box([0, .98, -3.805], [.53, .12, .02], C.cream, parent);
  for (const x of [-.85, 0, .85]) box([x, 2.89, -3.24], [.17, .065, .09], C.amber, parent, undefined, true);
}
