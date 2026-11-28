import {planMeasuredIntelligentLayout,planMeasuredIntelligentLayoutIncrementalCooperative,type IntelligentMeasuredSnapshot,type IntelligentMeasuredWorkStage,compareIntelligentPlacementImpact,type IntelligentMeasuredOptions,type IntelligentMeasuredResult,type IntelligentPlacementImpact} from './intelligent-measured.js';
import {inspectIntelligentLayoutQuality,type IntelligentQualityReport,type IntelligentPageQuality} from './intelligent-quality.js';
import type {PaginationInput} from './pagination.js';

export type IntelligentOptimizationGoal='compact'|'balance';
/** Inclusive zero-based page range from the current approved full plan. */
export interface IntelligentOptimizationScope {
  firstPage:number;
  lastPage:number;
  /** Maximum fragments changing page or body-relative position. */
  maxMovedFragments?:number;
}
export type IntelligentOptimizationProposal=
  | {status:'proposed';goal:IntelligentOptimizationGoal;options:IntelligentMeasuredOptions;
     result:Extract<IntelligentMeasuredResult,{status:'placed'}>;before:IntelligentQualityReport;after:IntelligentQualityReport;
     impact:IntelligentPlacementImpact;scope?:Readonly<IntelligentOptimizationScope>;improvement:{pagesSaved:number;additionalHonoredPreferences:number;depthImbalanceReduction:number}}
  | {status:'rejected';reason:'stale'|'invalid-goal'|'invalid-scope'|'outside-scope'|'movement-budget'|'conflict'|'unsafe-change'|'no-improvement'};

/**
 * Advisory, bounded one-candidate proposal from the exact current measured
 * input. No source, intent, DOM, or saved state is mutated. Host must still
 * validate its current request generation, confirm with the user, and
 * independently render and verify before saving or printing.
 */
