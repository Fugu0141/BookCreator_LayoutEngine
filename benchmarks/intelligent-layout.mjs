import {performance} from 'node:perf_hooks';
import {planIntelligentLayout,planIntelligentLayoutIncremental} from '../dist/index.js';
const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const time=fn=>{const start=performance.now(),result=fn();return {ms:performance.now()-start,result};};
for(const count of [100,1000,10000]){
 const blocks=Array.from({length:count},(_,i)=>({id:'b'+i,size:{width:100000,height:10000},startNewPage:i%20===0}));
 const input={revision:'base',content:{width:100000,height:250000},gap:1000,blocks};
 const edited={...input,revision:'edited',blocks:blocks.map((b,i)=>i===Math.floor(count/2)?{...b,size:{...b.size,height:12000}}:b)};
 const seed=planIntelligentLayoutIncremental(input);
 const cold=[],warm=[],unchanged=[];
 let result;
 for(let i=0;i<9;i++){
  const c=time(()=>planIntelligentLayout(edited)),w=time(()=>planIntelligentLayoutIncremental(edited,seed.snapshot)),u=time(()=>planIntelligentLayoutIncremental({...input,revision:'same'},seed.snapshot));
  if(c.result.status!=='placed'||w.result.layout.status!=='placed'||JSON.stringify(c.result)!==JSON.stringify(w.result.layout))throw Error('Layout mismatch');
  if(i>1){cold.push(c.ms);warm.push(w.ms);unchanged.push(u.ms);}
  result=w.result;
 }
 console.log(JSON.stringify({blocks:count,coldMedianMs:median(cold),incrementalMedianMs:median(warm),unchangedMedianMs:median(unchanged),
  reusedBlocks:result.reusedBlocks,reusedSuffixBlocks:result.reusedSuffixBlocks,placedBlocks:result.placedBlocks,sharedSnapshotPlacements:result.sharedSnapshotPlacements}));
}
