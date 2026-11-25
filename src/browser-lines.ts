import {validateImageCrop,imageSourceRect,type ImageCrop} from './image-crop.js';
import {layoutTree} from './tree.js';
import {applyPreviewFont,readyPreviewFont,isPreviewFontFamily,isPreviewFontWeight} from './preview-font.js';
import {paginateMeasured,type Origin,type MeasuredPagePlan,type SplitPolicy,type PageBreak,type MeasuredSection} from './pagination.js';
import type {PlainTextMeasureRequest,InlineStyleRun} from './browser-measurement.js';

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
    (request.multiline!==undefined&&typeof request.multiline!=='boolean')||
    (request.paragraphGap!==undefined&&(!request.multiline||!Number.isSafeInteger(request.paragraphGap)||request.paragraphGap<0||request.paragraphGap>30000))||
    /[\p{Cc}\p{Cs}\p{Cf}\p{Zl}\p{Zp}]/u.test(request.multiline?request.text.replace(/\r\n|\n/g,''):request.text)||
    (request.multiline&&(!request.text.replace(/\r\n|\n/g,'').trim()||(request.text.match(/\n/g)?.length??0)>255))||
    !positive(request.width)||request.width>2000000||!positive(request.fontSize)||request.fontSize>100000||
    !isPreviewFontFamily(request.fontFamily)||!isPreviewFontWeight(request.fontWeight)||!Number.isFinite(request.lineHeight)||request.lineHeight<1.25||request.lineHeight>4)
    throw new RangeError('Unsupported plain line measurement request');
}
// Validate a bounded, ordered interval list before any asynchronous measurement.
function snapshotRequest(r:PlainTextMeasureRequest):Readonly<PlainTextMeasureRequest>{
  validate(r);
  if(r.inlineStyles===undefined)return Object.freeze({...r});
  if(!Array.isArray(r.inlineStyles)||r.inlineStyles.length>128)throw RangeError('Invalid inline style limit');
  const boundaries=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(r.text)].map(g=>g.index));boundaries.add(r.text.length);
  let previous=0;
  const runs=r.inlineStyles.map(run=>{
    if(!run||typeof run!=='object'||Object.keys(run).some(k=>!['start','end','fontFamily','fontWeight','italic','underline','color','fontSize','baseline'].includes(k))||
      !Number.isSafeInteger(run.start)||!Number.isSafeInteger(run.end)||run.start<previous||run.end<=run.start||!boundaries.has(run.start)||!boundaries.has(run.end)||
      (run.fontFamily!==undefined&&!isPreviewFontFamily(run.fontFamily))||!isPreviewFontWeight(run.fontWeight)||
      (run.italic!==undefined&&typeof run.italic!=='boolean')||(run.underline!==undefined&&typeof run.underline!=='boolean')||
      (run.fontSize!==undefined&&(!Number.isSafeInteger(run.fontSize)||run.fontSize<1000||run.fontSize>30000))||
      (run.baseline!==undefined&&run.baseline!=='normal'&&run.baseline!=='super'&&run.baseline!=='sub')||
      (run.color!==undefined&&(typeof run.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(run.color))))throw RangeError('Invalid inline style range or property');
    previous=run.end;return Object.freeze({...run});
  });
  return Object.freeze({...r,inlineStyles:Object.freeze(runs)});
}
function slicedRuns(r:PlainTextMeasureRequest,start:number,end:number):InlineStyleRun[]|undefined{
  return r.inlineStyles?.filter(s=>s.start<end&&s.end>start).map(s=>({...s,start:Math.max(s.start,start)-start,end:Math.min(s.end,end)-start}));
}
/** Use identical typed spans for wrapping, frozen-line validation and final page rendering. */
function appendStyled(el:HTMLElement,r:PlainTextMeasureRequest,start:number,end:number){
  const segments:{start:number;end:number;node:Text}[]=[];
  const append=(a:number,b:number,run?:InlineStyleRun)=>{
    if(a===b)return;
    const node=el.ownerDocument.createTextNode(r.text.slice(a,b));
    if(run){
      const span=el.ownerDocument.createElement('span');
      span.dataset.inlineStyle='true';
      applyPreviewFont(span,run.fontFamily??r.fontFamily,run.fontWeight??r.fontWeight);
      // Upright-only project fonts may use browser-synthesized slant, not synthesized weight.
      if(run.italic){span.style.fontStyle='italic';span.style.fontSynthesis='style';}
      if(run.underline)span.style.textDecorationLine='underline';
      if(run.color)span.style.color=run.color;
      if(run.fontSize!==undefined||(run.baseline&&run.baseline!=='normal')){
        const size=run.fontSize??Math.round(r.fontSize*.7);
        span.style.fontSize=px(size)+'px';span.style.lineHeight=px(size*r.lineHeight)+'px';
      }
      if(run.baseline)span.style.verticalAlign=run.baseline;
      span.append(node);el.append(span);
    }else el.append(node);
    segments.push({start:a,end:b,node});
  };
  let cursor=start;
  for(const run of r.inlineStyles??[]){
    const a=Math.max(start,run.start),b=Math.min(end,run.end);
    if(a>=b)continue;
    append(cursor,a);append(a,b,run);cursor=b;
  }
  append(cursor,end);return segments;
}
function styleText(el:HTMLElement,r:PlainTextMeasureRequest,wrap:boolean){
  el.style.cssText='all:initial;display:block;box-sizing:border-box;padding:0;border:0;margin:0;overflow-wrap:anywhere;word-break:normal;writing-mode:horizontal-tb;direction:ltr;text-align:start;font-kerning:none;font-variant-ligatures:none;';
  el.style.width=px(r.width)+'px';el.style.fontSize=px(r.fontSize)+'px';applyPreviewFont(el,r.fontFamily,r.fontWeight);
  el.style.lineHeight=px(r.fontSize*r.lineHeight)+'px';
  el.style.whiteSpace=wrap?'break-spaces':'pre';
}
type StyledSegment=ReturnType<typeof appendStyled>[number];
type GlyphBox={start:number;end:number;left:number;right:number;top:number;bottom:number};
/** Variable line boxes cannot be inferred from a single fixed pitch or glyph center.
 * Recover candidate LTR rows using advance resets, then independently verify every
 * frozen row against the actual wrapped DOM, including its natural height. */
