import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout as plan,intelligentMeasuredId,paginateMeasured,planMeasuredIntelligentLayoutIncremental as incremental,planMeasuredIntelligentLayoutIncrementalCooperative as cooperative} from '../dist/index.js';
const origin=(blockKey,documentId='doc')=>({documentId,blockKey,revision:'source-r',range:{start:0,end:10}});
const b=(id,width,unitHeights,extra={})=>({kind:'block',origin:origin(id),width,unitHeights,splitPolicy:'strict',...extra});
const section=(blocks,startOn='continuous',id='s')=>({id,startOn,blocks});
const input=(sections,content={width:100,height:100})=>({schemaVersion:1,revision:'r6',fingerprint:'fp',content,sections});
const intent=(blockKey,placement,documentId='doc')=>({documentId,blockKey,placement});
test('default bridge matches existing measured geometry, unit ranges and origin',()=>{
 const i=input([section([b('a',100,[20,20,20]),b('b',100,[25,25,25,25],{splitPolicy:'allow',fragmentPadding:{top:5,bottom:5}})])]);
 const before=JSON.stringify(i),old=paginateMeasured(i),r=plan(i);
 assert.equal(r.status,'placed');
 assert.deepEqual(r.fragments.map(f=>[f.origin,f.unitStart,f.unitEnd,f.continuationIndex,f.placement.page,f.placement.rect]),old.pages.flatMap(p=>p.fragments.map(f=>[f.origin,f.unitStart,f.unitEnd,f.continuationIndex,p.index,f.rect])));
 assert.equal(r.revision,'r6');assert.equal(r.fingerprint,'fp');assert.equal(r.publicationReady,false);
 assert.equal(JSON.stringify(i),before);assert.notEqual(r.fragments[0].origin,i.sections[0].blocks[0].origin);
 assert.notEqual(r.fragments[0].origin.range,i.sections[0].blocks[0].origin.range);
 assert.deepEqual(plan(i),r);
});
test('strict measured blocks accept horizontal placement, size reservations and fixed intent',()=>{
 const i=input([section([b('a',30,[20]),b('b',30,[25]),b('pin',20,[20])])]);
 const r=plan(i,{gap:5,intents:[intent('a',{sideBySide:true,sizeConstraints:{minWidth:40}}),intent('b',{sideBySide:true}),intent('pin',{mode:'fixed',fixed:{page:0,x:60,y:50}})]});
 assert.equal(r.status,'placed');
 assert.deepEqual(r.fragments.map(f=>[f.origin.blockKey,f.placement.rect.x,f.placement.rect.y]),[['a',0,0],['b',45,0],['pin',60,50]]);
 assert.equal(r.fragments[0].placement.occupiedRect.width,40);
 assert.equal(r.fragments[0].placement.id,intelligentMeasuredId(origin('a')));
});
test('safe split ranges, repeated padding and avoid warning survive reflow',()=>{
 const i=input([section([b('a',50,[30,30,30,30],{splitPolicy:'avoid',fragmentPadding:{top:5,bottom:5}})])]);
 const r=plan(i,{reservedRegions:[{id:'space',page:0,rect:{x:0,y:0,width:50,height:100}}]});
 assert.equal(r.status,'placed');assert.equal(r.paginationDiagnostics[0].code,'PG_AVOID_SPLIT');
 assert.deepEqual(r.fragments.map(f=>[f.unitStart,f.unitEnd,f.continuationIndex,f.placement.page,f.placement.rect.x,f.placement.rect.height]),[[0,3,0,0,50,100],[3,4,1,1,0,40]]);
 assert.equal(r.fragments[0].placement.id,intelligentMeasuredId(origin('a'),{start:0,end:3}));
 assert.notEqual(r.fragments[0].placement.id,r.fragments[1].placement.id);
});
test('explicit, section and page-top boundaries survive; continuous first component suppressed',()=>{
 const i=input([section([b('a',20,[10]),{kind:'pagebreak',origin:origin('break')},b('b',20,[10])]),section([b('c',20,[10],{startPosition:'page-top',startPositionSource:'component'}),b('d',20,[10],{startPosition:'page-top',startPositionSource:'explicit'})],'continuous','s2'),section([b('e',20,[10])],'page','s3')]);
 const r=plan(i);
 assert.equal(r.status,'placed');assert.deepEqual(r.fragments.map(f=>[f.origin.blockKey,f.placement.page]),[['a',0],['b',1],['c',1],['d',2],['e',3]]);
});
test('split, absent or duplicate intent is rejected atomically',()=>{
 const i=input([section([b('a',50,[60,60],{splitPolicy:'allow'}),b('b',50,[20])])]);
 for(const intents of [[intent('a',{fixed:{page:0,x:0,y:0}})],[intent('absent',{})],[intent('b',{}),intent('b',{})],[intent('b',{startNewPage:'yes'})]]){
  const r=plan(i,{intents});assert.equal(r.status,'conflict');assert.equal(r.stage,'intent');assert.deepEqual(r.fragments,[]);
 }
});
test('same blockKey in distinct documents resolves unambiguously',()=>{
 const i=input([section([b('a',20,[10]),b('a',20,[10],{origin:origin('a','other')})])]);
 const r=plan(i,{intents:[intent('a',{fixed:{page:0,x:20,y:30}},'other')]});
 assert.equal(r.status,'placed');assert.equal(r.fragments[0].placement.fixed,false);assert.equal(r.fragments[1].placement.rect.x,20);
});
test('pagination and IL conflicts discard all fragments, preserve diagnostic stages',()=>{
 const bad=plan(input([section([b('ok',10,[20]),b('bad',10,[101])])]));
 assert.equal(bad.status,'conflict');assert.equal(bad.stage,'pagination');assert.equal(bad.paginationDiagnostics[0].code,'PG_TOO_LARGE');assert.deepEqual(bad.fragments,[]);
 const r=plan(input([section([b('a',20,[50]),b('pin',20,[20])])]),{intents:[intent('pin',{fixed:{page:0,x:0,y:10}})]});
 assert.equal(r.status,'conflict');assert.equal(r.stage,'layout');assert.equal(r.diagnostic.code,'IL_FIXED_CONFLICT');assert.deepEqual(r.fragments,[]);
});
test('optimization remains explicit and retains measured source association',()=>{
 const i=input([section([b('a',60,[10]),b('b',30,[40]),b('c',60,[40])])],{width:100,height:65});
 const r=plan(i,{gap:5,intents:['a','b','c'].map(id=>intent(id,{sideBySide:true})),optimization:{}});
 assert.equal(r.status,'placed');assert.equal(r.layout.optimization.selected,'lookahead');
 assert.deepEqual(r.fragments.map(f=>[f.origin.blockKey,f.placement.page,f.unitStart,f.unitEnd]),[['a',0,0,1],['b',0,0,1],['c',0,0,1]]);
});

