import {z} from 'zod';
/** Future equipment boundary. No actuator or hardware connection is implemented here. */
const identity=z.string().min(1).max(120);
export const stationOperationSchema=z.object({
 id:identity,stationId:identity,expectedRevision:z.number().int().nonnegative(),
 operation:z.enum(['reserve-kit','load','place-bricks','inspect','unload','rework','maintain']),
 materialIds:z.array(identity).max(100),sourcePort:identity.optional(),destinationPort:identity.optional(),
}).strict();
export const stationAcknowledgementSchema=z.object({
 operationId:identity,stationId:identity,revision:z.number().int().nonnegative(),
 status:z.enum(['accepted','rejected','completed']),reason:z.string().max(1000).optional(),
 ownedMaterialIds:z.array(identity).max(100),observedAt:z.string().datetime(),
}).strict();
export const stationObservationSchema=z.object({
 stationId:identity,revision:z.number().int().nonnegative(),observedAt:z.string().datetime(),
 state:z.enum(['idle','loading','processing','unloading','starved','blocked','faulted','maintenance','paused']),
 ownedMaterialIds:z.array(identity).max(100),interlocksSatisfied:z.boolean(),
 condition:z.array(z.object({name:identity,value:z.number().finite(),unit:identity,source:z.enum(['simulated','measured'])})).max(40),
}).strict();
export interface EquipmentAdapter {
 readonly id:string;
 readonly capabilities:ReadonlyArray<z.infer<typeof stationOperationSchema>['operation']>;
 observe():Promise<z.infer<typeof stationObservationSchema>>;
 request(operation:z.infer<typeof stationOperationSchema>):Promise<z.infer<typeof stationAcknowledgementSchema>>;
 stop(reason:string):Promise<z.infer<typeof stationAcknowledgementSchema>>;
}
