// Runs actual Chromium/Chrome against a loopback server with an explicit file allowlist.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const allowed=new Set(['/tests/browser-measurement.html','/dist/index.js','/dist/tree.js','/dist/pagination.js','/dist/inspector.js','/dist/browser-measurement.js','/dist/browser-lines.js','/dist/browser-page-measure.js','/dist/browser-page-render.js','/dist/preview-component-render-key.js','/dist/preview-page-priority.js','/dist/preview-page-delivery.js','/dist/text-measurement-cache.js','/dist/math-preview.js','/dist/image-crop.js','/dist/preview-font.js','/dist/intelligent-layout.js','/dist/intelligent-measured.js','/dist/intelligent-preview.js','/dist/intelligent-print.js','/dist/intelligent-group-selection.js']);
// Fail fast on module syntax errors, which otherwise never reach /test-result.
const html=await readFile(new URL('./browser-measurement.html',import.meta.url),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if(!moduleSource)throw Error('Missing browser test module');
const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:moduleSource,encoding:'utf8'});
if(syntax.error||syntax.status!==0)throw Error('Browser test module syntax check failed: '+(syntax.error??syntax.stderr));
let complete,lastPhase='browser startup';
const result=new Promise(resolve=>{complete=resolve;});
const server=createServer(async(req,res)=>{
  if(req.method==='POST'&&req.url==='/test-result'){let body='';for await(const chunk of req){body+=chunk;if(body.length>65536){res.writeHead(413).end();return;}}res.writeHead(200).end();complete(body);return;}
  if(req.method==='POST'&&req.url==='/test-progress'){let body='';for await(const chunk of req){body+=chunk;if(body.length>256){res.writeHead(413).end();return;}}lastPhase=body;console.log('Browser phase: '+body);res.writeHead(204).end();return;}
  if(req.url==='/fixtures/math-font.otf'&&process.env.BC_TEST_MATH_FONT){
    try{const bytes=await readFile(process.env.BC_TEST_MATH_FONT);if(!bytes.length||bytes.length>16*1024*1024)throw Error('Invalid fixture size');res.writeHead(200,{'Content-Type':'font/otf'}).end(bytes);}
    catch{res.writeHead(500).end();}return;
  }
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
    const report=await Promise.race([result,exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Browser test timed out during '+lastPhase+': '+stderr)),30000);})]);
    if(!report.startsWith('PASS '))throw Error('Browser measurement failed: '+report);
    console.log(report);
  }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await closed;}}

}finally{server.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
