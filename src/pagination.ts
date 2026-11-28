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
  /** Soft minimum indivisible units before and after a split, respectively. */
  minUnitsBefore?:number;
  minUnitsAfter?:number;
  /** Opt-in minimum-page search among legal partitions satisfying both minima. */
  optimizeSplit?:boolean;
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
  code:'PG_INVALID'|'PG_TOO_LARGE'|'PG_AVOID_SPLIT'|'PG_LIMIT'|'PG_SPLIT_MINIMUM';
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
  /** Number of private fragment values shared with the preceding snapshot. */
  sharedSnapshotFragments:number;
}
type Checkpoint={used:number;reason:Fragment['breakReason'];pageCount:number;lastFragmentCount:number;diagnosticCount:number};
// Private geometry contains only a stable source key, never live Origin
// metadata. These values are immutable by ownership and may span generations.
type SavedFragment=Readonly<Omit<Fragment,'origin'|'rect'>&{originKey:string;rect:Readonly<Rect>}>;
type SavedDiagnostic=Readonly<Omit<PaginationDiagnostic,'origin'>&{originKey?:string}>;
type SavedPage={readonly index:number;readonly fragments:readonly SavedFragment[]};
type SavedPagination={width:number;height:number;keys:string[];checkpoints:Checkpoint[];plan:{pages:SavedPage[];diagnostics:SavedDiagnostic[]}};
type IncrementalState={previous?:SavedPagination;next?:SavedPagination;reusedBlocks:number;reusedSuffixBlocks:number;placedBlocks:number;sharedSnapshotFragments:number};
const snapshots=new WeakMap<PaginationCheckpointSnapshot,SavedPagination>();
const MAX_CHECKPOINT_EVENTS=10000,MAX_CHECKPOINT_UNITS=100000,MAX_CHECKPOINT_FRAGMENTS=50000;
const originKey=(o:Origin)=>JSON.stringify([o.documentId,o.blockKey]);
export type PaginationWorkStage='paginate-validate'|'paginate-key'|'paginate-place'|'paginate-match'|'paginate-reuse'|'paginate-snapshot';
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
  const state:IncrementalState={previous:previous?snapshots.get(previous):undefined,reusedBlocks:0,reusedSuffixBlocks:0,placedBlocks:0,sharedSnapshotFragments:0};
  const plan=finishSynchronously(runPagination(input,state));
  return finishIncremental(plan,state);
}
/** Cooperative variant of the same placement algorithm. The caller owns input
 * and must keep it unchanged until completion. A rejected checkpoint aborts
 * without publishing a new snapshot or changing the previous snapshot. */