export function proposeIntelligentOptimization(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  goal:IntelligentOptimizationGoal,scope?:Readonly<IntelligentOptimizationScope>,
):IntelligentOptimizationProposal{
  const work=optimizationProposalWork(input,approved,options,goal,scope);
  try{
    let step=work.next();
    while(!step.done)step=work.next(planMeasuredIntelligentLayout(input,step.value));
    return step.value;
  }finally{work.return(undefined as never);}
}
function* optimizationProposalWork(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  goal:IntelligentOptimizationGoal,scope?:Readonly<IntelligentOptimizationScope>,
):Generator<IntelligentMeasuredOptions,IntelligentOptimizationProposal,IntelligentMeasuredResult>{
  if(goal!=='compact'&&goal!=='balance')return {status:'rejected',reason:'invalid-goal'};
  const before=inspectIntelligentLayoutQuality(approved,input);
  if(!before||approved.status!=='placed')return {status:'rejected',reason:'stale'};
  if(scope!==undefined&&(!scope||typeof scope!=='object'||Array.isArray(scope)||
    Object.keys(scope).some(k=>!['firstPage','lastPage','maxMovedFragments'].includes(k))||
    !Number.isSafeInteger(scope.firstPage)||!Number.isSafeInteger(scope.lastPage)||
    scope.firstPage<0||scope.firstPage>scope.lastPage||scope.lastPage>=before.pageCount||
    (scope.maxMovedFragments!==undefined&&(!Number.isSafeInteger(scope.maxMovedFragments)||
      scope.maxMovedFragments<0||scope.maxMovedFragments>10000))))
    return {status:'rejected',reason:'invalid-scope'};
  // Compare the whole result, not revision alone: intent changes can use the
  // same source revision. Expect an engine-produced plan or its JSON copy.
  const current=yield options;
  if(current.status!=='placed'||JSON.stringify(current)!==JSON.stringify(approved))
    return {status:'rejected',reason:'stale'};
  const next=structuredClone(options);
  next.optimization={...next.optimization,
    ...(goal==='compact'?{selectivePreferenceFallback:true}:{balancePageDepths:true,...(scope?{balancePageRange:{firstPage:scope.firstPage,lastPage:scope.lastPage}}:{})})};
  const result=yield next;
  if(result.status!=='placed')return {status:'rejected',reason:'conflict'};
  const after=inspectIntelligentLayoutQuality(result,input);
  const impact=compareIntelligentPlacementImpact(approved,result,input);
  if(!after||!impact)return {status:'rejected',reason:'unsafe-change'};
  // Even an equally good aggregate score must not sacrifice an individually
  // honored preference or change a fixed position or occupied dimension.
  if(impact.changed.some(c=>c.contentSizeChanged||c.footprintSizeChanged||c.fixedChanged||
    (c.before.fixed&&(c.pageChanged||c.positionChanged))||
    (c.before.preference==='honored'&&c.after.preference!=='honored'))||
    after.pageCount>before.pageCount||after.blankPages.length>before.blankPages.length||
    after.paginationWarningCount>before.paginationWarningCount)
    return {status:'rejected',reason:'unsafe-change'};
  // Scope is an acceptance guard, not a new hard intent or a local solver.
  // Protect both the source and destination page of every changed fragment,
  // including preference-only changes, and any removed trailing blank page.
  if(scope){
    const inside=(p:number)=>p>=scope.firstPage&&p<=scope.lastPage;
    if(impact.changed.some(c=>!inside(c.before.page)||!inside(c.after.page))||
      (after.pageCount<before.pageCount&&scope.lastPage!==before.pageCount-1))
      return {status:'rejected',reason:'outside-scope'};
    if(scope.maxMovedFragments!==undefined&&impact.movedFragments>scope.maxMovedFragments)
      return {status:'rejected',reason:'movement-budget'};
  }
  const honored=(r:IntelligentQualityReport)=>r.pages.reduce((n,p)=>n+p.honoredPreferences,0);
  const imbalance=(r:IntelligentQualityReport)=>{
    const excluded=new Set((options.reservedRegions??[]).map(x=>x.page));
    const simple=(p:IntelligentQualityReport['pages'][number])=>p.fragmentCount>0&&!p.fixedFragments&&
      !p.honoredPreferences&&!p.fallbackPreferences&&!excluded.has(p.page);
    let value=0;
    for(let i=1;i<r.pages.length;i++){
      const a=r.pages[i-1],b=r.pages[i];
      if((!scope||goal!=='balance'||(a.page>=scope.firstPage&&b.page<=scope.lastPage))&&simple(a)&&simple(b)&&!b.explicitBoundary)value+=Math.abs(a.occupiedDepth-b.occupiedDepth);
    }
    return value;
  };
  const improvement={pagesSaved:before.pageCount-after.pageCount,
    additionalHonoredPreferences:honored(after)-honored(before),
    depthImbalanceReduction:imbalance(before)-imbalance(after)};
  // Comparing only the declared goal avoids calling arbitrary movement an
  // improvement. Preserve an existing explicit semantic score if available.
  if((after.optimizationScore?.keptWithNext??0)<(before.optimizationScore?.keptWithNext??0))
    return {status:'rejected',reason:'unsafe-change'};
  if(!impact.changed.length||!(improvement.pagesSaved>0||improvement.additionalHonoredPreferences>0||
      (goal==='balance'&&improvement.depthImbalanceReduction>0)))
    return {status:'rejected',reason:'no-improvement'};
  return {status:'proposed',goal,options:next,result,before,after,impact,improvement,...(scope?{scope:{...scope}}:{})};
}

export type IntelligentOptimizationWorkStage=IntelligentMeasuredWorkStage|'optimization-start'|'optimization-evaluate'|'optimization-complete';
export type IntelligentOptimizationCheckpoint=(stage:IntelligentOptimizationWorkStage)=>void|Promise<void>;
/** Cooperative equivalent of the synchronous proposal. Capture caller-owned
 * inputs before the first yield. Throwing from a checkpoint aborts the work.
 * The host must yield to tasks, not just microtasks, for UI responsiveness. */
async function cooperativeProposal(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  goal:IntelligentOptimizationGoal,scope:Readonly<IntelligentOptimizationScope>|undefined,
  checkpoint:IntelligentOptimizationCheckpoint,previous?:IntelligentMeasuredSnapshot,
):Promise<IntelligentOptimizationProposal>{
  const work=optimizationProposalWork(input,approved,options,goal,scope);
  try{
    await checkpoint('optimization-start');
    let step=work.next();
    let snapshot=previous;
    while(!step.done){
      const planned=await planMeasuredIntelligentLayoutIncrementalCooperative(input,step.value,snapshot,checkpoint);
      snapshot=planned.snapshot;
      await checkpoint('optimization-evaluate');
      step=work.next(planned.result);
    }
    await checkpoint('optimization-complete');
    return step.value;
  }finally{work.return(undefined as never);}
}

