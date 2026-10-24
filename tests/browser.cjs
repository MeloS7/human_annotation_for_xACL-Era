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
const names={a:'QA_BROWSER_A',b:'QA_BROWSER_B',c:'QA_BROWSER_C'};
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
async function saveRecord(context,id,record,operation='save'){
 const result=await rpc(context,'xacl_save_annotations',{p_annotator_id:id,p_record:record,p_guidance_version:config.guidance_version,p_guidance_sha256:config.guidance_sha256,p_operation:operation});
 assert.ok(result.record,`Synthetic record rejected: ${JSON.stringify(result)}`);return result.record;
}
function legacyAnnotation(notes='Synthetic legacy QA fixture.',evidence='Synthetic evidence retained by migration.'){
 return {
  scores:{text_alignment:4,figure_alignment:3,table_alignment:'na',equation_alignment:2,structure_alignment:5,content_coverage:4,overall_alignment:3,visual_integrity:5},
  objects:{figure:{compiled:'present',official:'present'},table:{compiled:'absent',official:'absent'},equation:{compiled:'absent',official:'present'}},
  evidence,notes,flags:['appendix_difference'],reviewed_full_scope:true,status:'draft',updated_at:'2026-10-20T12:00:00.000Z'
 };
}
function recoveryStorageKey(annotatorId){
 return `xacl.annotation.recovery:${encodeURIComponent(config.supabase_url)}:${encodeURIComponent(config.study_id)}:${config.manifest_sha256}:${encodeURIComponent(annotatorId)}`;
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
async function assertSteppedTo(p,id,index){
 await rendered(p,id);
 await p.waitForFunction(()=>{
  const heading=document.querySelector('.paper-heading'),title=document.querySelector('#active-paper-title'),topbar=document.querySelector('.topbar');
  if(!heading||!title||!topbar||document.activeElement!==title)return false;
  const headingTop=heading.getBoundingClientRect().top,titleRect=title.getBoundingClientRect(),topbarBottom=topbar.getBoundingClientRect().bottom;
  const scrollMarginTop=parseFloat(getComputedStyle(heading).scrollMarginTop)||0;
  return Math.abs(headingTop-scrollMarginTop)<=2&&headingTop>=topbarBottom-1&&titleRect.top<innerHeight&&titleRect.bottom>topbarBottom;
 },null,{timeout:8000});
 const layout=await p.evaluate(()=>{
  const heading=document.querySelector('.paper-heading'),title=document.querySelector('#active-paper-title'),topbar=document.querySelector('.topbar');
  const headingRect=heading.getBoundingClientRect(),titleRect=title.getBoundingClientRect(),topbarRect=topbar.getBoundingClientRect();
  return {focused:document.activeElement===title,headingTop:headingRect.top,titleTop:titleRect.top,titleBottom:titleRect.bottom,topbarBottom:topbarRect.bottom,viewportHeight:innerHeight,position:document.querySelector('#paper-position').textContent.trim(),language:document.documentElement.lang};
 });
 assert.equal(layout.focused,true,`Paper ${id} title should receive focus after step navigation`);
 assert.ok(layout.headingTop>=layout.topbarBottom-1,`Paper ${id} heading is hidden behind sticky top bar (${layout.headingTop}px / ${layout.topbarBottom}px)`);
 assert.ok(layout.titleTop<layout.viewportHeight&&layout.titleBottom>layout.topbarBottom,`Paper ${id} heading title should be visible after step navigation`);
 assert.equal(layout.position,`${index} ${layout.language==='zh'?'/':'of'} 30`);
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
 assert.ok(await p.locator('#publication-notice').isVisible());assert.equal(await p.locator('#object-protocol-notice').isHidden(),true);assert.equal(await p.locator('#convert-legacy-object-scores').count(),0);assert.equal(await p.locator('#guidance-details').getAttribute('open'),null);assert.equal(await p.locator('.score-scale-details').count(),8);assert.equal(await p.locator('.score-scale-details[open]').count(),8);
 const stepperPlacement=await p.evaluate(()=>{const nav=document.querySelector('#previous-paper')?.closest('nav'),completion=document.querySelector('.completion-card');return {single:document.querySelectorAll('#previous-paper').length===1&&document.querySelectorAll('#next-paper').length===1,inHeading:Boolean(nav?.closest('.paper-heading')),inAnnotation:Boolean(nav?.closest('.annotation-section')),afterCompletion:Boolean(nav&&completion&&(completion.compareDocumentPosition(nav)&Node.DOCUMENT_POSITION_FOLLOWING))};});assert.deepEqual(stepperPlacement,{single:true,inHeading:false,inAnnotation:true,afterCompletion:true});
 assert.equal(await p.locator('#paper-position').innerText(),'1 of 30');assert.equal(await p.locator('#previous-paper').isDisabled(),true);assert.equal(await p.locator('#next-paper').isDisabled(),false);
 await p.locator('.language-button[data-language="zh"]').click();assert.equal(await p.locator('#previous-paper').innerText(),'← 上一篇');assert.equal(await p.locator('#next-paper').innerText(),'下一篇 →');assert.equal(await p.locator('#paper-position').innerText(),'1 / 30');assert.equal(await p.locator('#previous-paper').evaluate(n=>n.closest('nav').getAttribute('aria-label')),'论文导航');await p.locator('.language-button[data-language="en"]').click();
 await p.locator('[data-sample-id="RL30"]').click();await p.waitForFunction(()=>document.querySelector('[data-sample-id="RL30"]')?.getAttribute('aria-current')==='true');assert.equal(await p.locator('#paper-position').innerText(),'30 of 30');assert.equal(await p.locator('#previous-paper').isDisabled(),false);assert.equal(await p.locator('#next-paper').isDisabled(),true);await p.locator('#next-paper').evaluate(button=>button.click());assert.equal(await p.locator('[data-sample-id="RL30"]').getAttribute('aria-current'),'true');
 await p.locator('[data-sample-id="RL01"]').click();await rendered(p,'RL01');assert.equal(await p.locator('#paper-position').innerText(),'1 of 30');assert.equal(await p.locator('#previous-paper').isDisabled(),true);assert.equal(await p.locator('#next-paper').isDisabled(),false);report.checks.push('Single bottom stepper follows completion, localizes English/Chinese, reports positions, and disables both boundary directions without wrapping');
 assert.equal(await p.locator('.evidence-card .optional-hint').innerText(),'Optional');assert.match(await p.locator('.flags-card legend').innerText(),/optional/i);
 await p.locator('#guidance-details').evaluate(n=>n.open=true);assert.equal(await p.locator('.guidance-detail h4').filter({hasText:'Previously saved ratings'}).count(),0);await p.locator('#guidance-details').evaluate(n=>n.open=false);
 const englishGuidance=[await p.locator('#guidance-quick-rules').innerText(),await p.locator('#guidance-expanded-items').innerText(),await p.locator('[data-i18n="fullScopeHelp"]').innerText()].join(' ');assert.match(englishGuidance,/optional/i);assert.doesNotMatch(englishGuidance,/evidence.{0,80}(required|must)|page references.{0,80}(required|must)|required.{0,80}(evidence|page)/i);
 await p.locator('.language-button[data-language="zh"]').click();assert.equal(await p.locator('.evidence-card .optional-hint').innerText(),'选填');assert.match(await p.locator('.flags-card legend').innerText(),/选填/);assert.match(await p.locator('[data-i18n="fullScopeHelp"]').innerText(),/可选/);await p.locator('.language-button[data-language="en"]').click();
 report.checks.push('New profiles use current object rules directly; no legacy notice or conversion consent, and obsolete saved-rating transition guidance is hidden');
 await p.screenshot({path:path.join(artifacts,'hosted-review.png')});
 const note='SYNTHETIC SOFTWARE QA ONLY; not a human judgment.';
 await p.locator('#notes').fill(note);await p.locator('[data-score-key="visual_integrity"][data-option="4"]').click();await saved(contextA,names.a,r=>r.annotations.RL01?.notes===note&&r.annotations.RL01.scores.visual_integrity===4);
 await p.reload();await p.locator('#continue-profile').waitFor({state:'visible'});await p.locator('#continue-profile').click();await rendered(p,'RL01');assert.equal(await p.locator('#notes').inputValue(),note);
 assert.ok(!(await p.evaluate(()=>JSON.stringify({...localStorage}))).includes(codeA));report.checks.push('Official SDK restores anonymous session; explicit Continue restores SQL draft; recovery code never persisted in local storage');
 for(const k of fields)await p.locator(`[data-score-key="${k}"][data-option="5"]`).click();
 await p.locator('[data-score-key="equation_alignment"][data-option="na"]').click();
 await p.locator('.check-label').filter({has:p.locator('#reviewed-full-scope')}).click();await p.locator('#complete-review').click();await saved(contextA,names.a,r=>r.annotations.RL01.status==='completed');
 assert.deepEqual((await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a})).record.annotations.RL01.objects.equation,{compiled:'absent',official:'absent'});
 await p.locator('#next-paper').click();await assertSteppedTo(p,'RL02',2);assert.equal((await saved(contextA,names.a,r=>r.annotations.RL01.status==='completed')).annotations.RL01.status,'completed');report.checks.push('Next remains available immediately after completing a paper; stepping to the next paper preserves the completed record and focuses the new heading below the sticky bar');
 await p.reload();await p.locator('#continue-profile').waitFor({state:'visible'});await p.locator('#continue-profile').click();await rendered(p,'RL02');report.checks.push('Direct N/A maps to both-absent presence; completed record resumes at first unfinished paper; all eight score definitions default open');
 await p.locator('[data-score-key="figure_alignment"][data-option="1"]').click();
 assert.deepEqual(await p.locator('[data-object-reason-panel="figure"]').getAttribute('hidden'),null);
 assert.match(await p.locator('.score-card[data-key="figure_alignment"] .score-scale-list li').first().innerText(),/does not correspond\. Use 1/);
 const reasonGroup=p.locator('[data-object-reason-panel="figure"] [role="group"]');
 assert.equal(await reasonGroup.getAttribute('aria-label'),'Figure: Why is this item rated 1? Select one reason to complete the rating.');
 await p.locator('.language-button[data-language="zh"]').click();assert.equal(await reasonGroup.getAttribute('aria-label'),'图片: 此项为何评为 1？请选择一个原因以完成评分。');await p.locator('.language-button[data-language="en"]').click();
 assert.equal(await p.locator('[data-object-score-reason="figure"][data-reason="missing_in_compiled"]').getAttribute('aria-pressed'),'false');
 await saved(contextA,names.a,r=>r.annotations.RL02?.scores.figure_alignment===1&&r.annotations.RL02.object_score_reasons.figure===null&&r.annotations.RL02.objects.figure.compiled===null);
 const incomplete=await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a});assert.equal(incomplete.record.annotations.RL02.status,'draft');report.checks.push('Score 1 without a reason autosaves as an unfinished draft with blank presence mapping');
 await p.locator('#next-paper').click();await assertSteppedTo(p,'RL03',3);const movedDraft=await saved(contextA,names.a,r=>r.annotations.RL02.status==='draft'&&r.annotations.RL02.scores.figure_alignment===1&&r.annotations.RL02.object_score_reasons.figure===null);assert.equal(movedDraft.annotations.RL02.status,'draft');
 await p.locator('#previous-paper').click();await assertSteppedTo(p,'RL02',2);assert.equal(await p.locator('[data-score-key="figure_alignment"][data-option="1"]').getAttribute('aria-pressed'),'true');report.checks.push('Bottom Next/Previous moves away from an unfinished draft without completing it and restores its current score');
 for(const k of fields.filter(k=>k!=='figure_alignment'))await p.locator(`[data-score-key="${k}"][data-option="5"]`).click();
 await p.locator('.check-label').filter({has:p.locator('#reviewed-full-scope')}).click();
 await p.locator('#save-button').click();
 await saved(contextA,names.a,r=>r.annotations.RL02.status==='draft'&&fields.every(k=>r.annotations.RL02.scores[k]===(k==='figure_alignment'?1:5))&&r.annotations.RL02.evidence===''&&r.annotations.RL02.notes===''&&r.annotations.RL02.flags.length===0&&r.annotations.RL02.reviewed_full_scope===true);
 await p.locator('#complete-review').click();
 await p.waitForFunction(()=>{const n=document.querySelector('#validation-message');return n?.dataset.kind==='error'&&n.textContent.includes('Choose a reason for each object score of 1');});
 assert.equal((await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a})).record.annotations.RL02.status,'draft');
 report.checks.push('Completion remains blocked solely by the missing score-1 reason when evidence, notes, and flags are all empty');
 await p.locator('[data-object-score-reason="figure"][data-reason="missing_in_compiled"]').click();
 await p.locator('[data-score-key="table_alignment"][data-option="1"]').click();
 await p.locator('[data-object-score-reason="table"][data-reason="added_in_compiled"]').click();
 await p.locator('[data-score-key="equation_alignment"][data-option="1"]').click();
 await p.locator('[data-object-score-reason="equation"][data-reason="non_corresponding"]').click();
 await p.locator('[data-score-key="text_alignment"][data-option="4"]').click();
 await p.locator('[data-score-key="structure_alignment"][data-option="4"]').click();
 await p.locator('[data-score-key="content_coverage"][data-option="uncertain"]').click();
 await p.locator('[data-score-key="overall_alignment"][data-option="4"]').click();
 await p.locator('[data-score-key="visual_integrity"][data-option="3"]').click();
 await p.locator('#save-button').click();
 let reasoned=await saved(contextA,names.a,r=>r.annotations.RL02.object_score_reasons.figure==='missing_in_compiled'&&r.annotations.RL02.object_score_reasons.table==='added_in_compiled'&&r.annotations.RL02.object_score_reasons.equation==='non_corresponding');
 assert.deepEqual(reasoned.annotations.RL02.objects,{figure:{compiled:'absent',official:'present'},table:{compiled:'present',official:'absent'},equation:{compiled:'present',official:'present'}});assert.equal(reasoned.annotations.RL02.evidence,'');assert.equal(reasoned.annotations.RL02.notes,'');assert.deepEqual(reasoned.annotations.RL02.flags,[]);
 report.checks.push('All three score-1 reasons map to distinct presence states and persist independently with optional fields empty');
 await p.locator('[data-score-key="table_alignment"][data-option="2"]').click();
 await p.locator('[data-score-key="equation_alignment"][data-option="3"]').click();
 await p.locator('#save-button').click();
 reasoned=await saved(contextA,names.a,r=>r.annotations.RL02.object_score_reasons.figure==='missing_in_compiled'&&r.annotations.RL02.object_score_reasons.table===null&&r.annotations.RL02.object_score_reasons.equation===null&&r.annotations.RL02.scores.table_alignment===2&&r.annotations.RL02.scores.equation_alignment===3&&r.annotations.RL02.scores.text_alignment===4&&r.annotations.RL02.scores.structure_alignment===4&&r.annotations.RL02.scores.content_coverage==='uncertain'&&r.annotations.RL02.scores.overall_alignment===4&&r.annotations.RL02.scores.visual_integrity===3);
 assert.deepEqual(reasoned.annotations.RL02.objects,{figure:{compiled:'absent',official:'present'},table:{compiled:'present',official:'present'},equation:{compiled:'present',official:'present'}});assert.equal(reasoned.annotations.RL02.evidence,'');assert.equal(reasoned.annotations.RL02.notes,'');assert.deepEqual(reasoned.annotations.RL02.flags,[]);
 await p.locator('.score-card[data-key="figure_alignment"]').screenshot({path:path.join(artifacts,'integrated-object-scoring.png')});
 await p.locator('[data-score-key="figure_alignment"][data-option="4"]').click();
 assert.equal(await p.locator('[data-object-score-reason="figure"][data-reason="missing_in_compiled"]').getAttribute('aria-pressed'),'false');
 await p.locator('#save-button').click();
 reasoned=await saved(contextA,names.a,r=>r.annotations.RL02.scores.figure_alignment===4&&r.annotations.RL02.object_score_reasons.figure===null);
 assert.deepEqual(reasoned.annotations.RL02.objects.figure,{compiled:'present',official:'present'});
 await p.locator('[data-score-key="figure_alignment"][data-option="1"]').click();await p.locator('[data-object-score-reason="figure"][data-reason="missing_in_compiled"]').click();await p.locator('#save-button').click();
 await saved(contextA,names.a,r=>r.annotations.RL02.object_score_reasons.figure==='missing_in_compiled'&&r.annotations.RL02.objects.figure.compiled==='absent');
 await p.locator('#complete-review').click();const lowScoreCompleted=await saved(contextA,names.a,r=>r.annotations.RL02.status==='completed'&&r.annotations.RL02.evidence===''&&r.annotations.RL02.notes===''&&r.annotations.RL02.flags.length===0);
 assert.deepEqual(lowScoreCompleted.annotations.RL02.scores,{text_alignment:4,figure_alignment:1,table_alignment:2,equation_alignment:3,structure_alignment:4,content_coverage:'uncertain',overall_alignment:4,visual_integrity:3});
 await p.locator('.annotation-details-grid').scrollIntoViewIfNeeded();await p.locator('.annotation-details-grid').screenshot({path:path.join(artifacts,'optional-details.png')});
 await p.locator('.completion-flow').scrollIntoViewIfNeeded();await p.locator('.completion-flow').screenshot({path:path.join(artifacts,'completion-navigation-desktop.png')});
 await p.reload();await p.locator('#continue-profile').waitFor({state:'visible'});await p.locator('#continue-profile').click();await rendered(p,'RL03');assert.equal((await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a})).record.annotations.RL02.status,'completed');await p.locator('[data-sample-id="RL02"]').click();await rendered(p,'RL02');
 assert.equal(await p.locator('[data-object-score-reason="figure"][data-reason="missing_in_compiled"]').getAttribute('aria-pressed'),'true');
 assert.deepEqual(await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a}).then(r=>r.record.annotations.RL02.objects),{figure:{compiled:'absent',official:'present'},table:{compiled:'present',official:'present'},equation:{compiled:'present',official:'present'}});
 report.checks.push('Changing score 1 to 4 clears its stale reason and presence mapping; reload restores the selected score-1 reason and derived presence');
 await p.locator('[data-sample-id="RL03"]').click();await rendered(p,'RL03');
 for(const k of fields)await p.locator(`[data-score-key="${k}"][data-option="5"]`).click();
 await p.locator('[data-score-key="overall_alignment"][data-option="2"]').click();
 for(const flag of ['appendix_difference','references_difference','critical_difference']){
  const input=p.locator(`[data-flag-key="${flag}"]`);
  await p.locator('.flag-option').filter({has:input}).click();assert.equal(await input.isChecked(),true);
 }
 await p.locator('.check-label').filter({has:p.locator('#reviewed-full-scope')}).click();await p.locator('#save-button').click();
 await saved(contextA,names.a,r=>r.annotations.RL03?.status==='draft'&&r.annotations.RL03.scores.overall_alignment===2&&r.annotations.RL03.flags.includes('critical_difference')&&r.annotations.RL03.evidence===''&&r.annotations.RL03.notes==='');
 await p.locator('#complete-review').click();const flaggedCompleted=await saved(contextA,names.a,r=>r.annotations.RL03.status==='completed'&&r.annotations.RL03.evidence===''&&r.annotations.RL03.notes===''&&r.annotations.RL03.flags.length===3);
 assert.equal(flaggedCompleted.annotations.RL03.scores.overall_alignment,2);assert.ok(flaggedCompleted.annotations.RL03.flags.includes('critical_difference'));assert.ok(flaggedCompleted.annotations.RL03.flags.includes('appendix_difference'));assert.ok(flaggedCompleted.annotations.RL03.flags.includes('references_difference'));
 await p.reload();await p.locator('#continue-profile').waitFor({state:'visible'});await p.locator('#continue-profile').click();await rendered(p,'RL04');assert.equal((await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a})).record.annotations.RL03.status,'completed');report.checks.push('Low scores 1–4 and Uncertain save, complete, and restore with blank evidence/notes and no flags; selected optional flags also complete without evidence when Critical Difference has valid Overall 2');
 await p.setViewportSize({width:712,height:797});let workspaceWidth=await p.evaluate(()=>document.documentElement.scrollWidth);assert.ok(workspaceWidth<=712,`Authenticated workspace overflows at 712px: ${workspaceWidth}px`);await p.locator('#next-paper').scrollIntoViewIfNeeded();assert.ok(await p.locator('#next-paper').isVisible());assert.ok(await p.locator('#previous-paper').isVisible());const tabletNav=await p.locator('.paper-stepper-bottom').boundingBox();assert.ok(tabletNav&&tabletNav.x>=0&&tabletNav.x+tabletNav.width<=712);await p.locator('#next-paper').click();await assertSteppedTo(p,'RL05',5);
 await p.setViewportSize({width:390,height:844});workspaceWidth=await p.evaluate(()=>document.documentElement.scrollWidth);assert.ok(workspaceWidth<=390,`Authenticated workspace overflows at 390px: ${workspaceWidth}px`);await p.locator('#previous-paper').scrollIntoViewIfNeeded();assert.ok(await p.locator('#previous-paper').isVisible());assert.ok(await p.locator('#next-paper').isVisible());const mobileNav=await p.locator('.paper-stepper-bottom').boundingBox();assert.ok(mobileNav&&mobileNav.x>=0&&mobileNav.x+mobileNav.width<=390);await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('html').evaluate(node=>getComputedStyle(node).scrollBehavior),'auto');await p.locator('#previous-paper').click();await assertSteppedTo(p,'RL04',4);await p.locator('.completion-flow').scrollIntoViewIfNeeded();await p.locator('.completion-flow').screenshot({path:path.join(artifacts,'completion-navigation-mobile.png')});await p.emulateMedia({reducedMotion:'no-preference'});report.checks.push('Bottom Next/Previous stays visible and within the viewport at 712px/390px; movement focuses the heading, honors reduced motion, and produces mobile and desktop previews');
 await p.setViewportSize({width:1600,height:1050});
 const exportWait=p.waitForEvent('download');await p.locator('#export-button').click();const exported=JSON.parse(fs.readFileSync(await (await exportWait).path(),'utf8'));assert.equal(exported.annotations.RL01.status,'completed');assert.ok(!JSON.stringify(exported).includes(codeA));report.checks.push('Export uses canonical saved SQL record with original v1 schema and no recovery credential');
 const contextDevice2=await freshContext(),second=await fresh(contextDevice2);await second.locator('#mode-restore-profile').click();await second.locator('#annotator-id').fill(names.a);await second.locator('#annotator-code').fill('f'.repeat(64));await second.locator('#load-session').click();await second.locator('#login-error').waitFor({state:'visible'});assert.ok(await second.locator('#annotation-app').isHidden());
 await second.locator('#annotator-code').fill(codeA);await second.locator('#load-session').click();await rendered(second,'RL04');report.checks.push('New-device anonymous identity rejects wrong recovery code and restores same profile using its correct code');
 await p.locator('#notes').fill(note+' first writer');await saved(contextA,names.a,r=>r.annotations.RL04?.notes===note+' first writer');
 await second.locator('#notes').fill(note+' stale writer');await second.locator('#save-button').click();await second.waitForFunction(()=>document.querySelector('#save-status').dataset.state==='conflict');await second.locator('#switch-annotator').click();assert.ok(await second.locator('#annotation-app').isVisible());assert.ok(await second.locator('[data-download-recovery]').isVisible());assert.equal((await rpc(contextA,'xacl_load_annotations',{p_annotator_id:names.a})).record.annotations.RL04.notes,note+' first writer');report.checks.push('Two device identities share one participant safely; stale SQL save conflicts, switch blocks, recovery survives');
 const contextB=await freshContext(),other=await fresh(contextB);const codeB=await create(other,names.b);assert.equal(await other.locator('#notes').inputValue(),'');await other.locator('#notes').fill(note+' profile B');await saved(contextB,names.b,r=>r.annotations.RL01?.notes===note+' profile B');
 const denied=await rpc(contextB,'xacl_load_annotations',{p_annotator_id:names.a});assert.equal(denied.error,'invalid_access');report.checks.push('Self-registered profile B cannot read profile A even with its known nickname; direct SQL RPC honors auth.uid binding');
 const imported=structuredClone(exported);imported.annotator_id=names.b;imported.revision=999;imported.annotations.RL02={...structuredClone(imported.annotations.RL01),status:'draft',notes:note+' imported'};
 const legacy=structuredClone(imported.annotations.RL01);delete legacy.scoring_protocol;delete legacy.object_score_reasons;legacy.status='draft';legacy.scores.figure_alignment=3;legacy.scores.table_alignment='na';legacy.scores.equation_alignment=4;legacy.objects={figure:{compiled:'present',official:'present'},table:{compiled:'absent',official:'absent'},equation:{compiled:'present',official:'present'}};legacy.evidence='Legacy compatibility software fixture.';legacy.notes='Original legacy note.';legacy.flags=['appendix_difference'];legacy.reviewed_full_scope=true;imported.annotations.RL03=legacy;
 const importFile=path.join(artifacts,'synthetic-import.json');fs.writeFileSync(importFile,JSON.stringify(imported));other.once('dialog',d=>d.accept());await other.locator('#import-file').setInputFiles(importFile);await rendered(other,'RL02');await saved(contextB,names.b,r=>r.annotations.RL02?.notes===note+' imported');assert.equal(await other.locator('#annotation-app').getAttribute('inert'),null);report.checks.push('Legacy JSON import uses current cloud revision, not imported999; successful import restores unfinished draft and releases UI lock');
 const importedLegacy=await saved(contextB,names.b,r=>r.annotations.RL03?.scoring_protocol==='integrated-presence-v1'&&r.annotations.RL03.notes===legacy.notes&&r.annotations.RL03.scores.figure_alignment===null);
 const convertedImport=importedLegacy.annotations.RL03;assert.deepEqual(convertedImport.object_score_reasons,{figure:null,table:null,equation:null});assert.deepEqual(convertedImport.objects,{figure:{compiled:null,official:null},table:{compiled:null,official:null},equation:{compiled:null,official:null}});assert.deepEqual(convertedImport.scores,{...legacy.scores,figure_alignment:null,table_alignment:null,equation_alignment:null});assert.equal(convertedImport.reviewed_full_scope,false);assert.equal(convertedImport.status,'draft');assert.equal(convertedImport.evidence,legacy.evidence);assert.deepEqual(convertedImport.flags,legacy.flags);
 await other.locator('[data-sample-id="RL03"]').click();assert.equal(await other.locator('#object-protocol-notice').isHidden(),true);assert.equal(await other.locator('#convert-legacy-object-scores').count(),0);assert.equal(await other.locator('[data-score-key="figure_alignment"][data-option="3"]').isDisabled(),false);report.checks.push('Old-format imported paper auto-resets only three object ratings before server save; other scores, notes, evidence, flags and identities stay intact and current controls are editable');
 await other.locator('#switch-annotator').click();await other.locator('#load-session').waitFor({state:'visible'});assert.equal(await tokenFor(contextB),null);assert.ok(await other.locator('#annotation-app').isHidden());report.checks.push('Switch flushes saved content and signs out local anonymous session; original data remains retrievable with recovery code');
 const mobile=await fresh(contextB);await mobile.setViewportSize({width:390,height:844});await mobile.screenshot({path:path.join(artifacts,'hosted-login-mobile.png')});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.checks.push('Create/restore landing page fits 390px mobile screen');
 const contextC=await freshContext(),currentRules=await fresh(contextC);await create(currentRules,names.c);
 let seeded=await rpc(contextC,'xacl_load_annotations',{p_annotator_id:names.c}).then(r=>r.record);seeded.annotations.RL01=legacyAnnotation('Server-side old-format note.','Server-side old-format evidence.');seeded.updated_at='2026-10-20T12:00:00.000Z';
 const legacySeed=await saveRecord(contextC,names.c,seeded);assert.equal(legacySeed.revision,seeded.revision+1);assert.equal(Object.hasOwn(legacySeed.annotations.RL01,'scoring_protocol'),false);
 await currentRules.reload();await currentRules.locator('#continue-profile').waitFor({state:'visible'});await currentRules.locator('#continue-profile').click();await rendered(currentRules,'RL01');
 const autoMigrated=await saved(contextC,names.c,r=>r.revision===legacySeed.revision+1&&r.annotations.RL01?.scoring_protocol==='integrated-presence-v1'&&r.annotations.RL01.scores.figure_alignment===null);
 const autoRow=autoMigrated.annotations.RL01;assert.equal(autoMigrated.created_at,legacySeed.created_at);assert.deepEqual(autoRow.scores,{...legacySeed.annotations.RL01.scores,figure_alignment:null,table_alignment:null,equation_alignment:null});assert.deepEqual(autoRow.objects,{figure:{compiled:null,official:null},table:{compiled:null,official:null},equation:{compiled:null,official:null}});assert.deepEqual(autoRow.object_score_reasons,{figure:null,table:null,equation:null});assert.equal(autoRow.notes,legacySeed.annotations.RL01.notes);assert.equal(autoRow.evidence,legacySeed.annotations.RL01.evidence);assert.deepEqual(autoRow.flags,legacySeed.annotations.RL01.flags);assert.equal(autoRow.status,'draft');assert.equal(autoRow.reviewed_full_scope,false);assert.equal(await currentRules.locator('#object-protocol-notice').isHidden(),true);assert.equal(await currentRules.locator('#convert-legacy-object-scores').count(),0);
 await currentRules.screenshot({path:path.join(artifacts,'auto-current-rules.png')});report.checks.push('Session entry automatically saves a clone with only three old object judgments reset; other five scores and row/envelope identity fields are retained');
 await currentRules.reload();await currentRules.locator('#continue-profile').waitFor({state:'visible'});await currentRules.locator('#continue-profile').click();await rendered(currentRules,'RL01');await sleep(800);
 const stableIntegrated=await rpc(contextC,'xacl_load_annotations',{p_annotator_id:names.c}).then(r=>r.record);assert.equal(stableIntegrated.revision,autoMigrated.revision);assert.deepEqual(stableIntegrated.annotations.RL01,autoRow);report.checks.push('A second session entry leaves an already-integrated row and server revision unchanged');
 const serverBeforeRecovery=await rpc(contextC,'xacl_load_annotations',{p_annotator_id:names.c}).then(r=>r.record);serverBeforeRecovery.annotations.RL01=legacyAnnotation('Server version before local recovery.','Server evidence before local recovery.');serverBeforeRecovery.updated_at='2026-10-21T12:00:00.000Z';
 const recoverySeed=await saveRecord(contextC,names.c,serverBeforeRecovery);const recoveryRecord=structuredClone(recoverySeed);recoveryRecord.annotations.RL01=legacyAnnotation('Local recovery note preserved.','Local recovery evidence preserved.');
 const localRecovery={record:recoveryRecord,saved_revision:recoveryRecord.revision,unsaved:true};const recoveryJson=JSON.stringify(localRecovery),recoveryKey=recoveryStorageKey(names.c);
 await currentRules.evaluate(({key,value})=>localStorage.setItem(key,value),{key:recoveryKey,value:recoveryJson});await currentRules.reload();await currentRules.locator('#continue-profile').waitFor({state:'visible'});await currentRules.locator('#continue-profile').click();await rendered(currentRules,'RL01');
 assert.ok(await currentRules.locator('[data-recover-local]').isVisible());await sleep(1200);const deferredServer=await rpc(contextC,'xacl_load_annotations',{p_annotator_id:names.c}).then(r=>r.record);assert.equal(deferredServer.revision,recoverySeed.revision);assert.equal(Object.hasOwn(deferredServer.annotations.RL01,'scoring_protocol'),false);assert.equal(deferredServer.annotations.RL01.scores.figure_alignment,3);assert.equal(await currentRules.evaluate(key=>localStorage.getItem(key),recoveryKey),recoveryJson);
 await currentRules.locator('[data-recover-local]').click();const recovered=await saved(contextC,names.c,r=>r.revision===recoverySeed.revision+1&&r.annotations.RL01?.scoring_protocol==='integrated-presence-v1'&&r.annotations.RL01.notes==='Local recovery note preserved.');
 assert.equal(recovered.created_at,recoverySeed.created_at);assert.deepEqual(recovered.annotations.RL01.scores,{...recoveryRecord.annotations.RL01.scores,figure_alignment:null,table_alignment:null,equation_alignment:null});assert.deepEqual(recovered.annotations.RL01.objects,{figure:{compiled:null,official:null},table:{compiled:null,official:null},equation:{compiled:null,official:null}});assert.equal(recovered.annotations.RL01.evidence,'Local recovery evidence preserved.');assert.deepEqual(recovered.annotations.RL01.flags,recoveryRecord.annotations.RL01.flags);assert.equal(recovered.annotations.RL01.reviewed_full_scope,false);assert.equal(recovered.annotations.RL01.status,'draft');assert.equal(await currentRules.locator('#object-protocol-notice').isHidden(),true);assert.equal(await currentRules.locator('#convert-legacy-object-scores').count(),0);
 report.checks.push('Same-revision legacy local recovery defers startup autosave without advancing server revision or changing the backup; explicit restore converts and saves only current object fields');
 await currentRules.setViewportSize({width:712,height:797});let documentWidth=await currentRules.evaluate(()=>document.documentElement.scrollWidth);assert.ok(documentWidth<=712,`Authenticated annotation workspace overflows at 712px: ${documentWidth}px`);
 await currentRules.setViewportSize({width:390,height:844});documentWidth=await currentRules.evaluate(()=>document.documentElement.scrollWidth);assert.ok(documentWidth<=390,`Authenticated annotation workspace overflows at 390px: ${documentWidth}px`);await currentRules.locator('#rubric-scoring').screenshot({path:path.join(artifacts,'mobile-rubric.png')});
 await currentRules.setViewportSize({width:1600,height:1050});report.checks.push('Authenticated annotation workspace has no document-level horizontal overflow at 712px or 390px; narrow rubric screenshot captured');
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.unexpected_requests,[]);report.status='passed';console.log(JSON.stringify(report,null,2));
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(server)server.kill('SIGTERM');});
