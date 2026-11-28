import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntelligentPreviewSession,planMeasuredIntelligentLayout,planMeasuredIntelligentLayoutIncremental,planMeasuredIntelligentLayoutIncrementalCooperative} from '../dist/index.js';
function fixture(revision,edited=-1,invalid=false){
 return {schemaVersion:1,revision,fingerprint:'fp-'+revision,content:{width:100,height:100},sections:[{id:'s',startOn:'continuous',blocks:Array.from({length:160},(_,i)=>({
 kind:'block',origin:{documentId:'d',blockKey:'b'+i,revision},width:100,unitHeights:[invalid&&i===0?101:i===edited?15:10],splitPolicy:'strict',
 ...(i>0&&i%10===0?{startPosition:'page-top',startPositionSource:'explicit'}:{})}))}]};
}
test('measured sync and cooperative paths report shared private placements',async()=>{
 const a=planMeasuredIntelligentLayoutIncremental(fixture('a'));
 const b=fixture('b');
 const s=planMeasuredIntelligentLayoutIncremental(b,{},a.snapshot);
 const c=await planMeasuredIntelligentLayoutIncrementalCooperative(b,{},a.snapshot,()=>{});
 assert.equal(s.placement.sharedSnapshotPlacements,160);
 assert.deepEqual(c.placement,s.placement);
 assert.deepEqual(c.result,planMeasuredIntelligentLayout(b));
});
test('repeated editing, conflicts and reset preserve exactly the latest valid cache',async()=>{
 const session=createIntelligentPreviewSession({yieldToHost:async()=>{},now:()=>0});
 let last=await session.request(fixture('initial'));
 for(let i=0;i<60;i++){
  const input=fixture('edit'+i,(i*13)%160);
  const prior=last;
  // External result mutation must not affect private state.
  prior.calculation.result.fragments[0].placement.rect.x=999;
  last=await session.request(input);
  assert.equal(last.status,'current');assert.ok(!session.isCurrent(prior.requestId));
  assert.deepEqual(last.calculation.result,planMeasuredIntelligentLayout(input));
  assert.equal(last.calculation.placement.sharedSnapshotPlacements,last.calculation.placement.reusedBlocks);
  if(i%10===0){
   const bad=await session.request(fixture('conflict'+i,-1,true));
   assert.equal(bad.calculation.result.status,'conflict');
   last=await session.request(input);
   assert.equal(last.calculation.placement.reusedBlocks,160);
  }
 }
 session.reset();assert.ok(!session.isCurrent(last.requestId));
 const after=await session.request(fixture('fresh'));
 assert.equal(after.calculation.pagination.reusedBlocks,0);assert.equal(after.calculation.placement.reusedBlocks,0);
});
test('a burst of requests retains only the latest outcome and reset invalidates pending work',async()=>{
 const session=createIntelligentPreviewSession({yieldToHost:async()=>{},now:()=>0});
 const results=await Promise.all(Array.from({length:40},(_,i)=>session.request(fixture('burst'+i))));
 assert.ok(results.slice(0,-1).every(r=>r.status==='superseded'));
 const last=results.at(-1);assert.equal(last.status,'current');assert.equal(last.revision,'burst39');
 const pending=session.request(fixture('pending'));session.reset();
 assert.equal((await pending).status,'superseded');assert.ok(!session.isCurrent(last.requestId));
 const r=await session.request(fixture('new'));assert.equal(r.calculation.placement.reusedBlocks,0);
});
