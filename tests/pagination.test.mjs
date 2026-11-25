import test from 'node:test';
import assert from 'node:assert/strict';
import {paginateMeasured} from '../dist/index.js';
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