/** Opaque in-process review handle. Not a persisted lease or print ticket. */
export interface IntelligentOptimizationReviewHandle {readonly kind:'intelligent-optimization-review'}
type Proposed=Extract<IntelligentOptimizationProposal,{status:'proposed'}>;
export type IntelligentOptimizationReview=
  | {status:'review';handle:IntelligentOptimizationReviewHandle;proposal:Proposed}
  | Extract<IntelligentOptimizationProposal,{status:'rejected'}>;
export type IntelligentOptimizationConfirmation=
  | {status:'confirmed';options:IntelligentMeasuredOptions;result:Proposed['result']}
  | {status:'rejected';reason:'invalid-handle'|'stale'|'preview-mismatch'};
interface ReviewState {
  lease:string;
  input:string;
  approved:string;
  options:string;
  candidate:Proposed;
}
const reviews=new WeakMap<IntelligentOptimizationReviewHandle,ReviewState>();
/** Capture the exact review context. The host owns the unique current
 * request lease and must independently verify its currentness at save. */
export function prepareIntelligentOptimizationReview(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  goal:IntelligentOptimizationGoal,lease:string,scope?:Readonly<IntelligentOptimizationScope>,
):IntelligentOptimizationReview{
  if(typeof lease!=='string'||!lease||lease.length>1024)return {status:'rejected',reason:'stale'};
  return captureReview(input,approved,options,lease,proposeIntelligentOptimization(input,approved,options,goal,scope));
}
export async function prepareIntelligentOptimizationReviewCooperative(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  goal:IntelligentOptimizationGoal,lease:string,scope:Readonly<IntelligentOptimizationScope>|undefined,
  checkpoint:IntelligentOptimizationCheckpoint,previous?:IntelligentMeasuredSnapshot,
):Promise<IntelligentOptimizationReview>{
  if(typeof lease!=='string'||!lease||lease.length>1024)return {status:'rejected',reason:'stale'};
  const captured=structuredClone({input,approved,options,scope});
  const proposal=await cooperativeProposal(captured.input,captured.approved,captured.options,goal,captured.scope,checkpoint,previous);
  return captureReview(captured.input,captured.approved,captured.options,lease,proposal);
}
function captureReview(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  lease:string,proposal:IntelligentOptimizationProposal,
):IntelligentOptimizationReview{
  if(proposal.status==='rejected')return proposal;
  const handle=Object.freeze({kind:'intelligent-optimization-review' as const});
  reviews.set(handle,{lease,input:JSON.stringify(input),approved:JSON.stringify(approved),
    options:JSON.stringify(options),candidate:structuredClone(proposal)});
  return {status:'review',handle,proposal};
}
/** Discard the private review; later confirmation always fails. */
export function cancelIntelligentOptimizationReview(handle:IntelligentOptimizationReviewHandle):boolean{
  return reviews.delete(handle);
}
/**
 * Single-use confirmation of an independently rendered candidate. Require
 * the original measured input, approved plan, options and current host lease,
 * plus the actual complete preview result/settings. A failed attempt consumes
 * the review as well. No save, history entry, DOM publication or printing.
 */
export function confirmIntelligentOptimizationReview(
  handle:IntelligentOptimizationReviewHandle,
  current:Readonly<{input:PaginationInput;approved:IntelligentMeasuredResult;options:IntelligentMeasuredOptions;lease:string}>,
  preview:Readonly<{result:IntelligentMeasuredResult;options:IntelligentMeasuredOptions}>,
):IntelligentOptimizationConfirmation{
  const state=reviews.get(handle);
  if(!state)return {status:'rejected',reason:'invalid-handle'};
  reviews.delete(handle);
  if(current.lease!==state.lease||JSON.stringify(current.input)!==state.input||
    JSON.stringify(current.approved)!==state.approved||JSON.stringify(current.options)!==state.options)
    return {status:'rejected',reason:'stale'};
  const c=state.candidate;
  if(preview.result.status!=='placed'||JSON.stringify(preview.result)!==JSON.stringify(c.result)||
    JSON.stringify(preview.options)!==JSON.stringify(c.options))
    return {status:'rejected',reason:'preview-mismatch'};
  return {status:'confirmed',options:structuredClone(c.options),result:structuredClone(c.result)};
}

export type IntelligentOptimizationBenefit =
  | {kind:'pages-saved';count:number}
  | {kind:'preferences-restored';count:number}
  | {kind:'depth-imbalance-reduced';micrometres:number};
