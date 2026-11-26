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

test('retained measurement skips unchanged blocks, binds current source and ignores visual-only component changes',async()=>{
  let calls=0,placements=0;
  const svc={...services,measurePlainTextLines:async(...args)=>{calls++;return services.measurePlainTextLines(...args);},
    resolveComponentWidths:()=>({widths:new Map([['body',8000],['label',8000]]),contentWidth:8000}),
    placeComponent:()=>{placements++;return {id:'root',rect:{x:0,y:0,width:10000,height:26000},children:[]};}};
  const a=block('a','first'),b={...block('a','second'),splitPolicy:'strict',component:{direction:'column',gap:0,padding:1000,background:'#ffffff',textColor:'#000000',children:[
    {type:'label',id:'label',width:'fill',text:'ab',fontFamily:'serif',fontWeight:400,fontSize:4000,lineHeight:1.5,color:'#000000'},
    {type:'content',id:'body'}]}};
  const run=(blocks,previous,height=30000)=>measurePreviewSections(null,[{id:'a',startOn:'page',blocks}],10000,height,svc,{previous});
  const first=await run([a,b]);
  assert.equal(calls,3);assert.equal(placements,1);assert.equal(first.measurementWork.measuredBlocks,2);
  const updated={...b,origin:{...b.origin,revision:'2',range:{start:10,end:12}},sourceTextStart:10,component:{...b.component,background:'#cccccc'}};
  const second=await run([a,updated],first.measurementSnapshot);
  assert.equal(calls,3);assert.equal(placements,1);assert.equal(second.measurementWork.reusedBlocks,2);
  assert.equal(second.byKey.get(previewBlockKey(b.origin)).block,updated);
  assert.equal(second.measuredSections[0].blocks[1].origin,updated.origin);
  const third=await run([{...a,request:{...a.request,text:'xy'}},updated],second.measurementSnapshot);
  assert.equal(calls,4);assert.equal(third.measurementWork.reusedBlocks,1);
  await run([a,updated],third.measurementSnapshot,31000);
  assert.equal(calls,7);assert.equal(placements,2);
  await assert.rejects(run([a,{...updated,sourceTextStart:999}],second.measurementSnapshot),/Invalid exact source mapping/);
});
test('standalone and slot display math bypass retained value data',async()=>{
  let calls=0;
  const svc={...services,measureDisplayMath:async()=>{calls++;return {element:{},width:10000,height:6000,publicationReady:false};}};
  const math={...block('a','formula'),displayMath:true,splitPolicy:'strict'};
  const run=previous=>measurePreviewSections(null,[{id:'a',startOn:'page',blocks:[math]}],10000,30000,svc,{previous});
  const first=await run();
  const second=await run(first.measurementSnapshot);
  assert.equal(calls,2);assert.equal(second.measurementWork.bypassedBlocks,1);assert.equal(second.measurementWork.reusedBlocks,0);
  assert.equal(second.measurementSnapshot.size,0);
});
