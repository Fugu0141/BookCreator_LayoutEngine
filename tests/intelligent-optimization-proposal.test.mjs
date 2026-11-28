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

import {prepareIntelligentOptimizationReview as prepare,confirmIntelligentOptimizationReview as confirm,cancelIntelligentOptimizationReview as cancel} from '../dist/index.js';
const reviewFixture=()=>{
 const i=input([b('a',60,10),b('b',30,40),b('c',60,40)],{width:100,height:65});
 const options={gap:5,intents:['a','b','c'].map(id=>intent(id,{sideBySide:true}))};
 const approved=plan(i,options),current={input:i,approved,options,lease:'lease-1'};
 const review=prepare(i,approved,options,'compact',current.lease);
 assert.equal(review.status,'review');
 const preview={options:structuredClone(review.proposal.options),result:plan(i,review.proposal.options)};
 return {current,review,preview};
};
test('review confirms only independently recalculated candidate once and isolates mutable display data',()=>{
 const {current,review,preview}=reviewFixture(),before=JSON.stringify(current);
 review.proposal.options.intents[0].placement.sideBySide=false;
 review.proposal.result.fragments[0].placement.rect.x=99;
 const accepted=confirm(review.handle,current,preview);
 assert.equal(accepted.status,'confirmed');assert.deepEqual(accepted.options,preview.options);assert.deepEqual(accepted.result,preview.result);
 assert.equal(JSON.stringify(current),before);
 accepted.options.intents[0].placement.sideBySide=false;
 assert.equal(preview.options.intents[0].placement.sideBySide,true);
 assert.deepEqual(confirm(review.handle,current,preview),{status:'rejected',reason:'invalid-handle'});
});
test('cancel, stale lease, changed input, changed approved plan and changed options cannot confirm',()=>{
 for(const mutate of [
  c=>{c.lease='lease-2';},
  c=>{c.input.sections[0].blocks[0].unitHeights[0]=11;},
  c=>{c.approved.fragments[0].placement.rect.x=1;},
  c=>{c.options.gap=6;}
 ]){
  const {current,review,preview}=reviewFixture();mutate(current);
  assert.deepEqual(confirm(review.handle,current,preview),{status:'rejected',reason:'stale'});
  assert.equal(cancel(review.handle),false);
 }
 const {current,review,preview}=reviewFixture();
 assert.equal(cancel(review.handle),true);assert.equal(cancel(review.handle),false);
 assert.deepEqual(confirm(review.handle,current,preview),{status:'rejected',reason:'invalid-handle'});
 assert.deepEqual(confirm(JSON.parse(JSON.stringify(review.handle)),current,preview),{status:'rejected',reason:'invalid-handle'});
});
test('wrong preview or settings consume the review without publishing',()=>{
 for(const mutate of [p=>{p.result.fragments[0].placement.rect.x=1;},p=>{p.options.gap=7;}]){
  const {current,review,preview}=reviewFixture();mutate(preview);
  assert.deepEqual(confirm(review.handle,current,preview),{status:'rejected',reason:'preview-mismatch'});
  assert.equal(cancel(review.handle),false);
 }
 const {current}=reviewFixture();
 assert.deepEqual(prepare(current.input,current.approved,current.options,'compact',''),{status:'rejected',reason:'stale'});
});

