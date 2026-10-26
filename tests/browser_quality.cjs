// Synthetic browser QA for the document-quality protocol against disposable PostgreSQL.
// Never use this fixture or its judgments as human annotation data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.runtime', 'browser-quality-results');
fs.mkdirSync(artifacts, { recursive: true });
const config = JSON.parse(fs.readFileSync(path.join(root, 'site/config.json'), 'utf8'));
const scoreKeys = [
  'language_clarity', 'coherence_flow', 'structural_completeness',
  'technical_presentation', 'visual_integrity', 'overall_quality',
];
const versionDifferenceKeys = [
  'text_revision', 'scientific_content_revision', 'technical_objects_revision',
  'structure_revision', 'references_revision', 'appendix_revision', 'identity_uncertain',
];
const annotatorId = `QA_QUALITY_${process.pid}_${Date.now().toString(36)}`;
const report = {
  software_test_only: true,
  human_annotation: false,
  protocol_id: 'document-quality-v1',
  auth_gateway: 'synthetic test transport; official SDK and real PostgreSQL authorization',
  checks: [], quality_rpc_calls: [], page_errors: [], unexpected_requests: [],
};

let server, browser, base, origin, recoveryCode;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function legacyRecoveryKey(id) {
  return `xacl.annotation.recovery:${encodeURIComponent(config.supabase_url)}:${encodeURIComponent(config.study_id)}:${config.manifest_sha256}:${encodeURIComponent(id)}`;
}

function qualityRecoveryKey(id) {
  return `xacl.document-quality-v1.recovery:${encodeURIComponent(config.supabase_url)}:${encodeURIComponent(config.study_id)}:${config.manifest_sha256}:${encodeURIComponent(id)}`;
}

async function tokenFor(context) {
  const state = await context.storageState();
  for (const item of state.origins.flatMap((entry) => entry.localStorage)) {
    try {
      const value = JSON.parse(item.value);
      if (value.access_token && value.user?.id) return value.access_token;
    } catch { /* Other local storage values are not Supabase sessions. */ }
  }
  return null;
}

async function rpc(context, name, args = {}) {
  const token = await tokenFor(context);
  const response = await context.request.post(`${origin}/__rpc/${name}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, data: args,
  });
  const payload = await response.json();
  assert.ok(response.ok(), `${name} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function qualityRecord(context, id) {
  return (await rpc(context, 'xacl_quality_load_annotations', { p_annotator_id: id })).record;
}

async function saved(context, id, predicate) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const record = await qualityRecord(context, id);
    if (record && predicate(record)) return record;
    await sleep(100);
  }
  throw new Error('Timed out waiting for the quality record to save.');
}

async function freshContext(id, { qualityHealthUnavailable = false } = {}) {
  const context = await browser.newContext({
    acceptDownloads: true, viewport: { width: 1600, height: 1050 }, locale: 'en-GB',
  });
  const oldKey = legacyRecoveryKey(id);
  const oldValue = JSON.stringify({
    schema: 'xacl.annotation-record.v1',
    annotations: { RL01: { notes: 'LEGACY_BACKUP_SENTINEL', scores: { visual_integrity: 5 } } },
  });
  await context.addInitScript(`(() => {
    if (location.origin === 'null') return;
    const key = ${JSON.stringify(oldKey)};
    const sentinel = ${JSON.stringify(oldValue)};
    const rawGet = Storage.prototype.getItem;
    const rawSet = Storage.prototype.setItem;
    const rawRemove = Storage.prototype.removeItem;
    window.__qualityRawGet = rawGet;
    window.__qualityLegacyStorageCalls = [];
    if (rawGet.call(localStorage, key) === null) rawSet.call(localStorage, key, sentinel);
    Storage.prototype.getItem = function (name) {
      if (name === key) window.__qualityLegacyStorageCalls.push(['get', name]);
      return rawGet.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) window.__qualityLegacyStorageCalls.push(['set', name]);
      return rawSet.call(this, name, value);
    };
    Storage.prototype.removeItem = function (name) {
      if (name === key) window.__qualityLegacyStorageCalls.push(['remove', name]);
      return rawRemove.call(this, name);
    };
  })();`);
  const supabaseOrigin = new URL(config.supabase_url).origin;
  await context.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.headers().apikey, config.supabase_publishable_key);
    assert.notEqual(request.headers().authorization, `Bearer ${config.supabase_publishable_key}`);
    const target = url.pathname.startsWith('/auth/v1/')
      ? `/__auth/${url.pathname.slice('/auth/v1/'.length)}${url.search}`
      : `/__rpc/${url.pathname.split('/').pop()}`;
    if (target.startsWith('/__rpc/')) report.quality_rpc_calls.push(target.slice('/__rpc/'.length));
    if (qualityHealthUnavailable && target === '/__rpc/xacl_quality_annotation_health') {
      await route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"quality protocol not installed"}' });
      return;
    }
    const headers = request.headers().authorization ? { Authorization: request.headers().authorization } : {};
    const response = await context.request.fetch(`${origin}${target}`, {
      method: request.method(), headers,
      ...(request.postData() ? { data: request.postDataJSON() } : {}),
    });
    await route.fulfill({
      status: response.status(), contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: await response.body(),
    });
  });
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', new URL(config.supabase_url).hostname].includes(url.hostname)) {
      report.unexpected_requests.push(url.origin);
    }
  });
  context.on('page', (page) => page.on('pageerror', (error) => report.page_errors.push(error.message)));
  return context;
}

