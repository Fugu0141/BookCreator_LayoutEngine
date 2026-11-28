import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayoutIncremental as sync,planIntelligentLayoutIncrementalCooperative as cooperative,
 planMeasuredIntelligentLayoutIncremental as measured,planMeasuredIntelligentLayoutIncrementalCooperative as measuredCooperative,
 createIntelligentPreviewSession} from '../dist/index.js';
const block=(id,height=10,extra={})=>({id,size:{width:40,height},sideBySide:true,...extra});
const layout=(blocks,revision='r')=>({revision,content:{width:100,height:100},gap:2,blocks});
const source=(revision,count=200,height=10)=>({schemaVersion:1,revision,fingerprint:'fp-'+revision,content:{width:100,height:100},
 sections:[{id:'s',startOn:'continuous',blocks:Array.from({length:count},(_,i)=>({kind:'block',
 origin:{documentId:'doc',revision,blockKey:'b'+i},width:40,unitHeights:[i===1?height:10],splitPolicy:'strict'}))}]});
const comparable=({snapshot,...rest})=>rest;
test('cooperative normal and reused shelf plans equal synchronous results',async()=>{
 const first=layout(Array.from({length:500},(_,i)=>block('b'+i)));
 const stages=new Set(),a=await cooperative(first,undefined,s=>{stages.add(s);});
 assert.deepEqual(comparable(a),comparable(sync(first)));
 const next={...first,revision:'r2'};
 const r=await cooperative(next,a.snapshot,s=>{stages.add(s);});
 assert.deepEqual(comparable(r),comparable(sync(next,a.snapshot)));
 assert.equal(r.reusedBlocks,500);
 for(const s of ['il-validate','il-key','il-match','il-reuse','il-place','il-snapshot'])assert.ok(stages.has(s),s);
});
test('cooperative candidate optimization and preferred fallback are identical',async()=>{
 const i=layout([block('a',10,{preferred:{page:0,x:0,y:55}}),block('b',10,{fixed:{page:0,x:0,y:25},sideBySide:false}),block('c')]);
 const stages=new Set();
 for(const options of [undefined,{}]){
  const r=await cooperative(i,undefined,s=>{stages.add(s);},options);
  assert.deepEqual(comparable(r),comparable(sync(i,undefined,options)));
 }
 assert.ok(stages.has('il-score'));
});
test('cancellation rejects and leaves existing snapshot usable',async()=>{
 const i=layout(Array.from({length:300},(_,k)=>block('b'+k))),a=sync(i);
 const n=layout(i.blocks.map((b,k)=>k===0?block(b.id,11):b),'r2');
 const stop=new Error('stop');
 await assert.rejects(cooperative(n,a.snapshot,s=>{if(s==='il-place')throw stop;}),e=>e===stop);
 assert.equal(sync(i,a.snapshot).reusedBlocks,300);
});
test('measured cooperative bridge preserves both layers and exact result',async()=>{
 const i=source('a'),a=await measuredCooperative(i,{},undefined,()=>{});
 assert.deepEqual(comparable(a),comparable(measured(i)));
 const n=source('b',200,12),stages=new Set();
 const r=await measuredCooperative(n,{},a.snapshot,s=>{stages.add(s);});
 assert.deepEqual(comparable(r),comparable(measured(n,{},a.snapshot)));
 for(const s of ['paginate-validate','il-bridge','il-validate'])assert.ok(stages.has(s),s);
});
test('measured cooperative cancellation does not publish a new checkpoint',async()=>{
 const i=source('a'),a=measured(i);
 await assert.rejects(measuredCooperative(source('b'),{},a.snapshot,s=>{if(s==='il-bridge')return Promise.reject(new Error('abort'));}),/abort/);
 assert.equal(measured(i,{},a.snapshot).pagination.reusedBlocks,200);
});
const deferredHost=()=>{
 const queue=[];
 return {queue,yieldToHost:()=>new Promise(resolve=>queue.push(resolve)),release:()=>{assert.ok(queue.length);queue.shift()();}};
};
test('same-turn requests coalesce, only newest publishes',async()=>{
 const host=deferredHost(),s=createIntelligentPreviewSession({yieldToHost:host.yieldToHost,now:()=>0});
 const a=s.request(source('a')),b=s.request(source('b'));
 host.release();host.release();
 assert.equal((await a).status,'superseded');
 const r=await b;assert.equal(r.status,'current');assert.equal(r.revision,'b');
 assert.equal(s.isCurrent(r.requestId),true);
 assert.equal('snapshot' in r.calculation,false);
});
test('new request interrupts already running work at host yield',async()=>{
 const host=deferredHost();let tick=0;
 const s=createIntelligentPreviewSession({yieldToHost:host.yieldToHost,now:()=>++tick,sliceMs:1});
 const a=s.request(source('a'));host.release();
 await Promise.resolve();assert.equal(host.queue.length,1);
 const b=s.request(source('b',0));host.release();host.release();
 assert.equal((await a).status,'superseded');
 // Stop the second request at its next checkpoint rather than drain all slices.
 s.cancel();while(host.queue.length)host.release();
 assert.equal((await b).status,'superseded');
});
test('conflict retains prior successful cache; reset discards it',async()=>{
 const s=createIntelligentPreviewSession({yieldToHost:async()=>{},now:()=>0});
 const a=await s.request(source('a'));assert.equal(a.calculation.result.status,'placed');
 const invalid=await s.request(source('b',200,101));
 assert.equal(invalid.calculation.result.status,'conflict');assert.equal(s.isCurrent(a.requestId),false);
 const c=await s.request(source('c'));assert.equal(c.calculation.pagination.reusedBlocks,200);
 s.reset();assert.equal(s.isCurrent(c.requestId),false);
 const d=await s.request(source('d'));assert.equal(d.calculation.pagination.reusedBlocks,0);
});
