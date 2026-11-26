import {readyPreviewFont} from './preview-font.js';
// Bounded LaTeX-compatible subset. No HTML, macros, file access or arbitrary attributes.
export type MathTableKind='matrix'|'pmatrix'|'bmatrix'|'Bmatrix'|'vmatrix'|'Vmatrix'|'cases'|'aligned';
export type MathNode={kind:'row';children:MathNode[]}|{kind:'mi'|'mn'|'mo';text:string}|{kind:'frac';numerator:MathNode;denominator:MathNode}|{kind:'sqrt';body:MathNode}|{kind:'script';base:MathNode;sub?:MathNode;sup?:MathNode}|{kind:'function';text:string;limits?:true}|{kind:'accent';body:MathNode;mark:string}|{kind:'fenced';left:string;right:string;body:MathNode}|{kind:'root';body:MathNode;index:MathNode}|{kind:'table';environment:MathTableKind;rows:MathNode[][]};
const symbols:Readonly<Record<string,string>>=Object.freeze({alpha:'α',beta:'β',gamma:'γ',delta:'δ',theta:'θ',lambda:'λ',mu:'μ',pi:'π',rho:'ρ',sigma:'σ',phi:'φ',omega:'ω',Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Pi:'Π',Sigma:'Σ',Phi:'Φ',Omega:'Ω',times:'×',cdot:'⋅',pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',neq:'≠',approx:'≈',infty:'∞',sum:'∑',prod:'∏',int:'∫',to:'→',rightarrow:'→',leftarrow:'←',leftrightarrow:'↔',Rightarrow:'⇒',Leftarrow:'⇐',Leftrightarrow:'⇔',mapsto:'↦',partial:'∂',nabla:'∇',in:'∈',notin:'∉',subset:'⊂',subseteq:'⊆',cup:'∪',cap:'∩',forall:'∀',exists:'∃',equiv:'≡',propto:'∝',div:'÷',perp:'⊥',parallel:'∥',ldots:'…',cdots:'⋯',dots:'…',epsilon:'ε',varepsilon:'ϵ',zeta:'ζ',eta:'η',iota:'ι',kappa:'κ',nu:'ν',xi:'ξ',tau:'τ',upsilon:'υ',chi:'χ',psi:'ψ',vartheta:'ϑ',varphi:'ϕ',varrho:'ϱ',varsigma:'ς',Xi:'Ξ',Upsilon:'Υ',Psi:'Ψ'});
const functions=new Set(['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','log','ln','exp','lim','limsup','liminf','min','max','sup','inf','det','gcd']);
const tables=new Set<MathTableKind>(['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases','aligned']);
const limits=new Set(['lim','limsup','liminf','min','max','sup','inf']);
const accents:Readonly<Record<string,string>>=Object.freeze({vec:'→',hat:'^',bar:'¯',overline:'¯',tilde:'~',dot:'˙',ddot:'¨'});
export function parsePreviewMath(source:string):MathNode{
  if(typeof source!=='string'||source.length>2048||!source.trim()||!/^[A-Za-z0-9 .,+*/=()[\]|!<>&\-^_{}\\]+$/.test(source))throw RangeError('Unsupported math source');
  let at=0,count=0,cellCount=0;
  const fail=():never=>{throw RangeError('Unsupported or malformed math at offset '+at);};
  const node=<T extends MathNode>(n:T):T=>{if(++count>512)throw RangeError('Math node limit exceeded');return n;};
  const space=()=>{while(source[at]===' ')at++;};
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
export function createPreviewMath(document:Document,source:string,display:'block'|'inline'='block',family:PreviewMathFontFamily='auto'):Element{
  const css=mathFontCss(family);
  const ast=parsePreviewMath(source);
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
export interface MeasuredDisplayMath {element:HTMLElement;width:number;height:number;publicationReady:false}
/** Measure the exact native MathML node used for final drawing, not a text estimate. */
export async function measureDisplayMath(document:Document,source:string,width:number,fontSize:number,equationNumber?:string,family:PreviewMathFontFamily='auto'):Promise<MeasuredDisplayMath>{
  mathFontCss(family);
  if(equationNumber!==undefined&&(typeof equationNumber!=='string'||!/^([1-9][0-9]{0,5})\.([1-9][0-9]{0,5})$/.test(equationNumber)))throw RangeError('Invalid equation number');
  if(!document.body||!document.defaultView||!Number.isSafeInteger(width)||width<1||width>2000000||!Number.isSafeInteger(fontSize)||fontSize<1000||fontSize>30000)throw RangeError('Invalid display math geometry');
  const px=(v:number)=>v*96/25400,um=(v:number)=>Math.ceil(v*25400/96);
  const host=document.createElement('div');host.style.cssText='all:initial;position:absolute;left:-100000px;top:0;visibility:hidden;';
  const root=host.attachShadow({mode:'open'}),element=document.createElement('div');
  element.style.cssText='all:initial;display:flex;justify-content:center;align-items:center;box-sizing:border-box;direction:ltr;writing-mode:horizontal-tb;color:black;font-family:math,serif;';
  element.style.width=px(width)+'px';element.style.fontSize=px(fontSize)+'px';
  const math=createPreviewMath(document,source,'block',family);(math as HTMLElement).style.flex='none';element.append(math);
  let label:HTMLElement|undefined;
  if(equationNumber!==undefined){
    // Equal clearance on both sides preserves the equation's page-center position.
    element.style.position='relative';
    label=document.createElement('span');label.dataset.equationNumber='true';
    label.style.cssText='position:absolute;right:0;top:50%;transform:translateY(-50%);white-space:nowrap;font-family:serif;font-style:normal;font-weight:400;line-height:normal;font-variant-numeric:tabular-nums;';
    label.textContent='('+equationNumber+')';element.append(label);
  }
  root.append(element);document.body.append(host);
  try{
    await readyPreviewMathFont(document,root,family);
    if(label){
      const labelBox=label.getBoundingClientRect(),mathBox=math.getBoundingClientRect(),gap=px(2000);
      if(!Number.isFinite(labelBox.width)||labelBox.width<=0||labelBox.height<=0||mathBox.width+2*(labelBox.width+gap)>px(width)+.01)throw RangeError('Numbered equation exceeds available centered width');
      element.style.minHeight=Math.max(labelBox.height,mathBox.height)+'px';
    }
    const box=element.getBoundingClientRect(),ink=math.getBoundingClientRect();
    if(!Number.isFinite(ink.width)||!Number.isFinite(box.height)||ink.width<=0||box.height<=0||ink.left<box.left-.1||ink.right>box.right+.1||ink.top<box.top-.1||ink.bottom>box.bottom+.1||um(ink.width)>width)throw RangeError('Display math exceeds available width or has invalid geometry');
    if(label){const q=label.getBoundingClientRect();if(q.left<ink.right+px(2000)-.1||q.right>box.right+.1||q.top<box.top-.1||q.bottom>box.bottom+.1)throw RangeError('Invalid equation number geometry');}
    const height=um(box.height);
    element.style.height=px(height)+'px';
    return {element,width:um(ink.width),height,publicationReady:false};
  }finally{host.remove();element.remove();}
}
