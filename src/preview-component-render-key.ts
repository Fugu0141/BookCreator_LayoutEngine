// Node-free identity for a component's rendered appearance. Measurement
// keys deliberately omit visual fields; they cannot prove DOM equivalence.
import type {MeasuredPreviewBlock} from './browser-page-render.js';
import type {MeasuredTextLines,PreviewComponentChild} from './browser-lines.js';

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
function textKey(m:MeasuredTextLines):unknown{
  const r=m.request;
  return [r.text,r.width,r.fontSize,r.fontFamily,r.fontWeight??400,r.lineHeight,r.mathFontFamily??'auto',
    r.inlineStyles?.map(s=>[s.start,s.end,s.fontFamily,s.fontWeight,s.italic,s.underline,s.color,s.fontSize,s.baseline]),
    r.inlineMath?.map(a=>[a.start,a.formula,a.display,a.equationNumber]),
    m.lines.map(l=>[l.start,l.end,l.height])];
}
/** Only deterministic, resource-free components. Do not use a key if any
 * embedded native display row or external raster resource is present. */
export function componentPageRenderKey(entry:MeasuredPreviewBlock):string|undefined{
  const {block,measurement,labels,slots,placement,math,marker}=entry,c=block.component;
  if(!c||math||marker||block.listItem||containsImage(c.children))return undefined;
  if([measurement,...labels.values(),...slots.values()].some(m=>m.lines.some(l=>l.displayMath)))return undefined;
  return JSON.stringify([c.direction,c.gap,c.padding,c.background,c.textColor,c.children.map(childKey),
    placement??null,textKey(measurement),Array.from(labels,([id,m])=>[id,textKey(m)]),
    Array.from(slots,([name,m])=>[name,textKey(m)])]);
}