function glyphBoxes(document:Document,r:PlainTextMeasureRequest,segments:StyledSegment[],start:number,end:number,rect:DOMRect):GlyphBox[]{
  const range=document.createRange(),boxes:GlyphBox[]=[];let i=0;
  for(const g of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(r.text.slice(start,end))){
    const a=start+g.index,b=a+g.segment.length;
    while(i<segments.length&&segments[i].end<=a)i++;
    const seg=segments[i];if(!seg||a<seg.start||b>seg.end)throw Error('Style crosses grapheme boundary');
    range.setStart(seg.node,a-seg.start);range.setEnd(seg.node,b-seg.start);
    const rs=Array.from(range.getClientRects());
    if(rs.length!==1||!['left','right','top','bottom'].every(k=>Number.isFinite(rs[0][k as 'left'|'right'|'top'|'bottom'])))throw Error('Ambiguous variable-height glyph geometry');
    const q=rs[0];boxes.push({start:a,end:b,left:q.left-rect.left,right:q.right-rect.left,top:q.top-rect.top,bottom:q.bottom-rect.top});
  }
  return boxes;
}
function measureVariableLines(document:Document,root:ShadowRoot,el:HTMLElement,r:PlainTextMeasureRequest,segments:StyledSegment[]):MeasuredTextLine[]{
  const rect=el.getBoundingClientRect(),glyphs=glyphBoxes(document,r,segments,0,r.text.length,rect);
  if(!glyphs.length||rect.height<=0||el.scrollWidth>el.clientWidth+1)throw Error('Invalid variable line geometry');
  const groups:GlyphBox[][]=[];
  for(const glyph of glyphs){
    const group=groups.at(-1),prev=group?.at(-1);
    // This experimental path supports simple left-to-right advances only.
    if(glyph.right-glyph.left<=0||glyph.left< -1||glyph.right>rect.width+1)throw Error('Unsupported variable-height glyph advance');
    if(!prev||glyph.left<prev.right-.25){
      if(Math.abs(glyph.left)>1)throw Error('Ambiguous variable-height line break');
      groups.push([glyph]);
    }else group!.push(glyph);
  }
  const lines:MeasuredTextLine[]=[];let top=0;
  for(const group of groups){
    const start=group[0].start,end=group.at(-1)!.end;
    const line=document.createElement('div');styleText(line,r,false);
    const rowSegments=appendStyled(line,r,start,end);root.append(line);
    const q=line.getBoundingClientRect(),row=glyphBoxes(document,r,rowSegments,start,end,q);
    if(q.height<=0||line.scrollWidth>line.clientWidth+1||row.length!==group.length||
      row.some((g,i)=>Math.abs(g.left-group[i].left)>1||Math.abs(g.right-group[i].right)>1||
        Math.abs(g.top+top-group[i].top)>1||Math.abs(g.bottom+top-group[i].bottom)>1||
        g.top< -1||g.bottom>q.height+1))throw Error('Frozen variable-height line does not match wrapped geometry');
    lines.push({start,end,height:um(q.height)});top+=q.height;line.remove();
  }
  if(Math.abs(top-rect.height)>1||lines[0].start!==0||lines.at(-1)!.end!==r.text.length||lines.some((l,i)=>i>0&&l.start!==lines[i-1].end))throw Error('Incomplete variable-height line mapping');
  return lines;
}
function live(document:Document){
  if(!document.body||!document.defaultView||!document.fonts)throw Error('A live browser document is required');
}
// Grapheme ranges, real browser wrapping, bounded input. Reject ambiguous geometry instead of guessing.
export async function measurePlainTextLines(document:Document,request:PlainTextMeasureRequest):Promise<MeasuredTextLines>{
  live(document);const r=snapshotRequest(request);
  if(r.multiline&&r.text.includes('\n')){
    const lines:MeasuredTextLine[]=[];let start=0;
    // Measure hard lines independently, then attach each original separator to its preceding row.
    for(const match of r.text.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)){
      const raw=match[0];if(!raw)continue;
      const body=raw.replace(/(?:\r\n|\n)$/,'');
      if(body.length){
        const measured=await measurePlainTextLines(document,{...r,text:body,multiline:false,paragraphGap:undefined,inlineStyles:slicedRuns(r,start,start+body.length)});
        for(const [i,line] of measured.lines.entries())lines.push({start:start+line.start,end:start+(i===measured.lines.length-1?raw.length:line.end),height:line.height});
      }else lines.push({start,end:start+raw.length,height:Math.ceil(r.fontSize*r.lineHeight)+(r.paragraphGap??0)});
      start+=raw.length;
    }
    if(start!==r.text.length||!lines.length)throw Error('Incomplete hard-line mapping');
    return {request:r,lines,measurement:'browser-dom-lines',publicationReady:false};
  }
  const host=document.createElement('div');
  host.style.cssText='all:initial;position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;contain:layout style paint;display:block;';
  const root=host.attachShadow({mode:'closed'}), el=document.createElement('div');
  styleText(el,r,true);const segments=appendStyled(el,r,0,r.text.length);root.append(el);document.body.append(host);
  try{
    el.getBoundingClientRect();await readyPreviewFont(document,r.fontFamily,r.fontWeight,r.text);
    for(const run of r.inlineStyles??[])await readyPreviewFont(document,run.fontFamily??r.fontFamily,run.fontWeight??r.fontWeight,r.text.slice(run.start,run.end));
    if(r.inlineStyles?.some(s=>s.fontSize!==undefined||(s.baseline&&s.baseline!=='normal')||(s.fontFamily!==undefined&&s.fontFamily!==r.fontFamily))){
      const lines=measureVariableLines(document,root,el,r,segments);
      return {request:r,lines,measurement:'browser-dom-lines',publicationReady:false};
    }
    const height=el.getBoundingClientRect().height;
    const linePx=px(r.fontSize*r.lineHeight);
    const count=Math.round(height/linePx);
    if(count<1||Math.abs(height-count*linePx)>Math.max(1,count/32)||el.scrollWidth>el.clientWidth+1)
      throw Error('Unsupported line box geometry');
    const groups:{start:number;end:number}[]=[];
    let firstCenter:number|undefined;
    const range=document.createRange();let segmentIndex=0;
    for(const g of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(r.text)){
      while(segments[segmentIndex].end<=g.index)segmentIndex++;
      const seg=segments[segmentIndex];if(g.index+g.segment.length>seg.end)throw Error('Style crosses grapheme boundary');
      range.setStart(seg.node,g.index-seg.start);range.setEnd(seg.node,g.index-seg.start+g.segment.length);
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
      const line=document.createElement('div');styleText(line,r,false);appendStyled(line,r,group.start,group.end);root.append(line);
      const rect=line.getBoundingClientRect();
      if(line.scrollWidth>line.clientWidth+1||Math.abs(rect.height-linePx)>1)throw Error('Frozen line does not fit measured geometry');
      lines.push({...group,height:um(Math.max(linePx,rect.height,height/count))});
      line.remove();
    }
    return {request:r,lines,measurement:'browser-dom-lines',publicationReady:false};
  }finally{host.remove();}
}

