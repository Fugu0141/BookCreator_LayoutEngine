#!/usr/bin/env node
import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {inspectMeasuredInput} from '../dist/index.js';
const LIMIT=8*1024*1024;
async function read(path){
  const file=await open(await realpath(path),constants.O_RDONLY|constants.O_NONBLOCK);
  try{
    const s=await file.stat();if(!s.isFile()||s.size>LIMIT)throw Error('Expected regular JSON file up to 8 MiB');
    const bytes=Buffer.alloc(LIMIT+1);let used=0;
    while(used<bytes.length){const {bytesRead}=await file.read(bytes,used,bytes.length-used,null);if(!bytesRead)break;used+=bytesRead;}
    if(used>LIMIT)throw Error('Input too large');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));
  }finally{await file.close();}
}
async function main(){
  const [command,path,flag,mode,...extra]=process.argv.slice(2);
  if(command!=='plan'||!path||path.startsWith('-')||flag!=='--measure'||mode!=='fixture'||extra.length)throw Error('Usage: layout-inspector plan <input.json> --measure fixture');
  const source=await read(path);
  let input;try{input=JSON.parse(source);}catch{
    process.stdout.write(JSON.stringify({ok:false,diagnostics:[{code:'PG_INPUT_JSON',message:'Invalid JSON'}]})+'\n');process.exitCode=1;return;
  }
  const result=inspectMeasuredInput(input);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.ok&&result.plan.completeness==='full'?0:1;
}
main().catch(e=>{process.stderr.write(String(e.message??e)+'\n');process.exitCode=2;});
