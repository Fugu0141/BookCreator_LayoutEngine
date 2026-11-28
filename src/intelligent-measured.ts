import {paginateMeasured,paginateMeasuredIncremental,type PaginationCheckpointSnapshot,type MeasuredPagePlan,type PaginationInput,type PaginationDiagnostic,type Fragment,type Origin} from './pagination.js';
import {planIntelligentLayout,planIntelligentLayoutIncremental,type IntelligentLayoutInput,type IntelligentLayoutSnapshot,type IncrementalIntelligentLayoutResult,type IntelligentBlock,type IntelligentPlacement,type IntelligentReservedRegion,type IntelligentLayoutResult,type IntelligentOptimizationOptions} from './intelligent-layout.js';

/** Source identity, independent of revision and fragment range. */
export interface IntelligentMeasuredIntent {
  documentId:string;
  blockKey:string;
  placement:Readonly<Pick<IntelligentBlock,'mode'|'fixed'|'preferred'|'sideBySide'|'sizeConstraints'|'spaceBefore'|'spaceAfter'|'startNewPage'>>;
}
export interface IntelligentMeasuredOptions {
  gap?:number;
  intents?:readonly IntelligentMeasuredIntent[];
  reservedRegions?:readonly IntelligentReservedRegion[];
  optimization?:IntelligentOptimizationOptions;
}
export interface IntelligentMeasuredFragment {
  origin:Origin;
  unitStart:number;
  unitEnd:number;
  continuationIndex:number;
  /** Original pagination reason, not a claim about final IL page boundaries. */
  sourceBreakReason:Fragment['breakReason'];
  placement:IntelligentPlacement;
}
type Placed=Extract<IntelligentLayoutResult,{status:'placed'}>;
type Conflict=Extract<IntelligentLayoutResult,{status:'conflict'}>;
interface Common {
  revision:string;
  fingerprint:string;
  publicationReady:false;
  paginationDiagnostics:PaginationDiagnostic[];
}
export type IntelligentMeasuredResult =
  | (Common & {status:'placed';layout:Placed;fragments:IntelligentMeasuredFragment[]})
  | (Common & {status:'conflict';stage:'pagination'|'intent'|'layout';fragments:[];diagnostic:Conflict['diagnostic']|{code:'IL_MEASURED_PAGINATION'|'IL_MEASURED_INTENT';message:string;blockId?:string}});

const sourceKey=(o:Pick<Origin,'documentId'|'blockKey'>)=>JSON.stringify([o.documentId,o.blockKey]);
/** Single fragments use a stable source key. Continuations have unit-range IDs. */
export function intelligentMeasuredId(origin:Pick<Origin,'documentId'|'blockKey'>,units?:Readonly<{start:number;end:number}>):string {
  return JSON.stringify(units?[origin.documentId,origin.blockKey,units.start,units.end]:[origin.documentId,origin.blockKey]);
}
const copyOrigin=(o:Origin):Origin=>({...o,...(o.range?{range:{...o.range}}:{})});

/**
 * Experimental opt-in bridge. Existing measured pagination determines safe
 * boundaries and repeated padding; IL places immutable fragments. It never
 * invokes a measurement adapter, renders content or produces a PagePlan.
 */
export function planMeasuredIntelligentLayout(input:PaginationInput,options:IntelligentMeasuredOptions={}):IntelligentMeasuredResult {
  return placeMeasured(input,options,paginateMeasured(input),planIntelligentLayout);
}

/** Both layers retain private, successful checkpoints; callers own the handle. */
export interface IntelligentMeasuredSnapshot {readonly kind:'intelligent-measured-snapshot'}
export interface IncrementalIntelligentMeasuredResult {
  result:IntelligentMeasuredResult;
  snapshot?:IntelligentMeasuredSnapshot;
  pagination:{reusedBlocks:number;reusedSuffixBlocks:number;placedBlocks:number};
  placement?:Pick<IncrementalIntelligentLayoutResult,'reusedBlocks'|'reusedSuffixBlocks'|'placedBlocks'|'fullRecompute'>;
}
const measuredSnapshots=new WeakMap<IntelligentMeasuredSnapshot,{pagination?:PaginationCheckpointSnapshot;layout?:IntelligentLayoutSnapshot}>();
export function planMeasuredIntelligentLayoutIncremental(input:PaginationInput,options:IntelligentMeasuredOptions={},
  previous?:IntelligentMeasuredSnapshot):IncrementalIntelligentMeasuredResult {
  const saved=previous?measuredSnapshots.get(previous):undefined;
  const p=paginateMeasuredIncremental(input,saved?.pagination);
  let nextLayout:IntelligentLayoutSnapshot|undefined;
  let placement:IncrementalIntelligentMeasuredResult['placement'];
  const result=placeMeasured(input,options,p.plan,(layoutInput,optimization)=>{
    const r=planIntelligentLayoutIncremental(layoutInput,saved?.layout,optimization);
    nextLayout=r.snapshot;
    placement={reusedBlocks:r.reusedBlocks,reusedSuffixBlocks:r.reusedSuffixBlocks,placedBlocks:r.placedBlocks,fullRecompute:r.fullRecompute};
    return r.layout;
  });
  let snapshot:IntelligentMeasuredSnapshot|undefined;
  if(result.status==='placed'&&(p.snapshot||nextLayout)){
    snapshot=Object.freeze({kind:'intelligent-measured-snapshot' as const});
    measuredSnapshots.set(snapshot,{pagination:p.snapshot,layout:nextLayout});
  }
  return {result,snapshot,pagination:{reusedBlocks:p.reusedBlocks,reusedSuffixBlocks:p.reusedSuffixBlocks,placedBlocks:p.placedBlocks},placement};
}

