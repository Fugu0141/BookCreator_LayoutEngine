import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as full,planIntelligentLayoutIncremental as inc,planMeasuredIntelligentLayout as measured,planMeasuredIntelligentLayoutIncremental as mi} from '../dist/index.js';
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
test('preferred and optimization use original full candidate planner',()=>{
 const i=input([b('a'),b('b')]),a=inc(i);
 const n=input([b('a'),b('b',20,{preferred:{page:0,x:0,y:40}})]);
 assert.deepEqual(inc(n,a.snapshot).layout,full(n));assert.equal(inc(n,a.snapshot).fullRecompute,true);
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
