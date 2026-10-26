// Synthetic browser regression for latex-writing-quality-v1 against disposable PostgreSQL.
// Never use this fixture or its judgments as human annotation data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.runtime', 'browser-writing-results');
fs.mkdirSync(artifacts, { recursive: true });
const reportPath = path.join(artifacts, process.env.WRITING_RESUME_SMOKE === '1' ? 'resume-smoke-report.json' : 'report.json');
const config = JSON.parse(fs.readFileSync(path.join(root, 'site/config.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'site/protocols/latex-writing-quality-v1/protocol.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'site/manifest.json'), 'utf8'));
const scoreKeys = contract.score_keys;
const differenceKeys = contract.version_difference_keys;
const visualIssueKeys = contract.visual_issue_keys;
const annotatorId = 'QAWriting_' + process.pid + '_' + Date.now().toString(36);
const report = {
  software_test_only: true,
  human_annotation: false,
  protocol_id: contract.protocol_id,
  auth_gateway: 'official Supabase JS SDK through synthetic test transport; real disposable PostgreSQL authorization',
  checks: [],
  writing_rpc_calls: [],
  page_errors: [],
  unexpected_requests: [],
  pdf_requests: [],
  event_order: [],
  screenshots: [],
};

let server;
let browser;
let base;
let origin;
let recoveryCode;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const contexts = [];

function assertKeys(actual, expected, message) {
  assert.deepEqual(Object.keys(actual).sort(), [...expected].sort(), message);
}

function oldRecoveryKeys(id) {
  const suffix = [
    encodeURIComponent(config.supabase_url),
    encodeURIComponent(config.study_id),
    config.manifest_sha256,
    encodeURIComponent(id),
  ].join(':');
  return [
    'xacl.annotation.recovery:' + suffix,
    'xacl.document-quality-v1.recovery:' + suffix,
  ];
}

function writingRecoveryKey(id) {
  const suffix = [
    encodeURIComponent(config.supabase_url),
    encodeURIComponent(config.study_id),
    config.manifest_sha256,
    encodeURIComponent(id),
  ].join(':');
  return 'xacl.' + contract.protocol_id + '.recovery:' + suffix;
}

async function tokenFor(context) {
  const state = await context.storageState();
  for (const item of state.origins.flatMap((entry) => entry.localStorage)) {
    try {
      const value = JSON.parse(item.value);
      if (value.access_token && value.user && value.user.id) return value.access_token;
    } catch { /* Supabase local storage contains other values too. */ }
  }
  return null;
}

async function rawRpc(context, name, args = {}) {
  const token = await tokenFor(context);
  const response = await context.request.post(origin + '/__rpc/' + name, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    data: args,
  });
  let payload;
  try { payload = await response.json(); } catch { payload = { unreadable_response: true }; }
  return { status: response.status(), ok: response.ok(), payload };
}

async function rpc(context, name, args = {}) {
  const response = await rawRpc(context, name, args);
  assert.ok(response.ok, name + ' failed (' + response.status + '): ' + JSON.stringify(response.payload));
  return response.payload;
}

async function writingRecord(context, id) {
  return (await rpc(context, 'xacl_writing_load_annotations', { p_annotator_id: id })).record;
}

async function saved(context, id, predicate, message) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const record = await writingRecord(context, id);
    if (record && predicate(record)) return record;
    await sleep(100);
  }
  throw new Error(message || 'Timed out waiting for the writing record to save.');
}

function pauseNextWritingSave(control) {
  let startResolve;
  let releaseResolve;
  const started = new Promise((resolve) => { startResolve = resolve; });
  const waiting = new Promise((resolve) => { releaseResolve = resolve; });
  control.pauseNextSave = { startResolve, waiting };
  return { started, release: releaseResolve };
}

async function freshContext(id, options = {}) {
  const label = options.label || id;
  const control = { pauseNextSave: null, failNextSave: false, requests: { official: [], target: [] } };
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1050 },
    locale: 'en-GB',
  });
  contexts.push(context);
  const keys = oldRecoveryKeys(id);
  const sentinel = JSON.stringify({ synthetic_test_sentinel: true, never_import: true });
  const storageScript = [
    '(() => {',
    '  if (location.origin === "null") return;',
    '  const keys = ' + JSON.stringify(keys) + ';',
    '  const sentinel = ' + JSON.stringify(sentinel) + ';',
    '  const rawGet = Storage.prototype.getItem;',
    '  const rawSet = Storage.prototype.setItem;',
    '  const rawRemove = Storage.prototype.removeItem;',
    '  window.__writingRawGet = rawGet;',
    '  window.__writingOldKeys = keys;',
    '  window.__writingOldStorageCalls = [];',
    '  window.__writingNewStorageCalls = [];',
    '  for (const key of keys) if (rawGet.call(localStorage, key) === null) rawSet.call(localStorage, key, sentinel);',
    '  const isOld = (name) => typeof name === "string" && (name.startsWith("xacl.annotation.recovery:") || name.startsWith("xacl.document-quality-v1.recovery:"));',
    '  const isWriting = (name) => typeof name === "string" && name.startsWith("xacl.latex-writing-quality-v1.recovery:");',
    '  Storage.prototype.getItem = function (name) { if (isOld(name)) window.__writingOldStorageCalls.push(["get", name]); return rawGet.call(this, name); };',
    '  Storage.prototype.setItem = function (name, value) { if (isOld(name)) window.__writingOldStorageCalls.push(["set", name]); if (isWriting(name)) window.__writingNewStorageCalls.push(["set", name]); return rawSet.call(this, name, value); };',
    '  Storage.prototype.removeItem = function (name) { if (isOld(name)) window.__writingOldStorageCalls.push(["remove", name]); if (isWriting(name)) window.__writingNewStorageCalls.push(["remove", name]); return rawRemove.call(this, name); };',
    '})();',
  ].join('\n');
  await context.addInitScript(storageScript);
  const supabaseOrigin = new URL(config.supabase_url).origin;
  await context.route(supabaseOrigin + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.headers().apikey, config.supabase_publishable_key, 'The official SDK must send the configured publishable key.');
    assert.notEqual(request.headers().authorization, 'Bearer ' + config.supabase_publishable_key, 'The publishable key must never be sent as a user bearer token.');
    const target = url.pathname.startsWith('/auth/v1/')
      ? '/__auth/' + url.pathname.slice('/auth/v1/'.length) + url.search
      : '/__rpc/' + url.pathname.split('/').pop();
    const name = target.startsWith('/__rpc/') ? target.slice('/__rpc/'.length) : '';
    let body = null;
    if (name) {
      report.writing_rpc_calls.push(name);
      try { body = request.postDataJSON(); } catch { body = null; }
      if (name === 'xacl_writing_save_annotations' && body && body.p_record &&
          Object.values(body.p_record.annotations || {}).some((row) => row && row.reference_exposed === true)) {
        report.event_order.push({ context: label, event: 'exposure-save-start' });
      }
      if (options.healthUnavailable && name === 'xacl_writing_annotation_health') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ message: 'Writing protocol health endpoint is not installed.' }),
        });
        return;
      }
      if (name === 'xacl_writing_save_annotations' && control.pauseNextSave) {
        const gate = control.pauseNextSave;
        control.pauseNextSave = null;
        gate.startResolve();
        await gate.waiting;
      }
      if (name === 'xacl_writing_save_annotations' && control.failNextSave) {
        control.failNextSave = false;
        report.event_order.push({ context: label, event: 'forced-save-failure' });
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ message: 'Synthetic QA save outage.' }),
        });
        return;
      }
    }
    const headers = request.headers().authorization ? { Authorization: request.headers().authorization } : {};
    const response = await context.request.fetch(origin + target, {
      method: request.method(),
      headers,
      ...(request.postData() ? { data: request.postDataJSON() } : {}),
    });
    if (name) {
      report.event_order.push({ context: label, event: name === 'xacl_writing_save_annotations' ? 'save-response-ready' : 'rpc-response', name });
      if (name === 'xacl_writing_save_annotations' && body && body.p_record &&
          Object.values(body.p_record.annotations || {}).some((row) => row && row.reference_exposed === true)) {
        report.event_order.push({ context: label, event: 'exposure-save-acknowledged-by-bridge' });
      }
    }
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: await response.body(),
    });
  });
  context.on('request', (request) => {
    const url = new URL(request.url());
    const localHostname = new URL(base).hostname;
    const serviceHostname = new URL(config.supabase_url).hostname;
    if (![localHostname, serviceHostname].includes(url.hostname)) report.unexpected_requests.push(url.origin);
    const paper = manifest.papers.find((item) => url.pathname.endsWith('/' + item.official_pdf.path));
    if (paper) {
      control.requests.official.push({ sample_id: paper.sample_id, path: url.pathname });
      report.pdf_requests.push({ context: label, side: 'official', sample_id: paper.sample_id, path: url.pathname });
      report.event_order.push({ context: label, event: 'official-request', sample_id: paper.sample_id });
    }
    const targetPaper = manifest.papers.find((item) => url.pathname.endsWith('/' + item.compiled_pdf.path));
    if (targetPaper) {
      control.requests.target.push({ sample_id: targetPaper.sample_id, path: url.pathname });
      report.pdf_requests.push({ context: label, side: 'target', sample_id: targetPaper.sample_id, path: url.pathname });
    }
  });
  context.on('page', (page) => page.on('pageerror', (error) => report.page_errors.push(label + ': ' + error.message)));
  context.__writingControl = control;
  context.__writingLabel = label;
  return context;
}

