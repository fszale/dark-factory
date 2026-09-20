import {writeFile,mkdir} from 'node:fs/promises';
import {assertScheduledSample,soakReport} from './soak-harness.mjs';
const base=process.env.BRICKWORKS_TEST_URL||'http://localhost:3008';
const duration=Number(process.env.SOAK_SECONDS||7200);
const out=new URL(process.env.SOAK_OUTPUT||'../docs/review/wall-clock-soak.json',import.meta.url);
const request=async(path,options={})=>{const r=await fetch(base+path,options);if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r.json()};
const created=await request('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seed:42})});
const headers={'content-type':'application/json','x-session-token':created.token};
await request(`/api/sessions/${created.id}/command`,{method:'POST',headers,body:JSON.stringify({id:'soak-start',type:'start'})});
await request(`/api/sessions/${created.id}/command`,{method:'POST',headers,body:JSON.stringify({id:'soak-speed',type:'speed',value:10})});
const socket=new WebSocket(base.replace('http','ws')+'/api/live');let frames=0;let streamErrors=0;
socket.onopen=()=>socket.send(JSON.stringify({id:created.id,token:created.token}));socket.onmessage=()=>frames++;socket.onerror=()=>streamErrors++;
const began=Date.now();const samples=[];let status='running';
await mkdir(new URL('../docs/review/',import.meta.url),{recursive:true});
const persist=async(error)=>writeFile(out,JSON.stringify(soakReport({status,startedAt:new Date(began).toISOString(),durationSeconds:duration,speed:10,note:'Real wall-clock server and WebSocket soak. Browser rendering stress is measured separately. No AI calls or credentials are used.',samples,error}),null,2));
async function sample(){const {snapshot:s}=await request(`/api/sessions/${created.id}`,{headers});const health=await request('/api/health');const held=Object.values(s.warehouse).reduce((a,b)=>a+b,0)+s.carts.reduce((n,c)=>n+c.amount,0)+Object.values(s.stations).reduce((n,x)=>n+x.stock,0);
const balance=s.metrics.initial+s.metrics.received-held-s.metrics.consumed;
samples.push({wallSeconds:(Date.now()-began)/1000,simSeconds:s.time,completed:s.metrics.completed,dispatched:s.metrics.dispatched,materialDelta:balance,receivingDelta:s.metrics.receivingConservationDelta,events:s.events.length,samples:s.samples.length,activeVehicles:s.vehicles.length,activeModules:Object.values(s.stations).reduce((n,x)=>n+x.queue.length+(x.current?1:0),0),frames,streamErrors,...health.application});
await persist();
assertScheduledSample(samples);
}
try{await sample();while(Date.now()-began<duration*1000){await new Promise(r=>setTimeout(r,Math.min(60000,duration*1000-(Date.now()-began))));await sample()}status='passed';await persist();console.log('Two-hour wall-clock server/WebSocket soak passed.');}catch(error){status='failed';await persist(String(error));process.exitCode=1;}finally{socket.close()}
