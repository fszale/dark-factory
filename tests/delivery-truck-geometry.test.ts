import { expect, it } from 'vitest';
import { MeshBuilder, NullEngine, Scene, TransformNode, type Mesh } from '@babylonjs/core';
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
    expect(root.getChildren().filter(node => node instanceof TransformNode && !meshes.includes(node as Mesh))).toEqual([cargo]);
    expect(meshes.length).toBeGreaterThan(0);
    root.position.setAll(0);
    for (const mesh of meshes) {
      expect(mesh.parent).toBe(root);
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
  } finally {
    scene.dispose(); engine.dispose();
  }
});
