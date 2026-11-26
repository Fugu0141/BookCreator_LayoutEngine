import test from 'node:test';
import assert from 'node:assert/strict';
import {paginateMeasured,paginateMeasuredIncremental} from '../dist/index.js';

const origin=(key,revision='1',offset=0)=>({documentId:'doc',blockKey:key,revision,range:{start:offset,end:offset+2}});
const block=(key,heights,extra={})=>({kind:'block',origin:origin(key),width:100,unitHeights:heights,splitPolicy:'allow',...extra});
const br=key=>({kind:'pagebreak',origin:origin(key)});
const section=(id,blocks,startOn='continuous')=>({id,blocks,startOn});
const input=(sections,revision='1',height=100)=>({schemaVersion:1,revision,fingerprint:'job-'+revision,content:{width:100,height},sections});
function check(next,snapshot){
  const actual=paginateMeasuredIncremental(next,snapshot);
  assert.deepEqual(actual.plan,paginateMeasured(next));
  return actual;
}
test('late edit skips placement prefix and rebinds every current origin',()=>{
  const blocks=Array.from({length:40},(_,i)=>block('b'+i,[30,30]));
  const a=check(input([section('s',blocks)]));
  assert.equal(a.placedBlocks,40);assert.ok(a.snapshot);
  const changed=blocks.map((b,i)=>({...b,origin:origin(b.origin.blockKey,'2',i*3),unitHeights:i===35?[40,30]:b.unitHeights}));
  const b=check(input([section('s',changed)],'2'),a.snapshot);
  assert.equal(b.reusedBlocks,35);assert.equal(b.placedBlocks,5);
  assert.equal(b.plan.pages[0].fragments[0].origin,changed[0].origin);
  const c=check(input([section('s',changed)],'3'),b.snapshot);
  assert.equal(c.reusedBlocks,40);assert.equal(c.placedBlocks,0);
});
test('resume with partial page, split warning, explicit break, empty section and continuous suppression',()=>{
  const blocks=[block('a',[30]),block('b',[60,60],{splitPolicy:'avoid'}),br('break'),block('c',[30])];
  const top={startPosition:'page-top',startPositionSource:'component'};
  const rest=[block('d',[20],top),block('e',[20],top),block('f',[30,30],{fragmentPadding:{top:5,bottom:5}})];
  const initial=input([section('a',blocks),section('empty',[],'page'),section('b',rest)]);
  const a=check(initial);
  const b=check(input([section('a',blocks),section('empty',[],'page'),section('b',[...rest.slice(0,2),block('f',[35,30],{fragmentPadding:{top:5,bottom:5}})])],'2'),a.snapshot);
  assert.equal(b.reusedBlocks,5);assert.equal(b.placedBlocks,1);
  assert.equal(b.plan.diagnostics[0].code,'PG_AVOID_SPLIT');
  const c=check(input([section('a',blocks),section('empty',[]),section('b',rest)],'3'),b.snapshot);
  assert.equal(c.reusedBlocks,3);
});
test('deletion, insertion, changed content dimensions and invalid input',()=>{
  const a=block('a',[60]),b=block('b',[60]),c=block('c',[20]);
  const first=check(input([section('s',[a,b,c])]));
  const short=check(input([section('s',[a,b])],'2'),first.snapshot);
  assert.equal(short.reusedBlocks,2);assert.equal(short.placedBlocks,0);
  const inserted=check(input([section('s',[a,block('x',[10]),b])],'3'),short.snapshot);
  assert.equal(inserted.reusedBlocks,1);
  const resized=check(input([section('s',[a,b])],'4',90),inserted.snapshot);
  assert.equal(resized.reusedBlocks,0);
  const invalid=check(input([section('s',[a,block('bad',[0])])],'5'),resized.snapshot);
  assert.equal(invalid.snapshot,undefined);assert.equal(invalid.reusedBlocks,0);assert.equal(invalid.plan.pages.length,0);
  const tooLarge=check(input([section('s',[a,block('bad',[110])])],'6'),resized.snapshot);
  assert.equal(tooLarge.snapshot,undefined);
});
test('snapshot ownership ignores forged handles and mutations to returned plan',()=>{
  const next=input([section('s',[block('a',[40]),block('b',[40])])]);
  const first=check(next);
  first.plan.pages[0].fragments[0].rect.height=99;
  first.plan.pages.length=0;
  const reused=check(next,first.snapshot);
  assert.equal(reused.reusedBlocks,2);
  assert.equal(check(next,{kind:'pagination-checkpoint-snapshot'}).reusedBlocks,0);
});
test('deterministic edit sequence matches full placement including failures',()=>{
  let seed=20261127;
  const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  let blocks=Array.from({length:25},(_,i)=>block('b'+i,[15+rand(65),10+rand(55)]));
  let prev=check(input([section('s',blocks)]));
  for(let step=0;step<100;step++){
    const i=rand(blocks.length),b=blocks[i];
    const kind=rand(5);
    if(kind===0&&blocks.length>2)blocks=blocks.filter((_,j)=>j!==i);
    else if(kind===1)blocks=[...blocks.slice(0,i),block('new'+step,[10+rand(70)]),...blocks.slice(i)];
    else blocks=blocks.map((v,j)=>j!==i?v:block(b.origin.blockKey,[10+rand(115),10+rand(70)],{splitPolicy:['allow','avoid','strict'][rand(3)],fragmentPadding:{top:rand(5),bottom:rand(5)}}));
    const rev=String(step+2);
    blocks=blocks.map((v,j)=>({...v,origin:origin(v.origin.blockKey,rev,j*3)}));
    prev=check(input([section('s',blocks)],rev),prev.snapshot);
  }
});
