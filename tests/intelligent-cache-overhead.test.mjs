import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as full,planIntelligentLayoutIncremental as inc,planIntelligentLayoutIncrementalCooperative as coop} from '../dist/index.js';
const b=(id,height=20,extra={})=>({id,size:{width:40,height},...extra});
const input=(blocks,extra={})=>({revision:'r',content:{width:100,height:100},gap:0,blocks,...extra});
test('unchanged generations share private placement values but never public objects',()=>{
 const i=input([b('a'),b('b',20,{sizeConstraints:{minHeight:30}})]),a=inc(i);
 const c=inc({...i,revision:'r2'},a.snapshot);
 assert.equal(c.sharedSnapshotPlacements,2);assert.equal(c.placedBlocks,0);
 c.layout.placements[0].rect.y=999;c.layout.placements[1].occupiedRect.height=999;
 a.layout.placements[0].id='mutated';
 const d=inc(i,c.snapshot);
 assert.deepEqual(d.layout,full(i));assert.equal(d.sharedSnapshotPlacements,2);
 assert.notEqual(d.layout.placements[0],a.layout.placements[0]);
});
test('equivalent constraints reuse geometry but invalid maxima still fail validation',()=>{
 const i=input([b('a',20,{sizeConstraints:{minHeight:30}}),b('b')]),a=inc(i);
 const n=input([b('a',20,{sizeConstraints:{minHeightPercent:30,maxHeight:50}}),b('b')]);
 const r=inc(n,a.snapshot);assert.deepEqual(r.layout,full(n));assert.equal(r.reusedBlocks,2);
 const bad=input([b('a',20,{sizeConstraints:{minHeightPercent:30,maxHeight:29}}),b('b')]);
 const c=inc(bad,r.snapshot);assert.deepEqual(c.layout,full(bad));assert.equal(c.snapshot,undefined);
});
test('same occupied height with different trailing space cannot reuse row sharing',()=>{
 const i=input([b('a',20,{sideBySide:true,sizeConstraints:{minHeight:30}}),b('b',20,{sideBySide:true})]),a=inc(i);
 const n=input([b('a',20,{sideBySide:true,spaceAfter:10}),b('b',20,{sideBySide:true})]);
 const r=inc(n,a.snapshot);assert.deepEqual(r.layout,full(n));assert.equal(r.placedBlocks,2);
 assert.equal(r.layout.placements[1].rect.y,30);
});
test('local edit shares prefix and converged suffix values only',async()=>{
 const i=input([b('a'),b('b'),b('c',20,{startNewPage:true}),b('d'),b('e')]),a=inc(i);
 const n=input([b('a'),b('b',30),b('c',20,{startNewPage:true}),b('d'),b('e')]);
 const r=await coop(n,a.snapshot,()=>{});
 assert.deepEqual(r.layout,full(n));assert.equal(r.sharedSnapshotPlacements,3);assert.equal(r.reusedBlocks,3);
 r.layout.placements[4].rect.y=1234;
 assert.deepEqual(inc(n,r.snapshot).layout,full(n));assert.deepEqual(inc(i,a.snapshot).layout,full(i));
});
test('normalized keys retain exact fixed coordinates, ID boundaries, and row flags',()=>{
 const i=input([b('a|b',20,{fixed:{page:0,x:0,y:0}}),b('c')]),a=inc(i);
 for(const n of [input([b('a|b',20,{fixed:{page:0,x:1,y:0}}),b('c')]),input([b('a',20,{fixed:{page:0,x:0,y:0}}),b('b|c')]),input([b('a|b',20,{fixed:{page:0,x:0,y:0}}),b('c',20,{startNewPage:true})])]){
  assert.deepEqual(inc(n,a.snapshot).layout,full(n));
 }
});
