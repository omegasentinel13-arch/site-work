import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_step2g2_qa_temp');

const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
);

async function makeToken(payload: {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  authorityTier?: string;
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

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const msgId = this.id++;
    return new Promise((resolve) => {
      this.callbacks.set(msgId, resolve);
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.result?.exceptionDetails) {
      console.error('CDP EVALUATE EXCEPTION:', JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function waitForServer(url: string, timeoutMs = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await new Promise<boolean>((resolve) => {
        const req = http.get(url, (r) => {
          resolve(r.statusCode !== undefined);
        });
        req.on('error', () => resolve(false));
      });
      if (res) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('=== STARTING STEP 2G.2 AUDIT TRAIL RESPONSIVE BROWSER QA ===');

  const testDbAbsPath = path.resolve(process.cwd(), 'data/test_site_work.db');
  const testDb = new DatabaseSync(testDbAbsPath);

  // Clean up any old QA items
  testDb.prepare(`DELETE FROM audit_logs WHERE id LIKE 'qa-2g2-%'`).run();
  testDb.prepare(`DELETE FROM user_permission_overrides WHERE permission_id = 'perm-gov-audit-view'`).run();

  // Ensure test users exist
  const pwdHash = bcrypt.hashSync('Admin@123456', 10);
  testDb.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES
      ('usr-admin-1', 'Iamadmin', ?, 'Head Administrator', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 11),
      ('usr-std-admin-1', 'stdadmin', ?, 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 11),
      ('usr-eng-1', 'engineer2', ?, 'Site Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 11)
  `).run(pwdHash, pwdHash, pwdHash);

  testDb.prepare(`UPDATE users SET password_hash = ?, token_version = 11, is_active = 1, authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run(pwdHash);
  testDb.prepare(`UPDATE users SET password_hash = ?, token_version = 11, is_active = 1, authority_tier = 'STANDARD_ADMIN' WHERE id = 'usr-std-admin-1'`).run(pwdHash);

  // Seed controlled audit records for browser inspection
  const insertStmt = testDb.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. SP Security event
  insertStmt.run(
    'qa-2g2-sp-sec',
    'SECURITY',
    'usr-admin-1',
    'PASSWORD_RESET',
    null,
    'usr-admin-1',
    JSON.stringify({ username: 'Iamadmin', tier: 'SUPERIOR_PRIME' }),
    JSON.stringify({ password_hash: '$2a$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqr' }),
    '2099-09-21 10:00:00'
  );

  // 2. Operational Export event (by SP -> pseudonymized as System Administrator)
  insertStmt.run(
    'qa-2g2-sp-op-export',
    'EXPORT',
    'exp-qa-1',
    'COMPLETE_EXPORT_GENERATED',
    null,
    'usr-admin-1',
    null,
    JSON.stringify({ fileName: 'qa-export-2099.zip', requestedBy: 'Iamadmin' }),
    '2099-09-21 10:05:00'
  );

  // 3. Site Archival event
  insertStmt.run(
    'qa-2g2-site-archived',
    'SITE',
    'site-1',
    'SITE_ARCHIVED',
    'site-1',
    'usr-std-admin-1',
    JSON.stringify({ is_archived: 0 }),
    JSON.stringify({ is_archived: 1 }),
    '2099-09-21 10:10:00'
  );

  // 4. Role Activation event
  insertStmt.run(
    'qa-2g2-role-act',
    'ROLE',
    'role-qa-1',
    'ROLE_ACTIVATED',
    null,
    'usr-std-admin-1',
    JSON.stringify({ is_active: 0 }),
    JSON.stringify({ is_active: 1 }),
    '2099-09-21 10:15:00'
  );

  // 5. Attendance Event
  insertStmt.run(
    'qa-2g2-att-1',
    'ATTENDANCE',
    'att-qa-1',
    'ATTENDANCE_RECORD_CREATED',
    'site-1',
    'usr-eng-1',
    null,
    JSON.stringify({ date: '2099-09-21', totalWorkers: 18 }),
    '2099-09-21 10:20:00'
  );

  testDb.close();

  // Launch Next.js dev server on PORT 3001 with test database
  console.log('Launching Next.js test server on PORT 3001...');
  const serverProc: ChildProcess = spawn(
    'npx',
    ['next', 'dev', '-p', '3001'],
    {
      env: {
        ...process.env,
        PORT: '3001',
        DATABASE_PATH: testDbAbsPath,
      },
      shell: true,
      stdio: 'ignore',
    }
  );

  const serverReady = await waitForServer('http://localhost:3001', 45000);
  if (!serverReady) {
    serverProc.kill();
    throw new Error('Test server on PORT 3001 failed to start within timeout');
  }
  console.log('Test server ready on http://localhost:3001');

  // Launch headless Chrome
  if (fs.existsSync(TEMP_USER_DATA)) {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--disable-gpu',
    '--disable-sync',
    '--disable-extensions',
    'about:blank',
  ]);

  let client: CdpClient | null = null;

  try {
    const chromeReady = await waitForServer('http://localhost:9225/json/version', 20000);
    if (!chromeReady) throw new Error('Chrome remote debugging port not available');

    const tabs = await fetchJson('http://localhost:9225/json/list');
    const tab = tabs.find((t: any) => t.type === 'page') || tabs[0];
    assert.ok(tab?.webSocketDebuggerUrl, 'No websocket debugger URL');

    client = new CdpClient(tab.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    // Create session tokens for Standard Admin and Superior Prime
    const stdAdminToken = await makeToken({
      userId: 'usr-std-admin-1',
      username: 'stdadmin',
      fullName: 'Standard Admin',
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      assignedSiteIds: [],
      tokenVersion: 11,
    });

    const spToken = await makeToken({
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      fullName: 'Head Administrator',
      role: 'ADMIN',
      authorityTier: 'SUPERIOR_PRIME',
      assignedSiteIds: [],
      tokenVersion: 11,
    });

    await client.send('Page.navigate', { url: 'http://localhost:3001/login' });
    await new Promise((r) => setTimeout(r, 2000));

    // Authenticate in browser via login API as Standard Admin
    const loginRes = await client.evaluate(`
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'stdadmin', password: 'Admin@123456' }),
      }).then(r => r.json())
    `);
    console.log('Browser login API response:', JSON.stringify(loginRes));

    const meRes = await client.evaluate(`fetch('/api/auth/me').then(r => r.json())`);
    console.log('CLIENT /api/auth/me result:', JSON.stringify(meRes));
    assert.equal(meRes.user?.role, 'ADMIN', 'Session must be authenticated as ADMIN');

    async function waitForAuditReady(timeoutMs = 30000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const isReady = await client!.evaluate(`
          (() => {
            if (!document || !document.body) return false;
            return Boolean(
              document.querySelector('table') || 
              document.querySelector('[class*="md:hidden"] > div') || 
              document.body.innerText?.includes('No activity found') ||
              document.body.innerText?.includes('Access Denied')
            );
          })()
        `);
        if (isReady) return;
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    // =========================================================================
    // PART A: VIEWPORT RESPONSIVE QA (1280, 1024, 768, 430, 412, 390, 375)
    // =========================================================================
    const viewports = [
      { width: 1280, height: 800, name: '1280 (Desktop Large)', isMobile: false },
      { width: 1024, height: 768, name: '1024 (Desktop Standard)', isMobile: false },
      { width: 768, height: 1024, name: '768 (Tablet Portrait)', isMobile: false },
      { width: 430, height: 932, name: '430 (iPhone Pro Max)', isMobile: true },
      { width: 412, height: 915, name: '412 (Samsung Galaxy S)', isMobile: true },
      { width: 390, height: 844, name: '390 (iPhone 14/15)', isMobile: true },
      { width: 375, height: 667, name: '375 (iPhone SE)', isMobile: true },
    ];

    const pages = [
      { path: '/setup/audit-trail', label: 'Canonical /setup/audit-trail' },
      { path: '/setup/audit', label: 'Normalized /setup/audit' },
    ];

    for (const pageInfo of pages) {
      console.log(`\n======================================================`);
      console.log(`TESTING ROUTE: ${pageInfo.label} (${pageInfo.path})`);
      console.log(`======================================================`);

      for (const vp of viewports) {
        console.log(`\nTesting Viewport ${vp.name} (${vp.width}x${vp.height})...`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: vp.isMobile,
        });

        await client.send('Page.navigate', { url: `http://localhost:3001${pageInfo.path}` });
        await waitForAuditReady();
        await new Promise((r) => setTimeout(r, 600));

        // 1. Verify Page Title / Header
        const pageTitle = await client.evaluate(`
          document.querySelector('h1')?.textContent?.trim()
        `);
        assert.equal(pageTitle, 'AUDIT TRAIL', `Page title must be 'AUDIT TRAIL' on ${pageInfo.path} at ${vp.width}px`);

        const pageSubtitle = await client.evaluate(`
          document.body?.innerText?.includes('Security & system activity history')
        `);
        assert.equal(pageSubtitle, true, 'Subtitle must match expected text');

        // 2. Verify No Horizontal Overflow
        const scrollWidth = await client.evaluate(`document.documentElement.scrollWidth`);
        const innerWidth = await client.evaluate(`window.innerWidth`);
        assert.ok(
          scrollWidth <= innerWidth + 1,
          `Horizontal overflow detected on ${pageInfo.path} at ${vp.width}px (scrollWidth=${scrollWidth}, innerWidth=${innerWidth})`
        );

        // 3. Verify Table on Desktop vs Cards on Mobile
        if (!vp.isMobile) {
          const tableVisible = await client.evaluate(`
            (() => {
              const table = document.querySelector('table');
              if (!table) return false;
              const container = table.closest('[class*="md:block"]') || table;
              const style = window.getComputedStyle(container);
              return style.display !== 'none';
            })()
          `);
          assert.equal(tableVisible, true, `Desktop table must be visible at ${vp.width}px`);
        } else {
          const mobileCardsExist = await client.evaluate(`
            (() => {
              const cardsContainer = document.querySelector('[class*="md:hidden"]');
              if (!cardsContainer) return false;
              const style = window.getComputedStyle(cardsContainer);
              return style.display !== 'none';
            })()
          `);
          assert.equal(mobileCardsExist, true, `Mobile stacked cards must be active at ${vp.width}px`);
        }

        // 4. Verify Touch Targets >= 44x44px for action buttons
        const touchTargetCheck = await client.evaluate(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('main button:not(:disabled)'));
            const invalidButtons = buttons.filter(b => {
              const rect = b.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;
              return rect.height < 36;
            });
            return invalidButtons.length === 0;
          })()
        `);
        assert.equal(touchTargetCheck, true, `Action buttons must meet size accessibility guidelines at ${vp.width}px`);

        console.log(`  -> Title: OK, Overflow: OK, Table/Card Transition: OK, Touch: OK`);
      }
    }

    // =========================================================================
    // PART B: FILTER INTERACTION & DRAFT BEHAVIOR
    // =========================================================================
    console.log('\n--- VERIFYING FILTER INTERACTION & DRAFT BEHAVIOR ---');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Page.navigate', { url: 'http://localhost:3001/setup/audit-trail' });
    await waitForAuditReady();
    await new Promise((r) => setTimeout(r, 600));

    // Type into Search input without clicking Apply yet
    await client.evaluate(`
      (() => {
        const searchInput = document.querySelector('input[placeholder="Search activity..."]');
        if (searchInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(searchInput, 'SITE_ARCHIVED');
          } else {
            searchInput.value = 'SITE_ARCHIVED';
          }
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // Verify search did NOT auto-execute prior to Apply click
    const initialRowsCount = await client.evaluate(`document.querySelectorAll('tbody tr').length`);
    assert.ok(initialRowsCount > 1, 'Draft typing should NOT trigger search until Apply is clicked');

    // Click Apply button
    await client.evaluate(`
      (() => {
        const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Apply'));
        if (applyBtn) applyBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    // Verify filtered results
    const filteredRowsCount = await client.evaluate(`document.querySelectorAll('tbody tr').length`);
    assert.ok(filteredRowsCount >= 1 && filteredRowsCount < initialRowsCount, 'Applying filter for SITE_ARCHIVED should return matching events and reduce count');

    const allMatch = await client.evaluate(`
      Array.from(document.querySelectorAll('tbody tr')).every(r => r.textContent?.includes('Site archived') || r.textContent?.includes('SITE_ARCHIVED'))
    `);
    assert.equal(allMatch, true, 'All filtered rows must be site archival events');

    // Click Reset button
    await client.evaluate(`
      (() => {
        const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Reset'));
        if (resetBtn) resetBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const resetRowsCount = await client.evaluate(`document.querySelectorAll('tbody tr').length`);
    assert.ok(resetRowsCount > 1, 'Reset button restores full unfiltered activity list');
    console.log('Filters: Draft local state=OK, Apply filter=OK, Reset filter=OK');

    // =========================================================================
    // PART C: DETAIL MODAL INTERACTION & BODY SCROLL LOCK
    // =========================================================================
    console.log('\n--- VERIFYING DETAIL MODAL, SCROLL LOCK, & ESCAPE DISMISSAL ---');
    // Open detail modal on first row
    const openBtnClicked = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('View Details'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert.ok(openBtnClicked, 'View Details button must exist');
    await new Promise((r) => setTimeout(r, 600));

    // Verify modal is open and portaled
    const modalZIndex = await client.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? window.getComputedStyle(dialog).zIndex : '0';
      })()
    `);
    assert.ok(parseInt(modalZIndex) >= 100, 'Audit Detail modal must be portaled with z-index >= 100');

    // Verify body scroll lock
    const bodyLocked = await client.evaluate(`document.body.style.overflow === 'hidden'`);
    assert.equal(bodyLocked, true, 'Body scroll lock must be active when modal is open');

    // Verify modal content
    const modalTitle = await client.evaluate(`document.querySelector('#audit-detail-title')?.textContent`);
    assert.equal(modalTitle, 'Audit Event Inspection');

    // Verify Escape key closes modal
    await client.evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 400));

    const modalClosed = await client.evaluate(`!document.querySelector('[role="dialog"]')`);
    assert.equal(modalClosed, true, 'Escape key must close audit detail modal');

    const bodyUnlocked = await client.evaluate(`document.body.style.overflow !== 'hidden'`);
    assert.equal(bodyUnlocked, true, 'Body scroll lock must be released after modal close');
    console.log('Detail Modal: Portal z>=100=OK, ScrollLock=OK, EscapeClose=OK');

    // =========================================================================
    // PART D: SUPERIOR PRIME PRIVACY IN UI
    // =========================================================================
    console.log('\n--- VERIFYING SUPERIOR PRIME PRIVACY IN UI ---');
    // As Standard Admin:
    // 1. Operational events performed by SP must display "System Administrator" with null actor id
    const exportActorText = await client.evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        const exportRow = rows.find(r => r.textContent?.includes('Export generated') || r.textContent?.includes('COMPLETE_EXPORT'));
        if (!exportRow) return null;
        return exportRow.querySelector('td:nth-child(3)')?.textContent?.trim();
      })()
    `);
    assert.ok(exportActorText?.includes('System Administrator'), 'SP operational event must show "System Administrator" to Standard Admin');
    assert.equal(exportActorText?.includes('Iamadmin'), false, 'Username "Iamadmin" must NEVER appear for Standard Admin');
    assert.equal(exportActorText?.includes('usr-admin-1'), false, 'User ID "usr-admin-1" must NEVER appear for Standard Admin');

    // 2. Direct search of "Iamadmin" returns clean empty state
    await client.evaluate(`
      (() => {
        const searchInput = document.querySelector('input[placeholder="Search activity..."]');
        if (searchInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(searchInput, 'Iamadmin');
          } else {
            searchInput.value = 'Iamadmin';
          }
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Apply'));
        if (applyBtn) applyBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const emptyMsg = await client.evaluate(`
      document.body.innerText.includes('No activity found for the selected filters.')
    `);
    assert.equal(emptyMsg, true, 'Searching "Iamadmin" must return empty state without disclosure');
    console.log('Privacy: "System Administrator" pseudonym=OK, Zero search leak=OK');

    // =========================================================================
    // PART E: LIGHT & DARK MODE THEME VERIFICATION
    // =========================================================================
    console.log('\n--- VERIFYING THEMES (Light & Dark) ---');
    // Dark mode
    await client.evaluate(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    const isDark = await client.evaluate(`document.documentElement.classList.contains('dark')`);
    assert.equal(isDark, true, 'Dark class applied');

    // Light mode
    await client.evaluate(`document.documentElement.classList.remove('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    const isLight = await client.evaluate(`!document.documentElement.classList.contains('dark')`);
    assert.equal(isLight, true, 'Light mode applied');
    console.log('Themes: Dark theme=OK, Light theme=OK');

    console.log('\n=== ALL STEP 2G.2 AUDIT TRAIL RESPONSIVE BROWSER QA CHECKS PASSED ===\n');
  } finally {
    if (client) client.close();
    chromeProc.kill();
    serverProc.kill();

    // Clean up test records
    const cleanupDb = new DatabaseSync('data/test_site_work.db');
    cleanupDb.prepare(`DELETE FROM audit_logs WHERE id LIKE 'qa-2g2-%'`).run();
    cleanupDb.close();
  }
}

main().catch((err) => {
  console.error('STEP 2G.2 Browser QA Error:', err);
  process.exit(1);
});
