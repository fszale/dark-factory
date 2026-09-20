import assert from 'node:assert/strict';
import {assertScheduledSample,soakReport} from './soak-harness.mjs';

const first={materialDelta:0,receivingDelta:0,streamErrors:0,events:100,samples:1,frames:4,dispatched:0};
const minute={materialDelta:0,receivingDelta:0,streamErrors:0,events:2000,samples:720,frames:480,dispatched:12};
const completed=[first,minute];

assert.doesNotThrow(()=>assertScheduledSample(completed));
assert.throws(()=>assertScheduledSample([...completed,{...minute}]),/WebSocket stream stopped/);
const final=soakReport({status:'passed',startedAt:'2026-09-19T00:00:00.000Z',durationSeconds:7200,speed:10,note:'test',samples:completed});
assert.equal(final.status,'passed');
assert.equal(final.samples.length,2);
assert.strictEqual(final.samples,completed);
console.log('soak finalization regression passed: scheduled-stream guard remains strict and finalization reuses the validated terminal sample');
