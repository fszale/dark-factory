import { buildSiteDetail } from "./visuals/site-detail";
import { buildRobotaxiModule } from "./visuals/robotaxi";
import {
  Engine,
  Scene,
  Color3,
  Color4,
  Vector3,
  MeshBuilder,
  Mesh,
  TransformNode,
  PBRMaterial,
  StandardMaterial,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  ArcRotateCamera,
  DefaultRenderingPipeline,
  DynamicTexture,
  Matrix,
  Quaternion,
  VertexData,
  CubeTexture,
  PointerEventTypes,
  SSAO2RenderingPipeline,
  ImageProcessingConfiguration,
} from "@babylonjs/core";
import {
  LINE_IDS,
  LINE_META,
  type FactorySnapshot,
  type LineId,
} from "../../../packages/contracts/src/index";

const C = {
  navy: "#253c48",
  dark: "#152b36",
  steel: "#81949b",
  floor: "#aba99f",
  cream: "#e8e6d9",
  gold: "#dab04b",
  goldLight: "#ebc968",
  glass: "#60777b",
  rubber: "#1a2327",
  white: "#f4f1e4",
  orange: "#e5994e",
  teal: "#4eb6a7",
  green: "#6f9270",
  road: "#3b4145",
  yellow: "#ecd480",
};
type V = [number, number, number];
function c(hex: string) {
  return Color3.FromHexString(hex).toLinearSpace();
}
function lerp(a: V, b: V, t: number): V {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const pclip = (t: number) => Math.max(0, Math.min(1, t));
const angleStep = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));
export class FactoryWorld {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  snapshot: FactorySnapshot | null = null;
  fps = 0;
  selected = "";
  onSelect: (id: string) => void;
  onStats?: (fps: number, meshes: number) => void;
  private carPrefabs = new Map<string, Mesh[]>();
  private materials = new Map<string, PBRMaterial>();
  private templates = new Map<string, Mesh>();
  private staticBatches = new Map<string, { mesh: Mesh; matrices: number[] }>();
  private shadow: ShadowGenerator;
  private sun: DirectionalLight;
  private hemi: HemisphericLight;
  private pipeline: DefaultRenderingPipeline;
  private buildParent: TransformNode | undefined;
  private lineGroups = new Map<LineId, TransformNode>();
  private roots = new Map<string, TransformNode>();
  private stockVisuals = new Map<LineId, TransformNode[]>();
  private robots: {
    root: TransformNode;
    upper: TransformNode;
    lower: TransformNode;
    wrist: TransformNode;
    part: TransformNode;
    line: LineId;
    side: number;
  }[] = [];
  private stationPads = new Map<string, Mesh>();
  private lights: Mesh[] = [];
  private roof: TransformNode;
  private shell: TransformNode;
  private assemblyFrame: TransformNode;
  private facade: TransformNode;
  private lastSnapshotAt = 0;
  private tour = false;
  private tourStart = 0;
  private following = "";
  private exploded = false;
  private explodedId = "";
  private overlay = "none";
  private dusk = false;
  private targetCamera: {
    target: Vector3;
    radius: number;
    alpha: number;
    beta: number;
  } | null = null;
  private beams: Mesh[] = [];
  private selectRing: Mesh;
  private lastStats = 0;
  constructor(canvas: HTMLCanvasElement, onSelect: (id: string) => void) {
    this.onSelect = onSelect;
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.engine.setHardwareScalingLevel(Math.max(0.75, devicePixelRatio / 2));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.82, 0.82, 0.79, 1);
    this.scene.ambientColor = new Color3(0.15, 0.17, 0.16);
    this.camera = new ArcRotateCamera(
      "camera",
      -1.05,
      0.88,
      87,
      new Vector3(0, 0, 0),
      this.scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 7;
    this.camera.upperRadiusLimit = 130;
    this.camera.lowerBetaLimit = 0.12;
    this.camera.upperBetaLimit = 1.48;
    this.camera.wheelPrecision = 20;
    this.camera.panningSensibility = 65;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 400;
    this.hemi = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene);
    this.hemi.intensity = 0.42;
    this.hemi.groundColor = c("#667476");
    this.sun = new DirectionalLight(
      "sun",
      new Vector3(-0.6, -1, 0.5),
      this.scene,
    );
    this.sun.position = new Vector3(30, 50, -30);
    this.sun.intensity = 3.1;
    this.sun.diffuse = c("#fff1d6");
    this.shadow = new ShadowGenerator(2048, this.sun);
    this.shadow.usePercentageCloserFiltering = true;
    this.shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadow.bias = 0.002;
    this.shadow.normalBias = 0.03;
    this.shadow.setDarkness(0);
    this.scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(
      "/assets/studio.env",
      this.scene,
    );
    this.scene.environmentIntensity = 0.8;
    const ao = new SSAO2RenderingPipeline(
      "contact-occlusion",
      this.scene,
      { ssaoRatio: 0.5, blurRatio: 0.5 },
      [this.camera],
    );
    ao.radius = 0.8;
    ao.totalStrength = 0.7;
    ao.samples = 8;
    ao.expensiveBlur = false;
    this.pipeline = new DefaultRenderingPipeline("cinema", true, this.scene, [
      this.camera,
    ]);
    this.pipeline.samples = 4;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 1.1;
    this.pipeline.bloomWeight = 0.14;
    this.pipeline.bloomKernel = 32;
    this.pipeline.imageProcessing.contrast = 1.12;
    this.pipeline.imageProcessing.exposure = 1.05;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.roof = new TransformNode("roof", this.scene);
    this.shell = new TransformNode("cutaway-frame", this.scene);
    this.assemblyFrame = new TransformNode("assembly-frame", this.scene);
    this.facade = new TransformNode("glazed-facade", this.scene);
    this.buildSite();
    buildSiteDetail({scene:this.scene, shell:this.facade, roof:this.roof, box:this.box.bind(this), cyl:this.cyl.bind(this), brick:this.brick.bind(this), label:this.label.bind(this)});
    this.flushStatic();
    this.selectRing = MeshBuilder.CreateTorus(
      "selection",
      { diameter: 5, thickness: 0.075, tessellation: 64 },
      this.scene,
    );
    this.selectRing.material = this.mat("#73dfc2", true);
    this.selectRing.position.y = 0.19;
    this.selectRing.setEnabled(false);
    this.scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERDOWN) {
        this.tour = false;
        this.following = "";
        this.targetCamera = null;
        const picked = info.pickInfo?.pickedMesh;
        let n: any = picked;
        while (n && !n.metadata?.entity) n = n.parent;
        if (n?.metadata?.entity) this.select(n.metadata.entity);
      }
    });
    canvas.addEventListener("wheel", this.stopAuto, { passive: true });
    window.addEventListener("resize", this.resize);
    this.engine.runRenderLoop(() => {
      this.animate();
      this.shell.setEnabled(this.camera.radius > 65);
      this.assemblyFrame.setEnabled(this.camera.radius > 12);
      for (const bay of this.facade.getChildren())
        bay.setEnabled(this.camera.radius > 65 || (bay as TransformNode).position.z * this.camera.position.z < 0);
      this.scene.render();
      if (performance.now() - this.lastStats > 1000) {
        this.fps = this.engine.getFps();
        this.onStats?.(this.fps, this.scene.meshes.length);
        this.lastStats = performance.now();
      }
    });
  }
  private stopAuto = () => {
    this.tour = false;
    this.following = "";
    this.targetCamera = null;
  };
  private resize = () => this.engine.resize();
  private mat(hex: string, emissive = false) {
    const key = hex + emissive;
    if (this.materials.has(key)) return this.materials.get(key)!;
    const m = new PBRMaterial(key, this.scene);
    m.albedoColor = c(hex);
    m.metallic = hex === C.gold || hex === C.goldLight ? 0.3 : 0;
    m.roughness = hex === C.rubber ? 0.9 : hex === C.glass ? 0.16 : 0.38;
    m.environmentIntensity = 1.1;
    if (hex === C.gold || hex === C.goldLight) {
      m.metallic = 0.5;
      m.roughness = 0.25;
    }
    if (hex !== C.rubber) {
      m.clearCoat.isEnabled = true;
      m.clearCoat.intensity = 0.3;
      m.clearCoat.roughness = 0.2;
    }
    if (hex === C.steel) {
      m.metallic = 0.8;
      m.roughness = 0.28;
    }
    if (hex === C.floor || hex === C.road) {
      m.roughness = 0.88;
      m.clearCoat.isEnabled = false;
    }
    if (hex === C.glass) {
      m.metallic = 0.02;
      m.alpha = 0.38;
      m.backFaceCulling = false;
      m.separateCullingPass = true;
    }
    if (emissive) {
      m.emissiveColor = c(hex);
      m.emissiveIntensity = 1.4;
    }
    this.materials.set(key, m);
    return m;
  }
  private rounded(name: string, w: number, h: number, d: number) {
    const r = Math.min(0.065, w / 8, h / 8, d / 8);
    const positions: number[] = [],
      normals: number[] = [],
      indices: number[] = [];
    const ext = [w / 2, h / 2, d / 2];
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [-1, 1]) {
        const a = (axis + 1) % 3,
          b = (axis + 2) % 3,
          base = positions.length / 3;
        const sa = [-ext[a], -ext[a] + r, ext[a] - r, ext[a]],
          sb = [-ext[b], -ext[b] + r, ext[b] - r, ext[b]];
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 4; j++) {
            const p = [0, 0, 0];
            p[axis] = sign * ext[axis];
            p[a] = sa[i];
            p[b] = sb[j];
            const q = p.map((v, k) =>
              Math.max(-ext[k] + r, Math.min(ext[k] - r, v)),
            );
            const n = p.map((v, k) => v - q[k]);
            const len = Math.hypot(...n) || 1;
            positions.push(...q.map((v, k) => v + (n[k] / len) * r));
            normals.push(...n.map((v) => v / len));
          }
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const n = base + i * 4 + j;
            if (sign > 0) indices.push(n, n + 4, n + 1, n + 1, n + 4, n + 5);
            else indices.push(n, n + 1, n + 4, n + 1, n + 5, n + 4);
          }
      }
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.indices = indices.reduce<number[]>((out, _, i) => {
      if (i % 3 === 0) out.push(indices[i], indices[i + 2], indices[i + 1]);
      return out;
    }, []);
    data.applyToMesh(mesh);
    return mesh;
  }
  private shape(
    kind: string,
    size: V,
    hex: string,
    pos: V,
    parent?: TransformNode,
    rotation?: V,
    emissive = false,
  ) {
    parent = parent || this.buildParent;
    const key = `${kind}:${size.join(",")}:${hex}:${emissive}`;
    let tpl = this.templates.get(key);
    if (!tpl) {
      tpl =
        kind === "cyl"
          ? MeshBuilder.CreateCylinder(
              key,
              { diameter: size[0], height: size[1], tessellation: 16 },
              this.scene,
            )
          : this.rounded(key, ...size);
      tpl.material = this.mat(hex, emissive);
      tpl.isVisible = false;
      tpl.isPickable = false;
      this.templates.set(key, tpl);
    }
    if (parent) {
      const m = tpl.createInstance(kind);
      m.isVisible = true;
      m.isPickable = true;
      m.parent = parent;
      m.position.set(...pos);
      if (rotation) m.rotation.set(...rotation);
      this.shadow.addShadowCaster(m as any);
      return m;
    }
    let batch = this.staticBatches.get(key);
    if (!batch) {
      const mesh = tpl.clone("static:" + key)!;
      mesh.isVisible = true;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      batch = { mesh, matrices: [] };
      this.staticBatches.set(key, batch);
      this.shadow.addShadowCaster(mesh);
    }
    const q = rotation
      ? Quaternion.FromEulerAngles(...rotation)
      : Quaternion.Identity();
    const matrix = Matrix.Compose(Vector3.One(), q, new Vector3(...pos));
    batch.matrices.push(...matrix.asArray());
    return batch.mesh;
  }
  private box(
    pos: V,
    size: V,
    hex: string,
    parent?: TransformNode,
    rot?: V,
    glow = false,
  ) {
    return this.shape("box", size, hex, pos, parent, rot, glow);
  }
  private cyl(
    pos: V,
    diam: number,
    height: number,
    hex: string,
    parent?: TransformNode,
    rot?: V,
  ) {
    return this.shape("cyl", [diam, height, diam], hex, pos, parent, rot);
  }
  private brick(
    pos: V,
    size: V,
    hex: string,
    parent?: TransformNode,
    studs = true,
  ) {
    this.box(pos, size, hex, parent);
    if (studs) {
      const step = 0.4;
      const nx = Math.max(1, Math.floor(size[0] / step)),
        nz = Math.max(1, Math.floor(size[2] / step));
      for (let x = 0; x < nx; x++)
        for (let z = 0; z < nz; z++)
          this.cyl(
            [
              pos[0] + (x - (nx - 1) / 2) * step,
              pos[1] + size[1] / 2 + 0.045,
              pos[2] + (z - (nz - 1) / 2) * step,
            ],
            0.24,
            0.09,
            hex,
            parent,
          );
    }
  }
  private flushStatic() {
    for (const { mesh, matrices } of this.staticBatches.values()) {
      mesh.thinInstanceSetBuffer(
        "matrix",
        new Float32Array(matrices),
        16,
        true,
      );
      mesh.freezeWorldMatrix();
      mesh.thinInstanceRefreshBoundingInfo();
    }
  }
  private label(
    text: string,
    pos: V,
    w = 4,
    h = 0.8,
    color = "#e8eee9",
    ground = false,
  ) {
    const tex = new DynamicTexture(
      "label:" + text,
      { width: 1024, height: 256 },
      this.scene,
      false,
    );
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.font = "700 94px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 155);
    tex.update();
    const m = new StandardMaterial("text:" + text, this.scene);
    m.diffuseTexture = tex;
    m.opacityTexture = tex;
    m.emissiveColor = Color3.White();
    m.disableLighting = true;
    m.backFaceCulling = false;
    const p = MeshBuilder.CreatePlane(
      text,
      { width: w, height: h },
      this.scene,
    );
    p.parent = this.buildParent || null;
    p.position.set(...pos);
    if (ground) p.rotation.x = Math.PI / 2;
    p.material = m;
    p.isPickable = false;
    return p;
  }
  private conveyor(x: number, z: number, len: number, hex = C.teal) {
    this.box([x, 0.82, z], [len, 0.35, 1.5], C.navy);
    this.box([x, 1.05, z], [len, 0.09, 1.26], C.rubber);
    for (let i = -len / 2 + 0.2; i < len / 2; i += 0.38)
      this.cyl([x + i, 1.12, z], 0.14, 1.26, C.steel, undefined, [
        Math.PI / 2,
        0,
        0,
      ]);
    for (const dz of [-0.82, 0.82])
      this.box([x, 1.08, z + dz], [len, 0.16, 0.1], hex);
    for (const dx of [-len / 2 + 0.5, len / 2 - 0.5])
      for (const dz of [-0.55, 0.55]) {
        this.brick([x + dx, 0.42, z + dz], [0.4, 0.7, 0.4], C.navy);
        this.box([x + dx, 0.09, z + dz], [0.65, 0.13, 0.65], C.steel);
      }
    for (const side of [-1, 1]) {
      this.box([x, 0.72, z + side * 0.84], [len, 0.09, 0.12], C.steel);
      for (let t = -len / 2 + 0.6; t < len / 2; t += 2.4) {
        this.box([x + t, 0.88, z + side * 0.9], [0.35, 0.14, 0.035], C.cream);
        this.box([x + t, 0.88, z + side * 0.93], [0.12, 0.08, 0.025], C.rubber);
      }
    }
    this.box([x - len / 2 + 0.55, 0.66, z + 1.02], [0.55, 0.42, 0.42], C.steel);
    for (let k = 0; k < 5; k++)
      this.box([x - len / 2 + 0.34 + k * 0.1, 0.7, z + 1.26], [0.045, 0.27, 0.04], C.navy);
  }
  private buildSite() {
    this.box([0, -0.65, 0], [91, 1.2, 55], C.navy);
    this.box([0, -0.01, 0], [90, 0.15, 54], C.floor);
    this.box([-2, 0.12, 0], [43, 0.15, 35], C.cream);
    this.label(
      "BRICKWORKS   /   AUTONOMOUS SYSTEMS",
      [-3, 0.24, -16.1],
      19,
      1.1,
      "#506866",
      true,
    );
    // Site roads and markings.
    this.box([-36, 0.11, 0], [7, 0.08, 52], C.road);
    this.box([31, 0.11, 0], [8, 0.08, 52], C.road);
    this.box([24, 0.11, 17.5], [19, 0.08, 5], C.road);
    this.box([24, 0.11, -19], [19, 0.08, 5], C.road);
    for (let z = -24; z < 26; z += 3) {
      this.box([-36, 0.17, z], [0.12, 0.02, 1.4], C.white);
      this.box([31, 0.17, z], [0.12, 0.02, 1.4], C.white);
    }
    for (let x = 17; x < 35; x += 3)
      this.box([x, 0.17, 17.5], [1.3, 0.02, 0.12], C.white);
    for (const x of [-40.3])
      this.box([x, 0.15, 0], [0.25, 0.3, 51], C.white);
    for (const z of [-17.5, 17.5])
      this.box([-31.8, 0.15, z], [0.25, 0.3, 16], C.white);
    this.box([-32, 0.13, 0], [7, 0.08, 17], C.road);
    this.box([26.5, 0.15, 0], [0.25, 0.3, 29], C.white);
    for (const z of [-24, 24]) this.box([26.5, 0.15, z], [0.25, 0.3, 3], C.white);
    // Parking bays arranged in two rows off perimeter road.
    this.box([40, 0.11, 0], [8, 0.08, 36], C.road);
    for (let i = 0; i <= 12; i++)
      this.box([40, 0.18, -16.8 + i * 2.8], [6, 0.02, 0.075], C.white);
    for (let i = 0; i < 12; i++) {
      const p = this.parkingPosition(i);
      this.label(
        String(i + 1).padStart(2, "0"),
        [43, 0.2, p[2]],
        0.8,
        0.35,
        "#b7c9c6",
        true,
      );
    }
    this.label(
      "FINISHED VEHICLES",
      [39.5, 0.2, -17.6],
      7,
      0.6,
      "#d4e0d7",
      true,
    );
    // Loading docks and warehouse.
    this.box([-28, 0.15, 0], [6, 0.15, 34], C.steel);
    for (let i = 0; i < 3; i++) {
      const z = -10 + i * 10;
      this.box([-29, 0.2, z], [4, 0.2, 6], C.navy);
      for (let n = 0; n < 8; n++)
        this.box(
          [-30.8 + n * 0.45, 0.32, z - 2.9],
          [0.2, 0.04, 0.6],
          C.yellow,
          undefined,
          [0, -0.5, 0],
        );
      this.label(
        "DOCK 0" + (i + 1),
        [-28, 0.35, z + 2.5],
        3,
        0.5,
        "#dfe9d8",
        true,
      );
    }
    this.label("01  RECEIVING", [-27, 3.8, -16.8], 7, 1, "#263e49");
    // Receiving sortation spine: one inspected lot splits into five color-coded kit streams.
    const sorter = new TransformNode("receiving-sorter", this.scene);
    sorter.position.set(-26.2, 0, 0);
    sorter.rotation.y = Math.PI / 2;
    sorter.metadata = { entity: "receiving" };
    this.buildParent = sorter;
    this.conveyor(0, 0, 26, C.teal);
    this.buildParent = undefined;
    this.label("INSPECT  /  SORT  /  STORE", [-26.2, 3.8, 15], 7, 0.65, "#263e49");
    for (const line of LINE_IDS) {
      const z = LINE_META[line].z;
      this.conveyor(-25.1, z, 2.2, LINE_META[line].color);
      this.label(LINE_META[line].name.toUpperCase(), [-26.2, 1.9, z + 1.5], 2.8, 0.38, LINE_META[line].color);
    }

    for (const line of LINE_IDS) {
      const z = LINE_META[line].z;
      for (const x of [-24, -21]) {
        for (const dx of [-1, 1])
          for (const dz of [-1, 1])
            this.brick([x + dx, 2.1, z + dz], [0.3, 4, 0.3], C.navy);
        for (let y = 0.65; y < 4; y += 1.2) {
          this.box([x, y, z], [2.4, 0.12, 2.6], C.orange);
          for (let col = 0; col < 3; col++)
            for (const dz of [-0.5, 0.5]) {
              const tote = new TransformNode("stock:" + line, this.scene);
              tote.position.set(x - 0.7 + col * 0.7, y + 0.3, z + dz);
              tote.metadata = { entity: line };
              this.brick(
                [0, 0, 0],
                [0.6, 0.45, 0.8],
                LINE_META[line].color,
                tote,
              );
              const slots = this.stockVisuals.get(line) || [];
              slots.push(tote);
              this.stockVisuals.set(line, slots);
            }
        }
      }
    }
    // Cutaway shell: rear wall + pillars + roof beams.
    for (let x = -18; x <= 18; x += 6) {
      this.brick([x, 3.1, -17.5], [0.8, 6, 0.8], C.navy, this.shell);
      this.brick([x, 3.1, 17.5], [0.8, 6, 0.8], C.navy, this.shell);
      this.box([x, 6.2, 0], [0.4, 0.45, 35], C.navy, this.shell);
      for (let z = -14; z <= 14; z += 7) {
        const light = this.box(
          [x, 5.94, z],
          [0.18, 0.09, 3.5],
          C.white,
          this.shell,
          undefined,
          true,
        );
        this.beams.push(light as Mesh);
      }
    }
    for (const z of [-17.5, 17.5])
      this.box([0, 6.2, z], [38, 0.5, 0.7], C.navy, this.shell);
    for (let x = -18; x < 18; x += 1.2) {
      this.brick([x, 0.56, -17.5], [1.18, 0.8, 0.6], C.cream, this.shell);
      this.brick([x, 1.37, -17.5], [1.18, 0.8, 0.6], C.cream);
    }
    this.box([0, 6.65, 0], [38, 0.2, 35], C.cream, this.roof);
    this.roof.setEnabled(false);
    this.label("02  PARALLEL PRODUCTION", [-5, 6.7, -17.5], 15, 1.2, "#284a56");
    for (const line of LINE_IDS) {
      const group = new TransformNode("station-layout:" + line, this.scene);
      this.lineGroups.set(line, group);
      this.buildParent = group;
      const m = LINE_META[line],
        z = m.z;
      const pad = MeshBuilder.CreateGround(
        "station:" + line,
        { width: 18, height: 4.9 },
        this.scene,
      );
      pad.parent = group;
      pad.position.set(-7, 0.23, z);
      const mat = new PBRMaterial("pad:" + line, this.scene);
      mat.albedoColor = c(m.color).scale(0.64).add(c(C.cream).scale(0.36));
      mat.roughness = 0.8;
      pad.material = mat;
      pad.receiveShadows = true;
      pad.metadata = { entity: line };
      this.stationPads.set(line, pad);
      this.conveyor(-7, z, 17, m.color);
      this.label(
        String(LINE_IDS.indexOf(line) + 1).padStart(2, "0") +
          "  " +
          m.name.toUpperCase(),
        [-7, 0.27, z + 2],
        13,
        0.65,
        "#324950",
        true,
      );
      for (const [x, side] of [
        [-12, -1],
        [-5, 1],
      ] as [number, number][]) {
        this.robot(x, z + side * 1.85, line, side);
        this.box([x, 1, z + side * 3.0], [2.5, 0.8, 0.75], C.navy);
        for (let k = 0; k < 5; k++)
          this.brick(
            [x - 0.8 + k * 0.4, 1.6, z + side * 3.0],
            [0.38, 0.48, 0.55],
            m.color,
          );
      }
      // Inspection portal and control terminal.
      for (const dz of [-1, 1])
        this.brick([0.8, 2, z + dz], [0.35, 3.4, 0.35], C.navy);
      this.brick([0.8, 3.6, z], [0.5, 0.35, 2.4], m.color);
      this.box(
        [0.8, 3.37, z],
        [0.24, 0.12, 0.6],
        C.teal,
        undefined,
        undefined,
        true,
      );
      this.brick([-15, 1.1, z + 2.1], [0.6, 1.5, 0.6], C.navy);
      this.box(
        [-15, 2, z + 2.1],
        [1, 0.6, 0.15],
        C.glass,
        undefined,
        [0.25, 0, 0],
      );
    }
    this.buildParent = undefined;
    // Module handoff spurs and marked logistics lanes.
    for (const line of LINE_IDS) {
      const z = LINE_META[line].z;
      this.box([4.5, 1, z], [7.2, 0.25, 2.8], C.navy);
      for (let k = 0; k < 4; k++) {
        this.box(
          [1.7 + k * 1.85, 1.15, z],
          [0.06, 0.02, 2.65],
          LINE_META[line].color,
        );
      }
      this.box([-18, 0.2, z], [2.5, 0.04, 4.7], C.road);
      for (let j = -2; j < 2; j++)
        this.box([-18, 0.24, z + j], [0.07, 0.02, 0.35], C.yellow);
    }
    // Rail-mounted receiving lift, with an articulated fork carriage.
    const crane = new TransformNode("receiving-crane", this.scene);
    crane.metadata = { entity: "receiving" };
    for (const z of [-3.5, 3.5]) {
      this.brick([-26, 2.5, z], [0.55, 5, 0.55], C.orange, crane);
      this.box([-27, 0.5, z], [3, 0.22, 0.5], C.navy, crane);
    }
    this.brick([-26, 5.15, 0], [0.7, 0.35, 7.6], C.orange, crane);
    this.box([-27, 4.9, 0], [3, 0.2, 0.4], C.navy, crane);
    this.cyl([-28, 3.1, 0], 0.09, 3.5, C.steel, crane);
    this.brick([-28, 1.3, 0], [0.5, 0.5, 2], C.orange, crane);
    for (const z of [-0.65, 0.65])
      this.box([-28.6, 1.03, z], [1.6, 0.12, 0.2], C.steel, crane);
    // Final assembly island, travel lanes.
    this.box([9, 0.2, 0], [12, 0.2, 33], C.steel);
    for (const z of [-15.5, 15.5])
      this.box([9, 0.33, z], [11, 0.02, 0.12], C.yellow);
    this.conveyor(10, 0, 10, C.orange);
    for (const x of [7, 13]) {
      this.robot(x, -3, "exterior", -1);
      this.robot(x, 3, "battery", 1);
    }
    for (const x of [6.2, 13.8]) {
      for (const z of [-1.2, 1.2]) {
        this.brick([x, 0.72, z], [0.65, 1.2, 0.65], C.cream);
        this.box([x, 1.37, z], [0.9, 0.15, 0.78], C.steel);
        this.cyl([x, 1.59, z], 0.17, 0.35, C.steel);
        this.box([x, 0.75, z - 0.34], [0.32, 0.34, 0.045], C.navy);
      }
    }
    for (const x of [5.5, 14.5]) {
      this.cyl([x, 1.4, -2], 0.1, 2.4, C.navy);
      this.cyl([x, 2.6, -2], 0.24, 0.3, C.yellow);
      this.box([x, 2.6, -2], [0.16, 0.22, 0.16], C.yellow, undefined, undefined, true);
      this.box([x, 0.37, -2], [0.5, 0.2, 0.5], C.steel);
    }
    for (const x of [5, 15])
      for (const z of [-4.5, 4.5])
        this.brick([x, 3.5, z], [0.65, 6.8, 0.65], C.navy, this.assemblyFrame);
    this.box([10, 7, -4.5], [11, 0.5, 0.6], C.navy, this.assemblyFrame);
    this.box([10, 7, 4.5], [11, 0.5, 0.6], C.navy, this.assemblyFrame);
    this.box([10, 7, 0], [0.6, 0.4, 9], C.orange, this.assemblyFrame);
    this.label("03  FINAL ASSEMBLY", [10, 0.35, 7], 9, 0.75, "#304852", true);
    this.label(
      "FIVE LINES. ONE VEHICLE.",
      [10, 0.35, 8.3],
      9,
      0.55,
      "#526c72",
      true,
    );
    this.conveyor(19, 0, 6, C.teal);
    for (const z of [-1.3, 1.3])
      this.brick([20, 2, z], [0.5, 3.6, 0.5], C.navy);
    this.brick([20, 3.95, 0], [0.6, 0.45, 3.1], C.teal);
    this.label("QUALITY GATE", [20, 4.7, 0], 4.5, 0.7, "#25414b");
    // Outbound path inside site.
    this.box([23, 0.17, 8.5], [4, 0.05, 18], C.road);
    for (let z = 2; z < 17; z += 2)
      this.box([23, 0.21, z], [0.1, 0.02, 0.8], C.white);
    this.label("04  DISPATCH", [22, 0.3, 15.4], 4, 0.6, "#edf4df", true);
    this.label("MATERIALS IN", [-36, 0.2, -21], 6, 0.7, "#e7efe8", true);
    // Maintenance bay.
    this.box([9, 0.26, 12], [8, 0.15, 5], C.dark);
    this.label("SERVICE & REWORK", [9, 0.4, 13.7], 7, 0.6, "#dfb85d", true);
    for (let i = 0; i < 3; i++) {
      this.brick([6 + i * 2, 1, 11], [1.5, 1.4, 1.3], C.orange);
      this.box([6 + i * 2, 1.8, 11], [1.6, 0.1, 1.4], C.steel);
    }
    // Fences, landscaping, street lamps.
    for (let z = -25; z <= 25; z += 4) {
      for (const x of [-44, 44]) {
        this.brick([x, 0.9, z], [0.4, 1.6, 0.4], C.navy);
        if (z < 25) this.box([x, 0.9, z + 2], [0.1, 0.65, 4], C.steel);
      }
    }
    for (let x = -42; x < 44; x += 5) {
      this.tree(x, 23);
      if (x < -18 || x > 20) this.tree(x, -24);
    }
    for (let z = -16; z <= 16; z += 8) {
      this.tree(-42, z);
      this.lamp(25, z);
      this.lamp(-31, z);
    }
    this.label("BRICKWORKS", [0, 1.8, 24], 15, 2, "#23414e");
    this.label(
      "THE AUTONOMOUS FACTORY",
      [0, 0.4, 25],
      14,
      0.8,
      "#466663",
      true,
    );
  }
  private tree(x: number, z: number) {
    this.box([x, 0.3, z], [2, 0.45, 2], C.cream);
    this.cyl([x, 1.1, z], 0.3, 1.8, "#705d49");
    for (let level = 0; level < 3; level++) {
      const spread = 0.75 - level * 0.18;
      for (let k = 0; k < 5; k++) {
        const angle = k * Math.PI * 0.4 + level * 0.5;
        const px = x + Math.cos(angle) * spread;
        const pz = z + Math.sin(angle) * spread;
        const y = 2.1 + level * 0.65;
        this.cyl([px, y, pz], 1.2 - level * 0.15, 0.5, k % 2 ? "#5a7750" : "#7a9158");
        this.cyl([px, y + 0.28, pz], 0.65, 0.13, "#8c9d66");
      }
    }
  }

  private lamp(x: number, z: number) {
    this.cyl([x, 2.2, z], 0.16, 4.3, C.navy);
    this.box([x, 4.4, z], [1.1, 0.15, 0.5], C.navy);
    this.box(
      [x, 4.3, z],
      [0.9, 0.08, 0.4],
      C.white,
      undefined,
      undefined,
      true,
    );
  }
  private robot(x: number, z: number, line: LineId, side: number) {
    const root = new TransformNode("robot:" + line, this.scene);
    root.parent = this.buildParent || null;
    root.position.set(x, 0.24, z);
    root.metadata = { entity: line };
    const color = line === "exterior" ? "#e78124" : LINE_META[line].color;
    this.brick([0, 0.4, 0], [1.5, 0.7, 1.5], C.navy, root);
    this.cyl([0, 0.85, 0], 1, 0.3, color, root);
    const upper = new TransformNode("shoulder", this.scene);
    upper.parent = root;
    upper.position.y = 1.05;
    this.cyl([0, 0, 0], 0.65, 0.8, C.navy, upper, [Math.PI / 2, 0, 0]);
    this.brick([0, 0.85, 0], [0.55, 1.7, 0.65], color, upper);
    this.box([0.31, 0.85, 0], [0.08, 1.3, 0.5], C.cream, upper);
    const lower = new TransformNode("elbow", this.scene);
    lower.parent = upper;
    lower.position.y = 1.7;
    this.cyl([0, 0, 0], 0.65, 0.8, C.navy, lower, [Math.PI / 2, 0, 0]);
    this.brick([0, 0.75, 0], [0.48, 1.5, 0.55], color, lower);
    const wrist = new TransformNode("wrist", this.scene);
    wrist.parent = lower;
    wrist.position.y = 1.5;
    this.cyl([0, 0, 0], 0.5, 0.5, C.navy, wrist);
    for (const dx of [-0.28, 0.28]) {
      this.box([dx, -0.28, 0], [0.12, 0.55, 0.2], C.steel, wrist);
      this.box([dx * 0.65, -0.53, 0], [0.3, 0.1, 0.2], C.rubber, wrist);
    }
    // Joint covers, fasteners and cable guides move with the existing rig.
    for (const joint of [upper, lower]) {
      for (const sideZ of [-0.46, 0.46]) {
        this.cyl([0, 0, sideZ], 0.76, 0.12, C.rubber, joint, [Math.PI / 2, 0, 0]);
        this.cyl([0, 0, sideZ * 1.13], 0.48, 0.045, C.steel, joint, [Math.PI / 2, 0, 0]);
        for (let k = 0; k < 6; k++) {
          const a = k * Math.PI / 3;
          this.cyl([Math.cos(a) * 0.27, Math.sin(a) * 0.27, sideZ * 1.16], 0.07, 0.04, C.dark, joint, [Math.PI / 2, 0, 0]);
        }
      }
      for (let k = 0; k < 8; k++)
        this.box([-0.34, 0.22 + k * 0.15, 0.18], [0.14, 0.11, 0.18], C.rubber, joint);
      this.box([0.29, 0.7, 0.26], [0.04, 0.75, 0.16], C.dark, joint);
      this.box([0, 0.7, -0.35], [0.3, 0.38, 0.035], C.cream, joint);
    }
    this.cyl([0, 0.1, 0], 0.65, 0.16, color, wrist);
    this.box([0, -0.24, 0.18], [0.22, 0.3, 0.2], C.navy, wrist);
    this.box([0, -0.26, 0.29], [0.12, 0.1, 0.025], C.teal, wrist, undefined, true);
    for (const dx of [-0.55, 0.55])
      for (const dz of [-0.55, 0.55])
        this.cyl([dx, 0.79, dz], 0.13, 0.09, C.steel, root);
    const part = new TransformNode("gripped-brick", this.scene);
    part.parent = wrist;
    this.brick([0, -0.68, 0], [0.65, 0.3, 0.45], color, part);
    this.robots.push({ root, upper, lower, wrist, part, line, side });
  }
  private compactAssembly(group: TransformNode, key: string) {
    const children = group
      .getChildren()
      .filter((n: any) => typeof n.getVerticesData === "function") as Mesh[];
    let prefabs = this.carPrefabs.get(key);
    if (!prefabs) {
      prefabs = [];
      const byMaterial = new Map<any, Mesh[]>();
      for (const child of children) {
        const list = byMaterial.get(child.material) || [];
        list.push(child);
        byMaterial.set(child.material, list);
      }
      group.computeWorldMatrix(true);
      const inverse = Matrix.Invert(group.getWorldMatrix());
      for (const [material, meshes] of byMaterial) {
        const positions: number[] = [],
          normals: number[] = [],
          indices: number[] = [];
        for (const m of meshes) {
          const matrix = m.computeWorldMatrix(true).multiply(inverse);
          const p = m.getVerticesData("position")!,
            n = m.getVerticesData("normal")!,
            ind = m.getIndices()!;
          const base = positions.length / 3;
          for (let j = 0; j < p.length; j += 3) {
            const v = Vector3.TransformCoordinates(
                new Vector3(p[j], p[j + 1], p[j + 2]),
                matrix,
              ),
              normal = Vector3.TransformNormal(
                new Vector3(n[j], n[j + 1], n[j + 2]),
                matrix,
              ).normalize();
            positions.push(v.x, v.y, v.z);
            normals.push(normal.x, normal.y, normal.z);
          }
          for (const index of ind) indices.push(base + index);
        }
        const mesh = new Mesh("prefab:" + key, this.scene);
        const data = new VertexData();
        data.positions = positions;
        data.normals = normals;
        data.indices = indices;
        data.applyToMesh(mesh);
        mesh.material = material;
        mesh.isVisible = false;
        mesh.isPickable = false;
        prefabs.push(mesh);
      }
      this.carPrefabs.set(key, prefabs);
    }
    children.forEach((m) => m.dispose());
    for (const prefab of prefabs) {
      const instance = prefab.createInstance(key);
      instance.parent = group;
      instance.isVisible = true;
      this.shadow.addShadowCaster(instance as any);
    }
  }
  /**
   * The same authored component dimensions/color/orientation are used at a
   * station and after joining into a vehicle. `stages` only adds reveal groups.
   */
  private authoredModule(
    parent: TransformNode,
    line: LineId,
    stages?: TransformNode[],
  ) {
    buildRobotaxiModule({
      scene: this.scene,
      box: this.box.bind(this),
      brick: this.brick.bind(this),
      cyl: this.cyl.bind(this),
      material: this.mat.bind(this),
    }, parent, line, stages);
  }

  private car(id: string, scale = 1) {
    const root = new TransformNode(id, this.scene);
    root.scaling.setAll(scale);
    root.metadata = { entity: id };
    const modules: TransformNode[] = [];
    for (const line of LINE_IDS) {
      const n = new TransformNode(line, this.scene);
      n.parent = root;
      modules.push(n);
    }
    modules.forEach((module, index) =>
      this.authoredModule(module, LINE_IDS[index]),
    );
    const carriers: TransformNode[] = modules.map((_, i) => {
      const carrier = new TransformNode("module-carrier:" + i, this.scene);
      carrier.parent = root;
      this.box([0, -0.45, 0], [2.3, 0.18, 1.6], C.navy, carrier);
      for (const x of [-0.8, 0.8])
        for (const z of [-0.7, 0.7])
          this.cyl([x, -0.78, z], 0.55, 0.15, C.rubber, carrier, [
            Math.PI / 2,
            0,
            0,
          ]);
      this.box(
        [0, -0.42, -0.84],
        [1.5, 0.06, 0.06],
        LINE_META[LINE_IDS[i]].color,
        carrier,
        undefined,
        true,
      );
      carrier.setEnabled(false);
      return carrier;
    });
    modules.forEach((module, i) => {
      for (const child of module.getChildren())
        if (child.name === "door")
          this.compactAssembly(
            child as TransformNode,
            "door:" +
              ((child as TransformNode).position.z > 0 ? "right" : "left"),
          );
      this.compactAssembly(module, "module:" + LINE_IDS[i]);
    });
    carriers.forEach((carrier, i) =>
      this.compactAssembly(carrier, "carrier:" + i),
    );
    root.metadata = { entity: id, modules, carriers };
    return root;
  }
  private module(id: string, line: LineId) {
    const root = new TransformNode(id, this.scene);
    root.metadata = { entity: line };
    const stages: TransformNode[] = [];
    this.authoredModule(root, line, stages);
    root.metadata.stages = stages;
    stages.forEach((group, index) => {
      const bounds = group.getHierarchyBoundingVectors(true);
      const center = bounds.min.add(bounds.max).scale(0.5);
      group.metadata = {gripCenter: [center.x,center.y,center.z] as V};
      group.setEnabled(index === 0);
    });
    return root;
  }
  private truck(id: string) {
    const r = new TransformNode(id, this.scene);
    r.metadata = { entity: id };
    this.brick([0, 0.7, 0], [2.6, 0.4, 7], C.navy, r);
    this.brick([0, 1.65, -2.6], [2.7, 1.7, 2], C.teal, r);
    this.box([0, 2, -3.65], [2.4, 0.7, 0.07], C.glass, r);
    this.box([0, 1, -3.66], [2.3, 0.12, 0.07], C.white, r, undefined, true);
    for (const z of [-2.5, 1.8, 2.7])
      for (const x of [-1.4, 1.4])
        this.cyl([x, 0.65, z], 1.1, 0.35, C.rubber, r, [0, 0, Math.PI / 2]);
    const cargo = new TransformNode("cargo", this.scene);
    cargo.parent = r;
    const pallets: TransformNode[] = [];
    for (const [i, line] of LINE_IDS.entries()) {
      const pallet = new TransformNode("delivery-kit:" + line, this.scene);
      pallet.parent = cargo;
      pallet.position.set(0, 1.1, -1.05 + i * 0.78);
      this.box([0, 0, 0], [2.15, 0.15, 0.7], C.orange, pallet);
      for (let n = 0; n < 3; n++) {
        this.brick([-0.68 + n * 0.68, 0.32, 0], [0.6, 0.5, 0.58], LINE_META[line].color, pallet);
        if (n !== 1) this.brick([-0.68 + n * 0.68, 0.68, 0], [0.58, 0.2, 0.56], LINE_META[line].color, pallet);
      }
      pallets.push(pallet);
    }
    r.metadata.pallets = pallets;
    r.metadata.cargo = cargo;
    return r;
  }
  private cart(id: string, line: LineId) {
    const r = new TransformNode(id, this.scene);
    r.metadata = { entity: id };
    this.brick([0, 0.4, 0], [1.8, 0.55, 2], C.navy, r);
    this.box([0, 0.74, 0], [1.9, 0.12, 2.1], C.teal, r);
    for (const x of [-0.9, 0.9])
      for (const z of [-0.65, 0.65])
        this.cyl([x, 0.25, z], 0.4, 0.2, C.rubber, r, [0, 0, Math.PI / 2]);
    const cargo = new TransformNode("cargo", this.scene);
    cargo.parent = r;
    this.brick([0, 1.05, 0], [1.4, 0.5, 1.6], LINE_META[line].color, cargo);
    r.metadata.cargo = cargo;
    this.box([0, 0.6, -1.04], [1.4, 0.06, 0.04], C.teal, r, undefined, true);
    return r;
  }
  parkingPosition(slot: number): V {
    return [40, 0.22, -15.4 + slot * 2.8];
  }
  /** Explicit art-review fixture, not a production vehicle or inventory item. */
  addArtReviewVehicle() {
    const vehicle = this.car("art-review-vehicle");
    vehicle.position.set(10, 1.24, 0);
    vehicle.rotation.y = Math.PI;
    for (const robot of this.robots) {
      const p = robot.root.position;
      this.poseProductionRobot(robot, [p.x + (p.x > 10 ? -0.65 : 0.65), 2.2, p.z - robot.side * 1.65]);
    }
    this.camera.setTarget(new Vector3(10, 2.2, 0));
    this.camera.radius = 8.5;
    this.camera.alpha = 0.32;
    this.camera.beta = 1.18;
    this.artCamera("vehicle");
    return vehicle;
  }
  artCamera(shot: string) {
    const shots: Record<string, [V, number, number, number]> = {
      vehicle: [[10, 2.15, 0], 7.5, 0.6, 1.25],
      cell: [[10, 2.2, 0], 16, -2.05, 1.1],
      site: [[0, 0.8, 0], 88, -1.28, 0.67],
      machinery: [[7, 2, -3], 7.5, -2.2, 1.2],
    };
    // Vehicle detail isolates the product by hiding only the two foreground
    // robots in this explicitly synthetic review fixture; cell view restores them.
    for (const robot of this.robots)
      robot.root.setEnabled(shot !== "vehicle" || robot.root.position.x < 10);
    const [target, radius, alpha, beta] = shots[shot] || shots.vehicle;
    this.camera.setTarget(new Vector3(...target));
    this.camera.radius = radius;
    this.camera.alpha = alpha;
    this.camera.beta = beta;
  }
  addStressFleet() {
    const fleet: TransformNode[] = [];
    for (let i = 0; i < 32; i++) {
      const car = this.car("render-benchmark-" + i, i < 20 ? 0.65 : 1);
      if (i < 20)
        car.position.set(
          -12 + (i % 4) * 4,
          1.3,
          LINE_META[LINE_IDS[Math.floor(i / 4)]].z,
        );
      else car.position.set(...this.parkingPosition(i - 20));
      fleet.push(car);
    }
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      fleet.slice(0, 20).forEach((car, i) => {
        car.position.x = -12 + (i % 4) * 4 + Math.sin(t * 0.4 + i) * 0.5;
      });
    });
    return () => {
      this.scene.onBeforeRenderObservable.remove(observer);
      fleet.forEach((car) => car.dispose());
    };
  }
  setSnapshot(snapshot: FactorySnapshot) {
    this.snapshot = snapshot;
    this.lastSnapshotAt = performance.now();
  }
  select(id: string) {
    this.selected = id;
    this.onSelect(id);
    const pos = this.entityPosition(id);
    if (pos) {
      this.selectRing.position.set(pos[0], 0.27, pos[2]);
      this.selectRing.setEnabled(true);
    }
  }
  entityPosition(id: string): V | null {
    if (LINE_IDS.includes(id as LineId))
      return [-7, 0.5, LINE_META[id as LineId].z];
    const r = this.roots.get(id);
    if (r) return [r.position.x, r.position.y, r.position.z];
    const owner = this.snapshot?.vehicles.find(vehicle => vehicle.modules.some(module => module.id === id));
    const ownerRoot = owner && this.roots.get(owner.id);
    if (ownerRoot) return [ownerRoot.position.x, ownerRoot.position.y, ownerRoot.position.z];
    return id === "assembly"
      ? [10, 1, 0]
      : id === "receiving"
        ? [-28, 1, 0]
        : id === "parking"
          ? [39, 1, 0]
          : null;
  }
  preset(name: string) {
    this.following = "";
    this.tour = false;
    const presets: Record<string, [V, number, number, number]> = {
      site: [[0, -2, 0], 95, -1.05, 0.88],
      factory: [[-2, 0, 0], 57, -1.0, 0.82],
      receiving: [[-25, 1, 0], 32, -2.2, 1],
      sorting: [[-25, 1, 0], 31, -2.2, 1],
      storage: [[-22, 1, 0], 24, -1.4, 1],
      assembly: [[10, 1, 0], 23, -1.2, 1.02],
      parking: [[36, 0, 0], 35, -1.5, 0.8],
      vehicle: [[10, 1, 0], 10, -1.1, 1.05],
    };
    const line = LINE_META[name as LineId];
    const p =
      presets[name] ||
      (line ? [[-7, 1, line.z], 20, -1.35, 0.95] : presets.site);
    this.targetCamera = {
      target: new Vector3(...(p[0] as V)),
      radius: p[1] as number,
      alpha: p[2] as number,
      beta: p[3] as number,
    };
  }
  follow(id: string) {
    this.following = id;
    this.tour = false;
    this.targetCamera = null;
    this.select(id);
  }
  setTour(value: boolean) {
    this.tour = value;
    this.tourStart = performance.now();
    this.following = "";
    if (value) this.preset("site");
    this.tour = value;
  }
  setExploded(value: boolean) {
    this.exploded = value;
    if (value) {
      this.preset("vehicle");
      const active = this.snapshot?.vehicles.find(v => v.id === this.selected) ?? this.snapshot?.vehicles[0];
      this.explodedId = active?.id ?? "";
      if (active) this.follow(active.id);
      else {
        let r = this.roots.get("preview");
        if (!r) {
          r = this.car("preview");
          r.position.set(10, 1.2, 0);
          this.roots.set("preview", r);
        }
      }
    } else {
      this.roots.get("preview")?.dispose();
      this.roots.delete("preview");
    }
  }
  setOverlay(name: string) {
    this.overlay = name;
  }
  setRoof(value: boolean) {
    this.roof.setEnabled(value);
  }
  setDusk(value: boolean) {
    this.dusk = value;
    this.scene.clearColor = value
      ? new Color4(0.08, 0.13, 0.19, 1)
      : new Color4(0.82, 0.82, 0.79, 1);
    this.sun.intensity = value ? 0.65 : 3.1;
    this.hemi.intensity = value ? 0.4 : 0.42;
    this.scene.environmentIntensity = value ? 0.45 : 0.8;
    this.pipeline.imageProcessing.exposure = value ? 1.3 : 1.08;
  }
  /** Convert a world handoff target to the moving truck's cargo space. */
  private localTo(root: TransformNode, point: V): V {
    root.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(
      new Vector3(...point),
      Matrix.Invert(root.getWorldMatrix()),
    );
    return [local.x, local.y, local.z];
  }
  private wristPoint(line: LineId, index: number): V {
    const robot = this.robots.filter((item) => item.line === line)[index];
    if (!robot) return [-10, 1.4, LINE_META[line].z];
    robot.wrist.computeWorldMatrix(true);
    const hand = robot.wrist.getAbsolutePosition();
    // The authored module's origin is its base, so it sits just below the fingers.
    return [hand.x, hand.y - 0.72, hand.z];
  }
  private gripCenter(stage: TransformNode): V {
    return (stage.metadata?.gripCenter as V | undefined) || [0, 0.75, 0];
  }
  private productionMotion(
    robot: (typeof this.robots)[number],
    root: TransformNode,
    progress: number,
  ) {
    const stages = root.metadata?.stages as TransformNode[] | undefined;
    if (!stages?.length) return null;
    const amount = pclip(progress) * stages.length;
    const index = Math.min(stages.length - 1, Math.floor(amount));
    const localCenter = this.gripCenter(stages[index]);
    const placed = Vector3.TransformCoordinates(new Vector3(...localCenter), root.computeWorldMatrix(true));
    const final: V = [placed.x,placed.y,placed.z];
    const station = this.snapshot!.stations[robot.line];
    const pickup: V = [-13.15 + station.offset, 1.32, LINE_META[robot.line].z];
    const base = robot.root.getAbsolutePosition();
    const home: V = [base.x, base.y + 2.25, base.z];
    const u = pclip(amount - index);
    const lift = (point: V): V => [point[0], point[1] + 0.62, point[2]];
    let gripper = home;
    let piece = pickup;
    let carried = u >= 0.12 && u < 0.84;
    if (u < 0.12) gripper = lerp(home, pickup, ease(u / 0.12));
    else if (u < 0.2) gripper = pickup;
    else if (u < 0.34) {
      gripper = lerp(pickup, lift(pickup), ease((u - 0.2) / 0.14));
      carried = true;
    } else if (u < 0.62) {
      gripper = lerp(lift(pickup), lift(final), ease((u - 0.34) / 0.28));
      carried = true;
    } else if (u < 0.74) {
      gripper = lerp(lift(final), final, ease((u - 0.62) / 0.12));
      carried = true;
    } else if (u < 0.84) {
      gripper = final;
      carried = true;
    } else if (u < 0.9) gripper = final;
    else gripper = lerp(final, home, ease((u - 0.9) / 0.1));
    if (u >= 0.12 && u < 0.84) piece = gripper;
    else if (u >= 0.84) piece = final;
    return { index, u, pickup, final, gripper, piece, carried };
  }
  private poseProductionRobot(
    robot: (typeof this.robots)[number],
    pieceCenter: V,
  ) {
    const base = robot.root.getAbsolutePosition();
    const shoulderY = base.y + 1.05;
    const target: V = [pieceCenter[0], pieceCenter[1] + 0.72, pieceCenter[2]];
    const dx = target[0] - base.x;
    const dz = target[2] - base.z;
    const horizontal = Math.max(0.12, Math.hypot(dx, dz));
    const vertical = target[1] - shoulderY;
    const l1 = 1.7, l2 = 1.5;
    const distance = Math.min(l1 + l2 - 0.03, Math.max(0.12, Math.hypot(horizontal, vertical)));
    const elbowCos = Math.max(
      -1,
      Math.min(1, (distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2)),
    );
    const elbow = Math.acos(elbowCos);
    const shoulder =
      Math.atan2(horizontal, vertical) -
      Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));
    robot.root.rotation.y = Math.atan2(dx, dz);
    robot.upper.rotation.x = shoulder;
    robot.lower.rotation.x = elbow;
    robot.wrist.rotation.x = -shoulder - elbow;
    robot.part.setEnabled(false);
  }
  private stageModule(
    root: TransformNode,
    line: LineId,
    status: string,
    progress: number,
    isCurrent: boolean,
  ) {
    const stages = root.metadata?.stages as TransformNode[] | undefined;
    if (!stages?.length) return;
    const building = isCurrent && status === "processing";
    const loading = isCurrent && status === "loading";
    const completed = !isCurrent || status === "unloading" || status === "idle";
    const held = isCurrent && ["faulted", "maintenance", "blocked", "starved", "paused"].includes(status);
    const amount = completed
      ? stages.length
      : building
        ? pclip(progress) * stages.length
        : held
          ? pclip(progress) * stages.length
        : loading
          ? 0
          : 1;
    const active = Math.min(stages.length - 1, Math.floor(amount));
    const productionRobot = this.robots.find(
      (robot) => robot.line === line && robot.root.position.x < -7,
    );
    const motion =
      building && productionRobot
        ? this.productionMotion(productionRobot, root, progress)
        : null;
    stages.forEach((group, index) => {
      const phase = pclip(amount - index);
      group.setEnabled(!loading && (phase > 0 || (building && index === active)));
      group.position.setAll(0);
      // The active authored part stays at pickup, tracks the gripper through
      // lift/transfer/lower, then remains at its true final local placement.
      if (motion && index === motion.index) {
        const target = this.localTo(
          root,
          motion.carried ? this.wristPoint(line, 0) : motion.piece,
        );
        const center = this.gripCenter(group);
        group.position.set(
          target[0] - center[0],
          target[1] - center[1],
          target[2] - center[2],
        );
      }
    });
  }
  private steerYaw(root: TransformNode, target: number) {
    root.rotation.y += angleStep(root.rotation.y, target) * 0.18;
  }
  private travel(points: V[], t: number) {
    const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - points[i][0], p[2] - points[i][2]));
    let rem = pclip(t) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (rem <= lengths[i] || i === lengths.length - 1) {
        return {
          pos: lerp(points[i], points[i + 1], pclip(rem / lengths[i])),
          yaw: Math.atan2(
            points[i + 1][2] - points[i][2],
            points[i + 1][0] - points[i][0],
          ),
        };
      }
      rem -= lengths[i];
    }
    return { pos: points[0], yaw: 0 };
  }
  private animate() {
    const s = this.snapshot;
    if (!s) return;
    const t =
      s.time +
      (s.running
        ? Math.min(0.25, (performance.now() - this.lastSnapshotAt) / 1000) *
          s.speed
        : 0);
    const alive = new Set<string>(["preview"]);
    for (const robot of this.robots) {
      const st = s.stations[robot.line];
      const effectiveStatus = st.pause?.previousStatus ?? st.status;
      const running =
        (robot.root.position.x > 0
          ? s.vehicles.some((v) => v.phase === "joining") && !s.faults.assembly
          : ["processing", "loading", "unloading"].includes(effectiveStatus));
      if (!running) {
        robot.part.setEnabled(false);
        robot.upper.rotation.x = 0.15;
        robot.lower.rotation.x = 1.9;
        robot.wrist.rotation.x = -2.05;
        continue;
      }
      const activeModule = st.current && this.roots.get(st.current.id);
      if (
        robot.root.position.x < -7 &&
        effectiveStatus === "processing" &&
        activeModule
      ) {
        const motion = this.productionMotion(robot, activeModule, st.progress);
        if (motion) {
          this.poseProductionRobot(robot, motion.gripper);
          continue;
        }
      }
      const poseTime = st.pause?.since ?? t;
      const cycle = (poseTime / 5 + Math.abs(robot.root.position.x) * 0.071) % 1;
      const travel = cycle < 0.5 ? ease(cycle * 2) : ease((1 - cycle) * 2);
      const reachZ = robot.side * (1.15 - 3 * travel),
        reachY = 1.1 + Math.sin(cycle * Math.PI * 2) ** 2 * 1.1;
      const distance = Math.min(3.16, Math.hypot(reachZ, reachY));
      const elbow = Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (distance * distance - 1.7 ** 2 - 1.5 ** 2) / (2 * 1.7 * 1.5),
          ),
        ),
      );
      const shoulder =
        Math.atan2(reachZ, reachY) -
        Math.atan2(1.5 * Math.sin(elbow), 1.7 + 1.5 * Math.cos(elbow));
      robot.upper.rotation.x = shoulder;
      robot.lower.rotation.x = elbow;
      robot.wrist.rotation.x = -shoulder - elbow;
      robot.root.rotation.y = 0;
      // The authoritative module mesh follows the wrist while carried below.
      // Keep this decorative gripper brick hidden so it never impersonates cargo.
      robot.part.setEnabled(false);
      if (st.fault) {
        robot.upper.rotation.x = robot.side * 0.4;
        robot.lower.rotation.x = robot.side * -1.8;
        robot.wrist.rotation.x =
          -robot.upper.rotation.x - robot.lower.rotation.x;
      }
    }

    for (const line of LINE_IDS) {
      const st = s.stations[line],
        z = LINE_META[line].z;
      this.lineGroups.get(line)!.position.x = st.offset;
      this.stockVisuals
        .get(line)
        ?.forEach((tote, i) =>
          tote.setEnabled(i < Math.ceil(s.warehouse[line] / 2)),
        );
      const pad = this.stationPads.get(line);
      if (pad) {
        let hex = LINE_META[line].color;
        if (this.overlay === "faults") hex = st.fault ? "#e56751" : "#76b9a1";
        if (this.overlay === "queues")
          hex = st.queue.length >= st.capacity ? "#dd7854" : "#76b9a1";
        if (this.overlay === "utilization")
          hex = st.status === "processing" ? "#62c9ac" : "#e0b260";
        (pad.material as PBRMaterial).albedoColor = c(hex)
          .scale(0.55)
          .add(c(C.cream).scale(0.45));
      }
      const modules = [...(st.current ? [st.current] : []), ...st.queue];
      modules.forEach((m) => {
        alive.add(m.id);
        let r = this.roots.get(m.id);
        if (!r) {
          r = this.module(m.id, line);
          this.roots.set(m.id, r);
        }
        const qi = st.queue.findIndex((q) => q.id === m.id);
        const effectiveStatus = st.pause?.previousStatus ?? st.status;
        const fixture: V = [-11.4 + st.offset, 1.25, z];
        const handoff: V = [1.2 + st.offset, 1.25, z];
        let position: V;
        if (st.current?.id === m.id) {
          // The carrier remains at the fixture while actual component groups
          // are placed one by one. Only the finished module takes the handoff.
          position = effectiveStatus === "unloading"
            ? lerp(fixture, handoff, ease(st.progress))
            : fixture;
        } else {
          position = [
            1.8 + st.offset + (qi % 4) * 1.85,
            1.25,
            z + Math.floor(qi / 4) * 1.35 - 0.65,
          ];
        }
        r.position.set(...position);
        r.scaling.setAll(0.65);
        this.stageModule(
          r,
          line,
          effectiveStatus,
          st.progress,
          st.current?.id === m.id,
        );
        if (st.current?.id === m.id && m.rework > 0 && !m.accepted) {
          const i = LINE_IDS.indexOf(line);
          const service: V = [
            6 + Math.floor(i / 2) * 2.2,
            1.25,
            10.5 + (i % 2) * 1.6,
          ];
          const end: V = [0 + st.offset, 1.25, z];
          const f = st.progress;
          r.position.set(
            ...(f < 0.3
              ? lerp(end, service, ease(f / 0.3))
              : f > 0.7
                ? lerp(service, end, ease((f - 0.7) / 0.3))
                : service),
          );
        }
        r.scaling.setAll(0.65);
      });
    }
    for (const event of s.events) {
      if (
        event.type !== "module-scrapped" ||
        t - event.time < 0 ||
        t - event.time > 8
      )
        continue;
      const line = event.entity as LineId;
      if (!LINE_IDS.includes(line)) continue;
      const id = "scrap-transfer:" + event.id;
      alive.add(id);
      let module = this.roots.get(id);
      if (!module) {
        module = this.module(id, line);
        module.scaling.setAll(0.65);
        this.roots.set(id, module);
      }
      module.position.set(
        ...lerp(
          [0, 1.25, LINE_META[line].z],
          [12, 1.1, 11],
          ease((t - event.time) / 8),
        ),
      );
    }
    for (const truck of s.trucks) {
      alive.add(truck.id);
      let r = this.roots.get(truck.id);
      if (!r) {
        r = this.truck(truck.id);
        this.roots.set(truck.id, r);
      }
      const f = pclip((t - truck.start) / (truck.end - truck.start));
      const dock: V = [-29, 0.2, 0];
      const approach = this.travel(
        [[-36, 0.2, -30], [-36, 0.2, -7], dock],
        f,
      );
      const departing = this.travel(
        [dock, [-36, 0.2, 7], [-36, 0.2, 30]],
        truck.inspection === "rejected" ? pclip((f - 0.2) / 0.8) : f,
      );
      const parkedHeading = this.travel(
        [[-36, 0.2, -30], [-36, 0.2, -7], dock],
        1,
      ).yaw;
      const moving = truck.phase === "approach" ? approach : truck.phase === "departing" ? departing : {pos:dock,yaw:parkedHeading};
      const p = moving.pos;
      r.position.set(...p);
      // The cab faces local -Z, while travel yaw describes the world tangent.
      this.steerYaw(r, -moving.yaw - Math.PI / 2);
      const cargo = r.metadata.cargo as TransformNode;
      cargo.setEnabled(
        truck.phase !== "departing" || truck.inspection === "rejected",
      );
      cargo.position.setAll(0);
      const pallets = r.metadata.pallets as TransformNode[];
      pallets.forEach((pallet, i) => {
        const line = LINE_IDS[i];
        pallet.setEnabled(truck.amount[line] > 0);
        const home: V = [0, 1.1, -1.05 + i * 0.78];
        const infeed = this.localTo(r, [-25.1, 1.3, 0]);
        const lane = this.localTo(r, [-25.1, 1.3, LINE_META[line].z]);
        const rack = this.localTo(r, [-22.1, 1.45, LINE_META[line].z]);
        let local = home;
        if (truck.phase === "unloading") {
          local = lerp(home, infeed, ease(f));
          local[1] += Math.sin(f * Math.PI) * 0.85;
        } else if (truck.phase === "departing" && truck.inspection === "rejected") {
          local = lerp(infeed, home, ease(pclip(f / 0.2)));
          local[1] += Math.sin(pclip(f / 0.2) * Math.PI) * 0.85;
        } else if (truck.phase === "sorting") {
          const phase = pclip(f);
          local = phase < 0.75 ? lerp(infeed, lane, ease(phase / 0.75)) : lerp(lane, rack, ease((phase - 0.75) / 0.25));
        }
        pallet.position.set(...local);
      });
    }
    for (const cart of s.carts) {
      alive.add(cart.id);
      let r = this.roots.get(cart.id);
      if (!r) {
        r = this.cart(cart.id, cart.line);
        this.roots.set(cart.id, r);
      }
      const f = pclip((t - cart.start) / (cart.end - cart.start));
      const z = LINE_META[cart.line].z;
      const a: V = [-20, 0.2, z],
        b: V = [-16 + s.stations[cart.line].offset, 0.2, z];
      r.position.set(
        ...(cart.phase === "outbound"
          ? lerp(a, b, f)
          : cart.phase === "returning"
            ? lerp(b, a, f)
            : cart.phase === "loading"
              ? a
              : b),
      );
      r.rotation.y = Math.PI / 2;
      const cargo = r.metadata.cargo as TransformNode;
      cargo.setEnabled(cart.phase !== "returning");
      // The one rendered kit begins at its matching rack, rides on the cart,
      // then transfers to the station intake; it is not a second inventory item.
      if (cart.phase === "loading") {
        cargo.position.set(0, Math.sin(f * Math.PI) * 0.35, -2.45 * (1 - ease(f)));
      } else if (cart.phase === "unloading") {
        cargo.position.set(0, Math.sin(f * Math.PI) * 0.22, ease(f) * 2.25);
      } else cargo.position.setAll(0);
    }
    for (const v of s.vehicles) {
      alive.add(v.id);
      let r = this.roots.get(v.id);
      if (!r) {
        r = this.car(v.id);
        this.roots.set(v.id, r);
      }
      const f = pclip((t - v.start) / (v.end - v.start));
      const parked = this.parkingPosition(v.slot);
      let p: V = [10, 1.3, 0],
        yaw = 0;
      if (v.phase === "testing") {
        p = [19, 1.3, 0];
        if (v.quality === "rework") {
          const service: V = [9, 1.3, 12];
          p =
            f < 0.3
              ? lerp(p, service, ease(f / 0.3))
              : f > 0.7
                ? lerp(service, p, ease((f - 0.7) / 0.3))
                : service;
        }
      } else if (v.phase === "outbound") {
        const path = this.travel(
          [
            [20, 0.4, 0],
            [23, 0.4, 0],
            [23, 0.2, 17.5],
            [31, 0.2, 17.5],
            [31, 0.2, parked[2]],
          ],
          f,
        );
        p = path.pos;
        yaw = Math.PI - path.yaw;
      } else if (v.phase === "parking") {
        p = lerp([31, 0.2, parked[2]], parked, ease(f));
        yaw = Math.PI;
      } else if (v.phase === "parked") {
        p = parked;
        yaw = Math.PI;
      } else if (v.phase === "dispatching") {
        const path = this.travel(
          [parked, [31, 0.2, parked[2]], [31, 0.2, 27]],
          f,
        );
        p = path.pos;
        yaw = Math.PI - path.yaw;
      }
      r.position.set(...p);
      r.rotation.y = yaw;
      const mods = r.metadata.modules as TransformNode[];
      mods.forEach((n, i) => {
        n.setEnabled(true);
        let offset: V = [0, 0, 0];
        if (this.exploded && v.id === this.explodedId)
          offset = (
            [
              [-2.8, 0, 0],
              [2.8, 0, 0],
              [0, -0.3, 0],
              [0, 1.9, 0],
              [0, 4, 0],
            ] as V[]
          )[i];
        else if (v.phase === "joining") {
          const staged = pclip(f * 1.6 - [1, 2, 0, 3, 4][i] * 0.12);
          offset = lerp(
            (
              [
                [-6.5, 0, -12],
                [-6.5, 0, -6],
                [-6.5, 0, 0],
                [-6.5, 0, 6],
                [-6.5, 0, 12],
              ] as V[]
            )[i],
            [0, 0, 0],
            ease(staged),
          );
        }
        n.position.set(...offset);
        const carrier = (r!.metadata.carriers as TransformNode[])[i];
        carrier.position.set(...offset);
        carrier.setEnabled(
          v.phase === "joining" &&
            !(this.exploded && v.id === this.explodedId) &&
            Math.hypot(offset[0], offset[2]) > 0.4,
        );
      });
      const doors = r
        .getDescendants(false)
        .filter((n) => n.name === "door") as TransformNode[];
      for (const door of doors)
        door.rotation.x =
          v.phase === "testing"
            ? Math.sin(f * Math.PI) * 0.9 * (door.position.z > 0 ? 1 : -1)
            : 0;
    }
    if (this.exploded) {
      const preview = this.roots.get("preview");
      if (preview) {
        (preview.metadata.modules as TransformNode[]).forEach((n, i) =>
          n.position.set(
            ...(
              [
                [-2.8, 0, 0],
                [2.8, 0, 0],
                [0, -0.3, 0],
                [0, 1.9, 0],
                [0, 4, 0],
              ] as V[]
            )[i],
          ),
        );
      }
    }
    for (const [id, r] of this.roots)
      if (!alive.has(id)) {
        r.dispose(false, false);
        this.roots.delete(id);
      }
    if (this.following) {
      const p = this.entityPosition(this.following);
      if (p) {
        this.camera.target = Vector3.Lerp(
          this.camera.target,
          new Vector3(p[0], p[1] + (this.exploded ? 2 : 0), p[2]),
          0.07,
        );
        this.camera.radius += ((this.exploded ? 21 : 14) - this.camera.radius) * 0.03;
        if (this.exploded) this.camera.beta += (1.05 - this.camera.beta) * 0.03;
      }
    }
    if (this.tour) {
      const elapsed = (performance.now() - this.tourStart) / 1000;
      const shots = ["site", "receiving", "sorting", "storage", ...LINE_IDS, "assembly", "parking"];
      const n = Math.floor(elapsed / 12) % shots.length;
      const name = shots[n];
      const keepStart = this.tourStart;
      this.preset(name);
      this.tour = true;
      this.tourStart = keepStart;
      this.targetCamera!.alpha += Math.sin(elapsed * 0.1) * 0.08;
    }
    if (this.targetCamera) {
      const a = this.targetCamera;
      this.camera.target = Vector3.Lerp(this.camera.target, a.target, 0.045);
      this.camera.radius += (a.radius - this.camera.radius) * 0.045;
      this.camera.alpha += (a.alpha - this.camera.alpha) * 0.045;
      this.camera.beta += (a.beta - this.camera.beta) * 0.045;
    }
    if (this.selected) {
      const p = this.entityPosition(this.selected);
      if (p) this.selectRing.position.set(p[0], 0.27, p[2]);
    }
  }
  dispose() {
    window.removeEventListener("resize", this.resize);
    this.scene.dispose();
    this.engine.dispose();
  }
}
