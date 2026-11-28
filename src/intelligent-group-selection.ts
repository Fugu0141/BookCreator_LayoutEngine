import {intelligentMeasuredId,type IntelligentMeasuredIntent,type IntelligentMeasuredOptions,type IntelligentMeasuredResult} from './intelligent-measured.js';
import type {PaginationInput} from './pagination.js';

type Source=Pick<IntelligentMeasuredIntent,'documentId'|'blockKey'>;
type Mode='vertical'|'rows'|'adaptiveRows';
export interface IntelligentGroupSelection {
  groupId:string;
  layout:Mode;
  members:readonly Readonly<Source>[];
}
export type IntelligentGroupProposal =
  | {status:'proposed';options:IntelligentMeasuredOptions;members:Source[]}
  | {status:'rejected';reason:'stale'|'invalid-selection'|'ambiguous'|'nonconsecutive'|'cross-document'|'hard-break'|'existing-group'|'position-intent'|'horizontal-intent'};

const key=(s:Readonly<Source>)=>intelligentMeasuredId(s);
const validSource=(s:Readonly<Source>)=>!!s&&typeof s.documentId==='string'&&!!s.documentId&&typeof s.blockKey==='string'&&!!s.blockKey;
const reject=(reason:Extract<IntelligentGroupProposal,{status:'rejected'}>['reason']):IntelligentGroupProposal=>({status:'rejected',reason});

/**
 * Build an uncommitted grouping request from a complete, current IL preview.
 * The host owns the exact captured options, generation and persistent IDs.
 * Replan before presenting/confirming: a structurally valid group may not fit.
 * Never changes source order, an existing group, a position intent or an
 * explicit horizontal prohibition. Row modes explicitly permit horizontal
 * sharing for members without a prior sideBySide value.
 */
export function proposeIntelligentGroup(
  result:IntelligentMeasuredResult,
  options:IntelligentMeasuredOptions,
  expected:Readonly<Pick<PaginationInput,'revision'|'fingerprint'>>,
  selection:Readonly<IntelligentGroupSelection>,
):IntelligentGroupProposal {
  if(result.status!=='placed'||result.revision!==expected.revision||result.fingerprint!==expected.fingerprint)
    return reject('stale');
  if(!selection||typeof selection.groupId!=='string'||!selection.groupId.trim()||selection.groupId.length>256||
    !['vertical','rows','adaptiveRows'].includes(selection.layout)||!Array.isArray(selection.members)||
    selection.members.length<2||selection.members.length>10000||
    selection.members.some(s=>!validSource(s)))return reject('invalid-selection');
  const selected=new Set(selection.members.map(key));
  if(selected.size!==selection.members.length)return reject('ambiguous');
  if(new Set(selection.members.map(s=>s.documentId)).size!==1)return reject('cross-document');
  const list=options.intents??[];
  if(!Array.isArray(list)||list.length>10000)return reject('ambiguous');
  const existing=new Map<string,IntelligentMeasuredIntent>();
  for(const i of list){
    if(!validSource(i)||!i.placement||existing.has(key(i)))return reject('ambiguous');
    if(i.placement.keepTogetherGroup===selection.groupId)return reject('existing-group');
    existing.set(key(i),i);
  }
  const indices:number[]=[];
  const members:Source[]=[];
  for(const [index,f] of result.fragments.entries()){
    const id=key(f.origin);
    if(!selected.has(id))continue;
    if(f.placement.id!==id||f.continuationIndex!==0)return reject('ambiguous');
    if(f.placement.fixed||f.placement.preference!==undefined)return reject('position-intent');
    indices.push(index);
    members.push({documentId:f.origin.documentId,blockKey:f.origin.blockKey});
  }
  if(indices.length!==selected.size||new Set(members.map(key)).size!==selected.size)return reject('ambiguous');
  if(indices.some((index,i)=>index!==indices[0]+i))return reject('nonconsecutive');
  const replacements=new Map<string,IntelligentMeasuredIntent>();
  for(const [i,member] of members.entries()){
    const id=key(member),p=existing.get(id)?.placement??{},f=result.fragments[indices[i]];
    if(p.keepTogetherGroup!==undefined||p.keepTogetherLayout!==undefined)return reject('existing-group');
    if(p.fixed!==undefined||p.preferred!==undefined||p.preferredTolerance!==undefined||
      p.fixedPositionOnly===true||p.fixedRowShare===true||(p.mode!==undefined&&p.mode!=='auto'))
      return reject('position-intent');
    if(i>0&&(p.startNewPage===true||['explicit','section','page-top','continuation'].includes(f.sourceBreakReason)))
      return reject('hard-break');
    if(selection.layout==='vertical'&&p.sideBySide===true)return reject('horizontal-intent');
    replacements.set(id,{...member,placement:{...p,keepTogetherGroup:selection.groupId,keepTogetherLayout:selection.layout,
      ...(selection.layout!=='vertical'&&p.sideBySide===undefined?{sideBySide:true}:{})}});
  }
  const intents=list.map(i=>{
    const id=key(i),replacement=replacements.get(id);
    if(replacement)replacements.delete(id);
    return replacement??i;
  });
  intents.push(...replacements.values());
  if(intents.length>10000)return reject('invalid-selection');
  return {status:'proposed',options:structuredClone({...options,intents}),members};
}
