import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {parentPort,workerData} from 'node:worker_threads';
import type {RunExport} from '../../../packages/contracts/src/index.ts';
import type {AuditEntry} from '../../../packages/simulation/src/index.ts';
import {replayArchive} from '../../../packages/simulation/src/replay.ts';

type ArchivedEntry=AuditEntry&{sessionId?:string;recordedAt?:number};
const data=workerData as {path:string;time:number};
const raw=readFileSync(data.path,'utf8');
const lines=raw.endsWith('\n')?raw.slice(0,-1).split('\n'):raw.split('\n').slice(0,-1);
const records=lines.filter(Boolean).map(line=>JSON.parse(line) as Record<string,unknown>);
if (records.some(record=>record.kind==='archive-truncated')) throw new Error('Truncated archives cannot be replayed');
const checkpoint=records.find(record=>record.kind==='checkpoint') as {run?:RunExport}|undefined;
if (!checkpoint?.run) throw new Error('Archive checkpoint is missing');
const entries=records.filter(record=>['event','lineage','command'].includes(String(record.kind))) as ArchivedEntry[];
const timeline=records.filter(record=>['event','lineage','command','watermark'].includes(String(record.kind))) as Array<ArchivedEntry|{kind:'watermark';epoch:number;time:number}>;

function entryEpoch(entry:ArchivedEntry|{kind:'watermark';epoch:number;time:number}):number|undefined {
  if (entry.kind==='watermark') return entry.epoch;
  if (entry.kind==='command') return entry.epoch;
  if (entry.kind==='event'&&Number.isInteger(entry.event.data?.epoch)) return Number(entry.event.data?.epoch);
  if (entry.kind==='lineage'&&Number.isInteger(entry.lineage.epoch)) return Number(entry.lineage.epoch);
  return undefined;
}

function entryTime(entry:ArchivedEntry|{kind:'watermark';epoch:number;time:number}):number|undefined {
  if (entry.kind==='watermark') return entry.time;
  if (entry.kind==='command') return entry.time;
  if (entry.kind==='event') return entry.event.time;
  if (entry.kind==='lineage'&&Number.isFinite(entry.lineage.dispatchedAt)) return Number(entry.lineage.dispatchedAt);
  return undefined;
}

const latestEpoch=Math.max(checkpoint.run.snapshot.epoch,...timeline.map(entry=>entryEpoch(entry)??-1));
const times=timeline.filter(entry=>entryEpoch(entry)===latestEpoch).map(entry=>entryTime(entry)).filter((value):value is number=>value!==undefined&&Number.isFinite(value));
if (checkpoint.run.snapshot.epoch===latestEpoch) times.push(checkpoint.run.snapshot.time);
const availableTime=Math.max(0,...times);
if (!Number.isFinite(data.time)||data.time<0||data.time>availableTime+1e-7) throw new Error('Replay time is outside the archived epoch');

const prefix=entries.filter(entry=>{
  const epoch=entryEpoch(entry);
  if (epoch===undefined||epoch<latestEpoch) return true;
  if (epoch>latestEpoch) return false;
  const time=entryTime(entry);
  return time===undefined||time<=data.time+1e-7;
});
const simulation=replayArchive(checkpoint.run,prefix,data.time);
if (simulation.snapshot().running) simulation.command({id:`replay-pause-${randomUUID()}`,type:'pause'});
parentPort?.postMessage({run:simulation.exportRun(),sourceEpoch:latestEpoch,targetTime:data.time,availableTime});
