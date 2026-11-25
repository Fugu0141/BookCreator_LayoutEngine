import {layoutTree} from './tree.js';
import {applyPreviewFont,readyPreviewFont,isPreviewFontFamily,isPreviewFontWeight} from './preview-font.js';
import {paginateMeasured,type Origin,type MeasuredPagePlan,type SplitPolicy,type PageBreak,type MeasuredSection} from './pagination.js';
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
    !isPreviewFontFamily(request.fontFamily)||!isPreviewFontWeight(request.fontWeight)||!Number.isFinite(request.lineHeight)||request.lineHeight<1.25||request.lineHeight>4)
    throw new RangeError('Unsupported plain line measurement request');
}
function styleText(el:HTMLElement,r:PlainTextMeasureRequest,wrap:boolean){
  el.style.cssText='all:initial;display:block;box-sizing:border-box;padding:0;border:0;margin:0;overflow-wrap:anywhere;word-break:normal;writing-mode:horizontal-tb;direction:ltr;text-align:start;font-kerning:none;font-variant-ligatures:none;';
  el.style.width=px(r.width)+'px';el.style.fontSize=px(r.fontSize)+'px';applyPreviewFont(el,r.fontFamily,r.fontWeight);
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
    el.getBoundingClientRect();await readyPreviewFont(document,r.fontFamily,r.fontWeight,r.text);
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

// Restricted component geometry: flat flow with exactly one semantic content slot.
// Decorative rectangles never contribute source text. All lengths are integer micrometres.
export interface PreviewComponent {
  direction:'row'|'column'; gap:number; padding:number; background:string; textColor:string;
  children:readonly ({id:string;type:'content'}|{id:string;type:'rect';width:number|'fill';height:number;color:string})[];
}
type ComponentPlacement=import('./tree.js').PlacedNode;
const isColor=(v:unknown):v is string=>typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);
function checkComponent(c:PreviewComponent,width:number){
  const length=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
  if(!c||!['row','column'].includes(c.direction)||!length(c.gap)||!length(c.padding)||!isColor(c.background)||!isColor(c.textColor)||!Array.isArray(c.children)||c.children.length<1||c.children.length>8)
    throw RangeError('Invalid preview component');
  const ids=new Set<string>();let slots=0,occupied=2*c.padding+(c.direction==='row'?c.gap*(c.children.length-1):0);
  for(const child of c.children){
    if(!child||!/^[-A-Za-z0-9_]{1,64}$/.test(child.id)||child.id==='root'||ids.has(child.id))throw Error('Invalid component child ID');
    ids.add(child.id);
    if(child.type==='content'){slots++;continue;}
    if(child.type!=='rect'||!isColor(child.color)||!length(child.height)||child.height===0||
      !(child.width==='fill'?c.direction==='column':length(child.width)&&child.width>0))throw RangeError('Invalid decorative rectangle');
    if(c.direction==='row')occupied+=child.width as number;
    else if(child.width!=='fill'&&child.width>width-2*c.padding)throw RangeError('Rectangle exceeds component width');
  }
  if(slots!==1||occupied>=width)throw RangeError('Component needs one fitting content slot');
  return width-occupied;
}
function placeComponent(c:PreviewComponent,outerWidth:number,measurement:MeasuredTextLines,capHeight:number):ComponentPlacement{
  const innerWidth=outerWidth-2*c.padding;
  const textHeight=measurement.lines.reduce((n,l)=>n+l.height,0);
  return layoutTree({id:'root',type:c.direction,width:innerWidth,height:'auto',gap:c.gap,
    children:c.children.map(child=>child.type==='content'?
      {id:child.id,type:'leaf',width:measurement.request.width,height:textHeight}:
      {id:child.id,type:'leaf',width:child.width,height:child.height})},
    {width:innerWidth,height:Math.max(0,capHeight-2*c.padding)});
}

