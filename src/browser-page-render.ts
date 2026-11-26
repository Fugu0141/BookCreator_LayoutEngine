// DOM rendering boundary. Receives already measured blocks and a completed
// pagination plan. No measuring, font loading, pagination or resource decoding.
import {imageSourceRect} from './image-crop.js';
import type {MeasuredDisplayMath} from './math-preview.js';
import type {MeasuredPagePlan,Origin} from './pagination.js';
import type {PlainTextMeasureRequest} from './browser-measurement.js';
import type {MeasuredTextLine,MeasuredTextLines,PreviewTextBlock,PreviewTextSlice,PreviewComponentChild,PreviewListItem,TextPagePreview} from './browser-lines.js';
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
const px=(um:number)=>um*96/25400;
export const previewBlockKey=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
// Internal ownership contract: math nodes are consumed by this render; bitmaps
// are borrowed for this synchronous call, and closed by their owning orchestrator.
export function renderMeasuredPreview(document:Document,plan:MeasuredPagePlan,{width,height,paper,byKey,images}:{width:number;height:number;paper?:PreviewPaper;byKey:ReadonlyMap<string,MeasuredPreviewBlock>;images:ReadonlyMap<string,ImageBitmap>},{styleText,frozenText,listInset}:RenderServices):TextPagePreview{
  let renderedImagePixels=0;
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
      const entry=byKey.get(previewBlockKey(f.origin));if(!entry)throw Error('Missing preview block');
      const {block,measurement,labels,slots,placement,marker,math}=entry, lineUnits=placement?measurement.lines:measurement.lines.slice(f.unitStart,f.unitEnd);
      if(!lineUnits.length)throw Error('Missing preview lines');
      const textStart=lineUnits[0].start,textEnd=lineUnits.at(-1)!.end;
      // Origin may refer to markup; only a caller-verified contiguous mapping enables raw source ranges.
      const sourceSlice=block.sourceTextStart===undefined?undefined:{start:block.sourceTextStart+textStart,end:block.sourceTextStart+textEnd};
      const namedSlots=(block.namedSlots??[]).map(s=>({name:s.name,textStart:0,textEnd:s.request.text.length,...(s.sourceTextStart===undefined?{}:{sourceSlice:{start:s.sourceTextStart,end:s.sourceTextStart+s.request.text.length}})}));
      slices.push({pageIndex:p.index,origin:f.origin,textStart,textEnd,...(sourceSlice?{sourceSlice}:{}),...(namedSlots.length?{namedSlots}:{})});
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
        const item=document.createElement('div');styleText(item,measurement.request,false);item.style.height=px(line.height)+'px';
        item.dataset.start=String(line.start);item.dataset.end=String(line.end);
        frozenText(item,measurement.request,line);if(block.component)item.style.color=block.component.textColor;textParent.append(item);
      }
      page.append(fragment);
    }
    root.append(page);
  }
  return {element,plan,slices,publicationReady:false};
}
