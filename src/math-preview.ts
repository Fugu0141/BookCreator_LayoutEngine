// Bounded LaTeX-compatible subset. No HTML, macros, file access or arbitrary attributes.
export type MathNode={kind:'row';children:MathNode[]}|{kind:'mi'|'mn'|'mo';text:string}|{kind:'frac';numerator:MathNode;denominator:MathNode}|{kind:'sqrt';body:MathNode}|{kind:'script';base:MathNode;sub?:MathNode;sup?:MathNode};
const symbols:Readonly<Record<string,string>>=Object.freeze({alpha:'α',beta:'β',gamma:'γ',delta:'δ',theta:'θ',lambda:'λ',mu:'μ',pi:'π',rho:'ρ',sigma:'σ',phi:'φ',omega:'ω',Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Pi:'Π',Sigma:'Σ',Phi:'Φ',Omega:'Ω',times:'×',cdot:'⋅',pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',neq:'≠',approx:'≈',infty:'∞',sum:'∑',prod:'∏',int:'∫'});
export function parsePreviewMath(source:string):MathNode{
  if(typeof source!=='string'||source.length>2048||!source.trim()||!/^[A-Za-z0-9 .,+*/=()|!<>\-^_{}\\]+$/.test(source))throw RangeError('Unsupported math source');
  let at=0,count=0;
  const fail=():never=>{throw RangeError('Unsupported or malformed math at offset '+at);};
  const node=<T extends MathNode>(n:T):T=>{if(++count>512)throw RangeError('Math node limit exceeded');return n;};
  const space=()=>{while(source[at]===' ')at++;};
  function group(depth:number):MathNode{
    space();if(source[at++]!=='{')return fail();
    const body=row(depth+1,true);if(source[at++]!=='}')return fail();return body;
  }
  function atom(depth:number):MathNode{
    if(depth>24)return fail();
    space();const c=source[at];if(!c)return fail();
    if(c==='{')return group(depth);
    if(c==='\\'){
      at++;const command=/^[A-Za-z]+/.exec(source.slice(at))?.[0];if(!command)return fail();at+=command.length;
      if(command==='frac')return node({kind:'frac',numerator:group(depth),denominator:group(depth)});
      if(command==='sqrt')return node({kind:'sqrt',body:group(depth)});
      if(!Object.hasOwn(symbols,command))return fail();
      return node({kind:/^[A-Za-z]+$/.test(command)&&/^[\u0370-\u03ff]$/.test(symbols[command])?'mi':'mo',text:symbols[command]});
    }
    if(/[0-9]/.test(c)){const number=/^[0-9]+(?:\.[0-9]+)?/.exec(source.slice(at))![0];at+=number.length;return node({kind:'mn',text:number});}
    at++;
    if(/[A-Za-z]/.test(c))return node({kind:'mi',text:c});
    if(/[.,+*/=()|!<>\-]/.test(c))return node({kind:'mo',text:c==='-'?'−':c});
    return fail();
  }
  function scriptArg(depth:number):MathNode{
    space();if(source[at]==='{')return group(depth);
    // TeX's unbraced numeric script consumes exactly one token.
    if(/[0-9]/.test(source[at]??''))return node({kind:'mn',text:source[at++]});
    return atom(depth+1);
  }
  function row(depth:number,grouped:boolean):MathNode{
    if(depth>24)return fail();
    const children:MathNode[]=[];space();
    while(at<source.length&&source[at]!=='}'){
      const base=atom(depth);let sub:MathNode|undefined,sup:MathNode|undefined;
      space();
      while(source[at]==='^'||source[at]==='_'){
        const mark=source[at++];if(mark==='^'){if(sup)return fail();sup=scriptArg(depth);}else{if(sub)return fail();sub=scriptArg(depth);}space();
      }
      children.push(sub||sup?node({kind:'script',base,sub,sup}):base);
    }
    if(!children.length||(!grouped&&at!==source.length))return fail();
    return node({kind:'row',children});
  }
  return row(0,false);
}
const NS='http://www.w3.org/1998/Math/MathML';
/** Only engine-produced MathML elements, with textContent for every token. */
export function createPreviewMath(document:Document,source:string,display:'block'|'inline'='block'):Element{
  const ast=parsePreviewMath(source);
  function render(n:MathNode):Element{
    const tag=n.kind==='row'?'mrow':n.kind==='frac'?'mfrac':n.kind==='sqrt'?'msqrt':n.kind==='script'?(n.sub&&n.sup?'msubsup':n.sub?'msub':'msup'):n.kind;
    const el=document.createElementNS(NS,tag);
    if(n.kind==='row')el.append(...n.children.map(render));
    else if(n.kind==='frac')el.append(render(n.numerator),render(n.denominator));
    else if(n.kind==='sqrt')el.append(render(n.body));
    else if(n.kind==='script'){el.append(render(n.base));if(n.sub)el.append(render(n.sub));if(n.sup)el.append(render(n.sup));}
    else el.textContent=n.text;
    return el;
  }
  const math=document.createElementNS(NS,'math');math.setAttribute('display',display);math.append(render(ast));return math;
}
/** Check native fraction support in the actual measurement document. */
export function assertNativeMathLayout(document:Document,root:ShadowRoot){
  const probe=document.createElementNS(NS,'math'),frac=document.createElementNS(NS,'mfrac'),a=document.createElementNS(NS,'mn'),b=document.createElementNS(NS,'mn');
  a.textContent='1';b.textContent='2';frac.append(a,b);probe.append(frac);root.append(probe);
  const supported=b.getBoundingClientRect().top>a.getBoundingClientRect().bottom-1;probe.remove();
  if(!supported)throw Error('Native MathML layout unavailable');
}
export interface MeasuredDisplayMath {element:HTMLElement;width:number;height:number;publicationReady:false}
/** Measure the exact native MathML node used for final drawing, not a text estimate. */
export async function measureDisplayMath(document:Document,source:string,width:number,fontSize:number):Promise<MeasuredDisplayMath>{
  if(!document.body||!document.defaultView||!Number.isSafeInteger(width)||width<1||width>2000000||!Number.isSafeInteger(fontSize)||fontSize<1000||fontSize>30000)throw RangeError('Invalid display math geometry');
  const px=(v:number)=>v*96/25400,um=(v:number)=>Math.ceil(v*25400/96);
  const host=document.createElement('div');host.style.cssText='all:initial;position:absolute;left:-100000px;top:0;visibility:hidden;';
  const root=host.attachShadow({mode:'open'}),element=document.createElement('div');
  element.style.cssText='all:initial;display:flex;justify-content:center;align-items:center;box-sizing:border-box;direction:ltr;writing-mode:horizontal-tb;color:black;font-family:math,serif;';
  element.style.width=px(width)+'px';element.style.fontSize=px(fontSize)+'px';
  const math=createPreviewMath(document,source);math.setAttribute('style','flex:none;');element.append(math);root.append(element);document.body.append(host);
  try{
    await document.fonts.ready;
    // Detect actual fraction layout, rather than silently accepting unsupported MathML.
    assertNativeMathLayout(document,root);
    const box=element.getBoundingClientRect(),ink=math.getBoundingClientRect();
    if(!Number.isFinite(ink.width)||!Number.isFinite(box.height)||ink.width<=0||box.height<=0||ink.left<box.left-.1||ink.right>box.right+.1||ink.top<box.top-.1||ink.bottom>box.bottom+.1||um(ink.width)>width)throw RangeError('Display math exceeds available width or has invalid geometry');
    const height=um(box.height);
    element.style.height=px(height)+'px';
    return {element,width:um(ink.width),height,publicationReady:false};
  }finally{host.remove();element.remove();}
}
