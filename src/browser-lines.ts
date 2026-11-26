import {measureDisplayMath,validateCompiledMath,createPreviewMath,readyPreviewMathFont,isPreviewMathFontFamily,type MeasuredDisplayMath,type MathCompilationCache,type DisplayMathGeometryCache} from './math-preview.js';
import {validateImageCrop,type ImageCrop} from './image-crop.js';
import {renderMeasuredPreview} from './browser-page-render.js';
import {measurePreviewSections} from './browser-page-measure.js';
import {measureWithTextCache,type TextMeasurementCache} from './text-measurement-cache.js';
export {createTextMeasurementCache,type TextMeasurementCache} from './text-measurement-cache.js';
import {layoutTree} from './tree.js';
import {applyPreviewFont,readyPreviewFont,isPreviewFontFamily,isPreviewFontWeight} from './preview-font.js';
import {paginateMeasured,type Origin,type MeasuredPagePlan,type SplitPolicy,type PageBreak} from './pagination.js';
import type {PlainTextMeasureRequest,InlineStyleRun,InlineMathAtom} from './browser-measurement.js';

export interface MeasuredTextLine {
  /** UTF-16 offsets in the original logical text, not a transformed Markdown source. */
  start:number; end:number; height:number;
  /** Measured native display node; only present for an isolated formula row. */
  displayMath?:MeasuredDisplayMath;
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
function validate(request:PlainTextMeasureRequest,display=false){
  if(typeof request.text!=='string'||!request.text.length||request.text.length>10000||
    (request.multiline!==undefined&&typeof request.multiline!=='boolean')||
    (request.paragraphGap!==undefined&&(!request.multiline||!Number.isSafeInteger(request.paragraphGap)||request.paragraphGap<0||request.paragraphGap>30000))||
    /[\p{Cc}\p{Cs}\p{Cf}\p{Zl}\p{Zp}]/u.test(display?request.text.replace(/\r\n|\n|\t/g,''):request.multiline?request.text.replace(/\r\n|\n/g,''):request.text)||
    (request.multiline&&(!request.text.replace(/\r\n|\n/g,'').trim()||(request.text.match(/\n/g)?.length??0)>255))||
    !positive(request.width)||request.width>2000000||!positive(request.fontSize)||request.fontSize>100000||
    (request.mathFontFamily!==undefined&&!isPreviewMathFontFamily(request.mathFontFamily))||
    !isPreviewFontFamily(request.fontFamily)||!isPreviewFontWeight(request.fontWeight)||!Number.isFinite(request.lineHeight)||request.lineHeight<1.25||request.lineHeight>4)
    throw new RangeError('Unsupported plain line measurement request');
}
// Validate a bounded, ordered interval list before any asynchronous measurement.
function snapshotRequest(r:PlainTextMeasureRequest,display=false,mathCache?:MathCompilationCache):Readonly<PlainTextMeasureRequest>{
  validate(r,display);
  const positions=[...r.text.matchAll(/\uFFFC/g)].map(m=>m.index!);
  let atoms:readonly InlineMathAtom[]|undefined;
  if(r.inlineMath!==undefined||positions.length){
    if(!Array.isArray(r.inlineMath)||!positions.length||r.inlineMath.length!==positions.length||positions.length>128||r.fontSize<1000||r.fontSize>30000)throw RangeError('Invalid inline math atom count or size');
    const boundaries=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(r.text)].map(g=>g.index));boundaries.add(r.text.length);
    let total=0;
    atoms=Object.freeze(r.inlineMath.map((atom,i)=>{
      if(!atom||typeof atom!=='object'||Object.keys(atom).some(k=>k!=='start'&&k!=='formula'&&k!=='display'&&k!=='equationNumber')||(atom.display!==undefined&&atom.display!==true)||atom.start!==positions[i]||!boundaries.has(atom.start)||!boundaries.has(atom.start+1)||typeof atom.formula!=='string'||(total+=atom.formula.length)>10000)throw RangeError('Invalid inline math atom range or source limit');
      if(atom.equationNumber!==undefined&&(atom.display!==true||typeof atom.equationNumber!=='string'||!/^([1-9][0-9]{0,5})\.([1-9][0-9]{0,5})$/.test(atom.equationNumber)))throw RangeError('Equation number requires a valid display math atom');
      if(atom.display===true){
        const before=atom.start===0||r.text[atom.start-1]==='\n',after=atom.start+1===r.text.length||r.text[atom.start+1]==='\n'||r.text.slice(atom.start+1,atom.start+3)==='\r\n';
        if(!before||!after)throw RangeError('Display math atom must occupy an entire hard line');
      }
      validateCompiledMath(atom.formula,atom.display===true?'block':'inline',mathCache);
      return Object.freeze({start:atom.start,formula:atom.formula,...(atom.display===true?{display:true as const}:{}),...(atom.equationNumber!==undefined?{equationNumber:atom.equationNumber}:{})});
    }));
  }
  if(r.inlineStyles===undefined)return Object.freeze({...r,inlineMath:atoms});
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
    if(atoms?.some(a=>a.start>=run.start&&a.start<run.end))throw RangeError('Inline style overlaps math atom');
    previous=run.end;return Object.freeze({...run});
  });
  return Object.freeze({...r,inlineStyles:Object.freeze(runs),inlineMath:atoms});
}
function slicedRuns(r:PlainTextMeasureRequest,start:number,end:number):InlineStyleRun[]|undefined{
  return r.inlineStyles?.filter(s=>s.start<end&&s.end>start).map(s=>({...s,start:Math.max(s.start,start)-start,end:Math.min(s.end,end)-start}));
}
function slicedMath(r:PlainTextMeasureRequest,start:number,end:number):InlineMathAtom[]|undefined{
  const atoms=r.inlineMath?.filter(a=>a.start>=start&&a.start<end).map(a=>({...a,start:a.start-start}));
  return atoms?.length?atoms:undefined;
}
/** Use identical typed spans for wrapping, frozen-line validation and final page rendering. */
function appendStyled(el:HTMLElement,r:PlainTextMeasureRequest,start:number,end:number,mathCache?:MathCompilationCache){
  const segments:{start:number;end:number;node:Text|HTMLElement;math?:true}[]=[];
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
  const items=[...(r.inlineStyles??[]).map(run=>({start:run.start,end:run.end,run})),...(r.inlineMath??[]).map(atom=>({start:atom.start,end:atom.start+1,atom}))].sort((a,b)=>a.start-b.start);
  for(const entry of items){
    const a=Math.max(start,entry.start),b=Math.min(end,entry.end);
    if(a>=b)continue;
    append(cursor,a);
    if('atom' in entry){
      const span=el.ownerDocument.createElement('span');
      span.dataset.inlineMath='true';span.dataset.mathStart=String(a);span.dataset.mathEnd=String(b);
      span.style.cssText='display:inline-block;vertical-align:baseline;white-space:nowrap;line-height:normal;font-family:math,serif;font-style:normal;font-weight:400;font-synthesis:none;';
      span.append(createPreviewMath(el.ownerDocument,entry.atom.formula,'inline',r.mathFontFamily,mathCache));el.append(span);
      segments.push({start:a,end:b,node:span,math:true});
    }else append(a,b,entry.run);
    cursor=b;
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
    let rs:DOMRect[];
    if(seg.math){
      if(a!==seg.start||b!==seg.end)throw Error('Math atom split');
      const node=seg.node as HTMLElement,q=node.getBoundingClientRect(),ink=node.firstElementChild!.getBoundingClientRect();
      if(ink.width<=0||ink.height<=0||ink.left<q.left-.5||ink.right>q.right+.5||ink.top<q.top-.5||ink.bottom>q.bottom+.5)throw Error('Invalid inline math geometry');
      rs=[q];
    }else{
      range.setStart(seg.node,a-seg.start);range.setEnd(seg.node,b-seg.start);
      rs=Array.from(range.getClientRects());
    }
    if(rs.length!==1||!['left','right','top','bottom'].every(k=>Number.isFinite(rs[0][k as 'left'|'right'|'top'|'bottom'])))throw Error('Ambiguous variable-height glyph geometry');
    const q=rs[0];boxes.push({start:a,end:b,left:q.left-rect.left,right:q.right-rect.left,top:q.top-rect.top,bottom:q.bottom-rect.top});
  }
  return boxes;
}
function measureVariableLines(document:Document,root:ShadowRoot,el:HTMLElement,r:PlainTextMeasureRequest,segments:StyledSegment[],mathCache?:MathCompilationCache):MeasuredTextLine[]{
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
  // Build every frozen row before reading any geometry. Alternating writes
  // and reads here forced synchronous browser layout for each row.
  const batch=document.createDocumentFragment();
  const frozen=groups.map(group=>{
    const start=group[0].start,end=group.at(-1)!.end;
    const line=document.createElement('div');styleText(line,r,false);
    const rowSegments=appendStyled(line,r,start,end,mathCache);batch.append(line);
    return {group,start,end,line,rowSegments};
  });
  root.append(batch);
  const lines:MeasuredTextLine[]=[];let top=0;
  for(const {group,start,end,line,rowSegments} of frozen){
    const q=line.getBoundingClientRect(),row=glyphBoxes(document,r,rowSegments,start,end,q);
    if(q.height<=0||line.scrollWidth>line.clientWidth+1||row.length!==group.length||
      row.some((g,i)=>Math.abs(g.left-group[i].left)>1||Math.abs(g.right-group[i].right)>1||
        Math.abs(g.top+top-group[i].top)>1||Math.abs(g.bottom+top-group[i].bottom)>1||
        g.top< -1||g.bottom>q.height+1))throw Error('Frozen variable-height line does not match wrapped geometry');
    lines.push({start,end,height:um(q.height)});top+=q.height;
  }
  if(Math.abs(top-rect.height)>1||lines[0].start!==0||lines.at(-1)!.end!==r.text.length||lines.some((l,i)=>i>0&&l.start!==lines[i-1].end))throw Error('Incomplete variable-height line mapping');
  return lines;
}
function live(document:Document){
  if(!document.body||!document.defaultView||!document.fonts)throw Error('A live browser document is required');
}
// Grapheme ranges, real browser wrapping, bounded input. Reject ambiguous geometry instead of guessing.
export async function measurePlainTextLines(document:Document,request:PlainTextMeasureRequest,mathCache?:MathCompilationCache,displayMathCache?:DisplayMathGeometryCache):Promise<MeasuredTextLines>{
  live(document);const r=snapshotRequest(request,false,mathCache);
  if(r.multiline&&r.text.includes('\n')){
    const lines:MeasuredTextLine[]=[];let start=0;
    // Measure hard lines independently, then attach each original separator to its preceding row.
    for(const match of r.text.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)){
      const raw=match[0];if(!raw)continue;
      const body=raw.replace(/(?:\r\n|\n)$/,'');
      if(body.length){
        const measured=await measurePlainTextLines(document,{...r,text:body,multiline:false,paragraphGap:undefined,inlineStyles:slicedRuns(r,start,start+body.length),inlineMath:slicedMath(r,start,start+body.length)},mathCache,displayMathCache);
        for(const [i,line] of measured.lines.entries())lines.push({start:start+line.start,end:start+(i===measured.lines.length-1?raw.length:line.end),height:line.height,...(line.displayMath?{displayMath:line.displayMath}:{})});
      }else lines.push({start,end:start+raw.length,height:Math.ceil(r.fontSize*r.lineHeight)+(r.paragraphGap??0)});
      start+=raw.length;
    }
    if(start!==r.text.length||!lines.length)throw Error('Incomplete hard-line mapping');
    return {request:r,lines,measurement:'browser-dom-lines',publicationReady:false};
  }
  if(r.inlineMath?.[0]?.display===true){
    if(r.text!=='\uFFFC'||r.inlineMath.length!==1)throw RangeError('Expected isolated display math row');
    const displayMath=await measureDisplayMath(document,r.inlineMath[0].formula,r.width,r.fontSize,r.inlineMath[0].equationNumber,r.mathFontFamily,mathCache,displayMathCache);
    return {request:r,lines:[{start:0,end:1,height:displayMath.height,displayMath}],measurement:'browser-dom-lines',publicationReady:false};
  }
  const host=document.createElement('div');
  host.style.cssText='all:initial;position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;contain:layout style paint;display:block;';
  const root=host.attachShadow({mode:'closed'}), el=document.createElement('div');
  styleText(el,r,true);const segments=appendStyled(el,r,0,r.text.length,mathCache);root.append(el);document.body.append(host);
  try{
    el.getBoundingClientRect();await readyPreviewFont(document,r.fontFamily,r.fontWeight,r.text);
    for(const run of r.inlineStyles??[])await readyPreviewFont(document,run.fontFamily??r.fontFamily,run.fontWeight??r.fontWeight,r.text.slice(run.start,run.end));
    if(r.inlineMath?.length)await readyPreviewMathFont(document,root,r.mathFontFamily);
    if(r.inlineMath?.length||r.inlineStyles?.some(s=>s.fontSize!==undefined||(s.baseline&&s.baseline!=='normal')||(s.fontFamily!==undefined&&s.fontFamily!==r.fontFamily))){
      const lines=measureVariableLines(document,root,el,r,segments,mathCache);
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
    // Re-render all frozen rows in one write phase, then read their real
    // geometry without intervening DOM mutations. Reject overflow as before.
    const batch=document.createDocumentFragment();
    const frozen=groups.map(group=>{
      const line=document.createElement('div');styleText(line,r,false);appendStyled(line,r,group.start,group.end,mathCache);batch.append(line);
      return {group,line};
    });
    root.append(batch);
    const lines:MeasuredTextLine[]=[];
    for(const {group,line} of frozen){
      const rect=line.getBoundingClientRect();
      if(line.scrollWidth>line.clientWidth+1||Math.abs(rect.height-linePx)>1)throw Error('Frozen line does not fit measured geometry');
      lines.push({...group,height:um(Math.max(linePx,rect.height,height/count))});
    }
    return {request:r,lines,measurement:'browser-dom-lines',publicationReady:false};
  }finally{host.remove();}
}

