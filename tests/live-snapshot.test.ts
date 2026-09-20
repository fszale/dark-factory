import { expect, it } from 'vitest';
import { FactorySimulation } from '../packages/simulation/src/index';
it('caps display events without losing history, charts, manufacturing state or isolation',()=>{
 const s=new FactorySimulation({seed:781});s.command({id:'start',type:'start'});
 for(let i=0;i<1500;i++)s.advance(1);
 const full=s.snapshot(), live=s.liveSnapshot(), status=s.status();
 expect(full.events.length).toBeGreaterThan(200);
 expect(live.events).toEqual(full.events.slice(-200));
 expect({...live,events:full.events}).toEqual(full);
 expect(status.time).toBe(full.time);expect(status.lastEventId).toBe(full.events.at(-1)!.id);
 live.warehouse.front=-100;live.events.length=0;status.time=-1;
 expect(s.snapshot()).toEqual(full);
 expect(s.hasOperationalEventAfter(status.lastEventId)).toBe(false);
 expect(s.hasOperationalEventAfter(0)).toBe(true);
});
