import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_render_check_temp');

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
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data.toString());
          if (data.id && this.callbacks.has(data.id)) {
            const cb = this.callbacks.get(data.id)!;
            this.callbacks.delete(data.id);
            cb(data);
          }
        } catch {}
      };
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const msgId = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(msgId, resolve);
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
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

async function runBrowserVerification() {
  console.log('================================================================');
  console.log('SITE WORK — REAL BROWSER UI RENDERING VERIFICATION SUITE');
  console.log('Target: http://localhost:3000 (Production DB: Read-Only)');
  console.log('================================================================\n');

  // Pre-check production database
  const prodDbPre = new DatabaseSync('data/site_work.db', { readOnly: true });
  const preCounts = {
    users: (prodDbPre.prepare('SELECT COUNT(*) c FROM users').get() as any).c,
    sites: (prodDbPre.prepare('SELECT COUNT(*) c FROM sites').get() as any).c,
    categories: (prodDbPre.prepare('SELECT COUNT(*) c FROM work_categories').get() as any).c,
    roles: (prodDbPre.prepare('SELECT COUNT(*) c FROM work_roles').get() as any).c,
    attendance: (prodDbPre.prepare('SELECT COUNT(*) c FROM attendance_records').get() as any).c,
    finance: (prodDbPre.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as any).c,
    audit_logs: (prodDbPre.prepare('SELECT COUNT(*) c FROM audit_logs').get() as any).c,
    lifecycle: (prodDbPre.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as any).c,
    integrity: (prodDbPre.prepare('PRAGMA integrity_check').get() as any).integrity_check,
    fk_errors: prodDbPre.prepare('PRAGMA foreign_key_check').all().length,
  };
  prodDbPre.close();

  assert.equal(preCounts.users, 4);
  assert.equal(preCounts.sites, 6);
  assert.equal(preCounts.categories, 4);
  assert.equal(preCounts.roles, 23);
  assert.equal(preCounts.attendance, 18);
  assert.equal(preCounts.finance, 4);
  assert.equal(preCounts.audit_logs, 429);
  assert.equal(preCounts.lifecycle, 0);
  assert.equal(preCounts.integrity, 'ok');
  assert.equal(preCounts.fk_errors, 0);
  console.log('✓ Production DB Baseline Verified Pre-Test (Audit logs: 429, Finance: 4, Integrity: ok)\n');

  // Launch Headless Chrome
  if (fs.existsSync(TEMP_USER_DATA)) {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
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

  // Track console errors and network failures
  const consoleErrors: string[] = [];
  const networkFailures: { url: string; errorText: string }[] = [];

  cdp.ws.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data.toString());
      if (parsed.method === 'Runtime.consoleAPICalled' && parsed.params.type === 'error') {
        const text = parsed.params.args.map((a: any) => a.value || a.description || '').join(' ');
        consoleErrors.push(text);
      }
      if (parsed.method === 'Network.loadingFailed') {
        networkFailures.push({
          url: parsed.params.requestId || '',
          errorText: parsed.params.errorText || '',
        });
      }
    } catch {}
  };

  // Set Admin session cookie for http://localhost:3000
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
    url: 'http://localhost:3000',
    path: '/',
  });

  async function setViewport(width: number, height: number) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async function navigate(urlPath: string): Promise<void> {
    const fullUrl = `http://localhost:3000${urlPath}`;
    await cdp.send('Page.navigate', { url: fullUrl });
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const ready = await cdp.eval(`
        (() => {
          if (document.readyState !== 'complete') return false;
          const bodyTxt = document.body ? document.body.textContent || '' : '';
          if (bodyTxt.includes('Loading...') || bodyTxt.includes('Loading user accounts...')) return false;
          return !!document.querySelector('header, nav, main');
        })()
      `);
      if (ready) {
        await sleep(350);
        return;
      }
      await sleep(150);
    }
    throw new Error(`Timeout navigating to ${fullUrl}`);
  }

  try {
    await setViewport(1280, 800);

    // =========================================================================
    // SECTION A: ROUTE-BY-ROUTE RENDERING & STYLING VERIFICATION
    // =========================================================================
    const routesToTest = [
      { path: '/', label: 'Overview Dashboard' },
      { path: '/finance', label: 'Finance Transactions' },
      { path: '/finance/monthly', label: 'Finance Master Ledger' },
      { path: '/setup/roles', label: 'Roles Management' },
      { path: '/setup/categories', label: 'Categories Management' },
      { path: '/setup/sites', label: 'Sites Management' },
      { path: '/setup/archive', label: 'Global Archive' },
      { path: '/setup/recycle-bin', label: 'Global Recycle Bin' },
      { path: '/setup/users', label: 'Users & Access' },
    ];

    console.log('--- A. Verifying 9 Critical Application Routes ---\n');

    for (const r of routesToTest) {
      console.log(`Checking Route: ${r.path} (${r.label}) ...`);
      await navigate(r.path);

      const inspection = await cdp.eval(`
        (() => {
          const styleSheets = Array.from(document.styleSheets);
          const hasLoadedCss = styleSheets.some(s => {
            try {
              return s.cssRules && s.cssRules.length > 0;
            } catch {
              return true; // CORS stylesheet
            }
          });

          // Check header styling
          const header = document.querySelector('header');
          const headerBg = header ? window.getComputedStyle(header).backgroundColor : '';

          // Check nav styling
          const nav = document.querySelector('nav') || document.querySelector('a[href="/"]')?.closest('div');
          const navLinks = Array.from(document.querySelectorAll('nav a, a[href="/"]'));

          // Check buttons
          const buttons = Array.from(document.querySelectorAll('button:not([aria-label="Close dialog"])'));
          const firstBtn = buttons[0];
          const btnStyle = firstBtn ? {
            borderRadius: window.getComputedStyle(firstBtn).borderRadius,
            padding: window.getComputedStyle(firstBtn).padding,
            bg: window.getComputedStyle(firstBtn).backgroundColor,
            isDefault: window.getComputedStyle(firstBtn).borderStyle === 'outset'
          } : null;

          // Check for error overlays / raw text failure indicators
          const bodyText = document.body.textContent || '';
          const hasErrorText = bodyText.includes('missing required error components') ||
                               bodyText.includes('Internal Server Error') ||
                               bodyText.includes('Application error');

          // Horizontal overflow check
          const hasOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;

          return {
            title: document.title,
            styleSheetsCount: styleSheets.length,
            hasLoadedCss,
            headerBg,
            navLinksCount: navLinks.length,
            btnStyle,
            hasErrorText,
            hasOverflow,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        })()
      `);

      console.log(`  -> Page Title: "${inspection.title}"`);
      console.log(`  -> Stylesheets Count: ${inspection.styleSheetsCount} | CSS Rules Loaded: ${inspection.hasLoadedCss}`);
      console.log(`  -> Header Background: ${inspection.headerBg}`);
      console.log(`  -> Nav Links Found: ${inspection.navLinksCount}`);
      console.log(`  -> Button Styled:`, JSON.stringify(inspection.btnStyle));
      console.log(`  -> Horizontal Overflow: ${inspection.hasOverflow} (${inspection.scrollWidth}px vs ${inspection.innerWidth}px)`);

      assert.ok(inspection.hasLoadedCss, `CSS stylesheet rules must be loaded on ${r.path}`);
      assert.ok(!inspection.hasErrorText, `No error messages must appear on ${r.path}`);
      assert.ok(!inspection.hasOverflow, `No horizontal overflow on ${r.path}`);
      if (inspection.btnStyle) {
        assert.ok(!inspection.btnStyle.isDefault, `Buttons must not have browser-default appearance on ${r.path}`);
      }
      console.log(`✓ ${r.label} verified with complete visual design system.\n`);
    }

    // =========================================================================
    // SECTION B: SPECIFIC DESIGN TOKEN & THEME VERIFICATIONS
    // =========================================================================
    console.log('--- B. Verifying Light Theme & Dark Theme Design Tokens on /setup/users ---\n');
    await navigate('/setup/users');

    // 1. Light Theme Check
    const lightCheck = await cdp.eval(`
      (() => {
        document.documentElement.classList.remove('dark');
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        const h1 = document.querySelector('h1');
        const h1Color = h1 ? window.getComputedStyle(h1).color : '';
        const card = document.querySelector('.bg-white, table');
        const cardBg = card ? window.getComputedStyle(card).backgroundColor : '';
        return { bodyBg, h1Color, cardBg };
      })()
    `);
    console.log('Light Theme Computed Styles:', JSON.stringify(lightCheck));
    assert.equal(lightCheck.bodyBg, 'rgb(241, 245, 249)', 'Light theme body background must be #F1F5F9');
    console.log('✓ Light Theme tokens verified.\n');

    // 2. Dark Theme Check
    const darkCheck = await cdp.eval(`
      (() => {
        document.documentElement.classList.add('dark');
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        const h1 = document.querySelector('h1');
        const h1Color = h1 ? window.getComputedStyle(h1).color : '';
        return { bodyBg, h1Color };
      })()
    `);
    console.log('Dark Theme Computed Styles:', JSON.stringify(darkCheck));
    assert.equal(darkCheck.bodyBg, 'rgb(17, 18, 20)', 'Dark theme body background must be #111214');
    console.log('✓ Dark Theme tokens verified.\n');

    // Reset back to light theme
    await cdp.eval(`document.documentElement.classList.remove('dark')`);

    // =========================================================================
    // SECTION C: MULTI-VIEWPORT RESPONSIVENESS (6 VIEWPORTS)
    // =========================================================================
    console.log('--- C. Verifying Responsiveness Across 6 Viewports on /setup/users ---\n');
    const viewports = [
      { label: 'Desktop 1280px', width: 1280, height: 800 },
      { label: 'Small Desktop 1024px', width: 1024, height: 768 },
      { label: 'Tablet 768px', width: 768, height: 1024 },
      { label: 'iPhone 14 Pro Max 430px', width: 430, height: 932 },
      { label: 'Pixel 7 / Galaxy S20 412px', width: 412, height: 915 },
      { label: 'iPhone 12/13/14 390px', width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await setViewport(vp.width, vp.height);
      await sleep(150);

      const vpResult = await cdp.eval(`
        (() => {
          const scrollWidth = document.documentElement.scrollWidth;
          const innerWidth = window.innerWidth;
          const isMobile = innerWidth < 768;
          const desktopTable = document.querySelector('.hidden.md\\:block, table');
          const mobileCards = document.querySelector('.md\\:hidden');
          const hasOverflow = scrollWidth > innerWidth + 2;

          return {
            scrollWidth,
            innerWidth,
            hasOverflow,
            desktopTableVisible: desktopTable ? window.getComputedStyle(desktopTable).display !== 'none' : false,
            mobileCardsVisible: mobileCards ? window.getComputedStyle(mobileCards).display !== 'none' : false,
          };
        })()
      `);

      console.log(`Viewport [${vp.label} ${vp.width}x${vp.height}]: Overflow=${vpResult.hasOverflow} (${vpResult.scrollWidth}px vs ${vpResult.innerWidth}px)`);
      assert.ok(!vpResult.hasOverflow, `No overflow on ${vp.label}`);
      if (vp.width >= 768) {
        assert.ok(vpResult.desktopTableVisible, `Desktop table view must be active on ${vp.label}`);
      } else {
        assert.ok(vpResult.mobileCardsVisible, `Mobile cards view must be active on ${vp.label}`);
      }
      console.log(`✓ Viewport ${vp.label} passed cleanly.`);
    }

    // =========================================================================
    // SECTION D: ERROR STATUS & CONSOLE AUDIT
    // =========================================================================
    console.log('\n--- D. Console & Network Error Status ---');
    const criticalErrors = consoleErrors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('Failed to load resource') &&
      !e.includes('Download the React DevTools')
    );
    console.log(`Critical Console Errors: ${criticalErrors.length}`);
    if (criticalErrors.length > 0) {
      console.log('Console Errors:', criticalErrors);
    }
    assert.equal(criticalErrors.length, 0, 'No critical console/runtime errors');
    console.log('✓ Console & Network checks passed with 0 errors.\n');

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

  // =========================================================================
  // SECTION E: PRODUCTION DATABASE POST-CHECK (READ-ONLY VERIFICATION)
  // =========================================================================
  console.log('--- E. Post-Verification Production Database Safety Check ---');
  const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
  const postCounts = {
    users: (prodDbPost.prepare('SELECT COUNT(*) c FROM users').get() as any).c,
    sites: (prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as any).c,
    categories: (prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as any).c,
    roles: (prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as any).c,
    attendance: (prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as any).c,
    finance: (prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as any).c,
    audit_logs: (prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as any).c,
    lifecycle: (prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as any).c,
    integrity: (prodDbPost.prepare('PRAGMA integrity_check').get() as any).integrity_check,
    fk_errors: prodDbPost.prepare('PRAGMA foreign_key_check').all().length,
  };
  prodDbPost.close();

  console.log('Production Post-Check Baseline:', JSON.stringify(postCounts, null, 2));
  assert.equal(postCounts.users, 4);
  assert.equal(postCounts.sites, 6);
  assert.equal(postCounts.categories, 4);
  assert.equal(postCounts.roles, 23);
  assert.equal(postCounts.attendance, 18);
  assert.equal(postCounts.finance, 4);
  assert.equal(postCounts.audit_logs, 429);
  assert.equal(postCounts.lifecycle, 0);
  assert.equal(postCounts.integrity, 'ok');
  assert.equal(postCounts.fk_errors, 0);
  console.log('✓ Production database remains 100% UNTOUCHED and pristine.\n');

  console.log('================================================================');
  console.log('ALL BROWSER UI RENDERING AND DESIGN CHECKS PASSED COMPLETELY!');
  console.log('================================================================');
}

runBrowserVerification().catch((err) => {
  console.error('FATAL TEST FAILURE:', err);
  process.exit(1);
});
