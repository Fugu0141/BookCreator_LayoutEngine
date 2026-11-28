import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as full,planIntelligentLayoutIncremental as inc,planIntelligentLayoutIncrementalCooperative as coop,planMeasuredIntelligentLayout as measured,planMeasuredIntelligentLayoutIncremental as mi} from '../dist/index.js';
const b=(id,height=20,extra={})=>({id,size:{width:100,height},...extra});
const input=(blocks,extra={})=>({revision:'r1',content:{width:100,height:100},gap:0,blocks,...extra});
test('unchanged geometry reuses all placements and returns new revision',()=>{
 const i=input([b('a'),b('b')]),a=inc(i);
 const n={...i,revision:'r2'},r=inc(n,a.snapshot);
 assert.deepEqual(r.layout,full(n));assert.equal(r.reusedBlocks,2);assert.equal(r.placedBlocks,0);
});
test('local edit reuses prefix and suffix after hard page boundary',()=>{
 const i=input([b('a'),b('b'),b('c',20,{startNewPage:true}),b('d'),b('e')]),a=inc(i);
 const n=input([b('a'),b('b',30),b('c',20,{startNewPage:true}),b('d'),b('e')]);
 const r=inc(n,a.snapshot);
 assert.deepEqual(r.layout,full(n));assert.equal(r.reusedBlocks,3);assert.equal(r.reusedSuffixBlocks,2);assert.equal(r.placedBlocks,2);
});
test('insertion and deletion converge at identical flow state',()=>{
 const i=input([b('a'),b('b',20,{startNewPage:true}),b('c'),b('d')]),a=inc(i);
 const n=input([b('a'),b('new'),b('b',20,{startNewPage:true}),b('c'),b('d')]);
 const r=inc(n,a.snapshot);assert.deepEqual(r.layout,full(n));assert.equal(r.reusedSuffixBlocks,2);
 const back=inc(i,r.snapshot);assert.deepEqual(back.layout,full(i));assert.equal(back.reusedSuffixBlocks,2);
});
test('constraint and global changes are not masked; conflict preserves earlier snapshot',()=>{
 const i=input([b('a'),b('b')]),a=inc(i);
 for(const n of [input(i.blocks,{gap:1}),input(i.blocks,{content:{width:120,height:100}}),input(i.blocks,{reservedRegions:[{id:'r',page:0,rect:{x:0,y:0,width:100,height:10}}]})]){
  const r=inc(n,a.snapshot);assert.deepEqual(r.layout,full(n));assert.equal(r.reusedBlocks,0);
 }
 const bad=input([b('a'),b('b',20,{fixed:{page:0,x:0,y:0}})]);
 const r=inc(bad,a.snapshot);assert.deepEqual(r.layout,full(bad));assert.equal(r.snapshot,undefined);
 assert.equal(inc(i,a.snapshot).reusedBlocks,2);
});
test('public geometry and invalid input cannot poison saved result',()=>{
 const i=input([b('a'),b('b',20,{sizeConstraints:{minHeight:30}})]),a=inc(i);
 a.layout.placements[0].rect.y=999;a.layout.placements[1].occupiedRect.height=999;
 assert.deepEqual(inc(i,a.snapshot).layout,full(i));
 const invalid=input([b('a'),b('b',20,{spaceBefore:NaN})]);
 assert.deepEqual(inc(invalid,a.snapshot).layout,full(invalid));
 assert.equal(inc(invalid,a.snapshot).snapshot,undefined);
});
test('preferred pass reuses unchanged prefix; optimization uses original full candidate planner',()=>{
 const i=input([b('a'),b('b')]),a=inc(i);
 const n=input([b('a'),b('b',20,{preferred:{page:0,x:0,y:40}})]);
 const r=inc(n,a.snapshot);assert.deepEqual(r.layout,full(n));assert.equal(r.fullRecompute,false);assert.equal(r.reusedBlocks,1);assert.ok(r.snapshot);
 const opt=inc(i,a.snapshot,{});assert.equal(opt.fullRecompute,true);assert.deepEqual(opt.layout,full(i,{}));assert.equal(opt.snapshot,undefined);
});
test('incremental bridge reuses both layers and refreshes origin and fingerprint',()=>{
 const make=(rev,h)=>({schemaVersion:1,revision:rev,fingerprint:'fp-'+rev,content:{width:100,height:100},sections:[{id:'s',startOn:'continuous',blocks:['a','b','c'].map((blockKey,i)=>({kind:'block',origin:{documentId:'doc',blockKey,revision:rev,range:{start:i,end:i+1}},width:100,unitHeights:[i===1?h:20],splitPolicy:'strict'}))}]});
 const i=make('r1',20),a=mi(i),n=make('r2',20);
 const r=mi(n,{},a.snapshot);assert.deepEqual(r.result,measured(n));assert.equal(r.pagination.reusedBlocks,3);assert.equal(r.placement.reusedBlocks,3);
 const changed=make('r3',30),c=mi(changed,{},r.snapshot);assert.deepEqual(c.result,measured(changed));assert.equal(c.placement.reusedBlocks,1);
 const options={intents:[{documentId:'doc',blockKey:'b',placement:{fixed:{page:0,x:0,y:0}}}]};
 const conflict=mi(n,options,r.snapshot);assert.deepEqual(conflict.result,measured(n,options));assert.equal(conflict.snapshot,undefined);
 assert.equal(mi(n,{},r.snapshot).placement.reusedBlocks,3);
});
test('deterministic mixed edits agree with cold layout',()=>{
 let blocks=Array.from({length:50},(_,i)=>b('b'+i,10+i%4*5,{startNewPage:i%9===0}));
 let prev=inc(input(blocks));
 for(let i=0;i<80;i++){
  const j=(i*13)%blocks.length;
  blocks=blocks.map((v,k)=>k===j?{...v,size:{...v.size,height:10+(i%7)*5}}:v);
  const n=input(blocks,{revision:'r'+i});
  const r=inc(n,prev.snapshot);assert.deepEqual(r.layout,full(n));prev=r;
 }
});