async function fresh(context) {
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => {
    const button = document.querySelector('#load-session');
    return button && !button.disabled && button.getBoundingClientRect().height > 0;
  });
  return page;
}

async function rendered(page, sampleId) {
  await page.waitForFunction((id) => document.querySelector(`[data-sample-id="${id}"]`)?.getAttribute('aria-current') === 'true', sampleId);
  await page.waitForFunction((id) => ['compiled', 'official'].every((side) => {
    const canvas = document.querySelector(`[data-canvas="${side}"]`);
    const stage = document.querySelector(`[data-stage="${side}"]`);
    return canvas && !canvas.classList.contains('is-hidden') && canvas.width > 0 &&
      canvas.dataset.renderedSample === id && canvas.dataset.renderedPage === '1' &&
      stage?.getAttribute('aria-busy') === 'false';
  }), sampleId, { timeout: 60000 });
}

async function renderedPages(page, sampleId, compiledPage, officialPage) {
  await page.waitForFunction(({ id, compiled, official }) => {
    return [['compiled', compiled], ['official', official]].every(([side, expected]) => {
      const canvas = document.querySelector(`[data-canvas="${side}"]`);
      const stage = document.querySelector(`[data-stage="${side}"]`);
      return canvas && !canvas.classList.contains('is-hidden') && canvas.width > 0 &&
        canvas.dataset.renderedSample === id && canvas.dataset.renderedPage === String(expected) &&
        stage?.getAttribute('aria-busy') === 'false';
    });
  }, { id: sampleId, compiled: compiledPage, official: officialPage }, { timeout: 60000 });
  assert.equal(await page.locator('[data-page-input="compiled"]').inputValue(), String(compiledPage));
  assert.equal(await page.locator('[data-page-input="official"]').inputValue(), String(officialPage));
}

async function setPageInput(page, side, target) {
  const input = page.locator(`[data-page-input="${side}"]`);
  await input.fill(String(target));
  await input.press('Enter');
  const renderedTarget = Math.max(1, Math.round(target));
  await page.waitForFunction(({ side: activeSide, expected }) => {
    const canvas = document.querySelector(`[data-canvas="${activeSide}"]`);
    const stage = document.querySelector(`[data-stage="${activeSide}"]`);
    return canvas?.dataset.renderedPage === String(expected) && stage?.getAttribute('aria-busy') === 'false';
  }, { side, expected: renderedTarget }, { timeout: 60000 });
  assert.equal(await input.inputValue(), String(renderedTarget));
  return renderedTarget;
}

async function setSync(page, enabled) {
  const toggle = page.locator('#sync-pdf-pages');
  if (await toggle.isChecked() !== enabled) await page.locator('.sync-toggle').click();
  assert.equal(await toggle.isChecked(), enabled);
}