// Preserve separator code units in DOM textContent without letting them create extra visual rows.
function frozenText(el:HTMLElement,r:PlainTextMeasureRequest,line:MeasuredTextLine){
  const raw=r.text.slice(line.start,line.end),body=raw.replace(/(?:\r\n|\n)$/,'');
  appendStyled(el,r,line.start,line.start+body.length);
  if(body.length!==raw.length){const ending=el.ownerDocument.createElement('span');ending.hidden=true;ending.style.display='none';ending.textContent=raw.slice(body.length);el.append(ending);}
}

// Restricted component geometry: one primary slot plus optional named source slots in strict trees.
// Decorative rectangles never contribute source text. All lengths are integer micrometres.
export type PreviewComponentChild = (
  | {id:string;type:'content';width?:number}
  | {id:string;type:'slot';name:string;width:number|'fill';color:string}
  | {id:string;type:'rect';width:number|'fill';height:number;color:string}
  | {id:string;type:'image';width:number|'fill';height:number;assetId:string;fit:'contain'|'cover';alt:string;crop?:ImageCrop}
  | {id:string;type:'label';width:number|'fill';text:string;fontFamily:PlainTextMeasureRequest['fontFamily'];fontWeight:number;fontSize:number;lineHeight:number;color:string}
  | {id:string;type:'group';width:number|'fill';direction:'row'|'column'|'canvas';height?:number;gap:number;padding:number;background:string;children:readonly PreviewComponentChild[]}) & {x?:number;y?:number};
