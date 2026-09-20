import { expect, it } from 'vitest';
import { AnimationClock, stationPresentationProgress } from '../apps/web/src/visuals/animation-clock';
const state = (time: number, running = true, speed = 1, epoch = 0) => ({id:'factory',epoch,time,running,speed});
it.each([1,10])('never reverses with delayed and bunched packets at %sx', speed => {
 const clock=new AnimationClock(); clock.receive(state(0,true,speed),0);
 let previous=0, packet=0; const arrivals=[150,280,460,475,670,800,930,1100];
 for(let now=10;now<=1200;now+=10){
  while(packet<arrivals.length&&now>=arrivals[packet]){packet++;clock.receive(state(packet*.125*speed,true,speed),now);}
  const time=clock.read(now);expect(time).toBeGreaterThanOrEqual(previous);expect(time-previous).toBeLessThan(.014*speed);previous=time;
 }
 expect(previous).toBeGreaterThan(.9*speed);
});
it('holds on pause, follows steps, resets on epoch and bounds disconnected extrapolation',()=>{
 const clock=new AnimationClock();clock.receive(state(10),0);
 for(let now=10;now<=5000;now+=10)clock.read(now);
 expect(clock.read(5100)).toBeLessThanOrEqual(10.25);
 clock.receive(state(10,false),5200);expect(clock.read(6000)).toBe(10);
 clock.receive(state(12,false),6100);expect(clock.read(7000)).toBe(12);
 clock.receive(state(0,true,1,1),7100);expect(clock.read(7100)).toBe(0);
});

it('interpolates gripper and module motion between packets while respecting holds',()=>{
 const station={status:'processing',progress:.4,phaseStart:10,phaseEnd:20};
 expect(stationPresentationProgress(station,14.016,true)).toBeCloseTo(.4016);
 expect(stationPresentationProgress(station,14.032,true)).toBeCloseTo(.4032);
 expect(stationPresentationProgress(station,14.032,false)).toBe(.4);
 for(const status of ['paused','faulted','maintenance','blocked'])
   expect(stationPresentationProgress({...station,status},19,true)).toBe(.4);
 expect(stationPresentationProgress(station,25,true)).toBe(1);
});
