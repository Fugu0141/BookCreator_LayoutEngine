import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {planMeasuredIntelligentLayout as cold,planMeasuredIntelligentLayoutIncremental as incremental} from '../dist/index.js';
const quantile=(xs,q)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*q)-1];
const summary=xs=>({median:quantile(xs,.5),p95:quantile(xs,.95),min:Math.min(...xs),max:Math.max(...xs)});
function fixture(chapters,step,edited=-1){
 const revision='r'+step;
 return {schemaVersion:1,revision,fingerprint:'fp-'+revision,content:{width:100000,height:100000},
  sections:Array.from({length:chapters},(_,chapter)=>({id:'chapter-'+chapter,startOn:'page',blocks:Array.from({length:4},(_,n)=>({
    kind:'block',origin:{documentId:'chapter-'+chapter,blockKey:'b'+n,revision},
    width:80000,unitHeights:[chapter===edited&&n===1?31000:30000],splitPolicy:'strict'
  }))}))};
}
const options=chapter=>({gap:5000,optimization:{balancePageDepths:true,balancePageRange:{firstPage:chapter*2,lastPage:chapter*2+1}}});
const timed=fn=>{const start=performance.now(),value=fn();return {value,ms:performance.now()-start};};
function run(chapters,kind,pairs=16){
 const middle=Math.floor(chapters/2);
 let previousInput=fixture(chapters,0),previousOptions=options(middle);
 let retained=incremental(previousInput,previousOptions);
 assert.ok(retained.snapshot);
 const samples=[];
 function pair(step,record){
  const chapter=kind==='range-only'?middle+step%2:middle;
  const input=kind==='range-only'?previousInput:fixture(chapters,step,step%2?middle:-1);
  const opt=options(chapter);
  let a,b;
  // Pair the exact same input; alternate order to reduce systematic JIT bias.
  if(step%2){a=timed(()=>cold(input,opt));b=timed(()=>incremental(input,opt,retained.snapshot));}
  else{b=timed(()=>incremental(input,opt,retained.snapshot));a=timed(()=>cold(input,opt));}
  assert.equal(a.value.status,'placed');assert.deepEqual(b.value.result,a.value);
  assert.ok(b.value.snapshot);
  assert.equal(a.value.layout.optimization.score.pageCount,chapters*2);
  assert.equal(a.value.layout.optimization.selected,'page-balance');
  const p=b.value.placement,w=a.value.layout.optimization.targetedBalanceWork;
  assert.equal(p.reusedBlocks+p.placedBlocks,chapters*4);
  assert.ok(p.reusedBlocks>=chapters*4-9);
  if(kind==='range-only')assert.equal(p.reusedBlocks,chapters*4);
  assert.ok(w&&w.reusedBlocks>=chapters*4-9);
  assert.equal(w.reusedBlocks+w.placedBlocks,chapters*4);
  if(record)samples.push({coldMs:a.ms,incrementalMs:b.ms,primaryReused:p.reusedBlocks,primaryPlaced:p.placedBlocks,
    primarySuffixReused:p.reusedSuffixBlocks,trialReused:w.reusedBlocks,trialPlaced:w.placedBlocks});
  retained=b.value;previousInput=input;previousOptions=opt;
 }
 for(let step=1;step<=4;step++)pair(step,false);
 for(let step=5;step<5+pairs;step++)pair(step,true);
 const coldMs=summary(samples.map(x=>x.coldMs)),incrementalMs=summary(samples.map(x=>x.incrementalMs));
 console.log('IL_TARGETED_BENCH '+JSON.stringify({version:1,kind,pages:chapters*2,blocks:chapters*4,pairs,
  coldMs,incrementalMs,medianRatio:coldMs.median/incrementalMs.median,
  minPrimaryReused:Math.min(...samples.map(x=>x.primaryReused)),maxPrimaryPlaced:Math.max(...samples.map(x=>x.primaryPlaced)),
  minTrialReused:Math.min(...samples.map(x=>x.trialReused)),samples}));
}
for(const chapters of [120,500])for(const kind of ['local-edit','range-only'])run(chapters,kind);
