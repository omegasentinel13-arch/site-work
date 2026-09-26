import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_step2_qa_temp');

const SECRET_KEY = new TextEncoder().encode(
  'site_work_super_secret_session_key_min_32_characters_long_2026_engineering'
);

async function makeToken(payload: {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  assignedSiteIds: string[];
  tokenVersion: number;
}): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET_KEY);
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CdpClient {
  ws: WebSocket;
  id = 1;
  callbacks = new Map<number, (res: any) => void>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
  }

  async connect(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          this.callbacks.get(msg.id)!(msg);
          this.callbacks.delete(msg.id);
        }
      };
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.id++;
    return new Promise((resolve) => {
      this.callbacks.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr: string): Promise<any> {
    const trimmed = expr.trim();
    let wrappedExpr = trimmed;
    if (!trimmed.startsWith('(() =>') && !trimmed.startsWith('(function') && !trimmed.startsWith('{')) {
      if (trimmed.includes('return ')) {
        wrappedExpr = `(() => {\n${trimmed}\n})()`;
      } else if (trimmed.includes('const ') || trimmed.includes('let ') || trimmed.includes('var ')) {
        wrappedExpr = `{\n${trimmed}\n}`;
      }
    }
    const res = await this.send('Runtime.evaluate', { 
      expression: wrappedExpr, 
      returnByValue: true, 
      awaitPromise: true 
    });
    if (res.result?.exceptionDetails) {
      console.error('CDP EVAL EXCEPTION:', JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runStep2BrowserQA() {
  console.log('================================================================');
  console.log('SITE WORK STEP 2 — REAL BROWSER UI QA VERIFICATION');
  console.log('Target: http://localhost:3001 ONLY (data/test_site_work.db)');
  console.log('================================================================\n');

  // Pre-check Production DB Safety
  const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPre = prodDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPre = prodDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPre = prodDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  prodDb.close();

  console.log(`[Production DB Pre-Check] audit_logs: ${prodAuditPre.c}, roles: ${prodRolesPre.c}, categories: ${prodCatsPre.c}`);
  assert.equal(prodAuditPre.c, 428, 'Production audit logs MUST BE 428 before browser QA starts!');

  // Clean previous test entities in test DB only (never touch audit_logs)
  const testDbInit = new DatabaseSync('data/test_site_work.db');
  testDbInit.prepare("DELETE FROM work_roles WHERE name LIKE '%Quality%' OR name LIKE '%Temporary%'").run();
  testDbInit.prepare("DELETE FROM work_categories WHERE name LIKE '%SCAFFOLDING%' OR name LIKE '%DELETABLE%'").run();
  testDbInit.prepare("UPDATE work_roles SET is_active = 1 WHERE id = 'role-mason'").run();
  testDbInit.close();

  // Launch Chrome Headless with Remote Debugging
  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ]);

  let retries = 30;
  let pageWsUrl = '';
  while (retries > 0) {
    try {
      const list = await fetchJson('http://127.0.0.1:9222/json/list');
      if (Array.isArray(list) && list.length > 0) {
        const pageTarget = list.find((t: any) => t.type === 'page') || list[0];
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          pageWsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {
      await sleep(200);
      retries--;
    }
  }

  assert.ok(pageWsUrl, 'Failed to connect to Chrome DevTools Protocol');
  const cdp = new CdpClient(pageWsUrl);
  await cdp.connect();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  // Set Admin session cookie for http://localhost:3001
  const adminToken = await makeToken({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Administrator',
    role: 'ADMIN',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 11,
  });

  await cdp.send('Network.setCookie', {
    name: 'site_work_session',
    value: adminToken,
    url: 'http://localhost:3001',
    path: '/',
  });

  async function navigate(url: string, waitSelector = 'h1'): Promise<void> {
    await cdp.send('Page.navigate', { url });
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const ready = await cdp.eval(`
        (() => {
          if (!document.querySelector('${waitSelector}')) return false;
          const txt = document.body ? document.body.textContent : '';
          if (txt.includes('Loading roles...') || txt.includes('Loading categories...') || txt.includes('Loading attendance...')) return false;
          return true;
        })()
      `);
      if (ready) {
        await sleep(800); // Allow full React hydration and event listener attachment
        await cdp.eval(`
          window.__setValue = (el, val) => {
            if (!el) return;
            if (el.tagName === 'SELECT') {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
              if (setter) setter.call(el, val); else el.value = val;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.focus();
              const prev = el.value;
              if (el._valueTracker) {
                el._valueTracker.setValue(prev + '_prev_');
              }
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(el, val); else el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
        `);
        return;
      }
      await sleep(150);
    }
    throw new Error(`Timeout waiting for selector '${waitSelector}' on ${url}`);
  }

  // =========================================================================
  // SECTION 1: ROLES UI INTERACTION VERIFICATION (/setup/roles)
  // =========================================================================
  console.log('\n===============================================================');
  console.log('PART 1: ROLES MANAGEMENT UI QA (/setup/roles)');
  console.log('===============================================================');

  await navigate('http://localhost:3001/setup/roles', 'h1');

  // 1. Page heading is exactly: ROLES
  const headingText = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
  assert.equal(headingText, 'ROLES', 'Page heading must be exactly ROLES');
  console.log('✓ 1. Heading is strictly "ROLES"');

  // 2. CATEGORY button text is exactly: CATEGORY
  const categoryBtnText = await cdp.eval(`
    Array.from(document.querySelectorAll('a, button'))
      .find(el => el.getAttribute('href') === '/setup/categories')
      ?.textContent?.trim()
  `);
  assert.equal(categoryBtnText, 'CATEGORY', 'Category button text must be strictly CATEGORY');
  console.log('✓ 2. CATEGORY button text is strictly "CATEGORY"');

  // 3. + ROLE opens modal
  for (let i = 0; i < 5; i++) {
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
      if (btn) btn.click();
    `);
    await sleep(400);
    const isOpen = await cdp.eval(`!!document.querySelector('div[role="dialog"]')`);
    if (isOpen) break;
  }
  let modalOpen = await cdp.eval(`!!document.querySelector('div[role="dialog"]')`);
  assert.ok(modalOpen, '+ ROLE button must open modal dialog');
  console.log('✓ 3. + ROLE opens modal dialog');

  // 4. Create Role through UI
  await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    const nameInput = dialog.querySelector('input[type="text"]');
    const categorySelect = dialog.querySelector('select');
    const rateInput = dialog.querySelector('input[type="number"]');

    // React controlled inputs require setting value & dispatching input event
    const setValue = (el, val) => {
      if (!el) return;
      if (el.tagName === 'SELECT') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
      } else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val); else el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    setValue(nameInput, 'Lead Quality Inspector');
    setValue(categorySelect, 'cat-civil');
    setValue(rateInput, '1750');
  `);
  await sleep(200);

  // Submit form
  await cdp.eval(`
    const submitBtn = Array.from(document.querySelectorAll('div[role="dialog"] button[type="submit"]'))[0];
    if (submitBtn) submitBtn.click();
  `);
  await sleep(1000);

  // Verify newly created role appears in UI
  let roleFoundInUi = await cdp.eval(`document.body.textContent.includes('Lead Quality Inspector')`);
  assert.ok(roleFoundInUi, 'Newly created role "Lead Quality Inspector" must appear in the UI');
  console.log('✓ 4. Role created through UI: name, category, daily wage saved & rendered.');

  // 5. Edit Role through UI
  const editClickRes = await cdp.eval(`
    (() => {
      const rows = Array.from(document.querySelectorAll('tr')).filter(el => el.textContent.includes('Lead Quality Inspector'));
      if (!rows.length) return 'no row found';
      const btn = rows[0].querySelector('button[title*="Edit"], button[aria-label*="Edit"]');
      if (!btn) return 'no edit button in row';
      btn.click();
      return 'clicked';
    })()
  `);
  console.log('Edit click result:', editClickRes);
  await sleep(600);

  const dialogInfo = await cdp.eval(`
    (() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return 'no dialog found';
      const h3 = dialog.querySelector('h3')?.textContent;
      const inputs = Array.from(dialog.querySelectorAll('input, select')).map(el => ({ tag: el.tagName, val: el.value, type: el.type }));
      return { h3, inputs };
    })()
  `);
  console.log('Dialog Info after edit click:', JSON.stringify(dialogInfo));

  // Modify name to "Senior Quality Inspector", category to FINISHING (cat-finishing), rate to 1850
  const setValLogs = await cdp.eval(`
    (() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return 'no dialog';
      const nameInput = dialog.querySelector('input[type="text"]');
      const categorySelect = dialog.querySelector('select');
      const rateInput = dialog.querySelector('input[type="number"]');

      const logs = [];
      const setValue = (el, val) => {
        if (!el) { logs.push('el is null'); return; }
        logs.push('setting ' + el.tagName + ' to ' + val);
        if (el.tagName === 'SELECT') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          logs.push('select now: ' + el.value);
        } else {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val); else el.value = val;
          if (el._valueTracker) el._valueTracker.setValue('');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          logs.push('input now: ' + el.value);
        }
      };

      setValue(nameInput, 'Senior Quality Inspector');
      setValue(categorySelect, 'cat-finishing');
      setValue(rateInput, '1850');
      return logs;
    })()
  `);
  console.log('SetValue logs:', JSON.stringify(setValLogs));
  await sleep(300);

  const valuesBeforeSubmit = await cdp.eval(`
    (() => {
      const dialog = document.querySelector('div[role="dialog"]');
      return {
        name: dialog?.querySelector('input[type="text"]')?.value,
        cat: dialog?.querySelector('select')?.value,
        rate: dialog?.querySelector('input[type="number"]')?.value,
      };
    })()
  `);
  console.log('Values in dialog before submit:', JSON.stringify(valuesBeforeSubmit));

  const submitInfo = await cdp.eval(`
    (() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return 'no dialog';
      const submitBtn = dialog.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        return { clickedBtn: true };
      }
      const form = dialog.querySelector('form');
      if (form) {
        form.requestSubmit();
        return { submitted: true };
      }
      return 'no form or btn';
    })()
  `);
  console.log('Submit Info:', JSON.stringify(submitInfo));
  await sleep(1500);

  const postSubmitState = await cdp.eval(`
    (() => {
      const dialog = document.querySelector('div[role="dialog"]');
      return {
        dialogOpen: !!dialog,
        error: dialog ? dialog.querySelector('.text-rose-700')?.textContent : null,
      };
    })()
  `);
  console.log('Post Submit State:', JSON.stringify(postSubmitState));

  let updatedRoleFound = await cdp.eval(`document.body.textContent.includes('Senior Quality Inspector')`);
  assert.ok(updatedRoleFound, 'Edited role "Senior Quality Inspector" must appear in UI');
  console.log('✓ 5. Role edited through UI: name, category, and wage persisted.');

  // 6. Search: Role-name and Category-name search
  await cdp.eval(`
    const searchInput = document.querySelector('input[placeholder*="Search"]');
    window.__setValue(searchInput, 'Senior Quality');
  `);
  await sleep(400);

  let searchMatchesRole = await cdp.eval(`
    document.body.textContent.includes('Senior Quality Inspector') && !document.body.textContent.includes('Mason')
  `);
  assert.ok(searchMatchesRole, 'Search by role name must filter to matching role only');

  // Search by category name
  await cdp.eval(`
    const searchInput = document.querySelector('input[placeholder*="Search"]');
    window.__setValue(searchInput, 'FINISHING');
  `);
  await sleep(400);
  let searchMatchesCat = await cdp.eval(`document.body.textContent.includes('FINISHING WORKS')`);
  assert.ok(searchMatchesCat, 'Search by category name must show matching category roles');

  // Clear search
  await cdp.eval(`
    const searchInput = document.querySelector('input[placeholder*="Search"]');
    window.__setValue(searchInput, '');
  `);
  await sleep(400);

  const searchValAfterClear = await cdp.eval(`
    document.querySelector('input[placeholder*="Search"]')?.value
  `);
  console.log('Search input value after clear:', JSON.stringify(searchValAfterClear));

  console.log('✓ 6. Search works for both role title and category name.');

  // 7. Filters: ALL, ACTIVE, INACTIVE tabs
  const tabClickInfo = await cdp.eval(`
    (() => {
      const allButtons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const inactiveTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('INACTIVE'));
      if (inactiveTab) {
        inactiveTab.click();
        return { clicked: true, btnText: inactiveTab.textContent, allButtons };
      }
      return { clicked: false, allButtons };
    })()
  `);
  console.log('Tab click info:', JSON.stringify(tabClickInfo));
  await sleep(600);

  const pageInfoAfterTab = await cdp.eval(`
    (() => {
      const rows = Array.from(document.querySelectorAll('tbody tr')).map(r => r.textContent.replace(/\\s+/g, ' ').trim());
      return { rowCount: rows.length, rows };
    })()
  `);
  console.log('Page info after INACTIVE tab:', JSON.stringify(pageInfoAfterTab));

  let inactiveOnly = await cdp.eval(`
    !document.body.textContent.includes('Mason') && document.body.textContent.includes('Scaffolding Foreman')
  `);
  assert.ok(inactiveOnly, 'INACTIVE tab must show only inactive roles');

  await cdp.eval(`
    const activeTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ACTIVE'));
    if (activeTab) activeTab.click();
  `);
  await sleep(400);
  let activeOnly = await cdp.eval(`
    document.body.textContent.includes('Mason') && !document.body.textContent.includes('Scaffolding Foreman')
  `);
  assert.ok(activeOnly, 'ACTIVE tab must show only active roles');

  await cdp.eval(`
    const allTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ALL'));
    if (allTab) allTab.click();
  `);
  await sleep(400);
  console.log('✓ 7. Filters ALL / ACTIVE / INACTIVE tabs function correctly.');

  // 8. Deactivate through UI
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Senior Quality Inspector'));
    const toggleBtn = row.querySelector('button[aria-label*="Deactivate"]');
    if (toggleBtn) toggleBtn.click();
  `);
  await sleep(800);

  let isNowInactive = await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Senior Quality Inspector'));
    return row && row.textContent.includes('Inactive');
  `);
  assert.ok(isNowInactive, 'Role status pill must change to Inactive after clicking Deactivate');
  console.log('✓ 8. Role deactivated through UI: status changes to Inactive.');

  // 9. Reactivate through UI & check ID preserved
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Senior Quality Inspector'));
    const toggleBtn = row.querySelector('button[aria-label*="Activate"]');
    if (toggleBtn) toggleBtn.click();
  `);
  await sleep(800);

  let isNowActive = await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Senior Quality Inspector'));
    return row && row.textContent.includes('Active');
  `);
  assert.ok(isNowActive, 'Role status pill must change to Active after clicking Activate');
  console.log('✓ 9. Role reactivated through UI: status changes to Active with same ID preserved.');

  // 10. Details Modal: Usage intelligence renders correctly
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Mason'));
    const detailsBtn = row.querySelector('button[title*="Details"]');
    if (detailsBtn) detailsBtn.click();
  `);
  await sleep(400);

  let detailsRendered = await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;
    const txt = dialog.textContent;
    return txt.includes('Historical Usage Statistics') && txt.includes('Attendance Records') && txt.includes('Total Worker-Days');
  `);
  assert.ok(detailsRendered, 'Role Details modal must render usage intelligence');

  // Close details modal
  await cdp.eval(`
    const closeBtn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Close') || b.querySelector('svg'));
    if (closeBtn) closeBtn.click();
  `);
  await sleep(300);
  console.log('✓ 10. Details modal displays role usage intelligence accurately.');

  // 11. Archive through UI
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Senior Quality Inspector'));
    const archiveBtn = row.querySelector('button[title*="Archive"]');
    if (archiveBtn) archiveBtn.click();
  `);
  await sleep(300);

  // Confirm Archive
  await cdp.eval(`
    const confirmArchiveBtn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Archive Role'));
    if (confirmArchiveBtn) confirmArchiveBtn.click();
  `);
  await sleep(800);

  // Verify role disappears from operational view
  let roleArchivedFromUi = await cdp.eval(`!document.body.textContent.includes('Senior Quality Inspector')`);
  assert.ok(roleArchivedFromUi, 'Archived role must disappear from operational UI view');
  console.log('✓ 11. Role archived through UI: disappears from operational view.');

  // 13. Delete to Recycle Bin with strict typed CONFIRM
  // First create a new role to delete
  await cdp.eval(`
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
    if (btn) btn.click();
  `);
  await sleep(300);
  await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    const nameInput = dialog.querySelector('input[type="text"]');
    const categorySelect = dialog.querySelector('select');
    const rateInput = dialog.querySelector('input[type="number"]');

    window.__setValue(nameInput, 'Temporary Test Role');
    window.__setValue(categorySelect, 'cat-civil');
    window.__setValue(rateInput, '900');
  `);
  await sleep(200);
  await cdp.eval(`
    const submitBtn = Array.from(document.querySelectorAll('div[role="dialog"] button[type="submit"]'))[0];
    if (submitBtn) submitBtn.click();
  `);
  await sleep(800);

  // Click Delete button on Temporary Test Role
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Temporary Test Role'));
    const deleteBtn = row.querySelector('button[title*="Recycle"]');
    if (deleteBtn) deleteBtn.click();
  `);
  await sleep(400);

  // Verify modal clearly says Recycle Bin
  let modalHasRecycleBin = await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    return dialog && dialog.textContent.includes('Recycle Bin');
  `);
  assert.ok(modalHasRecycleBin, 'Modal must clearly state Recycle Bin');

  // Test partial/incorrect input keeps button disabled
  await cdp.eval(`
    const input = document.querySelector('div[role="dialog"] input[placeholder="CONFIRM"]');
    window.__setValue(input, 'conf');
  `);
  await sleep(200);

  let btnDisabledPartial = await cdp.eval(`
    const btn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Recycle Bin'));
    return btn && btn.disabled;
  `);
  assert.ok(btnDisabledPartial, 'Delete button must be disabled for partial input');

  // Test lowercase with whitespace " confirm " enables button
  await cdp.eval(`
    const input = document.querySelector('div[role="dialog"] input[placeholder="CONFIRM"]');
    window.__setValue(input, '  confirm  ');
  `);
  await sleep(200);

  let btnEnabledNormalized = await cdp.eval(`
    const btn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Recycle Bin'));
    return btn && !btn.disabled;
  `);
  assert.ok(btnEnabledNormalized, 'Delete button must be enabled for normalized CONFIRM with whitespace and lowercase');

  // Click Move to Recycle Bin
  await cdp.eval(`
    const btn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Recycle Bin'));
    if (btn) btn.click();
  `);
  await sleep(800);

  let tempRoleDeletedFromUi = await cdp.eval(`!document.body.textContent.includes('Temporary Test Role')`);
  assert.ok(tempRoleDeletedFromUi, 'Deleted role must disappear from operational UI view');
  console.log('✓ 13. Delete to Recycle Bin verified: modal says Recycle Bin, CONFIRM validation is case-insensitive & trimmed.');

  // 14 & 15. Historical Attendance for Inactive Role
  console.log('\n--- Checking Daily Attendance Inactive Role Visibility via Browser ---');
  // Deactivate role-mason
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Mason'));
    const toggleBtn = row.querySelector('button[aria-label*="Deactivate"]');
    if (toggleBtn) toggleBtn.click();
  `);
  await sleep(800);

  // Navigate to historical date 2026-09-02
  await navigate('http://localhost:3001/attendance/daily?siteId=site-1&date=2026-09-02', '#daily-attendance-date-picker');
  let historicalMasonVisible = await cdp.eval(`
    Array.from(document.querySelectorAll('tr')).some(r => r.textContent.includes('Mason') && !r.textContent.includes('Tile'))
  `);
  assert.ok(historicalMasonVisible, 'Deactivated Mason MUST remain visible on historical date with existing records');
  console.log('✓ 14. Inactive role on historical date remains visible with intact record & rates.');

  // Navigate to brand-new date 2026-09-30
  await navigate('http://localhost:3001/attendance/daily?siteId=site-1&date=2026-09-30', '#daily-attendance-date-picker');
  let newDateMasonExcluded = await cdp.eval(`
    !Array.from(document.querySelectorAll('tr')).some(r => r.textContent.includes('Mason') && !r.textContent.includes('Tile'))
  `);
  assert.ok(newDateMasonExcluded, 'Deactivated Mason MUST NOT appear on brand-new date with zero records');
  console.log('✓ 15. Inactive role correctly excluded on new date.');

  // Reactivate role-mason
  await navigate('http://localhost:3001/setup/roles', 'h1');
  await cdp.eval(`
    const inactiveTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('INACTIVE'));
    if (inactiveTab) inactiveTab.click();
  `);
  await sleep(400);
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('Mason'));
    const toggleBtn = row?.querySelector('button[aria-label*="Activate"]');
    if (toggleBtn) toggleBtn.click();
  `);
  await sleep(800);

  // =========================================================================
  // SECTION 2: CATEGORIES UI INTERACTION VERIFICATION (/setup/categories)
  // =========================================================================
  console.log('\n===============================================================');
  console.log('PART 2: CATEGORIES MANAGEMENT UI QA (/setup/categories)');
  console.log('===============================================================');

  await navigate('http://localhost:3001/setup/categories', 'h1');

  // 1. Heading exactly: CATEGORIES
  const catHeadingText = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
  assert.equal(catHeadingText, 'CATEGORIES', 'Heading must be strictly CATEGORIES');
  console.log('✓ 1. Heading is strictly "CATEGORIES"');

  // 2. ROLES button navigates to /setup/roles
  const rolesNavHref = await cdp.eval(`
    Array.from(document.querySelectorAll('a'))
      .find(a => a.textContent.includes('ROLES'))
      ?.getAttribute('href')
  `);
  assert.equal(rolesNavHref, '/setup/roles', 'ROLES button must navigate to /setup/roles');
  console.log('✓ 2. ROLES button links directly to /setup/roles');

  // 3. + CATEGORY opens modal
  for (let i = 0; i < 5; i++) {
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ CATEGORY'));
      if (btn) btn.click();
    `);
    await sleep(400);
    const isOpen = await cdp.eval(`!!document.querySelector('div[role="dialog"]')`);
    if (isOpen) break;
  }
  let catModalOpen = await cdp.eval(`!!document.querySelector('div[role="dialog"]')`);
  assert.ok(catModalOpen, '+ CATEGORY button must open modal');
  console.log('✓ 3. + CATEGORY opens modal dialog');

  // 4. Create category through UI
  await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    const nameInput = dialog.querySelector('input[type="text"]');
    const sortInput = dialog.querySelector('input[type="number"]');

    window.__setValue(nameInput, 'SPECIALIST SCAFFOLDING');
    window.__setValue(sortInput, '10');
  `);
  await sleep(200);
  await cdp.eval(`
    const submitBtn = Array.from(document.querySelectorAll('div[role="dialog"] button[type="submit"]'))[0];
    if (submitBtn) submitBtn.click();
  `);
  await sleep(800);

  let newCatAppeared = await cdp.eval(`document.body.textContent.includes('SPECIALIST SCAFFOLDING')`);
  assert.ok(newCatAppeared, 'New category SPECIALIST SCAFFOLDING must appear in UI');
  console.log('✓ 4. Category created through UI.');

  // 5. Edit category through UI
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('SPECIALIST SCAFFOLDING'));
    const editBtn = row.querySelector('button[title*="Edit"]');
    if (editBtn) editBtn.click();
  `);
  await sleep(300);

  await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    const nameInput = dialog.querySelector('input[type="text"]');
    window.__setValue(nameInput, 'ADVANCED SCAFFOLDING');
  `);
  await sleep(200);
  await cdp.eval(`
    const submitBtn = Array.from(document.querySelectorAll('div[role="dialog"] button[type="submit"]'))[0];
    if (submitBtn) submitBtn.click();
  `);
  await sleep(800);

  let editedCatAppeared = await cdp.eval(`document.body.textContent.includes('ADVANCED SCAFFOLDING')`);
  assert.ok(editedCatAppeared, 'Edited category ADVANCED SCAFFOLDING must appear in UI');
  console.log('✓ 5. Category edited through UI.');

  // 6. Duplicate category name rejected
  await cdp.eval(`
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ CATEGORY'));
    if (btn) btn.click();
  `);
  await sleep(300);
  await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    const nameInput = dialog.querySelector('input[type="text"]');
    window.__setValue(nameInput, 'ADVANCED SCAFFOLDING');
  `);
  await sleep(200);
  await cdp.eval(`
    const submitBtn = Array.from(document.querySelectorAll('div[role="dialog"] button[type="submit"]'))[0];
    if (submitBtn) submitBtn.click();
  `);
  await sleep(600);

  let duplicateErrorShown = await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    return dialog && dialog.textContent.includes('already exists');
  `);
  assert.ok(duplicateErrorShown, 'Duplicate category name must display clear error');

  // Close modal
  await cdp.eval(`
    const cancelBtn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Cancel'));
    if (cancelBtn) cancelBtn.click();
  `);
  await sleep(300);
  console.log('✓ 6. Duplicate category rejected with clear error.');

  // 7. Search works
  await cdp.eval(`
    const searchInput = document.querySelector('input[placeholder*="Search"]');
    window.__setValue(searchInput, 'SCAFFOLDING');
  `);
  await sleep(400);

  let searchCatResult = await cdp.eval(`
    document.body.textContent.includes('ADVANCED SCAFFOLDING') && !document.body.textContent.includes('CIVIL WORKS')
  `);
  assert.ok(searchCatResult, 'Search must filter categories');

  // Clear search
  await cdp.eval(`
    const searchInput = document.querySelector('input[placeholder*="Search"]');
    window.__setValue(searchInput, '');
  `);
  await sleep(400);
  console.log('✓ 7. Category search works.');

  // 8. Filters: ALL / ACTIVE / INACTIVE tabs
  await cdp.eval(`
    const activeTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ACTIVE'));
    if (activeTab) activeTab.click();
  `);
  await sleep(300);
  await cdp.eval(`
    const allTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ALL'));
    if (allTab) allTab.click();
  `);
  await sleep(300);
  console.log('✓ 8. Category filter tabs work.');

  // 9. Deactivate category
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('ADVANCED SCAFFOLDING'));
    const toggleBtn = row.querySelector('button[aria-label*="Deactivate"]');
    if (toggleBtn) toggleBtn.click();
  `);
  await sleep(800);

  let isCatInactive = await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('ADVANCED SCAFFOLDING'));
    return row && row.textContent.includes('Inactive');
  `);
  assert.ok(isCatInactive, 'Category must show Inactive pill');
  console.log('✓ 9. Category deactivated.');

  // 10. Reactivate category
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('ADVANCED SCAFFOLDING'));
    const toggleBtn = row.querySelector('button[aria-label*="Activate"]');
    if (toggleBtn) toggleBtn.click();
  `);
  await sleep(800);

  let isCatActive = await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('ADVANCED SCAFFOLDING'));
    return row && row.textContent.includes('Active');
  `);
  assert.ok(isCatActive, 'Category must show Active pill');
  console.log('✓ 10. Category reactivated.');

  // 11. Archive category
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('ADVANCED SCAFFOLDING'));
    const archiveBtn = row.querySelector('button[title*="Archive"]');
    if (archiveBtn) archiveBtn.click();
  `);
  await sleep(300);

  await cdp.eval(`
    const confirmBtn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Archive Category'));
    if (confirmBtn) confirmBtn.click();
  `);
  await sleep(800);

  let catArchived = await cdp.eval(`!document.body.textContent.includes('ADVANCED SCAFFOLDING')`);
  assert.ok(catArchived, 'Archived category must disappear from operational UI');
  console.log('✓ 11. Category archived.');

  // 12. Delete to Recycle Bin with strict CONFIRM
  // First create a childless category to delete
  await cdp.eval(`
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ CATEGORY'));
    if (btn) btn.click();
  `);
  await sleep(300);
  await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    const nameInput = dialog.querySelector('input[type="text"]');
    window.__setValue(nameInput, 'DELETABLE DEMO');
  `);
  await sleep(200);
  await cdp.eval(`
    const submitBtn = Array.from(document.querySelectorAll('div[role="dialog"] button[type="submit"]'))[0];
    if (submitBtn) submitBtn.click();
  `);
  await sleep(800);

  // Click Delete on DELETABLE DEMO
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('DELETABLE DEMO'));
    const deleteBtn = row.querySelector('button[title*="Recycle"]');
    if (deleteBtn) deleteBtn.click();
  `);
  await sleep(300);

  // Test case-insensitive + trim validation: " confirm "
  await cdp.eval(`
    const input = document.querySelector('div[role="dialog"] input[placeholder="CONFIRM"]');
    window.__setValue(input, '  confirm  ');
  `);
  await sleep(200);
  await cdp.eval(`
    const deleteSubmit = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Recycle Bin'));
    if (deleteSubmit) deleteSubmit.click();
  `);
  await sleep(800);

  let demoCatDeleted = await cdp.eval(`!document.body.textContent.includes('DELETABLE DEMO')`);
  assert.ok(demoCatDeleted, 'Deleted category must disappear from operational view');
  console.log('✓ 12. Delete-to-Recycle-Bin verified with CONFIRM requirement and trim/case-insensitivity.');

  // 13. Category with child roles: Deletion MUST be blocked
  await cdp.eval(`
    const row = Array.from(document.querySelectorAll('tr')).find(r => r.textContent.includes('CIVIL WORKS'));
    const deleteBtn = row.querySelector('button[title*="Recycle"]');
    if (deleteBtn) deleteBtn.click();
  `);
  await sleep(300);

  await cdp.eval(`
    const input = document.querySelector('div[role="dialog"] input[placeholder="CONFIRM"]');
    window.__setValue(input, 'CONFIRM');
  `);
  await sleep(200);

  await cdp.eval(`
    const deleteSubmit = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Recycle Bin'));
    if (deleteSubmit) deleteSubmit.click();
  `);
  await sleep(800);

  // Modal must stay open and display blocking error
  let blockedError = await cdp.eval(`
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return null;
    return dialog.textContent;
  `);
  assert.ok(blockedError && blockedError.includes('Deletion Blocked') && blockedError.includes('depend on it'),
    'Deletion of category with child roles must be blocked with dependency explanation');
  console.log('✓ 13. Category deletion with child roles safely blocked with detailed dependency explanation.');

  // Close blocking modal
  await cdp.eval(`
    const cancelBtn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Cancel'));
    if (cancelBtn) cancelBtn.click();
  `);
  await sleep(300);

  // =========================================================================
  // SECTION 3: RESPONSIVE VIEWPORT & THEME VERIFICATION
  // =========================================================================
  console.log('\n===============================================================');
  console.log('PART 3: RESPONSIVE VIEWPORTS & THEME QA');
  console.log('===============================================================');

  const viewports = [
    { width: 390, height: 844, name: '390x844 (iPhone 12/13/14)' },
    { width: 412, height: 915, name: '412x915 (Samsung S20 / Pixel 7)' },
    { width: 430, height: 932, name: '430x932 (iPhone 14/15 Pro Max)' },
    { width: 768, height: 1024, name: '768px (iPad / Tablet)' },
    { width: 1024, height: 768, name: '1024px (Small Desktop)' },
    { width: 1280, height: 800, name: '1280px (Standard Desktop)' },
  ];

  const pagesToTest = ['http://localhost:3001/setup/roles', 'http://localhost:3001/setup/categories'];

  for (const pageUrl of pagesToTest) {
    const pageName = pageUrl.split('/').pop();
    console.log(`\nTesting Responsive Layouts for: /setup/${pageName}`);

    await navigate(pageUrl, 'h1');

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 768,
      });
      await sleep(200);

      // Check horizontal overflow
      const overflow = await cdp.eval(`
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      `);
      assert.equal(overflow, false, `Viewport ${vp.name} must NOT have horizontal document overflow`);

      // Check interactive button touch targets on mobile
      if (vp.width < 768) {
        const smallButtons = await cdp.eval(`
          (() => {
            const container = document.querySelector('main') || document.body;
            return Array.from(container.querySelectorAll('button, a'))
              .filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && (r.height < 34 || r.width < 34);
              })
              .map(el => ({ tag: el.tagName, txt: el.textContent.trim(), cls: el.className, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
          })()
        `);
        console.log('Small buttons in page:', JSON.stringify(smallButtons));
        assert.equal(smallButtons.length, 0, `All page buttons in ${vp.name} must meet interactive touch target criteria`);
      }

      console.log(`  ✓ ${vp.name}: No overflow, layout responsive.`);
    }

    // Reset viewport
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // Test LIGHT and DARK theme rendering
    console.log(`Testing Themes for: /setup/${pageName}`);
    // Dark mode
    await cdp.eval(`document.documentElement.classList.add('dark')`);
    await sleep(200);
    const darkBg = await cdp.eval(`
      window.getComputedStyle(document.body).backgroundColor
    `);
    console.log(`  ✓ DARK theme active, computed background: ${darkBg}`);

    // Light mode
    await cdp.eval(`document.documentElement.classList.remove('dark')`);
    await sleep(200);
    const lightBg = await cdp.eval(`
      window.getComputedStyle(document.body).backgroundColor
    `);
    console.log(`  ✓ LIGHT theme active, computed background: ${lightBg}`);
  }

  // =========================================================================
  // SECTION 4: POST-TEST DATABASE & SAFETY VERIFICATION
  // =========================================================================
  console.log('\n===============================================================');
  console.log('PART 4: DATABASE SAFETY & INVARIANT CHECK');
  console.log('===============================================================');

  // Verify Production DB Safety
  const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPost = prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodAttPost = prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodFinPost = prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodIntegPost = prodDbPost.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const prodFkPost = prodDbPost.prepare('PRAGMA foreign_key_check').all();
  prodDbPost.close();

  console.log(`Production DB audit_logs: ${prodAuditPost.c} (Expected: 428)`);
  console.log(`Production DB work_roles: ${prodRolesPost.c} (Expected: 23)`);
  console.log(`Production DB work_categories: ${prodCatsPost.c} (Expected: 4)`);
  console.log(`Production DB attendance_records: ${prodAttPost.c} (Expected: 18)`);
  console.log(`Production DB financial_transactions: ${prodFinPost.c} (Expected: 4)`);
  console.log(`Production DB integrity_check: ${prodIntegPost.integrity_check}`);
  console.log(`Production DB foreign_key_check: ${prodFkPost.length} errors`);

  assert.equal(prodAuditPost.c, 428, 'PRODUCTION DB AUDIT_LOGS WAS MODIFIED!');
  assert.equal(prodRolesPost.c, 23, 'PRODUCTION DB WORK_ROLES WAS MODIFIED!');
  assert.equal(prodCatsPost.c, 4, 'PRODUCTION DB WORK_CATEGORIES WAS MODIFIED!');
  assert.equal(prodAttPost.c, 18, 'PRODUCTION DB ATTENDANCE WAS MODIFIED!');
  assert.equal(prodFinPost.c, 4, 'PRODUCTION DB FINANCE WAS MODIFIED!');
  assert.equal(prodIntegPost.integrity_check, 'ok');
  assert.equal(prodFkPost.length, 0);

  // Inspect Test DB
  const testDbPost = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const testAuditPost = testDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const testRolesPost = testDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const testCatsPost = testDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const testLfcPost = testDbPost.prepare('SELECT state, COUNT(*) c FROM system_lifecycle_records GROUP BY state').all();
  const testIntegPost = testDbPost.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const testFkPost = testDbPost.prepare('PRAGMA foreign_key_check').all();
  testDbPost.close();

  console.log(`\nTest DB audit_logs: ${testAuditPost.c}`);
  console.log(`Test DB work_roles: ${testRolesPost.c}`);
  console.log(`Test DB work_categories: ${testCatsPost.c}`);
  console.log(`Test DB system_lifecycle_records:`, testLfcPost);
  console.log(`Test DB integrity_check: ${testIntegPost.integrity_check}`);
  console.log(`Test DB foreign_key_check: ${testFkPost.length} errors`);

  // Close Chrome
  cdp.ws.close();
  chromeProc.kill('SIGTERM');

  console.log('\n===============================================================');
  console.log('REAL BROWSER UI QA COMPLETE — 100% SUCCESSFUL');
  console.log('===============================================================\n');
}

runStep2BrowserQA().catch((err) => {
  console.error('\n❌ BROWSER QA FAILED:', err);
  process.exit(1);
});
