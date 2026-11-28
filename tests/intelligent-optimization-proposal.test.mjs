import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout as plan,proposeIntelligentOptimization as propose} from '../dist/index.js';
const b=(blockKey,width,height)=>({kind:'block',origin:{documentId:'doc',revision:'r',blockKey},width,unitHeights:[height],splitPolicy:'strict'});
const input=(blocks,content={width:100,height:100})=>({schemaVersion:1,revision:'book',fingerprint:'fp',content,sections:[{id:'s',startOn:'continuous',blocks}]});
const intent=(blockKey,placement)=>({documentId:'doc',blockKey,placement});
test('compact proposal reduces page count without changing saved intents or source',()=>{
 const i=input([b('a',60,10),b('b',30,40),b('c',60,40)],{width:100,height:65});
 const options={gap:5,intents:['a','b','c'].map(id=>intent(id,{sideBySide:true}))};
 const approved=plan(i,options),original=JSON.stringify([i,options,approved]);
 const r=propose(i,approved,options,'compact');
 assert.equal(r.status,'proposed');assert.equal(r.improvement.pagesSaved,1);
 assert.deepEqual(r.options.intents,options.intents);assert.notEqual(r.options.intents,options.intents);
 assert.equal(r.before.pageCount,2);assert.equal(r.after.pageCount,1);
 assert.deepEqual(plan(i,r.options),r.result);assert.ok(r.impact.movedFragments>0);
 assert.equal(JSON.stringify([i,options,approved]),original);
 r.options.intents[0].placement.sideBySide=false;assert.equal(JSON.stringify([i,options,approved]),original);
});
test('balance proposal reduces occupied-depth difference without extra pages',()=>{
 const i=input(['a','b','c','d'].map(id=>b(id,80,30))),options={gap:5};
 const approved=plan(i,options),r=propose(i,approved,options,'balance');
 assert.equal(r.status,'proposed');assert.equal(r.improvement.pagesSaved,0);
 assert.equal(r.improvement.depthImbalanceReduction,70);
 assert.deepEqual(r.result.fragments.map(f=>f.placement.page),[0,0,1,1]);
 assert.deepEqual(propose(i,r.result,r.options,'balance'),{status:'rejected',reason:'no-improvement'});
});
test('compact proposal restores independent soft positions without releasing the fixed block',()=>{
 const i=input([b('earlier',20,20),b('conflicting',20,20),b('pin',20,20),b('later',20,20)]);
 const options={gap:5,intents:[
 intent('earlier',{preferred:{page:0,x:10,y:5}}),intent('conflicting',{preferred:{page:0,x:0,y:70}}),
 intent('pin',{fixed:{page:0,x:0,y:60}}),intent('later',{startNewPage:true,preferred:{page:1,x:40,y:20}})]};
 const approved=plan(i,options),r=propose(i,approved,options,'compact');
 assert.equal(r.status,'proposed');assert.equal(r.improvement.additionalHonoredPreferences,2);
 assert.deepEqual(r.result.fragments[2].placement,approved.fragments[2].placement);
 assert.deepEqual(r.options.intents,options.intents);
});
test('stale same-revision options, conflict, invalid goal and no improvement fail closed',()=>{
 const i=input([b('a',20,20),b('b',20,20)]),o={gap:5},approved=plan(i,o);
 assert.deepEqual(propose(i,approved,{gap:10},'compact'),{status:'rejected',reason:'stale'});
 assert.deepEqual(propose({...i,revision:'old'},approved,o,'compact'),{status:'rejected',reason:'stale'});
 assert.deepEqual(propose(i,approved,o,'unknown'),{status:'rejected',reason:'invalid-goal'});
 assert.deepEqual(propose(i,approved,o,'compact'),{status:'rejected',reason:'no-improvement'});
 const conflict=plan(i,{intents:[intent('b',{fixed:{page:0,x:0,y:0}})]});
 assert.deepEqual(propose(i,conflict,o,'compact'),{status:'rejected',reason:'stale'});
 const corrupted=structuredClone(approved);corrupted.fragments[0].placement.rect.x=10;
 assert.deepEqual(propose(i,corrupted,o,'compact'),{status:'rejected',reason:'stale'});
});
