// Node-free identity for a component's rendered appearance. Measurement
// keys deliberately omit visual fields; they cannot prove DOM equivalence.
import type {MeasuredPreviewBlock} from './browser-page-render.js';
import type {MeasuredTextLines,PreviewComponentChild} from './browser-lines.js';
import {displayMathRenderKey} from './math-preview.js';

function containsImage(children:readonly PreviewComponentChild[]):boolean{
  return children.some(c=>c.type==='image'||c.type==='group'&&containsImage(c.children));
}
function childKey(c:PreviewComponentChild):unknown{
  const base=[c.type,c.id,c.width??null,c.x??null,c.y??null];
  switch(c.type){
    case 'content':return base;
    case 'rect':return [...base,c.height,c.color];
    case 'label':return [...base,c.text,c.fontFamily,c.fontWeight,c.fontSize,c.lineHeight,c.color];
    case 'slot':return [...base,c.name,c.color];
    case 'group':return [...base,c.direction,c.height??null,c.gap,c.padding,c.background,c.children.map(childKey)];
    // Image eligibility is checked recursively before any key is generated.
    case 'image':throw Error('Resource-backed component cannot be keyed');
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
/** Only deterministic, resource-free components. Native display rows must
 * have verified artifacts; external raster resources remain excluded. */
export function componentPageRenderKey(entry:MeasuredPreviewBlock):string|undefined{
  const {block,measurement,labels,slots,placement,math,marker}=entry,c=block.component;
  if(!c||math||marker||block.listItem||containsImage(c.children))return undefined;
  const primary=textKey(measurement),labelKeys=Array.from(labels,([id,m])=>[id,textKey(m)]),slotKeys=Array.from(slots,([name,m])=>[name,textKey(m)]);
  if(primary===undefined||labelKeys.some(([,key])=>key===undefined)||slotKeys.some(([,key])=>key===undefined))return undefined;
  return JSON.stringify([c.direction,c.gap,c.padding,c.background,c.textColor,c.children.map(childKey),
    placement??null,primary,labelKeys,slotKeys]);
}
