// Test only: generate real Chromium PDF and inspect physical text coordinates
// independently with Poppler. No PDF dependency is added to the Engine API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const mixed=process.argv.includes('--mixed');
const fixture=mixed?'/tests/intelligent-pdf-mixed.html':'/tests/intelligent-pdf.html';
const temp=await mkdtemp(join(tmpdir(),'il-pdf-'));
const dist=new URL('../dist/',import.meta.url);
const modules=new Set((await readdir(dist)).filter(n=>/^[a-z0-9-]+\.js$/.test(n)).map(n=>'/dist/'+n));
const server=createServer(async(req,res)=>{
 try{
  const path=req.url;
  if(req.method!=='GET'||(path!==fixture&&!modules.has(path))){res.writeHead(404).end();return;}
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
 const pageUrl='http://127.0.0.1:'+server.address().port+fixture;
 const args=['--headless','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+temp,pageUrl];
 if(process.env.CHROME_NO_SANDBOX==='1')args.unshift('--no-sandbox');
 chrome=spawn(process.env.CHROME_BIN??'google-chrome',args);
 chrome.stdout.resume();chrome.stderr.on('data',b=>stderr=(stderr+b).slice(-4000));
 let spawnError;chrome.on('error',e=>{spawnError=e;});
 const port=await waitFor(async()=>{if(spawnError)throw spawnError;try{return (await readFile(join(temp,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0].trim();}catch{return undefined;}},'DevTools port');
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
 const {paper,expected,regions,publicationReady}=ready.result.value;
 assert.equal(publicationReady,false);
 const result=await call('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true,scale:1,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0});
 const pdf=join(temp,'acceptance.pdf');await writeFile(pdf,Buffer.from(result.data,'base64'));
 const xml=execFileSync('pdftotext',['-bbox',pdf,'-'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 const pages=[...xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)];
 const attr=(s,k)=>{const v=s.match(new RegExp('\\b'+k+'="([^"]+)"'));assert.ok(v,'Missing '+k);const n=Number(v[1]);assert.ok(Number.isFinite(n));return n;};
 const pt=um=>um*72/25400;
 assert.equal(pages.length,expected.length,'actual PDF page count including blank');
 const evidence=[];
 if(mixed){
  // Extracted Japanese can be segmented into multiple words by Poppler.
  // Normalize only whitespace, not source characters.
  for(const [i,page] of pages.entries()){
   assert.ok(Math.abs(attr(page[1],'width')-pt(paper.width))<2.835);
   assert.ok(Math.abs(attr(page[1],'height')-pt(paper.height))<2.835);
   const words=[...page[2].matchAll(/<word\b([^>]*)>([^<]*)<\/word>/g)];
   const joined=words.map(w=>w[2]).join('').replace(/\s/g,'');
   if(i===0)assert.equal(joined,'数学の基本','Japanese heading must survive extraction exactly');
   if(i===1)assert.ok(joined.includes('(2.1)'),'numbered formula label must survive extraction');
   if(i===2)assert.equal(joined,'','blank page text');
   if(i===3)assert.equal(joined,'図の説明','Japanese image caption must survive extraction exactly');
  }
  // Render real PDF pages at 144dpi and independently inspect selected
  // interior regions. This is a fixture-specific ink/color check, not
  // general visual equivalence or a pixel-perfect screenshot comparison.
  const prefix=join(temp,'raster');
  execFileSync('pdftoppm',['-r','144',pdf,prefix],{timeout:20000});
  const files=(await readdir(temp)).filter(n=>/^raster-\d+\.ppm$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  assert.equal(files.length,4);
  const pixelsPerUm=144/25400;
  for(const [i,file] of files.entries()){
   const bytes=await readFile(join(temp,file));
   const header=bytes.subarray(0,256).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+255\s/);
   assert.ok(header,'Expected raw PPM');
   const width=Number(header[1]),height=Number(header[2]),offset=header[0].length;
   assert.equal(bytes.length-offset,width*height*3);
   function count(rect,predicate){
    let n=0,total=0;
    for(let y=Math.max(0,Math.ceil(rect.y*pixelsPerUm));y<Math.min(height,Math.floor((rect.y+rect.height)*pixelsPerUm));y++)
     for(let x=Math.max(0,Math.ceil(rect.x*pixelsPerUm));x<Math.min(width,Math.floor((rect.x+rect.width)*pixelsPerUm));x++){
      const at=offset+(y*width+x)*3;total++;if(predicate(bytes[at],bytes[at+1],bytes[at+2]))n++;
     }
    assert.ok(total>0);return {n,total};
   }
   if(i===2){const white=count({x:0,y:0,width:paper.width,height:paper.height},(r,g,b)=>r>=250&&g>=250&&b>=250);assert.equal(white.n,white.total,'blank page must have no printed ink');}
   for(const region of regions.filter(r=>r.page===i)){
    const sample=count(region,region.kind==='red'?(r,g,b)=>r>180&&g<80&&b<80:region.kind==='blue'?(r,g,b)=>b>180&&r<80&&g<80:(r,g,b)=>r<100&&g<100&&b<100);
    if(region.kind==='red'||region.kind==='blue')assert.ok(sample.n/sample.total>.9,'image color and physical placement: '+region.kind);
    else assert.ok(sample.n>20,'visible ink in '+region.kind);
    evidence.push({page:i,kind:region.kind,pixels:sample.n,total:sample.total});
   }
  }
  const fonts=execFileSync('pdffonts',[pdf],{encoding:'utf8',timeout:10000});
  assert.match(fonts,/NotoSansCJK/i,'Japanese font present in PDF');
  assert.ok(fonts.split('\n').some(l=>/NotoSansCJK/i.test(l)&&/\byes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.test(l)),'Japanese font embedded');
  console.log(JSON.stringify({test:'il-pdf-mixed',pages:pages.length,blankPage:2,regions:evidence,publicationReady:false}));
 }else{
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
 }
}finally{
 socket?.close();
 if(chrome&&chrome.exitCode===null&&chrome.signalCode===null){
  const closed=new Promise(resolve=>chrome.once('close',resolve));
  if(process.platform==='win32'&&chrome.pid){
   // Chrome creates child processes that can hold the private profile open.
   // Terminate only the process tree started for this fixture.
   try{execFileSync('taskkill',['/PID',String(chrome.pid),'/T','/F'],{timeout:10000,stdio:'ignore'});}
   catch{if(chrome.exitCode===null&&chrome.signalCode===null)chrome.kill();}
  }else chrome.kill('SIGKILL');
  await Promise.race([closed,delay(3000)]);
 }
 server.close();await rm(temp,{recursive:true,force:true,maxRetries:process.platform==='win32'?20:10,retryDelay:100});
}
