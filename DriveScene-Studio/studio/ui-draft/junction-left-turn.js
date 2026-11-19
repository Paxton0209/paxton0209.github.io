import {createTrafficFeedback, feedbackOverlap, TRAFFIC_FEEDBACK} from './traffic-feedback.js';
import {carryJunctionTraffic} from './junction-traffic.js';
import {DRIVING_EVENT_SECONDS} from './interaction-duration.js';
import {OPEN_ROAD_CRUISE} from './junction-playback.js';
// Shared clock for the Junction replay, the timeline captions, and frame export.
export const JUNCTION_LEFT_TURN = 'leftturn';
const turnAt = 4.65, turnAccelerationSeconds = 1.2, cameraReturnSeconds = 1.5;
const turnSpeed = 9.6;
// Time to travel the same path distance and clear the intersection.
const crossingTime = 3.5 + turnAccelerationSeconds / 2;
const clearAt = turnAt + crossingTime;
export const JUNCTION_EXIT_CRUISE = OPEN_ROAD_CRUISE;
const exitAcceleration = 1.5; // Peak longitudinal acceleration, metres per second squared.
const exitRecoveryTime = 1.5 * (JUNCTION_EXIT_CRUISE - turnSpeed) / exitAcceleration;
// Successful turns show at least one second at cruise after recovering speed.
const replayDuration = clear => Number.isFinite(clear)
 ? Math.max(DRIVING_EVENT_SECONDS,Math.ceil(clear+exitRecoveryTime+1))
 : DRIVING_EVENT_SECONDS;
export const JUNCTION_LEFT_TIMING = Object.freeze({
 signalAt: .65, yieldAt: 2.15, stopAt: 3.5, turnAt,
 clearAt, cameraReturnSeconds, duration: replayDuration(clearAt),
});

const lane = 1.85, exitZ = -40 - lane, curveStartZ = -28, curveEndX = -14.5;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const curve = [[lane,curveStartZ],[lane,-32],[lane,-37],[-5.5,exitZ],[-9.5,exitZ],[curveEndX,exitZ]];
function bezier(t) {
 const inverse = 1 - t, binomial = [1,5,10,10,5,1];
 return curve.reduce(([x,z], [cx,cz], i) => {
  const w = binomial[i] * inverse ** (5 - i) * t ** i;
  return [x + cx * w, z + cz * w];
 }, [0,0]);
}
const curvePoints = Array.from({length:81}, (_,i) => bezier(i/80));
const curveDistances = [0];
for(let i=1;i<curvePoints.length;i++) {
 const [x,z]=curvePoints[i], [px,pz]=curvePoints[i-1];
 curveDistances.push(curveDistances[i-1] + Math.hypot(x-px,z-pz));
}
export function junctionLeftPath() {
 return [[lane,60], ...curvePoints, [-350,exitZ]];
}
function position(distance, stopZ) {
 const s = distance - (stopZ - curveStartZ);
 if(s <= 0) return [lane, stopZ - distance];
 const last = curveDistances.at(-1);
 if(s >= last) return [curveEndX - (s-last), exitZ];
 const i = curveDistances.findIndex(d => d >= s);
 const u = (s-curveDistances[i-1])/(curveDistances[i]-curveDistances[i-1]);
 const [ax,az]=curvePoints[i-1], [bx,bz]=curvePoints[i];
 return [ax+(bx-ax)*u, az+(bz-az)*u];
}
const heading = (distance, stopZ) => {
 const [ax,az]=position(distance-.65, stopZ), [bx,bz]=position(distance+.65, stopZ);
 return Math.atan2(ax-bx,az-bz);
};
function accelerate(elapsed, ramp, cruise) {
 const u=clamp(elapsed/ramp,0,1);
 return {
  speed:cruise*u*u*(3-2*u),
  distance:cruise*(ramp*(u**3-.5*u**4)+Math.max(0,elapsed-ramp)),
 };
}
function sampleTurn(seconds, stopZ, {signalAt, turnAt, clearAt, duration}) {
 const t=clamp(seconds,0,duration), elapsed=Math.max(0,t-turnAt);
 const turn=accelerate(elapsed,turnAccelerationSeconds,turnSpeed);
 const recovery=accelerate(Math.max(0,t-clearAt),exitRecoveryTime,JUNCTION_EXIT_CRUISE-turnSpeed);
 const speed=turn.speed+recovery.speed, distance=turn.distance+recovery.distance;
 const [x,z]=position(distance,stopZ), yaw=heading(distance,stopZ);
 const steer=clamp((heading(distance+1.45,stopZ)-heading(distance-1.45,stopZ)),0,.44);
 const signal=t>=signalAt&&t<clearAt, phase=(t-signalAt)%.8;
 const lamp=signal?clamp(phase/.035,0,1)*clamp((.4-phase)/.035,0,1):0;
 return {x,z,yaw,steer,speed,distance,signal,lamp,pathRelease:clamp(elapsed/1.15,0,1)};
}

