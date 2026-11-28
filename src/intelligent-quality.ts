import type {Rect,Size} from './index.js';
import type {IntelligentMeasuredResult} from './intelligent-measured.js';
import type {IntelligentCandidateScore} from './intelligent-layout.js';

export interface IntelligentPageQuality {
  page:number;
  fragmentCount:number;
  /** Sum of drawn rectangles as a percentage of the body area, not ink. */
  contentPercent:number;
  /** Sum of occupied rectangles; excludes gaps, external reservations and group envelope whitespace. */
  occupiedPercent:number;
  occupiedDepth:number;
  trailingSpace:number;
  fixedFragments:number;
  honoredPreferences:number;
  fallbackPreferences:number;
  explicitBoundary:boolean;
}
export interface IntelligentQualityFinding {
  kind:'preferred-fallback'|'single-unit-continuation';
  page:number;
  placementId:string;
  documentId:string;
  blockKey:string;
  unitStart:number;
  unitEnd:number;
}
export interface IntelligentQualityReport {
  revision:string;
  fingerprint:string;
  pageCount:number;
  fragmentCount:number;
  blankPages:number[];
  pages:IntelligentPageQuality[];
  findings:IntelligentQualityFinding[];
  paginationWarningCount:number;
  optimizationScore?:IntelligentCandidateScore;
}
/**
 * Display-only metrics for a current, engine-produced successful measured
 * plan. No mutation, new layout, intent relaxation, or save authorization.
 * Rectangular coverage is descriptive, not a visual quality judgement.
 * A single measured unit is not necessarily a text line. Blank pages,
 * reserved whitespace and manual placement are not inherently defects.
 * Caller owns the exact content size and request/approval generation.
 */
export function inspectIntelligentLayoutQuality(
  result:IntelligentMeasuredResult,
  expected:Readonly<{revision:string;fingerprint:string;content:Readonly<Size>}>,
):IntelligentQualityReport|undefined{
  const {width,height}=expected.content;
  const positive=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<=1000000000;
  if(result.status!=='placed'||result.revision!==expected.revision||result.fingerprint!==expected.fingerprint||
    !positive(width)||!positive(height)||!result.fragments.length||result.fragments.length>10000)return undefined;
  const area=width*height,counts=new Map<string,number>(),ids=new Set<string>();
  const pages:IntelligentPageQuality[]=[],findings:IntelligentQualityFinding[]=[];
  const key=(f:typeof result.fragments[number])=>JSON.stringify([f.origin.documentId,f.origin.blockKey]);
  for(const f of result.fragments)counts.set(key(f),(counts.get(key(f))??0)+1);
  const valid=(r:Rect)=>r&&[r.x,r.y].every(n=>Number.isSafeInteger(n)&&n>=0)&&
    positive(r.width)&&positive(r.height)&&r.x+r.width<=width&&r.y+r.height<=height;
  let previousPage=-1;
  for(const f of result.fragments){
    const p=f.placement,r=p.rect,o=p.occupiedRect??r;
    if(typeof p.id!=='string'||!p.id||ids.has(p.id)||!Number.isSafeInteger(p.page)||p.page<0||
      p.page<previousPage||p.page>=10000||!valid(r)||!valid(o)||o.x!==r.x||o.y!==r.y||
      o.width<r.width||o.height<r.height||!Number.isSafeInteger(f.unitStart)||f.unitStart<0||
      !Number.isSafeInteger(f.unitEnd)||f.unitEnd<=f.unitStart)return undefined;
    ids.add(p.id);previousPage=p.page;
    while(pages.length<=p.page)pages.push({page:pages.length,fragmentCount:0,contentPercent:0,occupiedPercent:0,
      occupiedDepth:0,trailingSpace:height,fixedFragments:0,honoredPreferences:0,fallbackPreferences:0,explicitBoundary:false});
    const page=pages[p.page];
    page.fragmentCount++;
    page.contentPercent+=100*r.width*r.height/area;
    page.occupiedPercent+=100*o.width*o.height/area;
    page.occupiedDepth=Math.max(page.occupiedDepth,o.y+o.height);
    page.trailingSpace=height-page.occupiedDepth;
    if(p.fixed)page.fixedFragments++;
    if(p.preference==='honored')page.honoredPreferences++;
    if(p.preference==='fallback')page.fallbackPreferences++;
    if(['explicit','section','page-top'].includes(f.sourceBreakReason))page.explicitBoundary=true;
    const finding=(kind:IntelligentQualityFinding['kind'])=>findings.push({kind,page:p.page,placementId:p.id,
      documentId:f.origin.documentId,blockKey:f.origin.blockKey,unitStart:f.unitStart,unitEnd:f.unitEnd});
    if(p.preference==='fallback')finding('preferred-fallback');
    if(counts.get(key(f))!>1&&f.unitEnd-f.unitStart===1)finding('single-unit-continuation');
  }
  for(const p of pages){
    // A valid engine plan has nonoverlapping footprints. This is only a
    // sanity check, not an independent overlap or deserialized-plan validator.
    if(p.occupiedPercent>100+1e-8)return undefined;
    p.contentPercent=Math.round(p.contentPercent*100)/100;
    p.occupiedPercent=Math.round(p.occupiedPercent*100)/100;
  }
  return {revision:result.revision,fingerprint:result.fingerprint,pageCount:pages.length,
    fragmentCount:result.fragments.length,blankPages:pages.filter(p=>p.fragmentCount===0).map(p=>p.page),pages,findings,
    paginationWarningCount:result.paginationDiagnostics.filter(d=>d.severity==='warning').length,
    ...(result.layout.optimization?{optimizationScore:{...result.layout.optimization.score}}:{})};
}
