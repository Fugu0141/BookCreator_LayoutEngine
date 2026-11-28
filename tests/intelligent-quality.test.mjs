import test from 'node:test';
import assert from 'node:assert/strict';
import {planIntelligentLayout as full,planIntelligentLayoutIncremental as inc,
 planIntelligentLayoutIncrementalCooperative as coop,planMeasuredIntelligentLayout as measured,
 planMeasuredIntelligentLayoutIncremental as measuredInc,projectIntelligentMeasuredPlan} from '../dist/index.js';
function rng(seed){return max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};}
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const footprint=(b,content)=>({width:Math.max(b.size.width,b.sizeConstraints?.minWidth??0,Math.ceil(content.width*(b.sizeConstraints?.minWidthPercent??0)/100)),height:Math.max(b.size.height,b.sizeConstraints?.minHeight??0,Math.ceil(content.height*(b.sizeConstraints?.minHeightPercent??0)/100))+(b.spaceAfter??0)});
function verify(input,result){
 assert.equal(result.publicationReady,false);assert.equal(result.revision,input.revision);
 if(result.status==='conflict'){assert.deepEqual(result.placements,[]);return;}
 assert.deepEqual(result.placements.map(p=>p.id),input.blocks.map(b=>b.id));
 const pages=new Map();
 let prev;
 for(const [i,p] of result.placements.entries()){
  const b=input.blocks[i],r=p.rect,o=p.occupiedRect??r,f=footprint(b,input.content);
  assert.deepEqual([r.width,r.height],[b.size.width,b.size.height]);
  assert.deepEqual([o.x,o.y,o.width,o.height],[r.x,r.y,f.width,f.height]);
  assert.ok([p.page,r.x,r.y,o.width,o.height].every(Number.isSafeInteger));
  assert.ok(p.page>=0&&r.x>=0&&r.y>=0&&o.x+o.width<=input.content.width&&o.y+o.height<=input.content.height);
  if(b.fixed)assert.deepEqual([p.page,r.x,r.y],[b.fixed.page,b.fixed.x,b.fixed.y]);
  if(prev){assert.ok(p.page>=prev.page);if(b.startNewPage)assert.ok(p.page>prev.page);}
  if(b.spaceBefore){
   assert.ok(o.y>=b.spaceBefore);
   if(prev?.page===p.page)assert.ok(o.y>=(prev.occupiedRect??prev.rect).y+(prev.occupiedRect??prev.rect).height+input.gap+b.spaceBefore);
  }
  for(const region of input.reservedRegions??[])if(region.page===p.page)assert.ok(!overlaps(o,region.rect));
  const list=pages.get(p.page)??[];
  for(const old of list)assert.ok(!overlaps(o,old),'occupied rectangles cannot overlap');
  list.push(o);pages.set(p.page,list);prev=p;
 }
}
function fixture(seed,count=70){
 const random=rng(seed);
 const blocks=Array.from({length:count},(_,i)=>({id:'b'+i,size:{width:20+random(48),height:10+random(26)},
  sideBySide:random(3)!==0,startNewPage:i%13===0,spaceBefore:i%11===0?4:0,spaceAfter:i%7===0?3:0,
  ...(i%5===0?{sizeConstraints:{minWidthPercent:25,minHeightPercent:15}}:{})}));
 return {revision:'r'+seed,content:{width:120,height:160},gap:2,blocks,reservedRegions:[{id:'r0',page:0,rect:{x:0,y:0,width:35,height:40}},{id:'r1',page:2,rect:{x:85,y:30,width:35,height:80}}]};
}
test('mixed deterministic candidates preserve hard geometry and semantic order',()=>{
 for(let seed=1;seed<=30;seed++){
  const i=fixture(seed),baseline=full(i);assert.equal(baseline.status,'placed');verify(i,baseline);
  const pin=i.blocks.findIndex((b,k)=>k>0&&b.startNewPage);
  const p=baseline.placements[pin];
  // Fixed block is an independent row at its original position. Remove footprint
  // minima to avoid changing its measured size, and keep all other hard input.
  const blocks=i.blocks.map((b,k)=>k===pin?{...b,sizeConstraints:undefined,mode:'fixed',fixed:{page:p.page,x:p.rect.x,y:p.rect.y}}:b);
  const n={...i,blocks};
  const r=full(n);assert.equal(r.status,'placed');verify(n,r);
  const optimized=full(n,{});assert.equal(optimized.status,'placed');verify(n,optimized);
 }
});
test('mixed insert/delete/resize/constraint edits equal cold and cooperative layout',async()=>{
 let i=fixture(71),previous=inc(i);assert.equal(previous.layout.status,'placed');
 const random=rng(812);
 for(let step=0;step<100;step++){
  let blocks=[...i.blocks];const at=random(blocks.length);
  if(step%5===0)blocks.splice(at,0,{id:'new'+step,size:{width:25,height:20},sideBySide:true});
  else if(step%5===1)blocks.splice(at,1);
  else if(step%5===2)blocks[at]={...blocks[at],size:{...blocks[at].size,height:10+random(30)}};
  else if(step%5===3)blocks[at]={...blocks[at],sizeConstraints:{minWidthPercent:20+random(50)}};
  else blocks[at]={...blocks[at],startNewPage:!blocks[at].startNewPage};
  i={...i,revision:'edit'+step,blocks};
  const expected=full(i),r=inc(i,previous.snapshot),c=await coop(i,previous.snapshot,()=>{});
  assert.deepEqual(r.layout,expected);assert.deepEqual(c.layout,expected);
  verify(i,r.layout);
  if(r.layout.status==='placed'){assert.equal(r.reusedBlocks+r.placedBlocks,blocks.length);previous=r;}
  else assert.equal(r.snapshot,undefined);
 }
});
test('fixed and reservation changes never reuse a stale successful plan',()=>{
 const i={revision:'r',content:{width:100,height:100},gap:0,blocks:[{id:'a',size:{width:40,height:30}},{id:'pin',size:{width:20,height:20},fixed:{page:0,x:0,y:40}}]};
 const a=inc(i);assert.equal(a.layout.status,'placed');
 const n={...i,revision:'r2',reservedRegions:[{id:'keep',page:0,rect:{x:0,y:40,width:20,height:20}}]};
 const r=inc(n,a.snapshot);assert.equal(r.layout.status,'conflict');assert.equal(r.layout.diagnostic.code,'IL_RESERVED_CONFLICT');assert.deepEqual(r.layout.placements,[]);assert.equal(r.snapshot,undefined);
 const m={...i,revision:'r3',blocks:[i.blocks[0],{...i.blocks[1],fixed:{page:1,x:0,y:10}}]};
 const c=inc(m,a.snapshot);verify(m,c.layout);assert.equal(c.layout.status,'placed');assert.deepEqual(c.layout,full(m));
 assert.equal(inc(i,a.snapshot).reusedBlocks,2);
});
test('measured fragments cover all original units exactly through repeated edits',()=>{
 const random=rng(291);
 const make=(revision,changed)=>({schemaVersion:1,revision,fingerprint:'fp-'+revision,content:{width:100,height:100},sections:[{id:'s',startOn:'continuous',blocks:Array.from({length:40},(_,i)=>({kind:'block',origin:{documentId:'doc',revision,blockKey:'b'+i},width:55,unitHeights:Array.from({length:5+(i===changed?1:0)},(_,k)=>12+(i+k)%9),splitPolicy:i%2?'allow':'avoid',fragmentPadding:{top:2,bottom:3}}))}]});
 let previous;
 for(let step=0;step<30;step++){
  const i=make('r'+step,random(40)),r=measuredInc(i,{},previous);
  assert.deepEqual(r.result,measured(i));assert.equal(r.result.status,'placed');
  const p=projectIntelligentMeasuredPlan(r.result),fragments=p.pages.flatMap(page=>page.fragments);
  assert.equal(p.publicationReady,false);
  for(const b of i.sections[0].blocks){
   const own=fragments.filter(f=>f.origin.blockKey===b.origin.blockKey);let end=0;
   for(const [idx,f] of own.entries()){
    assert.equal(f.unitStart,end);assert.equal(f.continuationIndex,idx);assert.equal(f.origin.revision,i.revision);
    end=f.unitEnd;assert.equal(f.rect.height,b.unitHeights.slice(f.unitStart,end).reduce((x,y)=>x+y,5));
   }
   assert.equal(end,b.unitHeights.length);
  }
  previous=r.snapshot;
 }
});
