import {readyPreviewFont} from './preview-font.js';
// Bounded LaTeX-compatible subset. No HTML, macros, file access or arbitrary attributes.
export type MathTableKind='matrix'|'pmatrix'|'bmatrix'|'Bmatrix'|'vmatrix'|'Vmatrix'|'cases'|'aligned';
export type MathNode={kind:'row';children:MathNode[]}|{kind:'mi'|'mn'|'mo';text:string}|{kind:'frac';numerator:MathNode;denominator:MathNode}|{kind:'sqrt';body:MathNode}|{kind:'script';base:MathNode;sub?:MathNode;sup?:MathNode}|{kind:'function';text:string;limits?:true}|{kind:'accent';body:MathNode;mark:string}|{kind:'fenced';left:string;right:string;body:MathNode}|{kind:'root';body:MathNode;index:MathNode}|{kind:'table';environment:MathTableKind;rows:MathNode[][]};
const symbols:Readonly<Record<string,string>>=Object.freeze({alpha:'α',beta:'β',gamma:'γ',delta:'δ',theta:'θ',lambda:'λ',mu:'μ',pi:'π',rho:'ρ',sigma:'σ',phi:'φ',omega:'ω',Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Pi:'Π',Sigma:'Σ',Phi:'Φ',Omega:'Ω',times:'×',cdot:'⋅',pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',neq:'≠',approx:'≈',infty:'∞',sum:'∑',prod:'∏',int:'∫',to:'→',rightarrow:'→',leftarrow:'←',leftrightarrow:'↔',Rightarrow:'⇒',Leftarrow:'⇐',Leftrightarrow:'⇔',mapsto:'↦',partial:'∂',nabla:'∇',in:'∈',notin:'∉',subset:'⊂',subseteq:'⊆',cup:'∪',cap:'∩',forall:'∀',exists:'∃',equiv:'≡',propto:'∝',div:'÷',perp:'⊥',parallel:'∥',ldots:'…',cdots:'⋯',dots:'…',epsilon:'ε',varepsilon:'ϵ',zeta:'ζ',eta:'η',iota:'ι',kappa:'κ',nu:'ν',xi:'ξ',tau:'τ',upsilon:'υ',chi:'χ',psi:'ψ',vartheta:'ϑ',varphi:'ϕ',varrho:'ϱ',varsigma:'ς',Xi:'Ξ',Upsilon:'Υ',Psi:'Ψ'});
const functions=new Set(['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','log','ln','exp','lim','limsup','liminf','min','max','sup','inf','det','gcd']);
const tables=new Set<MathTableKind>(['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases','aligned']);
const limits=new Set(['lim','limsup','liminf','min','max','sup','inf']);
const accents:Readonly<Record<string,string>>=Object.freeze({vec:'→',hat:'^',bar:'¯',overline:'¯',tilde:'~',dot:'˙',ddot:'¨'});
export function parsePreviewMath(source:string):MathNode{return parseMath(source,false);}
/** Independent equations may contain literal LF/CRLF and indentation, but not arbitrary TeX. */
export function parseDisplayMath(source:string):MathNode{return parseMath(source,true);}
function parseMath(source:string,multiline:boolean):MathNode{
  if(typeof source!=='string'||source.length>2048||!source.trim()||/\r(?!\n)/.test(source)||(!multiline&&/[\r\n\t]/.test(source))||!/^[A-Za-z0-9 \r\n\t.,+*/=()[\]|!<>&\-^_{}\\]+$/.test(source))throw RangeError('Unsupported math source');
  let at=0,count=0,cellCount=0;
  const fail=():never=>{throw RangeError('Unsupported or malformed math at offset '+at);};
  const node=<T extends MathNode>(n:T):T=>{if(++count>512)throw RangeError('Math node limit exceeded');return n;};
  const space=()=>{while(at<source.length&&/[ \t\r\n]/.test(source[at]))at++;};
  function group(depth:number):MathNode{
    space();if(source[at++]!=='{')return fail();
    const body=row(depth+1,true);if(source[at++]!=='}')return fail();return body;
  }
  function delimiter(side:'left'|'right'):string{
    space();
    const c=source[at++];
    if(c==='\\'){
      const command=/^[A-Za-z]+/.exec(source.slice(at))?.[0];
      if(command){at+=command.length;const named:Readonly<Record<string,string>>={langle:'⟨',rangle:'⟩',lvert:'|',rvert:'|',lVert:'‖',rVert:'‖',lfloor:'⌊',rfloor:'⌋',lceil:'⌈',rceil:'⌉'};if(Object.hasOwn(named,command)&&command.startsWith(side==='left'?'l':'r'))return named[command];}
      else{const escaped=source[at++];if(escaped==='|'||escaped===(side==='left'?'{':'}'))return escaped==='|'?'‖':escaped;}
      return fail();
    }
    if(c==='.'||c==='|'||(side==='left'?'([':')]') .includes(c??'')&&c)return c==='.'?'':c;
    return fail();
  }
  function environmentName():MathTableKind{
    space();const match=/^\{([A-Za-z]+)\}/.exec(source.slice(at));
    if(!match||!tables.has(match[1] as MathTableKind))return fail();
    at+=match[0].length;return match[1] as MathTableKind;
  }
  function table(depth:number):MathNode{
    if(depth>24)return fail();
    const environment=environmentName(),rows:MathNode[][]=[];
    let cells:MathNode[]=[];
    for(;;){
      if(++cellCount>64||rows.length>=8||cells.length>=8)return fail();
      const cell=row(depth+1,'cell');
      if(cell.kind!=='row'||(!cell.children.length&&!(environment==='aligned'&&cells.length===0)))return fail();
      cells.push(cell);space();
      if(source[at]==='&'){at++;continue;}
      const end=/^\\end(?![A-Za-z])/.test(source.slice(at));
      if(!end&&!source.startsWith('\\\\',at))return fail();
      if((rows.length&&cells.length!==rows[0].length)||(environment==='aligned'&&cells.length!==2)||(environment==='cases'&&cells.length>2))return fail();
      rows.push(cells);cells=[];
      if(end){at+=4;if(environmentName()!==environment)return fail();break;}
      at+=2;
    }
    return node({kind:'table',environment,rows});
  }
  function atom(depth:number):MathNode{
    if(depth>24)return fail();
    space();const c=source[at];if(!c)return fail();
    if(c==='{')return group(depth);
    if(c==='\\'){
      at++;const command=/^[A-Za-z]+/.exec(source.slice(at))?.[0];if(!command)return fail();at+=command.length;
      if(command==='begin')return table(depth);
      if(command==='frac')return node({kind:'frac',numerator:group(depth),denominator:group(depth)});
      if(command==='sqrt'){
        space();
        if(source[at]==='['){at++;const index=row(depth+1,'index');if(source[at++]!==']')return fail();return node({kind:'root',index,body:group(depth)});}
        return node({kind:'sqrt',body:group(depth)});
      }
      if(functions.has(command))return node({kind:'function',text:command,...(limits.has(command)?{limits:true as const}:{})});
      if(Object.hasOwn(accents,command))return node({kind:'accent',body:group(depth),mark:accents[command]});
      if(command==='left'){
        const left=delimiter('left'),body=row(depth+1,'fence');
        if(!/^\\right(?![A-Za-z])/.test(source.slice(at)))return fail();
        at+=6;const right=delimiter('right');
        if(!left&&!right)return fail();
        return node({kind:'fenced',left,right,body});
      }
      if(!Object.hasOwn(symbols,command))return fail();
      return node({kind:/^[A-Za-z]+$/.test(command)&&/^[\u0370-\u03ff]$/.test(symbols[command])?'mi':'mo',text:symbols[command]});
    }
    if(/[0-9]/.test(c)){const number=/^[0-9]+(?:\.[0-9]+)?/.exec(source.slice(at))![0];at+=number.length;return node({kind:'mn',text:number});}
    at++;
    if(/[A-Za-z]/.test(c))return node({kind:'mi',text:c});
    if(/[.,+*/=()[\]|!<>\-]/.test(c))return node({kind:'mo',text:c==='-'?'−':c});
    return fail();
  }
  function scriptArg(depth:number):MathNode{
    space();if(source[at]==='{')return group(depth);
    // TeX's unbraced numeric script consumes exactly one token.
    if(/[0-9]/.test(source[at]??''))return node({kind:'mn',text:source[at++]});
    return atom(depth+1);
  }
  function row(depth:number,grouped:boolean|'index'|'fence'|'cell'):MathNode{
    if(depth>24)return fail();
    const children:MathNode[]=[];space();
    while(at<source.length&&source[at]!=='}'&&!(grouped==='index'&&source[at]===']')&&!(grouped==='fence'&&/^\\right(?![A-Za-z])/.test(source.slice(at)))&&!(grouped==='cell'&&(source[at]==='&'||source.startsWith('\\\\',at)||/^\\end(?![A-Za-z])/.test(source.slice(at))))){
      const base=atom(depth);let sub:MathNode|undefined,sup:MathNode|undefined;
      space();
      while(source[at]==='^'||source[at]==='_'){
        const mark=source[at++];if(mark==='^'){if(sup)return fail();sup=scriptArg(depth);}else{if(sub)return fail();sub=scriptArg(depth);}space();
      }
      children.push(sub||sup?node({kind:'script',base,sub,sup}):base);
    }
    if((!children.length&&grouped!=='cell')||(!grouped&&at!==source.length))return fail();
    return node({kind:'row',children});
  }
  return row(0,false);
}
// Compilation is independent of fonts, document geometry and placement.
// Only successful parser-produced trees are retained; no raw DOM or external AST is accepted.
export interface MathCompilationCache {
  clear():void;
  stats():{entries:number;characters:number;nodes:number;hits:number;misses:number};
}
type CompiledEntry={ast:MathNode;characters:number;nodes:number};
type CompilationState={entries:Map<string,CompiledEntry>;characters:number;nodes:number;hits:number;misses:number};
const compilations=new WeakMap<MathCompilationCache,CompilationState>();
const maxCompiledEntries=512,maxCompiledCharacters=100000,maxCompiledNodes=50000;
export function createMathCompilationCache():MathCompilationCache{
  const state:CompilationState={entries:new Map(),characters:0,nodes:0,hits:0,misses:0};
  const cache:MathCompilationCache={
    clear(){state.entries.clear();state.characters=0;state.nodes=0;state.hits=0;state.misses=0;},
    stats(){return {entries:state.entries.size,characters:state.characters,nodes:state.nodes,hits:state.hits,misses:state.misses};}
  };
  compilations.set(cache,state);return Object.freeze(cache);
}
function freezeTree(value:unknown):number{
  if(value===null||typeof value!=='object')return 0;
  let nodes=Object.hasOwn(value,'kind')?1:0;
  for(const child of Object.values(value))nodes+=freezeTree(child);
  Object.freeze(value);return nodes;
}
function compiledMath(source:string,display:'block'|'inline',cache?:MathCompilationCache):MathNode{
  const parse=display==='block'?parseDisplayMath:parsePreviewMath;
  if(!cache)return parse(source);
  const state=compilations.get(cache);if(!state)throw Error('Invalid math compilation cache');
  // Never coerce an untrusted value into a key. Exact source and mode determine syntax.
  if(typeof source!=='string'||source.length>2048)return parse(source);
  const key=display+':'+source;
  const existing=state.entries.get(key);
  if(existing){state.hits++;state.entries.delete(key);state.entries.set(key,existing);return existing.ast;}
  state.misses++;
  const ast=parse(source),nodes=freezeTree(ast);
  state.entries.set(key,{ast,nodes,characters:source.length});state.nodes+=nodes;state.characters+=source.length;
  while(state.entries.size>maxCompiledEntries||state.characters>maxCompiledCharacters||state.nodes>maxCompiledNodes){
    const oldest=state.entries.keys().next().value!,entry=state.entries.get(oldest)!;
    state.entries.delete(oldest);state.characters-=entry.characters;state.nodes-=entry.nodes;
  }
  return ast;
}
/** Validate with the same compiler used for rendering. No AST is exposed to callers. */
export function validateCompiledMath(source:string,display:'block'|'inline',cache?:MathCompilationCache):void{
  compiledMath(source,display,cache);
}
const NS='http://www.w3.org/1998/Math/MathML';
// Known OpenType MATH families first; never fetch a resource from the formula.
export const mathPreviewFontFamily='"STIX Two Math", "Cambria Math", "Latin Modern Math", "TeX Gyre Termes Math", "DejaVu Math TeX Gyre", math, serif';
/** Auto keeps the legacy system stack; explicit names refer only to a host-registered regular face. */
export type PreviewMathFontFamily='auto'|`BCFont_${string}`;
export function isPreviewMathFontFamily(value:unknown):value is PreviewMathFontFamily{
  return value==='auto'||typeof value==='string'&&/^BCFont_[A-Za-z0-9_]{1,64}$/.test(value);
}
function mathFontCss(family:PreviewMathFontFamily){
  if(!isPreviewMathFontFamily(family))throw RangeError('Invalid math font family');
  return family==='auto'?mathPreviewFontFamily:'"'+family+'"';
}
/** Only engine-produced MathML elements, with textContent for every token. */
export function createPreviewMath(document:Document,source:string,display:'block'|'inline'='block',family:PreviewMathFontFamily='auto',cache?:MathCompilationCache):Element{
  const css=mathFontCss(family);
  return renderCompiledMath(document,compiledMath(source,display,cache),display,css);
}
function renderCompiledMath(document:Document,ast:MathNode,display:'block'|'inline',css:string):Element{
  function fence(text:string,form:'prefix'|'postfix'){
    const token=document.createElementNS(NS,'mo');token.setAttribute('fence','true');token.setAttribute('stretchy','true');token.setAttribute('form',form);token.textContent=text;return token;
  }
  function render(n:MathNode):Element{
    if(n.kind==='table'){
      const table=document.createElementNS(NS,'mtable');
      const aligned=n.environment==='aligned',cases=n.environment==='cases';
      for(const cells of n.rows){
        const tr=document.createElementNS(NS,'mtr');
        for(const [i,cell] of cells.entries()){
          const td=document.createElementNS(NS,'mtd');
          const align=aligned?(i===0?'right':'left'):cases?'left':'center';
          td.setAttribute('columnalign',align);td.setAttribute('style','text-align:'+align+';');
          td.append(render(cell));tr.append(td);
        }
        table.append(tr);
      }
      const fences:Partial<Record<MathTableKind,[string,string]>>={pmatrix:['(',')'],bmatrix:['[',']'],Bmatrix:['{','}'],vmatrix:['|','|'],Vmatrix:['‖','‖'],cases:['{','']};
      const pair=fences[n.environment];
      if(!pair)return table;
      const outer=document.createElementNS(NS,'mrow');outer.append(fence(pair[0],'prefix'),table);if(pair[1])outer.append(fence(pair[1],'postfix'));return outer;
    }
    const stacked=n.kind==='script'&&display==='block'&&(n.base.kind==='function'&&n.base.limits===true||n.base.kind==='mo'&&['∑','∏'].includes(n.base.text));
    const tag=n.kind==='row'||n.kind==='fenced'?'mrow':n.kind==='frac'?'mfrac':n.kind==='sqrt'?'msqrt':n.kind==='root'?'mroot':n.kind==='accent'?'mover':n.kind==='function'?'mi':n.kind==='script'?(stacked?(n.sub&&n.sup?'munderover':n.sub?'munder':'mover'):(n.sub&&n.sup?'msubsup':n.sub?'msub':'msup')):n.kind;
    const el=document.createElementNS(NS,tag);
    if(n.kind==='row')el.append(...n.children.map(render));
    else if(n.kind==='frac')el.append(render(n.numerator),render(n.denominator));
    else if(n.kind==='sqrt')el.append(render(n.body));
    else if(n.kind==='root')el.append(render(n.body),render(n.index));
    else if(n.kind==='function'){el.setAttribute('mathvariant','normal');el.textContent=n.text;}
    else if(n.kind==='accent'){
      el.setAttribute('accent','true');const mark=document.createElementNS(NS,'mo');mark.setAttribute('stretchy',n.mark==='→'||n.mark==='¯'?'true':'false');mark.textContent=n.mark;el.append(render(n.body),mark);
    }else if(n.kind==='fenced'){
      if(n.left)el.append(fence(n.left,'prefix'));el.append(render(n.body));if(n.right)el.append(fence(n.right,'postfix'));
    }
    else if(n.kind==='script'){el.append(render(n.base));if(n.sub)el.append(render(n.sub));if(n.sup)el.append(render(n.sup));}
    else el.textContent=n.text;
    return el;
  }
  const math=document.createElementNS(NS,'math');math.setAttribute('display',display);math.setAttribute('style','font-family:'+css+';font-weight:400;font-style:normal;font-synthesis:none;');math.append(render(ast));return math;
}
/** Check native fraction support in the actual measurement document. */
export function assertNativeMathLayout(document:Document,root:ShadowRoot,family:PreviewMathFontFamily='auto'){
  const probe=document.createElementNS(NS,'math'),frac=document.createElementNS(NS,'mfrac'),a=document.createElementNS(NS,'mn'),b=document.createElementNS(NS,'mn');
  probe.setAttribute('style','font-family:'+mathFontCss(family)+';font-size:20px;font-weight:400;font-synthesis:none;');
  a.textContent='1';b.textContent='2';frac.append(a,b);probe.append(frac);root.append(probe);
  const supported=b.getBoundingClientRect().top>a.getBoundingClientRect().bottom-1;probe.remove();
  if(!supported)throw Error('Native MathML layout unavailable');
}
/** Load the exact registered face before layout and verify representative native math geometry.
 * Font file MATH/cmap verification remains the host's responsibility. */
export async function readyPreviewMathFont(document:Document,root:ShadowRoot,family:PreviewMathFontFamily='auto'){
  mathFontCss(family);
  if(family!=='auto')await readyPreviewFont(document,family,400,'0123456789abcxyzαβ∑∫√()[]{}');
  await document.fonts.ready;
  assertNativeMathLayout(document,root,family);
  if(family==='auto')return;
  const short=createPreviewMath(document,'\\left(x\\right)','block',family);
  const tall=createPreviewMath(document,'\\left(\\frac{a}{\\frac{b}{c}}\\right)','block',family);
  for(const probe of [short,tall]){
    (probe as HTMLElement).style.fontSize='20px';root.append(probe);
  }
  try{
    const a=short.querySelector('mo[fence=true]')!.getBoundingClientRect().height,b=tall.querySelector('mo[fence=true]')!.getBoundingClientRect().height;
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=a+1)throw Error('Registered math font does not support scalable delimiters: '+family);
  }finally{short.remove();tall.remove();}
}
/** Natural display-formula geometry, independent of equation label and paper width.
 * Browser layout remains the authority: cached candidates must pass real geometry checks. */
export interface DisplayMathGeometryCache {
  clear():void;
  stats():{entries:number;characters:number;hits:number;misses:number;fallbacks:number};
}
type NaturalGeometry={widthPx:number;heightPx:number;characters:number};
type MathFontEnvironment={faces:FontFace[];descriptors:string[];scale:number;status:string};
type GeometryState<T extends NaturalGeometry=NaturalGeometry>={document:Document;entries:Map<string,T>;characters:number;hits:number;misses:number;fallbacks:number;epoch:number;environment?:MathFontEnvironment};
const geometries=new WeakMap<DisplayMathGeometryCache,GeometryState>();
const maxGeometryEntries=512,maxGeometryCharacters=100000;
function emptyGeometry<T extends NaturalGeometry>(s:GeometryState<T>){s.entries.clear();s.characters=0;s.epoch++;}
export function createDisplayMathGeometryCache(document:Document):DisplayMathGeometryCache{
  const s:GeometryState={document,entries:new Map(),characters:0,hits:0,misses:0,fallbacks:0,epoch:0};
  const cache:DisplayMathGeometryCache={
    clear(){emptyGeometry(s);s.environment=undefined;s.hits=0;s.misses=0;s.fallbacks=0;},
    stats(){return {entries:s.entries.size,characters:s.characters,hits:s.hits,misses:s.misses,fallbacks:s.fallbacks};}
  };
  geometries.set(cache,s);return Object.freeze(cache);
}
function syncMathEnvironment<T extends NaturalGeometry>(s:GeometryState<T>){
  const faces:FontFace[]=[],descriptors:string[]=[];
  s.document.fonts.forEach(face=>{faces.push(face);descriptors.push(JSON.stringify([face.family,face.style,face.weight,face.stretch,face.unicodeRange,face.status,face.ascentOverride,face.descentOverride,face.lineGapOverride,face.featureSettings,(face as FontFace & {variationSettings?:string}).variationSettings]));});
  const next:MathFontEnvironment={faces,descriptors,scale:s.document.defaultView!.devicePixelRatio,status:s.document.fonts.status};
  const previous=s.environment;
  if(!previous||previous.scale!==next.scale||previous.status!==next.status||previous.faces.length!==faces.length||
    faces.some((f,i)=>f!==previous.faces[i]||descriptors[i]!==previous.descriptors[i])){
    emptyGeometry(s);s.environment=next;
  }
}
function dropGeometry<T extends NaturalGeometry>(s:GeometryState<T>,key:string){const old=s.entries.get(key);if(old){s.entries.delete(key);s.characters-=old.characters;}}
function putGeometry<T extends NaturalGeometry>(s:GeometryState<T>,key:string,entry:T){
  dropGeometry(s,key);s.entries.set(key,Object.freeze(entry));s.characters+=entry.characters;
  while(s.entries.size>maxGeometryEntries||s.characters>maxGeometryCharacters)dropGeometry(s,s.entries.keys().next().value!);
}
export interface MeasuredDisplayMath {element:HTMLElement;width:number;height:number;publicationReady:false}
/** Private native display artifact: the source and exact measured geometry,
 * never the live node. Only successful measurements can create a handle. */
export interface DisplayMathArtifact {readonly kind:'display-math-artifact'}
type DisplayMathArtifactData={document:Document;source:string;availableWidth:number;fontSize:number;equationNumber?:string;family:PreviewMathFontFamily;width:number;height:number;styleText:string};
const artifactData=new WeakMap<DisplayMathArtifact,DisplayMathArtifactData>();
const measuredArtifacts=new WeakMap<MeasuredDisplayMath,DisplayMathArtifact>();
export function displayMathArtifact(measured:MeasuredDisplayMath):DisplayMathArtifact|undefined{return measuredArtifacts.get(measured);}
/** Render identity for a verified native equation, independent of the live DOM.
 * Includes exact measured CSS and numbering, not merely bounding dimensions. */
export function displayMathRenderKey(measured:MeasuredDisplayMath):string|undefined{
  const artifact=measuredArtifacts.get(measured),data=artifact&&artifactData.get(artifact);
  return data?JSON.stringify([data.source,data.availableWidth,data.fontSize,data.equationNumber??null,data.family,data.width,data.height,data.styleText]):undefined;
}
function createDisplayMathElement(document:Document,source:string,width:number,fontSize:number,equationNumber:string|undefined,family:PreviewMathFontFamily,cache?:MathCompilationCache){
  const px=(v:number)=>v*96/25400;
  const element=document.createElement('div');
  element.style.cssText='all:initial;display:flex;justify-content:center;align-items:center;box-sizing:border-box;direction:ltr;writing-mode:horizontal-tb;color:black;font-family:math,serif;';
  element.style.width=px(width)+'px';element.style.fontSize=px(fontSize)+'px';
  const math=createPreviewMath(document,source,'block',family,cache);(math as HTMLElement).style.flex='none';element.append(math);
  let label:HTMLElement|undefined;
  if(equationNumber!==undefined){
    // Equal clearance on both sides preserves the equation's page-center position.
    element.style.position='relative';
    label=document.createElement('span');label.dataset.equationNumber='true';
    label.style.cssText='position:absolute;right:0;top:50%;transform:translateY(-50%);white-space:nowrap;font-family:serif;font-style:normal;font-weight:400;line-height:normal;font-variant-numeric:tabular-nums;';
    label.textContent='('+equationNumber+')';element.append(label);
  }
  return {element,math,label};
}
/** Rebuild a fresh native node from the measured artifact without layout reads.
 * The host must still own the same document/font environment as measurement. */
export function restoreDisplayMathArtifact(document:Document,artifact:DisplayMathArtifact,cache?:MathCompilationCache):MeasuredDisplayMath{
  const deferred=deferDisplayMathArtifact(document,artifact,cache);
  const result:MeasuredDisplayMath={element:deferred.element,width:deferred.width,height:deferred.height,publicationReady:false};
  measuredArtifacts.set(result,artifact);
  return result;
}
/** A transient render handle. Geometry and identity are available immediately,
 * but the native node is allocated only when the renderer reads element.
 * Each handle owns its own node; neither snapshots nor prior pages are mutated. */
export function deferDisplayMathArtifact(document:Document,artifact:DisplayMathArtifact,cache?:MathCompilationCache):MeasuredDisplayMath{
  const data=artifactData.get(artifact);
  if(!data||data.document!==document)throw Error('Display math artifact belongs to another document or is invalid');
  let element:HTMLElement|undefined;
  const result:MeasuredDisplayMath={
    get element(){
      if(!element){
        const created=createDisplayMathElement(document,data.source,data.availableWidth,data.fontSize,data.equationNumber,data.family,cache).element;
        // Preserve exact measured CSS, including shorthand and declaration order.
        created.setAttribute('style',data.styleText);
        element=created;
      }
      return element;
    },
    width:data.width,height:data.height,publicationReady:false
  };
  measuredArtifacts.set(result,artifact);
  return result;
}
/** Measure the exact native MathML node used for final drawing, not a text estimate. */
export async function measureDisplayMath(document:Document,source:string,width:number,fontSize:number,equationNumber?:string,family:PreviewMathFontFamily='auto',cache?:MathCompilationCache,geometryCache?:DisplayMathGeometryCache):Promise<MeasuredDisplayMath>{
  mathFontCss(family);
  if(equationNumber!==undefined&&(typeof equationNumber!=='string'||!/^([1-9][0-9]{0,5})\.([1-9][0-9]{0,5})$/.test(equationNumber)))throw RangeError('Invalid equation number');
  if(!document.body||!document.defaultView||!Number.isSafeInteger(width)||width<1||width>2000000||!Number.isSafeInteger(fontSize)||fontSize<1000||fontSize>30000)throw RangeError('Invalid display math geometry');
  const px=(v:number)=>v*96/25400,um=(v:number)=>Math.ceil(v*25400/96);
  const host=document.createElement('div');host.style.cssText='all:initial;position:absolute;left:-100000px;top:0;visibility:hidden;';
  const root=host.attachShadow({mode:'open'});
  const {element,math,label}=createDisplayMathElement(document,source,width,fontSize,equationNumber,family,cache);
  const state=geometryCache?geometries.get(geometryCache):undefined;
  if(geometryCache&&(!state||state.document!==document))throw Error('Display math geometry cache belongs to another document');
  const key=JSON.stringify([source,fontSize,family]);
  if(state)syncMathEnvironment(state);
  const epoch=state?.epoch;
  // No mutation of the cache occurs while a geometry is being read.
  function measureGeometry(candidate?:NaturalGeometry){
    element.style.minHeight='';
    if(label){
      const labelBox=label.getBoundingClientRect(),natural=candidate??math.getBoundingClientRect(),gap=px(2000);
      const naturalWidth='widthPx' in natural?natural.widthPx:natural.width;
      const naturalHeight='heightPx' in natural?natural.heightPx:natural.height;
      if(!Number.isFinite(labelBox.width)||labelBox.width<=0||labelBox.height<=0||naturalWidth+2*(labelBox.width+gap)>px(width)+.01)throw RangeError('Numbered equation exceeds available centered width');
      element.style.minHeight=Math.max(labelBox.height,naturalHeight)+'px';
    }
    const box=element.getBoundingClientRect(),ink=math.getBoundingClientRect();
    if(!Number.isFinite(ink.width)||!Number.isFinite(box.height)||ink.width<=0||box.height<=0||ink.left<box.left-.1||ink.right>box.right+.1||ink.top<box.top-.1||ink.bottom>box.bottom+.1||um(ink.width)>width)throw RangeError('Display math exceeds available width or has invalid geometry');
    if(label){const q=label.getBoundingClientRect();if(q.left<ink.right+px(2000)-.1||q.right>box.right+.1||q.top<box.top-.1||q.bottom>box.bottom+.1)throw RangeError('Invalid equation number geometry');}
    // Width/height of the actual MathML element must exactly match the candidate.
    // Re-run the full cold validation on disagreement, including font probes.
    if(candidate&&(candidate.widthPx!==ink.width||candidate.heightPx!==ink.height))throw Error('Cached math geometry changed');
    return {width:um(ink.width),height:um(box.height),natural:{widthPx:ink.width,heightPx:ink.height,characters:source.length}};
  }
  root.append(element);document.body.append(host);
  try{
    let measured:ReturnType<typeof measureGeometry>|undefined;
    if(state){
      await document.fonts.ready;syncMathEnvironment(state);
      const candidate=state.epoch===epoch&&document.fonts.status==='loaded'?state.entries.get(key):undefined;
      if(candidate){
        try{
          measured=measureGeometry(candidate);
          state.hits++;state.entries.delete(key);state.entries.set(key,candidate);
        }catch{
          state.fallbacks++;dropGeometry(state,key);
        }
      }
      if(!measured)state.misses++;
    }
    if(!measured){
      element.style.minHeight='';
      await readyPreviewMathFont(document,root,family);
      measured=measureGeometry();
      if(state){
        syncMathEnvironment(state);
        if(state.epoch===epoch&&document.fonts.status==='loaded')putGeometry(state,key,measured.natural);
      }
    }
    element.style.height=px(measured.height)+'px';
    const result:MeasuredDisplayMath={element,width:measured.width,height:measured.height,publicationReady:false};
    const artifact:DisplayMathArtifact=Object.freeze({kind:'display-math-artifact'});
    artifactData.set(artifact,{document,source,availableWidth:width,fontSize,equationNumber,family,width:measured.width,height:measured.height,styleText:element.getAttribute('style')!});
    measuredArtifacts.set(result,artifact);
    return result;
  }finally{host.remove();element.remove();}
}

/** The same unbreakable native atom is used for measurement and paper drawing.
 * The caller supplies its logical source range, not arbitrary HTML. */
export function createInlineMathAtom(document:Document,source:string,family:PreviewMathFontFamily='auto',cache?:MathCompilationCache):HTMLSpanElement{
  const span=document.createElement('span');
  span.dataset.inlineMath='true';
  span.style.cssText='display:inline-block;vertical-align:baseline;white-space:nowrap;line-height:normal;font-family:math,serif;font-style:normal;font-weight:400;font-synthesis:none;';
  span.append(createPreviewMath(document,source,'inline',family,cache));
  return span;
}
export interface InlineMathGeometry {
  readonly widthPx:number;
  readonly heightPx:number;
  /** CSS px from the top of the atom to its baseline. */
  readonly baselinePx:number;
  readonly publicationReady:false;
}
type InlineGeometryEntry=NaturalGeometry&{baselinePx:number};
export interface InlineMathGeometryCache {
  clear():void;
  stats():{entries:number;characters:number;hits:number;misses:number;placements:number;placementFallbacks:number};
}
type InlineGeometryState=GeometryState<InlineGeometryEntry>&{placements:number;placementFallbacks:number};
const inlineGeometries=new WeakMap<InlineMathGeometryCache,InlineGeometryState>();
/** Internal placement accounting; no caller geometry is accepted. */
export function recordInlineMathPlacement(document:Document,cache:InlineMathGeometryCache,accepted:boolean){
  const state=inlineGeometries.get(cache);
  if(!state||state.document!==document)throw Error('Inline math geometry cache belongs to another document');
  if(accepted)state.placements++;else state.placementFallbacks++;
}
export function createInlineMathGeometryCache(document:Document):InlineMathGeometryCache{
  const s:InlineGeometryState={document,entries:new Map(),characters:0,hits:0,misses:0,fallbacks:0,epoch:0,placements:0,placementFallbacks:0};
  const cache:InlineMathGeometryCache={
    clear(){emptyGeometry(s);s.environment=undefined;s.hits=0;s.misses=0;s.placements=0;s.placementFallbacks=0;},
    stats(){return {entries:s.entries.size,characters:s.characters,hits:s.hits,misses:s.misses,placements:s.placements,placementFallbacks:s.placementFallbacks};}
  };
  inlineGeometries.set(cache,s);return Object.freeze(cache);
}
function inlineValue(entry:InlineGeometryEntry):InlineMathGeometry{
  return Object.freeze({widthPx:entry.widthPx,heightPx:entry.heightPx,baselinePx:entry.baselinePx,publicationReady:false});
}
/** Experimental isolated natural-size probe. Does not authorize paragraph layout.
 * Host must invalidate for system font or browser geometry changes outside FontFaceSet.
 * A hit returns only numeric geometry, without creating or measuring a DOM node. */
export async function measureInlineMathGeometry(document:Document,source:string,fontSize:number,family:PreviewMathFontFamily='auto',cache?:MathCompilationCache,geometryCache?:InlineMathGeometryCache):Promise<InlineMathGeometry>{
  mathFontCss(family);
  if(!document.body||!document.defaultView||!document.fonts||!Number.isSafeInteger(fontSize)||fontSize<1000||fontSize>30000)throw RangeError('Invalid inline math geometry');
  if(typeof source!=='string'||source.length>2048)throw RangeError('Unsupported math source');
  const state=geometryCache?inlineGeometries.get(geometryCache):undefined;
  if(geometryCache&&(!state||state.document!==document))throw Error('Inline math geometry cache belongs to another document');
  const key=JSON.stringify([source,fontSize,family]);
  if(state)syncMathEnvironment(state);
  const epoch=state?.epoch;
  if(state){
    await document.fonts.ready;syncMathEnvironment(state);
    const existing=state.epoch===epoch&&document.fonts.status==='loaded'?state.entries.get(key):undefined;
    if(existing){
      state.hits++;state.entries.delete(key);state.entries.set(key,existing);
      return inlineValue(existing);
    }
    state.misses++;
  }
  const host=document.createElement('div');
  host.style.cssText='all:initial;position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;contain:layout style paint;display:block;';
  const root=host.attachShadow({mode:'closed'}),row=document.createElement('div');
  row.style.cssText='all:initial;display:block;width:max-content;white-space:pre;direction:ltr;writing-mode:horizontal-tb;font-family:serif;line-height:normal;';
  row.style.fontSize=fontSize*96/25400+'px';
  const atom=createInlineMathAtom(document,source,family,cache);
  const marker=document.createElement('span');
  marker.style.cssText='all:initial;display:inline-block;vertical-align:baseline;width:0;height:0;padding:0;border:0;margin:0;';
  row.append(atom,marker);root.append(row);document.body.append(host);
  try{
    await readyPreviewMathFont(document,root,family);
    const q=atom.getBoundingClientRect(),ink=atom.firstElementChild!.getBoundingClientRect();
    const baseline=marker.getBoundingClientRect().top-q.top;
    if(![q.width,q.height,ink.width,ink.height,baseline].every(Number.isFinite)||q.width<=0||q.height<=0||ink.width<=0||ink.height<=0||
      baseline<0||baseline>q.height||ink.left<q.left-.5||ink.right>q.right+.5||ink.top<q.top-.5||ink.bottom>q.bottom+.5)
      throw Error('Unsupported isolated inline math geometry');
    const entry={widthPx:q.width,heightPx:q.height,baselinePx:baseline,characters:source.length};
    if(state){
      syncMathEnvironment(state);
      if(state.epoch===epoch&&document.fonts.status==='loaded')putGeometry(state,key,entry);
    }
    return inlineValue(entry);
  }finally{host.remove();}
}
