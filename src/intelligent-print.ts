import {createPlainTextPagePreview,type TextPagePreview,type TextPagePreviewOptions} from './browser-lines.js';
import {projectIntelligentMeasuredPlan,type IntelligentMeasuredResult} from './intelligent-measured.js';
import type {MeasuredPagePlan,Origin} from './pagination.js';
import type {Rect} from './index.js';
type Paper=NonNullable<TextPagePreviewOptions['paper']>;
type Placed=Extract<IntelligentMeasuredResult,{status:'placed'}>;
/** Serializable comparison record for a host-approved immutable trial input.
 * Not a cryptographic seal, a PDF validator, or publication authorization. */
export interface IntelligentPrintTicket{
  readonly schemaVersion:1;
  readonly revision:string;
  readonly fingerprint:string;
  readonly paper:Readonly<Paper>;
  readonly planSignature:string;
  readonly layoutSignature:string;
  readonly publicationReady:false;
}
const origin=(o:Origin)=>[o.documentId,o.revision,o.blockKey,o.persistentId??null,o.range?[o.range.start,o.range.end]:null];
const rect=(r:Rect)=>[r.x,r.y,r.width,r.height];
const paperKey=(p:Paper)=>JSON.stringify([p.width,p.height,p.top,p.bottom,p.inner,p.outer,p.firstSide]);
function validatePaper(p:Paper){
  if(!p||![p.width,p.height].every(n=>Number.isSafeInteger(n)&&n>=30000&&n<=300000)||
    ![p.top,p.bottom,p.inner,p.outer].every(n=>Number.isSafeInteger(n)&&n>=0)||
    p.inner+p.outer>=p.width||p.top+p.bottom>=p.height||!['left','right'].includes(p.firstSide))
    throw RangeError('Invalid IL trial paper');
}
function planSignature(p:MeasuredPagePlan,paper:Paper):string{
  if(!p||p.schemaVersion!==1||p.measurement!=='premeasured'||p.completeness!=='full'||p.publicationReady!==false||
    !p.revision||!p.fingerprint||!Array.isArray(p.pages)||p.pages.length<1||p.pages.length>512||
    !Array.isArray(p.diagnostics)||p.diagnostics.some(d=>d.severity==='error'))throw Error('Invalid IL trial plan');
  const width=paper.width-paper.inner-paper.outer,height=paper.height-paper.top-paper.bottom;
  let count=0;
  return JSON.stringify([p.revision,p.fingerprint,p.pages.map((page,i)=>{
    if(page.index!==i||!Array.isArray(page.fragments))throw Error('Invalid IL trial page sequence');
    return [i,page.fragments.map(f=>{
      const r=f.rect;
      if(++count>10000||![r.x,r.y,r.width,r.height,f.unitStart,f.unitEnd,f.continuationIndex].every(n=>Number.isSafeInteger(n)&&n>=0)||
        r.width===0||r.height===0||r.x+r.width>width||r.y+r.height>height||f.unitEnd<=f.unitStart)
        throw Error('Invalid IL trial fragment geometry');
      return [origin(f.origin),rect(r),f.unitStart,f.unitEnd,f.continuationIndex,f.breakReason];
    })];
  }),p.diagnostics.map(d=>[d.code,d.severity,d.message,d.origin?origin(d.origin):null])]);
}
function layoutSignature(il:Placed):string{
  return JSON.stringify([il.revision,il.fingerprint,il.fragments.map(f=>[
    origin(f.origin),f.unitStart,f.unitEnd,f.continuationIndex,f.sourceBreakReason,
    f.placement.id,f.placement.page,rect(f.placement.rect),
    f.placement.occupiedRect?rect(f.placement.occupiedRect):null,f.placement.fixed,f.placement.preference??null
  ])]);
}
/** Accept full or retained preview metadata; never read a sparse DOM as paper. */
export function createIntelligentPrintTicket(preview:Pick<TextPagePreview,'plan'|'intelligentLayout'|'publicationReady'>,paper:Paper):IntelligentPrintTicket{
  validatePaper(paper);
  const il=preview.intelligentLayout;
  if(preview.publicationReady!==false||!il||il.status!=='placed'||il.publicationReady!==false)
    throw Error('IL trial printing requires a successful IL preview');
  const signature=planSignature(preview.plan,paper);
  if(signature!==planSignature(projectIntelligentMeasuredPlan(il),paper))
    throw Error('IL preview and measured page plan disagree');
  return Object.freeze({schemaVersion:1,revision:preview.plan.revision,fingerprint:preview.plan.fingerprint,
    paper:Object.freeze({...paper}),planSignature:signature,layoutSignature:layoutSignature(il),publicationReady:false});
}
/** Check the IPC comparison record without a browser or measurement work.
 * This validates the approved full plan and paper, not the saved content,
 * resource identity or occupied layout. The print renderer still verifies
 * layoutSignature against a fresh IL calculation before producing a PDF. */
