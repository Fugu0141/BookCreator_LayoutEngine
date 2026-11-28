import type { Rect, Size } from './index.js';

// Pure, measured, indivisible-block placement. All dimensions are integer µm.
// The caller owns measurement and semantic order; this module never edits source.
export type IntelligentPlacementMode = 'auto' | 'preferred' | 'fixed';
export interface IntelligentPosition { page:number; x:number; y:number }

/** Hard constraints on the occupied footprint, never instructions to scale content. */
export interface IntelligentSizeConstraints {
  minWidth?:number;
  minHeight?:number;
  maxWidth?:number;
  maxHeight?:number;
  // Integer 1–100, relative to the full content area.
  minWidthPercent?:number;
  minHeightPercent?:number;
}
export interface IntelligentBlock {
  id: string;
  size: Readonly<Size>;
  sizeConstraints?: Readonly<IntelligentSizeConstraints>;
  // Only consecutive opt-in blocks may share a row.
  sideBySide?: boolean;
  // An exact user constraint; never silently moved or resized.
  fixed?: Readonly<IntelligentPosition>;
  // Explicitly lock position only, allowing user-specified footprint minima.
  // Without this opt-in, the legacy fixed-size rule remains in force.
  fixedPositionOnly?: boolean;
  /** Explicitly allow this fixed block to join/open a mutually opted-in row. */
  fixedRowShare?: boolean;
  // Omitted mode is inferred from position fields for legacy callers.
  mode?: IntelligentPlacementMode;
  preferred?: Readonly<IntelligentPosition>;
  /** Explicit same-page tolerance in µm around preferred. Omitted means exact. */
  preferredTolerance?: Readonly<{x:number;y:number}>;
  // Preserve intentionally reserved whitespace.
  spaceBefore?: number;
  // Explicit trailing row space; cannot be reused by later blocks.
  spaceAfter?: number;
  startNewPage?: boolean;
  /** Consecutive members form an indivisible vertical group on one page. */
  keepTogetherGroup?: string;
  /** All group members must agree. Rows still require mutual sideBySide. */
  keepTogetherLayout?: 'vertical'|'rows';
}
/** Hard exclusion, independent of semantic document blocks. */
export interface IntelligentReservedRegion {
  id:string;
  page:number;
  rect:Readonly<Rect>;
}
export interface IntelligentLayoutInput {
  revision: string;
  content: Readonly<Size>;
  gap: number;
  blocks: readonly IntelligentBlock[];
  reservedRegions?: readonly IntelligentReservedRegion[];
}
export interface IntelligentPlacement {
  id: string;
  page: number;
  rect: Rect;
  // Present only if the reserved footprint exceeds measured content.
  occupiedRect?: Rect;
  fixed: boolean;
  preference?: 'honored' | 'fallback';
}
export interface IntelligentPreviousPosition extends IntelligentPosition { id:string }
export interface IntelligentOptimizationOptions {
  /** Soft stability hints only; never treated as saved placement intent. */
  previousPositions?: readonly Readonly<IntelligentPreviousPosition>[];
}
export interface IntelligentCandidateScore {
  honoredPreferences:number;
  pageCount:number;
  previousPageDistance:number;
  previousPositionDistance:number;
  occupiedDepth:number;
}
export interface IntelligentOptimizationReport {
  evaluatedCandidates:number;
  feasibleCandidates:number;
  selected:'greedy'|'lookahead'|'greedy-fallback'|'lookahead-fallback';
  score:IntelligentCandidateScore;
}
export type IntelligentLayoutResult =
  | {status:'placed'; revision:string; placements: IntelligentPlacement[]; publicationReady:false; optimization?:IntelligentOptimizationReport}
  | {status:'conflict'; revision:string; placements: []; publicationReady:false;
      diagnostic:{code:'IL_INVALID'|'IL_TOO_LARGE'|'IL_FIXED_CONFLICT'|'IL_RESERVED_CONFLICT'|'IL_SIZE_CONFLICT'|'IL_LIMIT'; blockId?:string; regionId?:string; message:string}};

const MAX = 1_000_000_000;
const MAX_PAGES = 10000;
const MAX_REGIONS_PER_PAGE = 128;
const MAX_REGIONS = 10000;
const natural = (n:number) => Number.isSafeInteger(n) && n>=0 && n<=MAX;
const positive = (n:number) => natural(n) && n>0;
const validSize = (s:Size) => !!s && positive(s.width) && positive(s.height);
const validPosition = (p:IntelligentPosition) => !!p && natural(p.page) && p.page<MAX_PAGES && natural(p.x) && natural(p.y);
const percent = (n:number) => Number.isInteger(n)&&n>=1&&n<=100;
type SizeResolution = {size:Size}|{code:'IL_INVALID'|'IL_SIZE_CONFLICT';message:string};

