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
  // Repeated overhead reserved once per fragment, not once per line.
  fragmentPadding?:{top:number;bottom:number};
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
// Opaque, module-owned checkpoint handle. The public plan may be mutated by
// its consumer without mutating the saved state.
export interface PaginationCheckpointSnapshot {readonly kind:'pagination-checkpoint-snapshot'}
export interface IncrementalPaginationResult {
  plan:MeasuredPagePlan;
  snapshot?:PaginationCheckpointSnapshot;
  // Counts of placement work, not validation, cloning, or elapsed time.
  reusedBlocks:number;
  placedBlocks:number;
}
type Checkpoint={used:number;reason:Fragment['breakReason'];pageCount:number;lastFragmentCount:number;diagnosticCount:number};
type SavedPagination={width:number;height:number;keys:string[];checkpoints:Checkpoint[];plan:MeasuredPagePlan};
type IncrementalState={previous?:SavedPagination;next?:SavedPagination;reusedBlocks:number;placedBlocks:number};
const snapshots=new WeakMap<PaginationCheckpointSnapshot,SavedPagination>();
const MAX_CHECKPOINT_EVENTS=10000,MAX_CHECKPOINT_UNITS=100000,MAX_CHECKPOINT_FRAGMENTS=50000;
const originKey=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
export function paginateMeasured(input:PaginationInput):MeasuredPagePlan {
  return runPagination(input);
}
/** Reuse the verified unchanged placement prefix, then run the same placement
 * rules as the full API. Validation and current-origin rebinding still scan
 * the input. No suffix convergence or browser measurement reuse is implied. */
