// Measurement boundary: receives validated snapshot sections, produces a value
// pagination input plus transient render data. Does not paginate or render pages.
import type {measureDisplayMath as MeasureDisplayMath} from './math-preview.js';
import type {MeasuredSection,PageBreak} from './pagination.js';
import type {PlainTextMeasureRequest} from './browser-measurement.js';
import type {MeasuredTextLines,PreviewTextBlock,PreviewComponent,PreviewComponentChild,PreviewListItem} from './browser-lines.js';
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
export async function measurePreviewSections(document:Document,sections:readonly {id:string;startOn:'page'|'continuous';blocks:readonly (PreviewTextBlock|PageBreak)[]}[],width:number,height:number,{measurePlainTextLines,measureDisplayMath,resolveComponentWidths,placeComponent,listInset,listMarker}:MeasureServices){
  const isBreak=(b:PreviewTextBlock|PageBreak):b is PageBreak=>'kind' in b&&b.kind==='pagebreak';
  const byKey=new Map<string,MeasuredPreviewBlock>();
  const measuredSections:MeasuredSection[]=[];
  let totalLabelText=0;
  for(const section of sections){
    const blocks: (MeasuredSection['blocks'][number])[]=[];
    for(const b of section.blocks){
    if(isBreak(b)){blocks.push(b);continue;}
    const k=previewBlockKey(b.origin);if(byKey.has(k)||b.request.width>width)throw Error('Invalid or duplicate preview block');
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
      totalLabelText+=child.text.length;if(totalLabelText>50000)throw RangeError('Component label text limit exceeded');
      labels.set(child.id,await measurePlainTextLines(document,{text:child.text,width:geometry!.widths.get(child.id)!,fontFamily:child.fontFamily,fontWeight:child.fontWeight,fontSize:child.fontSize,lineHeight:child.lineHeight}));
    }}
    if(b.component)await measureLabels(b.component.children);
    const placement=b.component&&!fragmentable?placeComponent(b.component,b.request.width,measurement,labels,slots,geometry!.widths,height):undefined;
    byKey.set(k,{block:b,measurement,labels,slots,placement,marker,math});
    const heights=placement?[placement.rect.height]:measurement.lines.map(l=>l.height);
    blocks.push({kind:'block' as const,origin:b.origin,width:b.request.width,unitHeights:heights,splitPolicy:b.splitPolicy,...(fragmentable?{fragmentPadding:{top:b.component!.padding,bottom:b.component!.padding}}:{}),startPosition:b.startPosition,startPositionSource:b.startPositionSource});
  }
    measuredSections.push({id:section.id,startOn:section.startOn,blocks});
  }
  return {byKey,measuredSections};
}
