import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotPagePriority,prioritizePages} from '../dist/preview-page-priority.js';

test('priority hints are copied, deduplicated and bounded',()=>{
  const input=[4,1,4,9];
  const priority=snapshotPagePriority(input);
  input[0]=0;
  assert.deepEqual(priority,[4,1,9]);
  assert.ok(Object.isFrozen(priority));
  assert.equal(snapshotPagePriority(undefined),undefined);
  assert.equal(snapshotPagePriority([]),undefined);
  for(const invalid of [null,{},[-1],[1.5],[NaN],[Infinity],[Number.MAX_SAFE_INTEGER+1],Array(65).fill(1)]){
    assert.throws(()=>snapshotPagePriority(invalid),RangeError);
  }
});
test('priorities preserve original page identity and order of remaining pages',()=>{
  const pages=Array.from({length:6},(_,index)=>({index}));
  const result=prioritizePages(pages,snapshotPagePriority([4,2,9,4]));
  assert.deepEqual(result.map(p=>p.index),[4,2,0,1,3,5]);
  for(const page of result)assert.equal(page,pages[page.index]);
  assert.equal(prioritizePages(pages,undefined),pages);
  assert.deepEqual(pages.map(p=>p.index),[0,1,2,3,4,5]);
  assert.deepEqual(prioritizePages(pages,[99]),pages);
});
