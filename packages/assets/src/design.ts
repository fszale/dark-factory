import { z } from "zod";
export const LINE_IDS = [
  "front",
  "rear",
  "battery",
  "interior",
  "exterior",
] as const;
export const LINE_META = {
  front: { name: "Front structure", color: "#e59b55", cycle: 24, z: -12 },
  rear: { name: "Rear structure", color: "#8daae5", cycle: 28, z: -6 },
  battery: { name: "Battery & floor", color: "#64c5b2", cycle: 30, z: 0 },
  interior: { name: "Interior", color: "#bc91d4", cycle: 26, z: 6 },
  exterior: { name: "Exterior", color: "#e7c65b", cycle: 36, z: 12 },
};
const point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const stationDefinitionSchema = z
  .object({
    id: z.enum(LINE_IDS),
    name: z.string(),
    footprint: point,
    position: point,
    inlet: point,
    outlet: point,
    operations: z.array(z.string()),
    cycleSeconds: z.number().positive(),
    materialUnit: z.literal("component-kit"),
    inspectionRequired: z.literal(true),
    maximumRework: z.literal(1),
    acceptance: z.array(z.string()),
    visualAssembly: z.string(),
    motionPaths: z.record(z.array(point).min(2)),
    motionEnvelope: z.object({minimum:point,maximum:point}),
  })
  .strict();
export const STATION_DEFINITIONS = LINE_IDS.map((id) =>
  stationDefinitionSchema.parse({
    id,
    name: LINE_META[id].name,
    footprint: [18, 5, 4.9],
    position: [-7, 0, LINE_META[id].z],
    inlet: [-16, 1.25, LINE_META[id].z],
    outlet: [1.5, 1.25, LINE_META[id].z],
    operations: [
      "reserve-kit",
      "load",
      "place-bricks",
      "inspect",
      "unload",
      "rework",
      "maintain",
    ],
    cycleSeconds: LINE_META[id].cycle,
    materialUnit: "component-kit",
    inspectionRequired: true,
    maximumRework: 1,
    visualAssembly: "procedural-brick-line-v1",
    motionPaths: {
      load: [[-16,1.25,LINE_META[id].z],[-13,1.25,LINE_META[id].z]],
      process: [[-13,1.25,LINE_META[id].z],[0,1.25,LINE_META[id].z]],
      unload: [[0,1.25,LINE_META[id].z],[1.5,1.25,LINE_META[id].z]],
    },
    motionEnvelope: {minimum:[-17,0,LINE_META[id].z-2.4],maximum:[2,5,LINE_META[id].z+2.4]},
    acceptance: [
      "Exclusive station ownership",
      "One incoming kit consumed per attempt",
      "Accepted module retains incoming lot identity",
      "One rework attempt maximum",
      "No completion while faulted or paused",
    ],
  }),
);
export const recipeSchema = z.object({
  id:z.string().min(1), name:z.string().min(1),version:z.number().int().positive(),unit:z.literal("component-kit"),
  modules:z.array(z.object({line:z.enum(LINE_IDS),kits:z.literal(1),acceptedRequired:z.literal(true)})).length(5).refine(modules=>new Set(modules.map(m=>m.line)).size===5,"Five distinct module families are required"),
  joiningOrder:z.array(z.enum(LINE_IDS)).length(5).refine(lines=>new Set(lines).size===5),
  inspection:z.array(z.string()).min(1),notice:z.string(),
});
export const ROBOTAXI_RECIPE = recipeSchema.parse({
  id: "gold-two-seat-v1",
  name: "Gold two-seat robotaxi",
  version: 1,
  unit: "component-kit",
  modules: LINE_IDS.map((line) => ({ line, kits: 1, acceptedRequired: true })),
  joiningOrder: ["battery", "front", "rear", "interior", "exterior"],
  inspection: ["doors", "wheels", "body-panels", "simulated-function"],
  notice:
    "Educational unboxed assembly adaptation. No certified physical buildability or exact commercial part inventory is claimed.",
});
export const BRICK_SCALE = {
  studPitch: 0.4,
  studDiameter: 0.24,
  studHeight: 0.09,
  bodyBevel: 0.065,
  worldUnit: "abstract miniature unit",
} as const;
export const SITE_PORTS = {
  supplierEntry: [-36, 0, -30],
  supplierExit: [-36, 0, 30],
  receiving: [-29, 0, 0],
  assembly: [10, 1.3, 0],
  quality: [19, 1.3, 0],
  customerExit: [31, 0, 27],
} as const;
