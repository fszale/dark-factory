import { afterEach, beforeEach, expect, it } from 'vitest';
import { MeshBuilder, NullEngine, Scene, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import { FactoryWorld } from '../apps/web/src/world';

let engine: NullEngine, scene: Scene;
beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterEach(() => { scene.dispose(); engine.dispose(); });
const roll = (root: TransformNode, time: number, phase = 'road', moving = true, truck = false) =>
  (FactoryWorld.prototype as any).rollWheels.call({}, root, time, phase, moving, truck);
function vehicle(truck = false) {
  const root = new TransformNode('vehicle', scene), wheel = new TransformNode('road-wheel', scene);
  wheel.parent = root;
  wheel.metadata = { axis: truck ? 'x' : 'z', radius: truck ? .55 : .51, side: 1 };
  root.metadata = { wheels: [wheel] };
  return { root, wheel };
}

it.each([false, true])('rolls forward and reverse with the physical axle direction (truck=%s)', truck => {
  for (const yaw of [0, Math.PI / 2, -.7]) {
    const { root, wheel } = vehicle(truck);
    root.rotation.y = yaw;
    const axis = truck ? 'x' : 'z', radius = wheel.metadata.radius;
    const forward = truck ? new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)) : new Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    roll(root, 0, 'road', true, truck);
    root.position.addInPlace(forward.scale(radius * .2));
    roll(root, 1, 'road', true, truck);
    expect(wheel.rotation[axis]).toBeCloseTo(truck ? -.2 : .2, 6);
    // The top of the wheel must travel in the same world direction as the vehicle.
    const top = Vector3.TransformNormal(new Vector3(0, radius, 0), wheel.computeWorldMatrix(true));
    expect(Vector3.Dot(top, forward)).toBeGreaterThan(0);
    root.position.subtractInPlace(forward.scale(radius * .3));
    roll(root, 2, 'road', true, truck);
    expect(wheel.rotation[axis]).toBeCloseTo(truck ? .1 : -.1, 6);
  }
});

it('does not spin at rest, while paused, or when motion is disabled', () => {
  const { root, wheel } = vehicle();
  roll(root, 0);
  roll(root, 1);
  expect(wheel.rotation.z).toBe(0);
  root.position.x = -.5;
  roll(root, 1); // unchanged simulation clock, even if a pose is corrected
  expect(wheel.rotation.z).toBe(0);
  root.position.x = -1;
  roll(root, 2, 'road', false);
  expect(wheel.rotation.z).toBe(0);
  root.position.x = -1.51;
  roll(root, 3);
  expect(wheel.rotation.z).toBeCloseTo(1);
});

it('resets the travel baseline across phases, discontinuities and restored clocks', () => {
  const { root, wheel } = vehicle();
  roll(root, 10, 'outbound');
  root.position.x = -2;
  roll(root, 11, 'parking');
  expect(wheel.rotation.z).toBe(0);
  root.position.x = -2.51;
  roll(root, 12, 'parking');
  expect(wheel.rotation.z).toBeCloseTo(1);
  root.position.x = -30;
  roll(root, 13, 'parking'); // teleport, not traversed road
  expect(wheel.rotation.z).toBeCloseTo(1);
  root.position.x = -30.51;
  roll(root, 14, 'parking');
  expect(wheel.rotation.z).toBeCloseTo(2);
  root.position.x = -5;
  roll(root, 2, 'parking'); // checkpoint restored to an earlier clock
  expect(wheel.rotation.z).toBeCloseTo(2);
  root.position.x = -5.51;
  roll(root, 3, 'parking');
  expect(wheel.rotation.z).toBeCloseTo(3);
});

it('preserves axle metadata and local pivots when wheel geometry is compacted', () => {
  const { root, wheel } = vehicle(true);
  wheel.position.set(1.4, .65, -2.5);
  const metadata = wheel.metadata;
  const mesh = MeshBuilder.CreateBox('tread', { size: .1 }, scene);
  mesh.parent = wheel; mesh.position.y = .55;
  mesh.material = new StandardMaterial('rubber', scene);
  const context = { scene, carPrefabs: new Map(), shadow: { addShadowCaster: () => {} } };
  (FactoryWorld.prototype as any).compactAssembly.call(context, wheel, 'test-wheel');
  expect(wheel.metadata).toBe(metadata);
  expect(wheel.position.asArray()).toEqual([1.4, .65, -2.5]);
  expect(wheel.parent).toBe(root);
  expect(wheel.getChildMeshes()).toHaveLength(1);
  roll(root, 0, 'road', true, true);
  root.position.z = -.55;
  roll(root, 1, 'road', true, true);
  expect(wheel.rotation.x).toBeCloseTo(-1);
});


it('keeps textured labels and articulated children independent when batching rigid siblings', () => {
 const root = new TransformNode('cell', scene), joint = new TransformNode('joint', scene);
 joint.parent = root;
 const label = MeshBuilder.CreatePlane('label', {}, scene);
 label.parent = root;
 const material = new StandardMaterial('label-material', scene);
 material.diffuseTexture = new Texture(null, scene);
 label.material = material;
 const piece = MeshBuilder.CreateBox('piece', {}, scene);
 piece.material = new StandardMaterial('plastic', scene); piece.parent = root;
 const context = {scene, carPrefabs:new Map(), shadow:{addShadowCaster:()=>{}}};
 (FactoryWorld.prototype as any).compactAssembly.call(context,root,'rigid-test');
 expect(label.isDisposed()).toBe(false);expect(label.parent).toBe(root);
 expect(joint.parent).toBe(root);expect(piece.isDisposed()).toBe(true);
 expect(root.getChildren().length).toBe(3);
});
