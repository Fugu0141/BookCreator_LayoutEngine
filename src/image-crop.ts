/** Non-destructive source insets in hundredths of one percent (0..10000). */
export interface ImageCrop {left:number;top:number;right:number;bottom:number}
export function validateImageCrop(value:unknown):ImageCrop{
  if(!value||typeof value!=='object'||Array.isArray(value))throw RangeError('Invalid image crop');
  const c=value as Record<string,unknown>,keys=['left','top','right','bottom'];
  if(Object.keys(c).length!==4||!keys.every(k=>Object.hasOwn(c,k)&&typeof c[k]==='number'&&Number.isSafeInteger(c[k])&&(c[k] as number)>=0&&(c[k] as number)<=9900))throw RangeError('Invalid image crop');
  const {left,top,right,bottom}=c as unknown as ImageCrop;
  if(left+right>9900||top+bottom>9900)throw RangeError('Image crop must retain at least 1% of each dimension');
  return {left,top,right,bottom};
}
export function imageSourceRect(width:number,height:number,frameWidth:number,frameHeight:number,fit:'contain'|'cover',crop?:ImageCrop){
  if(![width,height,frameWidth,frameHeight].every(n=>Number.isFinite(n)&&n>0)||!['contain','cover'].includes(fit))throw RangeError('Invalid image geometry');
  const c=crop===undefined?{left:0,top:0,right:0,bottom:0}:validateImageCrop(crop);
  let x=width*c.left/10000,y=height*c.top/10000,w=width*(10000-c.left-c.right)/10000,h=height*(10000-c.top-c.bottom)/10000;
  if(fit==='cover'){
    const ratio=frameWidth/frameHeight;
    if(w/h>ratio){const next=h*ratio;x+=(w-next)/2;w=next;}
    else{const next=w/ratio;y+=(h-next)/2;h=next;}
  }
  return {x,y,width:w,height:h};
}