export function assertIntelligentPrintTicketMatchesPlan(ticket:unknown,plan:MeasuredPagePlan,paper:Paper):asserts ticket is IntelligentPrintTicket{
  validatePaper(paper);
  validateTicketHeader(ticket);
  if(ticket.revision!==plan?.revision||ticket.fingerprint!==plan?.fingerprint)
    throw Error('Stale IL trial print ticket');
  if(paperKey(ticket.paper)!==paperKey(paper))throw Error('IL trial paper changed');
  if(ticket.planSignature!==planSignature(plan,paper))
    throw Error('IL trial ticket differs from the approved page plan');
}
function validateTicketHeader(ticket:unknown):asserts ticket is IntelligentPrintTicket{
  if(!ticket||typeof ticket!=='object'||Array.isArray(ticket))throw Error('Invalid IL trial print ticket');
  const t=ticket as Partial<IntelligentPrintTicket>;
  if(t.schemaVersion!==1||t.publicationReady!==false||
    typeof t.revision!=='string'||!t.revision||typeof t.fingerprint!=='string'||!t.fingerprint||
    typeof t.planSignature!=='string'||!t.planSignature||typeof t.layoutSignature!=='string'||!t.layoutSignature||!t.paper)
    throw Error('Invalid IL trial print ticket');
  validatePaper(t.paper);
}

/** Reproduce a complete detached preview in the dedicated print Document.
 * The existing BookCreator print adapter consumes this DOM; it must still
 * verify saved input, resources/fonts, currentness and the resulting PDF. */
export async function createVerifiedIntelligentPrintPreview(document:Document,options:TextPagePreviewOptions,ticket:IntelligentPrintTicket):Promise<TextPagePreview>{
  validateTicketHeader(ticket);
  if(options.intelligentLayout===undefined||!options.paper||ticket.revision!==options.revision||ticket.fingerprint!==options.fingerprint)
    throw Error('Stale or invalid IL trial print ticket');
  validatePaper(options.paper);
  if(paperKey(ticket.paper)!==paperKey(options.paper))throw Error('IL trial paper changed');
  const expectedPlan=ticket.planSignature,expectedLayout=ticket.layoutSignature,paper={...ticket.paper};
  // No sparse DOM or host-owned measurement caches are used for printing.
  const preview=await createPlainTextPagePreview(document,{...options,paper:{...options.paper},
    pageCache:undefined,measurementCache:undefined,paragraphCache:undefined,mathCache:undefined,
    displayMathCache:undefined,inlineMathCache:options.inlineMathCache});
  const actual=createIntelligentPrintTicket(preview,paper);
  if(actual.planSignature!==expectedPlan||actual.layoutSignature!==expectedLayout)
    throw Error('IL print layout differs from the confirmed preview');
  return preview;
}

/** Single entry for a host's trial print adapter. Never silently fall back
 * from an IL-enabled request to the legacy planner or ignore an IL ticket.
 * Host must still validate the saved input and its expected full PagePlan,
 * keep options immutable, and inspect the generated PDF before saving. */
export async function createTrialPrintPreviewForLayout(document:Document,options:TextPagePreviewOptions,
  ticket?:IntelligentPrintTicket):Promise<TextPagePreview>{
  const enabled=options.intelligentLayout!==undefined;
  if(enabled!==(ticket!==undefined))throw Error('IL trial print mode and ticket must match');
  if(enabled)return createVerifiedIntelligentPrintPreview(document,options,ticket!);
  return createPlainTextPagePreview(document,options);
}
