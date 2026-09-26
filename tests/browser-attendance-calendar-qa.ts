import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_cal_temp');

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
  console.log('=== STARTING DAILY ATTENDANCE & CUSTOM CALENDAR BROWSER QA ===');

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
    tokenVersion: 1,
  });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9223',
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
        versionData = await fetchJson('http://127.0.0.1:9223/json/version');
        if (versionData && versionData.webSocketDebuggerUrl) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.ok(versionData, 'Chrome debugging websocket reachable');

    const targets = await fetchJson('http://127.0.0.1:9223/json/list');
    const pageTarget = targets.find((t: any) => t.type === 'page');
    assert.ok(pageTarget, 'Found Chrome page target');

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const consoleErrors: string[] = [];
    cdp.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
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

    // --- 1. DAILY ATTENDANCE PAGE & ACTION BUTTONS ---
    console.log('\n--- 1. Testing Daily Attendance Action Area (/attendance/daily) ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/attendance/daily' });
    await new Promise((r) => setTimeout(r, 2000));

    const actionButtons = await cdp.eval(`(() => {
      const rolesBtn = document.getElementById('daily-attendance-roles-btn');
      const allButtons = Array.from(document.querySelectorAll('button, a'));
      const pdfBtn = allButtons.find(b => b.textContent?.includes('PDF'));
      const excelBtn = allButtons.find(b => b.textContent?.includes('Excel'));
      const saveBtn = allButtons.find(b => b.textContent?.includes('Save') || b.textContent?.includes('Saved'));

      return {
        hasPdf: Boolean(pdfBtn),
        hasExcel: Boolean(excelBtn),
        hasRoles: Boolean(rolesBtn),
        hasSave: Boolean(saveBtn),
        rolesHref: rolesBtn?.getAttribute('href'),
        rolesText: rolesBtn?.innerText?.trim(),
        rolesRect: rolesBtn ? rolesBtn.getBoundingClientRect() : null,
      };
    })()`);

    console.log('Daily Attendance Action Area:', actionButtons);
    assert.ok(actionButtons.hasPdf, 'PDF button must exist');
    assert.ok(actionButtons.hasExcel, 'Excel button must exist');
    assert.ok(actionButtons.hasRoles, 'Roles button must exist');
    assert.ok(actionButtons.hasSave, 'Save Attendance button must exist');
    assert.equal(actionButtons.rolesHref, '/setup/roles', 'Roles button links to /setup/roles');
    assert.equal(actionButtons.rolesText, 'Roles', 'Roles button label is "Roles"');
    assert.ok(actionButtons.rolesRect.height >= 40, 'Roles button height is accessible');

    // --- 2. ROLES BUTTON NAVIGATION ---
    console.log('\n--- 2. Testing Roles Button Navigation ---');
    await cdp.eval(`document.getElementById('daily-attendance-roles-btn').click()`);
    await new Promise((r) => setTimeout(r, 1500));

    const rolesPageState = await cdp.eval(`(() => {
      return {
        pathname: window.location.pathname,
        heading: document.querySelector('h1')?.innerText?.trim(),
        navRolesLabel: Array.from(document.querySelectorAll('nav a, aside a, header a')).find(a => a.getAttribute('href') === '/setup/roles')?.innerText?.trim(),
      };
    })()`);

    console.log('Navigated to Roles page:', rolesPageState);
    assert.equal(rolesPageState.pathname, '/setup/roles', 'Must navigate to /setup/roles');
    assert.equal(rolesPageState.heading, 'Roles', 'Page heading must be "Roles"');
    assert.equal(rolesPageState.navRolesLabel, 'Roles', 'Nav label must be "Roles"');

    // --- 3. CUSTOM CALENDAR ON DAILY ATTENDANCE ---
    console.log('\n--- 3. Testing Custom Calendar on Daily Attendance ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/attendance/daily' });
    await new Promise((r) => setTimeout(r, 2000));

    // Confirm no visible native date picker
    const nativeDateCheck = await cdp.eval(`(() => {
      const nativeDate = document.querySelector('input[type="date"]');
      const customTrigger = document.getElementById('daily-attendance-date-picker-trigger');
      return {
        hasNativeDate: Boolean(nativeDate),
        hasCustomTrigger: Boolean(customTrigger),
        triggerText: customTrigger?.innerText?.trim(),
        hasAriaHasPopup: customTrigger?.getAttribute('aria-haspopup'),
        ariaExpanded: customTrigger?.getAttribute('aria-expanded'),
      };
    })()`);

    console.log('Native date check:', nativeDateCheck);
    assert.equal(nativeDateCheck.hasNativeDate, false, 'No visible native <input type="date">');
    assert.ok(nativeDateCheck.hasCustomTrigger, 'Custom DatePicker trigger exists');
    assert.equal(nativeDateCheck.hasAriaHasPopup, 'dialog', 'Trigger has aria-haspopup="dialog"');
    assert.equal(nativeDateCheck.ariaExpanded, 'false', 'Initially closed');

    // Open Custom Calendar
    console.log('Opening Custom Calendar popup...');
    await cdp.eval(`document.getElementById('daily-attendance-date-picker-trigger').click()`);
    await new Promise((r) => setTimeout(r, 300));

    const popupState = await cdp.eval(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const prevBtn = dialog?.querySelector('button[aria-label="Previous Month"]');
      const nextBtn = dialog?.querySelector('button[aria-label="Next Month"]');
      const todayBtn = Array.from(dialog?.querySelectorAll('button') || []).find(b => b.innerText?.trim() === 'Today');
      const dateButtons = dialog ? Array.from(dialog.querySelectorAll('div.grid-cols-7:last-of-type button')) : [];

      return {
        isOpen: Boolean(dialog),
        dialogAriaLabel: dialog?.getAttribute('aria-label'),
        hasPrevMonth: Boolean(prevBtn),
        hasNextMonth: Boolean(nextBtn),
        hasTodayBtn: Boolean(todayBtn),
        dateButtonsCount: dateButtons.length,
        prevBtnHeight: prevBtn?.getBoundingClientRect().height,
        nextBtnHeight: nextBtn?.getBoundingClientRect().height,
        firstCellWidth: dateButtons[0]?.getBoundingClientRect().width,
        firstCellHeight: dateButtons[0]?.getBoundingClientRect().height,
        dialogWidth: dialog?.getBoundingClientRect().width,
      };
    })()`);

    console.log('Calendar Popup State:', popupState);
    assert.ok(popupState.isOpen, 'Calendar popup dialog is open');
    assert.equal(popupState.dialogAriaLabel, 'SITE WORK Calendar', 'Popup has SITE WORK Calendar aria-label');
    assert.ok(popupState.hasPrevMonth, 'Previous month button exists');
    assert.ok(popupState.hasNextMonth, 'Next month button exists');
    assert.ok(popupState.hasTodayBtn, 'Today button exists');
    assert.ok(popupState.dateButtonsCount >= 35, 'Calendar grid renders 35 or 42 cells');
    assert.ok(popupState.prevBtnHeight >= 40, 'Prev month button >= 40px target');
    assert.ok(popupState.nextBtnHeight >= 40, 'Next month button >= 40px target');
    assert.ok(popupState.firstCellHeight >= 38, 'Date cell target is accessible');

    // Test Month Navigation (Next Month & Prev Month)
    console.log('Testing month navigation...');
    const monthHeaderBefore = await cdp.eval(`document.querySelector('div[role="dialog"] .font-black.text-sm')?.innerText`);
    await cdp.eval(`document.querySelector('button[aria-label="Next Month"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const monthHeaderAfterNext = await cdp.eval(`document.querySelector('div[role="dialog"] .font-black.text-sm')?.innerText`);
    assert.notEqual(monthHeaderBefore, monthHeaderAfterNext, 'Next month button shifted view month');

    await cdp.eval(`document.querySelector('button[aria-label="Previous Month"]').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const monthHeaderAfterPrev = await cdp.eval(`document.querySelector('div[role="dialog"] .font-black.text-sm')?.innerText`);
    assert.equal(monthHeaderBefore, monthHeaderAfterPrev, 'Previous month button restored view month');

    // Test Date Selection
    console.log('Selecting a date in calendar...');
    await cdp.eval(`(() => {
      // Click day 15 button
      const buttons = Array.from(document.querySelectorAll('div[role="dialog"] button'));
      const day15Btn = buttons.find(b => b.innerText?.trim() === '15');
      if (day15Btn) day15Btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 300));

    const afterSelectState = await cdp.eval(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const trigger = document.getElementById('daily-attendance-date-picker-trigger');
      return {
        dialogClosed: !dialog,
        triggerText: trigger?.innerText?.trim(),
      };
    })()`);

    console.log('After date select:', afterSelectState);
    assert.ok(afterSelectState.dialogClosed, 'Dialog closed upon date selection');
    assert.ok(afterSelectState.triggerText?.includes('15'), 'Selected date updated on trigger');

    // Test Escape key closes calendar
    console.log('Testing Escape key to close...');
    await cdp.eval(`document.getElementById('daily-attendance-date-picker-trigger').click()`);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(await cdp.eval(`Boolean(document.querySelector('div[role="dialog"]'))`), 'Dialog open again');

    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await cdp.eval(`Boolean(document.querySelector('div[role="dialog"]'))`), false, 'Escape key closed dialog');

    // Test Outside Click closes calendar
    console.log('Testing outside click to close...');
    await cdp.eval(`document.getElementById('daily-attendance-date-picker-trigger').click()`);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(await cdp.eval(`Boolean(document.querySelector('div[role="dialog"]'))`), 'Dialog open again');

    await cdp.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }))`);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await cdp.eval(`Boolean(document.querySelector('div[role="dialog"]'))`), false, 'Outside click closed dialog');

    // --- 4. RESPONSIVE VIEWPORTS (1280px, 768px, 375px) ---
    console.log('\n--- 4. Testing Responsive Viewports (1280px, 768px, 375px) ---');
    for (const width of [1280, 768, 375]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 800,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
      await new Promise((r) => setTimeout(r, 300));

      const overflowCheck = await cdp.eval(`(() => {
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      })()`);

      console.log(`Viewport ${width}px:`, overflowCheck);
      assert.ok(overflowCheck.scrollWidth <= overflowCheck.clientWidth + 1, `No horizontal overflow at ${width}px`);

      // On 375px, open calendar and verify popup does not cause horizontal overflow
      if (width === 375) {
        await cdp.eval(`document.getElementById('daily-attendance-date-picker-trigger').click()`);
        await new Promise((r) => setTimeout(r, 300));

        const mobilePopupCheck = await cdp.eval(`(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          const rect = dialog?.getBoundingClientRect();
          return {
            hasDialog: Boolean(dialog),
            dialogWidth: rect?.width,
            dialogRight: rect?.right,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        })()`);

        console.log('Mobile 375px Calendar Popup:', mobilePopupCheck);
        assert.ok(mobilePopupCheck.hasDialog, 'Calendar popup opened on mobile');
        assert.ok(mobilePopupCheck.scrollWidth <= mobilePopupCheck.clientWidth + 1, 'Mobile popup does not cause horizontal scroll');

        // Close it
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
      }
    }

    // Reset viewport
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // --- 5. THEME VERIFICATION (LIGHT / DARK) ---
    console.log('\n--- 5. Testing Light and Dark Themes ---');
    await cdp.eval(`document.documentElement.classList.add('dark')`);
    await cdp.eval(`document.getElementById('daily-attendance-date-picker-trigger').click()`);
    await new Promise((r) => setTimeout(r, 200));

    const darkCheck = await cdp.eval(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const style = window.getComputedStyle(dialog);
      return {
        bg: style.backgroundColor,
        color: style.color,
      };
    })()`);
    console.log('Dark Theme Calendar style:', darkCheck);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });

    await cdp.eval(`document.documentElement.classList.remove('dark')`);
    await cdp.eval(`document.getElementById('daily-attendance-date-picker-trigger').click()`);
    await new Promise((r) => setTimeout(r, 200));

    const lightCheck = await cdp.eval(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const style = window.getComputedStyle(dialog);
      return {
        bg: style.backgroundColor,
        color: style.color,
      };
    })()`);
    console.log('Light Theme Calendar style:', lightCheck);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });

    // --- 6. FINANCE MODAL CUSTOM DATEPICKER ---
    console.log('\n--- 6. Testing /finance DatePicker ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/finance' });
    await new Promise((r) => setTimeout(r, 2000));

    const financeCheck = await cdp.eval(`(() => {
      // Open add transaction modal
      const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.includes('Add Transaction'));
      if (addBtn) addBtn.click();
      return Boolean(addBtn);
    })()`);

    if (financeCheck) {
      await new Promise((r) => setTimeout(r, 500));
      const finDatePicker = await cdp.eval(`(() => {
        const trigger = document.getElementById('transaction-date-picker-trigger');
        const native = document.querySelector('input[type="date"]');
        return {
          hasCustomTrigger: Boolean(trigger),
          hasNative: Boolean(native),
        };
      })()`);
      console.log('Finance modal DatePicker check:', finDatePicker);
      assert.ok(finDatePicker.hasCustomTrigger, 'Finance page uses custom DatePicker');
      assert.equal(finDatePicker.hasNative, false, 'Finance page does not use native date input');
    }

    // --- 7. CONSOLE / HYDRATION ERRORS ---
    console.log('\n--- 7. Verifying Console & Hydration Errors ---');
    console.log('Captured console errors:', consoleErrors);
    assert.equal(consoleErrors.length, 0, 'Zero console/hydration errors');

    // --- 8. DATABASE READ-ONLY VERIFICATION ---
    console.log('\n--- 8. Database Safety Check ---');
    const baselineAfter = getBaselineCounts();
    console.log('Database baseline after test:', baselineAfter);

    assert.equal(baselineAfter.users, baselineBefore.users, 'users count unchanged');
    assert.equal(baselineAfter.sites, baselineBefore.sites, 'sites count unchanged');
    assert.equal(baselineAfter.site_users, baselineBefore.site_users, 'site_users count unchanged');
    assert.equal(baselineAfter.work_categories, baselineBefore.work_categories, 'work_categories count unchanged');
    assert.equal(baselineAfter.work_roles, baselineBefore.work_roles, 'work_roles count unchanged');
    assert.equal(baselineAfter.attendance_records, baselineBefore.attendance_records, 'attendance_records count unchanged');
    assert.equal(baselineAfter.financial_transactions, baselineBefore.financial_transactions, 'financial_transactions count unchanged');
    assert.equal(baselineAfter.audit_logs, baselineBefore.audit_logs, 'audit_logs count unchanged');

    console.log('\n================================================');
    console.log('ALL DAILY ATTENDANCE & CUSTOM CALENDAR BROWSER QA PASSED!');
    console.log('================================================\n');
  } finally {
    db.close();
    chromeProc.kill();
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }
}

runBrowserQA().catch((err) => {
  console.error('FAILED QA:', err);
  process.exit(1);
});