export interface PreviewTextBlock {
  component?:PreviewComponent; // strict unsplittable component only
  origin:Origin; request:PlainTextMeasureRequest; splitPolicy:SplitPolicy;
  startPosition?:'page-top'; startPositionSource?:'component'|'explicit';
  // The host must verify the logical text is an exact raw source substring before setting this.
  sourceTextStart?:number;
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
// Multiple sections, plain text only. Caller owns the exact mapping of logical text to raw source.
// No external HTML, CSS, resource fetching or publication output.
export async function createPlainTextPagePreview(document:Document,options:{
  revision:string;fingerprint:string;width:number;height:number;
  blocks?:readonly PreviewTextBlock[];
  sections?:readonly {id:string;startOn:'page'|'continuous';blocks:readonly (PreviewTextBlock|PageBreak)[]}[];
  paper?:{width:number;height:number;top:number;bottom:number;inner:number;outer:number;firstSide:'right'|'left'};
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
  const sections=sourceSections.map(s=>({...s,blocks:s.blocks.map(b=>({...b,origin:{...b.origin,range:b.origin.range?{...b.origin.range}:undefined},...(isBreak(b)?{}:{request:{...b.request},...(b.component?{component:{...b.component,children:b.component.children.map(c=>({...c}))}}:{})})}))}));
  const {revision,fingerprint,width,height}=options;
  const byKey=new Map<string,{block:PreviewTextBlock;measurement:MeasuredTextLines;placement?:ComponentPlacement}>();
  const key=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
  const measuredSections:MeasuredSection[]=[];
  for(const section of sections){
    const blocks: (MeasuredSection['blocks'][number])[]=[];
    for(const b of section.blocks){
    if(isBreak(b)){blocks.push(b);continue;}
    const k=key(b.origin);if(byKey.has(k)||b.request.width>width)throw Error('Invalid or duplicate preview block');
    if(b.sourceTextStart!==undefined&&(!b.origin.range||!Number.isSafeInteger(b.sourceTextStart)||
      b.sourceTextStart<b.origin.range.start||!Number.isSafeInteger(b.sourceTextStart+b.request.text.length)||
      b.sourceTextStart+b.request.text.length>b.origin.range.end))throw Error('Invalid exact source mapping');
    if(b.component&&b.splitPolicy!=='strict')throw Error('Components require strict pagination');
    const textWidth=b.component?checkComponent(b.component,b.request.width):b.request.width;
    const measurement=await measurePlainTextLines(document,{...b.request,width:textWidth});
    const placement=b.component?placeComponent(b.component,b.request.width,measurement,height):undefined;
    byKey.set(k,{block:b,measurement,placement});
    const heights=placement?[placement.rect.height+2*b.component!.padding]:measurement.lines.map(l=>l.height);
    blocks.push({kind:'block' as const,origin:b.origin,width:b.request.width,unitHeights:heights,splitPolicy:b.splitPolicy,startPosition:b.startPosition,startPositionSource:b.startPositionSource});
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
      const {block,measurement,placement}=entry, lineUnits=placement?measurement.lines:measurement.lines.slice(f.unitStart,f.unitEnd);
      if(!lineUnits.length)throw Error('Missing preview lines');
      const textStart=lineUnits[0].start,textEnd=lineUnits.at(-1)!.end;
      // Origin may refer to markup; only a caller-verified contiguous mapping enables raw source ranges.
      const sourceSlice=block.sourceTextStart===undefined?undefined:{start:block.sourceTextStart+textStart,end:block.sourceTextStart+textEnd};
      slices.push({pageIndex:p.index,origin:f.origin,textStart,textEnd,...(sourceSlice?{sourceSlice}:{})});
      const fragment=document.createElement('div');fragment.dataset.block=f.origin.blockKey;fragment.dataset.document=f.origin.documentId;
      fragment.style.cssText='all:initial;display:block;position:absolute;box-sizing:border-box;';
      Object.assign(fragment.style,{left:px(left+f.rect.x)+'px',top:px(top+f.rect.y)+'px',width:px(f.rect.width)+'px',height:px(f.rect.height)+'px'});
      let textParent=fragment;
      if(placement&&block.component){
        const c=block.component;fragment.dataset.component='true';fragment.style.background=c.background;
        for(const child of c.children){
          const rect=placement.children.find(n=>n.id===child.id)!.rect;
          const el=document.createElement('div');el.style.cssText='all:initial;position:absolute;display:block;box-sizing:border-box;';
          Object.assign(el.style,{left:px(rect.x+c.padding)+'px',top:px(rect.y+c.padding)+'px',width:px(rect.width)+'px',height:px(rect.height)+'px'});
          el.dataset.componentNode=child.id;
          if(child.type==='rect'){el.style.background=child.color;el.setAttribute('aria-hidden','true');}
          else{textParent=el;el.dataset.contentSlot='true';}
          fragment.append(el);
        }
      }
      for(const line of lineUnits){
        const item=document.createElement('div');styleText(item,measurement.request,false);item.style.height=px(line.height)+'px';
        item.dataset.start=String(line.start);item.dataset.end=String(line.end);
        item.textContent=measurement.request.text.slice(line.start,line.end);if(block.component)item.style.color=block.component.textColor;textParent.append(item);
      }
      page.append(fragment);
    }
    root.append(page);
  }
  return {element,plan,slices,publicationReady:false};
}
