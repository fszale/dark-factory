import { expect, it } from 'vitest';
import { MeshBuilder, NullEngine, Scene, TransformNode, Vector3, type Mesh } from '@babylonjs/core';
import { buildDeliveryTruck, type DeliveryTruckBuildApi } from '../apps/web/src/visuals/delivery-truck';
import type { VehicleVector } from '../apps/web/src/visuals/robotaxi';

it('keeps the detailed truck inside lane clearance and preserves the live pallet transfer volume', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const root = new TransformNode('delivery', scene), cargo = new TransformNode('cargo', scene);
    cargo.parent = root;
    cargo.position.set(.1, .2, .3);
    root.position.set(12, 0, -8);
    const metadata = { entity: 'delivery', cargo, pallets: [] };
    root.metadata = metadata;
    const meshes: Mesh[] = [];
    const place = (mesh: Mesh, position: VehicleVector, parent?: TransformNode, rotation?: VehicleVector) => {
      mesh.parent = parent ?? null; mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      meshes.push(mesh);
    };
    const api: DeliveryTruckBuildApi = {
      box: (p, s, _c, parent, r) => place(MeshBuilder.CreateBox('part', { width: s[0], height: s[1], depth: s[2] }, scene), p, parent, r),
      cyl: (p, diameter, height, _c, parent, r) => place(MeshBuilder.CreateCylinder('round-part', { diameter, height, tessellation: 16 }, scene), p, parent, r),
      brick: (p, s, c, parent) => api.box(p, s, c, parent),
    };
    buildDeliveryTruck(api, root);
    expect(root.metadata).toBe(metadata);
    expect(root.position.asArray()).toEqual([12, 0, -8]);
    expect(cargo.parent).toBe(root);
    expect(cargo.position.asArray()).toEqual([.1, .2, .3]);
    const wheels = root.getChildren().filter(node => node.name === 'road-wheel') as TransformNode[];
    expect(wheels).toHaveLength(6);
    expect(root.getChildren().filter(node => node instanceof TransformNode && !meshes.includes(node as Mesh))).toEqual([cargo, ...wheels]);
    expect(meshes.length).toBeGreaterThan(0);
    root.position.setAll(0);
    for (const mesh of meshes) {
      expect([root, ...wheels]).toContain(mesh.parent);
      expect(Array.from(mesh.getVerticesData('position')!).every(Number.isFinite)).toBe(true);
      mesh.computeWorldMatrix(true);
      const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
      expect(min.y).toBeGreaterThanOrEqual(0);
      expect(Math.max(Math.abs(min.x), Math.abs(max.x))).toBeLessThan(1.75);
      expect(min.z).toBeGreaterThan(-3.85);
      expect(max.z).toBeLessThan(3.65);
      expect(max.y).toBeLessThan(3.05);
      // Five existing pallet bases start at y=1.025, spanning x±1.075 and
      // z=-1.4..2.42. No new chassis/fender/rail may penetrate their load space.
      const overlapsLoad = min.x < 1.075 && max.x > -1.075 && min.z < 2.42 && max.z > -1.4;
      if (overlapsLoad) expect(max.y).toBeLessThan(1.025);
    }
    const body = meshes.filter(mesh => mesh.parent === root);
    const fixedMatrices = body.map(mesh => Array.from(mesh.computeWorldMatrix(true).asArray()));
    for (const wheel of wheels) {
      expect(wheel.metadata.axis).toBe('x');
      expect(wheel.metadata.radius).toBe(.55);
      expect(Math.abs(wheel.position.x)).toBe(1.4);
      expect(wheel.position.y).toBe(.65);
      expect([-2.5, 1.8, 2.7]).toContain(wheel.position.z);
      expect(wheel.getChildren().every(node => meshes.includes(node as Mesh))).toBe(true);
      const tread = wheel.getChildMeshes().find(mesh => mesh.name === 'part')!;
      const before = tread.computeWorldMatrix(true).getTranslation();
      const axle = wheel.getAbsolutePosition().clone();
      wheel.rotation.x = Math.PI / 3;
      const after = tread.computeWorldMatrix(true).getTranslation();
      expect(Vector3.Distance(before, after)).toBeGreaterThan(.1);
      expect(Vector3.Distance(before, axle)).toBeCloseTo(Vector3.Distance(after, axle), 5);
      expect(after.x).toBeCloseTo(before.x, 5);
    }
    body.forEach((mesh, i) => expect(Array.from(mesh.computeWorldMatrix(true).asArray())).toEqual(fixedMatrices[i]));
    expect(cargo.parent).toBe(root);
    expect(cargo.position.asArray()).toEqual([.1, .2, .3]);
    expect(root.metadata).toBe(metadata);
  } finally {
    scene.dispose(); engine.dispose();
  }
});
