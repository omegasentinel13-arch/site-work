import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_step3a_qa_temp');

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

async function runStep3ALifecycleQA() {
  console.log('================================================================');
  console.log('SITE WORK STEP 3A — FINAL CTO CORRECTION & VERIFICATION QA');
  console.log('Target: http://localhost:3001 ONLY (data/test_site_work.db)');
  console.log('================================================================\n');

  // 1. Pre-check Production DB Safety
  const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPre = prodDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPre = prodDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPre = prodDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodSitesPre = prodDb.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  prodDb.close();

  console.log(`[Production DB Pre-Check] audit_logs: ${prodAuditPre.c}, roles: ${prodRolesPre.c}, categories: ${prodCatsPre.c}, sites: ${prodSitesPre.c}`);
  assert.equal(prodAuditPre.c, 429, 'Production audit logs MUST BE 429 before QA starts!');

  // 2. Clean previous test entities in test DB only (never touch audit_logs)
  const testDbInit = new DatabaseSync('data/test_site_work.db');
  testDbInit.prepare("DELETE FROM work_roles WHERE name LIKE '%Test QA%' OR name LIKE '%Temporary%' OR name LIKE '%Child%'").run();
  testDbInit.prepare("DELETE FROM work_categories WHERE name LIKE '%QA TEST%' OR name LIKE '%Parent Category%'").run();
  testDbInit.prepare("DELETE FROM sites WHERE name LIKE '%QA Lifecycle Site%'").run();
  testDbInit.prepare("DELETE FROM system_lifecycle_records WHERE entity_name LIKE '%QA%' OR entity_name LIKE '%Test%'").run();
  testDbInit.close();

  // 3. Create tokens
  const adminToken = await makeToken({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'System Administrator',
    role: 'ADMIN',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 11,
  });

  const engToken = await makeToken({
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Site Engineer',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    tokenVersion: 4,
  });

  const viewerToken = await makeToken({
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Project Viewer',
    role: 'VIEWER',
    assignedSiteIds: [],
    tokenVersion: 4,
  });

  // 4. Launch Headless Chrome
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

  let cdp: CdpClient | null = null;

  try {
    // Wait for Chrome CDP endpoint
    let chromeReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const tabs = await fetchJson('http://127.0.0.1:9222/json');
        if (Array.isArray(tabs)) {
          const pageTarget = tabs.find((t: any) => t.type === 'page');
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
            await cdp.connect();
            chromeReady = true;
            break;
          }
        }
      } catch {
        await sleep(500);
      }
    }

    assert.ok(chromeReady && cdp, 'Failed to connect to headless Chrome on port 9222');
    console.log('[x] Connected to headless Chrome via CDP');

    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');

    const setSessionCookie = async (token: string) => {
      await cdp!.send('Network.setCookie', {
        name: 'site_work_session',
        value: token,
        url: 'http://localhost:3001',
        path: '/',
      });
    };

    const navigateAndWait = async (url: string, waitSelector = 'h1') => {
      await cdp!.send('Page.navigate', { url });
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const pageState = await cdp!.eval(`({
          url: window.location.href,
          hasWaitSelector: document.querySelector("${waitSelector}") !== null,
          h1: document.querySelector('h1')?.textContent,
          h2: document.querySelector('h2')?.textContent,
          bodyText: document.body?.innerText?.slice(0, 200)
        })`);
        if (pageState?.hasWaitSelector) {
          await sleep(600);
          return;
        }
        await sleep(1000);
      }
      throw new Error(`Timeout waiting for selector '${waitSelector}' on ${url}`);
    };

    // Helper to send HTTP requests to port 3001
    async function apiRequest(endpoint: string, method: string, body?: any, token: string = adminToken) {
      return new Promise<{ status: number; data: any }>((resolve, reject) => {
        const url = new URL(endpoint, 'http://localhost:3001');
        const req = http.request(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `site_work_session=${token}`,
          },
        }, (res) => {
          let d = '';
          res.on('data', chunk => d += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 200, data: d ? JSON.parse(d) : {} });
            } catch {
              resolve({ status: res.statusCode || 200, data: d });
            }
          });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    }

    function getTestDb() {
      return new DatabaseSync('data/test_site_work.db', { readOnly: true });
    }

    // =========================================================================
    // PART A: GLOBAL ARCHIVE PAGE TESTS (Requirements 1-10)
    // =========================================================================
    console.log('\n--- PART A: GLOBAL ARCHIVE PAGE VERIFICATION ---');
    await setSessionCookie(adminToken);
    await navigateAndWait('http://localhost:3001/setup/archive', 'h1');

    // 1. Heading
    const archiveHeading = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
    console.log(`[Check 1] Page heading: "${archiveHeading}"`);
    assert.equal(archiveHeading, 'GLOBAL ARCHIVE', 'Archive page heading must be "GLOBAL ARCHIVE"');

    // 2. Total Count Badge
    const archiveBadgeText = await cdp.eval(`document.body.innerText.includes('Total Archived Item')`);
    console.log(`[Check 2] Total count badge exists: ${archiveBadgeText}`);
    assert.ok(archiveBadgeText, 'Total archived item count badge must exist');

    // 3. Filter Buttons for "All Entities", "Roles", "Categories", "Sites"
    const hasAllFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'All Entities')`);
    const hasRolesFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Roles')`);
    const hasCategoriesFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Categories')`);
    const hasSitesFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Sites')`);
    console.log(`[Check 3] Filters - All: ${hasAllFilter}, Roles: ${hasRolesFilter}, Categories: ${hasCategoriesFilter}, Sites: ${hasSitesFilter}`);
    assert.ok(hasAllFilter && hasRolesFilter && hasCategoriesFilter && hasSitesFilter, 'All 4 entity filter buttons must exist');

    // 4. Search Bar
    const hasArchiveSearch = await cdp.eval(`document.querySelector('input[placeholder*="Search archived entity"]') !== null`);
    console.log(`[Check 4] Search bar present: ${hasArchiveSearch}`);
    assert.ok(hasArchiveSearch, 'Search input must be present');

    // 10. Empty State Display
    await cdp.eval(`
      const input = document.querySelector('input[placeholder*="Search archived entity"]');
      if (input) {
        input.value = 'NONEXISTENT_SEARCH_STRING_12345';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
    await sleep(500);
    const hasEmptyState = await cdp.eval(`document.body.innerText.includes('No archived items found in the system')`);
    console.log(`[Check 10] Empty state renders cleanly: ${hasEmptyState}`);
    assert.ok(hasEmptyState, 'Empty state must display cleanly when no items match');

    // Clear search
    await cdp.eval(`
      const input = document.querySelector('input[placeholder*="Search archived entity"]');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
    await sleep(300);

    // =========================================================================
    // PART B: GLOBAL RECYCLE BIN PAGE TESTS (Requirements 11-24)
    // =========================================================================
    console.log('\n--- PART B: GLOBAL RECYCLE BIN PAGE VERIFICATION ---');
    await navigateAndWait('http://localhost:3001/setup/recycle-bin', 'h1');

    // 11. Heading
    const recycleHeading = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
    console.log(`[Check 11] Recycle Bin page heading: "${recycleHeading}"`);
    assert.equal(recycleHeading, 'GLOBAL RECYCLE BIN', 'Recycle Bin heading must be "GLOBAL RECYCLE BIN"');

    // 12. Total Count Badge
    const recycleBadgeText = await cdp.eval(`document.body.innerText.includes('Recycled Item')`);
    console.log(`[Check 12] Total count badge exists: ${recycleBadgeText}`);
    assert.ok(recycleBadgeText, 'Total recycled item count badge must exist');

    // 13. Filter Buttons
    const rbAllFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'All Entities')`);
    const rbRolesFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Roles')`);
    const rbCategoriesFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Categories')`);
    const rbSitesFilter = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Sites')`);
    console.log(`[Check 13] Filters - All: ${rbAllFilter}, Roles: ${rbRolesFilter}, Categories: ${rbCategoriesFilter}, Sites: ${rbSitesFilter}`);
    assert.ok(rbAllFilter && rbRolesFilter && rbCategoriesFilter && rbSitesFilter, 'All 4 entity filter buttons must exist in Recycle Bin');

    // 14. Search Bar
    const hasRecycleSearch = await cdp.eval(`document.querySelector('input[placeholder*="Search recycled item"]') !== null`);
    console.log(`[Check 14] Search bar present: ${hasRecycleSearch}`);
    assert.ok(hasRecycleSearch, 'Search input must be present');

    // 15. Human-Readable Retention Banner
    const retentionBannerFound = await cdp.eval(`document.body.innerText.includes("Items moved here will normally stay in the Recycle Bin for one month. After that, they may be permanently removed.")`);
    console.log(`[Check 15] Human-readable retention banner: ${retentionBannerFound}`);
    assert.ok(retentionBannerFound, 'Exact required retention banner wording must be present');

    // 17. NO Technical Jargon Check
    const pageText = (await cdp.eval(`document.body.innerText`)).toLowerCase();
    const hasTtl = pageText.includes('ttl');
    const hasDaemon = pageText.includes('daemon');
    const hasPurgeWorker = pageText.includes('purge worker');
    const hasHardDeleteScheduled = pageText.includes('hard delete scheduled');
    console.log(`[Check 17] Technical Jargon Check - TTL: ${hasTtl}, daemon: ${hasDaemon}, purge worker: ${hasPurgeWorker}, hard delete: ${hasHardDeleteScheduled}`);
    assert.equal(hasTtl || hasDaemon || hasPurgeWorker || hasHardDeleteScheduled, false, 'No technical jargon allowed');

    // 21. Empty State
    const hasRbEmptyState = await cdp.eval(`document.body.innerText.includes('The Recycle Bin is currently empty')`);
    console.log(`[Check 21] Clean empty state display: ${hasRbEmptyState}`);
    assert.ok(hasRbEmptyState, 'Clean empty state when bin has 0 items');

    // 22, 23, 24. STRICT PROHIBITIONS IN STEP 3A
    const hasPermDeleteButton = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.toLowerCase().includes('permanently delete'))`);
    const hasEmptyBinButton = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.toLowerCase().includes('empty recycle bin'))`);
    const hasKeepToggle = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent?.toLowerCase().includes('keep permanently') || b.textContent?.toLowerCase().includes('remove exemption'))`);
    console.log(`[Check 22] Permanent Delete Button present: ${hasPermDeleteButton} (MUST BE FALSE)`);
    console.log(`[Check 23] Empty Bin Button present: ${hasEmptyBinButton} (MUST BE FALSE)`);
    console.log(`[Check 24] Keep Permanently Toggle present: ${hasKeepToggle} (MUST BE FALSE)`);
    assert.equal(hasPermDeleteButton, false, 'Permanent Delete button prohibited in Step 3A');
    assert.equal(hasEmptyBinButton, false, 'Empty Recycle Bin button prohibited in Step 3A');
    assert.equal(hasKeepToggle, false, 'Keep Permanently mutation toggle prohibited in Step 3A');

    // =========================================================================
    // PART C: UI CONFIRMATION DIALOG SEMANTICS (MOVE ARCHIVE -> RECYCLE BIN)
    // =========================================================================
    console.log('\n--- PART C: UI CONFIRMATION DIALOG SEMANTICS (TYPING "CONFIRM") ---');
    // Create role and archive it
    const createRoleForModal = await apiRequest('/api/roles', 'POST', {
      categoryId: 'cat-civil',
      name: 'Test QA Dialog Mason Role',
      defaultRateRupees: 900,
    });
    assert.equal(createRoleForModal.status, 200);
    const modalRoleId = createRoleForModal.data.roleId;

    await apiRequest('/api/roles', 'PATCH', { id: modalRoleId, action: 'ARCHIVE' });

    // Navigate to Archive UI
    await navigateAndWait('http://localhost:3001/setup/archive', 'h1');

    // Find and click the "Recycle Bin" button for our archived role
    const openedModal = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const targetRow = rows.find(r => r.innerText.includes('Test QA Dialog Mason Role'));
      if (!targetRow) return false;
      const btn = Array.from(targetRow.querySelectorAll('button')).find(b => b.textContent.includes('Recycle Bin'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.ok(openedModal, 'Must find and click Recycle Bin button on the archived role row');
    await sleep(500);

    // Verify modal is open
    const modalTitle = await cdp.eval(`document.getElementById('archive-recycle-modal-title')?.textContent?.trim()`);
    console.log(`  Modal opened with title: "${modalTitle}"`);
    assert.equal(modalTitle?.toUpperCase(), 'MOVE TO RECYCLE BIN');

    // 1. Check disabled state when input is empty
    const btnDisabledInitial = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm Move to Bin'));
      return btn ? btn.disabled : null;
    })()`);
    console.log(`  Initial button disabled (empty input): ${btnDisabledInitial}`);
    assert.equal(btnDisabledInitial, true, 'Confirm button must be disabled when input is empty');

    // 2. Check disabled state when input is wrong word ("DELETE")
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder="CONFIRM"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'DELETE');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await sleep(200);
    const btnDisabledDelete = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm Move to Bin'));
      return btn ? btn.disabled : null;
    })()`);
    console.log(`  Button disabled when input is "DELETE": ${btnDisabledDelete}`);
    assert.equal(btnDisabledDelete, true, 'Confirm button must be disabled when typing "DELETE"');

    // 3. Check disabled state when input is partial ("conf")
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder="CONFIRM"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'conf');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await sleep(200);
    const btnDisabledPartial = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm Move to Bin'));
      return btn ? btn.disabled : null;
    })()`);
    console.log(`  Button disabled when input is "conf": ${btnDisabledPartial}`);
    assert.equal(btnDisabledPartial, true, 'Confirm button must be disabled when typing partial word');

    // 4. Check enabled state when input is "  confirm  " (case-insensitive + whitespace trimmed)
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder="CONFIRM"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '  confirm  ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await sleep(200);
    const btnEnabledWhitespace = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm Move to Bin'));
      return btn ? !btn.disabled : null;
    })()`);
    console.log(`  Button enabled when input is "  confirm  ": ${btnEnabledWhitespace}`);
    assert.equal(btnEnabledWhitespace, true, 'Confirm button must be enabled when typing trimmed case-insensitive "CONFIRM"');

    // 5. Submit modal
    await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm Move to Bin'));
      if (btn) btn.click();
    })()`);
    await sleep(1000);

    // Verify modal is closed
    const modalClosed = await cdp.eval(`document.getElementById('archive-recycle-modal-title') === null`);
    console.log(`  Modal closed after submission: ${modalClosed}`);
    assert.ok(modalClosed, 'Modal must close after successful move');

    // Verify item is now in Recycle Bin
    await navigateAndWait('http://localhost:3001/setup/recycle-bin', 'h1');
    const movedRoleInBin = await cdp.eval(`document.body.innerText.includes('Test QA Dialog Mason Role')`);
    console.log(`  Item now in Global Recycle Bin: ${movedRoleInBin}`);
    assert.ok(movedRoleInBin, 'Moved item must appear in Global Recycle Bin');

    // Check test DB lifecycle record and audit log
    {
      const db = getTestDb();
      const lfcRow = db.prepare("SELECT * FROM system_lifecycle_records WHERE entity_id = ? AND state = 'RECYCLE_BIN'").get(modalRoleId) as any;
      const auditLog = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_DELETED_TO_RECYCLE_BIN'").get(modalRoleId);
      db.close();

      assert.ok(lfcRow, 'Lifecycle record must have state = RECYCLE_BIN');
      assert.ok(auditLog, 'Audit log ROLE_DELETED_TO_RECYCLE_BIN must be recorded');
      console.log('  [PASS] Confirmation Semantics (CONFIRM) & Move to Recycle Bin UI Fully Verified!');
    }

    // =========================================================================
    // PART D: RESTORE MUTATIONS & ATOMIC AUDIT (Requirements 25-34)
    // =========================================================================
    console.log('\n--- PART D: RESTORE MUTATIONS & ATOMIC AUDIT VERIFICATION ---');

    // 25. Role Archive -> Restore
    console.log('\n[Check 25] Testing Role: Active -> Archived -> Restored');
    const createRoleRes = await apiRequest('/api/roles', 'POST', {
      categoryId: 'cat-civil',
      name: 'Test QA Mason Role',
      defaultRateRupees: 850,
    });
    assert.equal(createRoleRes.status, 200);
    const testRoleId = createRoleRes.data.roleId;

    const archiveRoleRes = await apiRequest('/api/roles', 'PATCH', {
      id: testRoleId,
      action: 'ARCHIVE',
    });
    assert.equal(archiveRoleRes.status, 200);

    // Verify it appears in Global Archive UI
    await navigateAndWait('http://localhost:3001/setup/archive', 'h1');
    const roleInArchive = await cdp.eval(`document.body.innerText.includes('Test QA Mason Role')`);
    assert.ok(roleInArchive, 'Archived role must be displayed in Global Archive');

    // Restore Role via Global Restore API
    const restoreRoleRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'WORK_ROLE',
      entityId: testRoleId,
    });
    assert.equal(restoreRoleRes.status, 200);

    {
      const db = getTestDb();
      const roleRow = db.prepare('SELECT is_active FROM work_roles WHERE id = ?').get(testRoleId) as { is_active: number };
      const lfcRow = db.prepare('SELECT * FROM system_lifecycle_records WHERE entity_id = ?').get(testRoleId);
      const auditArch = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_ARCHIVED'").get(testRoleId);
      const auditRest = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_RESTORED'").get(testRoleId);
      db.close();

      assert.equal(roleRow.is_active, 1, 'Restored role must have is_active = 1');
      assert.equal(lfcRow, undefined, 'system_lifecycle_records row must be removed');
      assert.ok(auditArch, 'ROLE_ARCHIVED audit log must exist');
      assert.ok(auditRest, 'ROLE_RESTORED audit log must exist');
      console.log('  [PASS] Role Active -> Archive -> Restore + Atomic Audit Verified!');
    }

    // 26. Role Recycle -> Restore from Bin
    console.log('\n[Check 26] Testing Role: Active -> Recycled -> Restored from Bin');
    const recycleRoleRes = await apiRequest('/api/roles', 'PATCH', {
      id: testRoleId,
      action: 'RECYCLE',
    });
    assert.equal(recycleRoleRes.status, 200);

    // Restore from Bin
    const restoreRoleFromBinRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'WORK_ROLE',
      entityId: testRoleId,
    });
    assert.equal(restoreRoleFromBinRes.status, 200);

    {
      const db = getTestDb();
      const roleRow = db.prepare('SELECT is_active FROM work_roles WHERE id = ?').get(testRoleId) as { is_active: number };
      const lfcRow = db.prepare('SELECT * FROM system_lifecycle_records WHERE entity_id = ?').get(testRoleId);
      const auditRec = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_DELETED_TO_RECYCLE_BIN'").get(testRoleId);
      const auditRestBin = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_RESTORED_FROM_RECYCLE_BIN'").get(testRoleId);
      db.close();

      assert.equal(roleRow.is_active, 1, 'Restored role must have is_active = 1');
      assert.equal(lfcRow, undefined, 'system_lifecycle_records row must be removed');
      assert.ok(auditRec, 'ROLE_DELETED_TO_RECYCLE_BIN audit log must exist');
      assert.ok(auditRestBin, 'ROLE_RESTORED_FROM_RECYCLE_BIN audit log must exist');
      console.log('  [PASS] Role Active -> Recycle -> Restore from Bin + Atomic Audit Verified!');
    }

    // 27. Category Archive -> Restore
    console.log('\n[Check 27] Testing Category: Active -> Archived -> Restored');
    const createCatRes = await apiRequest('/api/categories', 'POST', {
      name: 'QA TEST CATEGORY',
    });
    assert.equal(createCatRes.status, 200);
    const testCatId = createCatRes.data.categoryId;

    const archiveCatRes = await apiRequest('/api/categories', 'PATCH', {
      id: testCatId,
      action: 'ARCHIVE',
    });
    assert.equal(archiveCatRes.status, 200);

    const restoreCatRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'WORK_CATEGORY',
      entityId: testCatId,
    });
    assert.equal(restoreCatRes.status, 200);

    {
      const db = getTestDb();
      const catRow = db.prepare('SELECT is_active FROM work_categories WHERE id = ?').get(testCatId) as { is_active: number };
      const auditArch = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_ARCHIVED'").get(testCatId);
      const auditRest = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_RESTORED'").get(testCatId);
      db.close();

      assert.equal(catRow.is_active, 1, 'Restored category must have is_active = 1');
      assert.ok(auditArch, 'CATEGORY_ARCHIVED audit log must exist');
      assert.ok(auditRest, 'CATEGORY_RESTORED audit log must exist');
      console.log('  [PASS] Category Active -> Archive -> Restore + Atomic Audit Verified!');
    }

    // 28. Category Recycle -> Restore from Bin
    console.log('\n[Check 28] Testing Category: Active -> Recycled -> Restored from Bin');
    const recycleCatRes = await apiRequest('/api/categories', 'PATCH', {
      id: testCatId,
      action: 'RECYCLE',
    });
    assert.equal(recycleCatRes.status, 200);

    const restoreCatFromBinRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'WORK_CATEGORY',
      entityId: testCatId,
    });
    assert.equal(restoreCatFromBinRes.status, 200);

    {
      const db = getTestDb();
      const catRow = db.prepare('SELECT is_active FROM work_categories WHERE id = ?').get(testCatId) as { is_active: number };
      const auditRec = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_DELETED_TO_RECYCLE_BIN'").get(testCatId);
      const auditRestBin = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_RESTORED_FROM_RECYCLE_BIN'").get(testCatId);
      db.close();

      assert.equal(catRow.is_active, 1, 'Restored category must have is_active = 1');
      assert.ok(auditRec, 'CATEGORY_DELETED_TO_RECYCLE_BIN audit log must exist');
      assert.ok(auditRestBin, 'CATEGORY_RESTORED_FROM_RECYCLE_BIN audit log must exist');
      console.log('  [PASS] Category Active -> Recycle -> Restore from Bin + Atomic Audit Verified!');
    }

    // 29 & 30. Site Lifecycle & Canonical Route Check
    console.log('\n[Check 29 & 30] Testing Site Lifecycle: Archive/Recycle/Restore & Canonical Route');
    const createSiteRes = await apiRequest('/api/sites', 'POST', {
      name: 'QA Lifecycle Site',
      code: 'QA-SITE-1',
      location: 'Test Zone',
    });
    assert.equal(createSiteRes.status, 200);
    const testSiteId = createSiteRes.data.siteId;

    // Archive Site
    const archSiteRes = await apiRequest(`/api/sites/${testSiteId}`, 'PATCH', { action: 'ARCHIVE' });
    assert.equal(archSiteRes.status, 200);

    // Verify Canonical Route in system_lifecycle_records
    {
      const db = getTestDb();
      const lfcSite = db.prepare("SELECT * FROM system_lifecycle_records WHERE entity_id = ? AND entity_type = 'SITE'").get(testSiteId) as any;
      db.close();
      console.log(`  Site lifecycle metadata: source_module="${lfcSite?.source_module}", source_route="${lfcSite?.source_route}", restore_destination="${lfcSite?.restore_destination}"`);
      assert.equal(lfcSite?.source_module, 'Sites', 'Canonical source_module must be "Sites"');
      assert.equal(lfcSite?.source_route, '/setup/sites', 'Canonical source_route must be "/setup/sites"');
      assert.equal(lfcSite?.restore_destination, '/setup/sites', 'Canonical restore_destination must be "/setup/sites"');
    }

    // Restore Site
    const restSiteRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'SITE',
      entityId: testSiteId,
    });
    assert.equal(restSiteRes.status, 200);

    // Recycle Site
    const recSiteRes = await apiRequest(`/api/sites/${testSiteId}`, 'PATCH', { action: 'MOVE_TO_BIN' });
    assert.equal(recSiteRes.status, 200);

    // Restore Site from Bin
    const restSiteFromBinRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'SITE',
      entityId: testSiteId,
    });
    assert.equal(restSiteFromBinRes.status, 200);

    {
      const db = getTestDb();
      const siteRow = db.prepare('SELECT is_archived FROM sites WHERE id = ?').get(testSiteId) as { is_archived: number };
      const auditArch = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_ARCHIVED'").get(testSiteId);
      const auditRest = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_RESTORED'").get(testSiteId);
      const auditRec = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_DELETED_TO_RECYCLE_BIN'").get(testSiteId);
      const auditRestBin = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_RESTORED_FROM_RECYCLE_BIN'").get(testSiteId);
      db.close();

      assert.equal(siteRow.is_archived, 0, 'Restored site must have is_archived = 0');
      assert.ok(auditArch, 'SITE_ARCHIVED audit log must exist');
      assert.ok(auditRest, 'SITE_RESTORED audit log must exist');
      assert.ok(auditRec, 'SITE_DELETED_TO_RECYCLE_BIN audit log must exist');
      assert.ok(auditRestBin, 'SITE_RESTORED_FROM_RECYCLE_BIN audit log must exist');
      console.log('  [PASS] Site Archive -> Restore -> Recycle -> Restore from Bin + Atomic Audit Verified!');
    }

    // 33. Category Dependency Blocking Rule & Exact Error Message
    console.log('\n[Check 33] Testing Category Dependency Rule & Exact Error Message');
    const createParentCatRes = await apiRequest('/api/categories', 'POST', { name: 'Parent Category With Child' });
    const parentCatId = createParentCatRes.data.categoryId;
    const createChildRoleRes = await apiRequest('/api/roles', 'POST', {
      categoryId: parentCatId,
      name: 'Child Active Role',
      defaultRateRupees: 500,
    });
    assert.equal(createChildRoleRes.status, 200);

    // Attempt to recycle parent category
    const blockedRecycleRes = await apiRequest('/api/categories', 'PATCH', {
      id: parentCatId,
      action: 'RECYCLE',
    });
    console.log(`  Blocked recycle response status: ${blockedRecycleRes.status} (Expected 409)`);
    assert.equal(blockedRecycleRes.status, 409, 'Category with active roles must return 409 on recycle');
    assert.ok(blockedRecycleRes.data.isBlocked, 'Response must indicate isBlocked = true');
    console.log(`  Blocked recycle error message: "${blockedRecycleRes.data.error}"`);
    const expectedErrorMsg = 'Deletion blocked: this category still has dependent roles. Remove or reassign all dependent roles before moving the category to the Recycle Bin.';
    assert.equal(blockedRecycleRes.data.error, expectedErrorMsg, 'Error message must match exact CTO specification');
    console.log('  [PASS] Category dependency blocking rule and exact wording verified!');

    // 34. Non-Admin RBAC Access Restrictions
    console.log('\n[Check 34] Testing Non-Admin (Site Manager, Viewer) Access Restrictions');
    await setSessionCookie(engToken);
    await navigateAndWait('http://localhost:3001/setup/archive', 'h2');
    const engArchiveRestricted = await cdp.eval(`document.body.innerText.includes('Access Restricted')`);
    assert.ok(engArchiveRestricted, 'Site Manager must be blocked from /setup/archive');

    await navigateAndWait('http://localhost:3001/setup/recycle-bin', 'h2');
    const engRecycleRestricted = await cdp.eval(`document.body.innerText.includes('Access Restricted')`);
    assert.ok(engRecycleRestricted, 'Site Manager must be blocked from /setup/recycle-bin');

    await setSessionCookie(viewerToken);
    await navigateAndWait('http://localhost:3001/setup/archive', 'h2');
    const viewerArchiveRestricted = await cdp.eval(`document.body.innerText.includes('Access Restricted')`);
    assert.ok(viewerArchiveRestricted, 'Viewer must be blocked from /setup/archive');

    const viewerMutationRes = await apiRequest('/api/lifecycle/restore', 'POST', {
      entityType: 'WORK_ROLE',
      entityId: testRoleId,
    }, viewerToken);
    assert.equal(viewerMutationRes.status, 403, 'Viewer mutation must return 403');
    console.log('  [PASS] Non-Admin RBAC enforcement verified!');

    // =========================================================================
    // PART E: COMPLETE RESPONSIVE QA (ALL 6 VIEWPORTS) ON BOTH PAGES
    // =========================================================================
    console.log('\n--- PART E: COMPLETE RESPONSIVE QA (6 VIEWPORTS) ---');
    await setSessionCookie(adminToken);

    // Ensure we have an item in Archive and in Recycle Bin for realistic table/card rendering
    await apiRequest('/api/roles', 'PATCH', { id: testRoleId, action: 'ARCHIVE' });
    await apiRequest('/api/roles', 'PATCH', { id: modalRoleId, action: 'RECYCLE' });

    const targetViewports = [
      { name: 'Mobile Small (390x844)', width: 390, height: 844, isMobile: true },
      { name: 'Mobile Medium (412x915)', width: 412, height: 915, isMobile: true },
      { name: 'Mobile Large (430x932)', width: 430, height: 932, isMobile: true },
      { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, isMobile: false },
      { name: 'Tablet Landscape (1024x768)', width: 1024, height: 768, isMobile: false },
      { name: 'Desktop Small (1280x800)', width: 1280, height: 800, isMobile: false },
    ];

    for (const vp of targetViewports) {
      console.log(`\n  Testing Viewport: ${vp.name}`);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.isMobile ? 2 : 1,
        mobile: vp.isMobile,
      });

      // 1. Archive Page Check
      await navigateAndWait('http://localhost:3001/setup/archive', 'h1');
      const archiveOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      const archiveHasMobileCards = await cdp.eval(`(() => {
        const el = document.querySelector('.md\\\\:hidden');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      })()`);
      const archiveHasDesktopTable = await cdp.eval(`(() => {
        const el = document.querySelector('.hidden.md\\\\:block');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      })()`);

      console.log(`    [Archive] Overflow: ${archiveOverflow}, Mobile Cards Visible: ${archiveHasMobileCards}, Desktop Table Visible: ${archiveHasDesktopTable}`);
      assert.equal(archiveOverflow, false, `Archive must have zero horizontal overflow on ${vp.name}`);
      if (vp.width < 768) {
        assert.ok(archiveHasMobileCards, `Mobile cards must be visible on ${vp.name}`);
        assert.equal(archiveHasDesktopTable, false, `Desktop table must be hidden on ${vp.name}`);
      } else {
        assert.equal(archiveHasMobileCards, false, `Mobile cards must be hidden on ${vp.name}`);
        assert.ok(archiveHasDesktopTable, `Desktop table must be visible on ${vp.name}`);
      }

      // 2. Recycle Bin Page Check
      await navigateAndWait('http://localhost:3001/setup/recycle-bin', 'h1');
      const rbOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      const rbHasMobileCards = await cdp.eval(`(() => {
        const el = document.querySelector('.md\\\\:hidden');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      })()`);
      const rbHasDesktopTable = await cdp.eval(`(() => {
        const el = document.querySelector('.hidden.md\\\\:block');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      })()`);

      console.log(`    [Recycle Bin] Overflow: ${rbOverflow}, Mobile Cards Visible: ${rbHasMobileCards}, Desktop Table Visible: ${rbHasDesktopTable}`);
      assert.equal(rbOverflow, false, `Recycle Bin must have zero horizontal overflow on ${vp.name}`);
      if (vp.width < 768) {
        assert.ok(rbHasMobileCards, `Mobile cards must be visible in Recycle Bin on ${vp.name}`);
        assert.equal(rbHasDesktopTable, false, `Desktop table must be hidden in Recycle Bin on ${vp.name}`);
      } else {
        assert.equal(rbHasMobileCards, false, `Mobile cards must be hidden in Recycle Bin on ${vp.name}`);
        assert.ok(rbHasDesktopTable, `Desktop table must be visible in Recycle Bin on ${vp.name}`);
      }
    }

    // =========================================================================
    // PART F: LIGHT AND DARK THEME VERIFICATION
    // =========================================================================
    console.log('\n--- PART F: LIGHT AND DARK THEME VERIFICATION ---');
    const themeTestConfigs = [
      { name: 'Mobile (390x844)', width: 390, height: 844, isMobile: true },
      { name: 'Desktop (1280x800)', width: 1280, height: 800, isMobile: false },
    ];

    for (const cfg of themeTestConfigs) {
      console.log(`\n  Theme Testing on ${cfg.name}:`);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: cfg.width,
        height: cfg.height,
        deviceScaleFactor: cfg.isMobile ? 2 : 1,
        mobile: cfg.isMobile,
      });

      // Test Archive Page in Light Theme
      await navigateAndWait('http://localhost:3001/setup/archive', 'h1');
      await cdp.eval(`document.documentElement.classList.remove('dark')`);
      await sleep(200);
      const lightArchiveOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      const lightArchiveHeadingColor = await cdp.eval(`window.getComputedStyle(document.querySelector('h1')).color`);
      console.log(`    [Light Theme] Archive Overflow: ${lightArchiveOverflow}, Heading color: ${lightArchiveHeadingColor}`);
      assert.equal(lightArchiveOverflow, false, 'Light theme archive must not overflow');

      // Test Archive Page in Dark Theme
      await cdp.eval(`document.documentElement.classList.add('dark')`);
      await sleep(200);
      const darkArchiveOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      const darkArchiveHeadingColor = await cdp.eval(`window.getComputedStyle(document.querySelector('h1')).color`);
      console.log(`    [Dark Theme] Archive Overflow: ${darkArchiveOverflow}, Heading color: ${darkArchiveHeadingColor}`);
      assert.equal(darkArchiveOverflow, false, 'Dark theme archive must not overflow');
      assert.notEqual(darkArchiveHeadingColor, lightArchiveHeadingColor, 'Heading color must differ between light and dark themes');

      // Test Recycle Bin Page in Light Theme
      await navigateAndWait('http://localhost:3001/setup/recycle-bin', 'h1');
      await cdp.eval(`document.documentElement.classList.remove('dark')`);
      await sleep(200);
      const lightRbOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      const lightRbHeadingColor = await cdp.eval(`window.getComputedStyle(document.querySelector('h1')).color`);
      console.log(`    [Light Theme] Recycle Bin Overflow: ${lightRbOverflow}, Heading color: ${lightRbHeadingColor}`);
      assert.equal(lightRbOverflow, false, 'Light theme recycle bin must not overflow');

      // Test Recycle Bin Page in Dark Theme
      await cdp.eval(`document.documentElement.classList.add('dark')`);
      await sleep(200);
      const darkRbOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      const darkRbHeadingColor = await cdp.eval(`window.getComputedStyle(document.querySelector('h1')).color`);
      console.log(`    [Dark Theme] Recycle Bin Overflow: ${darkRbOverflow}, Heading color: ${darkRbHeadingColor}`);
      assert.equal(darkRbOverflow, false, 'Dark theme recycle bin must not overflow');
      assert.notEqual(darkRbHeadingColor, lightRbHeadingColor, 'Heading color must differ between light and dark themes');
    }

    // Reset viewport
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // =========================================================================
    // FINAL PRODUCTION DB INVARIANT AUDIT
    // =========================================================================
    console.log('\n--- FINAL PRODUCTION DB INVARIANT CHECK ---');
    const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
    const prodAuditPost = prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
    const prodRolesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
    const prodCatsPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
    const prodSitesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
    const prodAttPost = prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
    const prodTxPost = prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
    const prodLfcPost = prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
    const integrityPost = prodDbPost.prepare('PRAGMA integrity_check').get() as any;
    const fkPost = prodDbPost.prepare('PRAGMA foreign_key_check').all().length;
    prodDbPost.close();

    console.log(`[Production DB Post-Check]:`);
    console.log(`  audit_logs: ${prodAuditPost.c} (MUST BE 429)`);
    console.log(`  work_roles: ${prodRolesPost.c} (MUST BE 23)`);
    console.log(`  work_categories: ${prodCatsPost.c} (MUST BE 4)`);
    console.log(`  sites: ${prodSitesPost.c} (MUST BE 6)`);
    console.log(`  attendance_records: ${prodAttPost.c} (MUST BE 18)`);
    console.log(`  financial_transactions: ${prodTxPost.c} (MUST BE 4)`);
    console.log(`  system_lifecycle_records: ${prodLfcPost.c} (MUST BE 0)`);
    console.log(`  integrity: ${integrityPost?.integrity_check}`);
    console.log(`  foreign_keys: ${fkPost} errors`);

    assert.equal(prodAuditPost.c, 429, 'Production audit logs MUST BE UNTOUCHED at 429!');
    assert.equal(prodRolesPost.c, 23, 'Production roles MUST BE UNTOUCHED at 23!');
    assert.equal(prodCatsPost.c, 4, 'Production categories MUST BE UNTOUCHED at 4!');
    assert.equal(prodSitesPost.c, 6, 'Production sites MUST BE UNTOUCHED at 6!');
    assert.equal(prodAttPost.c, 18, 'Production attendance MUST BE UNTOUCHED at 18!');
    assert.equal(prodTxPost.c, 4, 'Production transactions MUST BE UNTOUCHED at 4!');
    assert.equal(prodLfcPost.c, 0, 'Production lifecycle records MUST BE 0!');
    assert.equal(integrityPost?.integrity_check, 'ok', 'Production DB integrity must be ok');
    assert.equal(fkPost, 0, 'Foreign key errors must be 0');

    console.log('\n================================================================');
    console.log('ALL STEP 3A VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
    console.log('Production database data/site_work.db remains 100% pristine.');
    console.log('================================================================\n');

  } finally {
    if (cdp) {
      try {
        cdp.ws.close();
      } catch {}
    }
    if (chromeProc) {
      chromeProc.kill();
    }
    if (fs.existsSync(TEMP_USER_DATA)) {
      try {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
      } catch {}
    }
  }
}

runStep3ALifecycleQA().catch((err) => {
  console.error('\nSTEP 3A QA TEST RUN FAILED:', err);
  process.exit(1);
});
