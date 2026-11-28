import test from 'node:test';
import assert from 'node:assert/strict';
import {paginateMeasured,paginateMeasuredIncremental,paginateMeasuredIncrementalCooperative,planMeasuredIntelligentLayout} from '../dist/index.js';
const block=(id,heights,splitPolicy='allow',extra={})=>({kind:'block',origin:{documentId:'a',revision:'1',blockKey:id,range:{start:0,end:2}},width:100,unitHeights:heights,splitPolicy,...extra});
const section=(id,blocks,startOn='continuous')=>({id,blocks,startOn});
const plan=(...sections)=>paginateMeasured({schemaVersion:1,revision:'1',fingerprint:'fixture',content:{width:100,height:100},sections});
test('allow splits only at measured boundaries and preserves origin',()=>{
  const r=plan(section('a',[block('a',[40,40,40])]));
  assert.equal(r.completeness,'full');assert.equal(r.publicationReady,false);
  assert.deepEqual(r.pages.map(p=>p.fragments.map(f=>[f.unitStart,f.unitEnd,f.rect.y,f.rect.height])),[[[0,2,0,80]],[[2,3,0,40]]]);
  assert.equal(r.pages[1].fragments[0].origin.blockKey,'a');
  assert.equal(r.pages[1].fragments[0].continuationIndex,1);
});
test('avoid moves a fitting block; oversized avoid splits with warning',()=>{
  const r=plan(section('a',[block('a',[70]),block('b',[20,30],'avoid'),block('c',[60,60],'avoid')]));
  assert.equal(r.pages[1].fragments[0].origin.blockKey,'b');assert.equal(r.pages[1].fragments[0].unitEnd,2);
  assert.equal(r.diagnostics[0].code,'PG_AVOID_SPLIT');assert.equal(r.completeness,'full');
});
test('strict rejects oversize and never splits',()=>{
  const r=plan(section('a',[block('a',[60,60],'strict')]));
  assert.equal(r.completeness,'partial');assert.equal(r.pages.length,0);assert.equal(r.diagnostics[0].code,'PG_TOO_LARGE');
  const fit=plan(section('a',[block('a',[70]),block('b',[20,20],'strict')]));
  assert.equal(fit.pages[1].fragments[0].unitEnd,2);
});
test('continuous suppresses first component start only; explicit boundaries remain',()=>{
  const start={startPosition:'page-top',startPositionSource:'component'};
  const br={kind:'pagebreak',origin:{documentId:'b',revision:'1',blockKey:'break'}};
  const r=plan(section('a',[block('a',[70])]),section('b',[block('b',[20],'strict',start),block('c',[20],'strict',start),br,{...br,origin:{...br.origin,blockKey:'break2'}},block('d',[10])]));
  assert.deepEqual(r.pages.map(p=>p.fragments.map(f=>f.origin.blockKey)),[['a','b'],['c'],['d']]);
});
test('invalid units and duplicate origins stop before placement',()=>{
  const r=plan(section('a',[block('a',[50]),block('b',[0])]));
  assert.equal(r.pages.length,0);assert.equal(r.diagnostics[0].code,'PG_INVALID');
  assert.equal(plan(section('a',[block('a',[50]),block('a',[50])])).completeness,'partial');
});

test('split minima avoid isolated first and last measured units',()=>{
 const minima={minUnitsBefore:2,minUnitsAfter:2};
 const first=plan(section('s',[block('intro',[70]),block('body',[20,20,20,20],'allow',minima)]));
 assert.deepEqual(first.pages.map(p=>p.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd])),[[['intro',0,1]],[['body',0,4]]]);
 const last=plan(section('s',[block('body',[20,20,20,20,20,20],'allow',minima)]));
 assert.deepEqual(last.pages.map(p=>p.fragments.map(f=>[f.unitStart,f.unitEnd,f.rect.height])),[[[0,4,80]],[[4,6,40]]]);
 assert.deepEqual(last.diagnostics,[]);
});
test('impossible minima preserve progress and warn once; strict and padding remain authoritative',()=>{
 const minima={minUnitsBefore:2,minUnitsAfter:2};
 const r=plan(section('s',[block('body',[60,60,60],'allow',minima)]));
 assert.equal(r.completeness,'full');assert.equal(r.pages.length,3);
 assert.equal(r.diagnostics.filter(d=>d.code==='PG_SPLIT_MINIMUM').length,1);
 const strict=plan(section('s',[block('body',[60,60],'strict',minima)]));
 assert.equal(strict.diagnostics[0].code,'PG_TOO_LARGE');
 const padded=plan(section('s',[block('body',[20,20,20,20,20],'allow',{...minima,fragmentPadding:{top:5,bottom:5}})]));
 assert.deepEqual(padded.pages.map(p=>p.fragments.map(f=>[f.unitStart,f.unitEnd,f.rect.height])),[[[0,3,70]],[[3,5,50]]]);
 for(const value of [0,-1,1.5,Infinity,null,'2']){
  const bad=plan(section('s',[block('body',[20],'allow',{minUnitsBefore:value})]));
  assert.equal(bad.diagnostics[0].code,'PG_INVALID');assert.equal(bad.pages.length,0);
 }
});
test('split minima participate in incremental keys and IL bridge preserves measured ranges',async()=>{
 const make=extra=>({schemaVersion:1,revision:'1',fingerprint:'fixture',content:{width:100,height:100},sections:[section('s',[block('intro',[10]),block('body',[20,20,20,20,20],'allow',extra),block('tail',[10])])]});
 const old=make({}),next=make({minUnitsBefore:2,minUnitsAfter:2}),seed=paginateMeasuredIncremental(old);
 const warm=paginateMeasuredIncremental(next,seed.snapshot),cold=paginateMeasured(next);
 assert.deepEqual(warm.plan,cold);assert.ok(warm.reusedBlocks>=1);assert.notDeepEqual(seed.plan,cold);
 assert.deepEqual((await paginateMeasuredIncrementalCooperative(next,seed.snapshot,()=>{})).plan,cold);
 assert.deepEqual(paginateMeasuredIncremental(old,warm.snapshot).plan,seed.plan);
 const il=planMeasuredIntelligentLayout(next);
 assert.equal(il.status,'placed');
 assert.deepEqual(il.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd]),cold.pages.flatMap(p=>p.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd])));
});