function placeMeasured(input:PaginationInput,options:IntelligentMeasuredOptions,plan:MeasuredPagePlan,
  planner:(input:IntelligentLayoutInput,options?:IntelligentOptimizationOptions)=>IntelligentLayoutResult):IntelligentMeasuredResult {
  const common:Common={revision:input.revision,fingerprint:input.fingerprint,publicationReady:false,
    paginationDiagnostics:plan.diagnostics.map(d=>({...d,...(d.origin?{origin:copyOrigin(d.origin)}:{})}))};
  const fail=(stage:'pagination'|'intent'|'layout',diagnostic:Extract<IntelligentMeasuredResult,{status:'conflict'}>['diagnostic']):IntelligentMeasuredResult=>
    ({...common,status:'conflict',stage,diagnostic,fragments:[]});
  if(plan.completeness!=='full'||plan.diagnostics.some(d=>d.severity==='error'))
    return fail('pagination',{code:'IL_MEASURED_PAGINATION',message:'Measured pagination failed; partial fragments discarded'});
  if(!options||typeof options!=='object'||Array.isArray(options))
    return fail('intent',{code:'IL_MEASURED_INTENT',message:'Invalid bridge options'});
  const list=options.intents===undefined?[]:options.intents;
  if(!Array.isArray(list)||list.length>10000)
    return fail('intent',{code:'IL_MEASURED_INTENT',message:'Invalid intent list'});
  const counts=new Map<string,number>();
  const fragments=plan.pages.flatMap(p=>p.fragments);
  if(fragments.length>10000)
    return fail('layout',{code:'IL_LIMIT',message:'Measured fragment limit exceeded'});
  for(const f of fragments){const key=sourceKey(f.origin);counts.set(key,(counts.get(key)??0)+1);}
  const intents=new Map<string,IntelligentMeasuredIntent['placement']>();
  for(const i of list){
    if(!i||typeof i.documentId!=='string'||!i.documentId||typeof i.blockKey!=='string'||!i.blockKey||
      !i.placement||typeof i.placement!=='object'||Array.isArray(i.placement)||
      (i.placement.startNewPage!==undefined&&typeof i.placement.startNewPage!=='boolean'))
      return fail('intent',{code:'IL_MEASURED_INTENT',message:'Invalid source placement intent'});
    const key=sourceKey(i);
    if(intents.has(key)||counts.get(key)!==1)
      return fail('intent',{code:'IL_MEASURED_INTENT',blockId:key,message:'Intent must resolve to exactly one unsplit measured block'});
    intents.set(key,i.placement);
  }
  const blocks:IntelligentBlock[]=fragments.map(f=>{
    const key=sourceKey(f.origin),i=intents.get(key);
    const id=intelligentMeasuredId(f.origin,counts.get(key)!>1?{start:f.unitStart,end:f.unitEnd}:undefined);
    // Redundant breaks are suppressed by IL, as in measured pagination.
    const hardBreak=f.breakReason==='explicit'||f.breakReason==='section'||f.breakReason==='page-top'||f.breakReason==='continuation';
    return {id,size:{width:f.rect.width,height:f.rect.height},
      mode:i?.mode,fixed:i?.fixed,preferred:i?.preferred,sideBySide:i?.sideBySide,sizeConstraints:i?.sizeConstraints,
      spaceBefore:i?.spaceBefore,spaceAfter:i?.spaceAfter,
      startNewPage:hardBreak||i?.startNewPage===true};
  });
  const layout=planner({revision:input.revision,content:input.content,gap:options.gap===undefined?0:options.gap,
    blocks,reservedRegions:options.reservedRegions},options.optimization);
  if(layout.status==='conflict') return fail('layout',layout.diagnostic);
  return {...common,status:'placed',layout,fragments:fragments.map((f,index)=>({
    origin:copyOrigin(f.origin),unitStart:f.unitStart,unitEnd:f.unitEnd,continuationIndex:f.continuationIndex,
    sourceBreakReason:f.breakReason,placement:layout.placements[index]
  }))};
}
