import { TransformNode, type Scene } from '@babylonjs/core';
import type { VehicleVector } from './robotaxi';

export interface InspectionHumanoidBuildApi {
  scene: Scene;
  box(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, rotation?: VehicleVector, glow?: boolean): void;
  brick(position: VehicleVector, size: VehicleVector, color: string, parent?: TransformNode, studs?: boolean): void;
  cyl(position: VehicleVector, diameter: number, height: number, color: string, parent?: TransformNode, rotation?: VehicleVector): void;
}

export interface InspectionHumanoids {
  update(simTime: number): void;
  dispose(): void;
}

const C = {
  shell: '#f4f1e4',
  shellShade: '#d8d9d4',
  visor: '#10191f',
  joint: '#1a2327',
  detail: '#81949b',
};

interface Rig {
  root: TransformNode;
  head: TransformNode;
  shoulders: [TransformNode, TransformNode];
  elbows: [TransformNode, TransformNode];
  hips: [TransformNode, TransformNode];
  knees: [TransformNode, TransformNode];
  route: {
    from: [number, number];
    to: [number, number];
    phaseOffset: number;
  };
}

const WALK_SPEED = 0.72;
const DWELL_SECONDS = 5;

function buildFigure(
  api: InspectionHumanoidBuildApi,
  name: string,
  route: Rig['route'],
): Rig {
  const { scene, box, brick, cyl } = api;
  const root = new TransformNode(`${name}:root`, scene);
  root.metadata = {
    decorative: true,
    role: 'visual inspection only',
    affectsSimulation: false,
  };

  const pelvis = new TransformNode(`${name}:pelvis`, scene);
  pelvis.parent = root;
  pelvis.position.y = 1.38;
  brick([0, 0, 0], [.62, .30, .39], C.shellShade, pelvis, false);
  box([0, .18, 0], [.48, .12, .34], C.joint, pelvis);

  const torso = new TransformNode(`${name}:torso`, scene);
  torso.parent = root;
  torso.position.y = 1.78;
  brick([0, .18, 0], [.82, .72, .43], C.shell, torso, false);
  box([0, .19, .225], [.55, .34, .035], C.shellShade, torso);
  box([0, -.20, 0], [.52, .10, .34], C.joint, torso);
  box([0, .55, 0], [.22, .11, .24], C.joint, torso);

  const head = new TransformNode(`${name}:head`, scene);
  head.parent = root;
  head.position.y = 2.52;
  brick([0, 0, 0], [.55, .45, .47], C.shell, head, false);
  box([0, .02, .247], [.46, .21, .035], C.visor, head);
  box([0, -.17, .24], [.22, .065, .025], C.detail, head);
  for (const side of [-1, 1]) {
    cyl([side * .292, 0, 0], .13, .05, C.joint, head, [0, 0, Math.PI / 2]);
  }

  const shoulders: TransformNode[] = [];
  const elbows: TransformNode[] = [];
  const hips: TransformNode[] = [];
  const knees: TransformNode[] = [];

  for (const side of [-1, 1]) {
    const shoulder = new TransformNode(`${name}:shoulder:${side}`, scene);
    shoulder.parent = root;
    shoulder.position.set(side * .49, 2.13, 0);
    cyl([0, 0, 0], .22, .18, C.joint, shoulder, [0, 0, Math.PI / 2]);
    brick([side * .02, -.31, 0], [.28, .58, .30], C.shell, shoulder, false);

    const elbow = new TransformNode(`${name}:elbow:${side}`, scene);
    elbow.parent = shoulder;
    elbow.position.y = -.62;
    cyl([0, 0, 0], .19, .20, C.joint, elbow, [0, 0, Math.PI / 2]);
    brick([0, -.29, 0], [.25, .52, .27], C.shellShade, elbow, false);
    box([0, -.59, 0], [.28, .16, .31], C.joint, elbow);
    brick([0, -.70, 0], [.31, .18, .34], C.shell, elbow, false);
    for (let finger = -1; finger <= 1; finger++) {
      box([finger * .09, -.84, .07], [.055, .23, .07], C.joint, elbow);
    }
    shoulders.push(shoulder);
    elbows.push(elbow);

    const hip = new TransformNode(`${name}:hip:${side}`, scene);
    hip.parent = root;
    hip.position.set(side * .20, 1.31, 0);
    cyl([0, 0, 0], .23, .18, C.joint, hip, [0, 0, Math.PI / 2]);
    brick([0, -.31, 0], [.31, .58, .36], C.shell, hip, false);

    const knee = new TransformNode(`${name}:knee:${side}`, scene);
    knee.parent = hip;
    knee.position.y = -.64;
    cyl([0, 0, 0], .21, .19, C.joint, knee, [0, 0, Math.PI / 2]);
    brick([0, -.30, 0], [.29, .54, .33], C.shellShade, knee, false);
    box([0, -.60, .08], [.28, .14, .37], C.joint, knee);
    brick([0, -.70, .10], [.34, .17, .54], C.shell, knee, false);
    box([0, -.80, .18], [.38, .08, .65], C.joint, knee);
    hips.push(hip);
    knees.push(knee);
  }

  return {
    root,
    head,
    shoulders: shoulders as Rig['shoulders'],
    elbows: elbows as Rig['elbows'],
    hips: hips as Rig['hips'],
    knees: knees as Rig['knees'],
    route,
  };
}