export interface PreviewComponent {
  direction:'row'|'column'; gap:number; padding:number; background:string; textColor:string;
  children:readonly PreviewComponentChild[];
}
type ComponentPlacement=import('./tree.js').PlacedNode;
type Group=Omit<Pick<PreviewComponent,'direction'|'gap'|'padding'|'background'|'children'>,'direction'>&{direction:'row'|'column'|'canvas';height?:number};
const isColor=(v:unknown):v is string=>typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);
const validSlotName=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(v)&&v!=='content';
const length=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
// Validate and copy before await; never recursively clone an unbounded/cyclic caller tree.
function snapshotComponent(c:PreviewComponent):PreviewComponent{
  const ids=new Set<string>(),names=new Set<string>();let slots=0,count=0;
  function group(g:Group,depth:number):PreviewComponentChild[]{
    if(depth>4||!g||!['row','column','canvas'].includes(g.direction)||!length(g.gap)||!length(g.padding)||!isColor(g.background)||!Array.isArray(g.children)||g.children.length<1||g.children.length>8)throw RangeError('Invalid component group');
    const canvas=g.direction==='canvas';
    if(canvas?(!length(g.height!)||g.height!<=2*g.padding||g.gap!==0):g.height!==undefined)throw RangeError('Invalid canvas height or gap');
    return g.children.map(child=>{
      if(++count>32||!child||!/^[-A-Za-z0-9_]{1,64}$/.test(child.id)||child.id==='root'||ids.has(child.id))throw Error('Invalid component child ID or limit');
      ids.add(child.id);
      if(canvas){if(!length(child.x!)||!length(child.y!)||typeof child.width!=='number'||!length(child.width)||child.width<=0)throw RangeError('Canvas children require explicit position and width');}
      else if(child.x!==undefined||child.y!==undefined||(child.type==='content'&&child.width!==undefined))throw RangeError('Coordinates are only valid inside canvas');
      if(child.type==='content'){slots++;return {...child};}
      if(!(child.width==='fill'||length(child.width)&&child.width>0))throw RangeError('Invalid component width');
      if(child.type==='group')return {...child,children:group(child,depth+1)};
      if(child.type==='slot'){
        if(!validSlotName(child.name)||names.has(child.name)||names.size>=8||!isColor(child.color))throw RangeError('Invalid or duplicate named content slot');
        names.add(child.name);return {...child};
      }
      if(child.type==='label'){
        if(typeof child.text!=='string'||!child.text.length||child.text.length>256||!isColor(child.color)||!isPreviewFontFamily(child.fontFamily)||!isPreviewFontWeight(child.fontWeight)||!positive(child.fontSize)||child.fontSize>30000||!Number.isFinite(child.lineHeight)||child.lineHeight<1.25||child.lineHeight>4)throw RangeError('Invalid component label');
      }else if(child.type==='image'){
        if(typeof child.assetId!=='string'||!/^[a-f0-9]{64}$/.test(child.assetId)||!length(child.height)||child.height===0||!['contain','cover'].includes(child.fit)||typeof child.alt!=='string'||child.alt.length>256||/[\p{Cc}\p{Cs}]/u.test(child.alt))throw RangeError('Invalid component image');
        return {...child,...(child.crop!==undefined?{crop:validateImageCrop(child.crop)}:{})};
      }else if(child.type!=='rect'||!isColor(child.color)||!length(child.height)||child.height===0)throw RangeError('Invalid decorative rectangle');
      return {...child};
    });
  }
  if(!c||!['row','column'].includes(c.direction)||!isColor(c.textColor))throw RangeError('Invalid component color');
  const children=group(c,0);
  if(slots!==1)throw RangeError('Component requires exactly one content slot');
  return {...c,children};
}
function resolveComponentWidths(c:PreviewComponent,width:number){
  const widths=new Map<string,number>();let contentWidth=0;
  function visit(g:Group,outer:number){
    const inner=outer-2*g.padding;
    if(inner<=0)throw RangeError('Component padding exceeds width');
    if(g.direction==='canvas'){
      for(const n of g.children){const w=n.width as number;if(n.x!+w>inner)throw RangeError('Canvas horizontal overflow');widths.set(n.id,w);if(n.type==='content')contentWidth=w;if(n.type==='group')visit(n,w);}
      return;
    }
    const flexible=(n:PreviewComponentChild)=>n.type==='content'||n.width==='fill';
    const fixed=g.children.reduce((sum,n)=>sum+(n.type==='content'||n.width==='fill'?0:n.width),0);
    const remaining=inner-fixed-g.gap*(g.children.length-1);
    const flexCount=g.children.filter(flexible).length;
    if(g.direction==='row'&&(flexCount>1||remaining<0||(flexCount===1&&remaining===0)))throw RangeError('Row requires at most one fitting flexible child');
    for(const n of g.children){
      const w=flexible(n)?(g.direction==='row'?remaining:inner):(n as Exclude<PreviewComponentChild,{type:'content'}>).width as number;
      if(w<=0||w>inner)throw RangeError('Component child exceeds width');
      widths.set(n.id,w);
      if(n.type==='content')contentWidth=w;
      if(n.type==='group')visit(n,w);
    }
  }
  visit(c,width);return {widths,contentWidth};
}
function placeComponent(c:PreviewComponent,outerWidth:number,measurement:MeasuredTextLines,labels:Map<string,MeasuredTextLines>,slots:Map<string,MeasuredTextLines>,widths:Map<string,number>,capHeight:number):ComponentPlacement{
  const textHeight=(m:MeasuredTextLines)=>m.lines.reduce((n,l)=>n+l.height,0);
  function place(g:Group,id:string,outer:number,cap:number):ComponentPlacement{
    const canvas=g.direction==='canvas';
    const outerHeight=canvas?g.height!:cap;
    if(outerHeight>cap)throw RangeError('Canvas exceeds available height');
    const inner=outer-2*g.padding,innerCap=outerHeight-2*g.padding;
    if(innerCap<=0)throw RangeError('Component padding exceeds height');
    const kids=g.children.map(n=>{
      const w=widths.get(n.id)!;
      if(n.type==='group')return place(n,n.id,w,innerCap);
      const height=n.type==='content'?textHeight(measurement):n.type==='label'?textHeight(labels.get(n.id)!):n.type==='slot'?textHeight(slots.get(n.name)!):n.height;
      return {id:n.id,rect:{x:0,y:0,width:w,height},children:[]};
    });
    const flow=layoutTree({id:'root',type:g.direction,width:inner,height:canvas?innerCap:'auto',gap:g.gap,
      children:kids.map((n,i)=>({id:n.id,type:'leaf',width:n.rect.width,height:n.rect.height,...(canvas?{x:g.children[i].x,y:g.children[i].y}:{})}))},{width:inner,height:innerCap});
    return {id,rect:{x:0,y:0,width:outer,height:flow.rect.height+2*g.padding},
      children:kids.map((n,i)=>({...n,rect:{...flow.children[i].rect,x:flow.children[i].rect.x+g.padding,y:flow.children[i].rect.y+g.padding}}))};
  }
  return place(c,'root',outerWidth,capHeight);
}

