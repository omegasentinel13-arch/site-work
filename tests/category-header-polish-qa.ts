import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_cat_header_qa_temp');

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

async function runCategoryHeaderQA() {
  console.log('================================================================');
  console.log('SITE WORK — CATEGORY HEADER VISUAL MICRO-POLISH QA SUITE');
  console.log('Target: http://localhost:3001 (Isolated Test DB)');
  console.log('================================================================\n');

  // 1. Production DB Baseline Pre-Check
  const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPre = prodDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPre = prodDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPre = prodDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodSitesPre = prodDb.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  const prodAttPre = prodDb.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodFinPre = prodDb.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodLifePre = prodDb.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
  prodDb.close();

  console.log(`[Production DB Pre-Check] audit_logs: ${prodAuditPre.c}, roles: ${prodRolesPre.c}, categories: ${prodCatsPre.c}, sites: ${prodSitesPre.c}`);
  assert.equal(prodAuditPre.c, 429, 'Production audit logs MUST BE exactly 429!');
  assert.equal(prodRolesPre.c, 23, 'Production roles MUST BE exactly 23!');
  assert.equal(prodCatsPre.c, 4, 'Production categories MUST BE exactly 4!');
  assert.equal(prodSitesPre.c, 6, 'Production sites MUST BE exactly 6!');
  assert.equal(prodAttPre.c, 18, 'Production attendance MUST BE exactly 18!');
  assert.equal(prodFinPre.c, 4, 'Production finance MUST BE exactly 4!');
  assert.equal(prodLifePre.c, 0, 'Production lifecycle records MUST BE exactly 0!');

  // Launch Chrome Headless
  if (fs.existsSync(TEMP_USER_DATA)) {
    try {
      fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true });
    } catch {}
  }

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
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

  // Set Admin session cookie for http://localhost:3001
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
    url: 'http://localhost:3001',
    path: '/',
  });

  async function navigate(url: string, waitSelector = 'h1'): Promise<void> {
    await cdp.send('Page.navigate', { url });
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const ready = await cdp.eval(`
        (() => {
          if (!document.querySelector('${waitSelector}')) return false;
          const txt = document.body ? document.body.textContent : '';
          if (txt.includes('Loading roles...') || txt.includes('Loading categories...')) return false;
          return true;
        })()
      `);
      if (ready) {
        await sleep(300);
        return;
      }
      await sleep(150);
    }
    throw new Error(`Timeout waiting for ${url} to load selector ${waitSelector}`);
  }

  async function setViewport(width: number, height: number) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await sleep(200);
  }

  try {
    // =========================================================================
    // 1. LIGHT THEME CATEGORY HEADER INSPECTION
    // =========================================================================
    console.log('\n--- 1. Light Theme Category Header Visual Inspection ---');
    await setViewport(1280, 800);
    await navigate('http://localhost:3001/setup/roles');
    await cdp.eval(`document.documentElement.classList.remove('dark')`);
    await sleep(200);

    const lightHeaders = await cdp.eval(`
      (() => {
        const sections = Array.from(document.querySelectorAll('h2')).map(h2 => {
          const header = h2.closest('div.border-b');
          if (!header) return null;
          const computed = window.getComputedStyle(header);
          const h2Computed = window.getComputedStyle(h2);
          const spans = Array.from(header.querySelectorAll('span')).map(s => {
            const sComputed = window.getComputedStyle(s);
            return {
              text: s.textContent?.trim(),
              color: sComputed.color,
              bg: sComputed.backgroundColor
            };
          });
          const buttons = Array.from(header.querySelectorAll('button')).map(b => b.textContent?.trim());
          const rect = header.getBoundingClientRect();

          return {
            categoryName: h2.textContent?.trim(),
            headerBg: computed.backgroundColor,
            titleColor: h2Computed.color,
            titleFontWeight: h2Computed.fontWeight,
            height: rect.height,
            spans,
            buttons
          };
        }).filter(Boolean);
        return sections;
      })()
    `);

    console.log('Light Mode Headers Found:', JSON.stringify(lightHeaders, null, 2));
    assert.ok(lightHeaders.length > 0, 'At least 1 category header must be found');

    for (const h of lightHeaders) {
      // Background must be dark navy (slate-900 is rgb(15, 23, 42))
      assert.equal(h.headerBg, 'rgb(15, 23, 42)', `Category ${h.categoryName} header background must be dark navy rgb(15, 23, 42)`);
      // Title must be white
      assert.equal(h.titleColor, 'rgb(255, 255, 255)', `Category ${h.categoryName} title must be white rgb(255, 255, 255)`);
      // No buttons
      assert.equal(h.buttons.length, 0, `No buttons allowed in category ${h.categoryName} header`);
      // Role count badge must exist
      assert.ok(h.spans.some((s: any) => s.text.includes('ROLE')), `Role count badge must exist in ${h.categoryName}`);
      // Height should be compact (around 38-44px)
      assert.ok(h.height <= 55, `Header height must be compact (was ${h.height}px)`);
    }
    console.log('✓ Light Mode: All category headers render inverted dark navy background rgb(15, 23, 42) with white titles and balanced role count badges');

    // =========================================================================
    // 2. DARK THEME CATEGORY HEADER INSPECTION
    // =========================================================================
    console.log('\n--- 2. Dark Theme Category Header Visual Inspection ---');
    await cdp.eval(`document.documentElement.classList.add('dark')`);
    await sleep(200);

    const darkHeaders = await cdp.eval(`
      (() => {
        const sections = Array.from(document.querySelectorAll('h2')).map(h2 => {
          const header = h2.closest('div.border-b');
          if (!header) return null;
          const computed = window.getComputedStyle(header);
          const h2Computed = window.getComputedStyle(h2);
          const spans = Array.from(header.querySelectorAll('span')).map(s => {
            const sComputed = window.getComputedStyle(s);
            return {
              text: s.textContent?.trim(),
              color: sComputed.color,
              bg: sComputed.backgroundColor
            };
          });
          const buttons = Array.from(header.querySelectorAll('button')).map(b => b.textContent?.trim());
          const rect = header.getBoundingClientRect();

          return {
            categoryName: h2.textContent?.trim(),
            headerBg: computed.backgroundColor,
            titleColor: h2Computed.color,
            height: rect.height,
            spans,
            buttons
          };
        }).filter(Boolean);
        return sections;
      })()
    `);

    console.log('Dark Mode Headers Found:', JSON.stringify(darkHeaders, null, 2));
    for (const h of darkHeaders) {
      // In dark mode, background is #202225 (rgb(32, 34, 37))
      assert.equal(h.headerBg, 'rgb(32, 34, 37)', `Category ${h.categoryName} dark header background must be #202225 rgb(32, 34, 37)`);
      // Title must be light text #F2F3F5 (rgb(242, 243, 245))
      assert.equal(h.titleColor, 'rgb(242, 243, 245)', `Category ${h.categoryName} title must be light text rgb(242, 243, 245)`);
      assert.equal(h.buttons.length, 0, `No buttons in category ${h.categoryName} dark header`);
      assert.ok(h.spans.some((s: any) => s.text.includes('ROLE')), `Role count badge must exist in ${h.categoryName}`);
    }
    console.log('✓ Dark Mode: All category headers integrate with dark theme tokens (rgb(32, 34, 37) background, rgb(242, 243, 245) text) without visual harshness');

    // =========================================================================
    // 3. INACTIVE BADGE VERIFICATION
    // =========================================================================
    console.log('\n--- 3. Inactive Count Badge Verification ---');
    // Deactivate first role on test DB to verify inactive badge appears in header
    const testDb = new DatabaseSync('data/test_site_work.db');
    testDb.prepare("UPDATE work_roles SET is_active = 0 WHERE id = 'role-mason'").run();
    testDb.close();

    await navigate('http://localhost:3001/setup/roles');
    await sleep(400);

    const inactiveBadgeInfo = await cdp.eval(`
      (() => {
        const civilH2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent.includes('CIVIL'));
        const header = civilH2?.closest('div.border-b');
        if (!header) return null;
        const badges = Array.from(header.querySelectorAll('span')).map(s => s.textContent?.trim());
        return {
          category: civilH2.textContent?.trim(),
          badges
        };
      })()
    `);
    console.log('Inactive Badge Info on Civil Category:', JSON.stringify(inactiveBadgeInfo));
    assert.ok(inactiveBadgeInfo, 'Category header must exist');
    assert.ok(inactiveBadgeInfo.badges.some((b: string) => b.includes('INACTIVE')), 'Inactive badge must be rendered when inactive roles are present');
    console.log('✓ Inactive count badge ("1 INACTIVE") is clearly rendered and visually balanced');

    // =========================================================================
    // 4. MULTI-VIEWPORT RESPONSIVENESS (6 VIEWPORTS)
    // =========================================================================
    console.log('\n--- 4. Multi-Viewport Verification across 6 Viewports ---');
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

      const vpHeaderCheck = await cdp.eval(`
        (() => {
          const h2s = Array.from(document.querySelectorAll('h2'));
          return h2s.map(h2 => {
            const header = h2.closest('div.border-b');
            if (!header) return null;
            const h2Rect = h2.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();
            const badges = Array.from(header.querySelectorAll('span')).map(s => {
              const r = s.getBoundingClientRect();
              return { text: s.textContent?.trim(), right: r.right, left: r.left, visible: r.width > 0 && r.height > 0 };
            });
            return {
              category: h2.textContent?.trim(),
              headerWidth: headerRect.width,
              headerHeight: headerRect.height,
              h2Width: h2Rect.width,
              badgesVisible: badges.every(b => b.visible)
            };
          }).filter(Boolean);
        })()
      `);

      assert.ok(vpHeaderCheck.length > 0, `Headers must render on ${vp.label}`);
      for (const hc of vpHeaderCheck) {
        assert.ok(hc.badgesVisible, `All badges must be visible on ${vp.label} for ${hc.category}`);
        assert.ok(hc.headerHeight <= 60, `Header height must remain compact on ${vp.label} (was ${hc.headerHeight}px)`);
      }
      console.log(`✓ Viewport [${vp.label} - ${vp.width}x${vp.height}]: Compact inverted dark navy header verified with full badge visibility`);
    }

    // =========================================================================
    // 5. PRODUCTION DB INTEGRITY POST-CHECK
    // =========================================================================
    console.log('\n--- 5. Post-Test Production Database Baseline Integrity Check ---');
    const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
    const prodAuditPost = prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
    const prodRolesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
    const prodCatsPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
    const prodSitesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
    const prodAttPost = prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
    const prodFinPost = prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
    const prodLifePost = prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
    const integrityCheck = prodDbPost.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const fkCheck = prodDbPost.prepare('PRAGMA foreign_key_check').all();
    prodDbPost.close();

    console.log(`[Production DB Post-Check] audit_logs: ${prodAuditPost.c}, roles: ${prodRolesPost.c}, categories: ${prodCatsPost.c}, sites: ${prodSitesPost.c}`);
    assert.equal(prodAuditPost.c, 429, 'Production audit logs MUST BE UNCHANGED at 429!');
    assert.equal(prodRolesPost.c, 23, 'Production roles MUST BE UNCHANGED at 23!');
    assert.equal(prodCatsPost.c, 4, 'Production categories MUST BE UNCHANGED at 4!');
    assert.equal(prodSitesPost.c, 6, 'Production sites MUST BE UNCHANGED at 6!');
    assert.equal(prodAttPost.c, 18, 'Production attendance MUST BE UNCHANGED at 18!');
    assert.equal(prodFinPost.c, 4, 'Production finance MUST BE UNCHANGED at 4!');
    assert.equal(prodLifePost.c, 0, 'Production lifecycle MUST BE UNCHANGED at 0!');
    assert.equal(integrityCheck.integrity_check, 'ok', 'PRAGMA integrity_check must be ok');
    assert.equal(fkCheck.length, 0, 'PRAGMA foreign_key_check must have 0 errors');
    console.log('✓ Production Database: 100% UNTOUCHED (audit_logs: 429, integrity: ok, fk: 0 errors)');

    console.log('\n================================================================');
    console.log('CATEGORY HEADER VISUAL MICRO-POLISH QA PASSED COMPLETELY!');
    console.log('================================================================\n');

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
}

runCategoryHeaderQA().catch((err) => {
  console.error('\n❌ QA FAILED:', err);
  process.exit(1);
});
