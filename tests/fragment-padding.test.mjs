import test from 'node:test';
import assert from 'node:assert/strict';
import {paginateMeasured} from '../dist/index.js';
const make=(heights,padding,splitPolicy='allow')=>({kind:'block',origin:{documentId:'a',revision:'1',blockKey:'p'},width:100,unitHeights:heights,splitPolicy,fragmentPadding:padding});
const run=(block,leading=false)=>paginateMeasured({schemaVersion:1,revision:'1',fingerprint:'frame',content:{width:100,height:100},sections:[{id:'a',startOn:'page',blocks:[...(leading?[{...make([65],undefined),origin:{documentId:'a',revision:'1',blockKey:'lead'}}]:[]),block]}]});
test('padding counted once per fragment and remaining space respected',()=>{
  const p=run(make([20,20,20,20,20],{top:10,bottom:10}),true);
  assert.equal(p.completeness,'full');
  assert.deepEqual(p.pages.flatMap(s=>s.fragments).filter(f=>f.origin.blockKey==='p').map(f=>[f.unitStart,f.unitEnd,f.rect.y,f.rect.height]),[[0,4,0,100],[4,5,0,40]]);
});
test('strict/avoid and impossible padding use total padded geometry',()=>{
  const padding={top:10,bottom:10};
  assert.equal(run(make([90],padding)).diagnostics[0].code,'PG_TOO_LARGE');
  assert.equal(run(make([50,40],padding,'strict')).diagnostics[0].code,'PG_TOO_LARGE');
  assert.equal(run(make([50,40],padding,'avoid')).diagnostics[0].code,'PG_AVOID_SPLIT');
  assert.equal(run(make([10],{top:-1,bottom:0})).diagnostics[0].code,'PG_INVALID');
});