export function paginateMeasuredIncremental(input:PaginationInput,previous?:PaginationCheckpointSnapshot):IncrementalPaginationResult {
  const state:IncrementalState={previous:previous?snapshots.get(previous):undefined,reusedBlocks:0,placedBlocks:0};
  const plan=runPagination(input,state);
  let snapshot:PaginationCheckpointSnapshot|undefined;
  if(state.next){
    snapshot=Object.freeze({kind:'pagination-checkpoint-snapshot' as const});
    snapshots.set(snapshot,state.next);
  }
  return {plan,snapshot,reusedBlocks:state.reusedBlocks,placedBlocks:state.placedBlocks};
}
function runPagination(input:PaginationInput,incremental?:IncrementalState):MeasuredPagePlan {
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
      const padding=block.fragmentPadding;
      if(padding!==undefined&&(!padding||!Number.isSafeInteger(padding.top)||padding.top<0||!Number.isSafeInteger(padding.bottom)||padding.bottom<0||!Number.isSafeInteger(padding.top+padding.bottom)))return fail('PG_INVALID','Invalid fragment padding',o);
      unitCount+=block.unitHeights.length;
      if(unitCount>1000000)return fail('PG_LIMIT','Unit limit exceeded',o);
      let total=0;
      for(const h of block.unitHeights){total+=h;if(!positive(h)||!positive(total))return fail('PG_INVALID','Invalid unit height',o);}
      if(!positive(total+(padding?padding.top+padding.bottom:0)))return fail('PG_INVALID','Invalid padded block height',o);
    }
  }
  let used=0;
  let reason:Fragment['breakReason']='flow';
  // Section transitions are events too (including empty sections). Every
  // checkpoint is before an event, never in the middle of a split block.
  const retain=!!incremental&&blockCount+input.sections.length<=MAX_CHECKPOINT_EVENTS&&unitCount<=MAX_CHECKPOINT_UNITS;
  const eventKeys:string[]=[],checkpoints:Checkpoint[]=[];
  const currentOrigins=new Map<string,Origin>();
  let prefix=0,eventIndex=0;
  if(retain){
    for(const section of input.sections){
      eventKeys.push(JSON.stringify(['section',section.id,section.startOn]));
      for(const block of section.blocks){
        const k=originKey(block.origin);
        currentOrigins.set(k,block.origin);
        eventKeys.push(JSON.stringify(block.kind==='pagebreak'?['break',k]:[
          'block',k,block.width,block.unitHeights,block.splitPolicy,
          block.fragmentPadding?.top??0,block.fragmentPadding?.bottom??0,
          block.startPosition??'flow',block.startPositionSource??null
        ]));
      }
    }
    const prev=incremental?.previous;
    if(prev&&prev.width===width&&prev.height===height){
      while(prefix<eventKeys.length&&prefix<prev.keys.length&&eventKeys[prefix]===prev.keys[prefix])prefix++;
      if(prefix){
        const cp=prev.checkpoints[prefix];
        used=cp.used;reason=cp.reason;
        // Copy only the prefix fragments. Replace every retained source origin
        // with this revision's actual object; offsets are not placement keys.
        result.pages=prev.plan.pages.slice(0,cp.pageCount).map((p,i)=>({
          index:p.index,fragments:p.fragments.slice(0,i===cp.pageCount-1?cp.lastFragmentCount:undefined).map(f=>({
            ...f,rect:{...f.rect},origin:currentOrigins.get(originKey(f.origin))!
          }))
        }));
        result.diagnostics=prev.plan.diagnostics.slice(0,cp.diagnosticCount).map(d=>({
          ...d,origin:d.origin?currentOrigins.get(originKey(d.origin)):undefined
        }));
        checkpoints.push(...prev.checkpoints.slice(0,prefix));
      }
    }
  }
  const capture=():Checkpoint=>({used,reason,pageCount:result.pages.length,lastFragmentCount:result.pages.at(-1)?.fragments.length??0,diagnosticCount:result.diagnostics.length});
  const visit=()=>{
    if(!retain)return false;
    const index=eventIndex++;
    if(index<prefix)return true;
    checkpoints.push(capture());return false;
  };
  const newPage=(why:Fragment['breakReason'])=>{used=0;reason=why;};
  for(const section of input.sections){
    if(!visit()&&section.startOn==='page'&&used>0)newPage('section');
    let first=true;
    for(const block of section.blocks){
      const skipped=visit();
      if(block.kind==='pagebreak'){if(!skipped&&used>0)newPage('explicit');first=false;continue;}
      const suppress=first&&section.startOn==='continuous'&&block.startPositionSource==='component';
      first=false;
      if(skipped){if(incremental)incremental.reusedBlocks++;continue;}
      if(incremental)incremental.placedBlocks++;
      if(block.startPosition==='page-top'&&!suppress&&used>0)newPage('page-top');
      const overhead=block.fragmentPadding?block.fragmentPadding.top+block.fragmentPadding.bottom:0;
      const total=block.unitHeights.reduce((a,b)=>a+b,0)+overhead;
      if(block.unitHeights.some(h=>h+overhead>height)||(block.splitPolicy==='strict'&&total>height))return fail('PG_TOO_LARGE','Indivisible content exceeds page',block.origin);
      if(block.splitPolicy==='strict'||(block.splitPolicy==='avoid'&&total<=height)){
        if(total>height-used)newPage('overflow');
      }else if(block.splitPolicy==='avoid'){
        result.diagnostics.push({code:'PG_AVOID_SPLIT',severity:'warning',message:'Block exceeds an empty page; safe splitting required',origin:block.origin});
      }
      let cursor=0, continuationIndex=0;
      while(cursor<block.unitHeights.length){
        if(block.unitHeights[cursor]+overhead>height-used)newPage(cursor?'continuation':'overflow');
        let end=cursor,h=overhead;
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
  if(retain&&incremental&&result.pages.reduce((n,p)=>n+p.fragments.length,0)<=MAX_CHECKPOINT_FRAGMENTS){
    checkpoints.push(capture());
    // Snapshot ownership is private, and only complete plans are reusable.
    // An unsupported cloning environment/extra origin data simply disables reuse.
    try{incremental.next={width,height,keys:eventKeys,checkpoints,plan:structuredClone(result)};}catch{/* no snapshot */}
  }
  return result;
}
