import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as plan} from '../dist/index.js';
const b=(id,width,height,extra={})=>({id,size:{width,height},...extra});
const run=(blocks,content={width:100,height:100},reservedRegions=[])=>plan({revision:'r4',content,gap:5,blocks,reservedRegions});
test('width and height occupancy preserve measured content, reserve right and bottom',()=>{
 const blocks=[b('a',20,10,{sizeConstraints:{minWidthPercent:60,minHeightPercent:30},sideBySide:true}),b('b',35,20,{sideBySide:true}),b('c',20,10)];
 const original=JSON.stringify(blocks),r=run(blocks);
 assert.equal(r.status,'placed');
 assert.deepEqual(r.placements[0].rect,{x:0,y:0,width:20,height:10});
 assert.deepEqual(r.placements[0].occupiedRect,{x:0,y:0,width:60,height:30});
 assert.deepEqual(r.placements.slice(1).map(p=>[p.rect.x,p.rect.y]),[[65,0],[0,35]]);
 assert.equal(JSON.stringify(blocks),original);
});
test('percentage rounds upwards and responds to content dimensions',()=>{
 const blocks=[b('a',1,1,{sizeConstraints:{minWidthPercent:33,minHeightPercent:50}})];
 assert.deepEqual(run(blocks,{width:101,height:101}).placements[0].occupiedRect,{x:0,y:0,width:34,height:51});
 assert.deepEqual(run(blocks,{width:200,height:80}).placements[0].occupiedRect,{x:0,y:0,width:66,height:40});
});
test('physical and relative minimum combine without shrinking content',()=>{
 const r=run([b('a',70,40,{sizeConstraints:{minWidth:80,minWidthPercent:60,minHeightPercent:20,maxHeight:40}})]);
 assert.equal(r.status,'placed');assert.deepEqual(r.placements[0].occupiedRect,{x:0,y:0,width:80,height:40});
});
test('maximum and conflicting minima fail atomically rather than scale',()=>{
 for(const sizeConstraints of [{maxWidth:19},{minHeight:60,maxHeight:50},{minWidthPercent:80,maxWidth:79}]){
  const r=run([b('ok',10,10),b('bad',20,20,{sizeConstraints})]);
  assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_SIZE_CONFLICT');assert.equal(r.diagnostic.blockId,'bad');assert.deepEqual(r.placements,[]);
 }
});
test('fixed size cannot be enlarged by minimum, explicit trailing space does not change content',()=>{
 const fixed={page:0,x:20,y:10};
 const bad=run([b('pin',20,20,{fixed,sizeConstraints:{minWidthPercent:30}})]);
 assert.equal(bad.status,'conflict');assert.equal(bad.diagnostic.code,'IL_SIZE_CONFLICT');
 const ok=run([b('pin',20,20,{fixed,sizeConstraints:{minWidth:20,maxWidth:20},spaceAfter:10}),b('b',20,10)]);
 assert.equal(ok.status,'placed');assert.deepEqual(ok.placements[0].rect,{x:20,y:10,width:20,height:20});
 assert.deepEqual(ok.placements[0].occupiedRect,{x:20,y:10,width:20,height:30});assert.equal(ok.placements[1].rect.y,45);
});
test('trailing space closes row, respects pagination and never fills reserved footprint',()=>{
 const r=run([b('a',20,20,{sideBySide:true}),b('b',20,20,{sideBySide:true,spaceAfter:30}),b('c',20,25,{sideBySide:true})]);
 assert.equal(r.status,'placed');assert.deepEqual(r.placements.map(p=>[p.page,p.rect.x,p.rect.y]),[[0,0,0],[0,0,25],[1,0,0]]);
 const too=run([b('a',20,90,{spaceAfter:11})]);assert.equal(too.diagnostic.code,'IL_TOO_LARGE');
});
test('reserved collision considers occupied footprint, including soft and fixed placement',()=>{
 const regions=[{id:'empty',page:0,rect:{x:40,y:0,width:60,height:40}}];
 const r=run([b('a',20,20,{sizeConstraints:{minWidthPercent:60},preferred:{page:0,x:0,y:0}})],undefined,regions);
 assert.equal(r.status,'placed');assert.equal(r.placements[0].rect.y,40);assert.equal(r.placements[0].preference,'fallback');
 const bad=run([b('pin',20,20,{fixed:{page:0,x:50,y:0}})],undefined,regions);assert.equal(bad.diagnostic.code,'IL_RESERVED_CONFLICT');
});
test('bad constraints and spacing are invalid, old output shape is preserved',()=>{
 for(const extra of [{sizeConstraints:null},{sizeConstraints:[]},{sizeConstraints:{minWidth:0}},{sizeConstraints:{minHeightPercent:101}},{sizeConstraints:{minWidthPercent:1.5}},{spaceAfter:-1}]){
  const r=run([b('a',20,20,extra)]);assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_INVALID');
 }
 assert.deepEqual(run([b('a',20,20)]).placements,[{id:'a',page:0,rect:{x:0,y:0,width:20,height:20},fixed:false}]);
});