async function fresh(context) {
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => {
    const button = document.querySelector('#load-session');
    return button && !button.disabled && button.getBoundingClientRect().height > 0;
  }, null, { timeout: 20000 });
  return page;
}

async function renderedTarget(page, sampleId) {
  await page.waitForFunction((id) => document.querySelector('[data-sample-id="' + id + '"]')?.getAttribute('aria-current') === 'true', sampleId);
  await page.waitForFunction((id) => {
    const canvas = document.querySelector('[data-canvas="compiled"]');
    const stage = document.querySelector('[data-stage="compiled"]');
    return canvas && !canvas.classList.contains('is-hidden') && canvas.width > 0 &&
      canvas.dataset.renderedSample === id && canvas.dataset.renderedPage === '1' &&
      stage && stage.getAttribute('aria-busy') === 'false';
  }, sampleId, { timeout: 60000 });
}

async function renderedBoth(page, sampleId, compiledPage, officialPage) {
  await page.waitForFunction(({ id, compiled, official }) => ['compiled', 'official'].every((side) => {
    const expected = side === 'compiled' ? compiled : official;
    const canvas = document.querySelector('[data-canvas="' + side + '"]');
    const stage = document.querySelector('[data-stage="' + side + '"]');
    return canvas && !canvas.classList.contains('is-hidden') && canvas.width > 0 &&
      canvas.dataset.renderedSample === id && canvas.dataset.renderedPage === String(expected) &&
      stage && stage.getAttribute('aria-busy') === 'false';
  }), { id: sampleId, compiled: compiledPage, official: officialPage }, { timeout: 60000 });
  assert.equal(await page.locator('[data-page-input="compiled"]').inputValue(), String(compiledPage));
  assert.equal(await page.locator('[data-page-input="official"]').inputValue(), String(officialPage));
}

async function setPageInput(page, side, value) {
  const input = page.locator('[data-page-input="' + side + '"]');
  await input.fill(String(value));
  await input.press('Enter');
  const expected = Math.max(1, Math.min(Number(manifest.papers.find((paper) => paper.sample_id === 'RL01')[side === 'compiled' ? 'compiled_pdf' : 'official_pdf'].pages), Math.round(value)));
  await page.waitForFunction(({ side, expected }) => {
    const canvas = document.querySelector('[data-canvas="' + side + '"]');
    const stage = document.querySelector('[data-stage="' + side + '"]');
    return canvas?.dataset.renderedPage === String(expected) && stage?.getAttribute('aria-busy') === 'false';
  }, { side, expected }, { timeout: 60000 });
  assert.equal(await input.inputValue(), String(expected));
  return expected;
}

async function setSync(page, enabled) {
  const toggle = page.locator('#sync-pdf-pages');
  if (await toggle.isChecked() !== enabled) await page.locator('.sync-toggle').click();
  assert.equal(await toggle.isChecked(), enabled);
}

async function createProfile(page, id) {
  await page.locator('#annotator-id').fill(id);
  await page.locator('#load-session').click();
  await page.locator('#recovery-code-panel').waitFor({ state: 'visible', timeout: 20000 });
  const code = (await page.locator('#recovery-code-display').textContent()).trim();
  assert.match(code, /^[0-9a-f]{64}$/);
  assert.ok(await page.locator('#annotation-app').isHidden(), 'The workspace must remain hidden until the private code is acknowledged.');
  assert.ok(await page.locator('#continue-after-recovery').isDisabled());
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-recovery-code').click();
  const download = await downloadPromise;
  assert.ok(fs.readFileSync(await download.path(), 'utf8').includes(code));
  await page.locator('#recovery-code-saved').check({ force: true });
  await page.locator('#continue-after-recovery').click();
  await page.locator('#annotation-app').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-sample-id="RL01"]')?.getAttribute('aria-current') === 'true');
  return code;
}

async function restoreProfile(page, id, code) {
  await page.locator('#mode-restore-profile').click();
  await page.locator('#annotator-id').fill(id);
  await page.locator('#annotator-code').fill(code);
  await page.locator('#load-session').click();
  await page.locator('#annotation-app').waitFor({ state: 'visible', timeout: 20000 });
  try {
    await page.waitForFunction(() => Boolean(document.querySelector('[data-sample-id][aria-current="true"]')), null, { timeout: 10000 });
  } catch {
    const state = await page.evaluate(() => ({
      annotationHidden: document.querySelector('#annotation-app')?.classList.contains('is-hidden'),
      sampleButtons: document.querySelectorAll('[data-sample-id]').length,
      selectedSample: document.querySelector('[data-sample-id][aria-current="true"]')?.dataset.sampleId || null,
      loginError: document.querySelector('#login-error')?.textContent || '',
      loginStatus: document.querySelector('#login-status')?.textContent || '',
      completion: document.querySelector('#completion-count')?.textContent || '',
      paperTotal: document.querySelector('#paper-total')?.textContent || '',
    }));
    throw new Error('Restored session did not select a paper: ' + JSON.stringify(state));
  }
}