function resolveFootprint(b:IntelligentBlock,content:Readonly<Size>):SizeResolution {
  const c=b.sizeConstraints;
  if(c!==undefined){
    if(!c||typeof c!=='object'||Array.isArray(c)||
      [c.minWidth,c.minHeight,c.maxWidth,c.maxHeight].some(v=>v!==undefined&&!positive(v))||
      [c.minWidthPercent,c.minHeightPercent].some(v=>v!==undefined&&!percent(v)))
      return {code:'IL_INVALID',message:'Invalid size constraints'};
  }
  // Round minimum percentages up: never under-reserve a requested fraction.
  const w=Math.max(b.size.width,c?.minWidth??0,Math.ceil(content.width*(c?.minWidthPercent??0)/100));
  const h=Math.max(b.size.height,c?.minHeight??0,Math.ceil(content.height*(c?.minHeightPercent??0)/100));
  if(w>(c?.maxWidth??MAX)||h>(c?.maxHeight??MAX))
    return {code:'IL_SIZE_CONFLICT',message:'Measured or minimum footprint exceeds maximum'};
  if(b.fixed&&b.fixedPositionOnly!==true&&(w!==b.size.width||h!==b.size.height))
    return {code:'IL_SIZE_CONFLICT',message:'Minimum footprint conflicts with fixed size'};
  return {size:{width:w,height:h+(b.spaceAfter??0)}};
}

// Rectangles are half-open; edge contact is legal. Gap applies between blocks.
function overlaps(a:Readonly<Rect>,b:Readonly<Rect>):boolean {
  return a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
}

// Sorted by x, then input order. Find the first horizontal gap in this band.
function findX(regions:readonly IntelligentReservedRegion[], minX:number,y:number,w:number,h:number,width:number):number|undefined {
  let x=minX;
  for(const {rect:r} of regions){
    if(r.y>=y+h || r.y+r.height<=y || r.x+r.width<=x) continue;
    if(x+w<=r.x) break;
    x=r.x+r.width;
    if(x+w>width) return undefined;
  }
  return x+w<=width?x:undefined;
}

// Search only obstacle bottoms, never individual physical units.
function* findRow(regions:readonly IntelligentReservedRegion[],minY:number,w:number,h:number,width:number,height:number):Generator<IntelligentWorkStage,{x:number;y:number}|undefined,void> {
  let y=minY,attempts=0;
  while(y+h<=height){
    if(attempts++%32===31)yield 'il-place';
    const x=findX(regions,0,y,w,h,width);
    if(x!==undefined) return {x,y};
    let next=Infinity;
    for(const {rect:r} of regions){
      if(r.y<y+h && r.y+r.height>y) next=Math.min(next,r.y+r.height);
    }
    if(!Number.isFinite(next)) return undefined;
    y=next;
  }
  return undefined;
}

// Find the closest permitted independent-row origin on the natural page.
// For each candidate y, free x intervals are exact because obstacles are
// half-open. Feasible bands change only at obstacle top-h and bottom edges.
// Integer coordinates immediately inside each band are included as well.
function* preferredSlot(regions:readonly IntelligentReservedRegion[],target:IntelligentPosition,
  tolerance:{x:number;y:number},minY:number,w:number,h:number,width:number,height:number):
  Generator<IntelligentWorkStage,{x:number;y:number}|undefined,void>{
  const x0=Math.max(0,target.x-tolerance.x),x1=Math.min(width-w,target.x+tolerance.x);
  const y0=Math.max(minY,target.y-tolerance.y),y1=Math.min(height-h,target.y+tolerance.y);
  if(x0>x1||y0>y1)return undefined;
  const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
  const ys=new Set<number>([y0,y1,clamp(target.y,y0,y1)]);
  for(const {rect:r} of regions)for(const y of [r.y-h,r.y-h+1,r.y+r.height-1,r.y+r.height])
    if(y>=y0&&y<=y1)ys.add(y);
  let best:{x:number;y:number;distance:number}|undefined,scanned=0;
  for(const y of ys){
    if(scanned++%16===0)yield 'il-place';
    let start=x0;
    const consider=(lo:number,hi:number)=>{
      if(lo>hi)return;
      const x=clamp(target.x,lo,hi),distance=Math.abs(x-target.x)+Math.abs(y-target.y);
      if(!best||distance<best.distance||(distance===best.distance&&(y<best.y||(y===best.y&&x<best.x))))best={x,y,distance};
    };
    for(const {rect:r} of regions){
      if(r.y>=y+h||r.y+r.height<=y||r.x+r.width<=start)continue;
      consider(start,Math.min(x1,r.x-w));
      start=Math.max(start,r.x+r.width);
      if(start>x1)break;
    }
    consider(start,x1);
  }
  return best?{x:best.x,y:best.y}:undefined;
}
function preferenceMatches(b:IntelligentBlock,page:number,x:number,y:number):boolean{
  const target=b.preferred,t=b.preferredTolerance;
  return !!target&&page===target.page&&Math.abs(x-target.x)<=(t?.x??0)&&Math.abs(y-target.y)<=(t?.y??0);
}