test('transported unsupported intent fields fail closed on all measured paths',async()=>{
 const i=input([section([b('a',20,[10]),b('b',20,[10])])]);
 const first=incremental(i,{intents:[intent('a',{sizeConstraints:{minHeightPercent:50}})]});
 assert.equal(first.result.status,'placed');assert.ok(first.snapshot);
 const bad=[
  {intent:[intent('a',{spaceAfter:30})]},
  {intents:[{...intent('a',{}),persistentID:'a'}]},
  {intents:[intent('a',{spaceAfer:30})]},
  {intents:[intent('a',{sizeConstraints:{minHeightPercentage:50}})]},
  {intents:[intent('a',{fixed:{page:0,x:0,y:0,z:1}})]},
  {intents:[intent('a',{preferred:{page:0,x:0,y:0,tolerance:10}})]}
 ];
 for(const options of bad){
  const transported=JSON.parse(JSON.stringify(options));
  const cold=plan(i,transported),warm=incremental(i,transported,first.snapshot),
    asyncResult=await cooperative(i,transported,first.snapshot,()=>{});
  assert.equal(cold.status,'conflict');assert.equal(cold.stage,'intent');
  assert.equal(cold.diagnostic.code,'IL_MEASURED_INTENT');assert.deepEqual(cold.fragments,[]);
  assert.deepEqual(warm.result,cold);assert.deepEqual(asyncResult.result,cold);
  assert.equal(warm.snapshot,undefined);assert.equal(asyncResult.snapshot,undefined);
 }
 const restored=incremental(i,{intents:[intent('a',{sizeConstraints:{minHeightPercent:50}})]},first.snapshot);
 assert.deepEqual(restored.result,first.result);assert.equal(restored.placement.reusedBlocks,2);
});

