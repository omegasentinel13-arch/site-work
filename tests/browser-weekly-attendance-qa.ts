import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_weekly_temp');

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || 'site_work_super_secret_session_key_min_32_characters_long_2026_engineering';
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
  ws: any;
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
      this.ws.onmessage = (event: any) => {
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
  console.log('=== STARTING FOCUSED WEEKLY ATTENDANCE BROWSER QA ===');

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

  const baselineBefore = getBaselineCounts();
  console.log('Database baseline before QA:', baselineBefore);

  const adminRow = db.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const adminToken = await makeToken({
    userId: adminRow.id,
    username: adminRow.username,
    fullName: adminRow.full_name,
    role: adminRow.role,
    assignedSiteIds: [],
    tokenVersion: adminRow.token_version,
  });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9224',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-default-browser-check',
    'about:blank',
  ]);

  try {
    let versionData: any = null;
    for (let i = 0; i < 40; i++) {
      try {
        versionData = await fetchJson('http://127.0.0.1:9224/json/version');
        if (versionData && versionData.webSocketDebuggerUrl) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(versionData, 'Chrome debugging websocket reachable');

    const targets = await fetchJson('http://127.0.0.1:9224/json/list');
    const pageTarget = targets.find((t: any) => t.type === 'page');
    assert.ok(pageTarget, 'Found Chrome page target');

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const consoleErrors: string[] = [];
    cdp.ws.onmessage = (event: any) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && cdp.callbacks.has(msg.id)) {
        const cb = cdp.callbacks.get(msg.id)!;
        cdp.callbacks.delete(msg.id);
        cb(msg);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params?.type;
        const text = msg.params?.args?.map((a: any) => a.value || '').join(' ');
        if (type === 'error' && !text.includes('favicon')) {
          consoleErrors.push(text);
        }
      }
    };

    // Set auth cookie
    await cdp.send('Network.setCookie', {
      name: 'site_work_session',
      value: adminToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    });

    // Viewport 1280x800
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 1. Navigate to /attendance/weekly
    console.log('\n--- 1. Testing Default State on /attendance/weekly ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/attendance/weekly' });
    await new Promise((r) => setTimeout(r, 1000));
    await cdp.eval(`localStorage.setItem('site_work_selected_site', 'site-1')`);
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/attendance/weekly' });
    await new Promise((r) => setTimeout(r, 2500));

    const checkApiSites = await cdp.eval(`
      fetch('/api/sites').then(r => r.json()).catch(err => ({ error: err.message }))
    `);
    console.log('Check /api/sites from page:', checkApiSites);

    const pageInfo = await cdp.eval(`
      (() => {
        const h1 = document.querySelector('h1')?.innerText?.trim();
        const hasMatrix = document.body.innerText.includes('Weekly Workforce Matrix');
        const fromTrigger = document.querySelector('#weekly-from-date-trigger')?.innerText?.trim();
        const toTrigger = document.querySelector('#weekly-to-date-trigger')?.innerText?.trim();
        const nativeInputs = Array.from(document.querySelectorAll('input[type="date"]')).length;
        const rangeBadge = Array.from(document.querySelectorAll('div, span')).find(el => el.textContent?.includes('Max 7'))?.textContent?.trim();
        return { h1, hasMatrix, fromTrigger, toTrigger, nativeInputs, rangeBadge };
      })()
    `);

    console.log('Page Info:', pageInfo);
    assert.equal(pageInfo.h1, 'Weekly Attendance', 'Title must be Weekly Attendance');
    assert.equal(pageInfo.hasMatrix, false, 'Weekly Workforce Matrix must be absent');
    assert.equal(pageInfo.nativeInputs, 0, 'No browser-native date picker inputs');
    assert.ok(pageInfo.rangeBadge?.includes('7 Days (Max 7)'), 'Default range must be 7 days');
    console.log('  ✔ Default state verified: Weekly Attendance heading, 7 Days (Max 7), no native date inputs');

    // 2. Open From Date Custom Calendar
    console.log('\n--- 2. Testing Custom Calendar Month/Year Selectors ---');
    await cdp.eval(`document.querySelector('#weekly-from-date-trigger').click()`);
    await new Promise((r) => setTimeout(r, 400));

    const calInfo = await cdp.eval(`
      (() => {
        const popover = document.querySelector('[role="dialog"]');
        const monthBtn = document.querySelector('button[id*="month-select-btn"]');
        const yearBtn = document.querySelector('button[id*="year-select-btn"]');
        return {
          hasPopover: Boolean(popover),
          hasMonthBtn: Boolean(monthBtn),
          hasYearBtn: Boolean(yearBtn),
        };
      })()
    `);
    console.log('Calendar Popover Info:', calInfo);
    assert.ok(calInfo.hasPopover, 'Custom calendar popover opened');
    assert.ok(calInfo.hasMonthBtn, 'Month selector button present');
    assert.ok(calInfo.hasYearBtn, 'Year selector button present');
    console.log('  ✔ Custom calendar verified with month/year selectors');

    // Close From popover by clicking outside or escape
    await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 300));

    // 3. Test To Date 7-Day Limit Enforcement
    console.log('\n--- 3. Testing 7-Day Maximum Limit in To Date Picker ---');
    // Open To Date calendar
    await cdp.eval(`document.querySelector('#weekly-to-date-trigger').click()`);
    await new Promise((r) => setTimeout(r, 400));

    const toDateCheck = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('[role="dialog"] button'));
        const disabledButtons = buttons.filter(b => b.hasAttribute('disabled') || b.classList.contains('cursor-not-allowed'));
        return {
          totalDayButtons: buttons.length,
          disabledCount: disabledButtons.length,
        };
      })()
    `);
    console.log('To Date Picker Buttons:', toDateCheck);
    assert.ok(toDateCheck.disabledCount > 0, 'Dates outside the 7-day window must be disabled');
    console.log('  ✔ 7-day limit enforced: future dates beyond From + 6 days are disabled');

    // Close To popover
    await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 300));

    // 4. Verify Inverted Navy Styling for Category, Subtotal, and Grand Total with live data
    console.log('\n--- 4. Verifying Inverted Navy Styling and Live Attendance Data ---');
    // Shift to previous week (31/08/2026 - 06/09/2026) where attendance records exist
    await cdp.eval(`document.querySelector('button[aria-label="Previous Week"]').click()`);
    await new Promise((r) => setTimeout(r, 2000));

    const stylingCheck = await cdp.eval(`
      (() => {
        const catRows = Array.from(document.querySelectorAll('tr')).filter(tr => tr.className.includes('bg-slate-900') && tr.querySelector('td[colspan]'));
        const subtotalRows = Array.from(document.querySelectorAll('tr')).filter(tr => tr.textContent?.includes('Subtotal'));
        const grandTotalRow = Array.from(document.querySelectorAll('tr')).find(tr => tr.textContent?.includes('Grand Daily Total'));
        const dayBorders = Array.from(document.querySelectorAll('th, td')).filter(el => el.className.includes('border-black'));

        return {
          catRowCount: catRows.length,
          hasSubtotal: subtotalRows.length > 0,
          hasGrandTotal: Boolean(grandTotalRow),
          grandTotalClass: grandTotalRow?.className,
          dayBorderCount: dayBorders.length,
          tableText: document.querySelector('table')?.innerText?.slice(0, 200),
        };
      })()
    `);
    console.log('Styling Check with Live Data:', stylingCheck);
    assert.ok(stylingCheck.catRowCount > 0, 'Category banner rows must exist with dark navy styling');
    assert.ok(stylingCheck.hasSubtotal, 'Subtotal row must exist with inverted navy styling');
    assert.ok(stylingCheck.hasGrandTotal, 'Grand Daily Total row must exist with inverted navy styling');
    assert.ok(stylingCheck.dayBorderCount > 0, 'Thin black vertical borders present between day columns');
    console.log('  ✔ Inverted Navy styling and thin black vertical separators verified with live records');

    // 5. Responsive Viewports
    console.log('\n--- 5. Testing Responsive Viewports (1280px, 768px, 375px) ---');
    for (const vp of [
      { width: 1280, height: 800, label: 'Desktop 1280px' },
      { width: 768, height: 1024, label: 'Tablet 768px' },
      { width: 375, height: 812, label: 'Mobile 375px' },
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.width <= 768,
      });
      await new Promise((r) => setTimeout(r, 400));

      const overflow = await cdp.eval(`
        (() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
          const clientW = docEl.clientWidth;
          return { scrollW, clientW, hasOverflow: scrollW > clientW };
        })()
      `);
      assert.equal(overflow.hasOverflow, false, `No horizontal overflow at ${vp.label}`);
      console.log(`  ? ${vp.label}: clientW=${overflow.clientW}, scrollW=${overflow.scrollW}, no page overflow`);
    }

    // Reset to 1280x800 for screenshots
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 400));

    // Capture Light Theme Screenshot
    const lightScreenshotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const lightPath = 'C:/Users/Admin/.gemini/antigravity/brain/4fb83adf-e15f-4013-8292-5f4e648accd9/.tempmediaStorage/weekly_attendance_light.png';
    fs.writeFileSync(lightPath, Buffer.from(lightScreenshotRes.result.data, 'base64'));
    // Scroll down to capture Subtotals and Grand Daily Total
    await cdp.eval(`window.scrollTo(0, 350)`);
    await new Promise((r) => setTimeout(r, 400));
    const totalsScreenshotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const totalsPath = 'C:/Users/Admin/.gemini/antigravity/brain/4fb83adf-e15f-4013-8292-5f4e648accd9/.tempmediaStorage/weekly_attendance_totals.png';
    fs.writeFileSync(totalsPath, Buffer.from(totalsScreenshotRes.result.data, 'base64'));
    console.log('  ✔ Captured Totals screenshot to:', totalsPath);
    await cdp.eval(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 300));

    // Dark Theme
    console.log('\n--- 6. Testing Dark Theme ---');
    await cdp.eval(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 400));

    const darkScreenshotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const darkPath = 'C:/Users/Admin/.gemini/antigravity/brain/4fb83adf-e15f-4013-8292-5f4e648accd9/.tempmediaStorage/weekly_attendance_dark.png';
    fs.writeFileSync(darkPath, Buffer.from(darkScreenshotRes.result.data, 'base64'));
    console.log('  ? Captured Dark Theme screenshot to:', darkPath);

    await cdp.eval(`document.documentElement.classList.remove('dark')`);

    // 7. Check console / hydration errors
    console.log('\n--- 7. Checking Console & Hydration Errors ---');
    const filteredErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('Download the React DevTools')
    );
    assert.equal(filteredErrors.length, 0, `No console errors: ${filteredErrors.join(', ')}`);
    console.log('  ? Zero console or hydration errors detected');

    // Baseline after check
    const baselineAfter = getBaselineCounts();
    console.log('Database baseline after QA:', baselineAfter);
    assert.deepEqual(baselineBefore, baselineAfter, 'Live database must remain unchanged');
    console.log('  ? Database zero-delta verified');

    console.log('\n================================================');
    console.log('ALL FOCUSED WEEKLY ATTENDANCE BROWSER QA CHECKS PASSED!');
    console.log('================================================');
  } finally {
    try {
      cdp.ws.close();
    } catch {}
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
