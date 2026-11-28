import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as plan,planIntelligentLayoutIncremental as incremental,planIntelligentLayoutIncrementalCooperative as cooperative} from '../dist/index.js';
const b=(id,width,height,extra={})=>({id,size:{width,height},...extra});
const pair=(id,w,h)=>b(id,w,h,{sideBySide:true});
const input=(blocks,extra={})=>({revision:'r5',content:{width:100,height:100},gap:5,blocks,...extra});
const sample=()=>[pair('a',60,10),pair('b',30,40),pair('c',60,40)];
test('lookahead compares legal complete plans and reduces page count',()=>{
 const i=input(sample(),{content:{width:100,height:65}}),before=JSON.stringify(i);
 const greedy=plan(i),r=plan(i,{});
 assert.equal(greedy.placements[2].page,1);
 assert.equal(r.status,'placed');assert.equal(r.optimization.selected,'lookahead');
 assert.equal(r.optimization.score.pageCount,1);
 assert.deepEqual(r.placements.map(p=>[p.id,p.page,p.rect.x,p.rect.y]),[['a',0,0,0],['b',0,0,15],['c',0,35,15]]);
 assert.equal(JSON.stringify(i),before);assert.deepEqual(plan(i,{}),r);
});
test('alternate grouping can rescue an otherwise conflicting fixed block without moving it',()=>{
 const i=input([...sample(),b('pin',20,20,{fixed:{page:0,x:70,y:60}})]);
 assert.equal(plan(i).status,'conflict');
 const r=plan(i,{});
 assert.equal(r.status,'placed');assert.equal(r.optimization.feasibleCandidates,1);
 assert.deepEqual(r.placements.at(-1).rect,{x:70,y:60,width:20,height:20});
});
test('stability hints choose the previous grouping when page count and preferences tie',()=>{
 const i=input(sample()),old=plan(i);
 const compact=plan(i,{});
 assert.equal(compact.optimization.selected,'lookahead');assert.equal(compact.optimization.score.occupiedDepth,55);
 const previousPositions=old.placements.map(p=>({id:p.id,page:p.page,x:p.rect.x,y:p.rect.y}));
 const stable=plan(i,{previousPositions});
 assert.equal(stable.optimization.selected,'greedy');assert.equal(stable.optimization.score.previousPositionDistance,0);
 assert.deepEqual(stable.placements,old.placements);
});
test('honoring explicit preference outranks soft compactness, fixed intent still wins',()=>{
 const i=input([b('a',20,20,{preferred:{page:0,x:0,y:70}}),b('b',20,20)]);
 const r=plan(i,{});
 assert.equal(r.status,'placed');assert.equal(r.optimization.evaluatedCandidates,4);
 assert.equal(r.optimization.score.honoredPreferences,1);assert.equal(r.optimization.score.pageCount,2);
 const fixed=plan(input([i.blocks[0],b('pin',20,20,{fixed:{page:0,x:0,y:30}})]),{});
 assert.equal(fixed.status,'placed');assert.equal(fixed.placements[0].preference,'fallback');
 assert.equal(fixed.placements[1].rect.y,30);
});
test('no alternate relaxes exclusions, fixed sizes, explicit breaks or whitespace',()=>{
 const regions=[{id:'space',page:0,rect:{x:50,y:0,width:50,height:30}}];
 const i=input([pair('a',20,20),b('b',20,20,{sideBySide:true,spaceAfter:10,sizeConstraints:{minWidth:30}}),
 b('c',20,20,{startNewPage:true,spaceBefore:10}),b('pin',10,10,{fixed:{page:1,x:80,y:60}})],{reservedRegions:regions});
 const r=plan(i,{});
 assert.equal(r.status,'placed');assert.deepEqual(r.placements,plan(i).placements);
 assert.deepEqual(r.placements[1].occupiedRect,{x:0,y:25,width:30,height:30});
 assert.equal(r.placements[2].page,1);assert.equal(r.placements[2].rect.y,10);
 const bad=plan(input([b('pin',20,20,{fixed:{page:0,x:60,y:0}})],{reservedRegions:regions}),{});
 assert.equal(bad.status,'conflict');assert.equal(bad.diagnostic.code,'IL_RESERVED_CONFLICT');assert.deepEqual(bad.placements,[]);
});
test('all impossible candidates stay atomic; invalid hints fail closed',()=>{
 const bad=plan(input([...sample(),b('pin',20,20,{fixed:{page:0,x:0,y:20}})]),{});
 assert.equal(bad.status,'conflict');assert.deepEqual(bad.placements,[]);
 for(const options of [null,[],{previousPositions:null},{previousPositions:[{id:'a',page:0,x:-1,y:0}]},{previousPositions:[{id:'a',page:0,x:0,y:0},{id:'a',page:0,x:0,y:0}]}]){
  const r=plan(input(sample()),options);assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_INVALID');
 }
});
test('default remains opt-in and ties preserve greedy order',()=>{
 const i=input([b('a',20,20),b('b',20,20)]);
 const old=plan(i),r=plan(i,{});
 assert.equal(old.optimization,undefined);assert.equal(r.optimization.selected,'greedy');
 assert.deepEqual(r.placements,old.placements);
});

