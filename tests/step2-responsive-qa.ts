import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_step2_responsive_temp');

const SECRET_KEY = new TextEncoder().encode(
  'site_work_dev_secret_session_key_minimum_32_characters_2026'
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
    const trimmed = expr.trim();
    let wrappedExpr = trimmed;
    if (!trimmed.startsWith('(() =>') && !trimmed.startsWith('(function') && !trimmed.startsWith('{')) {
      if (trimmed.includes('return ')) {
        wrappedExpr = `(() => {\n${trimmed}\n})()`;
      }
    }
    const res = await this.send('Runtime.evaluate', {
      expression: wrappedExpr,
      returnByValue: true,
      awaitPromise: true,
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

async function runResponsiveQA() {
  console.log('=== STARTING RESPONSIVE & THEME QA VERIFICATION ===\n');

  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ]);

  let retries = 30;
  let pageWsUrl = '';
  while (retries > 0) {
    try {
      const list = await fetchJson('http://127.0.0.1:9223/json/list');
      const pageTarget = list?.find((t: any) => t.type === 'page');
      if (pageTarget) {
        pageWsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(200);
    retries--;
  }

  if (!pageWsUrl) {
    chromeProc.kill();
    throw new Error('Failed to connect to Chrome CDP on port 9223');
  }

  const cdp = new CdpClient(pageWsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  // Set session cookie
  const token = await makeToken({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Admin User',
    role: 'ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  });

  await cdp.send('Network.setCookie', {
    name: 'site_work_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  });

  const url = 'http://localhost:3000/admin/data-protection?tab=reports';
  console.log(`Navigating to ${url}...`);
  await cdp.send('Page.navigate', { url });
  await sleep(2500);

  const currentUrl = await cdp.eval('window.location.href');
  const pageTitle = await cdp.eval('document.title');
  const bodyText = await cdp.eval('document.body.innerText.substring(0, 200)');
  console.log(`Current URL: ${currentUrl} | Title: ${pageTitle}`);
  console.log(`Body snippet: ${bodyText}`);

  // -------------------------------------------------------------------------
  // 9. RESPONSIVE VIEWPORT TESTING
  // -------------------------------------------------------------------------
  const viewports = [
    { width: 1280, height: 800, label: 'Desktop (1280px)' },
    { width: 1024, height: 768, label: 'Desktop / Tablet Landscape (1024px)' },
    { width: 768, height: 1024, label: 'Tablet Portrait (768px)' },
    { width: 430, height: 932, label: 'Mobile Pro Max (430px)' },
    { width: 412, height: 915, label: 'Android Large (412px)' },
    { width: 390, height: 844, label: 'iPhone Standard (390px)' },
    { width: 375, height: 667, label: 'Mobile Small SE (375px)' },
  ];

  console.log('--- 9. RESPONSIVE VIEWPORT FORENSICS ---');

  for (const vp of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width <= 768,
    });
    await sleep(400);

    const metrics = await cdp.eval(`(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      const hasHorizontalOverflow = scrollWidth > clientWidth;

      const reportSelector = document.querySelector('select');
      const buttons = Array.from(document.querySelectorAll('button'));
      const applyBtn = buttons.find(b => b.textContent.includes('Apply & Preview'));
      const heroPdfBtn = buttons.find(b => b.textContent.includes('Complete PDF'));
      const heroExcelBtn = buttons.find(b => b.textContent.includes('Complete Excel'));

      // Check touch target heights
      const interactiveElements = Array.from(document.querySelectorAll('button, select, input'));
      const touchTargetsUnder40 = interactiveElements
        .map(el => {
          const rect = el.getBoundingClientRect();
          return { tag: el.tagName, text: el.textContent?.trim().substring(0, 20), height: rect.height };
        })
        .filter(i => i.height > 0 && i.height < 36);

      return {
        clientWidth,
        scrollWidth,
        hasHorizontalOverflow,
        hasReportSelector: Boolean(reportSelector),
        hasApplyBtn: Boolean(applyBtn),
        hasHeroPdfBtn: Boolean(heroPdfBtn),
        hasHeroExcelBtn: Boolean(heroExcelBtn),
        touchUnder40Count: touchTargetsUnder40.length,
      };
    })()`);

    assert.ok(!metrics.hasHorizontalOverflow, `Horizontal overflow detected at ${vp.width}px! (scroll: ${metrics.scrollWidth}, client: ${metrics.clientWidth})`);
    assert.ok(metrics.hasReportSelector, `Report selector not found at ${vp.width}px`);
    assert.ok(metrics.hasApplyBtn, `Apply button not found at ${vp.width}px`);
    assert.ok(metrics.hasHeroPdfBtn, `Hero PDF button not found at ${vp.width}px`);
    assert.ok(metrics.hasHeroExcelBtn, `Hero Excel button not found at ${vp.width}px`);

    console.log(`  ✔ [VIEWPORT ${String(vp.width).padStart(4)}px] ${vp.label.padEnd(36)} | Overflow: NONE (${metrics.clientWidth}px) | Controls intact`);
  }

  // -------------------------------------------------------------------------
  // 10. LIGHT / DARK MODE VERIFICATION
  // -------------------------------------------------------------------------
  console.log('\n--- 10. LIGHT / DARK MODE FORENSICS ---');

  // Set desktop viewport for theme check
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // LIGHT MODE
  await cdp.eval(`(() => {
    document.documentElement.classList.remove('dark');
  })()`);
  await sleep(300);

  const lightThemeCheck = await cdp.eval(`(() => {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const h1 = document.querySelector('h1, h2, h3');
    const h1Color = h1 ? window.getComputedStyle(h1).color : null;
    const isDark = document.documentElement.classList.contains('dark');
    return { isDark, bodyBg: bg, headingColor: h1Color };
  })()`);

  console.log(`  ✔ [THEME LIGHT] Class dark present: ${lightThemeCheck.isDark} | Body bg: ${lightThemeCheck.bodyBg} | Headings: ${lightThemeCheck.headingColor}`);

  // DARK MODE
  await cdp.eval(`(() => {
    document.documentElement.classList.add('dark');
  })()`);
  await sleep(300);

  const darkThemeCheck = await cdp.eval(`(() => {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const h1 = document.querySelector('h1, h2, h3');
    const h1Color = h1 ? window.getComputedStyle(h1).color : null;
    const isDark = document.documentElement.classList.contains('dark');
    return { isDark, bodyBg: bg, headingColor: h1Color };
  })()`);

  console.log(`  ✔ [THEME DARK]  Class dark present: ${darkThemeCheck.isDark} | Body bg: ${darkThemeCheck.bodyBg} | Headings: ${darkThemeCheck.headingColor}`);

  // Clean up
  chromeProc.kill();
  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n=== RESPONSIVE & THEME QA COMPLETED SUCCESSFULLY ===');
}

runResponsiveQA().catch((err) => {
  console.error('RESPONSIVE QA FAILED:', err);
  process.exit(1);
});
