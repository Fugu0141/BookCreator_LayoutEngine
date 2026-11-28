import type { Rect, Size } from './index.js';

// Pure, measured, indivisible-block placement. All dimensions are integer µm.
// The caller owns measurement and semantic order; this module never edits source.
export type IntelligentPlacementMode = 'auto' | 'preferred' | 'fixed';
export interface IntelligentPosition { page:number; x:number; y:number }

/** Hard constraints on the occupied footprint, never instructions to scale content. */
export interface IntelligentSizeConstraints {
  minWidth?:number;
  minHeight?:number;
  maxWidth?:number;
  maxHeight?:number;
  // Integer 1–100, relative to the full content area.
  minWidthPercent?:number;
  minHeightPercent?:number;
}
export interface IntelligentBlock {
  id: string;
  size: Readonly<Size>;
  sizeConstraints?: Readonly<IntelligentSizeConstraints>;
  // Only consecutive opt-in blocks may share a row.
  sideBySide?: boolean;
  // An exact user constraint; never silently moved or resized.
  fixed?: Readonly<IntelligentPosition>;
  // Omitted mode is inferred from position fields for legacy callers.
  mode?: IntelligentPlacementMode;
  preferred?: Readonly<IntelligentPosition>;
  // Preserve intentionally reserved whitespace.
  spaceBefore?: number;
  // Explicit trailing row space; cannot be reused by later blocks.
  spaceAfter?: number;
  startNewPage?: boolean;
}
/** Hard exclusion, independent of semantic document blocks. */
export interface IntelligentReservedRegion {
  id:string;
  page:number;
  rect:Readonly<Rect>;
}
export interface IntelligentLayoutInput {
  revision: string;
  content: Readonly<Size>;
  gap: number;
  blocks: readonly IntelligentBlock[];
  reservedRegions?: readonly IntelligentReservedRegion[];
}
export interface IntelligentPlacement {
  id: string;
  page: number;
  rect: Rect;
  // Present only if the reserved footprint exceeds measured content.
  occupiedRect?: Rect;
  fixed: boolean;
  preference?: 'honored' | 'fallback';
}
export type IntelligentLayoutResult =
  | {status:'placed'; revision:string; placements: IntelligentPlacement[]; publicationReady:false}
  | {status:'conflict'; revision:string; placements: []; publicationReady:false;
      diagnostic:{code:'IL_INVALID'|'IL_TOO_LARGE'|'IL_FIXED_CONFLICT'|'IL_RESERVED_CONFLICT'|'IL_SIZE_CONFLICT'|'IL_LIMIT'; blockId?:string; regionId?:string; message:string}};

const MAX = 1_000_000_000;
const MAX_PAGES = 10000;
const MAX_REGIONS_PER_PAGE = 128;
const MAX_REGIONS = 10000;
const natural = (n:number) => Number.isSafeInteger(n) && n>=0 && n<=MAX;
const positive = (n:number) => natural(n) && n>0;
const validSize = (s:Size) => !!s && positive(s.width) && positive(s.height);
const validPosition = (p:IntelligentPosition) => !!p && natural(p.page) && p.page<MAX_PAGES && natural(p.x) && natural(p.y);
const percent = (n:number) => Number.isInteger(n)&&n>=1&&n<=100;
type SizeResolution = {size:Size}|{code:'IL_INVALID'|'IL_SIZE_CONFLICT';message:string};

function resolveFootprint(b:IntelligentBlock,content:Readonly<Size>):SizeResolution {
  const c=b.sizeConstraints;
  if(c!==undefined){
    if(!c||typeof c!=='object'||Array.isArray(c)||
      [c.minWidth,c.minHeight,c.maxWidth,c.maxHeight].some(v=>v!==undefined&&!positive(v))||
      [c.minWidthPercent,c.minHeightPercent].some(v=>v!==undefined&&!percent(v)))
      return {code:'IL_INVALID',message:'Invalid size constraints'};
  }
  // Round minimum percentages up: never under-reserve a requested fraction.
  const w=Math.max(b.size.width,c?.minWidth??0,Math.ceil(content.width*(c?.minWidthPercent??0)/100));
  const h=Math.max(b.size.height,c?.minHeight??0,Math.ceil(content.height*(c?.minHeightPercent??0)/100));
  if(w>(c?.maxWidth??MAX)||h>(c?.maxHeight??MAX))
    return {code:'IL_SIZE_CONFLICT',message:'Measured or minimum footprint exceeds maximum'};
  if(b.fixed&&(w!==b.size.width||h!==b.size.height))
    return {code:'IL_SIZE_CONFLICT',message:'Minimum footprint conflicts with fixed size'};
  return {size:{width:w,height:h+(b.spaceAfter??0)}};
}