/**
 * Deterministic ordered shelf placement. No automatic reordering, clipping,
 * scaling or constraint relaxation. A conflict returns no candidate placements;
 * callers retain the last valid plan. A conservative solver may reject an input
 * that could fit with more sophisticated search.
 */
export function planIntelligentLayout(input: IntelligentLayoutInput, options?:IntelligentOptimizationOptions): IntelligentLayoutResult {
  return finishIntelligentWork(planWork(input,options));
}

/** Shared work stages for synchronous and cooperative solvers. */
export type IntelligentWorkStage='il-validate'|'il-key'|'il-match'|'il-reuse'|'il-place'|'il-score'|'il-snapshot';
export type IntelligentWorkCheckpoint=(stage:IntelligentWorkStage)=>void|Promise<void>;
function finishIntelligentWork<T>(work:Generator<IntelligentWorkStage,T,void>):T {
  let step=work.next();
  while(!step.done)step=work.next();
  return step.value;
}
async function finishIntelligentWorkCooperative<T>(work:Generator<IntelligentWorkStage,T,void>,checkpoint:IntelligentWorkCheckpoint):Promise<T>{
  try{
    let step=work.next();
    while(!step.done){const wait=checkpoint(step.value);if(wait)await wait;step=work.next();}
    return step.value;
  }finally{work.return(undefined as never);}
}
function* planWork(input:IntelligentLayoutInput,options?:IntelligentOptimizationOptions):Generator<IntelligentWorkStage,IntelligentLayoutResult,void>{
  if(options!==undefined) return yield* optimize(input,options);
  const first = yield* solve(input,true);
  // Soft choices must not make a feasible hard plan fail. At most two passes.
  if(first.status==='conflict' && Array.isArray(input.blocks) &&
    input.blocks.some(b=>b?.preferred!==undefined) &&
    (first.diagnostic.code==='IL_FIXED_CONFLICT'||first.diagnostic.code==='IL_LIMIT'))
    return yield* solve(input,false);
  return first;
}

type Placed = Extract<IntelligentLayoutResult,{status:'placed'}>;

/** Opaque, process-local snapshot of a successful deterministic shelf pass. */
export interface IntelligentLayoutSnapshot {readonly kind:'intelligent-layout-snapshot'}
export interface IncrementalIntelligentLayoutResult {
  layout:IntelligentLayoutResult;
  snapshot?:IntelligentLayoutSnapshot;
  /** Placement work only; input validation and result copying still run. */
  reusedBlocks:number;
  reusedSuffixBlocks:number;
  placedBlocks:number;
  /** Private placement values reused by reference, never exposed to callers. */
  sharedSnapshotPlacements?:number;
  /** Global candidate selection cannot safely reuse a single shelf pass. */
  fullRecompute:boolean;
}
type FlowState=readonly [number,number,number,number,boolean,boolean];
// Normalized, validated geometry only. All fields are primitive, and the
// tuple never retains any caller-owned object. No per-block JSON encoding.
type LayoutKey=readonly [string,number,number,number,number,number,number,boolean,boolean,number,number,number,boolean];
const equalKey=(a:LayoutKey,b:LayoutKey)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2]&&
  a[3]===b[3]&&a[4]===b[4]&&a[5]===b[5]&&a[6]===b[6]&&a[7]===b[7]&&
  a[8]===b[8]&&a[9]===b[9]&&a[10]===b[10]&&a[11]===b[11]&&a[12]===b[12];
type SavedLayout={context:string;keys:LayoutKey[];states:FlowState[];placements:IntelligentPlacement[]};
type IncrementalLayoutState={previous?:SavedLayout;next?:SavedLayout;reusedBlocks:number;reusedSuffixBlocks:number;placedBlocks:number;sharedSnapshotPlacements:number};
const layoutSnapshots=new WeakMap<IntelligentLayoutSnapshot,SavedLayout>();
function copyPlacement(p:IntelligentPlacement):IntelligentPlacement{
  const value:IntelligentPlacement={id:p.id,page:p.page,rect:{...p.rect},fixed:p.fixed};
  if(p.occupiedRect)value.occupiedRect={...p.occupiedRect};
  if(p.preference!==undefined)value.preference=p.preference;
  return value;
}

/** Opt-in incremental placement. Preferred/fallback and optimized candidate
 * searches deliberately use the full planner until per-candidate snapshots exist. */
