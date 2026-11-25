// Runs actual Chromium/Chrome against a loopback server with an explicit file allowlist.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const allowed=new Set(['/tests/browser-measurement.html','/dist/index.js','/dist/tree.js','/dist/pagination.js','/dist/inspector.js','/dist/browser-measurement.js','/dist/browser-lines.js','/dist/image-crop.js','/dist/preview-font.js']);
let complete,lastPhase='browser startup';
const result=new Promise(resolve=>{complete=resolve;});
const server=createServer(async(req,res)=>{
  if(req.method==='POST'&&req.url==='/test-result'){let body='';for await(const chunk of req){body+=chunk;if(body.length>65536){res.writeHead(413).end();return;}}res.writeHead(200).end();complete(body);return;}
  if(req.method==='POST'&&req.url==='/test-progress'){let body='';for await(const chunk of req){body+=chunk;if(body.length>256){res.writeHead(413).end();return;}}lastPhase=body;console.log('Browser phase: '+body);res.writeHead(204).end();return;}
  const path=req.url;
  if(!allowed.has(path)){res.writeHead(404).end();return;}
  try{const bytes=await readFile(new URL('..'+path,import.meta.url));res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'}).end(bytes);}
  catch{res.writeHead(500).end();}
});
const profile=await mkdtemp(join(tmpdir(),'layout-chrome-'));
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=process.env.CHROME_BIN??'google-chrome';
  const args=['--headless','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+profile,'http://127.0.0.1:'+server.address().port+'/tests/browser-measurement.html'];
  if(process.env.CHROME_NO_SANDBOX==='1')args.unshift('--no-sandbox');
  const child=spawn(browser,args);let stderr='';
  child.stdout.resume();child.stderr.on('data',d=>stderr=(stderr+d).slice(-4000));
  let timeout;
  const exited=new Promise((_,reject)=>{child.once('error',reject);child.once('close',code=>reject(Error('Browser exited before test result: '+code+' '+stderr)));});
  try{
    const report=await Promise.race([result,exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Browser test timed out during '+lastPhase+': '+stderr)),90000);})]);
    if(!report.startsWith('PASS '))throw Error('Browser measurement failed: '+report);
    console.log(report);
  }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await closed;}}

}finally{server.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
