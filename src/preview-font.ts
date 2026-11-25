/** Generic system families or host-registered opaque names; no arbitrary CSS or file paths. */
export type PreviewFontFamily='serif'|'sans-serif'|'monospace'|`BCFont_${string}`;
export const isPreviewFontFamily=(v:unknown):v is PreviewFontFamily=>typeof v==='string'&&(/^(serif|sans-serif|monospace)$/.test(v)||/^BCFont_[A-Za-z0-9_]{1,64}$/.test(v));
export const isPreviewFontWeight=(v:unknown)=>v===undefined||(typeof v==='number'&&Number.isInteger(v)&&v>=100&&v<=900);
const registered=(family:PreviewFontFamily)=>family.startsWith('BCFont_');
export function applyPreviewFont(el:HTMLElement,family:PreviewFontFamily,weight=400){
  if(!isPreviewFontFamily(family)||!isPreviewFontWeight(weight))throw RangeError('Invalid preview font');
  el.style.fontFamily=registered(family)?'"'+family+'"':family;
  el.style.fontWeight=String(weight);
  el.style.fontSynthesis='none';
}
/** The host registers actual trusted font faces before calling Engine. No network or file lookup here. */
export async function readyPreviewFont(document:Document,family:PreviewFontFamily,weight:number|undefined,text:string){
  if(!isPreviewFontFamily(family)||!isPreviewFontWeight(weight))throw RangeError('Invalid preview font');
  if(registered(family)){
    const faces=await document.fonts.load((weight??400)+' 16px "'+family+'"',text);
    if(!faces.length||faces.some(f=>f.status!=='loaded'||f.family.replace(/^["']|["']$/g,'')!==family))
      throw Error('Registered font unavailable: '+family);
  }
  await document.fonts.ready;
}
