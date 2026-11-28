import type { Rect, Size } from './index.js';

// Pure, measured, indivisible-block placement. All dimensions are integer µm.
// The caller owns measurement and semantic order; this module never edits source.
export interface IntelligentBlock {
  id: string;
  size: Readonly<Size>;
  // Only consecutive opt-in blocks may share a row.
  sideBySide?: boolean;
  // An exact user constraint; never silently moved or resized.
  fixed?: Readonly<{page:number; x:number; y:number}>;
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

/**
 * Deterministic ordered shelf placement. No automatic reordering, clipping,
 * scaling or constraint relaxation. A conflict returns no candidate placements;
 * callers retain the last valid plan. A conservative solver may reject an input
 * that could fit with more sophisticated search.
 */
export function planIntelligentLayout(input: IntelligentLayoutInput): IntelligentLayoutResult {
  const conflict = (code: Extract<IntelligentLayoutResult,{status:'conflict'}>['diagnostic']['code'],
    message:string,blockId?:string):IntelligentLayoutResult =>
      ({status:'conflict',revision:input.revision,placements:[],publicationReady:false,diagnostic:{code,message,blockId}});
  if (!input.revision || !validSize(input.content) || !natural(input.gap) || !Array.isArray(input.blocks))
    return conflict('IL_INVALID','Invalid layout input');
  if(input.blocks.length>10000) return conflict('IL_LIMIT','Block limit exceeded');
  const {width,height}=input.content, gap=input.gap, ids=new Set<string>();
  for(const b of input.blocks){
    if(!b || typeof b.id!=='string' || !b.id || ids.has(b.id) || !validSize(b.size) ||
      (b.spaceBefore!==undefined&&!natural(b.spaceBefore)) ||
      (b.sideBySide!==undefined&&typeof b.sideBySide!=='boolean') ||
      (b.startNewPage!==undefined&&typeof b.startNewPage!=='boolean'))
      return conflict('IL_INVALID','Invalid or duplicate block',b?.id);
    ids.add(b.id);
    if(b.size.width>width || b.size.height+(b.spaceBefore??0)>height)
      return conflict('IL_TOO_LARGE','Measured block or reserved space exceeds page',b.id);
    if(b.fixed!==undefined){
      const f=b.fixed;
      if(!f || !natural(f.page)||f.page>=MAX_PAGES||!natural(f.x)||!natural(f.y))
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
    if(b.fixed){
      const f=b.fixed;
      if(f.page<page) return conflict('IL_FIXED_CONFLICT','Fixed page conflicts with document order',b.id);
      if(f.page>page) nextPage(f.page);
      const minY=(rowOpen?bottom+gap:0)+before;
      if(f.y<minY) return conflict('IL_FIXED_CONFLICT','Fixed position conflicts with preceding content or reserved space',b.id);
      x=f.x;y=f.y;
      rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=false;
    }else if(rowOpen && rowShare && b.sideBySide && before===0 && right+gap+w<=width && rowY+h<=height){
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
    placements.push({id:b.id,page,rect:{x,y,width:w,height:h},fixed:!!b.fixed});
  }
  return {status:'placed',revision:input.revision,placements,publicationReady:false};
}