// Preserve separator code units in DOM textContent without letting them create extra visual rows.
function frozenText(el:HTMLElement,r:PlainTextMeasureRequest,line:MeasuredTextLine,mathCache?:MathCompilationCache){
  const raw=r.text.slice(line.start,line.end),body=raw.replace(/(?:\r\n|\n)$/,'');
  if(line.displayMath){
    const node=line.displayMath.element;
    node.dataset.slotDisplayMath='true';node.dataset.mathStart=String(line.start);node.dataset.mathEnd=String(line.start+1);
    node.style.color='inherit';el.append(node);
  }else appendStyled(el,r,line.start,line.start+body.length,mathCache);
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
  /** Standalone strict math; request.text is the exact formula, not rendered glyphs. */
  displayMath?:true;
  /** Host-resolved chapter.index; derived label is not part of request.text or source offsets. */
  equationNumber?:string;
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
function snapshotNamedSlots(b:PreviewTextBlock,component:PreviewComponent|undefined,mathCache?:MathCompilationCache):PreviewNamedSlot[]{
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
    if(s.request.inlineMath!==undefined&&s.sourceTextStart!==undefined)throw RangeError('Inline math in named slots requires a host-owned source map');
    const {width:_,...request}=snapshotRequest({...s.request,width:100000},false,mathCache);
    checkRange(s.sourceTextStart,request.text);
    return {name:s.name,request,sourceTextStart:s.sourceTextStart};
  });
  ranges.sort((a,b)=>a.start-b.start);
  if(ranges.some((r,i)=>i>0&&r.start<ranges[i-1].end))throw RangeError('Overlapping component source slots');
  return copy;
}
// The host resolves a project-scoped resource to a verified PNG Blob. No URL from the component definition is loaded.
export type PreviewImageResolver=(assetId:string)=>Promise<Blob>;
/** Exclusive wall-clock intervals in milliseconds for a successful preview.
 * No source, identifiers, DOM references or publication authority. */
