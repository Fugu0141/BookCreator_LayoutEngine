// A provisional page is a detached, independent visual copy, never a
// publication lease or a source-navigation surface. The host owns its copy.
export interface ProvisionalPreviewPage{
  readonly index:number;
  readonly pageCount:number;
  readonly element:HTMLElement;
}
export type ProvisionalPageReceiver=(page:Readonly<ProvisionalPreviewPage>)=>void|Promise<void>;

// Bound the additional raster allocation separately from the final render.
// Native cloneNode does not copy canvas pixels; copy them explicitly.
export function createProvisionalPageDelivery(priority:readonly number[]|undefined,receive:ProvisionalPageReceiver|undefined){
  if(receive!==undefined&&typeof receive!=='function')throw TypeError('Invalid provisional page receiver');
  const selected=new Set(priority??[]);
  let remainingPixels=8000000;
  return async function deliver(page:HTMLElement,index:number,pageCount:number){
    if(!receive||!selected.has(index))return;
    const originals=Array.from(page.querySelectorAll('canvas'));
    const pixels=originals.reduce((sum,canvas)=>sum+canvas.width*canvas.height,0);
    if(pixels>remainingPixels)return; // final preview remains available
    const element=page.cloneNode(true) as HTMLElement;
    const copies=Array.from(element.querySelectorAll('canvas'));
    for(let i=0;i<originals.length;i++){
      const source=originals[i],copy=copies[i],ctx=copy.getContext('2d');
      if(!ctx)return;
      ctx.drawImage(source,0,0);
    }
    remainingPixels-=pixels;
    element.inert=true;
    await receive(Object.freeze({index,pageCount,element}));
  };
}