function updateRig(rig: Rig, simTime: number): void {
  const [ax, az] = rig.route.from;
  const [bx, bz] = rig.route.to;
  const dx = bx - ax;
  const dz = bz - az;
  const distance = Math.hypot(dx, dz);
  const travelSeconds = distance / WALK_SPEED;
  const cycleSeconds = travelSeconds * 2 + DWELL_SECONDS * 2;
  const phase = ((simTime + rig.route.phaseOffset) % cycleSeconds + cycleSeconds) % cycleSeconds;

  let progress = 0;
  let direction = 1;
  let walking = false;
  let dwellProgress = 0;
  if (phase < travelSeconds) {
    progress = phase / travelSeconds;
    walking = true;
  } else if (phase < travelSeconds + DWELL_SECONDS) {
    progress = 1;
    dwellProgress = (phase - travelSeconds) / DWELL_SECONDS;
  } else if (phase < travelSeconds * 2 + DWELL_SECONDS) {
    progress = 1 - (phase - travelSeconds - DWELL_SECONDS) / travelSeconds;
    direction = -1;
    walking = true;
  } else {
    direction = -1;
    dwellProgress = (phase - travelSeconds * 2 - DWELL_SECONDS) / DWELL_SECONDS;
  }

  rig.root.position.set(ax + dx * progress, 0, az + dz * progress);
  rig.root.rotation.y = Math.atan2(dx * direction, dz * direction);

  const stride = walking ? Math.sin(simTime * 5.4) : 0;
  const kneeLift = walking ? Math.max(0, Math.sin(simTime * 5.4)) : 0;
  rig.hips[0].rotation.x = stride * .38;
  rig.hips[1].rotation.x = -stride * .38;
  rig.knees[0].rotation.x = Math.max(0, -stride) * .42;
  rig.knees[1].rotation.x = Math.max(0, stride) * .42;
  rig.shoulders[0].rotation.x = -stride * .30;
  rig.shoulders[1].rotation.x = stride * .30;
  rig.elbows[0].rotation.x = walking ? -.10 - kneeLift * .08 : -.08;
  rig.elbows[1].rotation.x = walking ? -.10 - (1 - kneeLift) * .08 : -.08;
  rig.root.position.y = .22 + (walking ? Math.abs(stride) * .025 : 0);

  // At each endpoint the inspector pauses, scans the nearby machinery, and
  // briefly raises one forearm. This is decorative and changes no factory state.
  const inspection = walking ? 0 : Math.sin(Math.PI * Math.min(1, dwellProgress));
  rig.head.rotation.y = walking ? 0 : Math.sin(dwellProgress * Math.PI * 2) * .58;
  rig.shoulders[0].rotation.x -= inspection * .26;
  rig.elbows[0].rotation.x -= inspection * .78;
}

/**
 * Builds three bounded decorative inspectors. Their animation is exclusively a
 * function of authoritative simulation time, so pause and speed controls apply
 * without a separate wall-clock loop. They never mutate maintenance or metrics.
 */
export function createInspectionHumanoids(api: InspectionHumanoidBuildApi): InspectionHumanoids {
  const rigs = [
    buildFigure(api, 'inspection-humanoid:north', {
      from: [-13, -16], to: [0, -16], phaseOffset: 0,
    }),
    buildFigure(api, 'inspection-humanoid:south', {
      from: [0, 16], to: [-13, 16], phaseOffset: 11,
    }),
    buildFigure(api, 'inspection-humanoid:receiving', {
      from: [-22, 18], to: [-22, 23], phaseOffset: 5,
    }),
  ];

  return {
    update(simTime: number) {
      for (const rig of rigs) updateRig(rig, simTime);
    },
    dispose() {
      for (const rig of rigs) rig.root.dispose(false, false);
    },
  };
}
