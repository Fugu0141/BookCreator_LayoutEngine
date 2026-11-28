// DOM rendering boundary. Receives already measured blocks and a completed
// pagination plan. No measuring, font loading, pagination or resource decoding.
import {prioritizePages} from './preview-page-priority.js';
import {createProvisionalPageDelivery,type ProvisionalPageReceiver} from './preview-page-delivery.js';
import {imageSourceRect} from './image-crop.js';
import type {MeasuredDisplayMath} from './math-preview.js';
import type {MeasuredPagePlan,MeasuredPage,Origin} from './pagination.js';
import type {PlainTextMeasureRequest} from './browser-measurement.js';
import type {MeasuredTextLine,MeasuredTextLines,PreviewTextBlock,PreviewTextSlice,PreviewComponentChild,PreviewListItem,TextPagePreview,PreviewCheckpoint} from './browser-lines.js';
type ComponentPlacement=import('./tree.js').PlacedNode;
export interface MeasuredPreviewBlock {
  block:PreviewTextBlock;measurement:MeasuredTextLines;
  labels:Map<string,MeasuredTextLines>;slots:Map<string,MeasuredTextLines>;
  placement?:ComponentPlacement;marker?:MeasuredTextLines;math?:MeasuredDisplayMath;
}
export type PreviewPaper={width:number;height:number;top:number;bottom:number;inner:number;outer:number;firstSide:'right'|'left'};
interface RenderServices{
  styleText(el:HTMLElement,r:PlainTextMeasureRequest,wrap:boolean):void;
  frozenText(el:HTMLElement,r:PlainTextMeasureRequest,line:MeasuredTextLine):void;
  listInset(item:PreviewListItem):number;
}
/** Detached page templates are never exposed to hosts. Each hit returns a fresh
 * clone; navigation and original source ranges are rebuilt from the current plan.
 * Only resource-free plain text pages are eligible in this first implementation. */
export interface PageRenderCache {
  clear():void;
  stats():{entries:number;characters:number;nodes:number;hits:number;misses:number;bypasses:number};
}
/** Opaque document-owned metadata for one successfully published base paper.
 * No DOM nodes are retained. The host must discard it on session/font changes. */
export interface PageReuseSnapshot {readonly kind:'page-reuse-snapshot'}
export interface PageRenderDelta {
  readonly snapshot:PageReuseSnapshot;
  /** Zero-based plan indices omitted from the detached result's shadow root. */
  readonly reusedPageIndices:readonly number[];
}
const reuseSnapshots=new WeakMap<PageReuseSnapshot,{document:Document;keys:ReadonlyMap<number,string>}>();
export function previousPageKeys(document:Document,snapshot?:PageReuseSnapshot):ReadonlyMap<number,string>{
  if(snapshot===undefined)return new Map();
  const state=reuseSnapshots.get(snapshot);
  if(!state||state.document!==document)throw Error('Page reuse snapshot belongs to another document or is invalid');
  return state.keys;
}
function makePageDelta(document:Document,keys:ReadonlyMap<number,string>,reused:number[]):PageRenderDelta{
  const snapshot:PageReuseSnapshot=Object.freeze({kind:'page-reuse-snapshot'});
  reuseSnapshots.set(snapshot,{document,keys});
  return Object.freeze({snapshot,reusedPageIndices:Object.freeze(reused)});
}
type PageEntry={template:HTMLElement;characters:number;nodes:number};
type PageCacheState={document:Document;entries:Map<string,PageEntry>;characters:number;nodes:number;hits:number;misses:number;bypasses:number;epoch:number};
const pageCaches=new WeakMap<PageRenderCache,PageCacheState>();
const pageLimits={entries:64,characters:250000,nodes:20000};
export function createPageRenderCache(document:Document):PageRenderCache{
  const state:PageCacheState={document,entries:new Map(),characters:0,nodes:0,hits:0,misses:0,bypasses:0,epoch:0};
  const cache:PageRenderCache={
    clear(){state.entries.clear();state.characters=0;state.nodes=0;state.hits=0;state.misses=0;state.bypasses=0;state.epoch++;},
    stats(){return {entries:state.entries.size,characters:state.characters,nodes:state.nodes,hits:state.hits,misses:state.misses,bypasses:state.bypasses};}
  };
  pageCaches.set(cache,state);return Object.freeze(cache);
}
/** A lease prevents an asynchronous old preview from writing after clear. */
export function pageRenderCacheEpoch(document:Document,cache:PageRenderCache):number{
  const state=pageCaches.get(cache);
  if(!state||state.document!==document)throw Error('Page render cache belongs to another document');
  return state.epoch;
}
function dropPage(state:PageCacheState,key:string){
  const old=state.entries.get(key);if(!old)return;
  state.entries.delete(key);state.characters-=old.characters;state.nodes-=old.nodes;
}
function keepPage(state:PageCacheState,key:string,page:HTMLElement){
  // Count actual descendants (including text nodes) and retained key length.
  let nodes=1;const walker=state.document.createTreeWalker(page,0xffffffff);
  while(walker.nextNode())if(++nodes>pageLimits.nodes)return;
  if(key.length>pageLimits.characters)return;
  dropPage(state,key);
  state.entries.set(key,{template:page.cloneNode(true) as HTMLElement,characters:key.length,nodes});
  state.characters+=key.length;state.nodes+=nodes;
  while(state.entries.size>pageLimits.entries||state.characters>pageLimits.characters||state.nodes>pageLimits.nodes)dropPage(state,state.entries.keys().next().value!);
}
/** Serialize only fields consumed by the renderer. Exclude revisions and raw
 * source ranges, which affect slices/navigation, not the template. */
