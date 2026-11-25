import type { Size, Rect } from './index.js';

// Experimental premeasured single-column pagination. No text measurement or rendering.
export interface Origin {
  documentId: string;
  revision: string;
  blockKey: string;
  range?: {start:number; end:number};
  persistentId?: string;
}
export type SplitPolicy = 'allow'|'avoid'|'strict';
export interface MeasuredBlock {
  kind: 'block';
  origin: Origin;
  width: number;
  // Each positive unit is indivisible; boundaries between units are safe splits.
  unitHeights: readonly number[];
  splitPolicy: SplitPolicy;
  startPosition?: 'flow'|'page-top';
  startPositionSource?: 'component'|'explicit';
}
export interface PageBreak {kind:'pagebreak'; origin:Origin}
export interface MeasuredSection {
  id:string;
  startOn:'page'|'continuous';
  blocks:readonly (MeasuredBlock|PageBreak)[];
}
export interface PaginationInput {
  schemaVersion:1;
  revision:string;
  fingerprint:string;
  content:Size;
  sections:readonly MeasuredSection[];
}
export interface Fragment {
  origin:Origin;
  rect:Rect;
  unitStart:number;
  unitEnd:number;
  continuationIndex:number;
  breakReason:'flow'|'page-top'|'section'|'explicit'|'overflow'|'continuation';
}
export interface PaginationDiagnostic {
  code:'PG_INVALID'|'PG_TOO_LARGE'|'PG_AVOID_SPLIT'|'PG_LIMIT';
  severity:'error'|'warning';
  message:string;
  origin?:Origin;
}
export interface MeasuredPage {index:number; fragments:Fragment[]}
export interface MeasuredPagePlan {
  schemaVersion:1;
  revision:string;
  fingerprint:string;
  // Full means only the measured subset was placed, never publication readiness.
  completeness:'full'|'partial';
  measurement:'premeasured';
  publicationReady:false;
  pages:MeasuredPage[];
  diagnostics:PaginationDiagnostic[];
}
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;
export function paginateMeasured(input:PaginationInput):MeasuredPagePlan {
  const result:MeasuredPagePlan={schemaVersion:1,revision:input.revision,fingerprint:input.fingerprint,completeness:'partial',measurement:'premeasured',publicationReady:false,pages:[],diagnostics:[]};
  const fail=(code:PaginationDiagnostic['code'],message:string,origin?:Origin)=>{result.diagnostics.push({code,severity:'error',message,origin});return result;};
  const {width,height}=input.content;
  if(input.schemaVersion!==1||!input.revision||!input.fingerprint||!positive(width)||!positive(height))return fail('PG_INVALID','Invalid input or content size');
  const ids=new Set<string>(),keys=new Set<string>();
  let unitCount=0, blockCount=0;
  // Validate the entire input first; never place an invalid block silently.
  for(const section of input.sections){
    if(!section.id||ids.has(section.id)||!['page','continuous'].includes(section.startOn))return fail('PG_INVALID','Invalid section');
    ids.add(section.id);
    for(const block of section.blocks){
      const o=block.origin;
      const key=JSON.stringify([o.documentId,o.blockKey]);
      if(!o.documentId||!o.revision||!o.blockKey||keys.has(key)|| (o.range&&(!Number.isSafeInteger(o.range.start)||!Number.isSafeInteger(o.range.end)||o.range.start<0||o.range.end<=o.range.start)))return fail('PG_INVALID','Invalid or duplicate origin',o);
      keys.add(key);
      if(++blockCount>100000)return fail('PG_LIMIT','Block limit exceeded',o);
      if(block.kind==='pagebreak')continue;
      if(block.kind!=='block'||!positive(block.width)||block.width>width||!block.unitHeights.length||!['allow','avoid','strict'].includes(block.splitPolicy)||
        (block.startPosition!==undefined&&!['flow','page-top'].includes(block.startPosition))||
        (block.startPositionSource!==undefined&&!['component','explicit'].includes(block.startPositionSource))||
        (block.startPosition==='page-top'&&!block.startPositionSource))return fail('PG_INVALID','Invalid measured block',o);
      unitCount+=block.unitHeights.length;
      if(unitCount>1000000)return fail('PG_LIMIT','Unit limit exceeded',o);
      let total=0;
      for(const h of block.unitHeights){total+=h;if(!positive(h)||!positive(total))return fail('PG_INVALID','Invalid unit height',o);}
    }
  }
  let used=0;
  let reason:Fragment['breakReason']='flow';
  const newPage=(why:Fragment['breakReason'])=>{used=0;reason=why;};
  for(const section of input.sections){
    if(section.startOn==='page'&&used>0)newPage('section');
    let first=true;
    for(const block of section.blocks){
      if(block.kind==='pagebreak'){if(used>0)newPage('explicit');first=false;continue;}
      const suppress=first&&section.startOn==='continuous'&&block.startPositionSource==='component';
      first=false;
      if(block.startPosition==='page-top'&&!suppress&&used>0)newPage('page-top');
      const total=block.unitHeights.reduce((a,b)=>a+b,0);
      if(block.unitHeights.some(h=>h>height)||(block.splitPolicy==='strict'&&total>height))return fail('PG_TOO_LARGE','Indivisible content exceeds page',block.origin);
      if(block.splitPolicy==='strict'||(block.splitPolicy==='avoid'&&total<=height)){
        if(total>height-used)newPage('overflow');
      }else if(block.splitPolicy==='avoid'){
        result.diagnostics.push({code:'PG_AVOID_SPLIT',severity:'warning',message:'Block exceeds an empty page; safe splitting required',origin:block.origin});
      }
      let cursor=0, continuationIndex=0;
      while(cursor<block.unitHeights.length){
        if(block.unitHeights[cursor]>height-used)newPage(cursor?'continuation':'overflow');
        let end=cursor,h=0;
        while(end<block.unitHeights.length&&block.unitHeights[end]<=height-used-h){h+=block.unitHeights[end];end++;}
        if(end===cursor)return fail('PG_TOO_LARGE','No safe progress',block.origin);
        if(used===0){
          if(result.pages.length>=10000)return fail('PG_LIMIT','Page limit exceeded',block.origin);
          result.pages.push({index:result.pages.length,fragments:[]});
        }
        result.pages.at(-1)!.fragments.push({origin:block.origin,rect:{x:0,y:used,width:block.width,height:h},unitStart:cursor,unitEnd:end,continuationIndex:continuationIndex++,breakReason:reason});
        used+=h;cursor=end;reason='flow';
        if(cursor<block.unitHeights.length)newPage('continuation');
      }
    }
  }
  result.completeness='full';
  return result;
}