export function planIntelligentLayoutIncremental(input:IntelligentLayoutInput,previous?:IntelligentLayoutSnapshot,
  options?:IntelligentOptimizationOptions):IncrementalIntelligentLayoutResult {
  return finishIntelligentWork(incrementalWork(input,previous,options));
}

/** The caller keeps input and options immutable until completion. Rejecting a
 * checkpoint cancels the work without changing the previous snapshot. */
export function planIntelligentLayoutIncrementalCooperative(input:IntelligentLayoutInput,previous:IntelligentLayoutSnapshot|undefined,
  checkpoint:IntelligentWorkCheckpoint,options?:IntelligentOptimizationOptions):Promise<IncrementalIntelligentLayoutResult>{
  return finishIntelligentWorkCooperative(incrementalWork(input,previous,options),checkpoint);
}
function* incrementalWork(input:IntelligentLayoutInput,previous?:IntelligentLayoutSnapshot,
  options?:IntelligentOptimizationOptions):Generator<IntelligentWorkStage,IncrementalIntelligentLayoutResult,void>{
  yield 'il-validate';
  if(options!==undefined||!Array.isArray(input.blocks)||input.blocks.some(b=>b?.preferred!==undefined||b?.keepTogetherGroup!==undefined)){
    const layout=yield* planWork(input,options);
    return {layout,reusedBlocks:0,reusedSuffixBlocks:0,placedBlocks:0,fullRecompute:true};
  }
  const state:IncrementalLayoutState={previous:previous?layoutSnapshots.get(previous):undefined,reusedBlocks:0,reusedSuffixBlocks:0,placedBlocks:0,sharedSnapshotPlacements:0};
  const layout=yield* solve(input,true,false,state);
  let snapshot:IntelligentLayoutSnapshot|undefined;
  if(state.next){
    snapshot=Object.freeze({kind:'intelligent-layout-snapshot' as const});
    layoutSnapshots.set(snapshot,state.next);
  }
  return {layout,snapshot,reusedBlocks:state.reusedBlocks,reusedSuffixBlocks:state.reusedSuffixBlocks,placedBlocks:state.placedBlocks,sharedSnapshotPlacements:state.sharedSnapshotPlacements,fullRecompute:false};
}

function* scoreCandidate(result:Placed,previous:ReadonlyMap<string,IntelligentPreviousPosition>):Generator<IntelligentWorkStage,IntelligentCandidateScore,void> {
  let honoredPreferences=0,pageCount=0,previousPageDistance=0,previousPositionDistance=0;
  const depths=new Map<number,number>();
  let scanned=0;
  for(const p of result.placements){
    if(scanned++%128===0)yield 'il-score';
    if(p.preference==='honored') honoredPreferences++;
    pageCount=Math.max(pageCount,p.page+1);
    const old=previous.get(p.id), r=p.occupiedRect??p.rect;
    if(old){
      previousPageDistance+=Math.abs(p.page-old.page);
      previousPositionDistance+=Math.abs(r.x-old.x)+Math.abs(r.y-old.y);
    }
    depths.set(p.page,Math.max(depths.get(p.page)??0,r.y+r.height));
  }
  let occupiedDepth=0;
  for(const depth of depths.values()) occupiedDepth+=depth;
  return {honoredPreferences,pageCount,previousPageDistance,previousPositionDistance,occupiedDepth};
}

function better(a:IntelligentCandidateScore,b:IntelligentCandidateScore):boolean {
  if(a.honoredPreferences!==b.honoredPreferences) return a.honoredPreferences>b.honoredPreferences;
  if(a.pageCount!==b.pageCount) return a.pageCount<b.pageCount;
  if(a.previousPageDistance!==b.previousPageDistance) return a.previousPageDistance<b.previousPageDistance;
  if(a.previousPositionDistance!==b.previousPositionDistance) return a.previousPositionDistance<b.previousPositionDistance;
  return a.occupiedDepth<b.occupiedDepth;
}

