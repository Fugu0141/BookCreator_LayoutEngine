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
 assert.deepEqual(inc.layout,plain);assert.deepEqual(coop.layout,plain);assert.equal(inc.fullRecompute,false);assert.ok(inc.snapshot);assert.equal(inc.placedBlocks,4);
 const warm=incremental(i,inc.snapshot);assert.deepEqual(warm.layout,plain);assert.equal(warm.reusedBlocks,4);assert.equal(warm.placedBlocks,0);
 assert.deepEqual(plan(i,{}).placements,plain.placements);
 await assert.rejects(cooperative(i,undefined,s=>{if(s==='il-place')throw Error('cancel');}),/cancel/);
});

const rows=(id,width,height,extra={})=>group(id,width,height,{keepTogetherLayout:'rows',sideBySide:true,...extra});
test('row group fits beside neighbors within same page and respects occupied dimensions',()=>{
 const i=input([b('prior',20,55),rows('figure',20,20,{sizeConstraints:{minWidth:40}}),rows('caption',45,30),b('after',20,10)]);
 const r=plan(i);assert.equal(r.status,'placed');
 assert.deepEqual(r.placements.map(p=>[p.id,p.page,p.rect.x,p.rect.y]),[['prior',0,0,0],['figure',0,0,60],['caption',0,45,60],['after',1,0,0]]);
 assert.deepEqual(r.placements[1].occupiedRect,{x:0,y:60,width:40,height:20});
 assert.equal(plan({...i,blocks:i.blocks.map(b=>b.keepTogetherGroup?{...b,keepTogetherLayout:'vertical',sideBySide:false}:b)}).placements[1].page,1);
});
test('mixed group wraps by occupied width and preserves explicit vertical spaces',()=>{
 const r=plan(input([rows('a',40,20),rows('b',50,30),rows('c',60,10),rows('d',20,10,{spaceBefore:3,spaceAfter:4}),rows('e',20,10)]));
 assert.equal(r.status,'placed');assert.deepEqual(r.placements.map(p=>[p.rect.x,p.rect.y]),[[0,0],[45,0],[0,35],[0,53],[0,72]]);
 assert.deepEqual(r.placements[3].occupiedRect,{x:0,y:53,width:20,height:14});
});
test('row groups remain indivisible and reserve their complete enclosing rectangle',async()=>{
 const i=input([b('prior',20,65),rows('a',40,20),rows('b',40,20),rows('c',40,10)],{reservedRegions:[{id:'reserved',page:1,rect:{x:0,y:0,width:100,height:10}}]});
 const r=plan(i);assert.equal(r.status,'placed');assert.deepEqual(r.placements.map(p=>[p.page,p.rect.x,p.rect.y]),[[0,0,0],[1,0,10],[1,45,10],[1,0,35]]);
 assert.deepEqual((await cooperative(i,undefined,()=>{})).layout,r);assert.deepEqual(plan(i,{}).placements,r.placements);
 for(const blocks of [[rows('a',20,20),group('b',20,20)],[b('a',20,20,{keepTogetherLayout:'rows'})],[rows('a',20,20,{keepTogetherLayout:'other'}),rows('b',20,20)]]){
  const bad=plan(input(blocks));assert.equal(bad.status,'conflict');assert.equal(bad.diagnostic.code,'IL_INVALID');assert.deepEqual(bad.placements,[]);
 }
});

const adaptive=(id,width,height,extra={})=>rows(id,width,height,{keepTogetherLayout:'adaptiveRows',...extra});
test('adaptive group chooses a narrower intact envelope beside a reserved region',()=>{
 const blocks=Array.from({length:4},(_,i)=>adaptive('m'+i,25,20));
 const i=input(blocks,{reservedRegions:[{id:'side',page:0,rect:{x:55,y:0,width:45,height:100}}]});
 const r=plan(i);assert.equal(r.status,'placed');
 assert.deepEqual(r.placements.map(p=>[p.page,p.rect.x,p.rect.y]),[[0,0,0],[0,30,0],[0,0,25],[0,30,25]]);
 const fixedRows=plan({...i,blocks:blocks.map(b=>({...b,keepTogetherLayout:'rows'}))});
 assert.equal(fixedRows.status,'placed');assert.equal(fixedRows.placements[0].page,1);
 assert.deepEqual(plan(i),r);
});
test('adaptive candidates minimize occupied bottom without dropping spacing or permissions',async()=>{
 const i=input([adaptive('a',25,20,{sizeConstraints:{minWidth:30}}),adaptive('b',25,20),adaptive('c',25,10,{spaceBefore:3,spaceAfter:4}),adaptive('d',25,10,{sideBySide:false}),b('next',10,10)]);
 const r=plan(i);assert.equal(r.status,'placed');assert.deepEqual(r.placements.map(p=>[p.rect.x,p.rect.y]),[[0,0],[35,0],[0,28],[0,47],[0,62]]);
 assert.deepEqual(r.placements[0].occupiedRect,{x:0,y:0,width:30,height:20});
 assert.deepEqual(r.placements[2].occupiedRect,{x:0,y:28,width:25,height:14});
 assert.deepEqual((await cooperative(i,undefined,()=>{})).layout,r);assert.deepEqual(plan(i,{}).placements,r.placements);
});
test('adaptive group cannot move fixed blocks or silently split an oversized group',()=>{
 const blocks=[adaptive('a',50,60),adaptive('b',50,60)];
 const bad=plan(input(blocks));assert.equal(bad.status,'conflict');assert.equal(bad.diagnostic.code,'IL_TOO_LARGE');assert.deepEqual(bad.placements,[]);
 const i=input([adaptive('a',25,20),adaptive('b',25,20),b('pin',20,20,{fixed:{page:0,x:0,y:15}})]);
 const conflict=plan(i);assert.equal(conflict.status,'conflict');assert.equal(conflict.diagnostic.code,'IL_FIXED_CONFLICT');assert.deepEqual(conflict.placements,[]);
});