test('split search prevents isolated intermediate units missed by local greedy flow',()=>{
 const heights=[20,20,20,20,60,50,20,20],minima={minUnitsBefore:2,minUnitsAfter:2};
 const old=plan(section('s',[block('body',heights,'allow',minima)]));
 const r=plan(section('s',[block('body',heights,'allow',{...minima,optimizeSplit:true})]));
 assert.equal(old.diagnostics[0].code,'PG_SPLIT_MINIMUM');
 assert.deepEqual(r.diagnostics,[]);
 assert.deepEqual(r.pages.map(p=>p.fragments.map(f=>[f.unitStart,f.unitEnd,f.rect.height])),[[[0,3,60]],[[3,5,80]],[[5,8,90]]]);
});
test('split search considers an already occupied page and preserves fallback',()=>{
 const minima={minUnitsBefore:2,minUnitsAfter:2,optimizeSplit:true};
 const r=plan(section('s',[block('intro',[60]),block('body',[20,20,60,50,20,20],'allow',minima)]));
 assert.deepEqual(r.pages.map(p=>p.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd])),[[['intro',0,1]],[['body',0,3]],[['body',3,6]]]);
 assert.deepEqual(r.diagnostics,[]);
 const impossible=plan(section('s',[block('body',[60,60,60],'allow',minima)]));
 assert.deepEqual(impossible,plan(section('s',[block('body',[60,60,60],'allow',{...minima,optimizeSplit:false})])));
 assert.equal(impossible.diagnostics[0].code,'PG_SPLIT_MINIMUM');
 assert.equal(plan(section('s',[block('a',[10],'allow',{optimizeSplit:'true'})])).diagnostics[0].code,'PG_INVALID');
});
test('bounded split search agrees with exhaustive small legal partitions',()=>{
 for(let seed=0;seed<180;seed++){
  const n=4+seed%6,heights=Array.from({length:n},(_,i)=>10+((seed*17+i*23+i*i*7)%7)*10);
  const minBefore=2+seed%2,minAfter=2+(seed>>1)%2,overhead=10;
  const visit=(start,first)=>{
   if(start===n)return 0;
   let best=Infinity,h=overhead;
   for(let end=start+1;end<=n;end++){
    h+=heights[end-1];if(h>100)break;
    const required=end<n?Math.max(minBefore,first?1:minAfter):first?1:minAfter;
    if(end-start>=required)best=Math.min(best,1+visit(end,false));
   }
   return best;
  };
  const optimum=visit(0,true),r=plan(section('s',[block('body',heights,'allow',{minUnitsBefore:minBefore,minUnitsAfter:minAfter,optimizeSplit:true,fragmentPadding:{top:5,bottom:5}})]));
  assert.equal(r.completeness,'full');
  if(Number.isFinite(optimum)){
   assert.equal(r.pages.length,optimum,'minimum page count seed '+seed);
   assert.deepEqual(r.diagnostics,[],'no minimum warning seed '+seed);
  }
  const fs=r.pages.flatMap(p=>p.fragments);
  assert.deepEqual(fs.flatMap(f=>heights.slice(f.unitStart,f.unitEnd)),heights);
  assert.ok(fs.every(f=>f.rect.height<=100));
 }
});
test('split-search setting invalidates pagination checkpoint and retains IL ranges',async()=>{
 const make=optimizeSplit=>({schemaVersion:1,revision:'1',fingerprint:'fixture',content:{width:100,height:100},sections:[section('s',[block('intro',[100]),block('body',[20,20,20,20,60,50,20,20],'allow',{minUnitsBefore:2,minUnitsAfter:2,optimizeSplit})])]});
 const old=make(false),next=make(true),seed=paginateMeasuredIncremental(old);
 const r=paginateMeasuredIncremental(next,seed.snapshot),cold=paginateMeasured(next);
 assert.deepEqual(r.plan,cold);assert.notDeepEqual(r.plan,seed.plan);assert.ok(r.reusedBlocks>=1);
 assert.deepEqual((await paginateMeasuredIncrementalCooperative(next,seed.snapshot,()=>{})).plan,cold);
 const il=planMeasuredIntelligentLayout(next);assert.equal(il.status,'placed');
 assert.deepEqual(il.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd]),cold.pages.flatMap(p=>p.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd])));
});
