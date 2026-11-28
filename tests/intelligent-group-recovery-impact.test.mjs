import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout as plan,planMeasuredIntelligentLayoutIncremental as incremental,planMeasuredIntelligentLayoutIncrementalCooperative as cooperative,findIntelligentGroupConflictTarget as target,proposeIntelligentGroupRecovery as recover,compareIntelligentPlacementImpact as compare} from '../dist/index.js';
const source=(blockKey,documentId='doc')=>({documentId,blockKey});
const block=(id,h,extra={})=>({kind:'block',origin:{...source(id),revision:'r'},width:30,unitHeights:[h],splitPolicy:'strict',...extra});
const input=blocks=>({schemaVersion:1,revision:'r',fingerprint:'fp',content:{width:100,height:100},sections:[{id:'s',startOn:'continuous',blocks}]});
const group=(id,p={})=>({...source(id),placement:{keepTogetherGroup:'pair',keepTogetherLayout:'vertical',...p}});
test('oversized group recovery explicitly removes whole group only, preserving independent intents',async()=>{
 const i=input([block('a',60),block('b',60),block('c',10)]);
 const o={gap:5,intents:[group('a',{sizeConstraints:{minWidth:40}}),group('b',{spaceAfter:2,sideBySide:false}),{...source('c'),placement:{fixed:{page:2,x:5,y:5}}}]};
 const before=JSON.stringify(o),r=plan(i,o);
 assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_TOO_LARGE');
 const selection={groupId:'pair',members:[source('a'),source('b')]};
 assert.deepEqual(target(r,o,i),selection);
 assert.deepEqual(target(JSON.parse(JSON.stringify(r)),JSON.parse(before),i),selection);
 assert.equal(target(r,o,{...i,revision:'old'}),undefined);
 assert.equal(target(r,{...o,intents:[...o.intents,o.intents[0]]},i),undefined);
 assert.equal(recover(r,o,i,{...selection,members:[source('a')]}).status,'rejected');
 assert.equal(recover(r,o,i,{...selection,members:[source('a'),source('c')]}).status,'rejected');
 const p=recover(r,o,i,{...selection,members:[source('b'),source('a')]});
 assert.equal(p.status,'proposed');
 assert.deepEqual(p.options.intents,[{...source('a'),placement:{sizeConstraints:{minWidth:40}}},{...source('b'),placement:{spaceAfter:2,sideBySide:false}},o.intents[2]]);
 const good=plan(i,p.options);
 assert.equal(good.status,'placed');assert.equal(good.fragments[2].placement.fixed,true);
 assert.equal(good.fragments[0].placement.occupiedRect.width,40);
 assert.deepEqual(incremental(i,p.options).result,good);
 assert.deepEqual((await cooperative(i,p.options,undefined,()=>{})).result,good);
 assert.equal(target(good,p.options,i),undefined);
 p.options.intents[0].placement.sizeConstraints.minWidth=99;
 assert.equal(JSON.stringify(o),before);
});
test('split member and internal hard break can identify group, unrelated conflict cannot',()=>{
 const o={intents:[group('a'),group('b')]};
 for(const i of [input([block('a',60,{unitHeights:[60,60],splitPolicy:'allow'}),block('b',20)]),input([block('a',20),{kind:'pagebreak',origin:{...source('break'),revision:'r'}},block('b',20)])]){
  const r=plan(i,o);assert.equal(r.status,'conflict');
  const t=target(r,o,i);assert.equal(t.groupId,'pair');
  const p=recover(r,o,i,t);assert.equal(p.status,'proposed');assert.deepEqual(p.options.intents,[]);
  assert.equal(plan(i,p.options).status,'placed');
 }
 const unrelated=input([block('a',20),block('b',20),block('c',101)]);
 assert.equal(target(plan(unrelated,o),o,unrelated),undefined);
});
test('layout impact differentiates moved, page changed, footprint-only and fixed flag changes',()=>{
 const i=input([block('a',20),block('b',40),block('c',30),block('d',10)]);
 const base={gap:5},approved=plan(i,base);
 const o={gap:5,intents:[{...source('a'),placement:{sizeConstraints:{minWidth:50},spaceAfter:20}},{...source('d'),placement:{fixed:{page:1,x:0,y:35}}}]};
 const next=plan(i,o);
 assert.equal(approved.status,'placed');assert.equal(next.status,'placed');
 const impact=compare(approved,next,i);assert.equal(impact.fragmentCount,4);
 assert.equal(impact.movedFragments,3);assert.equal(impact.pageChangedFragments,1);
 assert.deepEqual(impact.changed.map(c=>[c.origin.blockKey,c.pageChanged,c.positionChanged,c.footprintSizeChanged,c.fixedChanged]),[
  ['a',false,false,true,false],['b',false,true,false,false],['c',true,true,false,false],['d',false,true,false,true]
 ]);
 const locked=plan(i,{gap:5,intents:[{...source('d'),placement:{fixed:{page:1,x:0,y:0}}}]});
 const lockImpact=compare(approved,locked,i);assert.equal(lockImpact.movedFragments,0);assert.equal(lockImpact.changed.length,1);assert.equal(lockImpact.changed[0].fixedChanged,true);
 assert.deepEqual(compare(approved,approved,i),{fragmentCount:4,movedFragments:0,pageChangedFragments:0,changed:[]});
 assert.deepEqual(compare(JSON.parse(JSON.stringify(approved)),JSON.parse(JSON.stringify(next)),i),impact);
 impact.changed[0].after.occupiedRect.width=99;
 assert.equal(next.fragments[0].placement.occupiedRect.width,50);
 assert.equal(compare(approved,next,{...i,fingerprint:'old'}),undefined);
 assert.equal(compare(approved,{...next,fragments:next.fragments.slice(1)},i),undefined);
 assert.equal(compare(approved,{...next,fragments:[...next.fragments].reverse()},i),undefined);
 const altered=structuredClone(next);altered.fragments[0].origin.revision='different';
 assert.equal(compare(approved,altered,i),undefined);
});