// Rectangles are half-open; edge contact is legal. Gap applies between blocks.
function overlaps(a:Readonly<Rect>,b:Readonly<Rect>):boolean {
  return a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
}

// Sorted by x, then input order. Find the first horizontal gap in this band.
function findX(regions:readonly IntelligentReservedRegion[], minX:number,y:number,w:number,h:number,width:number):number|undefined {
  let x=minX;
  for(const {rect:r} of regions){
    if(r.y>=y+h || r.y+r.height<=y || r.x+r.width<=x) continue;
    if(x+w<=r.x) break;
    x=r.x+r.width;
    if(x+w>width) return undefined;
  }
  return x+w<=width?x:undefined;
}

// Search only obstacle bottoms, never individual physical units.
function findRow(regions:readonly IntelligentReservedRegion[],minY:number,w:number,h:number,width:number,height:number):{x:number;y:number}|undefined {
  let y=minY;
  while(y+h<=height){
    const x=findX(regions,0,y,w,h,width);
    if(x!==undefined) return {x,y};
    let next=Infinity;
    for(const {rect:r} of regions){
      if(r.y<y+h && r.y+r.height>y) next=Math.min(next,r.y+r.height);
    }
    if(!Number.isFinite(next)) return undefined;
    y=next;
  }
  return undefined;
}

/**
 * Deterministic ordered shelf placement. No automatic reordering, clipping,
 * scaling or constraint relaxation. A conflict returns no candidate placements;
 * callers retain the last valid plan. A conservative solver may reject an input
 * that could fit with more sophisticated search.
 */
export function planIntelligentLayout(input: IntelligentLayoutInput): IntelligentLayoutResult {
  const first = solve(input,true);
  // Soft choices must not make a feasible hard plan fail. At most two passes.
  if(first.status==='conflict' && Array.isArray(input.blocks) &&
    input.blocks.some(b=>b?.preferred!==undefined) &&
    (first.diagnostic.code==='IL_FIXED_CONFLICT'||first.diagnostic.code==='IL_LIMIT'))
    return solve(input,false);
  return first;
}

