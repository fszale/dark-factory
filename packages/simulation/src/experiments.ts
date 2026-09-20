import { DEFAULT_CONFIG, LINE_IDS, type FactoryCommand, type FactoryConfig, type FactoryMetrics, type LineId } from '../../contracts/src/index.ts';
import { FactorySimulation } from './index.ts';
export type Profiles = Partial<Record<LineId, 'gentle' | 'normal' | 'fast'>>;
export interface RecordedAction {time:number; provider:'astra'|'jev'; decisionId:string; commands:FactoryCommand[]}
export interface ExperimentInput {mode?:'profiles'|'recorded-ai'; profiles?:Profiles; schedule?:RecordedAction[]; baselineConfig?:Partial<FactoryConfig>;candidateConfig?:Partial<FactoryConfig>;baselineName?:string;candidateName?:string}
const metricKeys = ['completed','dispatched','throughput','yield','energy','materialCost','maintenanceCost','costPerVehicle','leadTime','downtime','dockWait','assemblyWait','parkingWait','roadWait','receivingConservationDelta','sortingTime'] as const;
const operationalTypes = new Set(['profile','buffer','repair','config','priority']);
export function pairedExperiment(data:ExperimentInput) {
  const seeds=Array.from({length:10},(_,i)=>10_001+i);
  const schedule=(data.schedule??[]).filter(x=>Number.isFinite(x.time)&&x.time>=0&&x.time<=1800).sort((a,b)=>a.time-b.time).slice(0,200);
  const actionCount=schedule.reduce((n,x)=>n+x.commands.filter(c=>operationalTypes.has(c.type)).length,0);
  if(data.mode==='recorded-ai' && !actionCount) throw new Error('No recorded operational AI actions are eligible for this comparison.');
  function run(seed:number,config:Partial<FactoryConfig>,actions:RecordedAction[]=[]) {
    const simulation=new FactorySimulation({...DEFAULT_CONFIG,...config,seed,profiles:{...DEFAULT_CONFIG.profiles,...config.profiles}});
    simulation.command({id:`experiment-start-${seed}`,type:'start'});
    // Presentation speed is fixed: every policy receives exactly 1,800 simulated seconds.
    let applied=0,rejected=0;
    for(const item of actions) {
      const at=simulation.snapshot().time;
      simulation.advance(Math.max(0,item.time-at));
      for(const [index,command] of item.commands.entries()) {
        if(!operationalTypes.has(command.type)) continue;
        const result=simulation.command({...command,id:`comparison-${item.decisionId.slice(0,70)}-${index}`,revision:undefined,epoch:undefined});
        if(result.ok) applied++; else rejected++;
      }
    }
    simulation.advance(Math.max(0,1800-simulation.snapshot().time));
    const metrics=simulation.snapshot().metrics;
    return {metrics:Object.fromEntries(metricKeys.map(key=>[key,Number.isFinite(metrics[key])?metrics[key]:0])),applied,rejected};
  }
  const baselineConfig:Partial<FactoryConfig>=data.mode==='recorded-ai'?{}:data.baselineConfig??{};
  const candidateConfig:Partial<FactoryConfig>=data.mode==='recorded-ai'?{}:{...data.candidateConfig,profiles:{...DEFAULT_CONFIG.profiles,...data.candidateConfig?.profiles,...data.profiles}};
  const baselineRuns=seeds.map(seed=>run(seed,baselineConfig));
  const candidateRuns=seeds.map(seed=>run(seed,candidateConfig,data.mode==='recorded-ai'?schedule:[]));
  const average=(runs:typeof baselineRuns)=>Object.fromEntries(metricKeys.map(key=>[key,runs.reduce((n,r)=>n+r.metrics[key],0)/runs.length]));
  const baseline=average(baselineRuns),candidate=average(candidateRuns);
  const delta=(a:Record<string,number>,b:Record<string,number>)=>Object.fromEntries(metricKeys.map(k=>[k,b[k]-a[k]]));
  const differences=delta(baseline,candidate);
  const perSeed=seeds.map((seed,i)=>({seed,baseline:baselineRuns[i].metrics,candidate:candidateRuns[i].metrics,differences:delta(baselineRuns[i].metrics,candidateRuns[i].metrics),appliedActions:candidateRuns[i].applied,rejectedActions:candidateRuns[i].rejected}));
  const deviation=(rows:Record<string,number>[],mean:Record<string,number>)=>Object.fromEntries(metricKeys.map(k=>[k,Math.sqrt(rows.reduce((n,r)=>n+(r[k]-mean[k])**2,0)/rows.length)]));
  const profiles={...DEFAULT_CONFIG.profiles,...candidateConfig.profiles};
  return {
    name:data.mode==='recorded-ai'?'Recorded AI action comparison':data.candidateConfig?'Paired factory configuration comparison':'Paired configured-profile comparison',runs:10,seeds,baseline,candidate,differences,perSeed,
    standardDeviation:{baseline:deviation(baselineRuns.map(r=>r.metrics),baseline),candidate:deviation(candidateRuns.map(r=>r.metrics),candidate),differences:deviation(perSeed.map(r=>r.differences),differences)},
    policySource:data.mode==='recorded-ai'?'recorded-ai':'configured-profiles',actionCount:data.mode==='recorded-ai'?actionCount:0,
    sourceDecisionIds:data.mode==='recorded-ai'?schedule.map(x=>x.decisionId):[],
    candidateProfiles:profiles,baselineName:data.baselineName??"Default flow",candidateName:data.candidateName??"Candidate flow",baselineConfig,candidateConfig,
    note:data.mode==='recorded-ai'
      ? 'Ten paired seeds replay previously applied live AI manufacturing actions, timed from the first eligible decision. This is open-loop action replay, not adaptive AI evaluation or causal proof. Each policy runs for 1,800 simulated seconds. Playback start/pause/speed controls are excluded. Rejected actions are counted per seed; no provider calls occur during comparison.'
      : `Candidate profiles: ${LINE_IDS.map(l=>`${l}=${profiles[l]}`).join(', ')}. Ten paired seeds run for 1,800 simulated seconds each. Named baseline/candidate configurations are included in this result. No AI provider is called or imitated.`,
  };
}
