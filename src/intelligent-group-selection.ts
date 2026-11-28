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

export interface IntelligentGroupEdit {
  groupId:string;
  /** The entire existing membership, not merely the clicked member. */
  members:readonly Readonly<Source>[];
  action:'ungroup'|Mode;
  /** Explicitly remove true sideBySide flags, never an existing false.
   * The host may offer this separately or use saved provenance. */
  clearHorizontal?:readonly Readonly<Source>[];
}

/**
 * Propose editing an entire existing group in a successful current plan.
 * Keep all non-group intents by default, including sideBySide. Switching
 * to vertical requires explicit clearing of any true horizontal flags.
 * No partial group edit, automatic unlock, or save authorization.
 */
export function proposeIntelligentGroupEdit(
  result:IntelligentMeasuredResult,
  options:IntelligentMeasuredOptions,
  expected:Readonly<Pick<PaginationInput,'revision'|'fingerprint'>>,
  edit:Readonly<IntelligentGroupEdit>,
):IntelligentGroupProposal {
  if(result.status!=='placed'||result.revision!==expected.revision||result.fingerprint!==expected.fingerprint)
    return reject('stale');
  if(!edit||typeof edit.groupId!=='string'||!edit.groupId.trim()||edit.groupId.length>256||
    !['ungroup','vertical','rows','adaptiveRows'].includes(edit.action)||
    !Array.isArray(edit.members)||edit.members.length<2||edit.members.length>10000||
    edit.members.some(s=>!validSource(s)))return reject('invalid-selection');
  const selected=new Set(edit.members.map(key));
  if(selected.size!==edit.members.length)return reject('ambiguous');
  if(new Set(edit.members.map(s=>s.documentId)).size!==1)return reject('cross-document');
  const clear=edit.clearHorizontal??[];
  if(!Array.isArray(clear)||clear.length>selected.size||
    clear.some(s=>!validSource(s)||!selected.has(key(s)))||
    (clear.length>0&&edit.action!=='ungroup'&&edit.action!=='vertical'))return reject('invalid-selection');
  const clearKeys=new Set(clear.map(key));
  if(clearKeys.size!==clear.length)return reject('ambiguous');
  const list=options.intents;
  if(!Array.isArray(list)||list.length>10000)return reject('ambiguous');
  const existing=new Map<string,IntelligentMeasuredIntent>();
  const group=new Set<string>();
  let oldMode:Mode|undefined;
  for(const i of list){
    if(!validSource(i)||!i.placement||existing.has(key(i)))return reject('ambiguous');
    const id=key(i);
    existing.set(id,i);
    if(i.placement.keepTogetherGroup!==edit.groupId)continue;
    group.add(id);
    const mode=i.placement.keepTogetherLayout??'vertical';
    if(!['vertical','rows','adaptiveRows'].includes(mode)||(oldMode!==undefined&&oldMode!==mode))
      return reject('existing-group');
    oldMode=mode;
  }
  if(group.size!==selected.size||[...selected].some(id=>!group.has(id)))return reject('existing-group');
  const indices:number[]=[];
  const members:Source[]=[];
  let page:number|undefined;
  for(const [index,f] of result.fragments.entries()){
    const id=key(f.origin);
    if(!selected.has(id))continue;
    if(f.placement.id!==id||f.continuationIndex!==0)return reject('ambiguous');
    if(f.placement.fixed||f.placement.preference!==undefined)return reject('position-intent');
    if(page!==undefined&&f.placement.page!==page)return reject('existing-group');
    page=f.placement.page;
    indices.push(index);
    members.push({documentId:f.origin.documentId,blockKey:f.origin.blockKey});
  }
  if(indices.length!==selected.size||new Set(members.map(key)).size!==selected.size)return reject('ambiguous');
  if(indices.some((index,i)=>index!==indices[0]+i))return reject('nonconsecutive');
  const replacements=new Map<string,IntelligentMeasuredIntent|null>();
  for(const [i,member] of members.entries()){
    const id=key(member),p=existing.get(id)!.placement,f=result.fragments[indices[i]];
    if(p.fixed!==undefined||p.preferred!==undefined||p.preferredTolerance!==undefined||
      p.fixedPositionOnly===true||p.fixedRowShare===true||(p.mode!==undefined&&p.mode!=='auto'))
      return reject('position-intent');
    if(i>0&&(p.startNewPage===true||['explicit','section','page-top','continuation'].includes(f.sourceBreakReason)))
      return reject('hard-break');
    if(clearKeys.has(id)&&p.sideBySide!==true)return reject('horizontal-intent');
    const {keepTogetherGroup,keepTogetherLayout,...placement}=p;
    if(clearKeys.has(id))delete placement.sideBySide;
    if(edit.action==='vertical'&&placement.sideBySide===true)return reject('horizontal-intent');
    if(edit.action!=='ungroup'){
      const updated={...placement,keepTogetherGroup:edit.groupId,keepTogetherLayout:edit.action,
        ...(edit.action!=='vertical'&&placement.sideBySide===undefined?{sideBySide:true}:{})};
      replacements.set(id,{...member,placement:updated});
    }else{
      replacements.set(id,Object.keys(placement).length?{...member,placement}:null);
    }
  }
  const intents:IntelligentMeasuredIntent[]=[];
  for(const i of list){
    const id=key(i);
    const next=replacements.has(id)?replacements.get(id):i;
    if(next)intents.push(next);
  }
  return {status:'proposed',options:structuredClone({...options,intents}),members};
}
