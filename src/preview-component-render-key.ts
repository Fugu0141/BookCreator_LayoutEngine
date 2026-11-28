// Node-free identity for a component's rendered appearance. Measurement
// keys deliberately omit visual fields; they cannot prove DOM equivalence.
import type {MeasuredPreviewBlock} from './browser-page-render.js';
import type {MeasuredTextLines,PreviewComponentChild} from './browser-lines.js';
import {displayMathRenderKey} from './math-preview.js';

function childKey(c:PreviewComponentChild,imageKeys:ReadonlyMap<string,string>):unknown[]|undefined{
  const base=[c.type,c.id,c.width??null,c.x??null,c.y??null];
  switch(c.type){
    case 'content':return base;
    case 'rect':return [...base,c.height,c.color];
    case 'label':return [...base,c.text,c.fontFamily,c.fontWeight,c.fontSize,c.lineHeight,c.color];
    case 'slot':return [...base,c.name,c.color];
    case 'group':{
      const keys=c.children.map(child=>childKey(child,imageKeys));
      return keys.some(k=>k===undefined)?undefined:[...base,c.direction,c.height??null,c.gap,c.padding,c.background,keys];
    }
    case 'image':{
      const digest=imageKeys.get(c.assetId);
      return digest===undefined?undefined:[...base,c.height,c.assetId,digest,c.fit,c.alt,c.crop??null];
    }
  }
}
function textKey(m:MeasuredTextLines):unknown[]|undefined{
  const r=m.request,lines=[];
  for(const l of m.lines){
    const key=l.displayMath?displayMathRenderKey(l.displayMath):null;
    if(key===undefined)return undefined;
    lines.push([l.start,l.end,l.height,key]);
  }
  return [r.text,r.width,r.fontSize,r.fontFamily,r.fontWeight??400,r.lineHeight,r.mathFontFamily??'auto',
    r.inlineStyles?.map(s=>[s.start,s.end,s.fontFamily,s.fontWeight,s.italic,s.underline,s.color,s.fontSize,s.baseline]),
    r.inlineMath?.map(a=>[a.start,a.formula,a.display,a.equationNumber]),
    lines];
}
/** Native display rows require verified artifacts, and image children require
 * a digest of the resolved PNG bytes, including nested groups. */
export function componentPageRenderKey(entry:MeasuredPreviewBlock,imageKeys:ReadonlyMap<string,string>):string|undefined{
  const {block,measurement,labels,slots,placement,math,marker}=entry,c=block.component;
  if(!c||math||marker||block.listItem)return undefined;
  const children=c.children.map(child=>childKey(child,imageKeys));
  if(children.some(k=>k===undefined))return undefined;
  const primary=textKey(measurement),labelKeys=Array.from(labels,([id,m])=>[id,textKey(m)]),slotKeys=Array.from(slots,([name,m])=>[name,textKey(m)]);
  if(primary===undefined||labelKeys.some(([,key])=>key===undefined)||slotKeys.some(([,key])=>key===undefined))return undefined;
  return JSON.stringify([c.direction,c.gap,c.padding,c.background,c.textColor,children,
    placement??null,primary,labelKeys,slotKeys]);
}