async function continueProfileAfterReload(page) {
  await page.reload();
  await page.locator('#continue-profile').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#continue-profile').click();
  await page.locator('#annotation-app').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-sample-id][aria-current="true"]')));
}

async function selectSample(page, id) {
  await page.locator('[data-sample-id="' + id + '"]').click();
  await page.waitForFunction((sampleId) => document.querySelector('[data-sample-id="' + sampleId + '"]')?.getAttribute('aria-current') === 'true', id);
}

async function setScope(page, checked) {
  const input = page.locator('#reviewed-full-scope');
  if (await input.isChecked() !== checked) {
    await page.locator('.check-label').filter({ has: input }).click();
    await page.waitForFunction((expected) => document.querySelector('#reviewed-full-scope')?.checked === expected, checked);
  }
  assert.equal(await input.isChecked(), checked);
}

async function waitForUiSave(page, timeout = 15000) {
  await page.waitForFunction(() => document.querySelector('#save-status')?.dataset.state === 'saved', null, { timeout });
}

async function setCoreScores(page, values) {
  for (const key of scoreKeys) {
    if (!Object.hasOwn(values, key)) continue;
    await page.locator('[data-score-key="' + key + '"][data-option="' + values[key] + '"]').click();
  }
}

async function assertOldRecoveryUntouched(page, id) {
  const result = await page.evaluate(() => ({
    calls: window.__writingOldStorageCalls || [],
    values: (window.__writingRawGet ? [
      window.__writingRawGet.call(localStorage, window.__writingOldKeys[0]),
      window.__writingRawGet.call(localStorage, window.__writingOldKeys[1]),
    ] : []),
  }));
  assert.deepEqual(result.calls, [], 'Old alignment and document-quality recovery keys must never be read, written, or removed.');
  assert.deepEqual(result.values, [JSON.stringify({ synthetic_test_sentinel: true, never_import: true }), JSON.stringify({ synthetic_test_sentinel: true, never_import: true })]);
  assert.ok(id);
}

async function assertNewRecovery(page, id, expectedSample, expectedScore) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), writingRecoveryKey(id));
  assert.ok(raw, 'Unsaved writing work should use its own recovery namespace.');
  const recovery = JSON.parse(raw);
  assert.equal(recovery.schema, 'xacl.latex-writing-quality-recovery.v1');
  assert.equal(recovery.protocol_id, contract.protocol_id);
  assert.equal(recovery.unsaved, true);
  assert.equal(recovery.record.annotations[expectedSample].scores.language_clarity, expectedScore);
  return recovery;
}

async function assertNoOfficial(context, reason) {
  assert.equal(context.__writingControl.requests.official.length, 0, reason || 'The official reference must remain unfetched until explicit audit request.');
}

async function assertVisualDefinitionLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator('#auxiliary-check-card').scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const card = document.querySelector('#auxiliary-check-card');
    const cardRect = card.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#visual-scale-details li')];
    return {
      card: { left: cardRect.left, right: cardRect.right, width: card.clientWidth },
      rows: rows.map((row) => {
        const text = row.querySelector(':scope > span');
        const rect = text?.getBoundingClientRect();
        return {
          text: text?.textContent.trim() || '',
          left: rect?.left,
          right: rect?.right,
          width: rect?.width || 0,
        };
      }),
    };
  });
  assert.equal(layout.rows.length, 6, 'The auxiliary PDF scale must render five score definitions plus Uncertain.');
  for (const [index, row] of layout.rows.entries()) {
    assert.ok(row.text, 'Auxiliary definition ' + (index + 1) + ' must have readable text.');
    assert.ok(row.width >= layout.card.width * 0.5,
      'Auxiliary definition ' + (index + 1) + ' should use a substantial part of the card width at ' + width + 'px: ' + JSON.stringify({ card: layout.card, row }));
    assert.ok(row.left >= layout.card.left - 1 && row.right <= layout.card.right + 1,
      'Auxiliary definition ' + (index + 1) + ' must remain inside its card at ' + width + 'px: ' + JSON.stringify({ card: layout.card, row }));
  }
}

async function targetFocusLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  if (await page.locator('#focus-viewers').getAttribute('aria-pressed') !== 'true') await page.locator('#focus-viewers').click();
  await page.locator('#compiled-viewer').scrollIntoViewIfNeeded();
  const state = await page.evaluate(() => {
    const toolbar = document.querySelector('#viewer-focus-toolbar');
    const exit = toolbar.querySelector('[data-exit-focus]');
    const hit = (node) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight && (top === node || node.contains(top));
    };
    return {
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      toolbarVisible: !toolbar.hidden,
      exitHit: hit(exit),
      targetVisible: !document.querySelector('#compiled-viewer').hidden,
      officialHidden: document.querySelector('#official-viewer').hidden,
      syncHidden: document.querySelector('.sync-toggle').classList.contains('is-hidden'),
      syncDisabled: document.querySelector('#sync-pdf-pages').disabled,
    };
  });
  assert.ok(state.documentWidth <= width, 'Target-only expanded view overflowed at ' + width + 'px.');
  assert.ok(state.toolbarVisible && state.exitHit, 'Target-only expanded controls must remain visible and hittable at ' + width + 'px.');
  assert.ok(state.targetVisible && state.officialHidden && state.syncHidden && state.syncDisabled, 'Expanding the target viewer must not expose the official reference.');
  return state;
}

async function auditFocusLayout(page, width, height, sampleId, compiledPage, officialPage) {
  await page.setViewportSize({ width, height });
  if (await page.locator('#focus-viewers').getAttribute('aria-pressed') !== 'true') await page.locator('#focus-viewers').click();
  await page.locator('#official-viewer').scrollIntoViewIfNeeded();
  await renderedBoth(page, sampleId, compiledPage, officialPage);
  const state = await page.evaluate(() => {
    const toolbar = document.querySelector('#viewer-focus-toolbar');
    const toggle = toolbar.querySelector('.sync-toggle');
    const exit = toolbar.querySelector('[data-exit-focus]');
    const hit = (node) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight && (top === node || node.contains(top));
    };
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      topbarBottom: topbar.bottom,
      toolbarTop: toolbarRect.top,
      toolbarVisible: !toolbar.hidden,
      switchHit: hit(toggle),
      exitHit: hit(exit),
      syncInFocusSlot: toggle.parentElement === document.querySelector('#sync-pdf-pages-focus-slot'),
      officialVisible: !document.querySelector('#official-viewer').hidden,
      compiledPage: document.querySelector('[data-canvas="compiled"]').dataset.renderedPage,
      officialPage: document.querySelector('[data-canvas="official"]').dataset.renderedPage,
    };
  });
  assert.ok(state.documentWidth <= width, 'Expanded audit view overflowed at ' + width + 'px.');
  assert.ok(state.toolbarVisible && state.switchHit && state.exitHit && state.syncInFocusSlot, 'Expanded sync and return controls must stay visible, hit-testable, and in their stable slot at ' + width + 'px.');
  assert.ok(state.officialVisible, 'The optional reference should be visible only during the explicit audit.');
  assert.equal(state.compiledPage, String(compiledPage));
  assert.equal(state.officialPage, String(officialPage));
  assert.ok(state.toolbarTop >= state.topbarBottom - 1, 'Sticky audit controls must remain below the sticky site header.');
  return state;
}

