import {paginateMeasured,paginateMeasuredIncremental,paginateMeasuredIncrementalCooperative,type PaginationWorkStage,type PaginationCheckpointSnapshot,type MeasuredPagePlan,type PaginationInput,type PaginationDiagnostic,type Fragment,type Origin} from './pagination.js';
import {planIntelligentLayout,planIntelligentLayoutIncremental,planIntelligentLayoutIncrementalCooperative,type IntelligentWorkStage,type IntelligentLayoutInput,type IntelligentLayoutSnapshot,type IncrementalIntelligentLayoutResult,type IntelligentBlock,type IntelligentPlacement,type IntelligentReservedRegion,type IntelligentLayoutResult,type IntelligentOptimizationOptions} from './intelligent-layout.js';

/** Source identity, independent of revision and fragment range. */
export interface IntelligentMeasuredIntent {
  documentId:string;
  blockKey:string;
  placement:Readonly<Pick<IntelligentBlock,'mode'|'fixed'|'fixedPositionOnly'|'preferred'|'sideBySide'|'sizeConstraints'|'spaceBefore'|'spaceAfter'|'startNewPage'>>;
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

// Placement intent is a serialized host contract. Unknown field names are
// rejected rather than silently treating a misspelled constraint as automatic.
const optionKeys=['gap','intents','reservedRegions','optimization'];
const intentKeys=['documentId','blockKey','placement'];
const placementKeys=['mode','fixed','fixedPositionOnly','preferred','sideBySide','sizeConstraints','spaceBefore','spaceAfter','startNewPage'];
const positionKeys=['page','x','y'];
const constraintKeys=['minWidth','minHeight','maxWidth','maxHeight','minWidthPercent','minHeightPercent'];
function hasOnlyKeys(value:unknown,keys:readonly string[]):boolean{
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
}
function validIntentShape(i:IntelligentMeasuredIntent):boolean{
  if(!hasOnlyKeys(i,intentKeys)||!hasOnlyKeys(i.placement,placementKeys))return false;
  const p=i.placement;
  return (p.fixed===undefined||hasOnlyKeys(p.fixed,positionKeys))&&
    (p.preferred===undefined||hasOnlyKeys(p.preferred,positionKeys))&&
    (p.sizeConstraints===undefined||hasOnlyKeys(p.sizeConstraints,constraintKeys));
}

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
  pagination:{reusedBlocks:number;reusedSuffixBlocks:number;placedBlocks:number;sharedSnapshotFragments:number};
  placement?:Pick<IncrementalIntelligentLayoutResult,'reusedBlocks'|'reusedSuffixBlocks'|'placedBlocks'|'sharedSnapshotPlacements'|'fullRecompute'>;
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
    placement={reusedBlocks:r.reusedBlocks,reusedSuffixBlocks:r.reusedSuffixBlocks,placedBlocks:r.placedBlocks,sharedSnapshotPlacements:r.sharedSnapshotPlacements,fullRecompute:r.fullRecompute};
    return r.layout;
  });
  return finishMeasured(result,p,nextLayout,placement);
}

