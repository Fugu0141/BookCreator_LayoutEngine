import {planMeasuredIntelligentLayout,compareIntelligentPlacementImpact,type IntelligentMeasuredOptions,type IntelligentMeasuredResult,type IntelligentPlacementImpact} from './intelligent-measured.js';
import {inspectIntelligentLayoutQuality,type IntelligentQualityReport} from './intelligent-quality.js';
import type {PaginationInput} from './pagination.js';

export type IntelligentOptimizationGoal='compact'|'balance';
export type IntelligentOptimizationProposal=
  | {status:'proposed';goal:IntelligentOptimizationGoal;options:IntelligentMeasuredOptions;
     result:Extract<IntelligentMeasuredResult,{status:'placed'}>;before:IntelligentQualityReport;after:IntelligentQualityReport;
     impact:IntelligentPlacementImpact;improvement:{pagesSaved:number;additionalHonoredPreferences:number;depthImbalanceReduction:number}}
  | {status:'rejected';reason:'stale'|'invalid-goal'|'conflict'|'unsafe-change'|'no-improvement'};

/**
 * Advisory, bounded one-candidate proposal from the exact current measured
 * input. No source, intent, DOM, or saved state is mutated. Host must still
 * validate its current request generation, confirm with the user, and
 * independently render and verify before saving or printing.
 */
export function proposeIntelligentOptimization(
  input:PaginationInput,approved:IntelligentMeasuredResult,options:IntelligentMeasuredOptions,
  goal:IntelligentOptimizationGoal,
):IntelligentOptimizationProposal{
  if(goal!=='compact'&&goal!=='balance')return {status:'rejected',reason:'invalid-goal'};
  const before=inspectIntelligentLayoutQuality(approved,input);
  if(!before||approved.status!=='placed')return {status:'rejected',reason:'stale'};
  // Compare the whole result, not revision alone: intent changes can use the
  // same source revision. Expect an engine-produced plan or its JSON copy.
  const current=planMeasuredIntelligentLayout(input,options);
  if(current.status!=='placed'||JSON.stringify(current)!==JSON.stringify(approved))
    return {status:'rejected',reason:'stale'};
  const next=structuredClone(options);
  next.optimization={...next.optimization,
    ...(goal==='compact'?{selectivePreferenceFallback:true}:{balancePageDepths:true})};
  const result=planMeasuredIntelligentLayout(input,next);
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
  const honored=(r:IntelligentQualityReport)=>r.pages.reduce((n,p)=>n+p.honoredPreferences,0);
  const imbalance=(r:IntelligentQualityReport)=>{
    const excluded=new Set((options.reservedRegions??[]).map(x=>x.page));
    const simple=(p:IntelligentQualityReport['pages'][number])=>p.fragmentCount>0&&!p.fixedFragments&&
      !p.honoredPreferences&&!p.fallbackPreferences&&!excluded.has(p.page);
    let value=0;
    for(let i=1;i<r.pages.length;i++){
      const a=r.pages[i-1],b=r.pages[i];
      if(simple(a)&&simple(b)&&!b.explicitBoundary)value+=Math.abs(a.occupiedDepth-b.occupiedDepth);
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
  return {status:'proposed',goal,options:next,result,before,after,impact,improvement};
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
  goal:IntelligentOptimizationGoal,lease:string,
):IntelligentOptimizationReview{
  if(typeof lease!=='string'||!lease||lease.length>1024)return {status:'rejected',reason:'stale'};
  const proposal=proposeIntelligentOptimization(input,approved,options,goal);
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
