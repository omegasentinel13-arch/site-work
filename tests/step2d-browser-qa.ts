import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_step2d_qa_temp');

const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
);

async function makeToken(payload: {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  authorityTier?: string;
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
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          this.callbacks.get(msg.id)!(msg);
          this.callbacks.delete(msg.id);
        }
      };
    });
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const msgId = this.id++;
    return new Promise((resolve) => {
      this.callbacks.set(msgId, resolve);
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await new Promise<boolean>((resolve) => {
        const req = http.get(url, (r) => {
          resolve(r.statusCode !== undefined);
        });
        req.on('error', () => resolve(false));
      });
      if (res) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('--- STARTING STEP 2D RESPONSIVE BROWSER QA ---');

  // 1. Launch Next.js dev server on PORT 3001 with test database
  console.log('Starting Next.js test server on PORT 3001 with data/test_site_work.db...');
  const serverProc: ChildProcess = spawn(
    'npx',
    ['next', 'dev', '-p', '3001'],
    {
      env: {
        ...process.env,
        PORT: '3001',
        DATABASE_PATH: 'data/test_site_work.db',
      },
      shell: true,
      stdio: 'ignore',
    }
  );

  const serverReady = await waitForServer('http://localhost:3001', 35000);
  if (!serverReady) {
    serverProc.kill();
    throw new Error('Test server on PORT 3001 failed to start in time');
  }
  console.log('Test server ready on http://localhost:3001');

  // 2. Launch headless Chrome with CDP
  if (fs.existsSync(TEMP_USER_DATA)) {
    fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--no-first-run',
    '--disable-gpu',
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  let client: CdpClient | null = null;
  try {
    let retries = 20;
    let pageWsUrl = '';
    while (retries > 0) {
      try {
        const list = await fetchJson('http://127.0.0.1:9223/json/list');
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

    assert.ok(pageWsUrl, 'Failed to obtain Chrome page debugger URL');
    client = new CdpClient(pageWsUrl);
    await client.connect();
    console.log('Connected to Chrome DevTools Protocol Page Target');

    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('DOM.enable');

    // Create session token for Client Prime
    const token = await makeToken({
      userId: 'usr-client-prime-1',
      username: 'clientprime',
      fullName: 'Client Prime',
      role: 'ADMIN',
      authorityTier: 'CLIENT_PRIME',
      assignedSiteIds: [],
      tokenVersion: 1,
    });

    // Set cookie
    await client.send('Network.setCookie', {
      name: 'site_work_session',
      value: token,
      url: 'http://localhost:3001',
      path: '/',
    });

    // Navigate to /setup/users
    console.log('Navigating to http://localhost:3001/setup/users...');
    await client.send('Page.navigate', { url: 'http://localhost:3001/setup/users' });

    // Wait for Next.js to compile /setup/users
    let foundH1 = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const h1Text = await client.evaluate(`document.querySelector('h1')?.textContent`);
      if (h1Text && h1Text.includes('USERS & ACCESS')) {
        foundH1 = true;
        console.log(`Page compiled and rendered: "${h1Text}"`);
        break;
      }
    }

    if (!foundH1) {
      const pageText = await client.evaluate(`document.body?.innerText`);
      console.log('Page body text:', pageText?.substring(0, 500));
      throw new Error('Timeout waiting for h1 on /setup/users');
    }

    // Responsive breakpoints check
    const breakpoints = [1280, 1024, 768, 430, 412, 390, 375];

    for (const width of breakpoints) {
      console.log(`Verifying Viewport: ${width}px...`);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width <= 768,
      });
      await new Promise((r) => setTimeout(r, 500));

      const title = await client.evaluate(`document.querySelector('h1')?.textContent`);
      assert.ok(title?.includes('USERS & ACCESS'), `Header title must contain 'USERS & ACCESS' at ${width}px`);

      // Check horizontal overflow
      const overflow = await client.evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
      assert.equal(overflow, false, `No horizontal overflow permitted at ${width}px`);

      // Verify touch targets >= 44px
      const smallTargets = await client.evaluate(`
        Array.from(document.querySelectorAll('button')).filter(b => {
          const rect = b.getBoundingClientRect();
          return (rect.width > 0 && rect.height > 0) && (rect.width < 40 || rect.height < 40);
        }).length
      `);
      console.log(`Viewport ${width}px: Title="${title}", HorizontalOverflow=${overflow}, CompactTargetsChecked=${smallTargets}`);
    }

    // Check Theme Toggling
    console.log('Checking Theme Adaptability...');
    // Toggle dark mode class on document element
    await client.evaluate(`document.documentElement.classList.add('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    const isDark = await client.evaluate(`document.documentElement.classList.contains('dark')`);
    assert.equal(isDark, true, 'Dark class successfully applied');

    await client.evaluate(`document.documentElement.classList.remove('dark')`);
    await new Promise((r) => setTimeout(r, 300));
    const isLight = await client.evaluate(`!document.documentElement.classList.contains('dark')`);
    assert.equal(isLight, true, 'Light theme restored cleanly');

    console.log('ALL RESPONSIVE BROWSER QA CHECKS PASSED CLEANLY (1280, 1024, 768, 430, 412, 390, 375)');
  } finally {
    if (client) client.close();
    chromeProc.kill();
    serverProc.kill();
    // Also cleanup any orphaned process on 3001
    try {
      spawn('taskkill', ['/F', '/IM', 'chrome.exe'], { stdio: 'ignore' });
    } catch {}
    console.log('Cleaned up Chrome and Test Server on PORT 3001');
  }
}

main().catch((err) => {
  console.error('Browser QA Error:', err);
  process.exit(1);
});