function pageKey(p:MeasuredPage,width:number,height:number,paper:PreviewPaper|undefined,byKey:ReadonlyMap<string,MeasuredPreviewBlock>,plainOnly=false):string|undefined{
  const fragments=[];
  for(const f of p.fragments){
    const entry=byKey.get(previewBlockKey(f.origin));
    if(!entry)throw Error('Missing preview block');
    const {block,measurement,math}=entry;
    if(math||block.component||block.listItem||measurement.lines.some(l=>l.displayMath)||(plainOnly&&measurement.request.inlineMath!==undefined))return undefined;
    const r=measurement.request,lines=measurement.lines.slice(f.unitStart,f.unitEnd);
    if(!lines.length)throw Error('Missing preview lines');
    fragments.push([f.origin.documentId,f.origin.blockKey,[f.rect.x,f.rect.y,f.rect.width,f.rect.height],
      [r.text,r.width,r.fontSize,r.fontFamily,r.fontWeight??400,r.lineHeight,r.mathFontFamily??'auto',
        r.inlineStyles?.map(s=>[s.start,s.end,s.fontFamily,s.fontWeight,s.italic,s.underline,s.color,s.fontSize,s.baseline]),
        r.inlineMath?.map(a=>[a.start,a.formula])],
      lines.map(l=>[l.start,l.end,l.height])]);
  }
  return JSON.stringify([1,p.index,width,height,paper?[paper.width,paper.height,paper.top,paper.bottom,paper.inner,paper.outer,paper.firstSide]:null,fragments]);
}
const px=(um:number)=>um*96/25400;
export const previewBlockKey=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
// Internal ownership contract: math nodes are consumed by this render; bitmaps
// are borrowed for this call (including optional cooperative waits), and closed by their owning orchestrator.
export async function renderMeasuredPreview(document:Document,plan:MeasuredPagePlan,{width,height,paper,byKey,images,pageCache,pageCacheEpoch,delta}:{width:number;height:number;paper?:PreviewPaper;byKey:ReadonlyMap<string,MeasuredPreviewBlock>;images:ReadonlyMap<string,ImageBitmap>;pageCache?:PageRenderCache;pageCacheEpoch?:number;delta?:{previousKeys:ReadonlyMap<number,string>;allowInlineMath?:boolean}},{styleText,frozenText,listInset}:RenderServices,checkpoint?:PreviewCheckpoint,priorityPages?:readonly number[],onPriorityPage?:ProvisionalPageReceiver):Promise<TextPagePreview & {pageDelta?:PageRenderDelta}>{
  let renderedImagePixels=0;
  const element=document.createElement('div');element.style.cssText='all:initial;display:block;';
  const root=element.attachShadow({mode:'open'});
  const slices:PreviewTextSlice[]=[];
  const candidateState=pageCache?pageCaches.get(pageCache):undefined;
  if(pageCache&&(!candidateState||candidateState.document!==document))throw Error('Page render cache belongs to another document');
  const state=candidateState&&candidateState.epoch===pageCacheEpoch?candidateState:undefined;
  const nextKeys=new Map<number,string>(),reused:number[]=[];
  let keyCharacters=0;
  function admitKey(p:MeasuredPage){
    // Inline atoms are recreated from their source and font family by frozenText.
    // The existing render key already includes both plus the measured line geometry.
    // Keep legacy sparse eligibility unchanged; isolated display nodes, components
    // and lists remain excluded in either mode.
    const deltaKey=delta?pageKey(p,width,height,paper,byKey,!delta.allowInlineMath):undefined;
    if(deltaKey!==undefined&&nextKeys.size<pageLimits.entries&&keyCharacters+deltaKey.length<=pageLimits.characters){
      nextKeys.set(p.index,deltaKey);keyCharacters+=deltaKey.length;
    }
  }
  // Preserve canonical admission under the bounded sparse-key budget even
  // when the viewport requests a different drawing order.
  if(priorityPages)for(const p of plan.pages){
    // Preserve canonical key admission, but allow cancellation before each page.
    const wait=checkpoint?.('render-key-page',p.index);if(wait)await wait;
    admitKey(p);
  }
  const ordered=prioritizePages(plan.pages,priorityPages);
  const drawn=new Map<number,HTMLElement>();
  const deliver=onPriorityPage?createProvisionalPageDelivery(priorityPages,onPriorityPage):undefined;
  for(const p of ordered){
    if(checkpoint)await checkpoint('render-page',p.index);
    if(!priorityPages)admitKey(p);
    const deltaKey=nextKeys.get(p.index);
    const skip=delta!==undefined&&deltaKey!==undefined&&delta.previousKeys.get(p.index)===deltaKey;
    if(skip)reused.push(p.index);
    const key=state?pageKey(p,width,height,paper,byKey):undefined;
    const cached=key!==undefined?state!.entries.get(key):undefined;
    if(state){
      if(key===undefined)state.bypasses++;
      else if(cached){state.hits++;state.entries.delete(key);state.entries.set(key,cached);}
      else state.misses++;
    }
    const page=skip?undefined:cached?cached.template.cloneNode(true) as HTMLElement:document.createElement('div');
    const right=(p.index%2===0)===(paper?.firstSide!=='left');
    const left=paper?(right?paper.inner:paper.outer):0,top=paper?.top??0;
    if(page){
      page.dataset.page=String(p.index);
      page.style.cssText='all:initial;display:block;position:relative;box-sizing:content-box;background:white;color:black;border:1px solid #888;margin:0 0 12px 0;overflow:visible;';
      page.dataset.side=right?'right':'left';
      page.style.width=px(paper?.width??width)+'px';page.style.height=px(paper?.height??height)+'px';
      if(paper&&!cached){const guide=document.createElement('div');guide.dataset.contentGuide='true';guide.style.cssText='position:absolute;box-sizing:border-box;outline:1px dashed #ccc;pointer-events:none;';Object.assign(guide.style,{left:px(left)+'px',top:px(top)+'px',width:px(width)+'px',height:px(height)+'px'});page.append(guide);}
    }
    for(const f of p.fragments){
      // Even omitted pages rebuild source slices, so both paths cooperate.
      const wait=checkpoint?.('render-fragment',p.index);if(wait)await wait;
      const entry=byKey.get(previewBlockKey(f.origin));if(!entry)throw Error('Missing preview block');
      const {block,measurement,labels,slots,placement,marker,math}=entry, lineUnits=placement?measurement.lines:measurement.lines.slice(f.unitStart,f.unitEnd);
      if(!lineUnits.length)throw Error('Missing preview lines');
      const textStart=lineUnits[0].start,textEnd=lineUnits.at(-1)!.end;
      // Origin may refer to markup; only a caller-verified contiguous mapping enables raw source ranges.
      const sourceSlice=block.sourceTextStart===undefined?undefined:{start:block.sourceTextStart+textStart,end:block.sourceTextStart+textEnd};
      const namedSlots=(block.namedSlots??[]).map(s=>({name:s.name,textStart:0,textEnd:s.request.text.length,...(s.sourceTextStart===undefined?{}:{sourceSlice:{start:s.sourceTextStart,end:s.sourceTextStart+s.request.text.length}})}));
      slices.push({pageIndex:p.index,origin:f.origin,textStart,textEnd,...(sourceSlice?{sourceSlice}:{}),...(namedSlots.length?{namedSlots}:{})});
      if(!page||cached)continue; // Slices above always describe the current source revision.
      const fragment=document.createElement('div');fragment.dataset.block=f.origin.blockKey;fragment.dataset.document=f.origin.documentId;
      fragment.style.cssText='all:initial;display:block;position:absolute;box-sizing:border-box;';
      Object.assign(fragment.style,{left:px(left+f.rect.x)+'px',top:px(top+f.rect.y)+'px',width:px(f.rect.width)+'px',height:px(f.rect.height)+'px'});
      if(math){
        fragment.dataset.displayMath='true';
        math.element.dataset.start='0';math.element.dataset.end=String(block.request.text.length);
        fragment.append(math.element);page.append(fragment);continue;
      }
      let textParent=fragment;
      if(block.listItem&&marker){
        const item=block.listItem,inset=listInset(item);
        fragment.dataset.listItem=item.kind;fragment.dataset.listDepth=String(item.depth);
        if(f.unitStart===0){
          const mark=document.createElement('div');styleText(mark,marker.request,false);
          Object.assign(mark.style,{position:'absolute',left:px(item.depth*item.indentStep)+'px',top:'0px',height:px(marker.lines[0].height)+'px',textAlign:'right'});
          mark.dataset.listMarker='true';mark.setAttribute('aria-hidden','true');mark.textContent=marker.request.text;
          fragment.append(mark);
        }
        const body=document.createElement('div');body.dataset.listBody='true';
        body.style.cssText='all:initial;display:block;position:absolute;box-sizing:border-box;';
        Object.assign(body.style,{left:px(inset)+'px',top:'0px',width:px(measurement.request.width)+'px',height:px(f.rect.height)+'px'});
        fragment.append(body);textParent=body;
      }
      if(placement&&block.component){
        const c=block.component;fragment.dataset.component='true';fragment.style.background=c.background;
        function renderChildren(children:readonly PreviewComponentChild[],placed:ComponentPlacement,parent:HTMLElement){
        for(const child of children){
          const node=placed.children.find(n=>n.id===child.id)!,rect=node.rect;
          const el=document.createElement('div');el.style.cssText='all:initial;position:absolute;display:block;box-sizing:border-box;';
          Object.assign(el.style,{left:px(rect.x)+'px',top:px(rect.y)+'px',width:px(rect.width)+'px',height:px(rect.height)+'px'});
          el.dataset.componentNode=child.id;
          if(child.type==='rect'){el.style.background=child.color;el.setAttribute('aria-hidden','true');}
          else if(child.type==='image'){
            el.dataset.componentImage=child.assetId;
            const bitmap=images.get(child.assetId)!;
            // Raster dimensions follow source pixels, not layout CSS pixels; fit does not distort the image.
            const canvas=document.createElement('canvas');
            const ratio=rect.width/rect.height;
            const source=imageSourceRect(bitmap.width,bitmap.height,rect.width,rect.height,child.fit,child.crop);
            const sw=source.width,sh=source.height;
            const scale=Math.min(1,2048/Math.max(sw,sh));
            canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
            if((renderedImagePixels+=canvas.width*canvas.height)>64000000)throw RangeError('Rendered image pixel limit exceeded');
            const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image canvas unavailable');
            ctx.drawImage(bitmap,source.x,source.y,sw,sh,0,0,canvas.width,canvas.height);
            canvas.style.cssText='all:initial;position:absolute;display:block;left:50%;top:50%;transform:translate(-50%,-50%);';
            const boxRatio=child.fit==='cover'?ratio:sw/sh;
            const w=Math.min(rect.width,rect.height*boxRatio),h=Math.min(rect.height,rect.width/boxRatio);
            canvas.style.width=px(w)+'px';canvas.style.height=px(h)+'px';
            if(child.alt){canvas.setAttribute('role','img');canvas.setAttribute('aria-label',child.alt);}else canvas.setAttribute('aria-hidden','true');
            el.append(canvas);
          }
          else if(child.type==='group'){el.dataset.componentGroup='true';if(child.direction==='canvas')el.dataset.componentCanvas='true';el.style.background=child.background;renderChildren(child.children,node,el);}
          else if(child.type==='label'){
            el.dataset.fixedLabel='true';
            const measured=labels.get(child.id)!;
            for(const line of measured.lines){
              const item=document.createElement('div');styleText(item,measured.request,false);item.style.height=px(line.height)+'px';item.style.color=child.color;frozenText(item,measured.request,line);el.append(item);
            }
          }else if(child.type==='slot'){
            el.dataset.namedSlot=child.name;
            const measured=slots.get(child.name)!;
            for(const line of measured.lines){
              const item=document.createElement('div');styleText(item,measured.request,false);item.style.height=px(line.height)+'px';item.style.color=child.color;
              item.dataset.start=String(line.start);item.dataset.end=String(line.end);frozenText(item,measured.request,line);el.append(item);
            }
          }else{textParent=el;el.dataset.contentSlot='true';}
          parent.append(el);
        }}
        renderChildren(c.children,placement,fragment);
      }else if(block.component){
        const c=block.component;fragment.dataset.component='true';fragment.dataset.fragmentableFrame='true';fragment.style.background=c.background;
        const slot=document.createElement('div');slot.dataset.componentNode=c.children[0].id;slot.dataset.contentSlot='true';
        slot.style.cssText='all:initial;position:absolute;display:block;box-sizing:border-box;';
        Object.assign(slot.style,{left:px(c.padding)+'px',top:px(c.padding)+'px',width:px(f.rect.width-2*c.padding)+'px',height:px(f.rect.height-2*c.padding)+'px'});
        fragment.append(slot);textParent=slot;
      }
      for(const line of lineUnits){
        // Await only when the host actually requests an asynchronous task.
        const wait=checkpoint?.('render-line',p.index);if(wait)await wait;
        const item=document.createElement('div');styleText(item,measurement.request,false);item.style.height=px(line.height)+'px';
        item.dataset.start=String(line.start);item.dataset.end=String(line.end);
        frozenText(item,measurement.request,line);if(block.component)item.style.color=block.component.textColor;textParent.append(item);
      }
      page.append(fragment);
    }
    if(page){
      if(state&&key!==undefined&&!cached)keepPage(state,key,page);
      if(priorityPages)drawn.set(p.index,page);else root.append(page);
      if(deliver)await deliver(page,p.index,plan.pages.length);
    }
  }
  if(priorityPages){
    for(const p of plan.pages){const page=drawn.get(p.index);if(page)root.append(page);}
    slices.sort((a,b)=>a.pageIndex-b.pageIndex);
    reused.sort((a,b)=>a-b);
  }
  return {element,plan,slices,publicationReady:false,...(delta?{pageDelta:makePageDelta(document,nextKeys,reused)}:{})};
}