test('editing last group member invalidates entire group, not unaffected prefix or suffix',async()=>{
 const make=(w,layout='adaptiveRows')=>input([b('prior',20,10),...['a','b','c'].map((id,j)=>group(id,j===2?w:25,20,{keepTogetherLayout:layout,sideBySide:true})),b('break',20,10,{startNewPage:true}),b('after',20,10),b('end',20,10)]);
 const start=make(25),seed=incremental(start);
 const next=make(50),r=incremental(next,seed.snapshot);
 assert.deepEqual(r.layout,plan(next));assert.ok(r.snapshot);
 assert.equal(r.reusedBlocks,3);assert.equal(r.reusedSuffixBlocks,2);assert.equal(r.placedBlocks,4);
 const rows=make(50,'rows'),s=incremental(rows,r.snapshot);
 assert.deepEqual(s.layout,plan(rows));assert.ok(s.snapshot);
 assert.ok(s.reusedBlocks>=1);assert.ok(s.placedBlocks>=3);
 const warm=await cooperative(rows,s.snapshot,()=>{});
 assert.deepEqual(warm.layout,plan(rows));assert.equal(warm.reusedBlocks,7);
});
test('group membership extension, shrink, creation and dissolution are atomic',()=>{
 const start=input([b('before',20,10),adaptive('a',25,20),adaptive('b',25,20),b('c',25,20),b('after',20,10,{startNewPage:true}),b('tail',20,10)]);
 const extended={...start,blocks:start.blocks.map(v=>v.id==='c'?adaptive('c',25,20):v)};
 const seed=incremental(start),r=incremental(extended,seed.snapshot);
 assert.deepEqual(r.layout,plan(extended));assert.ok(r.snapshot);assert.ok(r.placedBlocks>=3);
 const shrunk=incremental(start,r.snapshot);assert.deepEqual(shrunk.layout,plan(start));assert.ok(shrunk.snapshot);
 const dissolved={...start,blocks:start.blocks.map(v=>{const {keepTogetherGroup,keepTogetherLayout,...rest}=v;return rest;})};
 const d=incremental(dissolved,shrunk.snapshot);assert.deepEqual(d.layout,plan(dissolved));
 assert.deepEqual(incremental(start,d.snapshot).layout,plan(start));
 const inserted={...extended,blocks:[...extended.blocks.slice(0,3),adaptive('new',25,20),...extended.blocks.slice(3)]};
 const i=incremental(inserted,r.snapshot);assert.deepEqual(i.layout,plan(inserted));
 assert.deepEqual(incremental(extended,i.snapshot).layout,plan(extended));
});
test('group snapshots retain no caller-owned geometry and survive conflicts and cancellation',async()=>{
 const start=input([b('before',20,10),adaptive('a',25,20),adaptive('b',25,20),b('tail',20,10)]);
 const seed=incremental(start);seed.layout.placements[1].rect.x=999;
 const bad={...start,blocks:start.blocks.map(v=>v.keepTogetherGroup?{...v,size:{width:100,height:80}}:v)};
 const failed=incremental(bad,seed.snapshot);
 assert.deepEqual(failed.layout,plan(bad));assert.equal(failed.snapshot,undefined);
 const changed={...start,blocks:start.blocks.map(v=>v.id==='b'?{...v,size:{width:40,height:20}}:v)};
 await assert.rejects(cooperative(changed,seed.snapshot,s=>{if(s==='il-place')throw Error('cancel group');}),/cancel group/);
 const warm=incremental(start,seed.snapshot);
 assert.deepEqual(warm.layout,plan(start));assert.equal(warm.reusedBlocks,4);
});
test('long mixed book reuses at least 800 placements during group edits',()=>{
 const blocks=Array.from({length:1000},(_,i)=>b('m'+i,25,10,{startNewPage:i%8===0}));
 const make=w=>input(blocks.map((v,i)=>i>=800&&i<804?adaptive(v.id,i===803?w:25,10,{startNewPage:i===800}):v));
 let seed=incremental(make(25));
 for(let i=0;i<12;i++){
  const next=make(25+i*3),r=incremental(next,seed.snapshot);
  assert.deepEqual(r.layout,plan(next));assert.ok(r.snapshot);assert.ok(r.reusedBlocks>=800);assert.ok(r.placedBlocks<=200);
  seed=r;
 }
});