export interface IntelligentOptimizationExplanation {
  goal:IntelligentOptimizationGoal;
  selectedCandidate:NonNullable<Proposed['result']['layout']['optimization']>['selected']|undefined;
  benefits:IntelligentOptimizationBenefit[];
  changes:{documentId:string;blockKey:string;placementId:string;unitStart:number;unitEnd:number;
    beforePage:number;afterPage:number;deltaX:number;deltaY:number;preferenceRestored:boolean}[];
  /** These are observed differences, not causal claims for individual moves. */
  causalAttribution:false;
}
/**
 * Explain the actual candidate and observed differences for GUI review.
 * The optimizer scores complete layouts; a moved block need not individually
 * cause a benefit. Do not infer intent, or claim a particular constraint
 * forced a move. The review handle and host lease remain authoritative.
 */
export function describeIntelligentOptimizationProposal(proposal:IntelligentOptimizationProposal):IntelligentOptimizationExplanation|undefined{
  if(proposal.status!=='proposed')return undefined;
  const {improvement,impact,result,goal}=proposal;
  const benefits:IntelligentOptimizationBenefit[]=[];
  if(improvement.pagesSaved>0)benefits.push({kind:'pages-saved',count:improvement.pagesSaved});
  if(improvement.additionalHonoredPreferences>0)benefits.push({kind:'preferences-restored',count:improvement.additionalHonoredPreferences});
  if(improvement.depthImbalanceReduction>0)benefits.push({kind:'depth-imbalance-reduced',micrometres:improvement.depthImbalanceReduction});
  return {goal,selectedCandidate:result.layout.optimization?.selected,benefits,causalAttribution:false,
    changes:impact.changed.map(c=>({documentId:c.origin.documentId,blockKey:c.origin.blockKey,
      placementId:c.before.id,unitStart:c.unitStart,unitEnd:c.unitEnd,beforePage:c.before.page,afterPage:c.after.page,
      deltaX:c.after.rect.x-c.before.rect.x,deltaY:c.after.rect.y-c.before.rect.y,
      preferenceRestored:c.before.preference==='fallback'&&c.after.preference==='honored'}))};
}

export interface IntelligentOptimizationPageComparison {
  /** Zero-based physical page index. Missing side means page does not exist. */
  page:number;
  before?:IntelligentPageQuality;
  after?:IntelligentPageQuality;
  /** Placement IDs, including changes that do not alter aggregate quality. */
  changedBefore:string[];
  changedAfter:string[];
}
export interface IntelligentOptimizationReviewComparison {
  explanation:IntelligentOptimizationExplanation;
  scope?:Readonly<IntelligentOptimizationScope>;
  beforePageCount:number;
  afterPageCount:number;
  movedFragments:number;
  pageChangedFragments:number;
  /** Only affected pages, sorted by physical index. */
  pages:IntelligentOptimizationPageComparison[];
  /** Absolute body-relative rectangles, source identity and change flags. */
  changes:IntelligentPlacementImpact['changed'];
}
/** Read the privately captured review without consuming it, recomputing the
 * layout, or trusting a public mutable proposal. The caller owns lease
 * currentness. The result is advisory, not a rendered-preview confirmation. */
export function inspectIntelligentOptimizationReview(
  handle:IntelligentOptimizationReviewHandle,lease:string,
):IntelligentOptimizationReviewComparison|undefined{
  const state=reviews.get(handle);
  if(!state||state.lease!==lease)return undefined;
  const c=state.candidate;
  const outgoing=new Map<number,string[]>(),incoming=new Map<number,string[]>();
  const add=(map:Map<number,string[]>,page:number,id:string)=>{
    const ids=map.get(page);
    if(ids)ids.push(id);else map.set(page,[id]);
  };
  for(const change of c.impact.changed){
    add(outgoing,change.before.page,change.before.id);
    add(incoming,change.after.page,change.after.id);
  }
  const pages:IntelligentOptimizationPageComparison[]=[];
  for(let page=0;page<Math.max(c.before.pageCount,c.after.pageCount);page++){
    const before=c.before.pages[page],after=c.after.pages[page];
    const changedBefore=outgoing.get(page)??[],changedAfter=incoming.get(page)??[];
    if(!changedBefore.length&&!changedAfter.length&&JSON.stringify(before)===JSON.stringify(after))continue;
    pages.push({page,...(before?{before}:{}),...(after?{after}:{}),changedBefore,changedAfter});
  }
  return structuredClone({explanation:describeIntelligentOptimizationProposal(c)!,
    ...(c.scope?{scope:c.scope}:{}),beforePageCount:c.before.pageCount,afterPageCount:c.after.pageCount,
    movedFragments:c.impact.movedFragments,pageChangedFragments:c.impact.pageChangedFragments,pages,changes:c.impact.changed});
}
