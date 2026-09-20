import { Mesh, TransformNode, VertexData, type Material, type Scene } from '@babylonjs/core';
import type { LineId } from '../../../../packages/contracts/src/index';

export type VehicleVector = [number, number, number];
export interface RobotaxiBuildApi {
  scene: Scene;
  box(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, rotation?: VehicleVector, glow?: boolean): void;
  brick(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, studs?: boolean): void;
  cyl(position: VehicleVector, diameter: number, height: number, color: string, parent?: TransformNode, rotation?: VehicleVector): void;
  material(color: string, glow?: boolean): Material;
}
const P = {
  gold: '#dab04b', light: '#ebc968', dark: '#152b36', rubber: '#1a2327',
  glass: '#60777b', cream: '#e8e6d9', steel: '#81949b', teal: '#4eb6a7', white: '#f4f1e4',
};
type Point = [number, number];
// Templates share immutable geometry. All visible pieces remain direct children so
// the world's material-based module compactor can merge and instance them.
const profiles = new WeakMap<Scene, Map<string, Mesh>>();
function profile(api: RobotaxiBuildApi, points: Point[], width: number, z: number, color: string, parent: TransformNode) {
  let cache = profiles.get(api.scene);
  if (!cache) { cache = new Map(); profiles.set(api.scene, cache); }
  const key = JSON.stringify([points, width]);
  let template = cache.get(key);
  if (!template) {
    const positions: number[] = [], indices: number[] = [];
    const face = (vertices: VehicleVector[]) => {
      const start = positions.length / 3;
      vertices.forEach(p => positions.push(...p));
      for (let i = 1; i < vertices.length - 1; i++) indices.push(start, start + i + 1, start + i);
    };
    // Clockwise 2D profiles viewed from the near side, with duplicated vertices
    // along edges to retain the crisp molded panel normals.
    face(points.map(([x, y]) => [x, y, -width / 2]));
    face([...points].reverse().map(([x, y]) => [x, y, width / 2]));
    points.forEach(([x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      face([[x, y, width / 2], [nx, ny, width / 2], [nx, ny, -width / 2], [x, y, -width / 2]]);
    });
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals;
    template = new Mesh('robotaxi-profile-template', api.scene);
    data.applyToMesh(template);
    template.isVisible = false; template.isPickable = false;
    cache.set(key, template);
  }
  const mesh = template.clone('robotaxi-panel', parent)!;
  mesh.isVisible = true; mesh.position.z = z;
  mesh.material = api.material(color); mesh.receiveShadows = true;
  return mesh;
}

/** Shared manufacture/assembly/road asset, authored in the existing five-module envelope. */
export function buildRobotaxiModule(api: RobotaxiBuildApi, parent: TransformNode, line: LineId, stages?: TransformNode[]): void {
  const { box, brick, cyl } = api;
  const stage = (name: string, gripCenter: VehicleVector = [0, .75, 0]) => {
    if (!stages) return parent;
    const node = new TransformNode(`module-stage:${name}`, api.scene);
    node.parent = parent; node.metadata = { gripCenter }; stages.push(node);
    return node;
  };
  const panel = (points: Point[], width: number, z: number, color: string, owner: TransformNode) => profile(api, points, width, z, color, owner);
  if (line === 'battery') {
    const tray = stage('tray', [0, .53, 0]);
    brick([0, .48, 0], [3.5, .19, 1.72], P.dark, tray, false);
    for (const z of [-.85, .85]) box([0, .62, z], [3.5, .13, .065], P.steel, tray);
    for (let x = -1.25; x <= 1.25; x += .5) {
      const cell = stage(`cell:${x}`, [x, .68, 0]);
      brick([x, .65, 0], [.45, .18, 1.5], P.teal, cell, false);
      for (const z of [-.6, .6]) box([x, .757, z], [.28, .035, .12], P.steel, cell);
    }
    return;
  }
  if (line === 'front' || line === 'rear') {
    const front = line === 'front', x = front ? -1.45 : 1.45, end = front ? -2.03 : 2.03;
    const frame = stage('axle-body', [x, .73, 0]);
    brick([x, .75, 0], [1.05, .32, 1.55], P.gold, frame);
    box([x, .55, 0], [.28, .2, 1.94], P.dark, frame);
    box([end, .52, 0], [.18, .23, 1.83], P.rubber, frame);
    box([end, .76, 0], [.16, .27, 1.98], P.gold, frame);
    box([end + (front ? -.09 : .09), .61, 0], [.018, .17, .92], P.dark, frame);
    for (const side of [-1, 1]) {
      const wheel = stages
        ? stage(`wheel:${side}`, [x, .57, side])
        : new TransformNode('road-wheel', api.scene);
      if (!stages) {
        wheel.parent = parent;
        wheel.position.set(x, .57, side);
        wheel.metadata = { radius: .51, axis: 'z', side };
      }
      // Manufacturing stages retain authored coordinates/grip centres. Finished
      // wheels use a local axle pivot, leaving their fenders on the module body.
      const local = (p: VehicleVector): VehicleVector => stages ? p : [p[0] - x, p[1] - .57, p[2] - side];
      cyl(local([x, .57, side]), 1.02, .33, P.rubber, wheel, [Math.PI / 2, 0, 0]);
      // Narrow raised tread blocks leave actual grooves; hub layers remain readable at close range.
      for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12;
        box(local([x + Math.sin(angle) * .507, .57 + Math.cos(angle) * .507, side]), [.087, .032, .32], P.rubber, wheel, [0, 0, -angle]);
      }
      cyl(local([x, .57, side * 1.179]), .79, .025, P.dark, wheel, [Math.PI / 2, 0, 0]);
      cyl(local([x, .57, side * 1.196]), .70, .025, P.gold, wheel, [Math.PI / 2, 0, 0]);
      cyl(local([x, .57, side * 1.214]), .61, .023, P.dark, wheel, [Math.PI / 2, 0, 0]);
      for (let spoke = 0; spoke < 6; spoke++) {
        const a = spoke * Math.PI / 3;
        box(local([x + Math.sin(a) * .2, .57 + Math.cos(a) * .2, side * 1.231]), [.055, .23, .02], P.steel, wheel, [0, 0, -a]);
      }
      cyl(local([x, .57, side * 1.252]), .24, .06, P.gold, wheel, [Math.PI / 2, 0, 0]);
      cyl(local([x, .57, side * 1.29]), .13, .02, P.dark, wheel, [Math.PI / 2, 0, 0]);
      const arch = stage(`wheel-arch:${side}`, [x, 1.15, side]);
      for (let i = 0; i < 9; i++) {
        const a = -.16 + i * (Math.PI + .32) / 8;
        box([x + Math.cos(a) * .623, .57 + Math.sin(a) * .623, side * 1.04], [.26, .135, .22], P.gold, arch, [0, 0, a - Math.PI / 2]);
      }
    }
    const light = stage('lightbar', [end, .94, 0]);
    box([end, .94, 0], [.17, .15, 1.94], P.dark, light);
    box([end + (front ? -.09 : .09), .952, 0], [.025, .055, 1.87], front ? P.white : '#ee665b', light, undefined, true);
    return;
  }
  if (line === 'interior') {
    const floor = stage('cabin-floor', [0, .8, 0]);
    box([0, .79, 0], [1.8, .08, 1.55], P.dark, floor);
    for (const side of [-1, 1]) {
      const z = side * .44, seat = stage(`seat:${side}`, [.3, 1.23, z]);
      box([.15, .9, z], [.58, .16, .55], P.dark, seat);
      brick([.12, 1.04, z], [.61, .18, .59], P.cream, seat, false);
      box([.43, 1.3, z], [.19, .55, .57], P.cream, seat, [0, 0, .1]);
      box([.46, 1.61, z], [.2, .22, .34], P.cream, seat);
      for (const dz of [-.3, .3]) box([.17, 1.12, z + dz], [.48, .14, .065], P.cream, seat);
      box([.307, 1.3, z - side * .13], [.025, .43, .035], P.dark, seat, [0, 0, .1]);
    }
    const console = stage('console', [-.55, 1.1, 0]);
    box([-.6, 1.08, 0], [.26, .22, 1.43], P.dark, console);
    box([-.46, 1.18, 0], [.05, .28, .46], P.glass, console, [0, 0, -.2]);
    box([-.425, 1.18, 0], [.025, .16, .32], P.teal, console, [0, 0, -.2], true);
    box([.04, 1, 0], [.64, .26, .17], P.dark, console);
    return;
  }
  const hood = stage('front-shell', [-1.52, 1.1, 0]);
  // Split tiles preserve fine seams without crossing the transparent canopy.
  for (const z of [-.665, 0, .665]) {
    panel([[-2.08, .99], [-1.05, 1.265], [-1.05, 1.12], [-2.08, .91]], z === 0 ? .79 : .52, z, z === 0 ? P.gold : P.light, hood);
  }
  for (const x of [-1.82, -1.24]) for (const z of [-.64, .64])
    cyl([x, 1.01 + (x + 2.08) * .267, z], .16, .06, P.gold, hood);
  const rear = stage('rear-shell', [1.47, 1.11, 0]);
  panel([[1.06, 1.27], [2.09, 1.06], [2.09, .96], [1.06, 1.12]], 1.89, 0, P.gold, rear);
  for (const x of [1.4, 1.78]) for (const z of [-.65, -.25, .25, .65])
    cyl([x, 1.3 - (x - 1.06) * .204, z], .18, .07, P.gold, rear);
  const roof = stage('glass-roof', [.04, 1.71, 0]);
  box([-.62, 1.552, 0], [1.1, .035, 1.55], P.glass, roof, [0, 0, .57]);
  box([.34, 1.853, 0], [.98, .045, 1.55], P.glass, roof);
  box([1.015, 1.557, 0], [.76, .035, 1.55], P.glass, roof, [0, 0, -.84]);
  for (const side of [-1, 1]) {
    const trim = stage(`trim:${side}`, [0, 1.27, side * .88]);
    box([-.62, 1.552, side * .812], [1.14, .065, .09], P.gold, trim, [0, 0, .57]);
    box([.34, 1.86, side * .814], [1.04, .08, .09], P.gold, trim);
    box([1.015, 1.56, side * .812], [.82, .07, .11], P.gold, trim, [0, 0, -.84]);
    box([0, .59, side * .955], [1.62, .14, .17], P.rubber, trim);
    box([0, .72, side * .98], [1.61, .075, .14], P.gold, trim);
  }
  box([-.14, 1.855, 0], [.065, .065, 1.62], P.dark, roof);
  box([.8, 1.855, 0], [.075, .065, 1.62], P.dark, roof);
  box([.54, 1.914, 0], [.48, .09, .45], P.dark, roof);
  cyl([.54, 2.013, 0], .31, .13, P.dark, roof);
  cyl([.54, 2.085, 0], .32, .025, P.steel, roof);
  for (const side of [-1, 1]) {
    const doorStage = stage(`door:${side}`, [0, 1.3, side * .94]);
    const door = new TransformNode('door', api.scene);
    door.parent = doorStage; door.position.set(-.74, 1.04, side * .94);
    // Local hinge coordinates are retained for the world's existing door animation.
    for (let column = 0; column < 3; column++) for (let row = 0; row < 2; row++)
      box([.26 + column * .48, -.15 + row * .2, 0], [.465, .187, .14], P.gold, door);
    panel([[.01, .19], [.60, .77], [1.43, .77], [1.49, .19]], .04, 0, P.glass, door);
    box([.755, .175, 0], [1.49, .06, .13], P.light, door);
    box([1.45, .47, 0], [.065, .59, .07], P.dark, door);
    box([1.21, .07, side * .09], [.22, .04, .025], P.dark, door);
    box([.035, .26, side * .115], [.18, .08, .18], P.dark, door);
  }
}
