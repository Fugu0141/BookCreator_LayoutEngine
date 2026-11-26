import type {PlainTextMeasureRequest} from './browser-measurement.js';
import type {MeasuredTextLines} from './browser-lines.js';
import {readyPreviewFont} from './preview-font.js';

type Line={start:number;end:number;height:number};
export interface TextMeasurementCache {
  clear():void;
  stats():{entries:number;characters:number;lines:number;hits:number;misses:number};
}
type Entry={characters:number;lines:readonly Line[]};
type FontSnapshot={faces:FontFace[];descriptors:string[];scale:number};
type State={document:Document;entries:Map<string,Entry>;characters:number;lines:number;hits:number;misses:number;epoch:number;fonts?:FontSnapshot};
const states=new WeakMap<TextMeasurementCache,State>();
function empty(s:State){s.entries.clear();s.characters=0;s.lines=0;s.epoch++;}
export function createTextMeasurementCache(document:Document):TextMeasurementCache{
  const state:State={document,entries:new Map(),characters:0,lines:0,hits:0,misses:0,epoch:0};
  const cache:TextMeasurementCache={
    clear(){empty(state);state.fonts=undefined;state.hits=0;state.misses=0;},
    stats(){return {entries:state.entries.size,characters:state.characters,lines:state.lines,hits:state.hits,misses:state.misses};}
  };
  states.set(cache,state);return Object.freeze(cache);
}
function fontSnapshot(document:Document):FontSnapshot{
  const faces:FontFace[]=[],descriptors:string[]=[];
  document.fonts.forEach(face=>{faces.push(face);descriptors.push(JSON.stringify([face.family,face.style,face.weight,face.stretch,face.unicodeRange,face.status,face.ascentOverride,face.descentOverride,face.lineGapOverride,face.featureSettings,face.variationSettings]));});
  return {faces,descriptors,scale:document.defaultView!.devicePixelRatio};
}
function same(a:FontSnapshot|undefined,b:FontSnapshot){
  return !!a&&a.scale===b.scale&&a.faces.length===b.faces.length&&a.faces.every((f,i)=>f===b.faces[i]&&a.descriptors[i]===b.descriptors[i]);
}
function synchronize(s:State){
  const next=fontSnapshot(s.document);
  if(!same(s.fonts,next)){empty(s);s.fonts=next;}
  return next;
}
const maxEntries=256,maxCharacters=200000,maxLines=10000;
function remove(s:State,key:string){
  const entry=s.entries.get(key);if(!entry)return;
  s.entries.delete(key);s.characters-=entry.characters;s.lines-=entry.lines.length;
}
/** Only validated uniform text without math or inline styles is eligible.
 * Rebuild output values and never retain DOM nodes or caller-owned requests.
 * Host must clear when the trusted font environment changes outside FontFaceSet
 * (e.g. system font preferences or external font installation). */
export async function measureWithTextCache(document:Document,r:PlainTextMeasureRequest,cache:TextMeasurementCache|undefined,measure:(document:Document,request:PlainTextMeasureRequest)=>Promise<MeasuredTextLines>):Promise<MeasuredTextLines>{
  if(!cache)return measure(document,r);
  const state=states.get(cache);
  if(!state||state.document!==document)throw Error('Text measurement cache belongs to another document');
  if(r.inlineMath!==undefined||r.inlineStyles!==undefined)return measure(document,r);
  await readyPreviewFont(document,r.fontFamily,r.fontWeight,r.text);
  const fonts=synchronize(state),epoch=state.epoch;
  const key=JSON.stringify([r.text,r.width,r.fontSize,r.fontFamily,r.fontWeight??400,r.lineHeight,r.multiline??false,r.paragraphGap??0]);
  const entry=state.entries.get(key);
  if(entry){
    state.hits++;state.entries.delete(key);state.entries.set(key,entry);
    return {request:r,lines:entry.lines.map(l=>({...l})),measurement:'browser-dom-lines',publicationReady:false};
  }
  state.misses++;
  const result=await measure(document,r);
  const after=synchronize(state);
  if(state.epoch===epoch&&same(fonts,after)&&!result.lines.some(l=>l.displayMath)&&result.lines.length<=maxLines&&r.text.length<=maxCharacters){
    remove(state,key);
    const lines=result.lines.map(({start,end,height})=>({start,end,height}));
    state.entries.set(key,{characters:r.text.length,lines});state.characters+=r.text.length;state.lines+=lines.length;
    while(state.entries.size>maxEntries||state.characters>maxCharacters||state.lines>maxLines)remove(state,state.entries.keys().next().value!);
  }
  return result;
}