function* optimize(input:IntelligentLayoutInput,options:IntelligentOptimizationOptions):Generator<IntelligentWorkStage,IntelligentLayoutResult,void> {
  const invalid=(message:string):IntelligentLayoutResult=>({status:'conflict',revision:input.revision,
    placements:[],publicationReady:false,diagnostic:{code:'IL_INVALID',message}});
  if(!options||typeof options!=='object'||Array.isArray(options)) return invalid('Invalid optimization options');
  const hints=options.previousPositions===undefined?[]:options.previousPositions;
  if(!Array.isArray(hints)||hints.length>10000) return invalid('Invalid previous positions');
  const previous=new Map<string,IntelligentPreviousPosition>();
  let scanned=0;
  for(const hint of hints){
    if(scanned++%64===0)yield 'il-validate';
    if(!hint||typeof hint.id!=='string'||!hint.id||previous.has(hint.id)||!validPosition(hint))
      return invalid('Invalid or duplicate previous position');
    previous.set(hint.id,hint);
  }
  const first=yield* solve(input,true);
  // Invalid input and static hard conflicts cannot be fixed by alternate shelves.
  if(first.status==='conflict'&&first.diagnostic.code!=='IL_FIXED_CONFLICT'&&first.diagnostic.code!=='IL_LIMIT') return first;
  const candidates: {name:IntelligentOptimizationReport['selected'];result:IntelligentLayoutResult}[]=[
    {name:'greedy',result:first},{name:'lookahead',result:yield* solve(input,true,true)}
  ];
  if(Array.isArray(input.blocks)&&input.blocks.some(b=>b?.preferred!==undefined)){
    candidates.push({name:'greedy-fallback',result:yield* solve(input,false)},
      {name:'lookahead-fallback',result:yield* solve(input,false,true)});
  }
  let best:{name:IntelligentOptimizationReport['selected'];result:Placed;score:IntelligentCandidateScore}|undefined;
  let feasibleCandidates=0;
  for(const {name,result} of candidates){
    if(result.status!=='placed') continue;
    feasibleCandidates++;
    const score=yield* scoreCandidate(result,previous);
    if(!best||better(score,best.score)) best={name,result,score};
  }
  if(!best) return first;
  return {...best.result,optimization:{evaluatedCandidates:candidates.length,feasibleCandidates,selected:best.name,score:best.score}};
}

