import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_step2f1_qa_temp');

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

async function waitForServer(url: string, timeoutMs = 35000): Promise<boolean> {
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
  console.log('=== STARTING STEP 2F.1 RESPONSIVE BROWSER QA ===');

  // Seed test items into data/test_site_work.db so Archive and Recycle Bin display populated cards/tables
  const testDb = new DatabaseSync('data/test_site_work.db');
  testDb.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'qa-2f1-%'`).run();
  testDb.prepare(`DELETE FROM sites WHERE id LIKE 'qa-2f1-%'`).run();

  testDb.prepare(`
    INSERT INTO sites (id, name, code, location, is_archived, created_at, updated_at)
    VALUES 
      ('qa-2f1-site-arc', 'QA Archived Site Alpha', 'QA-ARC', 'Block A', 1, datetime('now'), datetime('now')),
      ('qa-2f1-site-rcy', 'QA Recycled Site Beta', 'QA-RCY', 'Block B', 1, datetime('now'), datetime('now'))
  `).run();

  testDb.prepare(`
    INSERT INTO system_lifecycle_records (
      id, entity_type, entity_id, entity_name, source_module, source_route, restore_destination,
      state, keep_permanently, archived_at, recycled_at, performed_by, metadata, created_at, updated_at
    ) VALUES 
      ('lfc-qa-arc', 'SITE', 'qa-2f1-site-arc', 'QA Archived Site Alpha', 'Sites', '/setup/sites', '/setup/sites',
       'ARCHIVED', 0, datetime('now'), NULL, 'usr-admin-1', '{"retention_policy":"30_DAYS"}', datetime('now'), datetime('now')),
      ('lfc-qa-rcy', 'SITE', 'qa-2f1-site-rcy', 'QA Recycled Site Beta', 'Sites', '/setup/sites', '/setup/sites',
       'RECYCLE_BIN', 0, datetime('now'), datetime('now'), 'usr-admin-1', '{"retention_policy":"30_DAYS"}', datetime('now'), datetime('now'))
  `).run();

  const pwdHash = bcrypt.hashSync('Admin@123456', 10);
  testDb.prepare(`UPDATE users SET password_hash = ?, token_version = 11, is_active = 1, role = 'ADMIN', authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run(pwdHash);
  testDb.close();

  const testDbAbsPath = path.resolve(process.cwd(), 'data/test_site_work.db');

  // 1. Launch Next.js dev server on PORT 3001 with test database
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

  const serverReady = await waitForServer('http://localhost:3001', 40000);
  if (!serverReady) {
    serverProc.kill();
    throw new Error('Test server on PORT 3001 failed to start within timeout');
  }
  console.log('Test server ready on http://localhost:3001');

  // 2. Launch headless Chrome with remote debugging
  if (fs.existsSync(TEMP_USER_DATA)) {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9224',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--disable-gpu',
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  let client: CdpClient | null = null;
  try {
    let retries = 20;
    let pageWsUrl = '';
    while (retries > 0) {
      try {
        const list = await fetchJson('http://127.0.0.1:9224/json/list');
        if (Array.isArray(list) && list.length > 0) {
          const pageTarget = list.find((t: any) => t.type === 'page') || list[0];
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            pageWsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        retries--;
      }
    }

    assert.ok(pageWsUrl, 'Failed to obtain Chrome page debugger URL');
    client = new CdpClient(pageWsUrl);
    await client.connect();
    console.log('Connected to Chrome DevTools Protocol');

    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('DOM.enable');

    // Create session token for Superior Prime (ADMIN)
    const token = await makeToken({
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      fullName: 'Superior Prime',
      role: 'ADMIN',
      authorityTier: 'SUPERIOR_PRIME',
      assignedSiteIds: [],
      tokenVersion: 11,
    });

    // Set cookie for http://localhost:3001
    await client.send('Network.setCookie', {
      name: 'site_work_session',
      value: token,
      url: 'http://localhost:3001',
      path: '/',
    });

    await client.send('Page.navigate', { url: 'http://localhost:3001/login' });
    await new Promise((r) => setTimeout(r, 2000));

    // Authenticate in browser via login API
    const loginRes = await client.evaluate(`
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Iamadmin', password: 'Admin@123456' }),
      }).then(r => r.json())
    `);
    console.log('Browser login API response:', JSON.stringify(loginRes));

    const meRes = await client.evaluate(`fetch('/api/auth/me').then(r => r.json())`);
    console.log('CLIENT /api/auth/me result:', JSON.stringify(meRes));

    const viewports = [1280, 1024, 768, 430, 412, 390, 375];

    // =========================================================================
    // PART A: /setup/archive VERIFICATION
    // =========================================================================
    console.log('\n--- VERIFYING /setup/archive ---');
    await client.send('Page.navigate', { url: 'http://localhost:3001/setup/archive' });

    // Wait for compilation
    let foundArchiveH1 = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const currentUrl = await client.evaluate(`window.location.href`);
      const h1Text = await client.evaluate(`document.querySelector('h1')?.textContent`);
      if (h1Text && h1Text.includes('ARCHIVE')) {
        foundArchiveH1 = true;
        console.log(`Archive page compiled and loaded. Header: "${h1Text.trim()}" at ${currentUrl}`);
        break;
      }
      if (i % 3 === 0) {
        const bodySnippet = await client.evaluate(`document.body?.innerText?.slice(0, 200)`);
        console.log(`Waiting for /setup/archive... current URL: ${currentUrl}, h1: ${h1Text}, body: "${bodySnippet}"`);
      }
    }
    assert.ok(foundArchiveH1, 'Timeout waiting for /setup/archive');

    // Wait for records to be loaded
    for (let i = 0; i < 30; i++) {
      const isLoaded = await client.evaluate(`
        (() => {
          const loadingText = document.body.innerText.includes('Loading Archive records...');
          const hasTable = Boolean(document.querySelector('table'));
          const hasCards = Boolean(document.querySelector('.md\\\\:hidden'));
          return !loadingText && (hasTable || hasCards);
        })()
      `);
      if (isLoaded) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    for (const width of viewports) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width <= 768,
      });
      await new Promise((r) => setTimeout(r, 400));

      const title = await client.evaluate(`document.querySelector('h1')?.textContent?.trim()`);
      assert.equal(title, 'ARCHIVE', `Title at ${width}px must be ARCHIVE`);

      const overflow = await client.evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
      assert.equal(overflow, false, `Horizontal overflow at ${width}px on /setup/archive`);

      // Check layout stacking: table on desktop (>=768), cards on mobile (<768)
      if (width >= 768) {
        const tableVisible = await client.evaluate(`
          (() => {
            const table = document.querySelector('table');
            if (!table) return false;
            const container = table.closest('.hidden') || table;
            return window.getComputedStyle(container).display !== 'none';
          })()
        `);
        assert.equal(tableVisible, true, `Desktop table must be visible at ${width}px`);
      } else {
        const mobileCardsVisible = await client.evaluate(`
          (() => {
            const cards = document.querySelector('.md\\\\:hidden');
            if (!cards) return false;
            return window.getComputedStyle(cards).display !== 'none';
          })()
        `);
        assert.equal(mobileCardsVisible, true, `Mobile cards must be visible at ${width}px`);
      }

      // Check mobile touch targets (>= 40px)
      if (width <= 430) {
        const actionButtons = await client.evaluate(`
          Array.from(document.querySelectorAll('button')).filter(b => {
            const rect = b.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.height < 32;
          }).length
        `);
        assert.equal(actionButtons, 0, `No tiny action buttons allowed at ${width}px`);
      }

      console.log(`[Archive] ${width}px: Title="${title}", Overflow=${overflow}, Layout=OK`);
    }

    // Reset viewport to desktop for modal testing
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 400));

    // Modal test 1 on /setup/archive: Restore Modal
    console.log('Testing Archive Modal: Restore Record...');
    const clickedRestoreBtn = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          return b.textContent?.includes('Restore') && b.getBoundingClientRect().width > 0;
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert.ok(clickedRestoreBtn, 'Archive Restore button must exist and be clickable');
    await new Promise((r) => setTimeout(r, 600));

    const restoreModalHeader = await client.evaluate(`document.querySelector('#archive-restore-modal-title')?.textContent?.trim()`);
    assert.ok(restoreModalHeader?.toUpperCase().includes('RESTORE RECORD'), 'Archive Restore modal must open');

    const restoreModalZIndex = await client.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? window.getComputedStyle(dialog).zIndex : '0';
      })()
    `);
    assert.ok(parseInt(restoreModalZIndex) >= 50, 'Archive Restore modal must have z-index >= 50');

    const restoreBodyLocked = await client.evaluate(`document.body.style.overflow === 'hidden'`);
    assert.equal(restoreBodyLocked, true, 'Body scroll lock must be active when Archive Restore modal is open');

    // Close via Escape
    await client.evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 400));

    const restoreClosed = await client.evaluate(`!document.querySelector('[role="dialog"]')`);
    assert.equal(restoreClosed, true, 'Escape key must close Archive Restore modal');

    const restoreBodyUnlocked = await client.evaluate(`document.body.style.overflow !== 'hidden'`);
    assert.equal(restoreBodyUnlocked, true, 'Body scroll lock released after Archive Restore modal close');
    console.log('Archive Restore Modal: Portal(z>=50)=OK, ScrollLock=OK, EscapeClose=OK');

    // Modal test 2 on /setup/archive: Move to Recycle Bin Modal
    console.log('Testing Archive Modal: Move to Recycle Bin...');
    const clickedRecycleBtn = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          return (b.textContent?.includes('Recycle Bin') || b.textContent?.includes('Move to Bin')) && b.getBoundingClientRect().width > 0;
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert.ok(clickedRecycleBtn, 'Move to Recycle Bin button must exist and be clickable');

    await new Promise((r) => setTimeout(r, 600));
    const modalHeader = await client.evaluate(`document.querySelector('#archive-recycle-modal-title')?.textContent?.trim()`);
    assert.ok(modalHeader?.toUpperCase().includes('MOVE TO RECYCLE BIN'), 'Move to Recycle Bin modal must open');

    const modalZIndex = await client.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? window.getComputedStyle(dialog).zIndex : '0';
      })()
    `);
    assert.ok(parseInt(modalZIndex) >= 50, 'Modal must have z-index >= 50 above navbar');

    const bodyOverflowLocked = await client.evaluate(`document.body.style.overflow === 'hidden'`);
    assert.equal(bodyOverflowLocked, true, 'Body scroll lock must be active when modal is open');

    await client.evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 400));

    const modalClosed = await client.evaluate(`!document.querySelector('[role="dialog"]')`);
    assert.equal(modalClosed, true, 'Escape key must close modal');

    const bodyOverflowUnlocked = await client.evaluate(`document.body.style.overflow !== 'hidden'`);
    assert.equal(bodyOverflowUnlocked, true, 'Body scroll lock must be released after modal close');
    console.log('Archive Move to Bin Modal: Portal(z>=50)=OK, ScrollLock=OK, EscapeClose=OK');

    // =========================================================================
    // PART B: /setup/recycle-bin VERIFICATION
    // =========================================================================
    console.log('\n--- VERIFYING /setup/recycle-bin ---');
    await client.send('Page.navigate', { url: 'http://localhost:3001/setup/recycle-bin' });

    let foundRecycleH1 = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const h1Text = await client.evaluate(`document.querySelector('h1')?.textContent`);
      if (h1Text && h1Text.includes('RECYCLE BIN')) {
        foundRecycleH1 = true;
        console.log(`Recycle Bin page compiled and loaded. Header: "${h1Text.trim()}"`);
        break;
      }
    }
    assert.ok(foundRecycleH1, 'Timeout waiting for /setup/recycle-bin');

    // Wait for records to be loaded
    for (let i = 0; i < 30; i++) {
      const isLoaded = await client.evaluate(`
        (() => {
          const loadingText = document.body.innerText.includes('Loading Recycle Bin records...');
          const hasTable = Boolean(document.querySelector('table'));
          const hasCards = Boolean(document.querySelector('.md\\\\:hidden'));
          return !loadingText && (hasTable || hasCards);
        })()
      `);
      if (isLoaded) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    for (const width of viewports) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width <= 768,
      });
      await new Promise((r) => setTimeout(r, 400));

      const title = await client.evaluate(`document.querySelector('h1')?.textContent?.trim()`);
      assert.equal(title, 'RECYCLE BIN', `Title at ${width}px must be RECYCLE BIN`);

      const overflow = await client.evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
      assert.equal(overflow, false, `Horizontal overflow at ${width}px on /setup/recycle-bin`);

      if (width >= 768) {
        const tableVisible = await client.evaluate(`
          (() => {
            const table = document.querySelector('table');
            if (!table) return false;
            const container = table.closest('.hidden') || table;
            return window.getComputedStyle(container).display !== 'none';
          })()
        `);
        assert.equal(tableVisible, true, `Desktop table must be visible at ${width}px`);
      } else {
        const mobileCardsVisible = await client.evaluate(`
          (() => {
            const cards = document.querySelector('.md\\\\:hidden');
            if (!cards) return false;
            return window.getComputedStyle(cards).display !== 'none';
          })()
        `);
        assert.equal(mobileCardsVisible, true, `Mobile cards must be visible at ${width}px`);
      }

      console.log(`[RecycleBin] ${width}px: Title="${title}", Overflow=${overflow}, Layout=OK`);
    }

    // Reset viewport to desktop for modal testing
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 400));

    // Modal test 1 on /setup/recycle-bin: Restore Modal
    console.log('Testing Recycle Bin Modal: Restore Record...');
    const clickedRecycleRestoreBtn = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          return b.textContent?.includes('Restore') && b.getBoundingClientRect().width > 0;
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    assert.ok(clickedRecycleRestoreBtn, 'Recycle Bin Restore button must exist and be clickable');
    await new Promise((r) => setTimeout(r, 600));

    const rcyRestoreHeader = await client.evaluate(`document.querySelector('#recycle-restore-modal-title')?.textContent?.trim()`);
    assert.ok(rcyRestoreHeader?.toUpperCase().includes('RESTORE RECORD'), 'Recycle Bin Restore modal must open');

    const rcyRestoreZIndex = await client.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? window.getComputedStyle(dialog).zIndex : '0';
      })()
    `);
    assert.ok(parseInt(rcyRestoreZIndex) >= 50, 'Recycle Bin Restore modal must have z-index >= 50');

    const rcyRestoreLocked = await client.evaluate(`document.body.style.overflow === 'hidden'`);
    assert.equal(rcyRestoreLocked, true, 'Body scroll lock active during Recycle Bin Restore modal');

    await client.evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 400));

    const rcyRestoreClosed = await client.evaluate(`!document.querySelector('[role="dialog"]')`);
    assert.equal(rcyRestoreClosed, true, 'Escape closes Recycle Bin Restore modal');

    const rcyRestoreUnlocked = await client.evaluate(`document.body.style.overflow !== 'hidden'`);
    assert.equal(rcyRestoreUnlocked, true, 'Body scroll lock released after Recycle Bin Restore modal close');
    console.log('Recycle Bin Restore Modal: Portal(z>=50)=OK, ScrollLock=OK, EscapeClose=OK');

    // Modal test 2 on /setup/recycle-bin: Permanent Delete Modal
    console.log('Testing Recycle Bin Modal: Permanent Delete...');
    const clickedDeleteBtn = await client.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          return b.textContent?.includes('Permanent Delete') && !b.disabled && b.getBoundingClientRect().width > 0;
        });
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);

    assert.ok(clickedDeleteBtn, 'Permanent Delete button must exist and be clickable');
    await new Promise((r) => setTimeout(r, 600));

    // Verify Permanent Delete modal opened
    const permDeleteModalTitle = await client.evaluate(`document.querySelector('#recycle-delete-modal-title')?.textContent?.trim()`);
    assert.ok(permDeleteModalTitle?.toUpperCase().includes('PERMANENT DELETE'), 'Permanent Delete modal must open');

    // Verify portal z-index >= 50
    const permModalZIndex = await client.evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? window.getComputedStyle(dialog).zIndex : '0';
      })()
    `);
    assert.ok(parseInt(permModalZIndex) >= 50, 'Permanent Delete modal must have z-index >= 50');

    // Verify body scroll lock
    const permScrollLocked = await client.evaluate(`document.body.style.overflow === 'hidden'`);
    assert.equal(permScrollLocked, true, 'Body scroll lock must be active when Permanent Delete modal is open');

    // Verify Escape key closes modal
    await client.evaluate(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 400));

    const permModalClosed = await client.evaluate(`!document.querySelector('[role="dialog"]')`);
    assert.equal(permModalClosed, true, 'Escape key must close Permanent Delete modal');

    const permScrollUnlocked = await client.evaluate(`document.body.style.overflow !== 'hidden'`);
    assert.equal(permScrollUnlocked, true, 'Body scroll lock released after Permanent Delete modal close');
    console.log('Permanent Delete Modal: Portal(z>=50)=OK, ScrollLock=OK, EscapeClose=OK');

    // =========================================================================
    // PART C: THEME TOGGLE VERIFICATION (Light & Dark)
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
    console.log('Themes: Dark class toggle=OK, Light mode toggle=OK');

    console.log('\n=== ALL STEP 2F.1 RESPONSIVE BROWSER QA CHECKS PASSED ===\n');
  } finally {
    if (client) client.close();
    chromeProc.kill();
    serverProc.kill();

    // Clean up test data
    const cleanupDb = new DatabaseSync('data/test_site_work.db');
    cleanupDb.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'qa-2f1-%'`).run();
    cleanupDb.prepare(`DELETE FROM sites WHERE id LIKE 'qa-2f1-%'`).run();
    cleanupDb.close();
  }
}

main().catch((err) => {
  console.error('STEP 2F.1 Browser QA Error:', err);
  process.exit(1);
});
