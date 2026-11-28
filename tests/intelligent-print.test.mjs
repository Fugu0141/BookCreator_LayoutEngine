import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeasuredIntelligentLayout,projectIntelligentMeasuredPlan,createIntelligentPrintTicket,assertIntelligentPrintTicketMatchesPlan} from '../dist/index.js';
const paper={width:100000,height:100000,top:10000,bottom:10000,inner:10000,outer:10000,firstSide:'right'};
const input={schemaVersion:1,revision:'r',fingerprint:'fp',content:{width:80000,height:80000},sections:[{id:'s',startOn:'continuous',blocks:[{kind:'block',origin:{documentId:'d',blockKey:'a',revision:'r'},width:20000,unitHeights:[10000],splitPolicy:'strict'}]}]};
function preview(options={}){const intelligentLayout=planMeasuredIntelligentLayout(input,options);return {intelligentLayout,plan:projectIntelligentMeasuredPlan(intelligentLayout),publicationReady:false};}
test('IL print ticket round trips and includes blank pages and occupied geometry',()=>{
 const p=preview({intents:[{documentId:'d',blockKey:'a',placement:{fixed:{page:2,x:1000,y:2000}}}]});
 const t=createIntelligentPrintTicket(p,paper);
 assert.deepEqual(JSON.parse(JSON.stringify(t)),t);assert.equal(JSON.parse(t.planSignature)[2].length,3);
 assert.equal(t.publicationReady,false);assert.ok(Object.isFrozen(t.paper));
 const ordinary=createIntelligentPrintTicket(preview(),paper);
 const occupied=createIntelligentPrintTicket(preview({intents:[{documentId:'d',blockKey:'a',placement:{sizeConstraints:{minHeight:30000}}}]}),paper);
 assert.equal(ordinary.planSignature,occupied.planSignature);assert.notEqual(ordinary.layoutSignature,occupied.layoutSignature);
});
test('mismatched or stale source geometry is rejected',()=>{
 for(const mutate of [p=>p.plan.pages[0].fragments[0].rect.x=1,p=>p.plan.revision='old',p=>p.plan.pages[0].fragments[0].origin.blockKey='other',p=>p.plan.pages[0].fragments[0].unitEnd=2,p=>p.plan.completeness='partial']){
  const p=preview();mutate(p);assert.throws(()=>createIntelligentPrintTicket(p,paper));
 }
 assert.throws(()=>createIntelligentPrintTicket({...preview(),intelligentLayout:undefined},paper));
 assert.throws(()=>createIntelligentPrintTicket(preview(),{...paper,width:100}));
});

test('host can preflight a transported ticket against its approved full plan without DOM',()=>{
 const p=preview();
 const ticket=JSON.parse(JSON.stringify(createIntelligentPrintTicket(p,paper)));
 assert.doesNotThrow(()=>assertIntelligentPrintTicketMatchesPlan(ticket,p.plan,paper));
 for(const bad of [null,[],{}, {...ticket,schemaVersion:2}, {...ticket,publicationReady:true},
  {...ticket,revision:'old'}, {...ticket,fingerprint:'old'}, {...ticket,planSignature:'bad'},
  {...ticket,layoutSignature:''}, {...ticket,paper:null}, {...ticket,paper:{...paper,firstSide:'left'}}])
   assert.throws(()=>assertIntelligentPrintTicketMatchesPlan(bad,p.plan,paper));
 for(const mutate of [p=>p.revision='old',p=>p.fingerprint='old',p=>p.completeness='partial',
  p=>p.pages[0].fragments[0].rect.x=1,p=>p.pages[0].fragments[0].origin.blockKey='other']){
   const changed=structuredClone(p.plan);mutate(changed);
   assert.throws(()=>assertIntelligentPrintTicketMatchesPlan(ticket,changed,paper));
 }
 assert.throws(()=>assertIntelligentPrintTicketMatchesPlan(ticket,p.plan,{...paper,firstSide:'left'}));
 // A plan-only check cannot authorize occupied-area changes. The renderer
 // must still compare the layout signature against the recalculated IL.
 assert.doesNotThrow(()=>assertIntelligentPrintTicketMatchesPlan({...ticket,layoutSignature:'different'},p.plan,paper));
});
