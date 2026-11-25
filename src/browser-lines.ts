import {paginateMeasured,type Origin,type MeasuredPagePlan,type SplitPolicy} from './pagination.js';
import type {PlainTextMeasureRequest} from './browser-measurement.js';

export interface MeasuredTextLine {
  /** UTF-16 offsets in the original logical text, not a transformed Markdown source. */
  start:number; end:number; height:number;
}
export interface MeasuredTextLines {
  request:Readonly<PlainTextMeasureRequest>;
  lines:readonly MeasuredTextLine[];
  measurement:'browser-dom-lines';
  publicationReady:false;
}
const px=(um:number)=>um*96/25400;
const um=(css:number)=>Math.ceil(css*25400/96);
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;
function validate(request:PlainTextMeasureRequest){
  if(typeof request.text!=='string'||!request.text.length||request.text.length>10000||
    /[\p{Cc}\p{Cs}\p{Cf}\p{Zl}\p{Zp}]/u.test(request.text)||
    !positive(request.width)||request.width>2000000||!positive(request.fontSize)||request.fontSize>100000||
    !['serif','sans-serif','monospace'].includes(request.fontFamily)||!Number.isFinite(request.lineHeight)||request.lineHeight<1.25||request.lineHeight>4)
    throw new RangeError('Unsupported plain line measurement request');
}
function styleText(el:HTMLElement,r:PlainTextMeasureRequest,wrap:boolean){
  el.style.cssText='all:initial;display:block;box-sizing:border-box;padding:0;border:0;margin:0;overflow-wrap:anywhere;word-break:normal;writing-mode:horizontal-tb;direction:ltr;text-align:start;font-kerning:none;font-variant-ligatures:none;';
  el.style.width=px(r.width)+'px';el.style.fontSize=px(r.fontSize)+'px';el.style.fontFamily=r.fontFamily;
  el.style.lineHeight=px(r.fontSize*r.lineHeight)+'px';
  el.style.whiteSpace=wrap?'break-spaces':'pre';
}
function live(document:Document){
  if(!document.body||!document.defaultView||!document.fonts)throw Error('A live browser document is required');
}
// Grapheme ranges, real browser wrapping, bounded input. Reject ambiguous geometry instead of guessing.
export async function measurePlainTextLines(document:Document,request:PlainTextMeasureRequest):Promise<MeasuredTextLines>{
  live(document);validate(request);
  const r=Object.freeze({...request});
  const host=document.createElement('div');
  host.style.cssText='all:initial;position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;contain:layout style paint;display:block;';
  const root=host.attachShadow({mode:'closed'}), el=document.createElement('div');
  styleText(el,r,true);const node=document.createTextNode(r.text);el.append(node);root.append(el);document.body.append(host);
  try{
    el.getBoundingClientRect();await document.fonts.ready;
    const height=el.getBoundingClientRect().height;
    const linePx=px(r.fontSize*r.lineHeight);
    const count=Math.round(height/linePx);
    if(count<1||Math.abs(height-count*linePx)>Math.max(1,count/32)||el.scrollWidth>el.clientWidth+1)
      throw Error('Unsupported line box geometry');
    const groups:{start:number;end:number}[]=[];
    let firstCenter:number|undefined;
    const range=document.createRange();
    for(const g of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(r.text)){
      range.setStart(node,g.index);range.setEnd(node,g.index+g.segment.length);
      const rects=Array.from(range.getClientRects());
      if(!rects.length||rects.some(q=>!Number.isFinite(q.top)||!Number.isFinite(q.height)))throw Error('Missing grapheme geometry');
      const center=rects[0].top+rects[0].height/2;firstCenter??=center;
      const row=Math.round((center-firstCenter)/linePx);
      if(rects.some(q=>Math.round((q.top+q.height/2-firstCenter!)/linePx)!==row)||row<0||row>=count||row<groups.length-1||row>groups.length)
        throw Error('Ambiguous grapheme line order');
      const end=g.index+g.segment.length;
      if(row===groups.length)groups.push({start:g.index,end});else groups[row].end=end;
    }
    if(groups.length!==count||groups[0]?.start!==0||groups.at(-1)?.end!==r.text.length||groups.some((g,i)=>i>0&&g.start!==groups[i-1].end))throw Error('Incomplete line mapping');
    // Re-render each frozen line without reflow. Reject horizontal overflow rather than clipping it.
    const lines:MeasuredTextLine[]=[];
    for(const group of groups){
      const line=document.createElement('div');styleText(line,r,false);line.textContent=r.text.slice(group.start,group.end);root.append(line);
      const rect=line.getBoundingClientRect();
      if(line.scrollWidth>line.clientWidth+1||Math.abs(rect.height-linePx)>1)throw Error('Frozen line does not fit measured geometry');
      lines.push({...group,height:um(Math.max(linePx,rect.height,height/count))});
      line.remove();
    }
    return {request:r,lines,measurement:'browser-dom-lines',publicationReady:false};
  }finally{host.remove();}
}
export interface PreviewTextBlock {
  origin:Origin; request:PlainTextMeasureRequest; splitPolicy:SplitPolicy;
}
export interface PreviewTextSlice {
  pageIndex:number; origin:Origin; textStart:number; textEnd:number;
  /** Source offsets are available only if caller supplied an exact contiguous source slice. */
  sourceSlice?:{start:number;end:number};
}
export interface TextPagePreview {
  element:HTMLElement; plan:MeasuredPagePlan; slices:readonly PreviewTextSlice[];
  publicationReady:false;
}
// Single section, plain text only. Caller owns the exact mapping of logical text to raw source.
// No external HTML, CSS, resource fetching or publication output.
export async function createPlainTextPagePreview(document:Document,options:{
  revision:string;fingerprint:string;width:number;height:number;
  blocks:readonly PreviewTextBlock[];
}):Promise<TextPagePreview>{
  live(document);
  if(!positive(options.width)||!positive(options.height)||options.width>2000000||options.height>2000000||
    options.blocks.length<1||options.blocks.length>128||options.blocks.reduce((n,b)=>n+b.request.text.length,0)>50000)
    throw RangeError('Invalid or oversized preview');
  const byKey=new Map<string,{block:PreviewTextBlock;measurement:MeasuredTextLines}>();
  const key=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
  const blocks=[];
  for(const b of options.blocks){
    const k=key(b.origin);if(byKey.has(k)||b.request.width>options.width)throw Error('Invalid or duplicate preview block');
    const measurement=await measurePlainTextLines(document,b.request);
    byKey.set(k,{block:b,measurement});
    blocks.push({kind:'block' as const,origin:b.origin,width:b.request.width,unitHeights:measurement.lines.map(l=>l.height),splitPolicy:b.splitPolicy});
  }
  const plan=paginateMeasured({schemaVersion:1,revision:options.revision,fingerprint:options.fingerprint,content:{width:options.width,height:options.height},sections:[{id:'preview',startOn:'page',blocks}]});
  if(plan.completeness!=='full')throw Error('Cannot render partial preview: '+plan.diagnostics.map(d=>d.code).join(', '));
  const element=document.createElement('div');element.style.cssText='all:initial;display:block;';
  const root=element.attachShadow({mode:'open'});
  const slices:PreviewTextSlice[]=[];
  for(const p of plan.pages){
    const page=document.createElement('div');page.dataset.page=String(p.index);
    page.style.cssText='all:initial;display:block;position:relative;box-sizing:content-box;background:white;color:black;border:1px solid #888;margin:0 0 12px 0;overflow:visible;';
    page.style.width=px(options.width)+'px';page.style.height=px(options.height)+'px';
    for(const f of p.fragments){
      const entry=byKey.get(key(f.origin));if(!entry)throw Error('Missing preview block');
      const {block,measurement}=entry, lineUnits=measurement.lines.slice(f.unitStart,f.unitEnd);
      if(!lineUnits.length)throw Error('Missing preview lines');
      const textStart=lineUnits[0].start,textEnd=lineUnits.at(-1)!.end;
      // Origin may refer to markup, so the default is logical text offsets only.
      slices.push({pageIndex:p.index,origin:f.origin,textStart,textEnd});
      const fragment=document.createElement('div');fragment.dataset.block=f.origin.blockKey;
      fragment.style.cssText='all:initial;display:block;position:absolute;box-sizing:border-box;';
      Object.assign(fragment.style,{left:px(f.rect.x)+'px',top:px(f.rect.y)+'px',width:px(f.rect.width)+'px',height:px(f.rect.height)+'px'});
      for(const line of lineUnits){
        const item=document.createElement('div');styleText(item,block.request,false);item.style.height=px(line.height)+'px';
        item.dataset.start=String(line.start);item.dataset.end=String(line.end);
        item.textContent=block.request.text.slice(line.start,line.end);fragment.append(item);
      }
      page.append(fragment);
    }
    root.append(page);
  }
  return {element,plan,slices,publicationReady:false};
}
