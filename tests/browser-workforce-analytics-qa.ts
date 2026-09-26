import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_workforce_temp');

function getSecretKey(): Uint8Array {
  let secret = process.env.SESSION_SECRET;
  if (!secret && fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/SESSION_SECRET=(.*)/);
    if (match) {
      secret = match[1].trim();
    }
  }
  return new TextEncoder().encode(secret || 'site_work_dev_secret_session_key_minimum_32_characters_2026');
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
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id)!;
          this.callbacks.delete(msg.id);
          cb(msg);
        }
      };
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const msgId = this.id++;
    return new Promise((resolve) => {
      this.callbacks.set(msgId, resolve);
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.result?.value;
  }
}

async function runBrowserQA() {
  console.log('=== STARTING WORKFORCE ANALYTICS BROWSER QA ===');

  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(
    path.join(process.cwd(), 'data', 'site_work.db'),
    { readOnly: true }
  );

  const getBaselineCounts = () => {
    const tables = ['users', 'sites', 'site_users', 'work_categories', 'work_roles', 'attendance_records', 'financial_transactions', 'audit_logs'];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      counts[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any).c;
    }
    return counts;
  };

  const initialCounts = getBaselineCounts();
  console.log('Database baseline before test:', initialCounts);

  const adminRow = db.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const adminToken = await makeToken({
    userId: adminRow.id,
    username: adminRow.username,
    fullName: adminRow.full_name,
    role: adminRow.role,
    assignedSiteIds: [],
    tokenVersion: adminRow.token_version || 1,
  });

  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--remote-debugging-port=9225',
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${TEMP_USER_DATA}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let client: CdpClient | null = null;

  try {
    let versionInfo: any = null;
    for (let i = 0; i < 20; i++) {
      try {
        versionInfo = await fetchJson('http://localhost:9225/json/version');
        if (versionInfo && versionInfo.webSocketDebuggerUrl) break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (!versionInfo || !versionInfo.webSocketDebuggerUrl) {
      throw new Error('Failed to connect to Chrome remote debugging port');
    }

    const targets = await fetchJson('http://localhost:9225/json');
    const pageTarget = targets.find((t: any) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found in Chrome');

    client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    // Collect console errors
    const consoleErrors: string[] = [];
    client.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = msg.params.args?.map((a: any) => a.value || a.description).join(' ');
        consoleErrors.push(text);
      }
      if (msg.id && client!.callbacks.has(msg.id)) {
        const cb = client!.callbacks.get(msg.id)!;
        client!.callbacks.delete(msg.id);
        cb(msg);
      }
    };

    // Set auth cookie
    await client.send('Network.setCookie', {
      name: 'site_work_session',
      value: adminToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('Navigating to http://localhost:3000/reports/role...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/reports/role' });
    await new Promise((r) => setTimeout(r, 2000));

    // Wait for site context and data fetch to complete
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const isLoading = await client.eval(`document.body.innerText.includes('Loading')`);
      const hasNoSite = await client.eval(`document.body.innerText.includes('No Site Selected')`);
      if (!isLoading && !hasNoSite) break;
    }

    // 1. Verify Page Title
    const titleText = await client.eval(`document.querySelector('h1')?.innerText`);
    console.log('Page title detected:', titleText);
    assert.equal(titleText, 'WORKFORCE ANALYTICS', 'Title must be WORKFORCE ANALYTICS');

    // 2. Verify Hierarchical Selector & Toggle
    const selectorBtnText = await client.eval(`document.querySelector('button[aria-haspopup="true"] span.truncate')?.innerText`);
    console.log('Initial selector text:', selectorBtnText);
    assert.equal(selectorBtnText, 'ALL WORKERS', 'Initial selector must be ALL WORKERS');

    // Open dropdown
    await client.eval(`document.querySelector('button[aria-haspopup="true"]')?.click()`);
    await new Promise((r) => setTimeout(r, 400));
    const dropdownOpen = await client.eval(`document.body.innerText.includes('ALL (COMPLETE WORKFORCE)')`);
    assert.ok(dropdownOpen, 'Dropdown panel must be open');
    console.log('Hierarchical selector opened successfully with ALL toggle.');

    // Close dropdown
    await client.eval(`document.body.click()`);
    await new Promise((r) => setTimeout(r, 300));

    // 3. Test Date Range Draft / Apply Behavior
    console.log('Testing Date Range Draft vs Applied behavior...');
    const initialSubtitle = await client.eval(`document.querySelector('p.text-xs')?.innerText`);
    console.log('Initial subtitle:', initialSubtitle);

    // Apply button exists
    const applyBtnExists = await client.eval(`!!document.getElementById('workforce-analytics-apply-btn')`);
    assert.ok(applyBtnExists, 'APPLY button must exist');

    // 4. View Modes Switching
    console.log('Testing View Modes: Overall Breakdown, Year Calendar, Drilldown Explorer...');
    
    // Switch to Year Calendar
    const btnExists = await client.eval(`!!document.querySelector('[data-testid="view-mode-year"]')`);
    console.log('view-mode-year button exists:', btnExists);
    await client.eval(`
      const b = document.querySelector('[data-testid="view-mode-year"]');
      if (b) {
        b.click();
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const ariaPressed = await client.eval(`document.querySelector('[data-testid="view-mode-year"]')?.getAttribute('aria-pressed')`);
    console.log('view-mode-year aria-pressed:', ariaPressed);
    const fullBody = await client.eval(`document.body.innerText`);
    console.log('Full body text after clicking Year Calendar:\n', fullBody);
    const yearCalendarHeader = await client.eval(`document.body.innerText.toUpperCase().includes('YEARLY WORKFORCE CALENDAR')`);
    assert.ok(yearCalendarHeader, 'Year Calendar header must be visible');
    console.log('Year Calendar view mode active.');

    async function dblClickSelector(selector: string) {
      const box = await client!.eval(`(() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      assert.ok(box, `Must find element for ${selector}`);
      await client!.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await client!.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await client!.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 2 });
      await client!.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 2 });
    }

    // Check single click does NOT navigate
    const urlBeforeSingleClick = await client.eval(`window.location.href`);
    await client.eval(`document.querySelector('[data-month="2026-09"]')?.click()`);
    await new Promise((r) => setTimeout(r, 400));
    const urlAfterSingleClick = await client.eval(`window.location.href`);
    assert.equal(urlAfterSingleClick, urlBeforeSingleClick, 'Single click must NOT navigate');
    console.log('Verified: Single click on month card does NOT navigate.');

    // Test double click on September card
    console.log('Double-clicking September month card to drill down to /attendance/monthly?month=2026-09...');
    await dblClickSelector('[data-month="2026-09"]');
    await new Promise((r) => setTimeout(r, 1500));

    const currentUrlAfterDblClick = await client.eval(`window.location.href`);
    console.log('URL after month double-click:', currentUrlAfterDblClick);
    assert.ok(currentUrlAfterDblClick.includes('/attendance/monthly?month=2026-09'), 'Must navigate to /attendance/monthly?month=2026-09');

    const monthlyVisibleMonth = await client.eval(`document.body.innerText.includes('September 2026')`);
    assert.ok(monthlyVisibleMonth, 'Monthly Attendance must open on September 2026');
    console.log('Verified: Monthly Attendance preserved exact month 2026-09.');

    // Return to Workforce Analytics
    await client.send('Page.navigate', { url: 'http://localhost:3000/reports/role' });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const isLoading = await client.eval(`document.body.innerText.includes('Loading')`);
      const hasNoSite = await client.eval(`document.body.innerText.includes('No Site Selected')`);
      if (!isLoading && !hasNoSite) break;
    }

    // 5. Test Drilldown Explorer
    console.log('Testing Drilldown Explorer...');
    await client.eval(`document.querySelector('[data-testid="view-mode-drilldown"]')?.click()`);
    await new Promise((r) => setTimeout(r, 800));

    const drilldownHeader = await client.eval(`document.body.innerText.toUpperCase().includes('HIERARCHICAL DRILLDOWN EXPLORER')`);
    assert.ok(drilldownHeader, 'Drilldown Explorer must be visible');

    // Click Month 9 ('Sep') in multi-select strip
    await client.eval(`document.querySelector('[data-drilldown-month="9"]')?.click()`);
    await new Promise((r) => setTimeout(r, 1000));

    const activeDaysTable = await client.eval(`document.body.innerText.toUpperCase().includes('ACTIVE ATTENDANCE DAYS')`);
    assert.ok(activeDaysTable, 'Active Attendance Days table must appear after selecting Sep');
    console.log('Drilldown Explorer loaded active days for September.');

    // Test Double click on Date (2026-09-01)
    console.log('Double-clicking date in Drilldown Explorer to jump to /attendance/daily?date=2026-09-01...');
    await dblClickSelector('[data-day="2026-09-01"]');
    await new Promise((r) => setTimeout(r, 1500));

    const dailyUrl = await client.eval(`window.location.href`);
    console.log('URL after date double-click:', dailyUrl);
    assert.ok(dailyUrl.includes('/attendance/daily?date=2026-09-01'), 'Must navigate to /attendance/daily?date=2026-09-01');

    const dailyVisibleDate = await client.eval(`document.body.innerText.includes('01 Sep 2026')`);
    assert.ok(dailyVisibleDate, 'Daily Attendance must display 01 Sep 2026');
    console.log('Verified: Daily Attendance preserved exact date 2026-09-01.');

    // Return to Workforce Analytics
    await client.send('Page.navigate', { url: 'http://localhost:3000/reports/role' });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const isLoading = await client.eval(`document.body.innerText.includes('Loading')`);
      const hasNoSite = await client.eval(`document.body.innerText.includes('No Site Selected')`);
      if (!isLoading && !hasNoSite) break;
    }

    // 6. Test Secondary Tab: TRANSACTIONS
    console.log('Testing TRANSACTIONS secondary tab...');
    await client.eval(`
      const txBtn = document.querySelector('[data-testid="tab-transactions"]');
      if (txBtn) {
        txBtn.click();
        txBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const bodyUpper = await client.eval(`document.body.innerText.toUpperCase()`);
    const txInflowVisible = bodyUpper.includes('TOTAL INFLOW');
    const txOutflowVisible = bodyUpper.includes('TOTAL OUTFLOW');
    const txNetBalanceVisible = bodyUpper.includes('NET BALANCE');
    assert.ok(txInflowVisible && txOutflowVisible && txNetBalanceVisible, 'Transaction KPI cards must render');
    console.log('Transactions tab renders Inflow, Outflow, and Net Balance cleanly.');

    // Switch back to ATTENDANCE tab
    await client.eval(`
      const attBtn = document.querySelector('[data-testid="tab-attendance"]');
      if (attBtn) {
        attBtn.click();
        attBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    `);
    await new Promise((r) => setTimeout(r, 800));

    // 7. Viewports & Responsive Layout Check
    console.log('Testing Viewports (1280px, 768px, 375px)...');
    const viewports = [
      { name: 'Desktop', width: 1280, height: 800 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Mobile', width: 375, height: 667 },
    ];

    for (const vp of viewports) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width < 768,
      });
      await new Promise((r) => setTimeout(r, 400));
      const hasOverflow = await client.eval(`document.documentElement.scrollWidth > window.innerWidth`);
      console.log(`${vp.name} (${vp.width}px) document horizontal overflow:`, hasOverflow);
      assert.equal(hasOverflow, false, `${vp.name} must not have document horizontal overflow`);
    }

    // 8. Test Light & Dark Theme
    console.log('Testing Light and Dark themes...');
    await client.eval(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    await client.eval(`document.documentElement.classList.remove('dark')`);
    await new Promise((r) => setTimeout(r, 300));

    // 9. Console Error Verification
    console.log('Console errors captured:', consoleErrors);
    const fatalErrors = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('chrome-error'));
    assert.equal(fatalErrors.length, 0, 'Must have zero console errors');

    // 10. Database Zero-Mutation Verification
    const finalCounts = getBaselineCounts();
    console.log('Database baseline after test:', finalCounts);
    assert.deepEqual(finalCounts, initialCounts, 'Database counts must remain 100% identical');

    console.log('=== ALL WORKFORCE ANALYTICS BROWSER QA TESTS PASSED CLEANLY! ===');
  } finally {
    if (client) {
      try {
        client.ws.close();
      } catch {}
    }
    chromeProcess.kill('SIGKILL');
  }
}

runBrowserQA().catch((err) => {
  console.error('Browser QA Failed:', err);
  process.exit(1);
});