(async () => {
  if (process.env.XACL_DISPOSABLE_DATABASE !== '1') throw new Error('Set XACL_DISPOSABLE_DATABASE=1 only for an isolated test database.');
  if (!process.env.QA_DATABASE_URL) throw new Error('QA_DATABASE_URL must point to a disposable PostgreSQL database.');
  assert.equal(config.schema, 'xacl.hosted-config.v3');
  assert.equal(config.protocol_id, contract.protocol_id);
  assert.equal(config.record_schema, contract.record_schema);
  server = spawn(process.env.PYTHON_BIN || 'python3', ['tests/browser_server.py'], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
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

  if (process.env.WRITING_RESUME_SMOKE === '1') {
    const smokeId = annotatorId + '_RESUME';
    const createContext = await freshContext(smokeId, { label: 'resume-smoke-create' });
    const createPage = await fresh(createContext);
    const smokeCode = await createProfile(createPage, smokeId);
    const initial = await writingRecord(createContext, smokeId);
    assert.equal(initial.revision, 0);
    assert.deepEqual(initial.annotations, {});
    await assertOldRecoveryUntouched(createPage, smokeId);
    await assertNoOfficial(createContext);
    await createContext.close();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const resumeContext = await freshContext(smokeId, { label: 'resume-smoke-' + attempt });
      const resumePage = await fresh(resumeContext);
      await restoreProfile(resumePage, smokeId, smokeCode);
      await resumePage.waitForFunction(() => document.querySelector('[data-sample-id="RL01"]')?.getAttribute('aria-current') === 'true');
      assert.equal(await resumePage.locator('#completion-count').innerText(), '0 / 30');
      assert.deepEqual((await writingRecord(resumeContext, smokeId)).annotations, {});
      await assertOldRecoveryUntouched(resumePage, smokeId);
      await assertNoOfficial(resumeContext);
      await resumeContext.close();
    }
    report.checks.push('Three independent same-profile fresh-context restores selected RL01 with the untouched empty writing record; legacy recovery keys remained untouched and no official PDF was requested.');
    report.status = 'passed';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const healthContext = await freshContext(annotatorId + '_HEALTH', { label: 'health-unavailable', healthUnavailable: true });
  const healthPage = await healthContext.newPage();
  await healthPage.goto(base);
  await healthPage.waitForFunction(() => {
    const error = document.querySelector('#login-error');
    return error && !error.classList.contains('is-hidden') && /not ready|setup|unavailable/i.test(error.textContent || '');
  }, null, { timeout: 20000 });
  assert.equal(await healthPage.locator('#load-session').isDisabled(), true);
  assert.ok(await healthPage.locator('#annotation-app').isHidden());
  assert.deepEqual(report.writing_rpc_calls.filter((name) => name.startsWith('xacl_') && !name.startsWith('xacl_writing_')), []);
  assert.deepEqual(report.writing_rpc_calls.filter((name) => name !== 'xacl_writing_annotation_health'), []);
  await assertOldRecoveryUntouched(healthPage, annotatorId + '_HEALTH');
  await healthContext.close();
  report.checks.push('Missing writing health locks registration and workspace without falling back to an older RPC namespace.');

  const contextA = await freshContext(annotatorId, { label: 'primary-profile' });
  const pageA = await fresh(contextA);
  assert.equal(await pageA.locator('html').getAttribute('lang'), 'en');
  assert.ok(await pageA.locator('#annotation-app').isHidden());
  assert.equal(await tokenFor(contextA), null, 'Landing page must not register or sign in automatically.');
  recoveryCode = await createProfile(pageA, annotatorId);
  await renderedTarget(pageA, 'RL01');
  assert.match((await pageA.locator('#protocol-banner').innerText()).toLowerCase(), /writing/);
  assert.equal(await pageA.locator('#completion-count').innerText(), '0 / 30');
  assert.deepEqual(await pageA.locator('[data-score-key]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.scoreKey))]), scoreKeys);
  assert.equal(await pageA.locator('.score-card').count(), 5);
  assert.equal(await pageA.locator('.score-card .score-scale-details[open]').count(), 5, 'All five core definitions start open.');
  assert.equal(await pageA.locator('#visual-scale-details[open]').count(), 1, 'The auxiliary visual definition starts open.');
  for (const key of scoreKeys) {
    const card = pageA.locator('.score-card[data-key="' + key + '"]');
    assert.ok((await card.locator('h4').innerText()).trim());
    assert.ok((await card.locator('p').first().innerText()).trim());
    assert.equal(await card.locator('[data-option="na"]').count(), 0, 'Core ratings do not permit N/A.');
    assert.equal(await card.locator('[aria-pressed="true"]').count(), 0, 'Fresh core ratings start unanswered.');
    assert.equal(await card.locator('[data-option="uncertain"]').count(), 1);
  }
  assert.ok((await pageA.locator('#auxiliary-title').innerText()).trim());
  assert.ok((await pageA.locator('#auxiliary-definition').innerText()).trim());
  assert.equal(await pageA.locator('#visual-check-status').getAttribute('data-assessed'), 'false');
  assert.equal(await pageA.locator('[data-visual-score][aria-pressed="true"]').count(), 0);
  assert.equal(await pageA.locator('[data-visual-issue-key]:disabled').count(), visualIssueKeys.length);
  assert.equal(await pageA.locator('#clear-visual-check').isDisabled(), true);
  assert.equal(await pageA.locator('#version-audit-toggle').isDisabled(), true);
  assert.equal(await pageA.locator('#version-observations').isHidden(), true);
  assert.equal(await pageA.locator('#evidence, #notes, .evidence-card, .notes-card, .annotation-details-grid').count(), 0);
  assert.equal(await pageA.locator('#import-file, #import-button, #export-button').count(), 0);
  assert.equal(await pageA.locator('button').filter({ hasText: /import|export/i }).count(), 0);
  assert.equal(await pageA.locator('#version-notes').isVisible(), false);
  assert.deepEqual((await writingRecord(contextA, annotatorId)).annotations, {}, 'A newly registered writing record must not prefill any legacy answers or blank rows.');
  await assertNoOfficial(contextA, 'Official PDF must not be requested when a profile starts.');
  await assertOldRecoveryUntouched(pageA, annotatorId);
  await pageA.screenshot({ path: path.join(artifacts, 'writing-primary-desktop.png'), fullPage: true });
  report.screenshots.push('writing-primary-desktop.png');
  report.checks.push('New profile starts at RL01 with an empty backend annotation map, 0/30 completed, five unanswered core ratings, no N/A, open definitions, default unassessed visual check, and no old recovery or evidence/private-note controls.');

  await assertVisualDefinitionLayout(pageA, 1600, 1050);
  await assertVisualDefinitionLayout(pageA, 390, 844);
  await pageA.setViewportSize({ width: 1600, height: 1050 });
  report.checks.push('All six auxiliary PDF visual scale descriptions have substantial width and remain within their card at desktop and 390px viewport widths.');

  await targetFocusLayout(pageA, 390, 844);
  await pageA.screenshot({ path: path.join(artifacts, 'writing-target-mobile.png'), fullPage: true });
  report.screenshots.push('writing-target-mobile.png');
  await pageA.locator('[data-exit-focus]').click();
  await targetFocusLayout(pageA, 712, 900);
  await pageA.locator('[data-exit-focus]').click();
  await targetFocusLayout(pageA, 1600, 1050);
  await pageA.locator('[data-exit-focus]').click();
  await pageA.setViewportSize({ width: 1600, height: 1050 });
  await assertNoOfficial(contextA, 'Expanding the target viewer must never request the official PDF.');
  report.checks.push('Target-only expanded viewer remains within 390px, 712px, and 1600px widths with a hittable return control and no hidden-reference fetch.');

  await setCoreScores(pageA, Object.fromEntries(scoreKeys.map((key) => [key, 5])));
  await setScope(pageA, true);
  await pageA.locator('#complete-review').click();
  const initialRecord = await saved(contextA, annotatorId, (record) => record.annotations.RL01?.status === 'completed');
  const firstRow = initialRecord.annotations.RL01;
  assertKeys(initialRecord, contract.record_keys, 'The backend response must match the active writing record contract exactly.');
  assertKeys(firstRow, contract.annotation_keys, 'The saved annotation row must match the active writing row contract exactly.');
  assert.deepEqual(firstRow.scores, Object.fromEntries(scoreKeys.map((key) => [key, 5])));
  assert.deepEqual(firstRow.auxiliary_checks, { pdf_visual_integrity: { status: 'not_assessed', score: null, issue_codes: [] } });
  assert.deepEqual(firstRow.version_differences, []);
  assert.equal(firstRow.version_notes, '');
  assert.equal(firstRow.reference_exposed, false);
  assert.equal(firstRow.reviewed_full_scope, true);
  assert.equal(firstRow.status, 'completed');
  await waitForUiSave(pageA);
  assert.equal(await pageA.locator('#completion-count').innerText(), '1 / 30');
  assert.equal(await pageA.locator('#version-audit-toggle').isDisabled(), false);
  const recoveryCalls = await pageA.evaluate(() => window.__writingNewStorageCalls || []);
  assert.ok(recoveryCalls.some((call) => call[0] === 'set'), 'Unsaved edits must be written to the new writing recovery namespace.');
  assert.ok(recoveryCalls.every((call) => call[1].startsWith('xacl.latex-writing-quality-v1.recovery:')));
  await assertOldRecoveryUntouched(pageA, annotatorId);
  report.checks.push('Five core 5s plus full-scope confirmation complete without auxiliary scores or version observations; the new profile uses only writing recovery storage.');

  for (const key of visualIssueKeys) assert.equal(await pageA.locator('[data-visual-issue-key="' + key + '"]').isDisabled(), true);
  await pageA.locator('[data-visual-score="1"]').click();
  assert.equal(await pageA.locator('#visual-check-status').getAttribute('data-assessed'), 'true');
  for (const key of visualIssueKeys) assert.equal(await pageA.locator('[data-visual-issue-key="' + key + '"]').isDisabled(), false);
  await pageA.locator('[data-visual-issue-key="overlap"]').check({ force: true });
  await pageA.locator('[data-visual-issue-key="clipping"]').check({ force: true });
  let auxiliaryRecord = await saved(contextA, annotatorId, (record) => {
    const visual = record.annotations.RL01?.auxiliary_checks?.pdf_visual_integrity;
    return record.annotations.RL01?.status === 'completed' && visual?.status === 'assessed' && visual?.score === 1 && visual.issue_codes.includes('clipping');
  });
  const sameScoreRevision = auxiliaryRecord.revision;
  await pageA.locator('[data-visual-score="1"]').click();
  assert.equal(await pageA.locator('[data-visual-score="1"]').getAttribute('aria-pressed'), 'true');
  await sleep(850);
  auxiliaryRecord = await writingRecord(contextA, annotatorId);
  assert.equal(auxiliaryRecord.revision, sameScoreRevision, 'Clicking the selected visual score must not clear or rewrite it.');
  assert.equal(auxiliaryRecord.annotations.RL01.status, 'completed');
  assert.deepEqual(auxiliaryRecord.annotations.RL01.scores, Object.fromEntries(scoreKeys.map((key) => [key, 5])));
  await pageA.locator('#clear-visual-check').click();
  auxiliaryRecord = await saved(contextA, annotatorId, (record) => record.annotations.RL01?.auxiliary_checks?.pdf_visual_integrity?.status === 'not_assessed');
  assert.deepEqual(auxiliaryRecord.annotations.RL01.auxiliary_checks, { pdf_visual_integrity: { status: 'not_assessed', score: null, issue_codes: [] } });
  assert.equal(auxiliaryRecord.annotations.RL01.status, 'completed');
  await pageA.locator('[data-visual-score="1"]').click();
  await pageA.locator('[data-visual-issue-key="overlap"]').check({ force: true });
  await pageA.locator('[data-visual-issue-key="clipping"]').check({ force: true });
  auxiliaryRecord = await saved(contextA, annotatorId, (record) => record.annotations.RL01?.auxiliary_checks?.pdf_visual_integrity?.issue_codes.length === 2);
  await waitForUiSave(pageA);
  assert.equal(auxiliaryRecord.annotations.RL01.status, 'completed');
  assert.deepEqual(auxiliaryRecord.annotations.RL01.scores, Object.fromEntries(scoreKeys.map((key) => [key, 5])));
  await pageA.locator('#auxiliary-check-card').screenshot({ path: path.join(artifacts, 'writing-auxiliary-desktop.png') });
  report.screenshots.push('writing-auxiliary-desktop.png');
  await pageA.setViewportSize({ width: 390, height: 844 });
  await pageA.locator('#auxiliary-check-card').screenshot({ path: path.join(artifacts, 'writing-auxiliary-mobile.png') });
  report.screenshots.push('writing-auxiliary-mobile.png');
  await pageA.setViewportSize({ width: 1600, height: 1050 });
  await assertOldRecoveryUntouched(pageA, annotatorId);
  report.checks.push('Optional PDF visual score/issues persist on a completed row without changing five core 5s; issue controls require an assessment, clicking the selected score is a no-op, and Clear restores not_assessed/null/empty.');

  await pageA.reload();
  await pageA.locator('#continue-profile').waitFor({ state: 'visible', timeout: 20000 });
  await pageA.locator('#continue-profile').click();
  await pageA.locator('#annotation-app').waitFor({ state: 'visible' });
  await pageA.waitForFunction(() => document.querySelector('[data-sample-id="RL02"]')?.getAttribute('aria-current') === 'true');
  assert.equal(await pageA.locator('#completion-count').innerText(), '1 / 30');
  await selectSample(pageA, 'RL01');
  assert.equal(await pageA.locator('[data-visual-score="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await pageA.locator('[data-visual-issue-key="overlap"]').isChecked(), true);
  assert.equal(await pageA.locator('[data-visual-issue-key="clipping"]').isChecked(), true);
  await selectSample(pageA, 'RL02');
  assert.equal(await pageA.locator('#version-audit-toggle').isDisabled(), true);
  const mixedCoreScores = {
    language_clarity: 1,
    coherence_flow: 2,
    structural_completeness: 3,
    technical_expression: 4,
  };
  await setCoreScores(pageA, mixedCoreScores);
  await setScope(pageA, true);
  await pageA.locator('#complete-review').click();
  await pageA.waitForFunction(() => document.querySelector('#validation-message')?.dataset.kind === 'error');
  assert.notEqual((await writingRecord(contextA, annotatorId)).annotations.RL02?.status, 'completed');
  await setCoreScores(pageA, { overall_writing_quality: 'uncertain' });
  await setScope(pageA, false);
  await pageA.locator('#complete-review').click();
  await pageA.waitForFunction(() => document.querySelector('#validation-message')?.dataset.kind === 'error');
  assert.notEqual((await writingRecord(contextA, annotatorId)).annotations.RL02?.status, 'completed');
  await setScope(pageA, true);
  await pageA.locator('#complete-review').click();
  const twoCompleted = await saved(contextA, annotatorId, (record) => record.annotations.RL02?.status === 'completed');
  await waitForUiSave(pageA);
  assert.deepEqual(twoCompleted.annotations.RL02.scores, { ...mixedCoreScores, overall_writing_quality: 'uncertain' });
  assert.deepEqual(twoCompleted.annotations.RL02.auxiliary_checks, { pdf_visual_integrity: { status: 'not_assessed', score: null, issue_codes: [] } });
  assert.deepEqual(twoCompleted.annotations.RL02.version_differences, []);
  assert.equal(twoCompleted.annotations.RL02.version_notes, '');
  assert.equal(twoCompleted.annotations.RL02.reference_exposed, false);
  assert.equal(twoCompleted.annotations.RL02.reviewed_full_scope, true);
  assert.equal(twoCompleted.annotations.RL02.status, 'completed');
  assert.equal(await pageA.locator('#completion-count').innerText(), '2 / 30');
  await pageA.locator('#next-paper').scrollIntoViewIfNeeded();
  await pageA.locator('#next-paper').click();
  await pageA.waitForFunction(() => document.querySelector('[data-sample-id="RL03"]')?.getAttribute('aria-current') === 'true');
  assert.equal(await pageA.locator('#version-audit-toggle').isDisabled(), true);
  await assertOldRecoveryUntouched(pageA, annotatorId);
  report.checks.push('Missing any core response or missing full-scope confirmation blocks completion; all five 5s complete regardless of unassessed auxiliary checks, first-unfinished resume and bottom navigation select RL02/RL03.');

  // A failed first-exposure save must leave the reference hidden and unrequested.
  await selectSample(pageA, 'RL02');
  assert.equal(await pageA.locator('#version-audit-toggle').isDisabled(), false);
  const requestsBeforeFailure = contextA.__writingControl.requests.official.length;
  contextA.__writingControl.failNextSave = true;
  await pageA.locator('#version-audit-toggle').click();
  await pageA.waitForFunction(() => {
    const status = document.querySelector('#save-status');
    const button = document.querySelector('#version-audit-toggle');
    return status?.dataset.state === 'error' && button?.disabled === true;
  }, null, { timeout: 15000 });
  await sleep(400);
  assert.ok(await pageA.locator('#official-viewer').isHidden());
  assert.equal(contextA.__writingControl.requests.official.length, requestsBeforeFailure);
  const failedExposureRecord = await writingRecord(contextA, annotatorId);
  assert.equal(failedExposureRecord.annotations.RL02.reference_exposed, false, 'A rejected exposure save must not alter the server record.');
  await assertNoOfficial(contextA, 'A failed first-exposure save must not fetch the official PDF.');
  report.checks.push('A failed first-exposure save keeps the reference hidden and makes no official-PDF request.');
  await assertOldRecoveryUntouched(pageA, annotatorId);
  await contextA.close();

  // Restore the same backend identity in a fresh device context with clean local state.
  const contextB = await freshContext(annotatorId, { label: 'restored-primary-profile' });
  const pageB = await fresh(contextB);
  await restoreProfile(pageB, annotatorId, recoveryCode);
  await pageB.waitForFunction(() => document.querySelector('[data-sample-id="RL03"]')?.getAttribute('aria-current') === 'true');
  assert.equal(await pageB.locator('#completion-count').innerText(), '2 / 30');
  const restoredRecord = await writingRecord(contextB, annotatorId);
  assert.equal(restoredRecord.annotations.RL01.reference_exposed, false);
  assert.equal(restoredRecord.annotations.RL02.reference_exposed, false);
  assert.deepEqual(restoredRecord.annotations.RL01.scores, Object.fromEntries(scoreKeys.map((key) => [key, 5])));
  assert.deepEqual(restoredRecord.annotations.RL01.auxiliary_checks.pdf_visual_integrity.issue_codes, ['overlap', 'clipping']);
  await assertNoOfficial(contextB, 'Restoring an existing profile must not fetch the official reference.');
  await assertOldRecoveryUntouched(pageB, annotatorId);

  await selectSample(pageB, 'RL01');
  const beforeExposure = await writingRecord(contextB, annotatorId);
  assert.equal(beforeExposure.annotations.RL01.reference_exposed, false);
  assert.ok(beforeExposure.revision > 0);
  const requestsBeforeAudit = contextB.__writingControl.requests.official.length;
  const gate = pauseNextWritingSave(contextB.__writingControl);
  await pageB.locator('#version-audit-toggle').click();
  await gate.started;
  assert.ok(await pageB.locator('#official-viewer').isHidden(), 'The reference must stay hidden while the exposure save is unresolved.');
  assert.equal(contextB.__writingControl.requests.official.length, requestsBeforeAudit);
  assert.equal(await pageB.locator('#version-audit-toggle').isDisabled(), true, 'Duplicate audit clicks must be disabled during the pending exposure save.');
  await sleep(300);
  assert.equal(contextB.__writingControl.requests.official.length, requestsBeforeAudit);
  gate.release();
  const afterExposure = await saved(contextB, annotatorId, (record) => record.annotations.RL01?.reference_exposed === true);
  assert.equal(afterExposure.revision, beforeExposure.revision + 1, 'The pre-exposure completed record must be preserved as the prior immutable revision.');
  await pageB.locator('#official-viewer').waitFor({ state: 'visible', timeout: 20000 });
  await renderedBoth(pageB, 'RL01', 1, 1);
  assert.ok(contextB.__writingControl.requests.official.length > requestsBeforeAudit);
  const exposureAckIndex = report.event_order.findIndex((event) => event.context === 'restored-primary-profile' && event.event === 'exposure-save-acknowledged-by-bridge');
  const officialFetchIndex = report.event_order.findIndex((event) => event.context === 'restored-primary-profile' && event.event === 'official-request' && event.sample_id === 'RL01');
  assert.ok(exposureAckIndex >= 0 && officialFetchIndex > exposureAckIndex, 'The writing record must be acknowledged before the browser requests the official PDF.');
  report.checks.push('The official PDF is requested only after a clean completed row saves reference_exposed=true; a paused exposure save keeps it hidden and duplicate open clicks are blocked.');

  for (const key of differenceKeys) await pageB.locator('[data-version-difference-key="' + key + '"]').check({ force: true });
  const longAuditNotes = 'v'.repeat(12000);
  assert.equal(await pageB.locator('#version-notes').getAttribute('maxlength'), '12000');
  await pageB.locator('#version-notes').fill(longAuditNotes);
  await pageB.locator('#save-button').click();
  const auditedRecord = await saved(contextB, annotatorId, (record) =>
    record.annotations.RL01?.version_differences.length === differenceKeys.length &&
    record.annotations.RL01?.version_notes.length === 12000);
  await waitForUiSave(pageB);
  const auditedRow = auditedRecord.annotations.RL01;
  assert.deepEqual(auditedRow.version_differences, differenceKeys);
  assert.equal(auditedRow.version_notes, longAuditNotes);
  assert.equal(auditedRow.status, 'completed');
  assert.equal(auditedRow.reference_exposed, true);
  assert.deepEqual(auditedRow.scores, Object.fromEntries(scoreKeys.map((key) => [key, 5])), 'Version observations and the low auxiliary score must not cap any core score.');
  assert.deepEqual(auditedRow.auxiliary_checks.pdf_visual_integrity, { status: 'assessed', score: 1, issue_codes: ['overlap', 'clipping'] });
  assert.equal(await pageB.locator('#completion-count').innerText(), '2 / 30');
  await pageB.screenshot({ path: path.join(artifacts, 'writing-audit-desktop.png'), fullPage: true });
  report.screenshots.push('writing-audit-desktop.png');
  await pageB.locator('#auxiliary-check-card').screenshot({ path: path.join(artifacts, 'writing-audit-auxiliary.png') });
  report.screenshots.push('writing-audit-auxiliary.png');
  report.checks.push('All seven optional version flags and a maximum-length note save on a completed row with five core 5s and auxiliary 1; no auxiliary score or difference count caps writing quality.');

  await setPageInput(pageB, 'compiled', 1);
  await setPageInput(pageB, 'official', 2);
  await setSync(pageB, true);
  await pageB.locator('[data-viewer-action="prev"][data-viewer="official"]').click();
  await renderedBoth(pageB, 'RL01', 1, 1);
  assert.match(await pageB.locator('[data-page-status="compiled"]').innerText(), /First page reached/);
  await setSync(pageB, false);
  await pageB.locator('[data-viewer-action="next"][data-viewer="compiled"]').click();
  await pageB.waitForFunction(() => document.querySelector('[data-canvas="compiled"]')?.dataset.renderedPage === '2');
  assert.equal(await pageB.locator('[data-canvas="official"]').getAttribute('data-rendered-page'), '1');
  await setSync(pageB, true);
  await pageB.locator('[data-viewer-action="next"][data-viewer="official"]').click();
  await renderedBoth(pageB, 'RL01', 3, 2);
  await setPageInput(pageB, 'compiled', 18);
  await setPageInput(pageB, 'official', 18);
  await pageB.locator('[data-viewer-action="next"][data-viewer="official"]').click();
  await renderedBoth(pageB, 'RL01', 18, 18);
  assert.match(await pageB.locator('[data-page-status="compiled"]').innerText(), /Last page reached/);
  const normalSyncToggle = await pageB.locator('#sync-pdf-pages').evaluate((node) => ({
    count: document.querySelectorAll('#sync-pdf-pages').length,
    parentId: node.closest('.sync-toggle').parentElement.id,
  }));
  assert.deepEqual(normalSyncToggle, { count: 1, parentId: 'sync-pdf-pages-normal-slot' });
  const mobileAudit = await auditFocusLayout(pageB, 390, 844, 'RL01', 18, 18);
  assert.ok(mobileAudit.toolbarTop >= mobileAudit.topbarBottom - 1);
  await pageB.screenshot({ path: path.join(artifacts, 'writing-audit-mobile.png'), fullPage: true });
  report.screenshots.push('writing-audit-mobile.png');
  const tabletAudit = await auditFocusLayout(pageB, 712, 900, 'RL01', 18, 18);
  assert.ok(tabletAudit.documentWidth <= 712);
  const desktopAudit = await auditFocusLayout(pageB, 1600, 1050, 'RL01', 18, 18);
  assert.ok(desktopAudit.documentWidth <= 1600);
  await pageB.locator('[data-exit-focus]').click();
  assert.equal(await pageB.locator('#focus-viewers').getAttribute('aria-pressed'), 'false');
  report.checks.push('Normal and expanded two-view page sync preserves independent offsets, advances relative pages, clamps at the last page with a boundary message, and retains a stable, hittable sticky switch at 390px, 712px, and 1600px.');

  await pageB.locator('#version-audit-toggle').click();
  await pageB.locator('#official-viewer').waitFor({ state: 'hidden' });
  assert.equal((await writingRecord(contextB, annotatorId)).annotations.RL01.reference_exposed, true, 'Closing the audit hides the viewer but keeps exposure metadata.');
  await pageB.locator('#version-audit-toggle').click();
  await pageB.locator('#official-viewer').waitFor({ state: 'visible' });
  await renderedBoth(pageB, 'RL01', 18, 1);
  assert.equal(await pageB.locator('#version-audit-toggle').getAttribute('aria-expanded'), 'true');
  await pageB.locator('[data-score-key="language_clarity"][data-option="4"]').click();
  await pageB.locator('#official-viewer').waitFor({ state: 'hidden' });
  const editedAfterExposure = await saved(contextB, annotatorId, (record) => record.annotations.RL01?.status === 'draft' && record.annotations.RL01?.scores.language_clarity === 4);
  assert.equal(editedAfterExposure.annotations.RL01.reference_exposed, true, 'Core edits must keep the monotonic exposure marker.');
  assert.equal(await pageB.locator('#version-audit-toggle').isDisabled(), true);
  await pageB.locator('[data-score-key="language_clarity"][data-option="5"]').click();
  await pageB.locator('#complete-review').click();
  await saved(contextB, annotatorId, (record) => record.annotations.RL01?.status === 'completed' && record.annotations.RL01?.scores.language_clarity === 5);
  await waitForUiSave(pageB);
  const attemptedClear = structuredClone(await writingRecord(contextB, annotatorId));
  attemptedClear.annotations.RL01.reference_exposed = false;
  attemptedClear.annotations.RL01.updated_at = new Date().toISOString();
  attemptedClear.updated_at = attemptedClear.annotations.RL01.updated_at;
  const clearResponse = await rawRpc(contextB, 'xacl_writing_save_annotations', {
    p_annotator_id: annotatorId,
    p_record: attemptedClear,
    p_guidance_version: config.guidance_version,
    p_guidance_sha256: config.guidance_sha256,
    p_operation: 'save',
  });
  assert.equal(clearResponse.payload.error, 'invalid_record', 'The server must reject clearing reference_exposed after it was recorded.');
  assert.equal(Object.hasOwn(clearResponse.payload, 'record'), false);
  assert.equal((await writingRecord(contextB, annotatorId)).annotations.RL01.reference_exposed, true);
  await pageB.reload();
  await pageB.locator('#continue-profile').waitFor({ state: 'visible', timeout: 20000 });
  await pageB.locator('#continue-profile').click();
  await pageB.waitForFunction(() => document.querySelector('[data-sample-id="RL03"]')?.getAttribute('aria-current') === 'true');
  assert.equal(await pageB.locator('#completion-count').innerText(), '2 / 30');
  await selectSample(pageB, 'RL01');
  assert.equal(await pageB.locator('#version-audit-toggle').isDisabled(), false);
  assert.match(await pageB.locator('#version-audit-toggle').innerText(), /Reopen/);
  assert.equal((await writingRecord(contextB, annotatorId)).annotations.RL01.reference_exposed, true);
  await assertOldRecoveryUntouched(pageB, annotatorId);
  report.checks.push('Closing/reopening and reload preserve exposure; a core edit reopens draft and hides the official reference while retaining monotonic metadata, and the server rejects attempts to clear it.');

  const contextC = await freshContext(annotatorId, { label: 'second-device-stale-writer' });
  const pageC = await fresh(contextC);
  await restoreProfile(pageC, annotatorId, recoveryCode);
  await pageC.waitForFunction(() => document.querySelector('[data-sample-id="RL03"]')?.getAttribute('aria-current') === 'true');
  assert.equal(await pageC.locator('#completion-count').innerText(), '2 / 30');
  await assertOldRecoveryUntouched(pageC, annotatorId);
  await selectSample(pageB, 'RL03');
  await selectSample(pageC, 'RL03');
  await pageB.locator('[data-score-key="language_clarity"][data-option="3"]').click();
  const firstDeviceWrite = await saved(contextB, annotatorId, (record) => record.annotations.RL03?.scores.language_clarity === 3);
  assert.ok(firstDeviceWrite.revision > 0);
  await pageC.locator('[data-score-key="language_clarity"][data-option="4"]').click();
  await pageC.locator('#save-button').click();
  await pageC.waitForFunction(() => document.querySelector('#save-status')?.dataset.state === 'conflict', null, { timeout: 20000 });
  const authoritative = await writingRecord(contextB, annotatorId);
  assert.equal(authoritative.annotations.RL03.scores.language_clarity, 3, 'The stale second-device save must not overwrite the first device.');
  const recovery = await assertNewRecovery(pageC, annotatorId, 'RL03', 4);
  assert.equal(recovery.saved_revision, firstDeviceWrite.revision - 1, 'The emergency local copy records its stale base revision.');
  const recoveryDownloadPromise = pageC.waitForEvent('download');
  await pageC.locator('[data-download-recovery]').click();
  const recoveryDownload = await recoveryDownloadPromise;
  assert.match(recoveryDownload.suggestedFilename(), /^latex-writing-quality-v1-.*-recovery\.json$/);
  const recoveryFile = JSON.parse(fs.readFileSync(await recoveryDownload.path(), 'utf8'));
  assert.equal(recoveryFile.protocol_id, contract.protocol_id);
  assert.equal(recoveryFile.schema, 'xacl.latex-writing-quality-recovery.v1');
  assert.equal(recoveryFile.record.annotations.RL03.scores.language_clarity, 4);
  assert.equal(recoveryFile.unsaved, true);
  await assertOldRecoveryUntouched(pageB, annotatorId);
  await assertOldRecoveryUntouched(pageC, annotatorId);
  report.checks.push('Recovery code restores the same profile on a second device; optimistic revision conflict preserves the authoritative row and offers only the namespaced private unsaved-recovery download.');

  const failureId = annotatorId + '_FAIL';
  const failureContext = await freshContext(failureId, { label: 'failed-exposure-profile' });
  const failurePage = await fresh(failureContext);
  const failureCode = await createProfile(failurePage, failureId);
  assert.match(failureCode, /^[0-9a-f]{64}$/);
  await setCoreScores(failurePage, Object.fromEntries(scoreKeys.map((key) => [key, 5])));
  await setScope(failurePage, true);
  await failurePage.locator('#complete-review').click();
  await saved(failureContext, failureId, (record) => record.annotations.RL01?.status === 'completed');
  await waitForUiSave(failurePage);
  assert.equal(await failurePage.locator('#version-audit-toggle').isDisabled(), false);
  const failedProfileOfficialCount = failureContext.__writingControl.requests.official.length;
  failureContext.__writingControl.failNextSave = true;
  await failurePage.locator('#version-audit-toggle').click();
  await failurePage.waitForFunction(() => document.querySelector('#save-status')?.dataset.state === 'error' && document.querySelector('#version-audit-toggle')?.disabled, null, { timeout: 15000 });
  await sleep(400);
  assert.ok(await failurePage.locator('#official-viewer').isHidden());
  assert.equal(failureContext.__writingControl.requests.official.length, failedProfileOfficialCount);
  assert.equal((await writingRecord(failureContext, failureId)).annotations.RL01.reference_exposed, false);
  await assertOldRecoveryUntouched(failurePage, failureId);
  report.checks.push('A separate profile confirms a failed exposure save keeps the optional reference hidden and makes no official-PDF request.');

  assert.deepEqual(report.page_errors, [], 'No uncaught browser errors are permitted.');
  assert.deepEqual(report.unexpected_requests, [], 'The browser must not contact unexpected origins.');
  assert.deepEqual(report.writing_rpc_calls.filter((name) => !name.startsWith('xacl_writing_')), [], 'The active writing app must use only its writing RPC namespace.');
  assert.ok(report.writing_rpc_calls.includes('xacl_writing_register_annotator'));
  assert.ok(report.writing_rpc_calls.includes('xacl_writing_resume_annotator'));
  assert.ok(report.writing_rpc_calls.includes('xacl_writing_save_annotations'));
  report.status = 'passed';
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  report.status = 'failed';
  report.error = error.stack || String(error);
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
});