export type IntelligentMeasuredWorkStage=PaginationWorkStage|IntelligentWorkStage|'il-bridge';
export type IntelligentMeasuredWorkCheckpoint=(stage:IntelligentMeasuredWorkStage)=>void|Promise<void>;
/** Shared measured pagination and IL placement with cancellable checkpoints. */
export async function planMeasuredIntelligentLayoutIncrementalCooperative(input:PaginationInput,options:IntelligentMeasuredOptions,
  previous:IntelligentMeasuredSnapshot|undefined,checkpoint:IntelligentMeasuredWorkCheckpoint):Promise<IncrementalIntelligentMeasuredResult>{
  const saved=previous?measuredSnapshots.get(previous):undefined;
  const p=await paginateMeasuredIncrementalCooperative(input,saved?.pagination,checkpoint);
  let nextLayout:IntelligentLayoutSnapshot|undefined;
  let placement:IncrementalIntelligentMeasuredResult['placement'];
  const work=placeMeasuredWork(input,options,p.plan);
  try{
    let step=work.next();
    while(!step.done){
      if(typeof step.value==='string'){
        const wait=checkpoint(step.value);if(wait)await wait;
        step=work.next();
      }else{
        const r=await planIntelligentLayoutIncrementalCooperative(step.value.input,saved?.layout,checkpoint,step.value.options);
        nextLayout=r.snapshot;
        placement={reusedBlocks:r.reusedBlocks,reusedSuffixBlocks:r.reusedSuffixBlocks,placedBlocks:r.placedBlocks,sharedSnapshotPlacements:r.sharedSnapshotPlacements,fullRecompute:r.fullRecompute};
        step=work.next(r.layout);
      }
    }
    const wait=checkpoint('il-bridge');if(wait)await wait;
    return finishMeasured(step.value,p,nextLayout,placement);
  }finally{work.return(undefined as never);}
}
function finishMeasured(result:IntelligentMeasuredResult,p:ReturnType<typeof paginateMeasuredIncremental>,nextLayout:IntelligentLayoutSnapshot|undefined,placement:IncrementalIntelligentMeasuredResult['placement']):IncrementalIntelligentMeasuredResult{
  let snapshot:IntelligentMeasuredSnapshot|undefined;
  if(result.status==='placed'&&(p.snapshot||nextLayout)){
    snapshot=Object.freeze({kind:'intelligent-measured-snapshot' as const});
    measuredSnapshots.set(snapshot,{pagination:p.snapshot,layout:nextLayout});
  }
  return {result,snapshot,pagination:{reusedBlocks:p.reusedBlocks,reusedSuffixBlocks:p.reusedSuffixBlocks,placedBlocks:p.placedBlocks,sharedSnapshotFragments:p.sharedSnapshotFragments},placement};
}

