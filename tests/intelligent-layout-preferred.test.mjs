import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as plan} from '../dist/index.js';
const b=(id,width,height,extra={})=>({id,size:{width,height},...extra});
const p=(page,x,y)=>({page,x,y});
const run=blocks=>plan({revision:'r2',content:{width:100,height:100},gap:5,blocks});
test('preferred position preserves size and whitespace',()=>{
 const blocks=[b('a',20,20),b('b',30,20,{mode:'preferred',preferred:p(0,50,40)}),b('c',20,10)];
 const before=JSON.stringify(blocks),r=run(blocks);
 assert.equal(r.status,'placed');
 assert.deepEqual(r.placements[1],{id:'b',page:0,rect:{x:50,y:40,width:30,height:20},fixed:false,preference:'honored'});
 assert.equal(r.placements[2].rect.y,65);
 assert.equal(JSON.stringify(blocks),before);assert.deepEqual(run(blocks),r);
});
test('impossible targets fall back without extra blank pages',()=>{
 for(const preferred of [p(3,0,0),p(0,95,0),p(0,0,10)]){
  const r=run([b('a',20,20),b('b',20,20,{preferred})]);
  assert.equal(r.status,'placed');assert.equal(r.placements[1].preference,'fallback');
  assert.deepEqual(r.placements[1].rect,{x:0,y:25,width:20,height:20});
 }
});
test('later fixed intent wins over earlier soft target',()=>{
 const r=run([b('a',20,20,{preferred:p(0,0,70)}),b('pin',20,20,{mode:'fixed',fixed:p(0,0,30)})]);
 assert.equal(r.status,'placed');assert.equal(r.placements[0].preference,'fallback');
 assert.equal(r.placements[1].rect.y,30);assert.equal(r.placements[1].fixed,true);
});
test('unresolvable hard conflict remains atomic',()=>{
 const r=run([b('a',20,60,{preferred:p(0,0,0)}),b('pin',20,20,{fixed:p(0,0,30)})]);
 assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_FIXED_CONFLICT');
 assert.deepEqual(r.placements,[]);
});
test('natural page transition, explicit breaks and reserved spacing',()=>{
 const r=run([b('a',20,90),b('b',20,20,{spaceBefore:10,preferred:p(1,30,20)}),b('c',20,20,{startNewPage:true,preferred:p(1,30,60)})]);
 assert.equal(r.status,'placed');
 assert.deepEqual(r.placements.map(v=>[v.page,v.rect.y,v.preference]),[[0,0,undefined],[1,20,'honored'],[2,0,'fallback']]);
 const space=run([b('a',20,20,{spaceBefore:10,preferred:p(0,0,0)})]);
 assert.equal(space.placements[0].rect.y,10);assert.equal(space.placements[0].preference,'fallback');
});
test('contradictory and malformed modes fail; legacy output shape remains',()=>{
 for(const extra of [{mode:'fixed'},{mode:'preferred'},{mode:'auto',fixed:p(0,0,0)},{mode:'fixed',fixed:p(0,0,0),preferred:p(0,0,0)},{mode:'other'},{mode:null},{preferred:p(0,-1,0)}]){
  const r=run([b('a',20,20,extra)]);assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_INVALID');
 }
 assert.deepEqual(run([b('a',20,20)]).placements,[{id:'a',page:0,rect:{x:0,y:0,width:20,height:20},fixed:false}]);
});

test('explicit preference tolerance selects nearest feasible same-page origin',()=>{
 const r=run([b('a',20,20),b('b',30,20,{preferred:p(0,90,20),preferredTolerance:{x:25,y:10}})]);
 assert.equal(r.status,'placed');assert.deepEqual(r.placements[1].rect,{x:70,y:25,width:30,height:20});assert.equal(r.placements[1].preference,'honored');
 const strict=run([b('a',20,20),b('b',30,20,{preferred:p(0,90,20),preferredTolerance:{x:19,y:10}})]);
 assert.equal(strict.placements[1].preference,'fallback');assert.equal(strict.placements[1].rect.x,0);
 const page=run([b('a',20,20,{preferred:p(2,0,0),preferredTolerance:{x:100,y:100}})]);
 assert.equal(page.placements[0].page,0);assert.equal(page.placements[0].preference,'fallback');
});
test('tolerance respects reserved rectangles and chooses deterministic nearest edge',()=>{
 const input={revision:'tol',content:{width:100,height:100},gap:0,blocks:[b('a',20,20,{preferred:p(0,40,40),preferredTolerance:{x:30,y:30}})],reservedRegions:[{id:'obstacle',page:0,rect:{x:40,y:40,width:20,height:20}}]};
 const r=plan(input);assert.equal(r.status,'placed');assert.deepEqual(r.placements[0].rect,{x:40,y:20,width:20,height:20});assert.equal(r.placements[0].preference,'honored');assert.deepEqual(plan(input),r);
});
test('preference tolerance cannot override a subsequent fixed position',()=>{
 const r=run([b('a',20,20,{preferred:p(0,0,70),preferredTolerance:{x:5,y:5}}),b('pin',20,20,{fixed:p(0,0,30)})]);
 assert.equal(r.status,'placed');assert.equal(r.placements[0].preference,'fallback');assert.equal(r.placements[1].rect.y,30);
 for(const extra of [{preferredTolerance:{x:1,y:1}},{preferred:p(0,0,0),preferredTolerance:{x:-1,y:0}},{preferred:p(0,0,0),preferredTolerance:{x:1}},{preferred:p(0,0,0),preferredTolerance:{x:1,y:1,page:1}}]){
  const bad=run([b('a',20,20,extra)]);assert.equal(bad.status,'conflict');assert.equal(bad.diagnostic.code,'IL_INVALID');
 }
});