export async function paginateMeasuredIncrementalCooperative(input:PaginationInput,previous:PaginationCheckpointSnapshot|undefined,checkpoint:PaginationWorkCheckpoint):Promise<IncrementalPaginationResult>{
  const state:IncrementalState={previous:previous?snapshots.get(previous):undefined,reusedBlocks:0,reusedSuffixBlocks:0,placedBlocks:0,sharedSnapshotFragments:0};
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
  return {plan,snapshot,reusedBlocks:state.reusedBlocks,reusedSuffixBlocks:state.reusedSuffixBlocks,placedBlocks:state.placedBlocks,sharedSnapshotFragments:state.sharedSnapshotFragments};
}
// Bounded O(n log n) partition search. Each suffix starts on an empty
// page; a segment tree finds the fewest remaining pages among reachable
// legal boundaries. Ties use the longest earlier fragment. No unit is
// split or reordered. If no feasible partition exists, use legacy flow.
function* searchSplit(block:MeasuredBlock,height:number,used:number,overhead:number):
  Generator<PaginationWorkStage,{ends:number[];fresh:boolean}|undefined,void>{
  const units=block.unitHeights,n=units.length;
  const before=block.minUnitsBefore??1,after=block.minUnitsAfter??1;
  if(n>100000)return undefined;
  const sum=new Float64Array(n+1);
  for(let i=0;i<n;i++){if(i%256===0)yield 'paginate-place';sum[i+1]=sum[i]+units[i];}
  const pages=new Int32Array(n+1);pages.fill(-1);pages[n]=0;
  const next=new Int32Array(n);next.fill(-1);
  let size=1;while(size<n+1)size*=2;
  const tree=new Int32Array(size*2);tree.fill(-1);
  const better=(a:number,b:number)=>a<0?b:b<0?a:pages[a]<pages[b]?a:pages[b]<pages[a]?b:Math.max(a,b);
  const put=(i:number)=>{let p=size+i;tree[p]=i;while(p>1){p>>=1;tree[p]=better(tree[p*2],tree[p*2+1]);}};
  const query=(lo:number,hi:number)=>{let a=-1;for(lo+=size,hi+=size;lo<=hi;lo>>=1,hi>>=1){
    if(lo%2===1)a=better(a,tree[lo++]);if(hi%2===0)a=better(a,tree[hi--]);
  }return a;};
  const choose=(start:number,capacity:number,first:boolean)=>{
    let lo=start,hi=n;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(sum[mid]-sum[start]<=capacity-overhead)lo=mid;else hi=mid-1;}
    if(lo===n&&n-start>=(first?1:after))return n;
    const minimum=first?before:Math.max(before,after),end=Math.min(lo,n-1);
    return start+minimum<=end?query(start+minimum,end):-1;
  };
  put(n);
  for(let i=n-1;i>0;i--){
    if(i%128===0)yield 'paginate-place';
    const end=choose(i,height,false);
    if(end>=0){next[i]=end;pages[i]=1+pages[end];put(i);}
  }
  const here=choose(0,height-used,true),fresh=used>0?choose(0,height,true):here;
  // A partial page is already counted. Moving to a fresh page costs one
  // additional page; prefer filling the existing page on ties.
  const move=used>0&&fresh>=0&&(here<0||pages[here]>1+pages[fresh]);
  let end=move?fresh:here;
  if(end<0)return undefined;
  const ends:number[]=[];
  while(end<n){if(ends.length%128===0)yield 'paginate-place';ends.push(end);end=next[end];}
  ends.push(n);
  return {ends,fresh:move};
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
      if(block.optimizeSplit!==undefined&&typeof block.optimizeSplit!=='boolean')return fail('PG_INVALID','Invalid split optimization option',o);
      if([block.minUnitsBefore,block.minUnitsAfter].some(n=>n!==undefined&&(!positive(n)||n>1000000)))
        return fail('PG_INVALID','Invalid split minimum',o);
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
  const savedByLive=new WeakMap<Fragment,SavedFragment>();
  const copyFragment=(f:SavedFragment):Fragment=>{
    const live:Fragment={origin:currentOrigins.get(f.originKey)!,rect:{...f.rect},unitStart:f.unitStart,unitEnd:f.unitEnd,continuationIndex:f.continuationIndex,breakReason:f.breakReason};
    savedByLive.set(live,f);
    return live;
  };
  const copyDiagnostic=(d:SavedDiagnostic):PaginationDiagnostic=>{
    const {originKey:key,...value}=d;
    return {...value,origin:key===undefined?undefined:currentOrigins.get(key)};
  };
  function* copyFragments(source:readonly SavedFragment[],target:Fragment[],start=0,end=source.length):Generator<PaginationWorkStage,void,void>{
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
          block.startPosition??'flow',block.startPositionSource??null,block.minUnitsBefore??1,block.minUnitsAfter??1,block.optimizeSplit===true
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
      const minBefore=block.minUnitsBefore??1,minAfter=block.minUnitsAfter??1;
      const partition=block.optimizeSplit===true&&(minBefore>1||minAfter>1)&&total>height-used&&block.splitPolicy!=='strict'
        ?yield* searchSplit(block,height,used,overhead):undefined;
      if(partition?.fresh)newPage('overflow');
      let cursor=0, continuationIndex=0, minimumWarned=false;
      while(cursor<block.unitHeights.length){
        if(block.unitHeights[cursor]+overhead>height-used)newPage(cursor?'continuation':'overflow');
        let end=cursor,h=overhead;
        const limit=partition?.ends[continuationIndex]??block.unitHeights.length;
        while(end<limit&&block.unitHeights[end]<=height-used-h){
          if(placedUnits++%256===0)yield 'paginate-place';
          h+=block.unitHeights[end];end++;
        }
        if(end===cursor)return fail('PG_TOO_LARGE','No safe progress',block.origin);
        // Only actual splits are constrained. Preserve the greedy maximal
        // fragment as a fallback on an empty page if minima are infeasible.
        // Moving from a partially filled page can happen at most once per
        // cursor; it cannot introduce an empty physical page.
        const required=end<block.unitHeights.length?Math.max(minBefore,cursor>0?minAfter:1):cursor>0?minAfter:1;
        const remaining=block.unitHeights.length-end;
        if(remaining>0&&remaining<minAfter){
          const adjusted=block.unitHeights.length-minAfter;
          if(adjusted-cursor>=required){
            while(end>adjusted){
              if(placedUnits++%256===0)yield 'paginate-place';
              h-=block.unitHeights[--end];
            }
          }
        }
        if(end-cursor<required||(end<block.unitHeights.length&&block.unitHeights.length-end<minAfter)){
          if(used>0&&cursor===0){newPage('overflow');continue;}
          if(!minimumWarned){
            result.diagnostics.push({code:'PG_SPLIT_MINIMUM',severity:'warning',message:'Split minimum could not be satisfied without changing indivisible content',origin:block.origin});
            minimumWarned=true;
          }
        }
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
  if(retain&&incremental){
    let fragments=0,scanned=0;
    for(const page of result.pages){
      if(scanned++%128===0)yield 'paginate-snapshot';
      fragments+=page.fragments.length;
      if(fragments>MAX_CHECKPOINT_FRAGMENTS)return result;
    }
    checkpoints.push(capture());
    const pages:SavedPage[]=[],diagnostics:SavedDiagnostic[]=[];
    let shared=0;
    for(const page of result.pages){
      if(scanned++%128===0)yield 'paginate-snapshot';
      const values:SavedFragment[]=[];
      for(const f of page.fragments){
        if(scanned++%128===0)yield 'paginate-snapshot';
        const saved=savedByLive.get(f);
        if(saved){values.push(saved);shared++;continue;}
        values.push({originKey:originKey(f.origin),rect:{...f.rect},unitStart:f.unitStart,unitEnd:f.unitEnd,continuationIndex:f.continuationIndex,breakReason:f.breakReason});
      }
      pages.push({index:page.index,fragments:values});
    }
    for(const d of result.diagnostics){
      if(scanned++%128===0)yield 'paginate-snapshot';
      diagnostics.push({code:d.code,severity:d.severity,message:d.message,originKey:d.origin?originKey(d.origin):undefined});
    }
    // Publish only after every private value is prepared. No public Origin,
    // Rect or array is retained, and cancellation cannot advance a lease.
    incremental.next={width,height,keys:eventKeys,checkpoints,plan:{pages,diagnostics}};
    incremental.sharedSnapshotFragments=shared;
  }
  return result;
}
