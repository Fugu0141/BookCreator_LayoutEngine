import type {PaginationInput} from './pagination.js';
import {planMeasuredIntelligentLayoutIncrementalCooperative,type IntelligentMeasuredOptions,type IntelligentMeasuredSnapshot,type IncrementalIntelligentMeasuredResult} from './intelligent-measured.js';

export type IntelligentPreviewOutcome=
  | {status:'current';requestId:number;revision:string;calculation:Omit<IncrementalIntelligentMeasuredResult,'snapshot'>}
  | {status:'superseded';requestId:number;revision:string};
export interface IntelligentPreviewSessionOptions {
  /** Target slice duration, not a hard real-time guarantee. */
  sliceMs?:number;
  /** Must yield to the GUI event loop; a microtask alone is insufficient. */
  yieldToHost?:()=>Promise<void>;
  /** Monotonic clock (injectable for deterministic tests). */
  now?:()=>number;
}
const defaultYield=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
/** One session per document. Keeps at most one successful checkpoint handle.
 * Inputs/options are caller-owned and immutable until the returned promise settles.
 * The GUI must additionally compare requestId and revision before committing. */
export function createIntelligentPreviewSession(options:IntelligentPreviewSessionOptions={}){
  const sliceMs=options.sliceMs??8;
  if(!Number.isFinite(sliceMs)||sliceMs<=0||sliceMs>1000)throw new RangeError('Invalid preview slice');
  const yieldToHost=options.yieldToHost??defaultYield,now=options.now??(()=>performance.now());
  let generation=0,snapshot:IntelligentMeasuredSnapshot|undefined;
  const superseded=Symbol('superseded');
  async function request(input:PaginationInput,placement:IntelligentMeasuredOptions={}):Promise<IntelligentPreviewOutcome>{
    const requestId=++generation,revision=input.revision;
    const stale=():IntelligentPreviewOutcome=>({status:'superseded',requestId,revision});
    const assertCurrent=()=>{if(requestId!==generation)throw superseded;};
    let started=now();
    const checkpoint=()=>{
      assertCurrent();
      if(now()-started<sliceMs)return;
      return yieldToHost().then(()=>{assertCurrent();started=now();});
    };
    try{
      // Coalesce requests submitted before the host gets its next turn.
      await yieldToHost();assertCurrent();started=now();
      const {snapshot:next,...calculation}=await planMeasuredIntelligentLayoutIncrementalCooperative(input,placement,snapshot,checkpoint);
      assertCurrent();
      if(calculation.result.status==='placed')snapshot=next;
      return {status:'current',requestId,revision,calculation};
    }catch(error){
      if(error===superseded||requestId!==generation)return stale();
      throw error;
    }
  }
  /** Invalidate outstanding work without discarding the last valid checkpoint. */
  const cancel=()=>{generation++;};
  /** Use on document replacement/close; releases the retained checkpoint. */
  const reset=()=>{cancel();snapshot=undefined;};
  return {request,cancel,reset,isCurrent:(id:number)=>id===generation};
}
