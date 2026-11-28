import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createIntelligentPreviewSession,planMeasuredIntelligentLayout} from '../dist/index.js';
if(typeof global.gc!=='function')throw Error('Use node --expose-gc');
const heap=()=>{global.gc();global.gc();return process.memoryUsage().heapUsed;};
const quantile=(xs,q)=>{const sorted=[...xs].sort((a,b)=>a-b);return sorted[Math.ceil(q*sorted.length)-1];};
function fixture(count,step,edited){
 const revision='r'+step;
 return {schemaVersion:1,revision,fingerprint:'fp-'+revision,content:{width:100000,height:250000},
  sections:[{id:'s',startOn:'continuous',blocks:Array.from({length:count},(_,i)=>({
   kind:'block',origin:{documentId:'doc',blockKey:'b'+i,revision},width:100000,
   unitHeights:[i===edited?12000:10000],splitPolicy:'strict',
   ...(i>0&&i%20===0?{startPosition:'page-top',startPositionSource:'explicit'}:{})
  }))}]};
}
async function run(count,edits){
 const session=createIntelligentPreviewSession();
 const samples=[],timings=[];let reuse=0,shared=0;
 const initialHeapBytes=heap();
 async function edit(step,edited,verify){
  const input=fixture(count,step,edited),start=performance.now();
  const outcome=await session.request(input);
  const ms=performance.now()-start;
  assert.equal(outcome.status,'current');assert.equal(outcome.revision,input.revision);
  assert.equal(outcome.calculation.result.status,'placed');
  assert.ok(session.isCurrent(outcome.requestId));
  if(verify)assert.deepEqual(outcome.calculation.result,planMeasuredIntelligentLayout(input));
  assert.equal('snapshot' in outcome.calculation,false);
  return {ms,reused:outcome.calculation.placement.reusedBlocks,shared:outcome.calculation.placement.sharedSnapshotPlacements??0};
 }
 await edit(0,-1,true);
 const warmHeapBytes=heap();
 for(let step=1;step<=edits;step++){
  const r=await edit(step,(Math.floor(count/2)+step*17)%count,step%8===0||step===edits);
  timings.push(r.ms);reuse+=r.reused;shared+=r.shared;
  if(step===Math.floor(edits/2)||step===edits)samples.push({step,heapBytes:heap()});
 }
 const finalHeapBytes=heap();session.reset();
 const resetHeapBytes=heap();
 const cold=await edit(edits+1,-1,true);
 assert.equal(cold.reused,0);
 session.reset();
 console.log(JSON.stringify({benchmark:'il-session',blocks:count,edits,medianMs:quantile(timings,.5),p95Ms:quantile(timings,.95),
  meanReusedBlocks:reuse/edits,meanSharedSnapshotPlacements:shared/edits,
  initialHeapBytes,warmHeapBytes,samples,finalHeapBytes,resetHeapBytes}));
}
await run(1000,80);
await run(9999,24);
