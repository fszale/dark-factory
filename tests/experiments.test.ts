import {describe,it,expect} from 'vitest';
import {pairedExperiment} from '../packages/simulation/src/experiments.ts';
describe('paired production comparisons',()=>{
 it('has identical outcomes for identical policies and discloses variation',()=>{
  const result=pairedExperiment({});
  expect(result.perSeed).toHaveLength(10);
  expect(Object.values(result.differences).every(x=>x===0)).toBe(true);
  expect(result.standardDeviation.baseline.throughput).toBeGreaterThanOrEqual(0);
  expect(result.baseline.receivingConservationDelta).toBe(0);
 });
 it('replays a recorded manufacturing action across paired seeds and retains provenance',()=>{
  const result=pairedExperiment({mode:'recorded-ai',schedule:[{time:0,provider:'astra',decisionId:'test-fixture-not-live',commands:[{id:'action',type:'profile',station:'exterior',value:'fast'}]}]});
  expect(result.policySource).toBe('recorded-ai');
  expect(result.sourceDecisionIds).toEqual(['test-fixture-not-live']);
  expect(result.perSeed.every(r=>r.appliedActions===1&&r.rejectedActions===0)).toBe(true);
  expect(result.differences.completed).not.toBe(0);
  expect(result.candidate.receivingConservationDelta).toBe(0);
 });
 it('compares named configurations using the same seeds and captures their inputs',()=>{
 const result=pairedExperiment({baselineName:'Standard dispatch',candidateName:'Slow dispatch',candidateConfig:{dispatchDwell:600,parkingCapacity:3}});
 expect(result.candidateName).toBe('Slow dispatch');expect(result.candidateConfig.dispatchDwell).toBe(600);expect(result.differences.dispatched).toBeLessThan(0);expect(result.candidate.receivingConservationDelta).toBe(0);
 });
 it('does not treat playback controls as a manufacturing policy',()=>{
  expect(()=>pairedExperiment({mode:'recorded-ai',schedule:[{time:0,provider:'jev',decisionId:'fixture',commands:[{id:'p',type:'pause'}]}]})).toThrow(/No recorded operational/);
 });
});
