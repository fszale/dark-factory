import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertScheduledSample} from './soak-harness.mjs';

const report=JSON.parse(await readFile(new URL('../docs/review/release-soak.json',import.meta.url),'utf8'));
const source=JSON.parse(await readFile(new URL('../docs/review/release-soak-source.json',import.meta.url),'utf8'));
assert.equal(report.status,'failed');
assert.match(report.error,/WebSocket stream stopped/);
const scheduled=report.samples.slice(0,-1);
assert.equal(scheduled.length,121);
assert.ok(scheduled.at(-1).wallSeconds>=7200);
for(let i=0;i<scheduled.length;i++) assertScheduledSample(scheduled.slice(0,i+1));
assert.throws(()=>assertScheduledSample(report.samples),/WebSocket stream stopped/);
for(const [path,expected] of Object.entries(source.sha256)){
  const bytes=await readFile(new URL(`../${path}`,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,path);
}
console.log(`release soak record verified: ${scheduled.length} scheduled samples through ${scheduled.at(-1).wallSeconds}s; preserved terminal duplicate remains rejected; ${Object.keys(source.sha256).length} source hashes match`);
