import {applyPreviewFont,readyPreviewFont,isPreviewFontFamily,isPreviewFontWeight,type PreviewFontFamily} from './preview-font.js';
export type {PreviewFontFamily} from './preview-font.js';
// Browser-only experimental whole-block text measurement, not line fragmentation.
// Host supplies a trusted dedicated measurement Document; never inject HTML or load resources.
export interface PlainTextMeasureRequest {
  text:string;
  width:number; // integer micrometres
  fontSize:number; // integer micrometres
  fontFamily:PreviewFontFamily;
  fontWeight?:number; // 100–900; host owns face availability
  lineHeight:number; // multiplier
}
export interface PlainTextMeasurement {
  width:number;
  height:number;
  cssHeight:number;
  measurement:'browser-dom';
  splitCapability:'none';
  publicationReady:false;
}
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;
const px=(um:number)=>um*96/25400;
export async function measurePlainText(document:Document,request:PlainTextMeasureRequest):Promise<PlainTextMeasurement>{
  if(!document.body||!document.defaultView||!document.fonts)throw new Error('A live browser document is required');
  if(typeof request.text!=='string'||!request.text.length||request.text.length>100000||
    !positive(request.width)||request.width>2000000||!positive(request.fontSize)||request.fontSize>100000||
    !isPreviewFontFamily(request.fontFamily)||!isPreviewFontWeight(request.fontWeight)||!Number.isFinite(request.lineHeight)||request.lineHeight<1||request.lineHeight>4)
    throw new RangeError('Invalid text measurement request');
  request={...request};
  const host=document.createElement('div');
  host.style.cssText='all:initial;position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style paint;display:block;';
  const root=host.attachShadow({mode:'closed'});
  const text=document.createElement('div');
  text.style.cssText='all:initial;display:block;box-sizing:border-box;padding:0;border:0;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;writing-mode:horizontal-tb;direction:ltr;text-align:start;';
  text.style.width=px(request.width)+'px';
  text.style.fontSize=px(request.fontSize)+'px';
  applyPreviewFont(text,request.fontFamily,request.fontWeight);
  text.style.lineHeight=String(request.lineHeight);
  text.textContent=request.text;
  root.append(text);document.body.append(host);
  try {
    // Force initial layout before waiting for all currently used fonts.
    text.getBoundingClientRect();
    await readyPreviewFont(document,request.fontFamily,request.fontWeight,request.text);
    const rect=text.getBoundingClientRect();
    if(!Number.isFinite(rect.height)||rect.height<=0||rect.width<=0||text.scrollWidth>text.clientWidth+1)
      throw new Error('Text measurement unavailable or overflow');
    const height=Math.ceil(rect.height*25400/96);
    if(!positive(height))throw new Error('Invalid measured height');
    return {width:request.width,height,cssHeight:rect.height,measurement:'browser-dom',splitCapability:'none',publicationReady:false};
  }finally{host.remove();}
}