import {describeIntelligentOptimizationProposal as describe} from '../dist/index.js';
test('proposal explanation reports observed benefits and exact source movements without assigning causes',()=>{
 const {review}=reviewFixture(),p=review.proposal;
 const original=JSON.stringify(p),r=describe(p);
 assert.equal(r.goal,'compact');assert.equal(r.selectedCandidate,'lookahead');
 assert.deepEqual(r.benefits,[{kind:'pages-saved',count:1}]);
 assert.equal(r.causalAttribution,false);
 assert.deepEqual(r.changes,p.impact.changed.map(c=>({documentId:c.origin.documentId,blockKey:c.origin.blockKey,placementId:c.before.id,unitStart:c.unitStart,unitEnd:c.unitEnd,beforePage:c.before.page,afterPage:c.after.page,deltaX:c.after.rect.x-c.before.rect.x,deltaY:c.after.rect.y-c.before.rect.y,preferenceRestored:c.before.preference==='fallback'&&c.after.preference==='honored'})));
 assert.ok(r.changes.some(c=>c.blockKey==='c'&&c.beforePage===1&&c.afterPage===0));
 r.changes[0].blockKey='changed';r.benefits[0].count=999;
 assert.equal(JSON.stringify(p),original);
 assert.equal(describe({status:'rejected',reason:'no-improvement'}),undefined);
});
test('balance explanation reports physical depth improvement and retains page count',()=>{
 const i=input(['a','b','c','d'].map(id=>b(id,80,30))),o={gap:5};
 const p=propose(i,plan(i,o),o,'balance'),r=describe(p);
 assert.equal(r.goal,'balance');assert.equal(r.selectedCandidate,'page-balance');
 assert.deepEqual(r.benefits,[{kind:'depth-imbalance-reduced',micrometres:70}]);
 assert.equal(r.causalAttribution,false);
 assert.ok(r.changes.some(c=>c.blockKey==='c'&&c.beforePage===0&&c.afterPage===1));
});

test('scoped improvement preserves an unrelated chapter and rejects a protected destination',()=>{
 const i=input([...['a','b','c','d'].map(id=>b(id,80,30)),b('unrelated',80,20)]);
 const o={gap:5,intents:[intent('unrelated',{startNewPage:true})]},approved=plan(i,o);
 assert.deepEqual(approved.fragments.map(f=>f.placement.page),[0,0,0,1,2]);
 const scope={firstPage:0,lastPage:1};
 const p=propose(i,approved,o,'balance',scope);
 assert.equal(p.status,'proposed');assert.deepEqual(p.scope,scope);
 assert.deepEqual(p.result.fragments.at(-1),approved.fragments.at(-1));
 assert.deepEqual(p.result.fragments.map(f=>f.placement.page),[0,0,1,1,2]);
 assert.deepEqual(propose(i,approved,o,'balance',{firstPage:0,lastPage:0}),{status:'rejected',reason:'outside-scope'});
 assert.deepEqual(propose(i,approved,o,'balance',{firstPage:1,lastPage:2}),{status:'rejected',reason:'outside-scope'});
 assert.deepEqual(propose(i,approved,o,'balance',{...scope,maxMovedFragments:1}),{status:'rejected',reason:'movement-budget'});
 const bounded=propose(i,approved,o,'balance',{...scope,maxMovedFragments:2});
 assert.equal(bounded.status,'proposed');assert.equal(bounded.impact.movedFragments,2);
});
test('scoped review validates page range and retains the independently checked candidate',()=>{
 const {current}=reviewFixture();
 const {input:i,approved,options,lease}=current;
 for(const scope of [null,{},[],{firstPage:-1,lastPage:1},{firstPage:1,lastPage:0},{firstPage:0,lastPage:2},{firstPage:0,lastPage:1,maxMovedFragments:-1},{firstPage:0,lastPage:1,typo:1}]){
  assert.deepEqual(propose(i,approved,options,'compact',scope),{status:'rejected',reason:'invalid-scope'});
 }
 const scope={firstPage:0,lastPage:1},r=prepare(i,approved,options,'compact',lease,scope);
 assert.equal(r.status,'review');assert.deepEqual(r.proposal.scope,scope);
 scope.lastPage=0;assert.equal(r.proposal.scope.lastPage,1);
 const preview={options:r.proposal.options,result:plan(i,r.proposal.options)};
 assert.equal(confirm(r.handle,current,preview).status,'confirmed');
 assert.deepEqual(prepare(i,approved,options,'compact',lease,{firstPage:0,lastPage:0}),{status:'rejected',reason:'outside-scope'});
});