function placeMeasured(input:PaginationInput,options:IntelligentMeasuredOptions,plan:MeasuredPagePlan,
  planner:(input:IntelligentLayoutInput,options?:IntelligentOptimizationOptions)=>IntelligentLayoutResult):IntelligentMeasuredResult {
  const work=placeMeasuredWork(input,options,plan);
  let step=work.next();
  while(!step.done)step=work.next(typeof step.value==='string'?undefined:planner(step.value.input,step.value.options));
  return step.value;
}
type BridgeRequest={input:IntelligentLayoutInput;options?:IntelligentOptimizationOptions};
function* placeMeasuredWork(input:PaginationInput,options:IntelligentMeasuredOptions,plan:MeasuredPagePlan):
  Generator<'il-bridge'|BridgeRequest,IntelligentMeasuredResult,IntelligentLayoutResult|undefined>{
  yield 'il-bridge';
  const common:Common={revision:input.revision,fingerprint:input.fingerprint,publicationReady:false,
    paginationDiagnostics:plan.diagnostics.map(d=>({...d,...(d.origin?{origin:copyOrigin(d.origin)}:{})}))};
  const fail=(stage:'pagination'|'intent'|'layout',diagnostic:Extract<IntelligentMeasuredResult,{status:'conflict'}>['diagnostic']):IntelligentMeasuredResult=>
    ({...common,status:'conflict',stage,diagnostic,fragments:[]});
  if(plan.completeness!=='full'||plan.diagnostics.some(d=>d.severity==='error'))
    return fail('pagination',{code:'IL_MEASURED_PAGINATION',message:'Measured pagination failed; partial fragments discarded'});
  if(!hasOnlyKeys(options,optionKeys))
    return fail('intent',{code:'IL_MEASURED_INTENT',message:'Invalid bridge options'});
  const list=options.intents===undefined?[]:options.intents;
  if(!Array.isArray(list)||list.length>10000)
    return fail('intent',{code:'IL_MEASURED_INTENT',message:'Invalid intent list'});
  const counts=new Map<string,number>();
  const fragments:Fragment[]=[];
  for(const page of plan.pages)for(const f of page.fragments){
    if(fragments.length>=10000)return fail('layout',{code:'IL_LIMIT',message:'Measured fragment limit exceeded'});
    if(fragments.length%128===0)yield 'il-bridge';
    fragments.push(f);const key=sourceKey(f.origin);counts.set(key,(counts.get(key)??0)+1);
  }
  const intents=new Map<string,IntelligentMeasuredIntent['placement']>();
  let scanned=0;
  for(const i of list){
    if(scanned++%64===0)yield 'il-bridge';
    if(!i||typeof i.documentId!=='string'||!i.documentId||typeof i.blockKey!=='string'||!i.blockKey||
      !i.placement||typeof i.placement!=='object'||Array.isArray(i.placement)||
      (i.placement.startNewPage!==undefined&&typeof i.placement.startNewPage!=='boolean'))
      return fail('intent',{code:'IL_MEASURED_INTENT',message:'Invalid source placement intent'});
    const key=sourceKey(i);
    if(!validIntentShape(i))
      return fail('intent',{code:'IL_MEASURED_INTENT',blockId:key,message:'Unsupported source placement intent field'});
    if(intents.has(key)||counts.get(key)!==1)
      return fail('intent',{code:'IL_MEASURED_INTENT',blockId:key,message:'Intent must resolve to exactly one unsplit measured block'});
    intents.set(key,i.placement);
  }
  const blocks:IntelligentBlock[]=[];
  for(const f of fragments){
    if(blocks.length%128===0)yield 'il-bridge';
    const key=sourceKey(f.origin),i=intents.get(key);
    const id=intelligentMeasuredId(f.origin,counts.get(key)!>1?{start:f.unitStart,end:f.unitEnd}:undefined);
    // Redundant breaks are suppressed by IL, as in measured pagination.
    const hardBreak=f.breakReason==='explicit'||f.breakReason==='section'||f.breakReason==='page-top'||f.breakReason==='continuation';
    blocks.push({id,size:{width:f.rect.width,height:f.rect.height},
      mode:i?.mode,fixed:i?.fixed,fixedPositionOnly:i?.fixedPositionOnly,preferred:i?.preferred,sideBySide:i?.sideBySide,sizeConstraints:i?.sizeConstraints,
      spaceBefore:i?.spaceBefore,spaceAfter:i?.spaceAfter,
      startNewPage:hardBreak||i?.startNewPage===true});
  }
  const layout=(yield {input:{revision:input.revision,content:input.content,gap:options.gap===undefined?0:options.gap,
    blocks,reservedRegions:options.reservedRegions},options:options.optimization})!;
  if(layout.status==='conflict') return fail('layout',layout.diagnostic);
  const placed:IntelligentMeasuredFragment[]=[];
  for(const f of fragments){
    if(placed.length%128===0)yield 'il-bridge';
    placed.push({origin:copyOrigin(f.origin),unitStart:f.unitStart,unitEnd:f.unitEnd,continuationIndex:f.continuationIndex,
      sourceBreakReason:f.breakReason,placement:layout.placements[placed.length]});
  }
  return {...common,status:'placed',layout,fragments:placed};
}

/** Project a successful engine-produced IL result onto the existing measured
 * rendering contract. This is NOT publication authorization or a validator
 * for deserialized/untrusted results. Content rectangles, not occupied
 * footprints, are drawn; explicit intervening pages are retained. */
export function projectIntelligentMeasuredPlan(result:Extract<IntelligentMeasuredResult,{status:'placed'}>):MeasuredPagePlan{
  const pages:MeasuredPagePlan['pages']=[];
  let previousPage=-1;
  for(const f of result.fragments){
    const p=f.placement;
    if(!Number.isSafeInteger(p.page)||p.page<previousPage||p.page<0||p.page>=10000)throw RangeError('Invalid IL page order');
    while(pages.length<=p.page)pages.push({index:pages.length,fragments:[]});
    const source=f.sourceBreakReason;
    const breakReason=source==='flow'||source==='overflow'
      ?(previousPage!==p.page&&(previousPage>=0||p.page>0)?'overflow':'flow'):source;
    pages[p.page].fragments.push({origin:copyOrigin(f.origin),rect:{...p.rect},unitStart:f.unitStart,
      unitEnd:f.unitEnd,continuationIndex:f.continuationIndex,breakReason});
    previousPage=p.page;
  }
  return {schemaVersion:1,revision:result.revision,fingerprint:result.fingerprint,completeness:'full',
    measurement:'premeasured',publicationReady:false,pages,
    diagnostics:result.paginationDiagnostics.map(d=>({...d,...(d.origin?{origin:copyOrigin(d.origin)}:{})}))};
}