async function assertSyncTogglePlacement(page, focused) {
  const state = await page.evaluate(() => {
    const toggle = document.querySelector('#sync-pdf-pages');
    const toolbar = document.querySelector('#viewer-focus-toolbar');
    return {
      count: document.querySelectorAll('#sync-pdf-pages').length,
      stable: toggle === window.__originalSyncToggle,
      focused: toggle?.closest('.sync-toggle')?.parentElement === document.querySelector('#sync-pdf-pages-focus-slot'),
      normal: toggle?.closest('.sync-toggle')?.parentElement === document.querySelector('#sync-pdf-pages-normal-slot'),
      toolbarHidden: toolbar?.hidden === true,
    };
  });
  assert.equal(state.count, 1);
  assert.equal(state.stable, true);
  assert.equal(state.focused, focused);
  assert.equal(state.normal, !focused);
  assert.equal(state.toolbarHidden, !focused);
}

async function expandedViewerLayout(page, width, height, sampleId, compiledPage, officialPage) {
  await page.evaluate(() => {
    for (const side of ['compiled', 'official']) {
      const stage = document.querySelector(`[data-stage="${side}"]`);
      stage.dataset.resizeRenderMutations = '0';
      stage.__qualityResizeObserver = new MutationObserver((records) => {
        stage.dataset.resizeRenderMutations = String(Number(stage.dataset.resizeRenderMutations) + records.length);
      });
      stage.__qualityResizeObserver.observe(stage, { attributes: true, attributeFilter: ['aria-busy'] });
    }
  });
  await page.setViewportSize({ width, height });
  await page.locator('#official-viewer').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => ['compiled', 'official'].every((side) => {
    const stage = document.querySelector(`[data-stage="${side}"]`);
    return Number(stage?.dataset.resizeRenderMutations) > 0 && stage?.getAttribute('aria-busy') === 'false';
  }), null, { timeout: 60000 });
  await page.evaluate(() => {
    for (const side of ['compiled', 'official']) document.querySelector(`[data-stage="${side}"]`).__qualityResizeObserver.disconnect();
  });
  await renderedPages(page, sampleId, compiledPage, officialPage);
  return page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const toolbar = document.querySelector('#viewer-focus-toolbar');
    const toggle = toolbar.querySelector('.sync-toggle');
    const exit = toolbar.querySelector('[data-exit-focus]');
    const hit = (node) => {
      const r = node.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight && (top === node || node.contains(top));
    };
    return {
      width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      topbar: rect('.topbar'), toolbar: rect('#viewer-focus-toolbar'),
      target: rect('#compiled-viewer'), reference: rect('#official-viewer'),
      toolbarVisible: !toolbar.hidden, switchHit: hit(toggle), exitHit: hit(exit),
      compiledPage: document.querySelector('[data-canvas="compiled"]').dataset.renderedPage,
      officialPage: document.querySelector('[data-canvas="official"]').dataset.renderedPage,
    };
  });
}

async function createProfile(page, id) {
  await page.locator('#annotator-id').fill(id);
  await page.locator('#load-session').click();
  await page.locator('#recovery-code-panel').waitFor({ state: 'visible' });
  const code = (await page.locator('#recovery-code-display').textContent()).trim();
  assert.match(code, /^[0-9a-f]{64}$/);
  assert.ok(await page.locator('#annotation-app').isHidden());
  assert.ok(await page.locator('#continue-after-recovery').isDisabled());
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-recovery-code').click();
  const download = await downloadPromise;
  assert.ok(fs.readFileSync(await download.path(), 'utf8').includes(code));
  await page.locator('#recovery-code-saved').check();
  await page.locator('#continue-after-recovery').click();
  await rendered(page, 'RL01');
  return code;
}

async function restoreProfile(page, id, code) {
  await page.locator('#mode-restore-profile').click();
  await page.locator('#annotator-id').fill(id);
  await page.locator('#annotator-code').fill(code);
  await page.locator('#load-session').click();
  await rendered(page, 'RL03');
}

async function checkLegacyStorageUntouched(page) {
  const calls = await page.evaluate(() => window.__qualityLegacyStorageCalls);
  assert.deepEqual(calls, [], 'The previous protocol recovery key must never be read, written, or removed.');
  const stored = await page.evaluate((key) => window.__qualityRawGet.call(localStorage, key), legacyRecoveryKey(annotatorId));
  assert.equal(stored, JSON.stringify({
    schema: 'xacl.annotation-record.v1',
    annotations: { RL01: { notes: 'LEGACY_BACKUP_SENTINEL', scores: { visual_integrity: 5 } } },
  }));
}

