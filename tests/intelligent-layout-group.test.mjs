import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as plan,planIntelligentLayoutIncremental as incremental,planIntelligentLayoutIncrementalCooperative as cooperative} from '../dist/index.js';
const b=(id,width,height,extra={})=>({id,size:{width,height},...extra});
const group=(id,width,height,extra={})=>b(id,width,height,{keepTogetherGroup:'example',...extra});
const input=(blocks,extra={})=>({revision:'group-r',content:{width:100,height:100},gap:5,blocks,...extra});
test('group moves as one unit and preserves member geometry and explicit spacing',()=>{
 const i=input([b('prior',20,60),group('example',20,20,{spaceBefore:5,spaceAfter:5,sizeConstraints:{minWidth:40}}),group('solution',30,20,{spaceBefore:3,spaceAfter:4}),b('next',20,10)]);
 const r=plan(i);assert.equal(r.status,'placed');
 assert.deepEqual(r.placements.map(p=>[p.id,p.page,p.rect.x,p.rect.y]),[['prior',0,0,0],['example',1,0,5],['solution',1,0,38],['next',1,0,67]]);
 assert.deepEqual(r.placements[1].occupiedRect,{x:0,y:5,width:40,height:25});
 assert.deepEqual(r.placements[2].occupiedRect,{x:0,y:38,width:30,height:24});
 assert.deepEqual(r.placements[1].rect,{x:0,y:5,width:20,height:20});
});
test('group envelope avoids reservations and preserves explicit leading break',()=>{
 const i=input([b('prior',20,10),group('a',20,20,{startNewPage:true}),group('b',30,20)],{reservedRegions:[{id:'r',page:1,rect:{x:0,y:0,width:60,height:100}}]});
 const r=plan(i);assert.equal(r.status,'placed');assert.deepEqual(r.placements.map(p=>[p.page,p.rect.x,p.rect.y]),[[0,0,0],[1,60,0],[1,60,25]]);
});
test('invalid or impossible groups fail atomically, no silent ungrouping',()=>{
 const cases=[
 [[group('a',20,20)],'IL_INVALID'],
 [[group('a',20,20),group('b',20,20),b('between',20,20),group('c',20,20),group('d',20,20)],'IL_INVALID'],
 [[group('a',20,20),group('b',20,20,{startNewPage:true})],'IL_INVALID'],
 [[group('a',20,20,{fixed:{page:0,x:0,y:0}}),group('b',20,20)],'IL_INVALID'],
 [[group('a',20,20,{sideBySide:true}),group('b',20,20)],'IL_INVALID'],
 [[group('a',20,50),group('b',20,50)],'IL_TOO_LARGE'],
 [[group('a',20,40),group('b',20,40),b('pin',20,10,{fixed:{page:0,x:0,y:70}})],'IL_FIXED_CONFLICT']
 ];
 for(const [blocks,code] of cases){const r=plan(input(blocks));assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,code);assert.deepEqual(r.placements,[]);}
});
test('groups preserve parity on synchronous, incremental, cooperative and optimized paths',async()=>{
 const i=input([b('prior',20,65),group('a',30,20),group('b',20,20),b('after',20,15)]);
 const plain=plan(i),inc=incremental(i),coop=await cooperative(i,undefined,()=>{});
 assert.deepEqual(inc.layout,plain);assert.deepEqual(coop.layout,plain);assert.equal(inc.fullRecompute,true);assert.equal(inc.snapshot,undefined);
 assert.deepEqual(plan(i,{}).placements,plain.placements);
 await assert.rejects(cooperative(i,undefined,s=>{if(s==='il-place')throw Error('cancel');}),/cancel/);
});
