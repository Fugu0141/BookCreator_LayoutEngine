import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMeasuredInput} from '../dist/index.js';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const input=()=>({schemaVersion:1,revision:'1',fingerprint:'fixture',content:{width:100,height:100},sections:[{id:'a',startOn:'page',blocks:[{kind:'block',origin:{documentId:'a',revision:'1',blockKey:'1'},width:100,unitHeights:[60,60],splitPolicy:'allow'}]}]});
test('inspector rejects malformed JSON objects and unknown layout constraints',()=>{
  for(const v of [null,{}, {...input(),sections:[null]}, {...input(),content:{width:'100',height:100}}])assert.equal(inspectMeasuredInput(v).ok,false);
  const a=input();a.sections[0].blocks[0].margin=10;assert.equal(inspectMeasuredInput(a).ok,false);
  const b=input();b.sections[0].blocks[0].unitHeights=[0];const r=inspectMeasuredInput(b);assert.equal(r.ok,true);assert.equal(r.plan.completeness,'partial');
});
test('inspector CLI reports full/partial plans, never publication ready, and preserves input',()=>{
  const dir=mkdtempSync(join(tmpdir(),'layout-'));try{
    const p=join(dir,'input.json'),source=JSON.stringify(input());writeFileSync(p,source);
    const run=(...args)=>spawnSync(process.execPath,['cli/layout-inspector.mjs',...args],{encoding:'utf8'});
    const r=run('plan',p,'--measure','fixture');assert.equal(r.status,0,r.stderr);const plan=JSON.parse(r.stdout).plan;assert.equal(plan.pages.length,2);assert.equal(plan.publicationReady,false);assert.equal(readFileSync(p,'utf8'),source);
    const b=input();b.sections[0].blocks[0].splitPolicy='strict';writeFileSync(p,JSON.stringify(b));assert.equal(run('plan',p,'--measure','fixture').status,1);
    writeFileSync(p,'{');assert.equal(run('plan',p,'--measure','fixture').status,1);
    assert.equal(run('plan',p).status,2);assert.equal(run('plan',join(dir,'missing.json'),'--measure','fixture').status,2);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
