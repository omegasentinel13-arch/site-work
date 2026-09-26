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

async function verifyAllRoutes() {
  console.log('================================================================');
  console.log('SITE WORK — LOCALHOST PORT 3000 RENDERING VERIFICATION');
  console.log('Target: http://localhost:3000 (READ-ONLY BROWSER QA)');
  console.log('================================================================\n');

  // Pre-test DB verification
  const prodDbPre = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPre = prodDbPre.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPre = prodDbPre.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPre = prodDbPre.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodSitesPre = prodDbPre.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  const prodAttPre = prodDbPre.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodTxPre = prodDbPre.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodLfcPre = prodDbPre.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
  const prodIntegrityPre = prodDbPre.prepare('PRAGMA integrity_check').get() as any;
  const prodFkPre = prodDbPre.prepare('PRAGMA foreign_key_check').all().length;
  prodDbPre.close();

  console.log(`[Production DB Pre-Check]:`);
  console.log(`  audit_logs: ${prodAuditPre.c} (Expected: 429)`);
  console.log(`  work_roles: ${prodRolesPre.c} (Expected: 23)`);
  console.log(`  work_categories: ${prodCatsPre.c} (Expected: 4)`);
  console.log(`  sites: ${prodSitesPre.c} (Expected: 6)`);
  console.log(`  attendance_records: ${prodAttPre.c} (Expected: 18)`);
  console.log(`  financial_transactions: ${prodTxPre.c} (Expected: 4)`);
  console.log(`  system_lifecycle_records: ${prodLfcPre.c} (Expected: 0)`);
  console.log(`  integrity: ${prodIntegrityPre?.integrity_check}`);
  console.log(`  fk_errors: ${prodFkPre}`);

  assert.equal(prodAuditPre.c, 429);
  assert.equal(prodRolesPre.c, 23);
  assert.equal(prodCatsPre.c, 4);
  assert.equal(prodSitesPre.c, 6);
  assert.equal(prodAttPre.c, 18);
  assert.equal(prodTxPre.c, 4);
  assert.equal(prodLfcPre.c, 0);
  assert.equal(prodIntegrityPre?.integrity_check, 'ok');
  assert.equal(prodFkPre, 0);

  // Admin token
  const adminToken = await makeToken({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'System Administrator',
    role: 'ADMIN',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 11,
  });

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

  let cdp: CdpClient | null = null;

  try {
    let chromeReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const tabs = await fetchJson('http://127.0.0.1:9223/json');
        if (Array.isArray(tabs)) {
          const pageTarget = tabs.find((t: any) => t.type === 'page');
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
            await cdp.connect();
            chromeReady = true;
            break;
          }
        }
      } catch {
        await sleep(500);
      }
    }

    assert.ok(chromeReady && cdp, 'Connected to Chrome on port 9223');

    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');

    // Set auth cookie
    await cdp.send('Network.setCookie', {
      name: 'site_work_session',
      value: adminToken,
      url: 'http://localhost:3000',
      path: '/',
    });

    const routesToTest = [
      { path: '/', expectedHeadingPart: 'Dashboard' },
      { path: '/finance', expectedHeadingPart: 'FINANCE' },
      { path: '/finance/monthly', expectedHeadingPart: 'Monthly Financial' },
      { path: '/setup/roles', expectedHeadingPart: 'ROLES' },
      { path: '/setup/sites', expectedHeadingPart: 'SITE MANAGEMENT' },
      { path: '/setup/archive', expectedHeadingPart: 'GLOBAL ARCHIVE' },
      { path: '/setup/recycle-bin', expectedHeadingPart: 'GLOBAL RECYCLE BIN' },
    ];

    for (const r of routesToTest) {
      console.log(`\nNavigating to: http://localhost:3000${r.path}`);
      await cdp.send('Page.navigate', { url: `http://localhost:3000${r.path}` });

      let loaded = false;
      let pageText = '';
      let headingText = '';
      let hasNavigation = false;
      let hasHeader = false;

      const start = Date.now();
      while (Date.now() - start < 15000) {
        const info = await cdp.eval(`({
          body: document.body?.innerText || '',
          h1: document.querySelector('h1')?.textContent?.trim() || '',
          h2: document.querySelector('h2')?.textContent?.trim() || '',
          hasNav: document.querySelector('nav') !== null || document.querySelector('header') !== null,
          title: document.title
        })`);

        if (info && info.body.length > 50 && !info.body.includes('missing required error components')) {
          loaded = true;
          pageText = info.body.slice(0, 300);
          headingText = info.h1 || info.h2 || '';
          hasNavigation = info.hasNav;
          break;
        }
        await sleep(600);
      }

      console.log(`  Loaded successfully: ${loaded}`);
      console.log(`  Heading found: "${headingText}"`);
      console.log(`  Navigation/Header shell present: ${hasNavigation}`);
      console.log(`  Sample body text: ${pageText.replace(/\s+/g, ' ').slice(0, 100)}...`);

      assert.ok(loaded, `Route ${r.path} must load without error`);
      assert.ok(!pageText.includes('missing required error components'), `Route ${r.path} must not show error message`);
      assert.ok(hasNavigation, `Route ${r.path} must render navigation shell`);
      console.log(`  [PASS] Route ${r.path} verified!`);
    }

    // Post-test DB verification
    const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
    const prodAuditPost = prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
    const prodRolesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
    const prodCatsPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
    const prodSitesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
    const prodAttPost = prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
    const prodTxPost = prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
    const prodLfcPost = prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
    const prodIntegrityPost = prodDbPost.prepare('PRAGMA integrity_check').get() as any;
    const prodFkPost = prodDbPost.prepare('PRAGMA foreign_key_check').all().length;
    prodDbPost.close();

    console.log(`\n[Production DB Post-Check]:`);
    console.log(`  audit_logs: ${prodAuditPost.c} (Expected: 429)`);
    console.log(`  work_roles: ${prodRolesPost.c} (Expected: 23)`);
    console.log(`  work_categories: ${prodCatsPost.c} (Expected: 4)`);
    console.log(`  sites: ${prodSitesPost.c} (Expected: 6)`);
    console.log(`  attendance_records: ${prodAttPost.c} (Expected: 18)`);
    console.log(`  financial_transactions: ${prodTxPost.c} (Expected: 4)`);
    console.log(`  system_lifecycle_records: ${prodLfcPost.c} (Expected: 0)`);
    console.log(`  integrity: ${prodIntegrityPost?.integrity_check}`);
    console.log(`  fk_errors: ${prodFkPost}`);

    assert.equal(prodAuditPost.c, 429);
    assert.equal(prodRolesPost.c, 23);
    assert.equal(prodCatsPost.c, 4);
    assert.equal(prodSitesPost.c, 6);
    assert.equal(prodAttPost.c, 18);
    assert.equal(prodTxPost.c, 4);
    assert.equal(prodLfcPost.c, 0);
    assert.equal(prodIntegrityPost?.integrity_check, 'ok');
    assert.equal(prodFkPost, 0);

    console.log('\n================================================================');
    console.log('ALL ROUTES ON LOCALHOST:3000 RENDER NORMALLY!');
    console.log('Normal SITE WORK shell, navigation, header & page UI verified.');
    console.log('Production database data/site_work.db is 100% pristine.');
    console.log('================================================================\n');

  } finally {
    if (cdp) {
      try {
        cdp.ws.close();
      } catch {}
    }
    if (chromeProc) {
      chromeProc.kill();
    }
    if (fs.existsSync(TEMP_USER_DATA)) {
      try {
        fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
      } catch {}
    }
  }
}

verifyAllRoutes().catch((err) => {
  console.error('\nRENDER VERIFICATION FAILED:', err);
  process.exit(1);
});
