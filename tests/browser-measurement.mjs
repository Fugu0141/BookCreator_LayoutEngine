// Runs actual Chromium/Chrome against a loopback server with an explicit file allowlist.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const allowed=new Set(['/tests/browser-measurement.html','/dist/index.js','/dist/tree.js','/dist/pagination.js','/dist/inspector.js','/dist/browser-measurement.js','/dist/browser-lines.js','/dist/preview-font.js']);
const server=createServer(async(req,res)=>{
  const path=req.url;
  if(!allowed.has(path)){res.writeHead(404).end();return;}
  try{const bytes=await readFile(new URL('..'+path,import.meta.url));res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'}).end(bytes);}
  catch{res.writeHead(500).end();}
});
const profile=await mkdtemp(join(tmpdir(),'layout-chrome-'));
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=process.env.CHROME_BIN??'google-chrome';
  const args=['--headless','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+profile,'--dump-dom','--virtual-time-budget=5000','http://127.0.0.1:'+server.address().port+'/tests/browser-measurement.html'];
  if(process.env.CHROME_NO_SANDBOX==='1')args.unshift('--no-sandbox');
  const child=spawn(browser,args);let stdout='',stderr='';
  child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timeout));
  const match=/<pre id="result">([^<]*)<\/pre>/.exec(stdout);
  if(code!==0||!match?.[1].startsWith('PASS '))throw Error('Browser measurement failed: '+(match?.[1]??stderr.slice(-2000)));
  console.log(match[1]);
}finally{server.close();await rm(profile,{recursive:true,force:true});}
