import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextMeasurementCache,measureWithTextCache} from '../dist/text-measurement-cache.js';
function fixture(){
  const faces=[];
  const doc={defaultView:{devicePixelRatio:1},fonts:{ready:Promise.resolve(),forEach:fn=>faces.forEach(fn)}};
  let calls=0;
  const measure=async(_doc,request)=>{calls++;return {request,lines:[{start:0,end:request.text.length,height:6000}],measurement:'browser-dom-lines',publicationReady:false};};
  const request={text:'原稿',width:10000,fontFamily:'serif',fontWeight:400,fontSize:4000,lineHeight:1.5};
  const cache=createTextMeasurementCache(doc);
  const run=(r=request)=>measureWithTextCache(doc,r,cache,measure);
  return {doc,faces,cache,request,run,calls:()=>calls,measure};
}
test('hits return isolated line geometry, with bounded LRU eviction',async()=>{
  const f=fixture();
  const first=await f.run();first.lines[0].height=9;
  const second=await f.run();assert.equal(second.lines[0].height,6000);
  second.lines[0].height=8;assert.equal((await f.run()).lines[0].height,6000);
  assert.equal(f.calls(),1);
  for(let i=0;i<256;i++)await f.run({...f.request,text:'段落 '+i});
  assert.equal(f.cache.stats().entries,256);
  await f.run();assert.equal(f.calls(),258);
});
test('font environment and device scale changes invalidate existing measurements',async()=>{
  const f=fixture();await f.run();await f.run();
  f.faces.push({family:'Fixture',status:'loaded'});await f.run();await f.run();
  f.faces[0].weight='700';await f.run();
  f.doc.defaultView.devicePixelRatio=2;await f.run();
  assert.equal(f.calls(),4);assert.equal(f.cache.stats().entries,1);
});
test('changed geometry, styled requests, and foreign document never reuse old values',async()=>{
  const f=fixture();await f.run();
  for(const patch of [{fontWeight:700},{fontSize:5000},{lineHeight:1.8},{width:9000},{multiline:true},{paragraphGap:1000}])await f.run({...f.request,...patch});
  assert.equal(f.calls(),7);
  await f.run({...f.request,inlineStyles:[]});await f.run({...f.request,inlineStyles:[]});
  assert.equal(f.calls(),9);
  await assert.rejects(measureWithTextCache({},f.request,f.cache,f.measure),/another document/);
});
test('clearing during an in-flight measurement prevents late cache writes',async()=>{
  const f=fixture();let release,entered;
  const start=new Promise(r=>{entered=r;});
  const pending=measureWithTextCache(f.doc,f.request,f.cache,async(doc,r)=>{entered();await new Promise(resolve=>{release=resolve;});return f.measure(doc,r);});
  await start;f.cache.clear();release();await pending;
  assert.equal(f.cache.stats().entries,0);
});
