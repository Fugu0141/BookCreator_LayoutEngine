import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout as plan,planMeasuredIntelligentLayoutIncremental as incremental,planMeasuredIntelligentLayoutIncrementalCooperative as cooperative,findIntelligentFixedConflictTarget as target} from '../dist/index.js';

const block=(documentId,blockKey,unitHeights,splitPolicy='strict')=>({kind:'block',origin:{documentId,blockKey,revision:'source-r'},width:30,unitHeights,splitPolicy});
const input=(blocks)=>({schemaVersion:1,revision:'book-r',fingerprint:'fp',content:{width:100,height:100},sections:[{id:'book',startOn:'continuous',blocks}]});
const fixed=(documentId,blockKey,y)=>({documentId,blockKey,placement:{fixed:{page:0,x:0,y},fixedPositionOnly:true,sizeConstraints:{minWidthPercent:50},spaceAfter:5}});
const base=input([block('a','pin',[20]),block('b','pin',[20])]);
const first=fixed('a','pin',0),second=fixed('b','pin',10);
const options={gap:5,intents:[first,second]};

test('full-book fixed conflict identifies only the exact document and block, without editing intent',async()=>{
 const before=JSON.stringify(options),r=plan(base,options);
 assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_FIXED_CONFLICT');
 assert.deepEqual(r.fragments,[]);
 const expected={documentId:'b',blockKey:'pin'};
 assert.deepEqual(target(r,options,base),expected);
 assert.deepEqual(target(JSON.parse(JSON.stringify(r)),JSON.parse(before),base),expected);
 assert.equal(JSON.stringify(options),before);
 const inc=incremental(base,options);
 const coop=await cooperative(base,options,undefined,()=>{});
 for(const attempt of [inc,coop]){
  assert.equal(attempt.snapshot,undefined);
  assert.deepEqual(attempt.result,r);
  assert.deepEqual(target(attempt.result,options,base),expected);
 }
 assert.equal(target(r,options,{...base,revision:'old'}),undefined);
 assert.equal(target(r,options,{...base,fingerprint:'other'}),undefined);
 assert.equal(target(r,{...options,intents:[first,second,second]},base),undefined);
 assert.equal(target(r,{...options,intents:[first]},base),undefined);
 assert.equal(target(r,{...options,intents:[first,{...second,placement:{spaceAfter:5}}]},base),undefined);
 // Host must explicitly remove only the lock. Other intent remains intact.
 const recovered={...options,intents:[first,{...second,placement:{sizeConstraints:second.placement.sizeConstraints,spaceAfter:second.placement.spaceAfter}}]};
 const good=plan(base,recovered);
 assert.equal(good.status,'placed');
 assert.equal(good.fragments[0].placement.fixed,true);
 assert.deepEqual(good.fragments[0].placement.rect,{x:0,y:0,width:30,height:20});
 assert.equal(good.fragments[1].placement.fixed,false);
 assert.equal(good.fragments[1].placement.occupiedRect.width,50);
 assert.equal(good.fragments[1].placement.occupiedRect.height,25);
 assert.equal(target(good,recovered,base),undefined);
 assert.equal(JSON.stringify(options),before);
});

test('split fixed intent is a recovery target, pagination errors and ambiguous intents are not',()=>{
 const split=input([block('b','pin',[60,60],'allow')]);
 const o={intents:[second]};
 const r=plan(split,o);
 assert.equal(r.status,'conflict');assert.equal(r.stage,'intent');
 assert.deepEqual(target(r,o,split),{documentId:'b',blockKey:'pin'});
 assert.equal(target(r,{intents:[second,second]},split),undefined);
 const invalid=input([block('b','pin',[101])]);
 const p=plan(invalid,o);
 assert.equal(p.status,'conflict');assert.equal(p.stage,'pagination');
 assert.equal(target(p,o,invalid),undefined);
});

test('fixed boundary and reserved-region conflicts identify the lock without moving it',()=>{
 const i=input([block('b','pin',[20])]);
 for(const [o,code] of [
  [{intents:[fixed('b','pin',90)]},'IL_FIXED_CONFLICT'],
  [{intents:[fixed('b','pin',0)],reservedRegions:[{id:'r',page:0,rect:{x:0,y:0,width:10,height:10}}]},'IL_RESERVED_CONFLICT']
 ]){
  const r=plan(i,o);
  assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,code);
  assert.deepEqual(r.fragments,[]);
  assert.deepEqual(target(r,o,i),{documentId:'b',blockKey:'pin'});
 }
});
