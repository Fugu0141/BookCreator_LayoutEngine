// Measurement boundary: receives validated snapshot sections, produces a value
// pagination input plus transient render data. Does not paginate or render pages.
import {displayMathArtifact,deferDisplayMathArtifact,type DisplayMathArtifact,type MathCompilationCache,type measureDisplayMath as MeasureDisplayMath} from './math-preview.js';
import type {MeasuredSection,PageBreak} from './pagination.js';
import type {PlainTextMeasureRequest} from './browser-measurement.js';
import type {MeasuredTextLines,PreviewTextBlock,PreviewComponent,PreviewComponentChild,PreviewListItem,PreviewCheckpoint} from './browser-lines.js';
import {previewBlockKey,type MeasuredPreviewBlock} from './browser-page-render.js';
type ComponentPlacement=import('./tree.js').PlacedNode;
interface MeasureServices{
  measureDisplayMath:typeof MeasureDisplayMath;
  measurePlainTextLines(document:Document,request:PlainTextMeasureRequest):Promise<MeasuredTextLines>;
  resolveComponentWidths(c:PreviewComponent,width:number):{widths:Map<string,number>;contentWidth:number};
  placeComponent(c:PreviewComponent,outerWidth:number,measurement:MeasuredTextLines,labels:Map<string,MeasuredTextLines>,slots:Map<string,MeasuredTextLines>,widths:Map<string,number>,capHeight:number):ComponentPlacement;
  listInset(item:PreviewListItem):number;
  listMarker(item:PreviewListItem):string;
}
// Retain only value data and opaque node-free formula artifacts.
type SavedLine=Omit<MeasuredTextLines['lines'][number],'displayMath'>&{artifact?:DisplayMathArtifact};
type SavedText=Omit<MeasuredTextLines,'lines'>&{lines:SavedLine[]};
type ValueMeasurement={measurement:SavedText;labels:Map<string,SavedText>;slots:Map<string,SavedText>;marker?:SavedText;placement?:ComponentPlacement;math?:DisplayMathArtifact};
// Private, node-free entries are never mutated after capture. restoreValue
// rebuilds independent transient render handles; native formula nodes are lazy.
type RetainedEntry=Readonly<{key:string;value:ValueMeasurement;lineCount:number}>;
export type BlockMeasurementSnapshot=ReadonlyMap<string,RetainedEntry>;
export interface BlockMeasurementWork {readonly measuredBlocks:number;readonly reusedBlocks:number;readonly bypassedBlocks:number;readonly sharedSnapshotEntries:number}
const MAX_KEY_CHARS=250000,MAX_LINES=10000;
function cleanRequest(r:PlainTextMeasureRequest):PlainTextMeasureRequest{
  return {text:r.text,width:r.width,fontSize:r.fontSize,fontFamily:r.fontFamily,fontWeight:r.fontWeight,lineHeight:r.lineHeight,
    multiline:r.multiline,paragraphGap:r.paragraphGap,mathFontFamily:r.mathFontFamily,
    inlineStyles:r.inlineStyles?.map(s=>({start:s.start,end:s.end,fontFamily:s.fontFamily,fontWeight:s.fontWeight,italic:s.italic,underline:s.underline,color:s.color,fontSize:s.fontSize,baseline:s.baseline})),
    inlineMath:r.inlineMath?.map(a=>({start:a.start,formula:a.formula,display:a.display,equationNumber:a.equationNumber}))};
}
function componentKey(c:PreviewComponentChild):unknown{
  // Only fields used by width resolution, measurement and placement.
  return [c.type,c.id,c.width,c.x,c.y,
    c.type==='group'?[c.direction,c.height,c.heightMode,c.gap,c.padding,c.children.map(componentKey)]:
    c.type==='label'?[c.text,c.fontFamily,c.fontWeight,c.fontSize,c.lineHeight]:
    c.type==='slot'?c.name:
    c.type==='rect'||c.type==='image'?c.height:null];
}
function measurementKey(b:PreviewTextBlock,width:number,height:number):string|undefined{
  const c=b.component,l=b.listItem;
  // Source offsets/revision and purely visual component fields are not
  // measurement inputs. The current block always supplies rendering metadata.
  return JSON.stringify([width,height,cleanRequest(b.request),b.splitPolicy,b.displayMath??false,b.equationNumber??null,
    c?[c.direction,c.gap,c.padding,c.widthPercent,c.minHeightPercent,c.children.map(componentKey)]:null,
    l?[l.kind,l.kind==='ordered'?l.number:null,l.depth,l.indentStep,l.markerWidth,l.gap]:null,
    (b.namedSlots??[]).map(s=>[s.name,cleanRequest({...s.request,width:100000})])]);
}
type LiveMeasurement=Omit<MeasuredPreviewBlock,'block'>;
function valueCopy(v:LiveMeasurement):ValueMeasurement|undefined{
  const all=[v.measurement,...v.labels.values(),...v.slots.values(),...(v.marker?[v.marker]:[])];
  if((v.math&&!displayMathArtifact(v.math))||all.some(m=>m.lines.some(l=>l.displayMath&&!displayMathArtifact(l.displayMath))))return undefined;
  const copy=(m:MeasuredTextLines):SavedText=>({
    request:cleanRequest(m.request),lines:m.lines.map(l=>({start:l.start,end:l.end,height:l.height,artifact:l.displayMath?displayMathArtifact(l.displayMath):undefined})),
    measurement:'browser-dom-lines',publicationReady:false
  });
  return {measurement:copy(v.measurement),labels:new Map([...v.labels].map(([k,m])=>[k,copy(m)])),
    slots:new Map([...v.slots].map(([k,m])=>[k,copy(m)])),marker:v.marker?copy(v.marker):undefined,
    placement:v.placement?structuredClone(v.placement):undefined,math:v.math?displayMathArtifact(v.math):undefined};
}
function restoreValue(document:Document,v:ValueMeasurement,cache?:MathCompilationCache):LiveMeasurement{
  const copy=(m:SavedText):MeasuredTextLines=>({
    request:cleanRequest(m.request),lines:m.lines.map(l=>({start:l.start,end:l.end,height:l.height,...(l.artifact?{displayMath:deferDisplayMathArtifact(document,l.artifact,cache)}:{})})),
    measurement:'browser-dom-lines',publicationReady:false
  });
  return {measurement:copy(v.measurement),labels:new Map([...v.labels].map(([k,m])=>[k,copy(m)])),
    slots:new Map([...v.slots].map(([k,m])=>[k,copy(m)])),marker:v.marker?copy(v.marker):undefined,
    placement:v.placement?structuredClone(v.placement):undefined,math:v.math?deferDisplayMathArtifact(document,v.math,cache):undefined};
}
function countLines(v:LiveMeasurement){return v.measurement.lines.length+[...v.labels.values(),...v.slots.values()].reduce((n,m)=>n+m.lines.length,0)+(v.marker?.lines.length??0);}
export async function measurePreviewSections(document:Document,sections:readonly {id:string;startOn:'page'|'continuous';blocks:readonly (PreviewTextBlock|PageBreak)[]}[],width:number,height:number,{measurePlainTextLines,measureDisplayMath,resolveComponentWidths,placeComponent,listInset,listMarker}:MeasureServices,retained?:{previous?:BlockMeasurementSnapshot;mathCache?:MathCompilationCache},checkpoint?:PreviewCheckpoint){
  const isBreak=(b:PreviewTextBlock|PageBreak):b is PageBreak=>'kind' in b&&b.kind==='pagebreak';
  const byKey=new Map<string,MeasuredPreviewBlock>();
  const measuredSections:MeasuredSection[]=[];
  let totalLabelText=0,keyChars=0,linesRetained=0,measuredBlocks=0,reusedBlocks=0,bypassedBlocks=0,sharedSnapshotEntries=0;
  const next=new Map<string,RetainedEntry>();
  for(const section of sections){
    const blocks: (MeasuredSection['blocks'][number])[]=[];
    for(const b of section.blocks){
    if(checkpoint)await checkpoint('measure-block');
    if(isBreak(b)){blocks.push(b);continue;}
    const k=previewBlockKey(b.origin);if(byKey.has(k)||b.request.width>width)throw Error('Invalid or duplicate preview block');
    if(b.sourceTextStart!==undefined&&(!b.origin.range||!Number.isSafeInteger(b.sourceTextStart)||
      b.sourceTextStart<b.origin.range.start||!Number.isSafeInteger(b.sourceTextStart+b.request.text.length)||
      b.sourceTextStart+b.request.text.length>b.origin.range.end))throw Error('Invalid exact source mapping');
    const fragmentable=!!b.component&&b.splitPolicy!=='strict';
    if(fragmentable&&(b.component!.direction!=='column'||b.component!.gap!==0||b.component!.children.length!==1||b.component!.children[0].type!=='content'))throw Error('Splittable components require a single content slot in a column frame');
    if(fragmentable&&(b.component!.widthPercent!==undefined||b.component!.minHeightPercent!==undefined))throw RangeError('Area percentages require a non-splittable component');
    // Enforce the global label budget even when every block is retained.
    function countLabels(children:readonly PreviewComponentChild[]){for(const child of children){
      if(child.type==='group')countLabels(child.children);
      else if(child.type==='label'){
        totalLabelText+=child.text.length;if(totalLabelText>50000)throw RangeError('Component label text limit exceeded');
      }
    }}
    if(b.component)countLabels(b.component.children);
    const key=retained?measurementKey(b,width,height):undefined;
    const previous=key!==undefined?retained?.previous?.get(k):undefined;
    const hit=previous?.key===key&&previous!==undefined?restoreValue(document,previous.value,retained?.mathCache):undefined;
    let value:Omit<MeasuredPreviewBlock,'block'>;
    if(hit){value=hit;reusedBlocks++;}
    else{
    measuredBlocks++;
    if(retained&&key===undefined)bypassedBlocks++;
    const componentWidth=b.component?.widthPercent===undefined?b.request.width:Math.max(1,Math.floor(b.request.width*b.component.widthPercent/100));
    const geometry=b.component?resolveComponentWidths(b.component,componentWidth):undefined;
    const textWidth=geometry?.contentWidth??(b.request.width-(b.listItem?listInset(b.listItem):0));
    let marker:MeasuredTextLines|undefined;
    if(b.listItem){
      const {inlineStyles:_,multiline:__,paragraphGap:___,...base}=b.request;
      // Reject an impossible marker before spending time measuring the body.
      marker=await measurePlainTextLines(document,{...base,text:listMarker(b.listItem),width:b.listItem.markerWidth});
      if(marker.lines.length!==1)throw RangeError('List marker does not fit reserved width');
    }
    const math=b.displayMath?await measureDisplayMath(document,b.request.text,textWidth,b.request.fontSize,b.equationNumber,b.request.mathFontFamily):undefined;
    let measurement:MeasuredTextLines=math?{request:b.request,lines:[{start:0,end:b.request.text.length,height:math.height}],measurement:'browser-dom-lines',publicationReady:false}:await measurePlainTextLines(document,{...b.request,width:textWidth});
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
      labels.set(child.id,await measurePlainTextLines(document,{text:child.text,width:geometry!.widths.get(child.id)!,fontFamily:child.fontFamily,fontWeight:child.fontWeight,fontSize:child.fontSize,lineHeight:child.lineHeight}));
    }}
    if(b.component)await measureLabels(b.component.children);
    const placement=b.component&&!fragmentable?placeComponent(b.component,componentWidth,measurement,labels,slots,geometry!.widths,height):undefined;
    if(placement&&b.component?.minHeightPercent!==undefined){
      // Reserve blank space after existing children, without scaling or moving them.
      placement.rect.height=Math.max(placement.rect.height,Math.ceil(height*b.component.minHeightPercent/100));
    }
    value={measurement,labels,slots,placement,marker,math};
    }
    if(retained&&key!==undefined&&keyChars+key.length<=MAX_KEY_CHARS){
      // The hit already has an isolated value snapshot. Share that entry,
      // not the transient live data or its DOM nodes. Reapply both budgets
      // in current source order, including when blocks have moved.
      const count=hit&&previous?previous.lineCount:countLines(value);
      if(linesRetained+count<=MAX_LINES){
        const saved=hit&&previous?previous.value:valueCopy(value);
        if(saved){
          const entry=hit&&previous?previous:Object.freeze({key,value:saved,lineCount:count});
          next.set(k,entry);keyChars+=key.length;linesRetained+=count;
          if(hit&&previous)sharedSnapshotEntries++;
        }else bypassedBlocks++;
      }
    }
    byKey.set(k,{block:b,...value});
    const heights=value.placement?[value.placement.rect.height]:value.measurement.lines.map(l=>l.height);
    blocks.push({kind:'block' as const,origin:b.origin,width:value.placement?.rect.width??b.request.width,unitHeights:heights,splitPolicy:b.splitPolicy,minUnitsBefore:b.minUnitsBefore,minUnitsAfter:b.minUnitsAfter,optimizeSplit:b.optimizeSplit,...(fragmentable?{fragmentPadding:{top:b.component!.padding,bottom:b.component!.padding}}:{}),startPosition:b.startPosition,startPositionSource:b.startPositionSource});
  }
    measuredSections.push({id:section.id,startOn:section.startOn,blocks});
  }
  return {byKey,measuredSections,measurementSnapshot:retained?next:undefined,measurementWork:Object.freeze({measuredBlocks,reusedBlocks,bypassedBlocks,sharedSnapshotEntries})};
}