// A run draws an independent through stream. Relative arrival times are
// selected before ego searches for an opening, and never depend on its turn.
export function planJunctionTurn(random, stopZ, live, markingEnd) {
 const {stopAt}=JUNCTION_LEFT_TIMING;
 const draw=(min,max)=>min+(max-min)*random();
 const cross=random()<.5, lane=Math.floor(random()*3);
 const dense=random()<.36, count=dense?4+Math.floor(random()*3):1+Math.floor(random()*2);
 const laneX=-1.85-3.7*lane;
 const stream=[];
 let arrival=draw(2.2,6.1);
 for(let i=0;i<count;i++){
  const speed=draw(10.5,14);
  const direction=cross&&lane%2===0?-1:1;
  stream.push({id:'junction-flow-'+i,x:cross?-direction*speed*arrival:laneX,
   z:cross?(direction<0?-45.55:-34.45):-40-speed*arrival,
   yaw:cross?-direction*Math.PI/2:Math.PI,direction,speed});
  arrival+=dense?draw(1.9,2.7):draw(5.3,7.2);
 }
 const ambient=live?.cars??[];
 const carry=(car,time)=>car.axis==='x'
  ? {...car,x:car.x+Math.max(0,time-live.time)*car.speed*car.direction}
  : carryJunctionTraffic(car,Math.max(0,time-live.time),Infinity,markingEnd);
 const move=(car,time)=>({...car,x:car.x+(cross?car.direction*car.speed*time:0),z:car.z+(cross?0:car.speed*time),
  growth:live?clamp((time-live.time)/.6,0,1):1});
 const samples=Array.from({length:151},(_,i)=>i*.1);
 // Preserve the live fleet at activation; reject generated arrivals that
 // would collide with a vehicle already in the scene.
 for(let i=0;i<stream.length;i++){
  const car=stream[i], neighbors=stream.slice(0,i);
  if(samples.some(t=>[...ambient.map(a=>carry(a,t)),...neighbors.map(a=>move(a,t))].some(a=>feedbackOverlap(move(car,t),a))))stream.splice(i--,1);
 }
 const traffic=time=>[...ambient.map(car=>carry(car,time)),...stream.map(car=>move(car,time))];
 const crossing=crossingTime;
 const trial={...JUNCTION_LEFT_TIMING,turnAt:0,clearAt:crossing};
 const sampleStep=.05;
 const path=Array.from({length:Math.ceil((crossing+1.1)/sampleStep)},(_,i)=>sampleTurn(i*sampleStep,stopZ,trial));
 const blockers=(time,poses)=>{
  const ids=new Set();
  poses.forEach((ego,i)=>{
   for(const car of traffic(time+i*sampleStep)) if(feedbackOverlap(ego,{...car,length:6.2,width:2.45}))ids.add(car.id);
  });
  return ids;
 };
 const latest=DRIVING_EVENT_SECONDS-crossing-1;
 let turnAt=Infinity;
 for(let t=stopAt+.3;t<=latest;t+=.1){
  if(!blockers(t,path).size){turnAt=t;break;}
 }
 const nearPath=path.slice(0,Math.floor(TRAFFIC_FEEDBACK.horizon/sampleStep)+1);
 const clear=turnAt+crossing;
 const timing={...JUNCTION_LEFT_TIMING,turnAt,clearAt:clear,duration:replayDuration(clear)};
 return {timing,sample:time=>{
  const ego=sampleTurn(time,stopZ,timing);
  // A new turn takes the full gap above. Only imminent blockers are shown
  // while waiting, including late frames when no full gap ever opened.
  const blocked=time>=stopAt&&time<turnAt?blockers(time,nearPath):null;
  return {...ego,traffic:traffic(time).map(car=>({...car,constraining:blocked?.has(car.id)}))};
 }};
}

export function sampleJunctionLeftTurn(seconds,stopZ){
 const t=clamp(seconds,0,JUNCTION_LEFT_TIMING.duration);
 const oncoming=[[-76,11.8],[-135,10]].map(([start,speed],i)=>({
  id:'junction-oncoming-'+(i+1),x:-5.55,z:start+speed*t,yaw:Math.PI,speed,direction:1,
 }));
 return {...sampleTurn(t,stopZ,JUNCTION_LEFT_TIMING),oncoming};
}

const feedbackRuns=new Map();
export function junctionTrafficFeedback(stopZ){
 if(!feedbackRuns.has(stopZ)){
  if(feedbackRuns.size>8)feedbackRuns.clear();
  feedbackRuns.set(stopZ,createTrafficFeedback(time=>{
   const f=sampleJunctionLeftTurn(time,stopZ);
   return {ego:f,traffic:f.oncoming};
  },{duration:JUNCTION_LEFT_TIMING.duration}));
 }
 return feedbackRuns.get(stopZ);
}