export interface PreviewNamedSlot {
  name:string;request:Omit<PlainTextMeasureRequest,'width'>;
  /** Exact contiguous raw source offset verified by the host, when available. */
  sourceTextStart?:number;
}
export interface PreviewNamedSlotSlice {name:string;textStart:number;textEnd:number;sourceSlice?:{start:number;end:number}}
/** A semantic list item supplied by the host; marker is generated, never source text. */
export type PreviewListItem=({kind:'bullet'}|{kind:'ordered';number:number})&{
  depth:number;indentStep:number;markerWidth:number;gap:number;
};
function snapshotListItem(value:PreviewListItem,width:number):PreviewListItem{
  if(!value||typeof value!=='object'||!['bullet','ordered'].includes(value.kind)||
    Object.keys(value).some(k=>!['kind','depth','indentStep','markerWidth','gap',...(value.kind==='ordered'?['number']:[])].includes(k))||
    !Number.isSafeInteger(value.depth)||value.depth<0||value.depth>7||
    !positive(value.indentStep)||value.indentStep>30000||!positive(value.markerWidth)||value.markerWidth>30000||
    !Number.isSafeInteger(value.gap)||value.gap<0||value.gap>10000||
    (value.kind==='ordered'&&(!Number.isSafeInteger(value.number)||value.number<1||value.number>999999999))||
    width-listInset(value)<=0)throw RangeError('Invalid list item geometry or marker');
  return {...value};
}
function listInset(item:PreviewListItem){return item.depth*item.indentStep+item.markerWidth+item.gap;}
function listMarker(item:PreviewListItem){return item.kind==='ordered'?item.number+'.':['•','◦','▪'][item.depth%3];}
export interface PreviewTextBlock {
  listItem?:PreviewListItem;
  namedSlots?:readonly PreviewNamedSlot[];
  component?:PreviewComponent; // strict tree or splittable single-slot column frame
  origin:Origin; request:PlainTextMeasureRequest; splitPolicy:SplitPolicy;
  startPosition?:'page-top'; startPositionSource?:'component'|'explicit';
  // The host must verify the logical text is an exact raw source substring before setting this.
  sourceTextStart?:number;
}
export interface PreviewTextSlice {
  pageIndex:number; origin:Origin; textStart:number; textEnd:number;
  /** Source offsets are available only if caller supplied an exact contiguous source slice. */
  sourceSlice?:{start:number;end:number};
  /** Named slots are separate logical texts; never concatenate their source ranges. */
  namedSlots?:readonly PreviewNamedSlotSlice[];
}
function snapshotNamedSlots(b:PreviewTextBlock,component:PreviewComponent|undefined):PreviewNamedSlot[]{
  const names=new Set<string>();
  function visit(nodes:readonly PreviewComponentChild[]){for(const n of nodes){if(n.type==='slot')names.add(n.name);else if(n.type==='group')visit(n.children);}}
  if(component)visit(component.children);
  const slots=b.namedSlots??[];
  if(!Array.isArray(slots)||slots.length!==names.size||slots.length>8||(slots.length&&b.splitPolicy!=='strict'))throw RangeError('Named source slots require matching strict component nodes');
  const ranges:{start:number;end:number}[]=[];
  function checkRange(start:number|undefined,text:string){
    if(start===undefined)return;
    if(!b.origin.range||!Number.isSafeInteger(start)||start<b.origin.range.start||!Number.isSafeInteger(start+text.length)||start+text.length>b.origin.range.end)throw RangeError('Invalid named slot source mapping');
    ranges.push({start,end:start+text.length});
  }
  checkRange(b.sourceTextStart,b.request.text);
  const copy=slots.map(s=>{
    if(!s||!validSlotName(s.name)||!names.delete(s.name)||!s.request)throw RangeError('Missing, duplicate or unknown named source slot');
    const {width:_,...request}=snapshotRequest({...s.request,width:100000});
    checkRange(s.sourceTextStart,request.text);
    return {name:s.name,request,sourceTextStart:s.sourceTextStart};
  });
  ranges.sort((a,b)=>a.start-b.start);
  if(ranges.some((r,i)=>i>0&&r.start<ranges[i-1].end))throw RangeError('Overlapping component source slots');
  return copy;
}
// The host resolves a project-scoped resource to a verified PNG Blob. No URL from the component definition is loaded.
export type PreviewImageResolver=(assetId:string)=>Promise<Blob>;
export interface TextPagePreview {
  element:HTMLElement; plan:MeasuredPagePlan; slices:readonly PreviewTextSlice[];
  publicationReady:false;
}
// Multiple sections, logical text with typed inline styles. Caller owns exact mapping to raw source.
// No external HTML, CSS, resource fetching or publication output.
export async function createPlainTextPagePreview(document:Document,options:{
  revision:string;fingerprint:string;width:number;height:number;
  blocks?:readonly PreviewTextBlock[];
  sections?:readonly {id:string;startOn:'page'|'continuous';blocks:readonly (PreviewTextBlock|PageBreak)[]}[];
  paper?:{width:number;height:number;top:number;bottom:number;inner:number;outer:number;firstSide:'right'|'left'};
  resolveImage?:PreviewImageResolver;
}):Promise<TextPagePreview>{
  live(document);
  if((options.blocks===undefined)===(options.sections===undefined))throw RangeError('Specify exactly one block list or section list');
  const sourceSections=options.sections??[{id:'preview',startOn:'page' as const,blocks:options.blocks!}];
  if(!sourceSections.length||sourceSections.length>128)throw RangeError('Invalid preview sections');
  const allBlocks=sourceSections.flatMap(s=>s.blocks);
  const isBreak=(b:PreviewTextBlock|PageBreak):b is PageBreak=>'kind' in b&&b.kind==='pagebreak';
  const paper=options.paper?{...options.paper}:undefined;
  if(paper&&(!positive(paper.width)||!positive(paper.height)||paper.width>2000000||paper.height>2000000||![paper.top,paper.bottom,paper.inner,paper.outer].every(n=>Number.isSafeInteger(n)&&n>=0)||!['right','left'].includes(paper.firstSide)||paper.width-paper.inner-paper.outer!==options.width||paper.height-paper.top-paper.bottom!==options.height))throw RangeError('Invalid paper or margins');
  if(!positive(options.width)||!positive(options.height)||options.width>2000000||options.height>2000000||
    allBlocks.length<1||allBlocks.length>128||allBlocks.reduce((n,b)=>n+(isBreak(b)?0:b.request.text.length),0)>50000)
    throw RangeError('Invalid or oversized preview');
  // Snapshot caller-owned values before the first await.
  const sections=sourceSections.map(s=>({...s,blocks:s.blocks.map(b=>{
    const origin={...b.origin,range:b.origin.range?{...b.origin.range}:undefined};
    if(isBreak(b))return {...b,origin};
    const component=b.component?snapshotComponent(b.component):undefined;
    const namedSlots=snapshotNamedSlots(b,component);
    const listItem=b.listItem===undefined?undefined:snapshotListItem(b.listItem,b.request.width);
    if(listItem&&component)throw RangeError('List items do not support component frames yet');
    return {...b,origin,request:snapshotRequest(b.request),component,namedSlots,listItem};
  })}));
  if(sections.flatMap(s=>s.blocks).reduce((n,b)=>n+(isBreak(b)?0:b.request.text.length+(b.namedSlots??[]).reduce((sum,s)=>sum+s.request.text.length,0)),0)>50000)throw RangeError('Preview source text limit exceeded');
  if(sections.flatMap(s=>s.blocks).reduce((n,b)=>n+(isBreak(b)?0:(b.request.text.match(/\n/g)?.length??0)+(b.namedSlots??[]).reduce((sum,s)=>sum+(s.request.text.match(/\n/g)?.length??0),0)),0)>1024)throw RangeError('Preview hard-line limit exceeded');
  if(sections.flatMap(s=>s.blocks).reduce((n,b)=>n+(isBreak(b)?0:(b.request.inlineStyles?.length??0)+(b.namedSlots??[]).reduce((sum,s)=>sum+(s.request.inlineStyles?.length??0),0)),0)>1024)throw RangeError('Preview inline style limit exceeded');
  const {revision,fingerprint,width,height,resolveImage}=options;
  // Decode each unique resource before building the plan. Use a canvas snapshot so no object URL survives rendering.
  const imageIds=new Set<string>();
  function collectImages(children:readonly PreviewComponentChild[]){for(const n of children){if(n.type==='image')imageIds.add(n.assetId);else if(n.type==='group')collectImages(n.children);}}
  for(const s of sections)for(const b of s.blocks)if(!isBreak(b)&&b.component)collectImages(b.component.children);
  if(imageIds.size>32)throw RangeError('Too many preview image resources');
  const images=new Map<string,ImageBitmap>();let imagePixels=0;
  try{
  for(const id of imageIds){
    if(!resolveImage)throw Error('Component image resolver required');
    const blob=await resolveImage(id);
    if(!blob||blob.type!=='image/png'||!positive(blob.size)||blob.size>16*1024*1024)throw Error('Invalid PNG image resource');
    const header=new Uint8Array(await blob.slice(0,24).arrayBuffer());
    if(header.length!==24||![137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((v,i)=>header[i]===v))throw Error('Invalid PNG header');
    const view=new DataView(header.buffer),w=view.getUint32(16),h=view.getUint32(20);
    if(!positive(w)||!positive(h)||w>8192||h>8192||w*h>16000000||imagePixels+w*h>32000000)throw RangeError('Image resource pixel limit exceeded');
    const bitmap=await document.defaultView!.createImageBitmap(blob);
    if(bitmap.width!==w||bitmap.height!==h){bitmap.close();throw Error('PNG decoded size mismatch');}
    if(!positive(bitmap.width)||!positive(bitmap.height)||bitmap.width>8192||bitmap.height>8192||bitmap.width*bitmap.height>16000000||(imagePixels+=bitmap.width*bitmap.height)>32000000){bitmap.close();throw RangeError('Image resource pixel limit exceeded');}
    images.set(id,bitmap);
  }
  let renderedImagePixels=0;
  const byKey=new Map<string,{block:PreviewTextBlock;measurement:MeasuredTextLines;labels:Map<string,MeasuredTextLines>;slots:Map<string,MeasuredTextLines>;placement?:ComponentPlacement;marker?:MeasuredTextLines}>();
  const key=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
  const measuredSections:MeasuredSection[]=[];
  let totalLabelText=0;
  for(const section of sections){
    const blocks: (MeasuredSection['blocks'][number])[]=[];
    for(const b of section.blocks){
    if(isBreak(b)){blocks.push(b);continue;}
    const k=key(b.origin);if(byKey.has(k)||b.request.width>width)throw Error('Invalid or duplicate preview block');
    if(b.sourceTextStart!==undefined&&(!b.origin.range||!Number.isSafeInteger(b.sourceTextStart)||
      b.sourceTextStart<b.origin.range.start||!Number.isSafeInteger(b.sourceTextStart+b.request.text.length)||
      b.sourceTextStart+b.request.text.length>b.origin.range.end))throw Error('Invalid exact source mapping');
    const fragmentable=!!b.component&&b.splitPolicy!=='strict';
    if(fragmentable&&(b.component!.direction!=='column'||b.component!.gap!==0||b.component!.children.length!==1||b.component!.children[0].type!=='content'))throw Error('Splittable components require a single content slot in a column frame');
    const geometry=b.component?resolveComponentWidths(b.component,b.request.width):undefined;
    const textWidth=geometry?.contentWidth??(b.request.width-(b.listItem?listInset(b.listItem):0));
    let marker:MeasuredTextLines|undefined;
    if(b.listItem){
      const {inlineStyles:_,multiline:__,paragraphGap:___,...base}=b.request;
      // Reject an impossible marker before spending time measuring the body.
      marker=await measurePlainTextLines(document,{...base,text:listMarker(b.listItem),width:b.listItem.markerWidth});
      if(marker.lines.length!==1)throw RangeError('List marker does not fit reserved width');
    }
    let measurement=await measurePlainTextLines(document,{...b.request,width:textWidth});
    if(marker){
      // Marker and the first text row are top-aligned. Reserve both measured boxes.
      const [first,...rest]=measurement.lines;
      measurement={...measurement,lines:[{...first,height:Math.max(first.height,marker.lines[0].height)},...rest]};
    }
    const labels=new Map<string,MeasuredTextLines>(),slots=new Map<string,MeasuredTextLines>();
    const sources=new Map((b.namedSlots??[]).map(s=>[s.name,s.request]));
    async function measureLabels(children:readonly PreviewComponentChild[]){for(const child of children){
      if(child.type==='group'){await measureLabels(child.children);continue;}
      if(child.type==='slot'){
        slots.set(child.name,await measurePlainTextLines(document,{...sources.get(child.name)!,width:geometry!.widths.get(child.id)!}));continue;
      }
      if(child.type!=='label')continue;
      totalLabelText+=child.text.length;if(totalLabelText>50000)throw RangeError('Component label text limit exceeded');
      labels.set(child.id,await measurePlainTextLines(document,{text:child.text,width:geometry!.widths.get(child.id)!,fontFamily:child.fontFamily,fontWeight:child.fontWeight,fontSize:child.fontSize,lineHeight:child.lineHeight}));
    }}
    if(b.component)await measureLabels(b.component.children);
    const placement=b.component&&!fragmentable?placeComponent(b.component,b.request.width,measurement,labels,slots,geometry!.widths,height):undefined;
    byKey.set(k,{block:b,measurement,labels,slots,placement,marker});
    const heights=placement?[placement.rect.height]:measurement.lines.map(l=>l.height);
    blocks.push({kind:'block' as const,origin:b.origin,width:b.request.width,unitHeights:heights,splitPolicy:b.splitPolicy,...(fragmentable?{fragmentPadding:{top:b.component!.padding,bottom:b.component!.padding}}:{}),startPosition:b.startPosition,startPositionSource:b.startPositionSource});
  }
    measuredSections.push({id:section.id,startOn:section.startOn,blocks});
  }
  const plan=paginateMeasured({schemaVersion:1,revision,fingerprint,content:{width,height},sections:measuredSections});
  if(!plan.pages.length)throw Error('No drawable content');
  if(plan.completeness!=='full')throw Error('Cannot render partial preview: '+plan.diagnostics.map(d=>d.code).join(', '));
  const element=document.createElement('div');element.style.cssText='all:initial;display:block;';
  const root=element.attachShadow({mode:'open'});
  const slices:PreviewTextSlice[]=[];
  for(const p of plan.pages){
    const page=document.createElement('div');page.dataset.page=String(p.index);
    page.style.cssText='all:initial;display:block;position:relative;box-sizing:content-box;background:white;color:black;border:1px solid #888;margin:0 0 12px 0;overflow:visible;';
    const right=(p.index%2===0)===(paper?.firstSide!=='left');
    const left=paper?(right?paper.inner:paper.outer):0,top=paper?.top??0;
    page.dataset.side=right?'right':'left';
    page.style.width=px(paper?.width??width)+'px';page.style.height=px(paper?.height??height)+'px';
    if(paper){const guide=document.createElement('div');guide.dataset.contentGuide='true';guide.style.cssText='position:absolute;box-sizing:border-box;outline:1px dashed #ccc;pointer-events:none;';Object.assign(guide.style,{left:px(left)+'px',top:px(top)+'px',width:px(width)+'px',height:px(height)+'px'});page.append(guide);}
    for(const f of p.fragments){
      const entry=byKey.get(key(f.origin));if(!entry)throw Error('Missing preview block');
      const {block,measurement,labels,slots,placement,marker}=entry, lineUnits=placement?measurement.lines:measurement.lines.slice(f.unitStart,f.unitEnd);
      if(!lineUnits.length)throw Error('Missing preview lines');
      const textStart=lineUnits[0].start,textEnd=lineUnits.at(-1)!.end;
      // Origin may refer to markup; only a caller-verified contiguous mapping enables raw source ranges.
      const sourceSlice=block.sourceTextStart===undefined?undefined:{start:block.sourceTextStart+textStart,end:block.sourceTextStart+textEnd};
      const namedSlots=(block.namedSlots??[]).map(s=>({name:s.name,textStart:0,textEnd:s.request.text.length,...(s.sourceTextStart===undefined?{}:{sourceSlice:{start:s.sourceTextStart,end:s.sourceTextStart+s.request.text.length}})}));
      slices.push({pageIndex:p.index,origin:f.origin,textStart,textEnd,...(sourceSlice?{sourceSlice}:{}),...(namedSlots.length?{namedSlots}:{})});
      const fragment=document.createElement('div');fragment.dataset.block=f.origin.blockKey;fragment.dataset.document=f.origin.documentId;
      fragment.style.cssText='all:initial;display:block;position:absolute;box-sizing:border-box;';
      Object.assign(fragment.style,{left:px(left+f.rect.x)+'px',top:px(top+f.rect.y)+'px',width:px(f.rect.width)+'px',height:px(f.rect.height)+'px'});
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
        const item=document.createElement('div');styleText(item,measurement.request,false);item.style.height=px(line.height)+'px';
        item.dataset.start=String(line.start);item.dataset.end=String(line.end);
        frozenText(item,measurement.request,line);if(block.component)item.style.color=block.component.textColor;textParent.append(item);
      }
      page.append(fragment);
    }
    root.append(page);
  }
  return {element,plan,slices,publicationReady:false};
  }finally{for(const bitmap of images.values())bitmap.close();}
}
