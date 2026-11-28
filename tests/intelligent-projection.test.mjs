import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout,projectIntelligentMeasuredPlan,paginateMeasured} from '../dist/index.js';
const b=(blockKey,width,unitHeights,splitPolicy='strict')=>({kind:'block',origin:{documentId:'doc',revision:'r',blockKey},width,unitHeights,splitPolicy});
const input=(blocks)=>({schemaVersion:1,revision:'r',fingerprint:'fp',content:{width:100,height:100},sections:[{id:'s',startOn:'continuous',blocks}]});
test('projection keeps content geometry and intervening blank pages',()=>{
 const i=input([b('a',20,[10]),b('b',20,[10]),b('pin',20,[10])]);
 const r=planMeasuredIntelligentLayout(i,{gap:5,intents:[
 {documentId:'doc',blockKey:'a',placement:{sideBySide:true,sizeConstraints:{minWidth:40}}},
 {documentId:'doc',blockKey:'b',placement:{sideBySide:true}},
 {documentId:'doc',blockKey:'pin',placement:{fixed:{page:2,x:10,y:20}}}]});
 assert.equal(r.status,'placed');const p=projectIntelligentMeasuredPlan(r);
 assert.equal(p.pages.length,3);assert.deepEqual(p.pages[1].fragments,[]);
 assert.deepEqual(p.pages[0].fragments.map(f=>f.rect),[{x:0,y:0,width:20,height:10},{x:45,y:0,width:20,height:10}]);
 assert.deepEqual(p.pages[2].fragments[0].rect,{x:10,y:20,width:20,height:10});
 assert.equal(p.publicationReady,false);assert.equal(p.fingerprint,'fp');
 p.pages[0].fragments[0].rect.x=99;assert.equal(r.fragments[0].placement.rect.x,0);
});
test('default projection agrees with ordinary measured plan including safe splits',()=>{
 const i=input([b('a',100,[30]),b('b',100,[30,30,30,30],'avoid')]);
 const r=planMeasuredIntelligentLayout(i);
 assert.equal(r.status,'placed');assert.deepEqual(projectIntelligentMeasuredPlan(r),paginateMeasured(i));
});
test('projection uses final page boundaries for movable overflow',()=>{
 const i=input([b('a',20,[70]),b('b',20,[70])]);
 const r=planMeasuredIntelligentLayout(i,{intents:['a','b'].map(blockKey=>({documentId:'doc',blockKey,placement:{sideBySide:true}}))});
 assert.equal(r.status,'placed');const p=projectIntelligentMeasuredPlan(r);
 assert.equal(p.pages.length,1);assert.equal(p.pages[0].fragments[1].breakReason,'flow');
 assert.equal(r.fragments[1].sourceBreakReason,'overflow');
});
