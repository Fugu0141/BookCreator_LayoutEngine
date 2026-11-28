import type { Rect, Size } from './index.js';

// Pure, measured, indivisible-block placement. All dimensions are integer µm.
// The caller owns measurement and semantic order; this module never edits source.
export type IntelligentPlacementMode = 'auto' | 'preferred' | 'fixed';
export interface IntelligentPosition { page:number; x:number; y:number }

export interface IntelligentBlock {
  id: string;
  size: Readonly<Size>;
  // Only consecutive opt-in blocks may share a row.
  sideBySide?: boolean;
  // An exact user constraint; never silently moved or resized.
  fixed?: Readonly<IntelligentPosition>;
  // Omitted mode is inferred from position fields for legacy callers.
  mode?: IntelligentPlacementMode;
  preferred?: Readonly<IntelligentPosition>;
  // Preserve intentionally reserved whitespace.
  spaceBefore?: number;
  startNewPage?: boolean;
}
export interface IntelligentLayoutInput {
  revision: string;
  content: Readonly<Size>;
  gap: number;
  blocks: readonly IntelligentBlock[];
}
export interface IntelligentPlacement {
  id: string;
  page: number;
  rect: Rect;
  fixed: boolean;
  preference?: 'honored' | 'fallback';
}
export type IntelligentLayoutResult =
  | {status:'placed'; revision:string; placements: IntelligentPlacement[]; publicationReady:false}
  | {status:'conflict'; revision:string; placements: []; publicationReady:false;
      diagnostic:{code:'IL_INVALID'|'IL_TOO_LARGE'|'IL_FIXED_CONFLICT'|'IL_LIMIT'; blockId?:string; message:string}};

const MAX = 1_000_000_000;
const MAX_PAGES = 10000;
const natural = (n:number) => Number.isSafeInteger(n) && n>=0 && n<=MAX;
const positive = (n:number) => natural(n) && n>0;
const validSize = (s:Size) => !!s && positive(s.width) && positive(s.height);
const validPosition = (p:IntelligentPosition) => !!p && natural(p.page) && p.page<MAX_PAGES && natural(p.x) && natural(p.y);

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
    message:string,blockId?:string):IntelligentLayoutResult =>
      ({status:'conflict',revision:input.revision,placements:[],publicationReady:false,diagnostic:{code,message,blockId}});
  if (typeof input.revision!=='string' || !input.revision || !validSize(input.content) || !natural(input.gap) || !Array.isArray(input.blocks))
    return conflict('IL_INVALID','Invalid layout input');
  if(input.blocks.length>10000) return conflict('IL_LIMIT','Block limit exceeded');
  const {width,height}=input.content, gap=input.gap, ids=new Set<string>();
  for(const b of input.blocks){
    if(!b || typeof b.id!=='string' || !b.id || ids.has(b.id) || !validSize(b.size) ||
      (b.spaceBefore!==undefined&&!natural(b.spaceBefore)) ||
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
    if(b.size.width>width || b.size.height+(b.spaceBefore??0)>height)
      return conflict('IL_TOO_LARGE','Measured block or reserved space exceeds page',b.id);
    if(b.fixed!==undefined){
      const f=b.fixed;
      if(!validPosition(f))
        return conflict('IL_INVALID','Invalid fixed position',b.id);
      if(f.x+b.size.width>width||f.y+b.size.height>height)
        return conflict('IL_FIXED_CONFLICT','Fixed block exceeds content area',b.id);
    }
  }
  const placements:IntelligentPlacement[]=[];
  let page=0, rowY=0, bottom=0, right=0, rowOpen=false, rowShare=false;
  function nextPage(p:number){
    page=p;rowY=0;bottom=0;right=0;rowOpen=false;rowShare=false;
  }
  for(const b of input.blocks){
    const {width:w,height:h}=b.size, before=b.spaceBefore??0;
    if(b.startNewPage && rowOpen) nextPage(page+1);
    if(page>=MAX_PAGES) return conflict('IL_LIMIT','Page limit exceeded',b.id);
    let x=0,y=0;
    let preference:IntelligentPlacement['preference']=b.preferred?'fallback':undefined;
    const share=rowOpen && rowShare && b.sideBySide && before===0 && right+gap+w<=width && rowY+h<=height;
    const minY=(rowOpen?bottom+gap:0)+before;
    // Never introduce an extra page solely for a soft target.
    const naturalPage=share||minY+h<=height?page:page+1;
    const target=b.preferred;
    const targetMinY=target?.page===page?minY:before;
    const canHonor=honorPreferences && target && target.page===naturalPage &&
      target.page<MAX_PAGES && target.x+w<=width && target.y>=targetMinY && target.y+h<=height;
    if(b.fixed){
      const f=b.fixed;
      if(f.page<page) return conflict('IL_FIXED_CONFLICT','Fixed page conflicts with document order',b.id);
      if(f.page>page) nextPage(f.page);
      const minY=(rowOpen?bottom+gap:0)+before;
      if(f.y<minY) return conflict('IL_FIXED_CONFLICT','Fixed position conflicts with preceding content or reserved space',b.id);
      x=f.x;y=f.y;
      rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=false;
    }else if(canHonor && target){
      if(target.page!==page) nextPage(target.page);
      x=target.x;y=target.y;preference='honored';
      // Isolated row: do not fill the space above or beside the target.
      rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=false;
    }else if(share){
      x=right+gap;y=rowY;
      right=x+w;bottom=Math.max(bottom,y+h);
    }else{
      y=(rowOpen?bottom+gap:0)+before;
      if(y+h>height){
        nextPage(page+1);y=before;
        if(page>=MAX_PAGES) return conflict('IL_LIMIT','Page limit exceeded',b.id);
      }
      rowY=y;bottom=y+h;right=w;rowOpen=true;rowShare=!!b.sideBySide&&before===0;
    }
    if(target && page===target.page && x===target.x && y===target.y) preference='honored';
    placements.push({id:b.id,page,rect:{x,y,width:w,height:h},fixed:!!b.fixed,
      ...(preference!==undefined?{preference}:{})});
  }
  return {status:'placed',revision:input.revision,placements,publicationReady:false};
}
