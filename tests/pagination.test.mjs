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
