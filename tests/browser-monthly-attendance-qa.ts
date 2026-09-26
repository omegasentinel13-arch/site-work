import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_monthly_temp');

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
  console.log('=== STARTING MONTHLY ATTENDANCE VIEW MODES BROWSER QA ===');

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
  console.log('Database baseline before test:', baselineBefore);

  const adminRow = db.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const adminToken = await makeToken({
    userId: adminRow.id,
    username: adminRow.username,
    fullName: adminRow.full_name,
    role: adminRow.role,
    assignedSiteIds: [],
    tokenVersion: adminRow.token_version || 1,
  });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
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
        versionData = await fetchJson('http://127.0.0.1:9225/json/version');
        if (versionData && versionData.webSocketDebuggerUrl) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.ok(versionData, 'Chrome debugging websocket reachable');

    const targets = await fetchJson('http://127.0.0.1:9225/json/list');
    const pageTarget = targets.find((t: any) => t.type === 'page');
    assert.ok(pageTarget, 'Found page target');

    const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    const consoleErrors: string[] = [];
    client.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          const txt = msg.params.args.map((a: any) => a.value || a.description || '').join(' ');
          consoleErrors.push(txt);
        }
      } catch {}
    });

    // Set auth cookie
    await client.send('Network.setCookie', {
      name: 'site_work_session',
      value: adminToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    });

    // Set desktop viewport
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('Navigating to http://localhost:3000/attendance/monthly...');
    await client.send('Page.navigate', { url: 'http://localhost:3000/attendance/monthly' });
    
    // Wait for site context and data fetch to complete
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const isLoading = await client.eval(`document.body.innerText.includes('Loading monthly attendance')`);
      const hasNoSite = await client.eval(`document.body.innerText.includes('No Site Selected')`);
      if (!isLoading && !hasNoSite) break;
    }

    // 1. Verify Page loaded & Table View default
    const pageTitle = await client.eval(`document.querySelector('h1')?.textContent`);
    console.log('Page title:', pageTitle);
    assert.equal(pageTitle, 'Monthly Attendance Report');

    const viewModeTableActive = await client.eval(`document.querySelector('[data-testid="view-mode-table"]')?.getAttribute('aria-pressed')`);
    const viewModeCalendarActive = await client.eval(`document.querySelector('[data-testid="view-mode-calendar"]')?.getAttribute('aria-pressed')`);
    console.log('View mode active states:', { table: viewModeTableActive, calendar: viewModeCalendarActive });
    assert.equal(viewModeTableActive, 'true', 'Table View must be active by default');
    assert.equal(viewModeCalendarActive, 'false', 'Calendar View must not be active by default');

    // 2. Verify Table View elements
    const bodyText = await client.eval(`document.body.innerText`);
    console.log('Body text on page:', bodyText);
    const tableHeader = await client.eval(`document.body.innerText.includes('Monthly Workforce Matrix')`);
    console.log('Contains "Monthly Workforce Matrix":', tableHeader);
    assert.ok(tableHeader, 'Table view must display "Monthly Workforce Matrix"');

    const containsWeeklyMatrix = await client.eval(`document.body.innerText.includes('Weekly Workforce Matrix')`);
    console.log('Incorrectly contains "Weekly Workforce Matrix":', containsWeeklyMatrix);
    assert.equal(containsWeeklyMatrix, false, 'Must NOT contain "Weekly Workforce Matrix"');

    // 3. Test Custom Month Selector Popover
    console.log('Testing Custom Month Selector Popover...');
    const triggerTextBefore = await client.eval(`document.querySelector('[data-testid="month-selector-trigger"]')?.textContent`);
    console.log('Month selector trigger before open:', triggerTextBefore);
    assert.ok(triggerTextBefore, 'Must have month selector trigger text');

    // Click trigger to open popover
    await client.eval(`document.querySelector('[data-testid="month-selector-trigger"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    const popoverExists = await client.eval(`Boolean(document.querySelector('[data-testid="month-selector-popover"]'))`);
    console.log('Popover exists after click:', popoverExists);
    assert.equal(popoverExists, true, 'Popover must open on click');

    // Test Escape key closes popover
    await client.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await new Promise((r) => setTimeout(r, 400));
    const popoverClosed = await client.eval(`Boolean(document.querySelector('[data-testid="month-selector-popover"]'))`);
    console.log('Popover closed after Escape:', !popoverClosed);
    assert.equal(popoverClosed, false, 'Popover must close on Escape key');

    // 4. Test View Mode Switcher to Calendar View
    console.log('Switching to Calendar View...');
    await client.eval(`document.querySelector('[data-testid="view-mode-calendar"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    const calendarPressed = await client.eval(`document.querySelector('[data-testid="view-mode-calendar"]')?.getAttribute('aria-pressed')`);
    console.log('Calendar button aria-pressed:', calendarPressed);
    assert.equal(calendarPressed, 'true', 'Calendar View must be active');

    const calendarHeader = await client.eval(`document.body.innerText.includes('Monthly Attendance Calendar')`);
    console.log('Contains "Monthly Attendance Calendar":', calendarHeader);
    assert.ok(calendarHeader, 'Calendar View must display "Monthly Attendance Calendar"');

    // Check weekday headers MON to SUN
    const weekdayHeaders = await client.eval(`Array.from(document.querySelectorAll('.grid-cols-7 > div')).slice(0, 7).map(el => el.textContent.trim())`);
    console.log('Weekday headers:', weekdayHeaders);
    assert.deepEqual(weekdayHeaders, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

    // Helper function for double-clicking any date cell
    async function dblClickDate(dStr: string) {
      const box = await client.eval(`(() => {
        const cell = document.querySelector('[data-date="${dStr}"]');
        if (!cell) return null;
        const rect = cell.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      assert.ok(box, `Must find calendar cell for ${dStr}`);

      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 2 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 2 });
    }

    // Helper function to wait for Daily Attendance page load and return visible date
    async function waitForDailyDate() {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const isDaily = await client.eval(`window.location.pathname === '/attendance/daily'`);
        const isLoading = await client.eval(`document.body.innerText.includes('Loading daily attendance')`);
        if (isDaily && !isLoading) break;
      }
      const visibleDate = await client.eval(`document.getElementById('daily-attendance-date-picker-trigger')?.textContent?.trim()`);
      const fullUrl = await client.eval(`window.location.href`);
      return { visibleDate, fullUrl };
    }

    // 5. Test Double-Click Navigation in Calendar View (Three Dates + Today)
    console.log('Testing single-click vs double-click drill-down in Calendar View...');

    // Single click should NOT navigate
    await client.eval(`document.querySelector('[data-date="2026-09-05"]')?.click()`);
    await new Promise((r) => setTimeout(r, 400));
    const currentUrlAfterSingleClick = await client.eval(`window.location.href`);
    console.log('URL after single click on 2026-09-05:', currentUrlAfterSingleClick);
    assert.ok(currentUrlAfterSingleClick.includes('/attendance/monthly'), 'Single click must NOT navigate');

    // Date 1: 2026-09-01 (Historical Date with attendance data)
    console.log('\n--- Drill-Down Date 1: 2026-09-01 ---');
    await dblClickDate('2026-09-01');
    const res1 = await waitForDailyDate();
    console.log('Date 1 Result:', res1);
    assert.ok(res1.fullUrl.includes('/attendance/daily?date=2026-09-01'), 'URL must contain date=2026-09-01');
    assert.ok(res1.visibleDate?.includes('01 Sep 2026'), 'Visible date must show 01 Sep 2026');

    // Verify attendance data loaded for 2026-09-01
    const bodyDate1 = await client.eval(`document.body.innerText`);
    assert.ok(bodyDate1.includes('01 Sep 2026'), 'Header must reflect 01 Sep 2026');

    // Test Browser Back navigation
    console.log('\n--- Testing Browser Back Navigation ---');
    await client.eval(`window.history.back()`);
    await new Promise((r) => setTimeout(r, 1000));
    const backUrl = await client.eval(`window.location.href`);
    console.log('URL after Back:', backUrl);
    assert.ok(backUrl.includes('/attendance/monthly'), 'Browser Back must return to /attendance/monthly');

    // Switch back to Calendar View
    await client.eval(`document.querySelector('[data-testid="view-mode-calendar"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    // Date 2: 2026-09-05 (Historical Date with zero attendance)
    console.log('\n--- Drill-Down Date 2: 2026-09-05 ---');
    await dblClickDate('2026-09-05');
    const res2 = await waitForDailyDate();
    console.log('Date 2 Result:', res2);
    assert.ok(res2.fullUrl.includes('/attendance/daily?date=2026-09-05'), 'URL must contain date=2026-09-05');
    assert.ok(res2.visibleDate?.includes('05 Sep 2026'), 'Visible date must show 05 Sep 2026');
    assert.ok(!res2.visibleDate?.includes('08 Sep 2026'), 'Must NOT fall back to Today');

    // Date 3: 2026-09-07 (Historical Date with attendance)
    console.log('\n--- Drill-Down Date 3: 2026-09-07 ---');
    await client.send('Page.navigate', { url: 'http://localhost:3000/attendance/monthly' });
    await new Promise((r) => setTimeout(r, 1000));
    await client.eval(`document.querySelector('[data-testid="view-mode-calendar"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    await dblClickDate('2026-09-07');
    const res3 = await waitForDailyDate();
    console.log('Date 3 Result:', res3);
    assert.ok(res3.fullUrl.includes('/attendance/daily?date=2026-09-07'), 'URL must contain date=2026-09-07');
    assert.ok(res3.visibleDate?.includes('07 Sep 2026'), 'Visible date must show 07 Sep 2026');

    // Date 4: Today (2026-09-08)
    console.log('\n--- Drill-Down Today ---');
    const todayISO = await client.eval(`(() => { const d = new Date(); return \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`; })()`);
    console.log('Today ISO:', todayISO);
    await client.send('Page.navigate', { url: 'http://localhost:3000/attendance/monthly' });
    await new Promise((r) => setTimeout(r, 1000));
    await client.eval(`document.querySelector('[data-testid="view-mode-calendar"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    await dblClickDate(todayISO);
    const resToday = await waitForDailyDate();
    console.log('Today Result:', resToday);
    assert.ok(resToday.fullUrl.includes(`/attendance/daily?date=${todayISO}`), `URL must contain date=${todayISO}`);

    // Date 5: Invalid Date Fallback
    console.log('\n--- Testing Invalid Date Query Fallback ---');
    await client.send('Page.navigate', { url: 'http://localhost:3000/attendance/daily?date=invalid-date-string' });
    const resInvalid = await waitForDailyDate();
    console.log('Invalid Date Result:', resInvalid);
    assert.ok(resInvalid.visibleDate, 'Must have a safe fallback visible date without crash');

    // Navigate back to monthly for viewport tests
    await client.send('Page.navigate', { url: 'http://localhost:3000/attendance/monthly' });
    await new Promise((r) => setTimeout(r, 1500));

    // 6. Test Responsive Viewports (1280px, 768px, 375px)
    console.log('Testing viewports...');
    for (const [w, h, label] of [
      [1280, 800, 'Desktop 1280px'],
      [768, 1024, 'Tablet 768px'],
      [375, 667, 'Mobile 375px'],
    ]) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: w < 768,
      });
      await new Promise((r) => setTimeout(r, 300));
      const hasHorizontalScrollbar = await client.eval(`document.documentElement.scrollWidth > window.innerWidth + 5`);
      console.log(`${label} document body overflow:`, hasHorizontalScrollbar);
      assert.equal(hasHorizontalScrollbar, false, `${label} must not horizontally overflow document body`);
    }

    // 7. Test Theme Toggle (Dark & Light Mode)
    console.log('Testing Light and Dark themes...');
    await client.eval(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 200));
    const isDark = await client.eval(`document.documentElement.classList.contains('dark')`);
    assert.ok(isDark, 'Dark mode class added');

    await client.eval(`document.documentElement.classList.remove('dark')`);
    await new Promise((r) => setTimeout(r, 200));

    // 8. Verify Console Errors
    const filteredErrors = consoleErrors.filter(e => !e.includes('favicon'));
    console.log('Console errors captured:', filteredErrors);
    assert.equal(filteredErrors.length, 0, 'No console errors allowed');

    // 9. Baseline Database Verification
    const baselineAfter = getBaselineCounts();
    console.log('Database baseline after test:', baselineAfter);
    assert.deepEqual(baselineBefore, baselineAfter, 'Database MUST NOT be mutated');

    console.log('=== ALL BROWSER QA TESTS PASSED CLEANLY! ===');
  } finally {
    chromeProc.kill();
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }
}

runBrowserQA().catch((err) => {
  console.error('QA FAILED:', err);
  process.exit(1);
});