function solve(input:IntelligentLayoutInput,honorPreferences:boolean):IntelligentLayoutResult {
  const conflict = (code: Extract<IntelligentLayoutResult,{status:'conflict'}>['diagnostic']['code'],
    message:string,blockId?:string,regionId?:string):IntelligentLayoutResult =>
      ({status:'conflict',revision:input.revision,placements:[],publicationReady:false,
        diagnostic:{code,message,blockId,...(regionId!==undefined?{regionId}:{})}});
  if (typeof input.revision!=='string' || !input.revision || !validSize(input.content) || !natural(input.gap) || !Array.isArray(input.blocks))
    return conflict('IL_INVALID','Invalid layout input');
  if(input.blocks.length>10000) return conflict('IL_LIMIT','Block limit exceeded');
  const {width,height}=input.content, gap=input.gap, ids=new Set<string>();
  const reserved=input.reservedRegions===undefined?[]:input.reservedRegions;
  if(!Array.isArray(reserved)) return conflict('IL_INVALID','Invalid reserved regions');
  if(reserved.length>MAX_REGIONS) return conflict('IL_LIMIT','Reserved region limit exceeded');
  const byPage=new Map<number,IntelligentReservedRegion[]>(), regionIds=new Set<string>();
  for(const region of reserved){
    if(!region || typeof region.id!=='string'||!region.id||regionIds.has(region.id)||
      !region.rect||!validSize(region.rect)||!validPosition({page:region.page,x:region.rect.x,y:region.rect.y})||
      region.rect.x+region.rect.width>width||region.rect.y+region.rect.height>height)
      return conflict('IL_INVALID','Invalid or duplicate reserved region',undefined,region?.id);
    regionIds.add(region.id);
    const list=byPage.get(region.page)??[];
    if(list.length>=MAX_REGIONS_PER_PAGE) return conflict('IL_LIMIT','Page reserved region limit exceeded',undefined,region.id);
    list.push(region);byPage.set(region.page,list);
  }
  for(const list of byPage.values()) list.sort((a,b)=>a.rect.x-b.rect.x);
  const regionsAt=(p:number):readonly IntelligentReservedRegion[]=>byPage.get(p)??[];
  const footprints=new Map<string,Size>();
  for(const b of input.blocks){
    if(!b || typeof b.id!=='string' || !b.id || ids.has(b.id) || !validSize(b.size) ||
      (b.spaceBefore!==undefined&&!natural(b.spaceBefore)) ||
      (b.spaceAfter!==undefined&&!natural(b.spaceAfter)) ||
      (b.sideBySide!==undefined&&typeof b.sideBySide!=='boolean') ||
      (b.startNewPage!==undefined&&typeof b.startNewPage!=='boolean'))
      return conflict('IL_INVALID','Invalid or duplicate block',b?.id);
    const mode=b.mode ?? (b.fixed!==undefined?'fixed':b.preferred!==undefined?'preferred':'auto');
    if((b.mode!==undefined&&b.mode!==mode) ||
      (mode!=='auto'&&mode!=='fixed'&&mode!=='preferred') ||
      (mode==='fixed')!==(b.fixed!==undefined) ||
      (mode==='preferred')!==(b.preferred!==undefined) ||
      (b.preferred!==undefined&&!validPosition(b.preferred)))
      return conflict('IL_INVALID','Invalid or contradictory placement mode',b.id);
    ids.add(b.id);
    const footprint=resolveFootprint(b,input.content);
    if('code' in footprint) return conflict(footprint.code,footprint.message,b.id);
    const occupied=footprint.size;
    footprints.set(b.id,occupied);
    if(occupied.width>width || occupied.height+(b.spaceBefore??0)>height)
      return conflict('IL_TOO_LARGE','Measured block or reserved space exceeds page',b.id);
    if(b.fixed!==undefined){
      const f=b.fixed;
      if(!validPosition(f))
        return conflict('IL_INVALID','Invalid fixed position',b.id);
      if(f.x+occupied.width>width||f.y+occupied.height>height)
        return conflict('IL_FIXED_CONFLICT','Fixed block exceeds content area',b.id);
      const hit=regionsAt(f.page).find(r=>overlaps(r.rect,{x:f.x,y:f.y,width:occupied.width,height:occupied.height}));
      if(hit) return conflict('IL_RESERVED_CONFLICT','Fixed block intersects reserved region',b.id,hit.id);
    }
  }
  const placements:IntelligentPlacement[]=[];
  let page=0, rowY=0, bottom=0, right=0, rowOpen=false, rowShare=false;
  function nextPage(p:number){
    page=p;rowY=0;bottom=0;right=0;rowOpen=false;rowShare=false;
  }
  for(const b of input.blocks){
    const {width:w,height:h}=footprints.get(b.id)!, before=b.spaceBefore??0, after=b.spaceAfter??0;
    if(b.startNewPage && rowOpen) nextPage(page+1);
    if(page>=MAX_PAGES) return conflict('IL_LIMIT','Page limit exceeded',b.id);
    let x=0,y=0;
    let preference:IntelligentPlacement['preference']=b.preferred?'fallback':undefined;
    const target=b.preferred;
    if(b.fixed){
      const f=b.fixed;
      if(f.page<page) return conflict('IL_FIXED_CONFLICT','Fixed page conflicts with document order',b.id);
      if(f.page>page) nextPage(f.page);
      const minY=(rowOpen?bottom+gap:0)+before;
      if(f.y<minY) return conflict('IL_FIXED_CONFLICT','Fixed position conflicts with preceding content or reserved space',b.id);
      x=f.x;y=f.y;
      rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=false;
    }else{
      const minY=(rowOpen?bottom+gap:0)+before;
      const shareX=rowOpen && rowShare && b.sideBySide && before===0 && after===0 && rowY+h<=height
        ? findX(regionsAt(page),right+gap,rowY,w,h,width):undefined;
      let naturalPage=page;
      let slot=shareX!==undefined?{x:shareX,y:rowY}:findRow(regionsAt(page),minY,w,h,width,height);
      // Every failed page advances. With no exclusions, the next page must fit.
      while(!slot && ++naturalPage<MAX_PAGES)
        slot=findRow(regionsAt(naturalPage),before,w,h,width,height);
      if(!slot || naturalPage>=MAX_PAGES) return conflict('IL_LIMIT','Page limit exceeded',b.id);
      const targetMinY=target?.page===page?minY:before;
      const canHonor=honorPreferences && target && target.page===naturalPage &&
        target.x+w<=width && target.y>=targetMinY && target.y+h<=height &&
        !regionsAt(target.page).some(r=>overlaps(r.rect,{x:target.x,y:target.y,width:w,height:h}));
      if(canHonor && target){
        if(target.page!==page) nextPage(target.page);
        x=target.x;y=target.y;preference='honored';
        rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=false;
      }else if(shareX!==undefined){
        x=shareX;y=rowY;right=x+w;bottom=Math.max(bottom,y+h);
      }else{
        if(naturalPage!==page) nextPage(naturalPage);
        x=slot.x;y=slot.y;
        rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=!!b.sideBySide&&before===0&&after===0;
      }
    }
    if(target && page===target.page && x===target.x && y===target.y) preference='honored';
    placements.push({id:b.id,page,rect:{x,y,width:b.size.width,height:b.size.height},fixed:!!b.fixed,
      ...(w!==b.size.width||h!==b.size.height?{occupiedRect:{x,y,width:w,height:h}}:{}),
      ...(preference!==undefined?{preference}:{})});
  }
  return {status:'placed',revision:input.revision,placements,publicationReady:false};
}