test('serialized tolerance and position-only locks preserve intent in measured paths',async()=>{
 const i=input([section([b('a',20,[10]),b('b',20,[10]),b('pin',20,[10])])]);
 const options=JSON.parse(JSON.stringify({intents:[intent('b',{preferred:{page:0,x:85,y:5},preferredTolerance:{x:10,y:5}}),intent('pin',{fixed:{page:0,x:0,y:40},fixedPositionOnly:true,sizeConstraints:{minWidthPercent:40}})]}));
 const r=plan(i,options);assert.equal(r.status,'placed');assert.equal(r.fragments[1].placement.preference,'honored');assert.equal(r.fragments[1].placement.rect.x,80);assert.equal(r.fragments[1].placement.rect.y,10);
 assert.equal(r.fragments[2].placement.occupiedRect.width,40);assert.equal(r.fragments[2].placement.rect.y,40);
 const a=incremental(i,options),bResult=await cooperative(i,options,a.snapshot,()=>{});assert.deepEqual(a.result,r);assert.deepEqual(bResult.result,r);
});

test('fixed row sharing survives serialized measured intent and cooperative reuse',async()=>{
 const i=input([section([b('a',20,[20]),b('pin',20,[20]),b('c',20,[10])])]);
 const options=JSON.parse(JSON.stringify({gap:5,intents:[intent('a',{sideBySide:true}),intent('pin',{fixed:{page:0,x:30,y:0},fixedRowShare:true,sideBySide:true}),intent('c',{sideBySide:true})]}));
 const r=plan(i,options);assert.equal(r.status,'placed');assert.deepEqual(r.fragments.map(f=>[f.placement.rect.x,f.placement.rect.y]),[[0,0],[30,0],[55,0]]);
 const a=incremental(i,options),warm=await cooperative(i,options,a.snapshot,()=>{});assert.deepEqual(warm.result,r);assert.equal(warm.placement.reusedBlocks,3);
});

test('measured keep-together groups preserve distinct source fragments and reject explicit internal breaks',async()=>{
 const i=input([section([b('prior',20,[60]),b('example',20,[20]),b('solution',20,[20]),b('after',20,[10])])]);
 const opts=JSON.parse(JSON.stringify({gap:5,intents:[intent('example',{keepTogetherGroup:'pair'}),intent('solution',{keepTogetherGroup:'pair'})]}));
 const r=plan(i,opts);assert.equal(r.status,'placed');assert.deepEqual(r.fragments.map(f=>[f.origin.blockKey,f.placement.page,f.placement.rect.y]),[['prior',0,0],['example',1,0],['solution',1,25],['after',1,50]]);
 assert.deepEqual((await cooperative(i,opts,undefined,()=>{})).result,r);
 const broken=input([section([b('example',20,[20]),{kind:'pagebreak',origin:origin('break')},b('solution',20,[20])])]);
 const bad=plan(broken,opts);assert.equal(bad.status,'conflict');assert.equal(bad.diagnostic.code,'IL_INVALID');assert.deepEqual(bad.fragments,[]);
});

test('measured mixed row group keeps individual source ranges and same-page geometry',async()=>{
 const i=input([section([b('prior',20,[65]),b('image',30,[20]),b('caption',40,[20])])]);
 const group={keepTogetherGroup:'pair',keepTogetherLayout:'rows',sideBySide:true};
 const opts=JSON.parse(JSON.stringify({gap:5,intents:[intent('image',group),intent('caption',group)]}));
 const r=plan(i,opts);assert.equal(r.status,'placed');assert.deepEqual(r.fragments.map(f=>[f.origin.blockKey,f.placement.page,f.placement.rect.x,f.placement.rect.y]),[['prior',0,0,0],['image',0,0,70],['caption',0,35,70]]);
 assert.deepEqual((await cooperative(i,opts,undefined,()=>{})).result,r);
});
