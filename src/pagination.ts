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
  reusedSuffixBlocks:number;
  placedBlocks:number;
}
type Checkpoint={used:number;reason:Fragment['breakReason'];pageCount:number;lastFragmentCount:number;diagnosticCount:number};
type SavedPagination={width:number;height:number;keys:string[];checkpoints:Checkpoint[];plan:MeasuredPagePlan};
type IncrementalState={previous?:SavedPagination;next?:SavedPagination;reusedBlocks:number;reusedSuffixBlocks:number;placedBlocks:number};
const snapshots=new WeakMap<PaginationCheckpointSnapshot,SavedPagination>();
const MAX_CHECKPOINT_EVENTS=10000,MAX_CHECKPOINT_UNITS=100000,MAX_CHECKPOINT_FRAGMENTS=50000;
const originKey=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
export type PaginationWorkStage='paginate-validate'|'paginate-key'|'paginate-place'|'paginate-match'|'paginate-reuse';
export type PaginationWorkCheckpoint=(stage:PaginationWorkStage)=>void|Promise<void>;
function finishSynchronously(work:Generator<PaginationWorkStage,MeasuredPagePlan,void>):MeasuredPagePlan {
  let step=work.next();
  while(!step.done)step=work.next();
  return step.value;
}
export function paginateMeasured(input:PaginationInput):MeasuredPagePlan {
  return finishSynchronously(runPagination(input));
}
/** Reuse the verified unchanged placement prefix and, after the same flow
 * state is reached, an identical suffix. Validation, copying and current-origin
 * rebinding still scan the input. No browser measurement reuse is implied. */
export function paginateMeasuredIncremental(input:PaginationInput,previous?:PaginationCheckpointSnapshot):IncrementalPaginationResult {
  const state:IncrementalState={previous:previous?snapshots.get(previous):undefined,reusedBlocks:0,reusedSuffixBlocks:0,placedBlocks:0};
  const plan=finishSynchronously(runPagination(input,state));
  return finishIncremental(plan,state);
}
/** Cooperative variant of the same placement algorithm. The caller owns input
 * and must keep it unchanged until completion. A rejected checkpoint aborts
 * without publishing a new snapshot or changing the previous snapshot. */
