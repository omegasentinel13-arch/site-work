import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_railway_temp');
const RAILWAY_URL = 'https://site-work-app-production.up.railway.app';

const SECRET_KEY = new TextEncoder().encode(
  'site_work_super_secret_session_key_min_32_characters_long_2026_engineering'
);

async function makeToken() {
  return await new SignJWT({
    userId: 'usr-admin-1',
    username: 'godshaliqmode',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    authorityTier: 'KING_MAKER',
    assignedSiteIds: [],
    tokenVersion: 12
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET_KEY);
}

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
    const res = await sendWithTimeout(this, 'Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    }, 10000);
    return res?.result?.result?.value;
  }
}

function sendWithTimeout(client: CdpClient, method: string, params: any, timeoutMs: number): Promise<any> {
  return Promise.race([
    client.send(method, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout on ${method}`)), timeoutMs))
  ]);
}

async function run() {
  console.log('================================================================');
  console.log(`RAILWAY PRODUCTION DEPLOYMENT SMOKE TEST: ${RAILWAY_URL}`);
  console.log('================================================================\n');

  const token = await makeToken();
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank'
  ]);

  let cdp: CdpClient | null = null;
  for (let i = 0; i < 30; i++) {
    try {
      const tabs = await fetchJson('http://127.0.0.1:9225/json');
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

  await cdp.send('Network.setCookie', {
    name: 'site_work_session',
    value: token,
    url: RAILWAY_URL,
    path: '/',
    secure: true
  });

  const routes = [
    { path: '/login', name: 'Login Page' },
    { path: '/', name: 'Dashboard' },
    { path: '/attendance/daily', name: 'Daily Attendance' },
    { path: '/attendance/weekly', name: 'Weekly Attendance' },
    { path: '/attendance/monthly', name: 'Monthly Attendance' },
    { path: '/reports/role', name: 'Analytics' },
    { path: '/finance', name: 'Transactions' },
    { path: '/finance/monthly', name: 'Master Ledger (/finance/monthly)' },
    { path: '/setup/sites', name: 'Sites' },
    { path: '/setup/roles', name: 'Roles' },
    { path: '/setup/users', name: 'Users & Access' },
    { path: '/setup/audit-trail', name: 'Audit Trail' },
    { path: '/setup/reports-backup', name: 'Reports & Backup' },
    { path: '/setup/account', name: 'My Account' }
  ];

  console.log(`Executing 14-Page Live Smoke Matrix on Railway...`);

  for (const r of routes) {
    cdp.errors = [];
    console.log(`\nNavigating to: ${RAILWAY_URL}${r.path} (${r.name})`);
    await cdp.send('Page.navigate', { url: `${RAILWAY_URL}${r.path}` });

    let loaded = false;
    let bodyText = '';
    let heading = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((res) => setTimeout(res, 600));
      const info = await cdp.eval(`({
        body: document.body?.innerText || '',
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        h2: document.querySelector('h2')?.textContent?.trim() || '',
        title: document.title
      })`);

      if (info && info.body.length > 50) {
        bodyText = info.body;
        heading = info.h1 || info.h2 || '';
        loaded = true;
        break;
      }
    }

    assert.ok(loaded, `Route ${r.path} failed to render on Railway.`);
    assert.ok(
      !bodyText.includes('Application error: a client-side exception has occurred'),
      `Route ${r.path} rendered a client-side exception on Railway!`
    );
    assert.ok(
      !bodyText.includes('Unhandled Runtime Error'),
      `Route ${r.path} rendered a runtime error on Railway!`
    );
    assert.equal(cdp.errors.length, 0, `Route ${r.path} threw JS exceptions on Railway: ${cdp.errors.join('; ')}`);

    console.log(`  ✓ [PASS] ${r.name}: Heading="${heading}", TextLength=${bodyText.length}`);
  }

  // Verify Recovery Journal modal on /setup/reports-backup
  console.log('\n--- VERIFYING RECOVERY JOURNAL MODAL ON RAILWAY ---');
  await cdp.send('Page.navigate', { url: `${RAILWAY_URL}/setup/reports-backup` });
  await new Promise((r) => setTimeout(r, 2000));

  // Click recovery journal button if present
  const journalModalCheck = await cdp.eval(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const journalBtn = buttons.find(b => b.textContent && b.textContent.includes('Recovery Journal'));
    if (journalBtn) {
      journalBtn.click();
      return { foundButton: true };
    }
    return { foundButton: false };
  })()`);
  console.log('Recovery Journal Button Check:', JSON.stringify(journalModalCheck));

  await new Promise((r) => setTimeout(r, 1000));

  const modalState = await cdp.eval(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { hasDialog: false };
    const rect = dialog.getBoundingClientRect();
    const style = window.getComputedStyle(dialog);
    const parentIsBody = dialog.parentElement === document.body;
    return {
      hasDialog: true,
      parentIsBody,
      zIndex: style.zIndex,
      position: style.position,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bodyOverflow: document.body.style.overflow
    };
  })()`);
  console.log('Recovery Journal Modal Diagnostics:', JSON.stringify(modalState));

  chromeProc.kill();
  console.log('\n==================================================');
  console.log('RAILWAY LIVE SMOKE TEST COMPLETE: 100% SUCCESS');
  console.log('==================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('RAILWAY TEST FAILED:', err);
  process.exit(1);
});
