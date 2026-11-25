import {anchoredOffset, distributeFill, layoutFlow, type Rect, type Size} from './index.js';
export type Dimension=number|'auto'|'fill';
export interface TreeNode {id:string;type:'leaf'|'row'|'column'|'stack'|'canvas';width:Dimension;height:Dimension;natural?:Size;gap?:number;children?:readonly TreeNode[];role?:'flow'|'overlay';anchorX?:'start'|'center'|'end';anchorY?:'start'|'center'|'end';x?:number;y?:number}
export interface PlacedNode {id:string;rect:Rect;children:PlacedNode[]}
const len=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw new RangeError('Invalid dimension');return n;};
// Premeasured leaves; no text shaping, percentage sizes or pagination yet.
export function layoutTree(root:TreeNode,available:Size):PlacedNode {
  len(available.width);len(available.height);
  const ids=new Set<string>();let count=0;
  function visit(n:TreeNode,depth:number){if(depth>64||++count>10000||!n.id||ids.has(n.id))throw new Error('Invalid tree, duplicate ID or resource limit');ids.add(n.id);if(!['leaf','row','column','stack','canvas'].includes(n.type))throw new Error('Unsupported node type');for(const d of [n.width,n.height])if(d!=='auto'&&d!=='fill')len(d);if(n.gap!==undefined)len(n.gap);if(n.type==='leaf'&&n.children?.length)throw new Error('Leaf cannot have children');for(const c of n.children??[])visit(c,depth+1);}
  visit(root,0);
  function size(n:TreeNode,cap:Size,forced:Partial<Size>={}):PlacedNode {
    const resolve=(d:Dimension,k:keyof Size)=>forced[k]??(d==='fill'?cap[k]:d==='auto'?undefined:len(d));
    let w=resolve(n.width,'width'),h=resolve(n.height,'height');
    const limit={width:w??cap.width,height:h??cap.height};
    if(limit.width>cap.width||limit.height>cap.height)throw new RangeError('Node exceeds available space');
    const kids=n.children??[];let children:PlacedNode[]=[];
    if(n.type==='leaf') {w??=len(n.natural?.width??0);h??=len(n.natural?.height??0);}
    else if(n.type==='row'||n.type==='column'){
      const main=n.type==='row'?'width':'height',cross=main==='width'?'height':'width',gap=n.gap??0;
      const mainKnown=main==='width'?w:h,crossKnown=cross==='width'?w:h;
      const fill=kids.filter(c=>c[main]==='fill');if(fill.length&&mainKnown===undefined)throw new Error('Fill on auto main axis');
      const measured=new Map<TreeNode,PlacedNode>();let occupied=len(gap*Math.max(0,kids.length-1));
      const measure=(c:TreeNode,force:Partial<Size>={})=>size(c,limit,force);
      for(const c of kids)if(c[main]!=='fill'&&!(crossKnown===undefined&&c[cross]==='fill')){const p=measure(c);measured.set(c,p);occupied=len(occupied+p.rect[main]);}
      // Cross-axis fill in an auto container is supported for fixed-main decorative leaves.
      const deferred=kids.filter(c=>c[main]!=='fill'&&crossKnown===undefined&&c[cross]==='fill');
      for(const c of deferred){if(c.type!=='leaf'||typeof c[main]!=='number')throw new Error('Unresolved cross-axis fill');occupied=len(occupied+c[main]);}
      if(occupied>limit[main])throw new RangeError('Flow overflow');
      if(fill.length){const portions=distributeFill(limit[main]-occupied,fill.length);fill.forEach((c,i)=>{if(crossKnown===undefined&&c[cross]==='fill')throw new Error('Unresolved cross-axis fill');measured.set(c,measure(c,{[main]:portions[i]}));});}
      const actualCross=crossKnown??Math.max(0,...Array.from(measured.values(),p=>p.rect[cross]));
      if(deferred.length&&actualCross===0)throw new Error('No cross-axis measurement basis');
      for(const c of deferred)measured.set(c,measure(c,{[cross]:actualCross}));
      children=kids.map(c=>measured.get(c)!);
      const actualMain=len(children.reduce((sum,p)=>sum+p.rect[main],gap*Math.max(0,kids.length-1)));
      w??=main==='width'?actualMain:actualCross;h??=main==='height'?actualMain:actualCross;
      const rects=layoutFlow(n.type,children.map(c=>c.rect),gap,{width:w,height:h});children=children.map((p,i)=>({...p,rect:rects[i]}));
    }else{
      if(n.type==='canvas'&&(w===undefined||h===undefined))throw new Error('Canvas needs resolved dimensions');
      const flow=n.type==='stack'?kids.filter(c=>c.role!=='overlay'):[];
      for(const c of flow){if((w===undefined&&c.width==='fill')||(h===undefined&&c.height==='fill'))throw new Error('Cyclic stack fill');children.push(size(c,limit));}
      if((w===undefined||h===undefined)&&!flow.length)throw new Error('Stack needs measurement basis');
      w??=Math.max(0,...children.map(c=>c.rect.width));h??=Math.max(0,...children.map(c=>c.rect.height));
      const flowResults=new Map(flow.map((c,i)=>[c,children[i]]));
      children=kids.map(c=>{const p=flowResults.get(c)??size(c,{width:w!,height:h!});const x=anchoredOffset(w!,p.rect.width,c.anchorX??'start',c.x??0),y=anchoredOffset(h!,p.rect.height,c.anchorY??'start',c.y??0);if(x<0||y<0||x+p.rect.width>w!||y+p.rect.height>h!)throw new RangeError('Stack/canvas overflow');return {...p,rect:{...p.rect,x,y}};});
    }
    if(w>cap.width||h>cap.height)throw new RangeError('Node overflow');
    return {id:n.id,rect:{x:0,y:0,width:len(w),height:len(h)},children};
  }
  return size(root,available);
}
