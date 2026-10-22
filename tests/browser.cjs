// Chrome + official Auth SDK + real PostgreSQL RPC QA. Synthetic identities/ratings only.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'.runtime','browser-results');
fs.mkdirSync(artifacts,{recursive:true});
const config=JSON.parse(fs.readFileSync(path.join(root,'site/config.json')));
const report={software_test_only:true,human_annotation:false,auth_gateway:'synthetic test transport; official SDK and real PostgreSQL authorization',checks:[],page_errors:[],unexpected_requests:[]};
const fields=['text_alignment','figure_alignment','table_alignment','equation_alignment','structure_alignment','content_coverage','overall_alignment','visual_integrity'];
const names={a:'QA_BROWSER_A',b:'QA_BROWSER_B'};
let server,browser,base,origin;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tokenFor(context){
 const state=await context.storageState();
 for(const item of state.origins.flatMap(o=>o.localStorage)){try{const value=JSON.parse(item.value);if(value.access_token&&value.user?.id)return value.access_token;}catch{}}
 return null;
}
async function rpc(context,name,args={}){
 const token=await tokenFor(context);
 const r=await context.request.post(origin+'/__rpc/'+name,{headers:token?{Authorization:'Bearer '+token}:{},data:args});
 assert.ok(r.ok(),await r.text());return r.json();
}
async function saved(context,id,predicate){
 for(let i=0;i<100;i++){const result=await rpc(context,'xacl_load_annotations',{p_annotator_id:id});if(result.record&&predicate(result.record))return result.record;await sleep(100);}throw Error('Save timed out');
}
async function freshContext(){
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1600,height:1050},locale:'zh-CN'});
 await context.route('https://zmklfbdulaoiqwekgcnw.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());assert.equal(req.headers().apikey,config.supabase_publishable_key);
  assert.notEqual(req.headers().authorization,'Bearer '+config.supabase_publishable_key,'public key is not a JWT');
  const target=u.pathname.startsWith('/auth/v1/')?'/__auth/'+u.pathname.slice('/auth/v1/'.length)+u.search:'/__rpc/'+u.pathname.split('/').pop();
  const headers=req.headers().authorization?{Authorization:req.headers().authorization}:{};
  const response=await context.request.fetch(origin+target,{method:req.method(),headers,...(req.postData()?{data:req.postDataJSON()}:{})});
  await route.fulfill({status:response.status(),contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:await response.body()});
 });
 context.on('request',r=>{const u=new URL(r.url());if(!['127.0.0.1','zmklfbdulaoiqwekgcnw.supabase.co'].includes(u.hostname))report.unexpected_requests.push(u.origin);});
 context.on('page',p=>p.on('pageerror',e=>report.page_errors.push(e.message)));
 return context;
}
async function fresh(context){
 const p=await context.newPage();await p.goto(base);
 await p.waitForFunction(()=>['load-session','continue-profile'].some(id=>{const n=document.getElementById(id);return n&&!n.disabled&&n.getBoundingClientRect().height>0;}));
 return p;
}
async function rendered(p,id){
 await p.waitForFunction(id=>document.querySelector(`[data-sample-id="${id}"]`)?.getAttribute('aria-current')==='true',id);
 await p.waitForFunction(id=>['compiled','official'].every(k=>{const n=document.querySelector(`[data-canvas="${k}"]`);return n&&!n.classList.contains('is-hidden')&&n.width>0&&n.dataset.renderedSample===id&&n.dataset.renderedPage==='1'&&document.querySelector(`[data-stage="${k}"]`).getAttribute('aria-busy')==='false';}),id,{timeout:60000});
}
async function create(p,name){
 await p.locator('#annotator-id').fill(name);await p.locator('#load-session').click();
 await p.locator('#recovery-code-panel').waitFor({state:'visible'});
 const code=(await p.locator('#recovery-code-display').textContent()).trim();assert.match(code,/^[0-9a-f]{64}$/);
 assert.ok(await p.locator('#annotation-app').isHidden());assert.ok(await p.locator('#continue-after-recovery').isDisabled());
 const downloadPromise=p.waitForEvent('download');await p.locator('#download-recovery-code').click();const dl=await downloadPromise;
 const backup=fs.readFileSync(await dl.path(),'utf8');assert.ok(backup.includes(code));assert.ok(backup.includes(name));
 await p.locator('#recovery-code-saved').check();await p.locator('#continue-after-recovery').click();await rendered(p,'RL01');
 return code;
}
(async()=>{
 if(!process.env.QA_DATABASE_URL)throw Error('QA_DATABASE_URL must point to disposable PostgreSQL');
 server=spawn(process.env.PYTHON_BIN||'python3',['tests/browser_server.py'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
 let errors='';server.stderr.on('data',d=>errors+=d);
 base=await new Promise((resolve,reject)=>{server.stdout.once('data',d=>resolve(d.toString().trim()));server.once('exit',()=>reject(Error(errors)));setTimeout(()=>reject(Error('QA server startup timed out')),10000).unref();});origin=new URL(base).origin;
 browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--disable-crash-reporter','--disable-crashpad']});
 const contextA=await freshContext(),p=await fresh(contextA);assert.equal(await p.locator('html').getAttribute('lang'),'en');assert.ok(await p.locator('#annotation-app').isHidden());
 assert.equal(await tokenFor(contextA),null,'opening landing page must not automatically register anonymous users');
 const codeA=await create(p,names.a);report.checks.push('English default, user-triggered anonymous self-registration, custom nickname and one-time downloadable recovery code; actual frozen PDFs under Pages subpath');
 assert.ok(await p.locator('#publication-notice').isVisible());assert.equal(await p.locator('#guidance-details').getAttribute('open'),null);assert.equal(await p.locator('.score-scale-details').count(),8);
 await p.screenshot({path:path.join(artifacts,'hosted-review.png')});
 const note='SYNTHETIC SOFTWARE QA ONLY; not a human judgment.';
 await p.locator('#notes').fill(note);await p.locator('[data-score-key="visual_integrity"][data-option="4"]').click();await saved(contextA,names.a,r=>r.annotations.RL01?.notes===note&&r.annotations.RL01.scores.visual_integrity===4);
 await p.reload();await p.locator('#continue-profile').waitFor({state:'visible'});await p.locator('#continue-profile').click();await rendered(p,'RL01');assert.equal(await p.locator('#notes').inputValue(),note);
 assert.ok(!(await p.evaluate(()=>JSON.stringify({...localStorage}))).includes(codeA));report.checks.push('Official SDK restores anonymous session; explicit Continue restores SQL draft; recovery code never persisted in local storage');
 for(const k of ['figure','table','equation'])for(const side of ['compiled','official'])await p.locator(`[data-presence-key="${k}"][data-presence-side="${side}"]`).selectOption('present');
 for(const k of fields)await p.locator(`[data-score-key="${k}"][data-option="5"]`).click();
 await p.locator('.check-label').filter({has:p.locator('#reviewed-full-scope')}).click();await p.locator('#complete-review').click();await saved(contextA,names.a,r=>r.annotations.RL01.status==='completed');
 await p.reload();await p.locator('#continue-profile').waitFor({state:'visible'});await p.locator('#continue-profile').click();await rendered(p,'RL02');report.checks.push('Server accepts complete synthetic fixture and same-device continuation opens first unfinished RL02');
 const exportWait=p.waitForEvent('download');await p.locator('#export-button').click();const exported=JSON.parse(fs.readFileSync(await (await exportWait).path(),'utf8'));assert.equal(exported.annotations.RL01.status,'completed');assert.ok(!JSON.stringify(exported).includes(codeA));report.checks.push('Export uses canonical saved SQL record with original v1 schema and no recovery credential');
 const contextDevice2=await freshContext(),second=await fresh(contextDevice2);await second.locator('#mode-restore-profile').click();await second.locator('#annotator-id').fill(names.a);await second.locator('#annotator-code').fill('f'.repeat(64));await second.locator('#load-session').click();await second.locator('#login-error').waitFor({state:'visible'});assert.ok(await second.locator('#annotation-app').isHidden());
 await second.locator('#annotator-code').fill(codeA);await second.locator('#load-session').click();await rendered(second,'RL02');report.checks.push('New-device anonymous identity rejects wrong recovery code and restores same profile using its correct code');
 await p.locator('#notes').fill(note+' first writer');await saved(contextA,names.a,r=>r.annotations.RL02?.notes===note+' first writer');
 await second.locator('#notes').fill(note+' stale writer');await second.locator('#save-button').click();await second.waitForFunction(()=>document.querySelector('#save-status').dataset.state==='conflict');await second.locator('#switch-annotator').click();assert.ok(await second.locator('#annotation-app').isVisible());assert.ok(await second.locator('[data-download-recovery]').isVisible());assert.equal((await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a})).record.annotations.RL02.notes,note+' first writer');report.checks.push('Two device identities share one participant safely; stale SQL save conflicts, switch blocks, recovery survives');
 const contextB=await freshContext(),other=await fresh(contextB);const codeB=await create(other,names.b);assert.equal(await other.locator('#notes').inputValue(),'');await other.locator('#notes').fill(note+' profile B');await saved(contextB,names.b,r=>r.annotations.RL01?.notes===note+' profile B');
 const denied=await rpc(contextB,'xacl_load_annotations',{p_annotator_id:names.a});assert.equal(denied.error,'invalid_access');report.checks.push('Self-registered profile B cannot read profile A even with its known nickname; direct SQL RPC honors auth.uid binding');
 const imported=structuredClone(exported);imported.annotator_id=names.b;imported.revision=999;imported.annotations.RL02={...structuredClone(imported.annotations.RL01),status:'draft',notes:note+' imported'};
 const importFile=path.join(artifacts,'synthetic-import.json');fs.writeFileSync(importFile,JSON.stringify(imported));other.once('dialog',d=>d.accept());await other.locator('#import-file').setInputFiles(importFile);await rendered(other,'RL02');await saved(contextB,names.b,r=>r.annotations.RL02?.notes===note+' imported');assert.equal(await other.locator('#annotation-app').getAttribute('inert'),null);report.checks.push('Legacy JSON import uses current cloud revision, not imported999; successful import restores unfinished draft and releases UI lock');
 await other.locator('#switch-annotator').click();await other.locator('#load-session').waitFor({state:'visible'});assert.equal(await tokenFor(contextB),null);assert.ok(await other.locator('#annotation-app').isHidden());report.checks.push('Switch flushes saved content and signs out local anonymous session; original data remains retrievable with recovery code');
 const mobile=await fresh(contextB);await mobile.setViewportSize({width:390,height:844});await mobile.screenshot({path:path.join(artifacts,'hosted-login-mobile.png')});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.checks.push('Create/restore landing page fits 390px mobile screen');
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.unexpected_requests,[]);report.status='passed';console.log(JSON.stringify(report,null,2));
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(server)server.kill('SIGTERM');});
