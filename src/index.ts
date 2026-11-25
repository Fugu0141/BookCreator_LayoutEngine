// Physical geometry PoC. All resolved lengths are integer micrometres.
export type Length = `${number}mm` | `${number}pt` | `${number}in`;
export interface Size { width: number; height: number }
export interface Rect extends Size { x: number; y: number }
const nonnegative = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid resolved length'); return n; };
export function toMicrometres(value: Length): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)(mm|pt|in)$/.exec(value);
  if (!match) throw new RangeError('Invalid physical length');
  const factor = match[2] === 'mm' ? 1000 : match[2] === 'pt' ? 25400 / 72 : 25400;
  return nonnegative(Math.round(Number(match[1]) * factor));
}
export function distributeFill(available: number, count: number): number[] {
  nonnegative(available);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new RangeError('Invalid fill count');
  const base = Math.floor(available / count);
  return Array.from({length:count}, (_,i)=>i===count-1 ? available-base*(count-1) : base);
}
export function layoutFlow(direction: 'row'|'column', children: readonly Size[], gap: number, available: Size): Rect[] {
  nonnegative(gap); nonnegative(available.width); nonnegative(available.height);
  if (direction !== 'row' && direction !== 'column') throw new RangeError('Invalid flow direction');
  let cursor = 0;
  return children.map((child,i)=>{
    nonnegative(child.width); nonnegative(child.height);
    if(i) cursor=nonnegative(cursor+gap);
    const rect = {x:direction==='row'?cursor:0,y:direction==='column'?cursor:0,width:child.width,height:child.height};
    if (rect.x+rect.width>available.width || rect.y+rect.height>available.height) throw new RangeError('Flow overflow');
    cursor=nonnegative(cursor+(direction==='row'?child.width:child.height));
    return rect;
  });
}
export function anchoredOffset(parent: number, child: number, anchor: 'start'|'center'|'end', offset=0): number {
  nonnegative(parent); nonnegative(child);
  if(!Number.isSafeInteger(offset)) throw new RangeError('Invalid offset');
  if(anchor!=='start' && anchor!=='center' && anchor!=='end') throw new RangeError('Invalid anchor');
  const result = anchor==='start'?offset:anchor==='end'?parent-child-offset:Math.round((parent-child)/2)+offset;
  if(!Number.isSafeInteger(result)) throw new RangeError('Invalid coordinate');
  return result;
}
export {layoutTree, type TreeNode, type PlacedNode, type Dimension} from './tree.js';
export * from './pagination.js';
export * from './inspector.js';
export * from './browser-measurement.js';
export * from './browser-lines.js';

export * from './image-crop.js';

export * from './math-preview.js';
