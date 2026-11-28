import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout as plan,planMeasuredIntelligentLayoutIncremental as incremental,planMeasuredIntelligentLayoutIncrementalCooperative as cooperative,describeIntelligentPreferredPlacement as describe} from '../dist/index.js';

const source={documentId:'b',blockKey:'same'};
const input={schemaVersion:1,revision:'book',fingerprint:'draft',content:{width:100,height:100},sections:[{id:'a',startOn:'continuous',blocks:[
 {kind:'block',origin:{documentId:'a',blockKey:'same',revision:'a'},width:20,unitHeights:[10],splitPolicy:'strict'}
]},{id:'b',startOn:'continuous',blocks:[
 {kind:'block',origin:{...source,revision:'b'},width:30,unitHeights:[20],splitPolicy:'strict'}
]}]};
const options=(page,x,y,tolerance)=>({gap:5,intents:[{...source,placement:{preferred:{page,x,y},...(tolerance?{preferredTolerance:tolerance}:{})}}]});

test('exact, tolerance and fallback positions report distinct feedback without changing request',async()=>{
 for(const [o,status,actual,offset] of [
  [options(0,10,30),'exact',{page:0,x:10,y:30},{x:0,y:0}],
  [options(0,75,30,{x:10,y:0}),'within-tolerance',{page:0,x:70,y:30},{x:-5,y:0}],
  [options(0,75,30,{x:1,y:0}),'fallback',{page:0,x:0,y:15},{x:-75,y:-15}],
  [options(1,10,30,{x:100,y:100}),'fallback',{page:0,x:0,y:15},undefined]
 ]){
  const before=JSON.stringify(o),r=plan(input,o);
  assert.equal(r.status,'placed');
  const report=describe(r,o,input,source);
  assert.deepEqual(report,{...source,status,requested:o.intents[0].placement.preferred,actual,
    tolerance:o.intents[0].placement.preferredTolerance??{x:0,y:0},...(offset?{offset}:{})});
  const inc=incremental(input,o),coop=await cooperative(input,o,inc.snapshot,()=>{});
  assert.deepEqual(describe(inc.result,o,input,source),report);
  assert.deepEqual(describe(coop.result,o,input,source),report);
  assert.deepEqual(describe(JSON.parse(JSON.stringify(r)),JSON.parse(before),input,source),report);
  report.requested.x=999;report.actual.x=999;report.tolerance.x=999;
  assert.equal(JSON.stringify(o),before);
  assert.deepEqual(describe(r,o,input,source).actual,actual);
 }
});

test('no feedback for stale, ambiguous, fixed, contradictory or nonmatching requests',()=>{
 const o=options(0,10,30),r=plan(input,o);
 assert.equal(describe(r,o,{...input,revision:'old'},source),undefined);
 assert.equal(describe(r,o,{...input,fingerprint:'old'},source),undefined);
 assert.equal(describe(r,o,input,{documentId:'a',blockKey:'same'}),undefined);
 assert.equal(describe(r,{intents:[...o.intents,...o.intents]},input,source),undefined);
 assert.equal(describe(r,options(1,10,30),input,source),undefined);
 const fixed={intents:[{...source,placement:{fixed:{page:0,x:10,y:30}}}]};
 assert.equal(describe(plan(input,fixed),fixed,input,source),undefined);
 const conflict={intents:[{...source,placement:{fixed:{page:0,x:0,y:0}}}]};
 assert.equal(describe(plan(input,conflict),o,input,source),undefined);
});