function* solve(input:IntelligentLayoutInput,honorPreferences:boolean,lookahead=false,incremental?:IncrementalLayoutState):Generator<IntelligentWorkStage,IntelligentLayoutResult,void> {
  const conflict = (code: Extract<IntelligentLayoutResult,{status:'conflict'}>['diagnostic']['code'],
    message:string,blockId?:string,regionId?:string):IntelligentLayoutResult =>
      ({status:'conflict',revision:input.revision,placements:[],publicationReady:false,
        diagnostic:{code,message,blockId,...(regionId!==undefined?{regionId}:{})}});
  if (typeof input.revision!=='string' || !input.revision || !validSize(input.content) || !natural(input.gap) || !Array.isArray(input.blocks))
    return conflict('IL_INVALID','Invalid layout input');
  if(input.blocks.length>10000) return conflict('IL_LIMIT','Block limit exceeded');
  const {width,height}=input.content, gap=input.gap, ids=new Set<string>();
  const reserved=input.reservedRegions===undefined?[]:input.reservedRegions;
  if(!Array.isArray(reserved)) return conflict('IL_INVALID','Invalid reserved regions');
  if(reserved.length>MAX_REGIONS) return conflict('IL_LIMIT','Reserved region limit exceeded');
  const byPage=new Map<number,IntelligentReservedRegion[]>(), regionIds=new Set<string>();
  let scanned=0;
  for(const region of reserved){
    if(scanned++%64===0)yield 'il-validate';
    if(!region || typeof region.id!=='string'||!region.id||regionIds.has(region.id)||
      !region.rect||!validSize(region.rect)||!validPosition({page:region.page,x:region.rect.x,y:region.rect.y})||
      region.rect.x+region.rect.width>width||region.rect.y+region.rect.height>height)
      return conflict('IL_INVALID','Invalid or duplicate reserved region',undefined,region?.id);
    regionIds.add(region.id);
    const list=byPage.get(region.page)??[];
    if(list.length>=MAX_REGIONS_PER_PAGE) return conflict('IL_LIMIT','Page reserved region limit exceeded',undefined,region.id);
    list.push(region);byPage.set(region.page,list);
  }
  for(const list of byPage.values()) list.sort((a,b)=>a.rect.x-b.rect.x);
  const emptyRegions:readonly IntelligentReservedRegion[]=[];
  const regionsAt=(p:number):readonly IntelligentReservedRegion[]=>byPage.get(p)??emptyRegions;
  const footprints:Size[]=[];
  const keys:LayoutKey[]=[];
  for(const b of input.blocks){
    if(scanned++%64===0)yield 'il-validate';
    if(!b || typeof b.id!=='string' || !b.id || ids.has(b.id) || !validSize(b.size) ||
      (b.spaceBefore!==undefined&&!natural(b.spaceBefore)) ||
      (b.spaceAfter!==undefined&&!natural(b.spaceAfter)) ||
      (b.sideBySide!==undefined&&typeof b.sideBySide!=='boolean') ||
      (b.startNewPage!==undefined&&typeof b.startNewPage!=='boolean') ||
      (b.fixedPositionOnly!==undefined&&typeof b.fixedPositionOnly!=='boolean') ||
      (b.fixedPositionOnly===true&&b.fixed===undefined) ||
      (b.fixedRowShare!==undefined&&typeof b.fixedRowShare!=='boolean') ||
      (b.fixedRowShare===true&&(b.fixed===undefined||b.sideBySide!==true)) ||
      (b.keepTogetherGroup!==undefined&&(typeof b.keepTogetherGroup!=='string'||!b.keepTogetherGroup.trim()||b.keepTogetherGroup.length>256||b.fixed!==undefined||b.preferred!==undefined||(b.sideBySide===true&&b.keepTogetherLayout!=='rows'))) ||
      (b.keepTogetherLayout!==undefined&&(b.keepTogetherGroup===undefined||(b.keepTogetherLayout!=='vertical'&&b.keepTogetherLayout!=='rows'))))
      return conflict('IL_INVALID','Invalid or duplicate block',b?.id);
    const mode=b.mode ?? (b.fixed!==undefined?'fixed':b.preferred!==undefined?'preferred':'auto');
    if((b.mode!==undefined&&b.mode!==mode) ||
      (mode!=='auto'&&mode!=='fixed'&&mode!=='preferred') ||
      (mode==='fixed')!==(b.fixed!==undefined) ||
      (mode==='preferred')!==(b.preferred!==undefined) ||
      (b.preferred!==undefined&&!validPosition(b.preferred)) ||
      (b.preferredTolerance!==undefined&&(!b.preferred||!b.preferredTolerance||
        typeof b.preferredTolerance!=='object'||Array.isArray(b.preferredTolerance)||
        !natural(b.preferredTolerance.x)||!natural(b.preferredTolerance.y)||
        Object.keys(b.preferredTolerance).some(key=>key!=='x'&&key!=='y'))))
      return conflict('IL_INVALID','Invalid or contradictory placement mode',b.id);
    ids.add(b.id);
    const footprint=resolveFootprint(b,input.content);
    if('code' in footprint) return conflict(footprint.code,footprint.message,b.id);
    const occupied=footprint.size;
    footprints.push(occupied);
    if(occupied.width>width || occupied.height+(b.spaceBefore??0)>height)
      return conflict('IL_TOO_LARGE','Measured block or reserved space exceeds page',b.id);
    if(b.fixed!==undefined){
      const f=b.fixed;
      if(!validPosition(f))
        return conflict('IL_INVALID','Invalid fixed position',b.id);
      if(f.x+occupied.width>width||f.y+occupied.height>height)
        return conflict('IL_FIXED_CONFLICT','Fixed block exceeds content area',b.id);
      const hit=regionsAt(f.page).find(r=>overlaps(r.rect,{x:f.x,y:f.y,width:occupied.width,height:occupied.height}));
      if(hit) return conflict('IL_RESERVED_CONFLICT','Fixed block intersects reserved region',b.id,hit.id);
    }
    if(incremental){
      if(keys.length%64===0)yield 'il-key';
      const f=b.fixed;
      keys.push([b.id,b.size.width,b.size.height,occupied.width,occupied.height,b.spaceBefore??0,b.spaceAfter??0,
        !!b.sideBySide,!!b.startNewPage,f?.page??-1,f?.x??0,f?.y??0,b.fixedRowShare===true]);
    }
  }
  // A group reserves one conservative enclosing rectangle. Its members retain
  // their original identities, geometry, gaps and source order.
  const groups=new Map<number,{end:number;width:number;height:number;offsets:{x:number;y:number}[]}>();
  const seenGroups=new Set<string>();
  for(let i=0;i<input.blocks.length;){
    if(i%64===0)yield 'il-validate';
    const first=input.blocks[i],id=first.keepTogetherGroup;
    if(id===undefined){i++;continue;}
    if(seenGroups.has(id))return conflict('IL_INVALID','Group members must be consecutive',first.id);
    seenGroups.add(id);
    const mode=first.keepTogetherLayout??'vertical';
    let end=i+1,w=footprints[i].width,h=footprints[i].height;
    let rowY=0,right=w,share=mode==='rows'&&first.sideBySide===true&&!(first.spaceBefore??0)&&!(first.spaceAfter??0);
    const offsets=[{x:0,y:0}];
    while(end<input.blocks.length&&input.blocks[end].keepTogetherGroup===id){
      if(end%64===0)yield 'il-validate';
      const member=input.blocks[end],footprint=footprints[end];
      if(member.startNewPage)return conflict('IL_INVALID','Explicit page break inside keep-together group',member.id);
      if((member.keepTogetherLayout??'vertical')!==mode)return conflict('IL_INVALID','Group layout modes must agree',member.id);
      const canShare=mode==='rows'&&member.sideBySide===true&&!(member.spaceBefore??0)&&!(member.spaceAfter??0);
      if(share&&canShare&&right+gap+footprint.width<=width){
        const x=right+gap;offsets.push({x,y:rowY});
        right=x+footprint.width;h=Math.max(h,rowY+footprint.height);
      }else{
        rowY=h+gap+(member.spaceBefore??0);offsets.push({x:0,y:rowY});
        right=footprint.width;h=rowY+footprint.height;
      }
      share=canShare;w=Math.max(w,right);
      if(h+(first.spaceBefore??0)>height)return conflict('IL_TOO_LARGE','Keep-together group exceeds page',first.id);
      end++;
    }
    if(end===i+1)return conflict('IL_INVALID','Group must have at least two members',first.id);
    groups.set(i,{end,width:w,height:h,offsets});
    i=end;
  }
  const placements:IntelligentPlacement[]=[];
  let page=0, rowY=0, bottom=0, right=0, rowOpen=false, rowShare=false;
  function nextPage(p:number){
    page=p;rowY=0;bottom=0;right=0;rowOpen=false;rowShare=false;
  }
  const capture=():FlowState=>[page,rowY,bottom,right,rowOpen,rowShare];
  const restore=(s:FlowState)=>{[page,rowY,bottom,right,rowOpen,rowShare]=s;};
  const states:FlowState[]=[];
  let context='',prefix=0,suffix=0,previous:SavedLayout|undefined;
  const savedPlacements:IntelligentPlacement[]=[];
  if(incremental){
    // All blocks and constraints were validated before any reuse. Keys use
    // effective footprint, not the equivalent spelling of minimum constraints.
    context=JSON.stringify([width,height,gap,reserved.map(r=>[r.id,r.page,r.rect.x,r.rect.y,r.rect.width,r.rect.height])]);
    previous=incremental.previous?.context===context?incremental.previous:undefined;
    if(previous){
      while(prefix<keys.length&&prefix<previous.keys.length&&equalKey(keys[prefix],previous.keys[prefix])){
        if(prefix%128===0)yield 'il-match';prefix++;
      }
      while(suffix<keys.length-prefix&&suffix<previous.keys.length-prefix&&
        equalKey(keys[keys.length-1-suffix],previous.keys[previous.keys.length-1-suffix])){
        if(suffix%128===0)yield 'il-match';suffix++;
      }
      for(let i=0;i<prefix;i++){
        if(i%128===0)yield 'il-reuse';
        states.push(previous.states[i]);savedPlacements.push(previous.placements[i]);placements.push(copyPlacement(previous.placements[i]));
      }
      restore(previous.states[prefix]);incremental.reusedBlocks=prefix;incremental.sharedSnapshotPlacements=prefix;
      if(prefix===keys.length&&prefix===previous.keys.length){
        incremental.next=previous;
        return {status:'placed',revision:input.revision,placements,publicationReady:false};
      }
    }
  }
  for(let i=prefix;i<input.blocks.length;i++){
    if(i%64===0)yield 'il-place';
    if(incremental){
      const now=capture();
      if(previous&&suffix&&i>=keys.length-suffix){
        const oldIndex=previous.keys.length-(keys.length-i);
        if(now.every((v,j)=>v===previous!.states[oldIndex][j])){
          for(let j=oldIndex;j<previous.keys.length;j++){
            if(j%128===0)yield 'il-reuse';
            states.push(previous.states[j]);savedPlacements.push(previous.placements[j]);placements.push(copyPlacement(previous.placements[j]));
          }
          restore(previous.states[previous.keys.length]);
          incremental.reusedSuffixBlocks=keys.length-i;
          incremental.reusedBlocks+=keys.length-i;
          incremental.sharedSnapshotPlacements+=keys.length-i;
          break;
        }
      }
      states.push(now);incremental.placedBlocks++;
    }
    const b=input.blocks[i];
    const {width:w,height:h}=footprints[i], before=b.spaceBefore??0, after=b.spaceAfter??0;
    if(b.startNewPage && rowOpen) nextPage(page+1);
    if(page>=MAX_PAGES) return conflict('IL_LIMIT','Page limit exceeded',b.id);
    const group=groups.get(i);
    if(group){
      const minY=(rowOpen?bottom+gap:0)+before;
      let slot=yield* findRow(regionsAt(page),minY,group.width,group.height,width,height);
      let groupPage=page;
      while(!slot&&++groupPage<MAX_PAGES){
        if(groupPage%16===0)yield 'il-place';
        slot=yield* findRow(regionsAt(groupPage),before,group.width,group.height,width,height);
      }
      if(!slot||groupPage>=MAX_PAGES)return conflict('IL_LIMIT','No page fits keep-together group',b.id);
      if(groupPage!==page)nextPage(groupPage);
      for(let k=i;k<group.end;k++){
        if(k%64===0)yield 'il-place';
        const member=input.blocks[k],footprint=footprints[k],offset=group.offsets[k-i];
        const x=slot.x+offset.x,y=slot.y+offset.y;
        const rect={x,y,width:member.size.width,height:member.size.height};
        placements.push({id:member.id,page,rect,fixed:false,
          ...(footprint.width!==rect.width||footprint.height!==rect.height?{occupiedRect:{x,y,...footprint}}:{})});
      }
      rowY=slot.y;bottom=slot.y+group.height;right=slot.x+group.width;rowOpen=true;rowShare=false;
      i=group.end-1;continue;
    }
    let x=0,y=0;
    let preference:IntelligentPlacement['preference']=b.preferred?'fallback':undefined;
    const target=b.preferred;
    if(b.fixed){
      const f=b.fixed;
      if(f.page<page) return conflict('IL_FIXED_CONFLICT','Fixed page conflicts with document order',b.id);
      if(f.page>page) nextPage(f.page);
      const minY=(rowOpen?bottom+gap:0)+before;
      // Sharing is opt-in for fixed blocks, in addition to ordinary mutual
      // sideBySide permission. Exact pinned coordinates never move.
      const allowShare=b.fixedRowShare===true&&before===0&&after===0;
      const join=allowShare&&rowOpen&&rowShare&&f.y===rowY&&f.x>=right+gap;
      if(!join&&f.y<minY) return conflict('IL_FIXED_CONFLICT','Fixed position conflicts with preceding content or reserved space',b.id);
      x=f.x;y=f.y;
      if(join){bottom=Math.max(bottom,y+h);right=x+w;}
      else{rowY=y;bottom=y+h;right=x+w;rowOpen=true;}
      rowShare=allowShare;
    }else{
      const minY=(rowOpen?bottom+gap:0)+before;
      let shareX=rowOpen && rowShare && b.sideBySide && before===0 && after===0 && rowY+h<=height
        ? findX(regionsAt(page),right+gap,rowY,w,h,width):undefined;
      // One-block lookahead: avoid pairing a short row with a tall block
      // when the two following neighbors fit together more compactly.
      // Only choose this on unobstructed pages and for opt-in normal flow.
      if(lookahead&&shareX!==undefined&&!target&&regionsAt(page).length===0){
        const next=input.blocks[i+1];
        if(next&&next.sideBySide&&!next.fixed&&!next.preferred&&!next.startNewPage&&!next.keepTogetherGroup&&
          !next.spaceBefore&&!next.spaceAfter){
          const n=footprints[i+1];
          const oldHeight=bottom-rowY;
          const paired=Math.max(oldHeight,h)+gap+n.height;
          const separate=oldHeight+gap+Math.max(h,n.height);
          if(shareX+w+gap+n.width>width&&w+gap+n.width<=width&&
             minY+Math.max(h,n.height)<=height&&separate<paired) shareX=undefined;
        }
      }
      let naturalPage=page;
      let slot=shareX!==undefined?{x:shareX,y:rowY}:(yield* findRow(regionsAt(page),minY,w,h,width,height));
      // Every failed page advances. With no exclusions, the next page must fit.
      while(!slot && ++naturalPage<MAX_PAGES){
        if(naturalPage%16===0)yield 'il-place';
        slot=yield* findRow(regionsAt(naturalPage),before,w,h,width,height);
      }
      if(!slot || naturalPage>=MAX_PAGES) return conflict('IL_LIMIT','Page limit exceeded',b.id);
      const targetMinY=target?.page===page?minY:before;
      const chosen=honorPreferences&&target&&target.page===naturalPage
        ?yield* preferredSlot(regionsAt(target.page),target,b.preferredTolerance??{x:0,y:0},targetMinY,w,h,width,height)
        :undefined;
      if(chosen && target){
        if(target.page!==page) nextPage(target.page);
        x=chosen.x;y=chosen.y;preference='honored';
        rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=false;
      }else if(shareX!==undefined){
        x=shareX;y=rowY;right=x+w;bottom=Math.max(bottom,y+h);
      }else{
        if(naturalPage!==page) nextPage(naturalPage);
        x=slot.x;y=slot.y;
        rowY=y;bottom=y+h;right=x+w;rowOpen=true;rowShare=!!b.sideBySide&&before===0&&after===0;
      }
    }
    if(preferenceMatches(b,page,x,y)) preference='honored';
    const placement:IntelligentPlacement={id:b.id,page,rect:{x,y,width:b.size.width,height:b.size.height},fixed:!!b.fixed,
      ...(w!==b.size.width||h!==b.size.height?{occupiedRect:{x,y,width:w,height:h}}:{}),
      ...(preference!==undefined?{preference}:{})};
    placements.push(placement);
    if(incremental){
      if(i%128===0)yield 'il-snapshot';
      savedPlacements.push(copyPlacement(placement));
    }
  }
  if(incremental){
    states.push(capture());
    incremental.next={context,keys,states,placements:savedPlacements};
  }
  return {status:'placed',revision:input.revision,placements,publicationReady:false};
}