test('selective fallback preserves independent wishes before and after a fixed conflict',async()=>{
 const i=input([b('earlier',20,20,{preferred:{page:0,x:10,y:5}}),
   b('conflicting',20,20,{preferred:{page:0,x:0,y:70}}),
   b('pin',20,20,{fixed:{page:0,x:0,y:60}}),
   b('later',20,20,{startNewPage:true,preferred:{page:1,x:40,y:20}})]);
 const original=JSON.stringify(i),old=plan(i,{}),options={selectivePreferenceFallback:true};
 const r=plan(i,options);
 assert.equal(old.status,'placed');assert.equal(old.optimization.score.honoredPreferences,0);
 assert.equal(r.status,'placed');assert.equal(r.optimization.selected,'greedy-selective');
 assert.equal(r.optimization.evaluatedCandidates,6);assert.equal(r.optimization.score.honoredPreferences,2);
 assert.deepEqual(r.placements.map(p=>[p.id,p.page,p.rect.x,p.rect.y,p.preference]),[
   ['earlier',0,10,5,'honored'],['conflicting',0,0,30,'fallback'],
   ['pin',0,0,60,undefined],['later',1,40,20,'honored']]);
 assert.equal(JSON.stringify(i),original);
 assert.deepEqual(plan(i,{selectivePreferenceFallback:false}).placements,old.placements);
 assert.deepEqual(incremental(i,undefined,options).layout,r);
 assert.deepEqual((await cooperative(i,undefined,()=>{},options)).layout,r);
});
test('bounded selective retry retains hard-only fallback and rejects invalid flags',()=>{
 const i=input([b('a',20,20,{preferred:{page:0,x:0,y:60}}),b('b',20,20,{preferred:{page:0,x:0,y:90}}),b('pin',20,20,{fixed:{page:0,x:0,y:60}})]);
 const r=plan(i,{selectivePreferenceFallback:true}),old=plan(i,{});
 assert.equal(r.status,'placed');assert.deepEqual(r.placements,old.placements);
 assert.ok(r.optimization.evaluatedCandidates<=6);
 const impossible=input([b('a',20,30,{preferred:{page:0,x:0,y:70}}),b('pin',20,20,{fixed:{page:0,x:0,y:10}})]);
 const bad=plan(impossible,{selectivePreferenceFallback:true});assert.equal(bad.status,'conflict');assert.deepEqual(bad.placements,[]);
 assert.equal(plan(i,{selectivePreferenceFallback:'yes'}).diagnostic.code,'IL_INVALID');
});

test('obstacle-aware lookahead reduces pages while preserving the reserved region',async()=>{
 const regions=[{id:'right',page:0,rect:{x:95,y:0,width:5,height:65}}];
 const i=input(sample(),{content:{width:100,height:65},reservedRegions:regions});
 const greedy=plan(i),r=plan(i,{});
 assert.equal(greedy.placements[2].page,1);
 assert.equal(r.status,'placed');assert.equal(r.optimization.selected,'lookahead');
 assert.equal(r.optimization.score.pageCount,1);
 assert.deepEqual(r.placements.map(p=>[p.id,p.page,p.rect.x,p.rect.y]),[['a',0,0,0],['b',0,0,15],['c',0,35,15]]);
 assert.deepEqual(incremental(i,undefined,{}).layout,r);
 assert.deepEqual((await cooperative(i,undefined,()=>{},{})).layout,r);
});
test('obstacle-aware candidate cannot ignore fixed placement, explicit gaps or row permissions',()=>{
 const regions=[{id:'right',page:0,rect:{x:95,y:0,width:5,height:100}}];
 const i=input([...sample(),b('pin',20,20,{fixed:{page:0,x:0,y:60}})],{reservedRegions:regions});
 const r=plan(i,{});
 assert.equal(r.status,'placed');assert.equal(r.placements.at(-1).fixed,true);
 assert.deepEqual(r.placements.at(-1).rect,{x:0,y:60,width:20,height:20});
 for(const extra of [{spaceBefore:5},{spaceAfter:5},{sideBySide:false},{startNewPage:true}]){
  const blocks=sample();blocks[2]={...blocks[2],...extra};
  const j=input(blocks,{reservedRegions:regions});
  assert.deepEqual(plan(j,{}).placements,plan(j).placements);
 }
});
test('obstacle-aware lookahead keeps feasible greedy geometry when a fresh shared row is blocked',()=>{
 const regions=[{id:'right',page:0,rect:{x:95,y:0,width:5,height:100}},{id:'middle',page:0,rect:{x:35,y:45,width:25,height:30}}];
 const i=input(sample(),{reservedRegions:regions});
 const r=plan(i,{}),greedy=plan(i);
 assert.equal(r.status,'placed');assert.deepEqual(r.placements,greedy.placements);
});
