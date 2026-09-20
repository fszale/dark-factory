import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Mesh, MeshBuilder, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { LINE_IDS } from '../packages/contracts/src/index';
import { buildRobotaxiModule, type RobotaxiBuildApi, type VehicleVector } from '../apps/web/src/visuals/robotaxi';

describe('shared manufactured robotaxi geometry', () => {
  let engine: NullEngine;
  let scene: Scene;
  let api: RobotaxiBuildApi;
  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    const materials = new Map<string, StandardMaterial>();
    const material = (color: string) => {
      if (!materials.has(color)) materials.set(color, new StandardMaterial(color, scene));
      return materials.get(color)!;
    };
    const place = (mesh: Mesh, position: VehicleVector, color: string, parent?: TransformNode, rotation?: VehicleVector) => {
      mesh.position.set(...position); mesh.parent = parent ?? null; mesh.material = material(color);
      if (rotation) mesh.rotation.set(...rotation);
      return mesh;
    };
    api = {
      scene, material,
      box: (p, s, c, n, r) => place(MeshBuilder.CreateBox('box', { width: s[0], height: s[1], depth: s[2] }, scene), p, c, n, r),
      cyl: (p, diameter, height, c, n, r) => place(MeshBuilder.CreateCylinder('cylinder', { diameter, height, tessellation: 16 }, scene), p, c, n, r),
      brick: (p, s, c, n, studs = true) => {
        api.box(p, s, c, n);
        if (!studs) return;
        const nx = Math.max(1, Math.floor(s[0] / .4)), nz = Math.max(1, Math.floor(s[2] / .4));
        for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++)
          api.cyl([p[0] + (x - (nx - 1) / 2) * .4, p[1] + s[1] / 2 + .045, p[2] + (z - (nz - 1) / 2) * .4], .24, .09, c, n);
      },
    };
  });
  afterEach(() => { scene.dispose(); engine.dispose(); });

  const boundsClose = (a: Vector3, b: Vector3) => {
    for (const axis of ['x', 'y', 'z'] as const) expect(a[axis]).toBeCloseTo(b[axis], 5);
  };

  it('keeps finite geometry within the existing production and road envelope', () => {
    const car = new TransformNode('car', scene);
    for (const line of LINE_IDS) {
      const module = new TransformNode(line, scene); module.parent = car;
      buildRobotaxiModule(api, module, line);
      expect(module.getChildMeshes().length).toBeGreaterThan(0);
    }
    for (const mesh of car.getChildMeshes()) {
      const positions = mesh.getVerticesData('position')!;
      const normals = mesh.getVerticesData('normal')!;
      expect(positions.length).toBeGreaterThan(0);
      expect(normals.length).toBe(positions.length);
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
      expect(Array.from(normals).every(Number.isFinite)).toBe(true);
      for (let i = 0; i < normals.length; i += 3)
        expect(Math.hypot(normals[i], normals[i + 1], normals[i + 2])).toBeCloseTo(1, 4);
    }
    const { min, max } = car.getHierarchyBoundingVectors(true);
    const size = max.subtract(min);
    expect(min.y).toBeGreaterThanOrEqual(0);
    expect(Math.max(Math.abs(min.x), Math.abs(max.x))).toBeLessThan(2.25);
    expect(Math.max(Math.abs(min.z), Math.abs(max.z))).toBeLessThan(1.35);
    expect(max.y).toBeLessThan(2.25);
    // Catch accidentally empty or radically mis-scaled assets as well as oversized ones.
    expect(size.x).toBeGreaterThan(4);
    expect(size.y).toBeGreaterThan(1.8);
    expect(size.z).toBeGreaterThan(2.3);
  });

  it('gives every convex extruded panel outward normals rather than an inside-out shell', () => {
    const exterior = new TransformNode('exterior', scene);
    buildRobotaxiModule(api, exterior, 'exterior');
    const panels = exterior.getChildMeshes().filter(mesh => mesh.name === 'robotaxi-panel');
    expect(panels.length).toBeGreaterThan(0);
    for (const mesh of panels) {
      const positions = mesh.getVerticesData('position')!, normals = mesh.getVerticesData('normal')!;
      const center = Vector3.Zero();
      for (let i = 0; i < positions.length; i += 3) center.addInPlace(Vector3.FromArray(positions, i));
      center.scaleInPlace(3 / positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        const radial = Vector3.FromArray(positions, i).subtract(center);
        expect(Vector3.Dot(radial, Vector3.FromArray(normals, i))).toBeGreaterThan(0);
      }
    }
  });


  it('spins finished wheels around their local axles without moving fenders or changing manufacturing stages', () => {
    for (const line of ['front', 'rear'] as const) {
      const module = new TransformNode(line, scene);
      buildRobotaxiModule(api, module, line);
      const wheels = module.getChildren().filter(node => node.name === 'road-wheel') as TransformNode[];
      expect(wheels).toHaveLength(2);
      const fixedMeshes = module.getChildren().filter(node => node instanceof Mesh) as Mesh[];
      expect(fixedMeshes.length).toBeGreaterThan(0);
      const fixedPositions = fixedMeshes.map(mesh => mesh.computeWorldMatrix(true).asArray().slice());
      for (const wheel of wheels) {
        expect(wheel.position.asArray()).toEqual([line === 'front' ? -1.45 : 1.45, .57, wheel.metadata.side]);
        expect(wheel.metadata.axis).toBe('z');
        expect(wheel.metadata.radius).toBeGreaterThan(.4);
        const tread = wheel.getChildMeshes().find(mesh => mesh.name === 'box')!;
        const before = tread.computeWorldMatrix(true).getTranslation();
        const axle = wheel.getAbsolutePosition().clone();
        wheel.rotation.z = Math.PI / 3;
        const after = tread.computeWorldMatrix(true).getTranslation();
        expect(Vector3.Distance(before, after)).toBeGreaterThan(.1);
        expect(Vector3.Distance(before, axle)).toBeCloseTo(Vector3.Distance(after, axle), 5);
        expect(after.z).toBeCloseTo(before.z, 5);
      }
      fixedMeshes.forEach((mesh, i) => expect(Array.from(mesh.computeWorldMatrix(true).asArray())).toEqual(Array.from(fixedPositions[i])));
      const staged = new TransformNode(`staged:${line}`, scene), stages: TransformNode[] = [];
      buildRobotaxiModule(api, staged, line, stages);
      expect(staged.getDescendants().filter(node => node.name === 'road-wheel')).toHaveLength(0);
      const wheelStages = stages.filter(stage => stage.name.startsWith('module-stage:wheel:'));
      expect(wheelStages).toHaveLength(2);
      for (const stage of wheelStages) {
        expect(stage.position.asArray()).toEqual([0, 0, 0]);
        expect(stage.metadata.gripCenter[0]).toBe(line === 'front' ? -1.45 : 1.45);
        expect(stage.getChildren().every(node => node instanceof Mesh)).toBe(true);
      }
    }
  });

  it('preserves shared staged geometry, grip metadata and direct children for compaction', () => {
    for (const line of LINE_IDS) {
      const assembled = new TransformNode(`assembled:${line}`, scene);
      buildRobotaxiModule(api, assembled, line);
      const staged = new TransformNode(`staged:${line}`, scene), stages: TransformNode[] = [];
      buildRobotaxiModule(api, staged, line, stages);
      expect(stages.length).toBeGreaterThan(0);
      for (const stage of stages) {
        expect(stage.parent).toBe(staged);
        expect(stage.metadata.gripCenter).toHaveLength(3);
        expect(stage.metadata.gripCenter.every(Number.isFinite)).toBe(true);
        expect(stage.getChildMeshes().length).toBeGreaterThan(0);
      }
      const assembledBounds = assembled.getHierarchyBoundingVectors(true), stagedBounds = staged.getHierarchyBoundingVectors(true);
      boundsClose(assembledBounds.min, stagedBounds.min);
      boundsClose(assembledBounds.max, stagedBounds.max);
      for (const root of [assembled, ...stages]) {
        for (const child of root.getChildren()) {
          if (child instanceof Mesh) continue;
          expect(child).toBeInstanceOf(TransformNode);
          expect(['door', 'road-wheel']).toContain(child.name);
          expect(child.getChildren().every(node => node instanceof Mesh)).toBe(true);
        }
      }
      const doors = assembled.getChildren().filter(node => node.name === 'door') as TransformNode[];
      expect(doors.length).toBe(line === 'exterior' ? 2 : 0);
      for (const door of doors) {
        expect(door.position.x).toBeLessThan(0);
        expect(door.position.y).toBeGreaterThan(.5);
        expect(Math.abs(door.position.z)).toBeGreaterThan(.8);
        expect(door.getChildMeshes().every(mesh => mesh.parent === door)).toBe(true);
      }
      if (doors.length === 2) expect(doors[0].position.z * doors[1].position.z).toBeLessThan(0);
    }
  });
});
