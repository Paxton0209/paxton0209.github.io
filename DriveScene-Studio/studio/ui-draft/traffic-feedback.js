import {DRIVING_EVENT_SECONDS} from './interaction-duration.js';
// Author-approved prototype feedback, shared by every interaction.
export const TRAFFIC_FEEDBACK = Object.freeze({horizon:2.5,clearHold:.5,fade:.35,step:.05});
// Ignore small speed corrections in the demo's yellow feedback. Metres per second.
export const FEEDBACK_SPEED_DEADBAND = .5;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=n=>(n=clamp(n),n*n*(3-2*n));
const mix=(a,b,t)=>a+(b-a)*t;

function withinConstraintRange(ego,car){
 const radius=p=>Math.hypot(p.length||4.9,p.width||2.1)/2;
 const gap=Math.hypot(ego.x-car.x,ego.z-car.z)-radius(ego)-radius(car);
 const speed=Math.max(Math.abs(ego.speed||0),Math.abs(car.speed||0));
 return gap<=Math.max(8,speed*TRAFFIC_FEEDBACK.horizon);
}

// Oriented complete bodies, expanded by a shared speed-dependent margin.
// These are demonstration parameters, not a production collision controller.
export function feedbackOverlap(a,b){
 if(Math.abs(a.speed||0)+Math.abs(b.speed||0)<.05)return false;
 const body=p=>({...p,width:(p.width||2.1)+.3,length:(p.length||4.9)+.6+Math.abs(p.speed||0)*.45});
 a=body(a);b=body(b);
 if(Math.hypot(a.x-b.x,a.z-b.z)>(a.length+b.length+a.width+b.width)/2)return false;
 const extent=(p,x,z)=>Math.abs(x*Math.cos(p.yaw||0)-z*Math.sin(p.yaw||0))*p.width/2+Math.abs(x*Math.sin(p.yaw||0)+z*Math.cos(p.yaw||0))*p.length/2;
 for(const p of [a,b])for(const [x,z]of [[Math.cos(p.yaw||0),-Math.sin(p.yaw||0)],[Math.sin(p.yaw||0),Math.cos(p.yaw||0)]])
  if(Math.abs((a.x-b.x)*x+(a.z-b.z)*z)>=extent(a,x,z)+extent(b,x,z))return false;
 return true;
}

// Bake once per route. Playback, backwards seeking and export share the same
// evidence and hysteresis; render order never becomes a hidden warning clock.
export function createTrafficFeedback(sample,{start=0,duration=10,step=TRAFFIC_FEEDBACK.step}={}){
 const count=Math.ceil((duration-start)/step),rows=Array.from({length:count+1},(_,i)=>sample(Math.min(duration,start+i*step)));
 const ids=[...new Set(rows.flatMap(row=>row.traffic.map(car=>car.id)))],tracks=new Map();
 for(const id of ids){
  const demand=new Uint8Array(rows.length);let nextUrgent=Infinity;
  for(let i=count;i>=0;i--){
   const row=rows[i],car=row.traffic.find(car=>car.id===id);
   if(!car)continue;
   const time=start+i*step,overlap=feedbackOverlap(row.ego,car);
   if(overlap)nextUrgent=time;
   const urgent=overlap||(car.intentKnown!==false&&nextUrgent-time<=TRAFFIC_FEEDBACK.horizon+1e-8);
   demand[i]=urgent?2:Number(Boolean(car.constraining&&withinConstraintRange(row.ego,car)));
  }
  const track=[];let level=0,lowerSince=null,transition=null,weights=[0,0];
  for(let i=0;i<=count;i++){
   const time=start+i*step,requested=demand[i];
   if(transition){const u=smooth((time-transition.at)/TRAFFIC_FEEDBACK.fade);weights=transition.from.map((v,k)=>mix(v,transition.to[k],u));if(u===1)transition=null;}
   if(requested>=level){lowerSince=null;if(requested>level){level=requested;weights=level===2?[0,1]:[1,0];transition=null;}}
   else{
    lowerSince??=time;
    if(time-lowerSince>=TRAFFIC_FEEDBACK.clearHold-1e-8){level=requested;lowerSince=null;transition={at:time,from:[...weights],to:level===2?[0,1]:level===1?[1,0]:[0,0]};}
   }
   track.push({level,yellow:weights[0],red:weights[1]});
  }
  tracks.set(id,track);
 }
 return (id,time)=>{
  const track=tracks.get(id);if(!track)return {level:0,yellow:0,red:0};
  const u=clamp((time-start)/step+1e-9,0,count),i=Math.floor(u),a=track[i],b=track[Math.min(count,i+1)];
  // Upgrades land at their evidence timestamp, without a pre-trigger fade.
  if(b.level>a.level)return {...a};
  const clean=n=>n<1e-7?0:n>1-1e-7?1:n;
  return {level:a.level,yellow:clean(mix(a.yellow,b.yellow,u-i)),red:clean(mix(a.red,b.red,u-i))};
 };
}

export function feedbackFields(feedback){
 const tint=feedback.yellow+feedback.red;
 return {trafficFeedback:feedback,...(tint>1e-7?{cutInColor:feedback.red>feedback.yellow?'red':'yellow',cutInTint:tint}: {})};
}

export function createFeedbackPainter(Color){
 // Approximate the rendered amber/red family seen in Huawei ADS references.
 // These are scene albedos, not claimed OEM source colours; see traffic-color-reference.md.
 const paints={yellow:[new Color('#DBB34B'),new Color('#D0A641')],red:[new Color('#C6534D'),new Color('#BD4945')]};
 const roles={paint:1,trim:.85,window:.82,rim:.74,rubber:.42},ink=new Color(),partInk=new Color(),yellow=new Color(),red=new Color();
 return (car,feedback,tone=0)=>{
  if(!feedback)return;
  const amount=feedback.yellow+feedback.red;if(amount<1e-7)return;
  yellow.copy(paints.yellow[0]).lerp(paints.yellow[1],tone);red.copy(paints.red[0]).lerp(paints.red[1],tone);
  ink.copy(yellow).lerp(red,feedback.red/amount);
  car.traverse(part=>{for(const material of Array.isArray(part.material)?part.material:[part.material]){
   const light=roles[material?.userData.trafficRole];if(light!==undefined&&material.color)material.color.lerp(partInk.copy(ink).multiplyScalar(light),amount);
  }});
 };
}

export function withDrivingFeedback(sample,{egoX=0,start=0,duration=DRIVING_EVENT_SECONDS}={}){
 let feedback;
 const evidence=time=>{
  const row=sample(time);
  return {ego:{x:egoX+row.x,z:-row.distance,yaw:row.yaw||0,speed:row.speed},traffic:row.traffic.map(car=>({...car,z:car.z-row.distance}))};
 };
 const run=time=>{
  feedback??=createTrafficFeedback(evidence,{start,duration});
  const row=sample(time);
  return {...row,traffic:row.traffic.map(({cutInColor,cutInTint,...car})=>({...car,...feedbackFields(feedback(car.id,time))}))};
 };
 return run;
}
