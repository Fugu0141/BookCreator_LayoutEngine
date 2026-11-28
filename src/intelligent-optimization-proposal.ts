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
