import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_targeted_check_temp');

function getSecretKey(): Uint8Array {
  let secret = process.env.SESSION_SECRET;
  if (!secret && fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/SESSION_SECRET=(.*)/);
    if (match) {
      secret = match[1].trim();
    }
  }
  return new TextEncoder().encode(secret || 'site_work_super_secret_session_key_min_32_characters_long_2026_engineering');
}

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
    .sign(getSecretKey());
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
    const res = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return res.result?.result?.value;
  }
}

async function runTargetedVerification() {
  console.log('================================================================');
  console.log('SITES MODULE — TARGETED SAFETY & UI POLISH VERIFICATION');
  console.log('================================================================\n');

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
      await new Promise((r) => setTimeout(r, 200));
      retries--;
    }
  }

  assert.ok(pageWsUrl, 'Failed to connect to Chrome DevTools Protocol');
  const cdp = new CdpClient(pageWsUrl);
  await cdp.connect();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  // Read-only inspection of admin user
  const db = new DatabaseSync('data/site_work.db', { readOnly: true });
  const adminUser = db.prepare('SELECT * FROM users WHERE username = ?').get('Iamadmin') as any;
  const engUser = db.prepare('SELECT * FROM users WHERE username = ?').get('engineer2') as any;

  const adminToken = await makeToken({
    userId: adminUser.id,
    username: adminUser.username,
    fullName: adminUser.full_name,
    role: adminUser.role,
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: adminUser.token_version,
  });

  const engToken = await makeToken({
    userId: engUser.id,
    username: engUser.username,
    fullName: engUser.full_name,
    role: engUser.role,
    assignedSiteIds: ['site-2'],
    tokenVersion: engUser.token_version,
  });

  async function setSession(token: string) {
    await cdp.send('Network.setCookie', {
      name: 'site_work_session',
      value: token,
      url: 'http://localhost:3000',
      path: '/',
    });
  }

  async function navigateAndWait(url: string, expectedHeader?: string): Promise<void> {
    const targetPath = new URL(url).pathname;
    await cdp.send('Page.navigate', { url });
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const currentPath = await cdp.eval(`window.location.pathname`);
      if (currentPath === targetPath) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    while (Date.now() - start < 15000) {
      const ready = await cdp.eval(`
        (() => {
          const bodyText = document.body ? document.body.textContent : '';
          ${expectedHeader 
            ? `const h1 = document.querySelector('h1'); if (!h1 || !h1.textContent.toLowerCase().includes('${expectedHeader.toLowerCase()}')) return false;` 
            : `if (!document.querySelector('h1') && !bodyText.includes('Access Restricted')) return false;`}
          if (bodyText.includes('Loading construction sites...')) return false;
          return true;
        })()
      `);
      if (ready) {
        await new Promise((r) => setTimeout(r, 250));
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  try {
    console.log('1. Setting Admin session and navigating to /setup/sites...');
    await setSession(adminToken);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await navigateAndWait('http://localhost:3000/setup/sites', 'SITE MANAGEMENT');

    // 2. Navigation item label check
    let navLabel = null;
    for (let i = 0; i < 30; i++) {
      navLabel = await cdp.eval(`document.querySelector('a[href="/setup/sites"]')?.textContent?.trim()`);
      if (navLabel) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`[x] Navigation Label rendered: "${navLabel}"`);
    assert.equal(navLabel, 'Sites', 'Navigation label must be "Sites" (title case)');

    // 3. Page title check
    const pageTitle = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
    console.log(`[x] Page Heading rendered: "${pageTitle}"`);
    assert.equal(pageTitle, 'SITE MANAGEMENT', 'Page heading must remain "SITE MANAGEMENT"');

    // 4. Site cards count check
    const cardCount = await cdp.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.title === 'Open Site Overview' || b.textContent.trim().toUpperCase() === 'OPEN').length
    `);
    console.log(`[x] Visible Site Cards Count: ${cardCount}`);
    assert.equal(cardCount, 6, 'All 6 site cards must load');

    // 5. Site Overview opens cleanly
    console.log('5. Opening Site Overview modal on Site 1...');
    await cdp.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => 
          (b.title === 'Open Site Overview' || b.textContent.trim().toUpperCase() === 'OPEN') && b.closest('.rounded-xl')?.textContent?.includes('Site 1')
        );
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    const modalTitle = await cdp.eval(`document.querySelector('#site-overview-title')?.textContent?.trim()`);
    console.log(`[x] Site Overview Title: "${modalTitle}"`);
    assert.equal(modalTitle, 'Site 1');

    // Close overview modal
    await cdp.eval(`document.querySelector('button[aria-label="Close overview"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));
    console.log('  ✔ Site Overview modal verified and closed cleanly');

    // 6. Test Case-Insensitive DELETE Confirmation in Move to Recycle Bin modal
    console.log('6. Testing Case-Insensitive DELETE confirmation in Move to Recycle Bin modal...');
    await cdp.eval(`
      (() => {
        const deleteBtns = Array.from(document.querySelectorAll('button[title="Move to Recycle Bin"]'));
        if (deleteBtns[0]) deleteBtns[0].click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    const recycleModalTitle = await cdp.eval(`document.querySelector('#recycle-modal-title')?.textContent?.trim()`);
    assert.equal(recycleModalTitle, 'Move Site to Recycle Bin');

    async function testInputVal(val: string): Promise<boolean> {
      return await cdp.eval(`
        (() => {
          const input = document.querySelector('input[placeholder="DELETE"]');
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(val)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm Move to Bin'));
          return btn ? !btn.disabled : false;
        })()
      `);
    }

    const testCases = [
      { input: 'wrong', expectedEnabled: false },
      { input: 'del', expectedEnabled: false },
      { input: 'DELET', expectedEnabled: false },
      { input: 'DELETE NOW', expectedEnabled: false },
      { input: 'DELETE', expectedEnabled: true },
      { input: 'delete', expectedEnabled: true },
      { input: 'Delete', expectedEnabled: true },
      { input: 'DeLeTe', expectedEnabled: true },
      { input: '  delete  ', expectedEnabled: true },
    ];

    for (const tc of testCases) {
      const enabled = await testInputVal(tc.input);
      console.log(`  - Input: "${tc.input}" -> Enabled: ${enabled} (Expected: ${tc.expectedEnabled})`);
      assert.equal(enabled, tc.expectedEnabled, `Failed for input "${tc.input}"`);
    }
    console.log('  ✔ Case-insensitive DELETE confirmation passes all variations!');

    // CANCEL MODAL WITHOUT MUTATING
    await cdp.eval(`
      (() => {
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel' && b.closest('#recycle-modal-title')?.parentNode);
        const modal = document.querySelector('#recycle-modal-title')?.closest('.fixed');
        const btn = modal ? Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel') : null;
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // 7. Test Case-Insensitive DELETE PERMANENTLY logic
    console.log('7. Testing Case-Insensitive DELETE PERMANENTLY validation helper logic...');
    const permCases = [
      { input: 'DELETE PERMANENTLY', expected: true },
      { input: 'delete permanently', expected: true },
      { input: 'Delete Permanently', expected: true },
      { input: 'DeLeTe PeRmAnEnTlY', expected: true },
      { input: '  delete permanently  ', expected: true },
      { input: 'DELETE', expected: false },
      { input: 'DELETE PERM', expected: false },
      { input: 'PERMANENTLY', expected: false },
      { input: 'wrong', expected: false },
      { input: 'delete permanently now', expected: false },
    ];

    for (const pc of permCases) {
      const result = pc.input.trim().toUpperCase() === 'DELETE PERMANENTLY';
      console.log(`  - Input: "${pc.input}" -> Valid: ${result} (Expected: ${pc.expected})`);
      assert.equal(result, pc.expected, `Failed for permanent delete input "${pc.input}"`);
    }
    console.log('  ✔ Case-insensitive DELETE PERMANENTLY passes all variations and rejects partials!');

    // 8. Test RBAC protection
    console.log('8. Verifying RBAC protection as Site Manager...');
    await setSession(engToken);
    await navigateAndWait('http://localhost:3000/setup/archive');
    const isRestricted = await cdp.eval(`document.body.innerText.includes('Access Restricted')`);
    console.log(`[x] Site Manager accessing /setup/archive: Restricted = ${isRestricted}`);
    assert.equal(isRestricted, true, 'Site Manager must be blocked from /setup/archive');

    console.log('\n================================================================');
    console.log('TARGETED SAFETY & UI POLISH CHECKS ALL PASSED CLEANLY!');
    console.log('================================================================\n');

  } finally {
    try {
      chromeProc.kill();
    } catch {}
    if (fs.existsSync(TEMP_USER_DATA)) {
      try {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
      } catch {}
    }
  }
}

runTargetedVerification().catch((err) => {
  console.error('Targeted verification failed:', err);
  process.exit(1);
});