test('scope preserves every later page in a 22-page measured book',()=>{
 const later=Array.from({length:20},(_,n)=>b('chapter-'+n,80,30));
 const i=input([...['a','b','c','d'].map(id=>b(id,80,30)),...later]);
 const options={gap:5,intents:later.map((_,n)=>intent('chapter-'+n,{startNewPage:true}))};
 const approved=plan(i,options);
 const p=propose(i,approved,options,'balance',{firstPage:0,lastPage:1,maxMovedFragments:2});
 assert.equal(p.status,'proposed');
 assert.equal(p.before.pageCount,22);assert.equal(p.after.pageCount,22);
 assert.deepEqual(p.result.fragments.slice(4),approved.fragments.slice(4));
 assert.deepEqual(p.after.pages.slice(2),p.before.pages.slice(2));
});

test('targeted balance chooses a smaller eligible improvement inside the selected chapter',()=>{
 const i=input([...['a','b','c','d'].map(id=>b(id,80,28)),...['e','f','g','h'].map(id=>b(id,80,30))]);
 const options={gap:5,intents:[intent('e',{startNewPage:true})]};
 const approved=plan(i,options);
 assert.deepEqual(approved.fragments.map(f=>f.placement.page),[0,0,0,1,2,2,2,3]);
 const global=propose(i,approved,options,'balance');
 assert.equal(global.status,'proposed');
 assert.deepEqual(global.result.fragments.map(f=>f.placement.page),[0,0,0,1,2,2,3,3]);
 const scope={firstPage:0,lastPage:1,maxMovedFragments:2};
 const local=propose(i,approved,options,'balance',scope);
 assert.equal(local.status,'proposed');
 assert.deepEqual(local.options.optimization.balancePageRange,{firstPage:0,lastPage:1});
 assert.equal(local.improvement.depthImbalanceReduction,66);
 assert.equal(local.result.layout.optimization.score.pageDepthImbalance,0);
 assert.deepEqual(local.result.fragments.map(f=>f.placement.page),[0,0,1,1,2,2,2,3]);
 assert.deepEqual(local.result.fragments.slice(4),approved.fragments.slice(4));
 assert.deepEqual(plan(i,JSON.parse(JSON.stringify(local.options))),local.result);
 const review=prepare(i,approved,options,'balance','targeted-lease',scope);
 assert.equal(review.status,'review');
 assert.equal(confirm(review.handle,{input:i,approved,options,lease:'targeted-lease'},
   {options:local.options,result:local.result}).status,'confirmed');
});
test('balance range validates bounds and preserves the non-targeted mode',()=>{
 const i=input(['a','b','c','d'].map(id=>b(id,80,30)));
 for(const range of [null,[],{}, {firstPage:-1,lastPage:1},{firstPage:1,lastPage:0},{firstPage:0,lastPage:10000},{firstPage:0,lastPage:1,extra:1}]){
  const r=plan(i,{gap:5,optimization:{balancePageDepths:true,balancePageRange:range}});
  assert.equal(r.status,'conflict');assert.equal(r.diagnostic.code,'IL_INVALID');
 }
 assert.equal(plan(i,{optimization:{balancePageRange:{firstPage:0,lastPage:1}}}).status,'conflict');
 const r=plan(i,{gap:5,optimization:{balancePageDepths:true,balancePageRange:{firstPage:0,lastPage:0}}});
 assert.deepEqual(r.fragments.map(f=>f.placement.page),[0,0,0,1]);
 assert.equal(r.layout.optimization.score.pageDepthImbalance,0);
});
test('targeted balance settings are compatible with source semantic hints',()=>{
 const i=input(['a','b','c','d'].map(id=>b(id,80,30)));
 const options={gap:5,semanticHints:[{documentId:'doc',blockKey:'a',role:'heading'},{documentId:'doc',blockKey:'b',role:'body'}],
   optimization:{balancePageDepths:true,balancePageRange:{firstPage:0,lastPage:1}}};
 const r=plan(i,options);assert.equal(r.status,'placed');assert.equal(r.layout.optimization.score.keptWithNext,1);
 assert.equal(r.layout.optimization.selected,'page-balance');
});