test('preferred drag keys include target and tolerance, reuse suffix after page boundary',async()=>{
 const make=(x,y,tolerance)=>input([b('a'),{id:'drag',size:{width:30,height:20},preferred:{page:0,x,y},preferredTolerance:tolerance},b('break',20,{startNewPage:true}),b('d'),b('e')]);
 const first=make(65,25,{x:0,y:0}),a=inc(first);
 assert.deepEqual(a.layout,full(first));assert.equal(a.layout.placements[1].preference,'honored');
 const moved=make(75,30,{x:10,y:0}),r=inc(moved,a.snapshot);
 assert.deepEqual(r.layout,full(moved));assert.equal(r.layout.placements[1].rect.x,70);
 assert.equal(r.reusedBlocks,3);assert.equal(r.reusedSuffixBlocks,2);assert.equal(r.placedBlocks,2);
 const narrow=make(75,30,{x:1,y:0}),n=inc(narrow,r.snapshot);
 assert.deepEqual(n.layout,full(narrow));assert.equal(n.layout.placements[1].preference,'fallback');
 assert.equal(n.reusedBlocks,3);assert.equal(n.placedBlocks,2);
 const repeat=await coop(narrow,n.snapshot,()=>{});
 assert.deepEqual(repeat.layout,full(narrow));assert.equal(repeat.reusedBlocks,5);assert.equal(repeat.placedBlocks,0);
 const invalid=make(75,30,{x:-1,y:0});
 assert.deepEqual(inc(invalid,n.snapshot).layout,full(invalid));
 assert.equal(inc(invalid,n.snapshot).snapshot,undefined);
 await assert.rejects(coop(moved,n.snapshot,stage=>{if(stage==='il-place')throw Error('cancel drag');}),/cancel drag/);
 assert.equal(inc(narrow,n.snapshot).reusedBlocks,5);
});
test('late fixed conflict retries without preferences and cannot poison honoring snapshot',()=>{
 const make=y=>input([b('a',10),b('drag',20,{preferred:{page:0,x:0,y}}),b('pin',20,{fixed:{page:0,x:0,y:50}})]);
 const start=make(20),a=inc(start);assert.ok(a.snapshot);
 const moved=make(60),r=inc(moved,a.snapshot);
 assert.deepEqual(r.layout,full(moved));assert.equal(r.layout.status,'placed');
 assert.equal(r.layout.placements[1].preference,'fallback');
 assert.equal(r.fullRecompute,true);assert.equal(r.snapshot,undefined);
 assert.equal(inc(start,a.snapshot).reusedBlocks,3);
 const later=input([b('a',10),b('drag',20,{preferred:{page:0,x:0,y:60}}),b('pin',20,{fixed:{page:0,x:0,y:15}})]);
 const conflict=inc(later,a.snapshot);
 assert.deepEqual(conflict.layout,full(later));assert.equal(conflict.layout.status,'conflict');assert.equal(conflict.snapshot,undefined);
 assert.equal(inc(start,a.snapshot).reusedBlocks,3);
});
test('long book drag changes reuse preceding chapter placements and match cold computation',()=>{
 const blocks=Array.from({length:1000},(_,i)=>({id:'b'+i,size:{width:30,height:10},startNewPage:i%8===0}));
 const initial=inc(input(blocks));
 const edit=(x,y)=>input(blocks.map((b,i)=>i===800?{...b,preferred:{page:100,x,y},preferredTolerance:{x:10,y:5}}:b));
 let prior=initial;
 for(let i=0;i<12;i++){
  const n=edit(20+i*3,5+i%3),r=inc(n,prior.snapshot);
  assert.deepEqual(r.layout,full(n));assert.ok(r.snapshot);
  assert.ok(r.reusedBlocks>=800);assert.ok(r.placedBlocks<=200);
  prior=r;
 }
});
