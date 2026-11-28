// Test only: generate real Chromium PDF and inspect physical text coordinates
// independently with Poppler. No PDF dependency is added to the Engine API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const temp=await mkdtemp(join(tmpdir(),'il-pdf-'));
const dist=new URL('../dist/',import.meta.url);
const modules=new Set((await readdir(dist)).filter(n=>/^[a-z0-9-]+\.js$/.test(n)).map(n=>'/dist/'+n));
const server=createServer(async(req,res)=>{
 try{
  const path=req.url;
  if(req.method!=='GET'||(path!=='/tests/intelligent-pdf.html'&&!modules.has(path))){res.writeHead(404).end();return;}
  const bytes=await readFile(new URL('..'+path,import.meta.url));
  res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'}).end(bytes);
 }catch{res.writeHead(500).end();}
});
let chrome,socket,stderr='';
const waitFor=async(fn,label)=>{
 const until=Date.now()+20000;
 while(Date.now()<until){if(chrome?.exitCode!==null&&chrome?.exitCode!==undefined)throw Error('Chrome exited: '+stderr);
  const value=await fn();if(value)return value;await delay(50);}
 throw Error('Timed out: '+label+' '+stderr);
};
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const pageUrl='http://127.0.0.1:'+server.address().port+'/tests/intelligent-pdf.html';
 const args=['--headless','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+temp,pageUrl];
 if(process.env.CHROME_NO_SANDBOX==='1')args.unshift('--no-sandbox');
 chrome=spawn(process.env.CHROME_BIN??'google-chrome',args);
 chrome.stdout.resume();chrome.stderr.on('data',b=>stderr=(stderr+b).slice(-4000));
 let spawnError;chrome.on('error',e=>{spawnError=e;});
 const port=await waitFor(async()=>{if(spawnError)throw spawnError;try{return (await readFile(join(temp,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return undefined;}},'DevTools port');
 assert.match(port,/^\d+$/);
 const target=await waitFor(async()=>{
  try{const response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)});
   return (await response.json()).find(t=>t.type==='page'&&t.url===pageUrl);
  }catch{return undefined;}
 },'fixture target');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('DevTools connection timeout')),5000);
  socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('DevTools connection failed'));},{once:true});
 });
 let seq=0;
 const pending=new Map();
 socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data),p=pending.get(message.id);if(!p)return;
  pending.delete(message.id);clearTimeout(p.timeout);
  if(message.error)p.reject(Error(JSON.stringify(message.error)));else p.resolve(message.result);
 });
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);
  pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));
 });
 await waitFor(async()=>{const r=await call('Runtime.evaluate',{expression:'typeof globalThis.ilPdfReady !== "undefined"',returnByValue:true});return r.result.value;},'fixture initialized');
 const ready=await call('Runtime.evaluate',{expression:'globalThis.ilPdfReady',awaitPromise:true,returnByValue:true});
 if(ready.exceptionDetails)throw Error('IL PDF fixture: '+JSON.stringify(ready.exceptionDetails));
 const {paper,expected,publicationReady}=ready.result.value;
 assert.equal(publicationReady,false);
 const result=await call('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true,scale:1,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0});
 const pdf=join(temp,'acceptance.pdf');await writeFile(pdf,Buffer.from(result.data,'base64'));
 const xml=execFileSync('pdftotext',['-bbox',pdf,'-'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 const pages=[...xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)];
 const attr=(s,k)=>{const v=s.match(new RegExp('\\b'+k+'="([^"]+)"'));assert.ok(v,'Missing '+k);const n=Number(v[1]);assert.ok(Number.isFinite(n));return n;};
 const pt=um=>um*72/25400;
 assert.equal(pages.length,expected.length,'actual PDF page count including blank');
 const evidence=[];
 for(const [i,page] of pages.entries()){
  assert.ok(Math.abs(attr(page[1],'width')-pt(paper.width))<2.835,'PDF physical width');
  assert.ok(Math.abs(attr(page[1],'height')-pt(paper.height))<2.835,'PDF physical height');
  const words=[...page[2].matchAll(/<word\b([^>]*)>([^<]*)<\/word>/g)];
  assert.deepEqual(words.map(w=>w[2]).sort(),expected[i].map(f=>f.text).sort(),'text identity and page membership');
  for(const f of expected[i]){
   const word=words.find(w=>w[2]===f.text);
   const x=attr(word[1],'xMin'),y=attr(word[1],'yMin'),right=attr(word[1],'xMax'),bottom=attr(word[1],'yMax');
   // Poppler text bounds are font boxes, not CSS boxes. Allow 1 mm rounding/
   // font metric deviation; compare horizontal start and vertical containment.
   const tolerance=pt(1000);
   assert.ok(Math.abs(x-pt(f.x))<=tolerance,'PDF horizontal placement: '+f.text);
   assert.ok(y>=pt(f.y)-tolerance&&y<=pt(f.y+f.height)+tolerance,'PDF vertical placement: '+f.text);
   assert.ok(right<=pt(f.x+f.width)+tolerance&&bottom<=pt(f.y+f.height)+tolerance,'PDF text contained: '+f.text);
   evidence.push({page:i,text:f.text,expectedXPt:pt(f.x),expectedYPt:pt(f.y),actualXPt:x,actualYPt:y});
  }
 }
 console.log(JSON.stringify({test:'il-pdf',pages:pages.length,blankPage:2,coordinateToleranceMm:1,words:evidence,publicationReady:false}));
}finally{
 socket?.close();
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null){
  const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill('SIGKILL');await Promise.race([closed,delay(3000)]);
 }
 server.close();await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
