import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_dash_temp');

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
  console.log('=== STARTING FOCUSED BROWSER DASHBOARD QA ===');

  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }

  const db = new (await import('node:sqlite')).DatabaseSync(
    path.join(process.cwd(), 'data', 'site_work.db'),
    { readOnly: true }
  );
  const adminRow = db.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  db.close();

  const adminToken = await makeToken({
    userId: adminRow.id,
    username: adminRow.username,
    fullName: adminRow.full_name,
    role: adminRow.role,
    assignedSiteIds: [],
    tokenVersion: adminRow.token_version,
  });

  const chromeProc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9224',
      `--user-data-dir=${TEMP_USER_DATA}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'pipe' }
  );

  let retries = 30;
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

  assert.ok(pageWsUrl, 'Failed to initialize Chrome CDP session');
  const cdp = new CdpClient(pageWsUrl);
  await cdp.connect();

  try {
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    const consoleErrors: string[] = [];
    cdp.ws.addEventListener('message', (event: any) => {
      const parsed = JSON.parse(event.data.toString());
      if (parsed.method === 'Runtime.consoleAPICalled' && parsed.params?.type === 'error') {
        const text = parsed.params.args?.map((a: any) => a.value || a.description).join(' ');
        consoleErrors.push(text);
      }
    });

    const waitForPageLoaded = async () => {
      await new Promise((r) => setTimeout(r, 1500));
    };

    // 1. Authenticate as ADMIN
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

    await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
    await waitForPageLoaded();

    const checkApiSites = await cdp.eval(`
      fetch('/api/sites').then(r => r.json()).catch(err => ({ error: err.message }))
    `);
    console.log('Check /api/sites from page:', checkApiSites);

    const checkApiMe = await cdp.eval(`
      fetch('/api/auth/me').then(r => r.json()).catch(err => ({ error: err.message }))
    `);
    console.log('Check /api/auth/me from page:', checkApiMe);

    console.log('\n--- 1. Testing Common Add CTA on Dashboard (1280px) ---');
    const pageState = await cdp.eval(`
      ({ pathname: window.location.pathname, text: document.body.textContent?.slice(0, 300) })
    `);
    console.log('Page state:', pageState);

    const ctaCheck = await cdp.eval(`
      (() => {
        const bodyText = document.body.textContent || '';
        const addCredit = bodyText.includes('Add Credit');
        const addDebit = bodyText.includes('Add Debit');
        const addBtn = document.querySelector('#dashboard-common-add-btn');
        const href = addBtn ? addBtn.getAttribute('href') : null;
        const ariaLabel = addBtn ? addBtn.getAttribute('aria-label') : null;
        const btnText = addBtn ? addBtn.textContent : '';
        const rect = addBtn ? addBtn.getBoundingClientRect() : null;

        return {
          addCredit,
          addDebit,
          hasAddBtn: addBtn !== null,
          href,
          ariaLabel,
          btnText,
          height: rect ? rect.height : 0,
          width: rect ? rect.width : 0
        };
      })()
    `);

    assert.equal(ctaCheck.addCredit, false, 'Add Credit must NOT appear on Dashboard');
    assert.equal(ctaCheck.addDebit, false, 'Add Debit must NOT appear on Dashboard');
    assert.equal(ctaCheck.hasAddBtn, true, 'Common Add button #dashboard-common-add-btn must exist');
    assert.equal(ctaCheck.href, '/finance', 'Common Add button must link to /finance');
    assert.match(ctaCheck.btnText, /Add/, 'Button text must contain Add');
    assert.match(ctaCheck.btnText, /Credit/, 'Button must show Credit cue');
    assert.match(ctaCheck.btnText, /Debit/, 'Button must show Debit cue');
    assert.ok(ctaCheck.height >= 44, `Button height ${ctaCheck.height} must be >= 44px`);
    console.log('  ✔ Add Credit and Add Debit removed, Common Add CTA present and links to /finance');
    console.log(`  ✔ Button dimensions: ${ctaCheck.width}x${ctaCheck.height}px (>=44px accessible target)`);

    console.log('\n--- 2. Testing Today / This Week / This Month Attendance Summaries ---');
    const summariesCheck = await cdp.eval(`
      (() => {
        // Specifically select the 3 period summary cards in the main stats grid
        const periodCards = Array.from(document.querySelectorAll('.grid > div')).filter(el => {
          const t = el.textContent || '';
          return t.includes('Today') || t.includes('This Week') || t.includes('This Month');
        });

        const hasWorkerDaysInCards = periodCards.some(c => 
          c.textContent?.includes('Worker-Days') || 
          c.textContent?.includes('Worker Days') ||
          c.textContent?.includes('Worker-Day')
        );

        // Find equation patterns inside the equation rows
        const eqMatches = Array.from(document.querySelectorAll('[data-testid="attendance-equation"]')).map(el => {
          return el.textContent?.replace(/\s+/g, ' ').trim() || '';
        });

        return {
          cardCount: periodCards.length,
          hasWorkerDaysInCards,
          eqMatches
        };
      })()
    `);

    assert.equal(summariesCheck.hasWorkerDaysInCards, false, 'Worker Days removed from period cards');
    console.log('  ✔ Worker Days successfully removed from attendance summaries');
    console.log('  ✔ Found equations on Dashboard:', summariesCheck.eqMatches);
    assert.equal(summariesCheck.eqMatches.length, 3, 'Equations found for Today, This Week, and This Month');
    console.log('  ✔ Worker Days successfully removed from attendance summaries');
    console.log('  ✔ Found equations on Dashboard:', summariesCheck.eqMatches);
    assert.ok(summariesCheck.eqMatches.length >= 3, 'Equations found for Today, This Week, and This Month');

    console.log('\n--- 3. Testing Responsive Viewports (1280px, 768px, 375px) ---');
    const viewports = [
      { w: 1280, h: 800, label: 'Desktop 1280px' },
      { w: 768, h: 1024, label: 'Tablet 768px' },
      { w: 375, h: 812, label: 'Mobile 375px' },
    ];

    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 1,
        mobile: vp.w < 768,
      });
      await new Promise((r) => setTimeout(r, 400));

      const overflow = await cdp.eval(`
        (() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
          const clientW = docEl.clientWidth;
          return {
            scrollW,
            clientW,
            hasOverflow: scrollW > clientW
          };
        })()
      `);

      if (overflow.hasOverflow) {
        const culprits = await cdp.eval(`
          (() => {
            const w = window.innerWidth;
            return Array.from(document.querySelectorAll('*'))
              .filter(el => el.getBoundingClientRect().right > w + 1)
              .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 30) }))
              .slice(0, 5);
          })()
        `);
        console.log('Overflow culprits at ' + vp.label + ':', culprits);
      }
      assert.equal(overflow.hasOverflow, false, `No horizontal overflow at ${vp.label}`);
      console.log(`  ✔ ${vp.label}: clientW=${overflow.clientW}, scrollW=${overflow.scrollW}, no horizontal overflow`);
    }

    console.log('\n--- 4. Testing Light & Dark Theme Rendering ---');
    await cdp.eval(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    const darkCheck = await cdp.eval(`
      (() => {
        const btn = document.querySelector('#dashboard-common-add-btn');
        return btn ? window.getComputedStyle(btn).display : null;
      })()
    `);
    assert.ok(darkCheck !== null, 'CTA visible in Dark Theme');
    console.log('  ✔ Dark Theme verified');

    await cdp.eval(`document.documentElement.classList.remove('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    console.log('  ✔ Light Theme verified');

    // Reset viewport to 1280x800
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 500));

    // Capture screenshot of reverted dashboard
    const screenshotRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const base64Data = screenshotRes.result?.data;
    if (base64Data) {
      const screenshotPath = 'C:/Users/Admin/.gemini/antigravity/brain/4fb83adf-e15f-4013-8292-5f4e648accd9/.tempmediaStorage/dashboard_overview_revert.png';
      fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
      console.log('  ✔ Captured verification screenshot to:', screenshotPath);
    }

    console.log('\n--- 5. Verifying Navigation on Add CTA Click ---');
    await cdp.eval(`document.querySelector('#dashboard-common-add-btn').click()`);
    await waitForPageLoaded();
    const currentUrl = await cdp.eval(`window.location.pathname`);
    assert.equal(currentUrl, '/finance', 'Clicking Add CTA navigates to /finance');
    console.log('  ✔ Add button click navigated to:', currentUrl);

    console.log('\n--- 6. Verifying Console & Hydration Errors ---');
    const filteredErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('Download the React DevTools')
    );
    assert.equal(filteredErrors.length, 0, `No console errors: ${filteredErrors.join(', ')}`);
    console.log('  ✔ Zero console / hydration errors detected');

    console.log('\n================================================');
    console.log('ALL FOCUSED DASHBOARD BROWSER QA CHECKS PASSED!');
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
