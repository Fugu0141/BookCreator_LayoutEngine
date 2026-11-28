import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as plan} from '../dist/index.js';
const b=(id,width,height,extra={})=>({id,size:{width,height},...extra});
const run=(blocks)=>plan({revision:'r1',content:{width:100,height:100},gap:5,blocks});
test('opt-in neighbors share a row, default blocks preserve vertical flow',()=>{
 const blocks=[b('a',45,20,{sideBySide:true}),b('b',50,30,{sideBySide:true}),b('c',20,10)];
 const original=JSON.stringify(blocks);
 const result=run(blocks);
 assert.equal(result.status,'placed');
 assert.deepEqual(result.placements.map(p=>p.rect),[
 {x:0,y:0,width:45,height:20},{x:50,y:0,width:50,height:30},{x:0,y:35,width:20,height:10}]);
 assert.equal(JSON.stringify(blocks),original);
 assert.deepEqual(run(blocks),result);
});
test('fixed rectangle and intentional whitespace are preserved',()=>{
 const result=run([b('a',30,20,{spaceBefore:10}),b('b',30,20,{fixed:{page:0,x:60,y:65}}),b('c',30,20)]);
 assert.equal(result.status,'placed');
 assert.deepEqual(result.placements.map(p=>[p.page,p.rect.x,p.rect.y]),[[0,0,10],[0,60,65],[1,0,0]]);
 assert.equal(result.placements[1].fixed,true);
});
test('conflicting pin is never relocated and candidate is atomic',()=>{
 const result=run([b('a',100,70),b('pin',20,20,{fixed:{page:0,x:0,y:60}})]);
 assert.equal(result.status,'conflict');
 assert.equal(result.diagnostic.code,'IL_FIXED_CONFLICT');
 assert.equal(result.diagnostic.blockId,'pin');
 assert.deepEqual(result.placements,[]);
});
test('explicit page break cannot be overridden by fixed placement',()=>{
 const result=run([b('a',20,20),b('pin',20,20,{startNewPage:true,fixed:{page:0,x:0,y:50}})]);
 assert.equal(result.status,'conflict');
});
test('oversize, duplicate, invalid coordinate and excessive space fail closed',()=>{
 for(const blocks of [[b('x',101,20)],[b('x',20,20),b('x',20,20)],[b('x',20,20,{fixed:{page:0,x:-1,y:0}})],[b('x',20,20,{spaceBefore:90})]]){
  const result=run(blocks);assert.equal(result.status,'conflict');assert.deepEqual(result.placements,[]);
 }
});
test('only mutually opted-in neighbors share rows; page breaks retain order',()=>{
 const result=run([b('a',20,20,{sideBySide:true}),b('b',20,20),b('c',20,20,{sideBySide:true,startNewPage:true}),b('d',20,20,{sideBySide:true})]);
 assert.equal(result.status,'placed');
 assert.deepEqual(result.placements.map(p=>[p.id,p.page,p.rect.x,p.rect.y]),[['a',0,0,0],['b',0,0,25],['c',1,0,0],['d',1,25,0]]);
});
