import test from 'node:test';
import assert from 'node:assert/strict';
import {measurePreviewSections} from '../dist/browser-page-measure.js';
import {previewBlockKey} from '../dist/browser-page-render.js';
import {paginateMeasured} from '../dist/pagination.js';

const origin=(documentId,blockKey)=>({documentId,blockKey,revision:'1',range:{start:0,end:2}});
const request={text:'ab',width:10000,fontFamily:'serif',fontWeight:400,fontSize:4000,lineHeight:1.5};
const block=(id,key)=>({origin:origin(id,key),request,splitPolicy:'allow',sourceTextStart:0});
const services={
  measurePlainTextLines:async(_document,r)=>({request:r,lines:[{start:0,end:1,height:6000},{start:1,end:2,height:6000}],measurement:'browser-dom-lines',publicationReady:false}),
  resolveComponentWidths:()=>assert.fail('no component expected'),
  placeComponent:()=>assert.fail('no component expected'),
  listInset:()=>assert.fail('no list expected'),
  listMarker:()=>assert.fail('no list expected')
};
test('measurement stage keeps ordered sections, explicit breaks and exact origin separate from pagination',async()=>{
  const a=block('a','first'),b=block('b','second'),c=block('b','third'),br={kind:'pagebreak',origin:origin('b','break')};
  const result=await measurePreviewSections(null,[{id:'a',startOn:'page',blocks:[a]},{id:'b',startOn:'continuous',blocks:[b,br,c]}],10000,18000,services);
  assert.equal(result.byKey.size,3);
  assert.equal(result.byKey.get(previewBlockKey(a.origin)).block,a);
  assert.equal(result.measuredSections[1].blocks[1],br);
  assert.deepEqual(result.measuredSections[0].blocks[0].unitHeights,[6000,6000]);
  const plan=paginateMeasured({schemaVersion:1,revision:'1',fingerprint:'boundary',content:{width:10000,height:18000},sections:result.measuredSections});
  assert.equal(plan.completeness,'full');
  assert.deepEqual(plan.pages.map(p=>p.fragments.map(f=>[f.origin.blockKey,f.unitStart,f.unitEnd])),[[['first',0,2],['second',0,1]],[['second',1,2]],[['third',0,2]]]);
});
test('measurement rejects duplicate origins before measuring a second copy',async()=>{
  let calls=0;const a=block('a','first');
  await assert.rejects(measurePreviewSections(null,[{id:'a',startOn:'page',blocks:[a,a]}],10000,18000,{...services,measurePlainTextLines:async(...args)=>{calls++;return services.measurePlainTextLines(...args);}}),/duplicate preview block/);
  assert.equal(calls,1);
});