export interface PreviewPhaseTimings {
  readonly validationMs:number;
  readonly imagesMs:number;
  readonly measurementMs:number;
  readonly paginationMs:number;
  readonly renderingMs:number;
}
export interface TextPagePreview {
  element:HTMLElement; plan:MeasuredPagePlan; slices:readonly PreviewTextSlice[];
  publicationReady:false;
  /** Present only when the caller requests successful phase timings. */
  timings?:Readonly<PreviewPhaseTimings>;
}
// Multiple sections, logical text with typed inline styles. Caller owns exact mapping to raw source.
// No external HTML, CSS, resource fetching or publication output.
export async function createPlainTextPagePreview(document:Document,options:{
  revision:string;fingerprint:string;width:number;height:number;
  blocks?:readonly PreviewTextBlock[];
  sections?:readonly {id:string;startOn:'page'|'continuous';blocks:readonly (PreviewTextBlock|PageBreak)[]}[];
  paper?:{width:number;height:number;top:number;bottom:number;inner:number;outer:number;firstSide:'right'|'left'};
  resolveImage?:PreviewImageResolver;
  /** Opt-in cache owned by the host for this live document. */
  measurementCache?:TextMeasurementCache;
  collectTimings?:boolean;
  /** Optional book-session-owned, font-independent syntax compilation cache. */
  mathCache?:MathCompilationCache;
  /** Optional document-owned natural geometry cache for independent display equations. */
  displayMathCache?:DisplayMathGeometryCache;
}):Promise<TextPagePreview>{
  live(document);
  // Snapshot the opt-in before any asynchronous work. The clock is never read otherwise.
  const mathCache=options.mathCache,displayMathCache=options.displayMathCache;
  const timed=options.collectTimings===true;
  const now=()=>timed?document.defaultView!.performance.now():0;
  const started=now();
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
    const namedSlots=snapshotNamedSlots(b,component,mathCache);
    const listItem=b.listItem===undefined?undefined:snapshotListItem(b.listItem,b.request.width);
    if(listItem&&component)throw RangeError('List items do not support component frames yet');
    if(b.request.inlineMath!==undefined&&(listItem||b.sourceTextStart!==undefined||b.displayMath!==undefined))throw RangeError('Inline math requires a host-owned source map and cannot be combined with list items or display math');
    if(b.request.inlineMath?.some(a=>a.display===true)&&(!component||b.splitPolicy!=='strict'))throw RangeError('Display math rows require a strict component text slot');
    if(b.equationNumber!==undefined&&(b.displayMath!==true||typeof b.equationNumber!=='string'||!/^([1-9][0-9]{0,5})\.([1-9][0-9]{0,5})$/.test(b.equationNumber)))throw RangeError('Equation number requires a valid strict display math block');
    if(b.displayMath!==undefined){
      if(b.displayMath!==true||b.splitPolicy!=='strict'||component||listItem||namedSlots.length||b.request.inlineStyles!==undefined||b.request.multiline||b.request.paragraphGap!==undefined)throw RangeError('Display math requires an independent strict block');
      validateCompiledMath(b.request.text,'block',mathCache);
    }
    return {...b,origin,request:snapshotRequest(b.request,b.displayMath===true,mathCache),component,namedSlots,listItem};
  })}));
  if(sections.flatMap(s=>s.blocks).reduce((n,b)=>n+(isBreak(b)?0:b.request.text.length+(b.namedSlots??[]).reduce((sum,s)=>sum+s.request.text.length,0)),0)>50000)throw RangeError('Preview source text limit exceeded');
  if(sections.flatMap(s=>s.blocks).reduce((n,b)=>n+(isBreak(b)?0:(b.request.text.match(/\n/g)?.length??0)+(b.namedSlots??[]).reduce((sum,s)=>sum+(s.request.text.match(/\n/g)?.length??0),0)),0)>1024)throw RangeError('Preview hard-line limit exceeded');
  if(sections.flatMap(s=>s.blocks).reduce((n,b)=>n+(isBreak(b)?0:(b.request.inlineStyles?.length??0)+(b.namedSlots??[]).reduce((sum,s)=>sum+(s.request.inlineStyles?.length??0),0)),0)>1024)throw RangeError('Preview inline style limit exceeded');
  const mathAtoms=sections.flatMap(s=>s.blocks).flatMap(b=>isBreak(b)?[]:[...(b.request.inlineMath??[]),...(b.namedSlots??[]).flatMap(s=>s.request.inlineMath??[])]);
  if(mathAtoms.length>512||mathAtoms.reduce((n,a)=>n+a.formula.length,0)>50000)throw RangeError('Preview inline math limit exceeded');
  const {revision,fingerprint,width,height,resolveImage,measurementCache}=options;
  // Decode each unique resource before building the plan. Use a canvas snapshot so no object URL survives rendering.
  const imageIds=new Set<string>();
  function collectImages(children:readonly PreviewComponentChild[]){for(const n of children){if(n.type==='image')imageIds.add(n.assetId);else if(n.type==='group')collectImages(n.children);}}
  for(const s of sections)for(const b of s.blocks)if(!isBreak(b)&&b.component)collectImages(b.component.children);
  if(imageIds.size>32)throw RangeError('Too many preview image resources');
  const images=new Map<string,ImageBitmap>();let imagePixels=0;
  const validated=now();
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
  const imagesReady=now();
  const measure=(doc:Document,r:PlainTextMeasureRequest)=>measurePlainTextLines(doc,r,mathCache,displayMathCache);
  const {byKey,measuredSections}=await measurePreviewSections(document,sections,width,height,{measurePlainTextLines:measurementCache?(doc,r)=>measureWithTextCache(doc,r.inlineMath!==undefined||r.inlineStyles!==undefined?r:snapshotRequest(r),measurementCache,measure):measure,measureDisplayMath:(doc,source,w,size,number,family)=>measureDisplayMath(doc,source,w,size,number,family,mathCache,displayMathCache),resolveComponentWidths,placeComponent,listInset,listMarker});
  const measured=now();
  const plan=paginateMeasured({schemaVersion:1,revision,fingerprint,content:{width,height},sections:measuredSections});
  if(!plan.pages.length)throw Error('No drawable content');
  if(plan.completeness!=='full')throw Error('Cannot render partial preview: '+plan.diagnostics.map(d=>d.code).join(', '));
  const paginated=now();
  const result=renderMeasuredPreview(document,plan,{width,height,paper,byKey,images},{styleText,frozenText:(el,r,line)=>frozenText(el,r,line,mathCache),listInset});
  if(!timed)return result;
  const rendered=now();
  return {...result,timings:Object.freeze({validationMs:validated-started,imagesMs:imagesReady-validated,
    measurementMs:measured-imagesReady,paginationMs:paginated-measured,renderingMs:rendered-paginated})};
  }finally{for(const bitmap of images.values())bitmap.close();}
}