export async function paginateMeasuredIncrementalCooperative(input:PaginationInput,previous:PaginationCheckpointSnapshot|undefined,checkpoint:PaginationWorkCheckpoint):Promise<IncrementalPaginationResult>{
  const state:IncrementalState={previous:previous?snapshots.get(previous):undefined,reusedBlocks:0,reusedSuffixBlocks:0,placedBlocks:0};
  const work=runPagination(input,state);
  try{
    let step=work.next();
    while(!step.done){
      const wait=checkpoint(step.value);if(wait)await wait;
      step=work.next();
    }
    return finishIncremental(step.value,state);
  }finally{work.return(undefined as never);}
}
function finishIncremental(plan:MeasuredPagePlan,state:IncrementalState):IncrementalPaginationResult{
  let snapshot:PaginationCheckpointSnapshot|undefined;
  if(state.next){
    snapshot=Object.freeze({kind:'pagination-checkpoint-snapshot' as const});
    snapshots.set(snapshot,state.next);
  }
  return {plan,snapshot,reusedBlocks:state.reusedBlocks,reusedSuffixBlocks:state.reusedSuffixBlocks,placedBlocks:state.placedBlocks};
}
function* runPagination(input:PaginationInput,incremental?:IncrementalState):Generator<PaginationWorkStage,MeasuredPagePlan,void> {
  const result:MeasuredPagePlan={schemaVersion:1,revision:input.revision,fingerprint:input.fingerprint,completeness:'partial',measurement:'premeasured',publicationReady:false,pages:[],diagnostics:[]};
  const fail=(code:PaginationDiagnostic['code'],message:string,origin?:Origin)=>{result.diagnostics.push({code,severity:'error',message,origin});return result;};
  const {width,height}=input.content;
  if(input.schemaVersion!==1||!input.revision||!input.fingerprint||!positive(width)||!positive(height))return fail('PG_INVALID','Invalid input or content size');
  const ids=new Set<string>(),keys=new Set<string>();
  let unitCount=0, blockCount=0,validatedSections=0,validatedUnits=0;
  // Validate the entire input first; never place an invalid block silently.
  for(const section of input.sections){
    if(validatedSections++%32===0)yield 'paginate-validate';
    if(!section.id||ids.has(section.id)||!['page','continuous'].includes(section.startOn))return fail('PG_INVALID','Invalid section');
    ids.add(section.id);
    for(const block of section.blocks){
      if(blockCount%32===0)yield 'paginate-validate';
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
      for(const h of block.unitHeights){
        if(validatedUnits++%256===0)yield 'paginate-validate';
        total+=h;if(!positive(h)||!positive(total))return fail('PG_INVALID','Invalid unit height',o);
      }
      if(!positive(total+(padding?padding.top+padding.bottom:0)))return fail('PG_INVALID','Invalid padded block height',o);
    }
  }
  let used=0;
  let reason:Fragment['breakReason']='flow';
  // Section transitions are events too (including empty sections). Every
  // checkpoint is before an event, never in the middle of a split block.
  const retain=!!incremental&&blockCount+input.sections.length<=MAX_CHECKPOINT_EVENTS&&unitCount<=MAX_CHECKPOINT_UNITS;
  const eventKeys:string[]=[],blockEvents:boolean[]=[],checkpoints:Checkpoint[]=[];
  const currentOrigins=new Map<string,Origin>();
  let prefix=0,eventIndex=0,suffix=0;
  let compatible:SavedPagination|undefined;
  let copied=0;
  const copyFragment=(f:Fragment):Fragment=>({...f,rect:{...f.rect},origin:currentOrigins.get(originKey(f.origin))!});
  const copyDiagnostic=(d:PaginationDiagnostic):PaginationDiagnostic=>({...d,origin:d.origin?currentOrigins.get(originKey(d.origin)):undefined});
  function* copyFragments(source:readonly Fragment[],target:Fragment[],start=0,end=source.length):Generator<PaginationWorkStage,void,void>{
    for(let i=start;i<end;i++){
      if(copied++%128===0)yield 'paginate-reuse';
      target.push(copyFragment(source[i]));
    }
  }
  if(retain){
    for(const section of input.sections){
      if(eventKeys.length%32===0)yield 'paginate-key';
      eventKeys.push(JSON.stringify(['section',section.id,section.startOn]));blockEvents.push(false);
      let first=true;
      for(const block of section.blocks){
        if(eventKeys.length%32===0)yield 'paginate-key';
        const k=originKey(block.origin);
        currentOrigins.set(k,block.origin);
        // A suffix can begin inside a section: include the first-block
        // context that controls suppression of component page-top placement.
        const suppress=first&&section.startOn==='continuous'&&block.kind==='block'&&block.startPositionSource==='component';
        first=false;blockEvents.push(block.kind==='block');
        eventKeys.push(JSON.stringify(block.kind==='pagebreak'?['break',k]:[
          'block',k,suppress,block.width,block.unitHeights,block.splitPolicy,
          block.fragmentPadding?.top??0,block.fragmentPadding?.bottom??0,
          block.startPosition??'flow',block.startPositionSource??null
        ]));
      }
    }
    const prev=incremental?.previous;
    if(prev&&prev.width===width&&prev.height===height){
      while(prefix<eventKeys.length&&prefix<prev.keys.length){
        if(prefix%128===0)yield 'paginate-match';
        if(eventKeys[prefix]!==prev.keys[prefix])break;
        prefix++;
      }
      compatible=prev;
      while(suffix<eventKeys.length-prefix&&suffix<prev.keys.length-prefix){
        if(suffix%128===0)yield 'paginate-match';
        if(eventKeys[eventKeys.length-1-suffix]!==prev.keys[prev.keys.length-1-suffix])break;
        suffix++;
      }
      if(prefix){
        const cp=prev.checkpoints[prefix];
        used=cp.used;reason=cp.reason;
        // Copy only the prefix fragments. Replace every retained source origin
        // with this revision's actual object; offsets are not placement keys.
        for(let i=0;i<cp.pageCount;i++){
          if(copied++%128===0)yield 'paginate-reuse';
          const p=prev.plan.pages[i],fragments:Fragment[]=[];
          yield* copyFragments(p.fragments,fragments,0,i===cp.pageCount-1?cp.lastFragmentCount:p.fragments.length);
          result.pages.push({index:p.index,fragments});
        }
        for(let i=0;i<cp.diagnosticCount;i++){
          if(copied++%128===0)yield 'paginate-reuse';
          result.diagnostics.push(copyDiagnostic(prev.plan.diagnostics[i]));
        }
        // Prefix checkpoint records are private immutable values; share them
        // instead of building a temporary slice/spread array.
        for(let i=0;i<prefix;i++){
          if(copied++%128===0)yield 'paginate-reuse';
          checkpoints.push(prev.checkpoints[i]);
        }
      }
    }
  }
  const capture=():Checkpoint=>({used,reason,pageCount:result.pages.length,lastFragmentCount:result.pages.at(-1)?.fragments.length??0,diagnosticCount:result.diagnostics.length});
  // The remaining event sequence is identical. Require the same page count,
  // occupied height and break reason, so page indices, limits and subsequent
  // placement decisions cannot change. Earlier fragments and warnings may
  // differ: splice only the actual tail and adjust its checkpoint counters.
  function* reuseTail(index:number):Generator<PaginationWorkStage,boolean,void>{
    const prev=compatible;
    if(!prev||!incremental||!suffix||index<eventKeys.length-suffix)return false;
    const oldIndex=prev.keys.length-(eventKeys.length-index);
    const before=prev.checkpoints[oldIndex],now=capture();
    if(before.used!==now.used||before.reason!==now.reason||before.pageCount!==now.pageCount)return false;
    const fragmentDelta=now.lastFragmentCount-before.lastFragmentCount;
    const diagnosticDelta=now.diagnosticCount-before.diagnosticCount;
    if(before.pageCount){
      yield* copyFragments(prev.plan.pages[before.pageCount-1].fragments,result.pages[before.pageCount-1].fragments,before.lastFragmentCount);
    }
    for(let i=before.pageCount;i<prev.plan.pages.length;i++){
      if(copied++%128===0)yield 'paginate-reuse';
      const p=prev.plan.pages[i],fragments:Fragment[]=[];
      yield* copyFragments(p.fragments,fragments);
      result.pages.push({index:p.index,fragments});
    }
    for(let i=before.diagnosticCount;i<prev.plan.diagnostics.length;i++){
      if(copied++%128===0)yield 'paginate-reuse';
      result.diagnostics.push(copyDiagnostic(prev.plan.diagnostics[i]));
    }
    for(let i=oldIndex;i<prev.checkpoints.length-1;i++){
      if(copied++%128===0)yield 'paginate-reuse';
      const cp=prev.checkpoints[i];
      checkpoints.push({...cp,lastFragmentCount:cp.lastFragmentCount+(cp.pageCount===before.pageCount?fragmentDelta:0),diagnosticCount:cp.diagnosticCount+diagnosticDelta});
    }
    const end=prev.checkpoints.at(-1)!;
    used=end.used;reason=end.reason;
    for(let i=index;i<blockEvents.length;i++){
      if(copied++%128===0)yield 'paginate-reuse';
      if(blockEvents[i]){
        incremental.reusedBlocks++;incremental.reusedSuffixBlocks++;
      }
    }
    return true;
  }
  function* visit():Generator<PaginationWorkStage,'skip'|'place'|'tail',void>{
    if(!retain)return 'place';
    const index=eventIndex++;
    if(index<prefix)return 'skip';
    if(yield* reuseTail(index))return 'tail';
    checkpoints.push(capture());return 'place';
  }
  const newPage=(why:Fragment['breakReason'])=>{used=0;reason=why;};
  let placementEvents=0,placedUnits=0;
  placement: for(const section of input.sections){
    if(placementEvents++%32===0)yield 'paginate-place';
    const entry=yield* visit();
    if(entry==='tail')break placement;
    if(entry==='place'&&section.startOn==='page'&&used>0)newPage('section');
    let first=true;
    for(const block of section.blocks){
      if(placementEvents++%32===0)yield 'paginate-place';
      const action=yield* visit();
      if(action==='tail')break placement;
      const skipped=action==='skip';
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
        while(end<block.unitHeights.length&&block.unitHeights[end]<=height-used-h){
          if(placedUnits++%256===0)yield 'paginate-place';
          h+=block.unitHeights[end];end++;
        }
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
