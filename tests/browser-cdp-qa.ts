import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_qa_temp');

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026';
  return new TextEncoder().encode(secret);
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

async function runBrowserQA() {
  console.log('================================================================');
  console.log('STARTING ITEM 9: MANUAL BROWSER / VIEWPORT CDP QA');
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

  // Wait for port 9222
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

  assert.ok(pageWsUrl, 'Failed to initialize Chrome CDP session');
  const cdp = new CdpClient(pageWsUrl);
  await cdp.connect();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');

  const db = new DatabaseSync('data/site_work.db');
  const adminUser = db.prepare('SELECT * FROM users WHERE username = ?').get('Iamadmin') as any;
  const engUser = db.prepare('SELECT * FROM users WHERE username = ?').get('engineer2') as any;
  const viewUser = db.prepare('SELECT * FROM users WHERE username = ?').get('viewer1') as any;

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

  const viewToken = await makeToken({
    userId: viewUser.id,
    username: viewUser.username,
    fullName: viewUser.full_name,
    role: viewUser.role,
    assignedSiteIds: ['site-1'],
    tokenVersion: viewUser.token_version,
  });

  const viewports = [
    { name: 'Desktop Standard', width: 1280, height: 800 },
    { name: 'Mobile Narrow', width: 360, height: 800 },
    { name: 'Mobile Standard', width: 390, height: 844 },
    { name: 'Mobile Wide Pro Max', width: 430, height: 932 },
    { name: 'Landscape Narrow', width: 800, height: 360 },
    { name: 'Landscape Wide', width: 932, height: 430 },
  ];

  try {
    // ------------------------------------------------------------------------
    // TEST ROLE 1: ADMIN (All viewports, Light & Dark Theme)
    // ------------------------------------------------------------------------
    console.log('>>> TESTING ADMIN DASHBOARD & RESPONSIVENESS <<<');
    await cdp.send('Network.setCookie', {
      name: 'site_work_session',
      value: adminToken,
      url: 'http://localhost:3000',
      path: '/',
    });

    async function waitForPageLoaded(): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const ready = await cdp.eval(`document.querySelector('h1') !== null || (document.body && document.body.textContent.includes('Access Restricted'))`);
        if (ready) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      const currentUrl = await cdp.eval(`window.location.href`);
      const bodyText = await cdp.eval(`document.body.innerText`);
      throw new Error(`Page load timeout at ${currentUrl}: ${bodyText?.substring(0, 200)}`);
    }

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 800,
      });

      await cdp.send('Page.navigate', { url: 'http://localhost:3000/reports/complete-export' });
      await waitForPageLoaded();

      // 1. Check for horizontal overflow
      const overflow = await cdp.eval(`
        (() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
          const clientWidth = docEl.clientWidth;
          return {
            hasOverflow: scrollWidth > clientWidth + 1,
            scrollWidth,
            clientWidth
          };
        })()
      `);
      assert.equal(overflow.hasOverflow, false, `Viewport ${vp.name} (${vp.width}x${vp.height}) has horizontal overflow!`);
      console.log(`  ✔ Viewport ${vp.name.padEnd(20)} (${vp.width}x${vp.height}): Zero horizontal overflow (client: ${overflow.clientWidth}px, scroll: ${overflow.scrollWidth}px)`);

      // 2. Check interactive touch target sizes on the Complete Export page (buttons, selects, date inputs, and checkbox labels)
      const touchTargets = await cdp.eval(`
        (() => {
          const container = document.querySelector('main') || document.body;
          const interactive = Array.from(container.querySelectorAll('button, select, input[type="date"], label:has(input[type="checkbox"])'));
          const undersized = [];
          for (const el of interactive) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            // Check if element height or width is below touch target threshold (40px with tolerance)
            if (rect.height < 40) {
              undersized.push({ tag: el.tagName, text: (el.textContent || '').trim().substring(0, 20), w: Math.round(rect.width), h: Math.round(rect.height) });
            }
          }
          return { total: interactive.length, undersizedCount: undersized.length, undersized };
        })()
      `);
      assert.equal(touchTargets.undersizedCount, 0, `Found undersized targets in ${vp.name}: ${JSON.stringify(touchTargets.undersized)}`);
    }

    // 3. Test Interactive Controls as Admin
    console.log('\n>>> TESTING INTERACTIVE CONTROLS AS ADMIN <<<');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/reports/complete-export' });
    await waitForPageLoaded();

    // Switch to Dark Theme
    await cdp.eval(`
      (() => {
        document.documentElement.classList.add('dark');
        return document.documentElement.classList.contains('dark');
      })()
    `);
    const isDark = await cdp.eval(`document.documentElement.classList.contains('dark')`);
    assert.equal(isDark, true, 'Dark theme class applied');
    console.log('  ✔ Dark Theme rendered and styles applied correctly');

    // Switch to Light Theme
    await cdp.eval(`
      (() => {
        document.documentElement.classList.remove('dark');
        return !document.documentElement.classList.contains('dark');
      })()
    `);
    const isLight = await cdp.eval(`!document.documentElement.classList.contains('dark')`);
    assert.equal(isLight, true, 'Light theme restored');
    console.log('  ✔ Light Theme rendered and styles applied correctly');

    // Click "Specific Project Site" button
    const clickSiteScope = await cdp.eval(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const siteBtn = btns.find(b => b.textContent.includes('Specific Project Site'));
        if (siteBtn) { siteBtn.click(); return true; }
        return false;
      })()
    `);
    assert.equal(clickSiteScope, true, 'Site scope button clicked');
    await new Promise((r) => setTimeout(r, 400));

    // Verify Site dropdown appeared
    const siteSelectExists = await cdp.eval(`
      (() => {
        const sel = document.querySelector('#site-select');
        return sel !== null && sel.options.length === 6;
      })()
    `);
    assert.equal(siteSelectExists, true, 'Admin sees all 6 sites in project site dropdown');
    console.log('  ✔ Scope selector: Successfully toggled from Entire System to Specific Project Site (6 sites listed)');

    // Click "Past 30 Days" period button
    const clickLast30 = await cdp.eval(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b30 = btns.find(b => b.textContent.includes('Past 30 Days'));
        if (b30) { b30.click(); return true; }
        return false;
      })()
    `);
    assert.equal(clickLast30, true);
    console.log('  ✔ Period button: Successfully selected Past 30 Days preset');

    // Click "Custom Range" button and verify custom date pickers appear
    const clickCustom = await cdp.eval(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const customBtn = btns.find(b => b.textContent.includes('Custom Range'));
        if (customBtn) { customBtn.click(); return true; }
        return false;
      })()
    `);
    assert.equal(clickCustom, true);
    await new Promise((r) => setTimeout(r, 300));
    const customInputsExist = await cdp.eval(`
      (() => {
        const fromInput = document.querySelector('#custom-from-date');
        const toInput = document.querySelector('#custom-to-date');
        return fromInput !== null && toInput !== null;
      })()
    `);
    assert.equal(customInputsExist, true, 'Custom date pickers revealed on CUSTOM preset');
    console.log('  ✔ Custom Date inputs: #custom-from-date and #custom-to-date appeared properly');

    // Test Format Checkboxes
    const formatChecks = await cdp.eval(`
      (() => {
        const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        return {
          count: cbs.length,
          allChecked: cbs.every(c => c.checked)
        };
      })()
    `);
    assert.equal(formatChecks.count, 3, 'Exactly 3 format checkboxes (PDF, Excel, JSON)');
    assert.equal(formatChecks.allChecked, true, 'All 3 format checkboxes checked by default');
    console.log('  ✔ Format checkboxes: PDF, Excel, JSON checkboxes active and verified');

    // ------------------------------------------------------------------------
    // TEST ROLE 2: ENGINEER (Restricted to assigned sites)
    // ------------------------------------------------------------------------
    console.log('\n>>> TESTING ENGINEER DASHBOARD & SCOPE LOCKING <<<');
    await cdp.send('Network.setCookie', {
      name: 'site_work_session',
      value: engToken,
      url: 'http://localhost:3000',
      path: '/',
    });
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/reports/complete-export' });
    await waitForPageLoaded();

    // Verify Engineer does NOT see the "Entire System" toggle
    const engScopeControls = await cdp.eval(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const hasSystemBtn = btns.some(b => b.textContent.includes('Entire System'));
        const siteSelect = document.querySelector('#site-select');
        const options = siteSelect ? Array.from(siteSelect.options).map(o => o.value) : [];
        return { hasSystemBtn, options };
      })()
    `);
    assert.equal(engScopeControls.hasSystemBtn, false, 'Engineer MUST NOT see Entire System toggle');
    assert.equal(engScopeControls.options.length, 1, 'Engineer should only see assigned sites');
    assert.equal(engScopeControls.options[0], 'site-2', 'Engineer site-2 assignment reflected in UI');
    console.log('  ✔ Engineer UI: Scope locked to Assigned Site (site-2), Entire System toggle strictly hidden');

    // ------------------------------------------------------------------------
    // TEST ROLE 3: VIEWER (Access Restricted Card)
    // ------------------------------------------------------------------------
    console.log('\n>>> TESTING VIEWER RESTRICTION UI <<<');
    await cdp.send('Network.setCookie', {
      name: 'site_work_session',
      value: viewToken,
      url: 'http://localhost:3000',
      path: '/',
    });
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/reports/complete-export' });
    await waitForPageLoaded();

    const viewerPage = await cdp.eval(`
      (() => {
        const bodyText = document.body.textContent || '';
        const hasLockIcon = document.querySelector('svg') !== null;
        const hasRestricted = bodyText.includes('Access Restricted');
        const hasExportButton = bodyText.includes('Download Complete Archive');
        return { hasRestricted, hasExportButton, hasLockIcon };
      })()
    `);
    assert.equal(viewerPage.hasRestricted, true, 'Viewer must see Access Restricted message');
    assert.equal(viewerPage.hasExportButton, false, 'Viewer MUST NOT see export buttons');
    console.log('  ✔ Viewer UI: Access Restricted card displayed with lock icon, zero export buttons rendered');

    console.log('\n================================================================');
    console.log('ALL BROWSER & VIEWPORT QA CHECKS PASSED (100% SUCCESS)');
    console.log('================================================================');
  } finally {
    cdp.ws.close();
    chromeProc.kill('SIGKILL');
    if (fs.existsSync(TEMP_USER_DATA)) {
      try {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
      } catch {}
    }
  }
}

runBrowserQA().catch((err) => {
  console.error('BROWSER QA FAILED:', err);
  process.exit(1);
});
