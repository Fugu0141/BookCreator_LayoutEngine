import {paginateMeasured,type PaginationInput,type MeasuredPagePlan} from './pagination.js';
type RecordValue=Record<string,unknown>;
const isRecord=(v:unknown):v is RecordValue=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const validKeys=(v:RecordValue,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const choice=(v:unknown,values:string[])=>typeof v==='string'&&values.includes(v);
const origin=(v:unknown)=>isRecord(v)&&validKeys(v,['documentId','revision','blockKey','range','persistentId'])&&str(v.documentId)&&str(v.revision)&&str(v.blockKey)&&
  (v.persistentId===undefined||str(v.persistentId))&&(v.range===undefined||(isRecord(v.range)&&validKeys(v.range,['start','end'])&&int(v.range.start)&&int(v.range.end)));
function isInput(v:unknown):v is PaginationInput{
  if(!isRecord(v)||!validKeys(v,['schemaVersion','revision','fingerprint','content','sections'])||v.schemaVersion!==1||!str(v.revision)||!str(v.fingerprint)||
    !isRecord(v.content)||!validKeys(v.content,['width','height'])||!int(v.content.width)||!int(v.content.height)||!Array.isArray(v.sections)||v.sections.length>100000)return false;
  return v.sections.every(s=>isRecord(s)&&validKeys(s,['id','startOn','blocks'])&&str(s.id)&&choice(s.startOn,['page','continuous'])&&Array.isArray(s.blocks)&&s.blocks.length<=100000&&
    s.blocks.every(b=>isRecord(b)&&origin(b.origin)&&(b.kind==='pagebreak'?validKeys(b,['kind','origin']):
      b.kind==='block'&&validKeys(b,['kind','origin','width','unitHeights','splitPolicy','fragmentPadding','startPosition','startPositionSource'])&&int(b.width)&&Array.isArray(b.unitHeights)&&b.unitHeights.length<=1000000&&b.unitHeights.every(int)&&
      choice(b.splitPolicy,['allow','avoid','strict'])&&(b.fragmentPadding===undefined||(isRecord(b.fragmentPadding)&&validKeys(b.fragmentPadding,['top','bottom'])&&int(b.fragmentPadding.top)&&int(b.fragmentPadding.bottom)))&&(b.startPosition===undefined||choice(b.startPosition,['flow','page-top']))&&(b.startPositionSource===undefined||choice(b.startPositionSource,['component','explicit'])))));
}
// Boundary for untrusted JSON. Unknown fields are refused rather than silently dropping a layout constraint.
export function inspectMeasuredInput(value:unknown):{ok:true;plan:MeasuredPagePlan}|{ok:false;diagnostics:{code:'PG_INPUT_SCHEMA';message:string}[]}{
  if(!isInput(value))return {ok:false,diagnostics:[{code:'PG_INPUT_SCHEMA',message:'Invalid or unsupported experimental pagination input'}]};
  return {ok:true,plan:paginateMeasured(value)};
}