(async () => {
  if (process.env.XACL_DISPOSABLE_DATABASE !== '1') throw new Error('Set XACL_DISPOSABLE_DATABASE=1 only for an isolated test database.');
  if (!process.env.QA_DATABASE_URL) throw new Error('QA_DATABASE_URL must point to a disposable PostgreSQL database.');
  server = spawn(process.env.PYTHON_BIN || 'python3', ['tests/browser_server.py'], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErrors = '';
  server.stderr.on('data', (chunk) => { serverErrors += chunk; });
  base = await new Promise((resolve, reject) => {
    server.stdout.once('data', (chunk) => resolve(chunk.toString().trim()));
    server.once('exit', () => reject(new Error(serverErrors || 'The QA bridge exited before it was ready.')));
    setTimeout(() => reject(new Error('QA server startup timed out.')), 10000).unref();
  });
  origin = new URL(base).origin;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
    args: ['--disable-crash-reporter', '--disable-crashpad'],
  });

  const lockContext = await freshContext(`${annotatorId}_LOCK`, { qualityHealthUnavailable: true });
  const lockedPage = await lockContext.newPage();
  await lockedPage.goto(base);
  await lockedPage.waitForFunction(() => /not ready/i.test(document.querySelector('#login-error')?.innerText || ''));
  assert.equal(await lockedPage.locator('#load-session').isDisabled(), true);
  assert.equal(await lockedPage.locator('#annotation-app').isHidden(), true);
  assert.deepEqual(report.quality_rpc_calls.filter((name) => name.startsWith('xacl_') && !name.startsWith('xacl_quality_')), []);
  await lockContext.close();
  report.checks.push('If the quality backend health endpoint is unavailable, profile creation and scoring stay locked without calling legacy RPCs');

  const contextA = await freshContext(annotatorId);
  const page = await fresh(contextA);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#annotation-app').isHidden(), true);
  assert.equal(await tokenFor(contextA), null, 'Opening the landing page must not register or sign in automatically.');
  recoveryCode = await createProfile(page, annotatorId);
  await rendered(page, 'RL01');
  assert.equal(await page.locator('#protocol-banner').innerText(), 'New document-quality protocol. Previous alignment ratings are preserved separately. Please rate each paper anew.');
  await page.locator('.language-button[data-language="zh"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh');
  assert.equal(await page.locator('#protocol-banner').innerText(), '新的文档质量协议。此前的版本对齐评分已单独保留。请为每篇论文重新评分。');
  await page.locator('.language-button[data-language="en"]').click();
  assert.equal(await page.locator('#completion-count').innerText(), '0 / 30');
  assert.deepEqual(await page.locator('[data-score-key]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.scoreKey))]), scoreKeys);
  assert.equal(await page.locator('.score-scale-details').count(), 6);
  assert.equal(await page.locator('.score-scale-details[open]').count(), 6);
  assert.deepEqual(await page.locator('[data-option="uncertain"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.scoreKey)), scoreKeys);
  assert.deepEqual(await page.locator('[data-option="na"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.scoreKey)), ['technical_presentation']);
  assert.equal(await page.locator('.score-card[data-key="overall_quality"] .overall-rule').innerText(), 'Judge overall quality directly; do not average the other dimensions.');
  assert.match(await page.locator('#compiled-viewer').getAttribute('aria-label'), /compiled/i);
  assert.match(await page.locator('#official-viewer').getAttribute('aria-label'), /optional/i);
  assert.equal(await page.locator('#import-file').count(), 0);
  assert.equal(await page.locator('#import-button, #export-button').count(), 0);
  assert.equal(await page.locator('button').filter({ hasText: /import|export/i }).count(), 0);
  assert.match(await page.locator('.version-observations .field-description').innerText(), /do not affect quality scores or completion/i);
  assert.equal(await page.locator('#version-notes').getAttribute('maxlength'), '12000');
  assert.match(await page.locator('#version-notes-count').innerText(), /0 \/ 12000/);
  const emptyRecord = await qualityRecord(contextA, annotatorId);
  assert.deepEqual(Object.keys(emptyRecord).sort(), ['schema', 'protocol_id', 'dataset_id', 'manifest_sha256', 'rubric_version', 'annotator_id', 'revision', 'created_at', 'updated_at', 'annotations'].sort());
  assert.deepEqual(emptyRecord.annotations, {}, 'A new protocol must start with no copied or prefetched per-paper answers.');
  await checkLegacyStorageUntouched(page);
  report.checks.push('New profile and recovery code, English default, 0/30 unanswered quality progress, exactly six open score definitions, technical-only N/A, compiled target with optional official reference, no participant data import/export, and no legacy answers or local recovery access');

  const scores = [5, 4, 3, 2, 1, 5];
  for (const [index, key] of scoreKeys.entries()) await page.locator(`[data-score-key="${key}"][data-option="${scores[index]}"]`).click();
  for (const key of versionDifferenceKeys) {
    const input = page.locator(`[data-version-difference-key="${key}"]`);
    await page.locator('.flag-option').filter({ has: input }).click();
    assert.equal(await input.isChecked(), true);
  }
  await page.locator('#version-notes').fill('Synthetic QA version observations; not a human judgment.');
  await page.locator('#evidence').fill('Synthetic QA evidence, page 1.');
  await page.locator('#notes').fill('Synthetic QA private note.');
  await page.locator('.check-label').filter({ has: page.locator('#reviewed-full-scope') }).click();
  await page.locator('#complete-review').click();
  const allFlags = await saved(contextA, annotatorId, (record) => record.annotations.RL01?.status === 'completed');
  const rowOne = allFlags.annotations.RL01;
  assert.deepEqual(Object.keys(rowOne).sort(), ['scores', 'version_differences', 'version_notes', 'evidence', 'notes', 'reviewed_full_scope', 'status', 'updated_at'].sort());
  assert.deepEqual(rowOne.scores, Object.fromEntries(scoreKeys.map((key, index) => [key, scores[index]])));
  assert.deepEqual(rowOne.version_differences, versionDifferenceKeys);
  assert.equal(rowOne.version_notes, 'Synthetic QA version observations; not a human judgment.');
  assert.equal(rowOne.reviewed_full_scope, true);
  assert.equal(rowOne.status, 'completed');
  const revisionAfterComplete = allFlags.revision;
  await page.locator('#save-button').click();
  const stableSaved = await saved(contextA, annotatorId, (record) => record.revision >= revisionAfterComplete && record.annotations.RL01?.status === 'completed');
  assert.deepEqual(stableSaved.annotations.RL01, rowOne, 'Acknowledge-save must preserve every completed field exactly.');
  await page.reload();
  await page.locator('#continue-profile').waitFor({ state: 'visible' });
  await page.locator('#continue-profile').click();
  await rendered(page, 'RL02');
  assert.equal(await page.locator('#completion-count').innerText(), '1 / 30');
  assert.deepEqual(await page.locator('[data-version-difference-key]').evaluateAll((nodes) => nodes.filter((node) => node.checked).map((node) => node.dataset.versionDifferenceKey)), []);
  const rowOneAfterReload = (await qualityRecord(contextA, annotatorId)).annotations.RL01;
  assert.deepEqual(rowOneAfterReload, rowOne);
  await checkLegacyStorageUntouched(page);
  report.checks.push('All six scores, all seven unique version flags, optional notes/evidence, and compiled full-scope confirmation complete, save, and reload without alteration; resume selects first unfinished paper RL02');

  const lowScores = {
    language_clarity: 1, coherence_flow: 2, structural_completeness: 3,
    technical_presentation: 'na', visual_integrity: 'uncertain', overall_quality: 4,
  };
  for (const [key, value] of Object.entries(lowScores)) await page.locator(`[data-score-key="${key}"][data-option="${value}"]`).click();
  await page.locator('.check-label').filter({ has: page.locator('#reviewed-full-scope') }).click();
  await page.locator('#complete-review').click();
  const blankOptionals = await saved(contextA, annotatorId, (record) => record.annotations.RL02?.status === 'completed');
  const rowTwo = blankOptionals.annotations.RL02;
  assert.deepEqual(rowTwo.scores, lowScores);
  assert.deepEqual(rowTwo.version_differences, []);
  assert.equal(rowTwo.version_notes, '');
  assert.equal(rowTwo.evidence, '');
  assert.equal(rowTwo.notes, '');
  assert.equal(rowTwo.reviewed_full_scope, true);
  await page.locator('[data-sample-id="RL03"]').click();
  await rendered(page, 'RL03');
  await page.locator('#complete-review').click();
  await page.waitForFunction(() => document.querySelector('#validation-message')?.dataset.kind === 'error');
  assert.match(await page.locator('#validation-message').innerText(), /Rate all six dimensions/);
  assert.match(await page.locator('#validation-message').innerText(), /Confirm that you reviewed the full compiled main paper/);
  assert.notEqual((await qualityRecord(contextA, annotatorId)).annotations.RL03?.status, 'completed');
  await page.locator('[data-score-key="language_clarity"][data-option="2"]').click();
  await page.locator('#next-paper').click();
  await rendered(page, 'RL04');
  await page.locator('#previous-paper').click();
  await rendered(page, 'RL03');
  assert.equal(await page.locator('[data-score-key="language_clarity"][data-option="2"]').getAttribute('aria-pressed'), 'true');
  await saved(contextA, annotatorId, (record) => record.annotations.RL03?.scores.language_clarity === 2);
  await page.reload();
  await page.locator('#continue-profile').waitFor({ state: 'visible' });
  await page.locator('#continue-profile').click();
  await rendered(page, 'RL03');
  assert.equal(await page.locator('#completion-count').innerText(), '2 / 30');
  assert.equal(await page.locator('[data-score-key="language_clarity"][data-option="2"]').getAttribute('aria-pressed'), 'true');
  await checkLegacyStorageUntouched(page);
  report.checks.push('Low score, Uncertain and technical-only N/A complete with all optional fields blank; unanswered scores and missing compiled full-scope review block completion; draft survives next/previous navigation and first-unfinished resume');

  await page.locator('#sync-pdf-pages').evaluate((node) => { window.__originalSyncToggle = node; });
  assert.equal(await page.locator('#sync-pdf-pages').isChecked(), false);
  await assertSyncTogglePlacement(page, false);
  await setPageInput(page, 'compiled', 1);
  await setPageInput(page, 'official', 2);
  await setSync(page, true);
  await renderedPages(page, 'RL03', 1, 2);
  await page.locator('[data-viewer-action="prev"][data-viewer="official"]').click();
  await renderedPages(page, 'RL03', 1, 1);
  assert.equal(await page.locator('[data-page-status="compiled"]').innerText(), 'First page reached');
  await setSync(page, false);
  await page.locator('[data-viewer-action="next"][data-viewer="compiled"]').click();
  await renderedPages(page, 'RL03', 2, 1);
  await setSync(page, true);
  await page.locator('[data-viewer-action="next"][data-viewer="official"]').click();
  await renderedPages(page, 'RL03', 3, 2);
  await page.locator('#focus-viewers').click();
  await assertSyncTogglePlacement(page, true);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#sync-pdf-pages')), true);
  await setSync(page, false);
  await page.locator('[data-viewer-action="next"][data-viewer="compiled"]').click();
  await renderedPages(page, 'RL03', 4, 2);
  await setSync(page, true);
  await page.locator('[data-viewer-action="next"][data-viewer="official"]').click();
  await renderedPages(page, 'RL03', 5, 3);
  const mobileFocus = await expandedViewerLayout(page, 390, 844, 'RL03', 5, 3);
  assert.ok(mobileFocus.documentWidth <= 390, `Expanded viewers overflowed at 390px: ${mobileFocus.documentWidth}px`);
  assert.ok(mobileFocus.toolbar.top >= mobileFocus.topbar.bottom - 1, 'Expanded controls must remain below the sticky header.');
  assert.ok(mobileFocus.switchHit && mobileFocus.exitHit, 'Expanded sync and return controls must remain hit-testable on mobile.');
  await page.screenshot({ path: path.join(artifacts, 'quality-expanded-mobile.png') });
  const tabletFocus = await expandedViewerLayout(page, 712, 900, 'RL03', 5, 3);
  assert.ok(tabletFocus.documentWidth <= 712, `Expanded viewers overflowed at 712px: ${tabletFocus.documentWidth}px`);
  assert.ok(tabletFocus.toolbar.bottom < tabletFocus.target.top && tabletFocus.toolbar.bottom < tabletFocus.reference.top);
  const desktopFocus = await expandedViewerLayout(page, 1600, 1050, 'RL03', 5, 3);
  assert.ok(desktopFocus.documentWidth <= 1600, `Expanded viewers overflowed at 1600px: ${desktopFocus.documentWidth}px`);
  await page.screenshot({ path: path.join(artifacts, 'quality-expanded-desktop.png') });
  await page.locator('[data-exit-focus]').click();
  await assertSyncTogglePlacement(page, false);
  for (const width of [390, 712, 1600]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Workspace overflowed at ${width}px.`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await renderedPages(page, 'RL03', 5, 3);
  await page.locator('#rubric-scoring').screenshot({ path: path.join(artifacts, 'quality-rubric-mobile.png') });
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.screenshot({ path: path.join(artifacts, 'quality-workspace-desktop.png') });
  report.checks.push('PDF sync preserves independent offsets when off, advances relative pages and clamps at page one when on, and remains operable in expanded mode at 390px, 712px, and 1600px; quality UI screenshots captured');

  const contextB = await freshContext(annotatorId);
  const other = await fresh(contextB);
  await restoreProfile(other, annotatorId, recoveryCode);
  assert.equal(await other.locator('#completion-count').innerText(), '2 / 30');
  await checkLegacyStorageUntouched(other);
  await page.locator('#notes').fill('Synthetic first-device writer.');
  await saved(contextA, annotatorId, (record) => record.annotations.RL03?.notes === 'Synthetic first-device writer.');
  await other.locator('#notes').fill('Synthetic stale second-device writer.');
  await other.locator('#save-button').click();
  await other.waitForFunction(() => document.querySelector('#save-status')?.dataset.state === 'conflict', null, { timeout: 15000 });
  const authoritative = await qualityRecord(contextA, annotatorId);
  assert.equal(authoritative.annotations.RL03.notes, 'Synthetic first-device writer.');
  const newRecoveryRaw = await other.evaluate((key) => localStorage.getItem(key), qualityRecoveryKey(annotatorId));
  const newRecovery = JSON.parse(newRecoveryRaw);
  assert.equal(newRecovery.schema, 'xacl.document-quality-recovery.v1');
  assert.equal(newRecovery.protocol_id, 'document-quality-v1');
  assert.equal(newRecovery.unsaved, true);
  const recoveryDownloadPromise = other.waitForEvent('download');
  await other.locator('[data-download-recovery]').click();
  const recoveryDownload = await recoveryDownloadPromise;
  assert.match(recoveryDownload.suggestedFilename(), /^document-quality-v1-.*-recovery\.json$/);
  const recoveryFile = JSON.parse(fs.readFileSync(await recoveryDownload.path(), 'utf8'));
  assert.equal(recoveryFile.protocol_id, 'document-quality-v1');
  assert.equal(recoveryFile.record.annotations.RL03.notes, 'Synthetic stale second-device writer.');
  await checkLegacyStorageUntouched(page);
  await checkLegacyStorageUntouched(other);
  report.checks.push('Recovery code restores the same profile on a second device; optimistic revision conflict protects the first writer, and only a namespaced private unsaved-recovery file is offered');

  assert.deepEqual(report.page_errors, []);
  assert.deepEqual(report.unexpected_requests, []);
  assert.deepEqual(report.quality_rpc_calls.filter((name) => !name.startsWith('xacl_quality_')), []);
  assert.ok(report.quality_rpc_calls.includes('xacl_quality_register_annotator'));
  assert.ok(report.quality_rpc_calls.includes('xacl_quality_resume_annotator'));
  assert.ok(report.quality_rpc_calls.includes('xacl_quality_save_annotations'));
  report.status = 'passed';
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  report.status = 'failed';
  report.error = error.stack || String(error);
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
});
