import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as plan} from '../dist/index.js';
const b=(id,width,height,extra={})=>({id,size:{width,height},...extra});
const region=(id,page,x,y,width,height)=>({id,page,rect:{x,y,width,height}});
const run=(blocks,reservedRegions)=>plan({revision:'r3',content:{width:100,height:100},gap:5,blocks,reservedRegions});
test('reserved whitespace is immutable and blocks fit beside it or below it',()=>{
 const blocks=[b('a',35,20),b('b',90,20)],regions=[region('space',0,0,0,60,40)];
 const before=JSON.stringify({blocks,regions}),r=run(blocks,regions);
 assert.equal(r.status,'placed');
 assert.deepEqual(r.placements.map(p=>p.rect),[{x:60,y:0,width:35,height:20},{x:0,y:40,width:90,height:20}]);
 assert.equal(JSON.stringify({blocks,regions}),before);
 assert.deepEqual(run(blocks,regions),r);
});
test('mutually opted-in row can skip obstacle but never move backwards',()=>{
 const r=run([b('a',20,20,{sideBySide:true}),b('b',25,20,{sideBySide:true}),b('c',20,20)], [region('spacer',0,25,0,40,25)]);
 assert.equal(r.status,'placed');
 assert.deepEqual(r.placements.map(p=>[p.rect.x,p.rect.y]),[[0,0],[65,0],[0,25]]);
});
test('full page exclusion and explicit page break keep order and spacing',()=>{
 const r=run([b('a',60,20,{spaceBefore:10}),b('b',60,20,{startNewPage:true})],[region('full',0,0,0,100,100),region('top',1,0,0,100,30)]);
 assert.equal(r.status,'placed');assert.deepEqual(r.placements.map(p=>[p.page,p.rect.y]),[[1,30],[2,0]]);
});
test('fixed intersection fails atomically and identifies region, edge contact is legal',()=>{
 const regions=[region('lock',0,20,20,40,40)];
 const r=run([b('a',20,10),b('pin',20,20,{fixed:{page:0,x:30,y:25}})],regions);
 assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_RESERVED_CONFLICT');
 assert.equal(r.diagnostic.blockId,'pin');assert.equal(r.diagnostic.regionId,'lock');assert.deepEqual(r.placements,[]);
 const ok=run([b('pin',20,20,{fixed:{page:0,x:60,y:20}})],regions);
 assert.equal(ok.status,'placed');assert.equal(ok.placements[0].rect.x,60);
});
test('soft target intersecting exclusion falls back; valid target is preserved',()=>{
 const regions=[region('keep',0,0,0,40,40)];
 const bad=run([b('a',20,20,{preferred:{page:0,x:10,y:10}})],regions);
 assert.equal(bad.status,'placed');assert.equal(bad.placements[0].preference,'fallback');assert.equal(bad.placements[0].rect.x,40);
 const ok=run([b('a',20,20,{preferred:{page:0,x:60,y:10}})],regions);
 assert.equal(ok.status,'placed');assert.equal(ok.placements[0].preference,'honored');
});
test('overlapping reservations are their union, independent of input order',()=>{
 const regions=[region('r1',0,0,0,50,30),region('r2',0,40,0,50,20)];
 const blocks=[b('a',30,10)];
 const r=run(blocks,regions);assert.equal(r.status,'placed');assert.deepEqual(r.placements[0].rect,{x:50,y:20,width:30,height:10});
 assert.deepEqual(run(blocks,[...regions].reverse()),r);
});
test('invalid reservations fail closed and per-page resource limits apply',()=>{
 for(const regions of [null,[region('r',0,-1,0,10,10)],[region('r',0,0,0,101,10)],[region('r',10000,0,0,10,10)],[region('r',0,0,0,10,10),region('r',1,0,0,10,10)]]){
  const r=run([b('a',20,20)],regions);assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_INVALID');
 }
 const limit=run([b('a',20,20)],Array.from({length:129},(_,i)=>region('r'+i,0,0,0,1,1)));
 assert.equal(limit.status,'conflict');assert.equal(limit.diagnostic.code,'IL_LIMIT');
});
test('fully reserved pages never cause infinite search',()=>{
 const r=run([b('a',20,20)],Array.from({length:10000},(_,i)=>region('r'+i,i,0,0,100,100)));
 assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_LIMIT');assert.deepEqual(r.placements,[]);
});
test('no reservations preserves legacy result',()=>{
 const blocks=[b('a',20,20,{sideBySide:true}),b('b',20,20,{sideBySide:true}),b('c',20,90)];
 assert.deepEqual(run(blocks,[]),run(blocks,undefined));
});
