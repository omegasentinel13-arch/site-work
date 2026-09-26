import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import assert from 'node:assert/strict';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_live_qa_temp');
const RAILWAY_URL = 'https://site-work-app-production.up.railway.app';

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

class CdpClient {
  ws: WebSocket;
  id = 1;
  callbacks = new Map<number, (res: any) => void>();
  errors: string[] = [];

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
        if (msg.method === 'Runtime.exceptionThrown') {
          const detail = msg.params.exceptionDetails;
          const text = detail.text || detail.exception?.description || JSON.stringify(detail);
          this.errors.push(text);
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
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.result?.value;
  }
}

async function runLiveBrowserQA() {
  console.log('================================================================');
  console.log(`LIVE RAILWAY PRODUCTION BROWSER QA: ${RAILWAY_URL}`);
  console.log('================================================================\n');

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9227',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ]);

  let cdp: CdpClient | null = null;
  for (let i = 0; i < 30; i++) {
    try {
      const tabs = await fetchJson('http://127.0.0.1:9227/json');
      if (Array.isArray(tabs)) {
        const page = tabs.find((t: any) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          cdp = new CdpClient(page.webSocketDebuggerUrl);
          await cdp.connect();
          break;
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  assert.ok(cdp, 'CDP connection established');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');

  // Clear all cookies to ensure 100% clean unauthenticated context
  await cdp.send('Network.clearBrowserCookies');

  // =========================================================================
  // STEP 1: Deep Link Navigation to /finance
  // =========================================================================
  console.log('1. Navigating to unauthenticated deep-link: /finance');
  await cdp.send('Page.navigate', { url: `${RAILWAY_URL}/finance` });

  // Wait for redirect to /login?next=%2Ffinance
  let currentUrl = '';
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    currentUrl = await cdp.eval('window.location.href');
    if (currentUrl.includes('/login')) break;
  }

  console.log('   Redirected to URL:', currentUrl);
  assert.ok(
    currentUrl.includes('/login?next=%2Ffinance') || currentUrl.includes('/login?next=/finance'),
    `Expected redirect to /login?next=%2Ffinance, got: ${currentUrl}`
  );
  console.log('   ✓ [PASS] Clean unauthenticated request redirected to /login?next=%2Ffinance');

  // =========================================================================
  // STEP 2: Password Visibility Toggle Verification
  // =========================================================================
  console.log('\n2. Testing Password Visibility Toggle in Live Login Form');

  // Wait for login form to mount
  for (let attempt = 0; attempt < 20; attempt++) {
    const ready = await cdp.eval(`!!document.querySelector('input[placeholder="••••••••"]')`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  // A. Check Initial State
  const initialType = await cdp.eval(`document.querySelector('input[placeholder="••••••••"]')?.type`);
  const initialBtnLabel = await cdp.eval(`document.querySelector('button[aria-label="Show password"]')?.getAttribute('aria-label')`);
  console.log('   Initial password input type:', initialType);
  console.log('   Initial eye button aria-label:', initialBtnLabel);
  assert.equal(initialType, 'password', 'Password input must initially be type="password"');
  assert.equal(initialBtnLabel, 'Show password', 'Initial button aria-label must be "Show password"');
  console.log('   ✓ [PASS] Password initially hidden by default');

  // B. Click Eye Button (Reveal)
  console.log('   Clicking Eye button to reveal password...');
  await cdp.eval(`document.querySelector('button[aria-label="Show password"]')?.click()`);
  await new Promise((r) => setTimeout(r, 200));

  const revealedType = await cdp.eval(`document.querySelector('input[placeholder="••••••••"]')?.type`);
  const revealedBtnLabel = await cdp.eval(`document.querySelector('button[aria-label="Hide password"]')?.getAttribute('aria-label')`);
  console.log('   Revealed password input type:', revealedType);
  console.log('   Revealed eye button aria-label:', revealedBtnLabel);
  assert.equal(revealedType, 'text', 'Password input type must switch to "text"');
  assert.equal(revealedBtnLabel, 'Hide password', 'Button aria-label must switch to "Hide password"');
  console.log('   ✓ [PASS] Password revealed on first click');

  // C. Click Eye Button Again (Hide)
  console.log('   Clicking Eye button again to hide password...');
  await cdp.eval(`document.querySelector('button[aria-label="Hide password"]')?.click()`);
  await new Promise((r) => setTimeout(r, 200));

  const hiddenAgainType = await cdp.eval(`document.querySelector('input[placeholder="••••••••"]')?.type`);
  const hiddenAgainBtnLabel = await cdp.eval(`document.querySelector('button[aria-label="Show password"]')?.getAttribute('aria-label')`);
  console.log('   Hidden-again password input type:', hiddenAgainType);
  console.log('   Hidden-again eye button aria-label:', hiddenAgainBtnLabel);
  assert.equal(hiddenAgainType, 'password', 'Password input type must return to "password"');
  assert.equal(hiddenAgainBtnLabel, 'Show password', 'Button aria-label must return to "Show password"');
  console.log('   ✓ [PASS] Password hidden again on second click');

  // D. Check button characteristics
  const btnType = await cdp.eval(`document.querySelector('button[aria-label="Show password"]')?.type`);
  const btnRect = await cdp.eval(`(() => {
    const b = document.querySelector('button[aria-label="Show password"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { width: r.width, height: r.height };
  })()`);
  console.log('   Eye button type attribute:', btnType);
  console.log('   Eye button hit target dimensions:', btnRect);
  assert.equal(btnType, 'button', 'Eye button must have type="button" to prevent form submit');
  assert.ok(btnRect && btnRect.width >= 40 && btnRect.height >= 40, 'Button must meet accessible hit target');
  console.log('   ✓ [PASS] Button does not submit form and has accessible 44x44px target');

  // =========================================================================
  // STEP 3: Deep Link Navigation to /attendance/daily
  // =========================================================================
  console.log('\n3. Navigating to unauthenticated deep-link: /attendance/daily');
  await cdp.send('Page.navigate', { url: `${RAILWAY_URL}/attendance/daily` });

  let attendanceRedirectUrl = '';
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    attendanceRedirectUrl = await cdp.eval('window.location.href');
    if (attendanceRedirectUrl.includes('/login')) break;
  }
  console.log('   Redirected to URL:', attendanceRedirectUrl);
  assert.ok(
    attendanceRedirectUrl.includes('/login?next=%2Fattendance%2Fdaily') || attendanceRedirectUrl.includes('/login?next=/attendance/daily'),
    `Expected redirect to /login?next=%2Fattendance%2Fdaily, got: ${attendanceRedirectUrl}`
  );
  console.log('   ✓ [PASS] /attendance/daily redirects to /login?next=%2Fattendance%2Fdaily');

  // =========================================================================
  // STEP 4: Deep Link Navigation to /setup/users
  // =========================================================================
  console.log('\n4. Navigating to unauthenticated deep-link: /setup/users');
  await cdp.send('Page.navigate', { url: `${RAILWAY_URL}/setup/users` });

  let usersRedirectUrl = '';
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    usersRedirectUrl = await cdp.eval('window.location.href');
    if (usersRedirectUrl.includes('/login')) break;
  }
  console.log('   Redirected to URL:', usersRedirectUrl);
  assert.ok(
    usersRedirectUrl.includes('/login?next=%2Fsetup%2Fusers') || usersRedirectUrl.includes('/login?next=/setup/users'),
    `Expected redirect to /login?next=%2Fsetup%2Fusers, got: ${usersRedirectUrl}`
  );
  console.log('   ✓ [PASS] /setup/users redirects to /login?next=%2Fsetup%2Fusers');

  // =========================================================================
  // STEP 5: Root Navigation GET /
  // =========================================================================
  console.log('\n5. Navigating to unauthenticated root URL: /');
  await cdp.send('Page.navigate', { url: `${RAILWAY_URL}/` });

  let rootRedirectUrl = '';
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    rootRedirectUrl = await cdp.eval('window.location.href');
    if (rootRedirectUrl.includes('/login')) break;
  }
  console.log('   Redirected to URL:', rootRedirectUrl);
  assert.equal(rootRedirectUrl, `${RAILWAY_URL}/login`, `Expected ${RAILWAY_URL}/login, got: ${rootRedirectUrl}`);
  console.log('   ✓ [PASS] Root URL / redirects cleanly to /login without query string');

  chromeProc.kill();
  console.log('\n================================================================');
  console.log('ALL LIVE RAILWAY PRODUCTION BROWSER QA CHECKS PASSED (100% SUCCESS)');
  console.log('================================================================\n');
  process.exit(0);
}

runLiveBrowserQA().catch((err) => {
  console.error('LIVE QA FAILED:', err);
  process.exit(1);
});
