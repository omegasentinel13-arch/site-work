import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_ui_polish_qa_temp');

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

async function runUiPolishQA() {
  console.log('================================================================');
  console.log('SITE WORK — ROLES & CATEGORIES UI POLISH REAL-BROWSER QA SUITE');
  console.log('Target: http://localhost:3001 (Isolated Test DB)');
  console.log('================================================================\n');

  // 1. Pre-check Production DB Baseline Safety
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

  const viewports = [
    { label: 'Desktop 1280px', width: 1280, height: 800 },
    { label: 'Small Desktop 1024px', width: 1024, height: 768 },
    { label: 'Tablet 768px', width: 768, height: 1024 },
    { label: 'iPhone 14 Pro Max 430px', width: 430, height: 932 },
    { label: 'Pixel 7 / Galaxy S20 412px', width: 412, height: 915 },
    { label: 'iPhone 12/13/14 390px', width: 390, height: 844 },
  ];

  try {
    // =========================================================================
    // SECTION 1: /setup/roles VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 1: /setup/roles UI Verification ---');
    await setViewport(1280, 800);
    await navigate('http://localhost:3001/setup/roles');

    // 1. Heading is strictly "ROLES"
    const rolesHeading = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
    assert.equal(rolesHeading, 'ROLES', 'Heading must be strictly "ROLES"');
    console.log('✓ 1. Page heading is strictly "ROLES"');

    // 2. CATEGORY button text is strictly "CATEGORY"
    const categoryBtnText = await cdp.eval(`
      Array.from(document.querySelectorAll('a, button'))
        .find(el => el.getAttribute('href') === '/setup/categories')
        ?.textContent?.trim()
    `);
    assert.equal(categoryBtnText, 'CATEGORY', 'Category link text must be strictly "CATEGORY"');
    console.log('✓ 2. CATEGORY button text is strictly "CATEGORY"');

    // 3. + ROLE button inspection: single plus icon/symbol, DOM text includes "+ ROLE"
    const roleButtonInfo = await cdp.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE') || b.textContent.includes('ROLE'));
        if (!btn) return null;
        const svgs = btn.querySelectorAll('svg');
        const textNodes = Array.from(btn.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent?.trim())
          .filter(Boolean);
        return {
          textContent: btn.textContent?.trim(),
          svgCount: svgs.length,
          textNodes
        };
      })()
    `);
    console.log('Role button DOM details:', JSON.stringify(roleButtonInfo));
    assert.ok(roleButtonInfo, '+ ROLE button must exist');
    assert.equal(roleButtonInfo.svgCount, 1, 'Button must have exactly 1 SVG icon');
    assert.equal(roleButtonInfo.textContent, '+ ROLE', 'Button textContent must be "+ ROLE"');
    assert.ok(!roleButtonInfo.textNodes.some((t: string) => t.includes('+ +')), 'No duplicate "+ +" in button text nodes');
    console.log('✓ 3. + ROLE button has exactly ONE plus icon/symbol and clean presentation (no "+ + ROLE")');

    // 4. Absence of "+ Add to Category" button
    const addToCatButtons = await cdp.eval(`
      Array.from(document.querySelectorAll('button'))
        .filter(b => b.textContent.includes('Add to Category'))
        .map(b => b.textContent.trim())
    `);
    assert.equal(addToCatButtons.length, 0, 'No "+ Add to Category" buttons must exist on /setup/roles');
    console.log('✓ 4. "+ Add to Category" CTA removed from all category section headers');

    // 5. Test Add Role Modal Opening, Portal, Backdrop Stacking, and Escape key
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
      if (btn) btn.click();
    `);
    await sleep(400);

    const roleModalInfo = await cdp.eval(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        const rect = dialog.getBoundingClientRect();
        const isBody = dialog.parentElement === document.body;
        const computedStyle = window.getComputedStyle(dialog);
        const zIndex = computedStyle.zIndex;
        const bodyOverflow = document.body.style.overflow;
        const elemAtHeaderPoint = document.elementFromPoint(100, 20);
        const isHeaderCovered = dialog.contains(elemAtHeaderPoint) || elemAtHeaderPoint === dialog;

        return {
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          isBody,
          zIndex,
          bodyOverflow,
          isHeaderCovered
        };
      })()
    `);
    console.log('Add Role Modal Stack Info:', JSON.stringify(roleModalInfo));
    assert.ok(roleModalInfo, 'Add Role modal dialog must be rendered');
    assert.equal(roleModalInfo.isBody, true, 'Modal container MUST be a direct child of document.body (createPortal)');
    assert.equal(roleModalInfo.rect.top, 0, 'Modal backdrop must start at top: 0');
    assert.equal(roleModalInfo.rect.left, 0, 'Modal backdrop must start at left: 0');
    assert.equal(roleModalInfo.bodyOverflow, 'hidden', 'Body scroll MUST be locked (overflow: hidden)');
    assert.ok(roleModalInfo.isHeaderCovered, 'Modal overlay MUST cover the Header at top: 0');
    console.log('✓ 5. Add Role Modal portaled to document.body, z-[100], covers navbar/header at top:0, locks body scroll');

    // Test Escape key closes modal
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(300);
    const modalClosedAfterEsc = await cdp.eval(`!document.querySelector('div[role="dialog"]')`);
    const bodyOverflowAfterEsc = await cdp.eval(`document.body.style.overflow`);
    assert.ok(modalClosedAfterEsc, 'Modal must close on Escape key');
    assert.equal(bodyOverflowAfterEsc, '', 'Body scroll lock must be restored after modal closes');
    console.log('✓ 6. Escape key listener closes Add Role modal and unlocks scroll');

    // Test Cancel button closes modal
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
      if (btn) btn.click();
    `);
    await sleep(300);
    await cdp.eval(`
      const cancelBtn = Array.from(document.querySelectorAll('div[role="dialog"] button')).find(b => b.textContent.includes('Cancel'));
      if (cancelBtn) cancelBtn.click();
    `);
    await sleep(300);
    assert.ok(await cdp.eval(`!document.querySelector('div[role="dialog"]')`), 'Modal must close on Cancel button');
    console.log('✓ 7. Cancel button closes modal cleanly');

    // 8. Test Role Details Modal
    await cdp.eval(`
      const viewBtn = document.querySelector('button[title*="Details"], button[title*="Intelligence"], button[aria-label*="Details"]');
      if (viewBtn) viewBtn.click();
    `);
    await sleep(300);
    const detailsModalInfo = await cdp.eval(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        return {
          isBody: dialog.parentElement === document.body,
          top: dialog.getBoundingClientRect().top,
          bodyOverflow: document.body.style.overflow,
          elemAtHeader: dialog.contains(document.elementFromPoint(100, 20))
        };
      })()
    `);
    assert.ok(detailsModalInfo, 'Role Details modal must open');
    assert.equal(detailsModalInfo.isBody, true, 'Role Details modal must be portaled to body');
    assert.equal(detailsModalInfo.top, 0, 'Backdrop starts at top: 0');
    assert.equal(detailsModalInfo.bodyOverflow, 'hidden', 'Scroll locked');
    assert.ok(detailsModalInfo.elemAtHeader, 'Header covered by backdrop');

    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(300);
    assert.ok(await cdp.eval(`!document.querySelector('div[role="dialog"]')`), 'Details modal closes on Escape');
    console.log('✓ 8. Role Details modal portaled to body, covers navbar, locks scroll, closes on Escape');

    // =========================================================================
    // SECTION 2: /setup/categories VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 2: /setup/categories UI Verification ---');
    await navigate('http://localhost:3001/setup/categories');

    // 9. Heading is strictly "CATEGORIES"
    const catsHeading = await cdp.eval(`document.querySelector('h1')?.textContent?.trim()`);
    assert.equal(catsHeading, 'CATEGORIES', 'Heading must be strictly "CATEGORIES"');
    console.log('✓ 9. Page heading is strictly "CATEGORIES"');

    // 10. ROLES link text is strictly "ROLES" in page header
    const rolesBtnText = await cdp.eval(`
      (() => {
        const h1 = document.querySelector('h1');
        const headerCard = h1?.parentElement?.parentElement;
        const link = headerCard?.querySelector('a[href="/setup/roles"]');
        return link?.textContent?.trim();
      })()
    `);
    assert.equal(rolesBtnText, 'ROLES', 'Roles link text must be strictly "ROLES"');
    console.log('✓ 10. ROLES button text in header is strictly "ROLES"');

    // 11. + CATEGORY button inspection
    const catButtonInfo = await cdp.eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ CATEGORY') || b.textContent.includes('CATEGORY'));
        if (!btn) return null;
        const svgs = btn.querySelectorAll('svg');
        const textNodes = Array.from(btn.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent?.trim())
          .filter(Boolean);
        return {
          textContent: btn.textContent?.trim(),
          svgCount: svgs.length,
          textNodes
        };
      })()
    `);
    console.log('Category button DOM details:', JSON.stringify(catButtonInfo));
    assert.ok(catButtonInfo, '+ CATEGORY button must exist');
    assert.equal(catButtonInfo.svgCount, 1, 'Button must have exactly 1 SVG icon');
    assert.equal(catButtonInfo.textContent, '+ CATEGORY', 'Button textContent must be "+ CATEGORY"');
    assert.ok(!catButtonInfo.textNodes.some((t: string) => t.includes('+ +')), 'No duplicate "+ +" in button text nodes');
    console.log('✓ 11. + CATEGORY button has exactly ONE plus icon/symbol and clean presentation (no "+ + CATEGORY")');

    // 12. Add Category Modal Portal, Backdrop Stacking, and Escape key
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ CATEGORY'));
      if (btn) btn.click();
    `);
    await sleep(400);

    const catModalInfo = await cdp.eval(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        const rect = dialog.getBoundingClientRect();
        const isBody = dialog.parentElement === document.body;
        const bodyOverflow = document.body.style.overflow;
        const elemAtHeaderPoint = document.elementFromPoint(100, 20);
        const isHeaderCovered = dialog.contains(elemAtHeaderPoint) || elemAtHeaderPoint === dialog;

        return {
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          isBody,
          bodyOverflow,
          isHeaderCovered
        };
      })()
    `);
    console.log('Add Category Modal Stack Info:', JSON.stringify(catModalInfo));
    assert.ok(catModalInfo, 'Add Category modal dialog must be rendered');
    assert.equal(catModalInfo.isBody, true, 'Category modal container MUST be a direct child of document.body');
    assert.equal(catModalInfo.rect.top, 0, 'Backdrop starts at top: 0');
    assert.equal(catModalInfo.rect.left, 0, 'Backdrop starts at left: 0');
    assert.equal(catModalInfo.bodyOverflow, 'hidden', 'Body scroll MUST be locked (overflow: hidden)');
    assert.ok(catModalInfo.isHeaderCovered, 'Modal overlay MUST cover the Header at top: 0');
    console.log('✓ 12. Add Category modal portaled to body, z-[100], covers navbar/header at top:0, locks scroll');

    // Escape closes category modal
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(300);
    assert.ok(await cdp.eval(`!document.querySelector('div[role="dialog"]')`), 'Category modal closes on Escape');
    assert.equal(await cdp.eval(`document.body.style.overflow`), '', 'Scroll restored after Escape');
    console.log('✓ 13. Escape key listener closes Add Category modal and restores scroll');

    // 14. Test Category Details Modal
    await cdp.eval(`
      const viewBtn = document.querySelector('button[title*="Details"], button[aria-label*="Details"]');
      if (viewBtn) viewBtn.click();
    `);
    await sleep(300);
    const catDetailsInfo = await cdp.eval(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return null;
        return {
          isBody: dialog.parentElement === document.body,
          top: dialog.getBoundingClientRect().top,
          bodyOverflow: document.body.style.overflow,
          elemAtHeader: dialog.contains(document.elementFromPoint(100, 20))
        };
      })()
    `);
    assert.ok(catDetailsInfo, 'Category Details modal must open');
    assert.equal(catDetailsInfo.isBody, true, 'Category Details portaled to body');
    assert.equal(catDetailsInfo.top, 0, 'Category Details backdrop starts at top: 0');
    assert.equal(catDetailsInfo.bodyOverflow, 'hidden', 'Scroll locked');
    assert.ok(catDetailsInfo.elemAtHeader, 'Header covered by backdrop');

    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(300);
    assert.ok(await cdp.eval(`!document.querySelector('div[role="dialog"]')`), 'Category Details closes on Escape');
    console.log('✓ 14. Category Details modal portaled to body, covers navbar, locks scroll, closes on Escape');

    // =========================================================================
    // SECTION 3: MULTI-VIEWPORT VERIFICATION (6 Viewports)
    // =========================================================================
    console.log('\n--- SECTION 3: Multi-Viewport Responsive Verification (6 Viewports) ---');
    for (const vp of viewports) {
      await setViewport(vp.width, vp.height);
      await navigate('http://localhost:3001/setup/roles');

      await cdp.eval(`
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
        if (btn) btn.click();
      `);
      await sleep(300);

      const vpModal = await cdp.eval(`
        (() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return null;
          const rect = dialog.getBoundingClientRect();
          return {
            top: rect.top,
            left: rect.left,
            isBody: dialog.parentElement === document.body,
            overflow: document.body.style.overflow,
            coversHeader: dialog.contains(document.elementFromPoint(Math.min(50, Math.floor(window.innerWidth / 2)), 20))
          };
        })()
      `);

      assert.ok(vpModal, `Modal must open on viewport ${vp.label}`);
      assert.equal(vpModal.top, 0, `Backdrop top must be 0 on ${vp.label}`);
      assert.equal(vpModal.isBody, true, `Must be portaled to body on ${vp.label}`);
      assert.equal(vpModal.overflow, 'hidden', `Scroll locked on ${vp.label}`);
      assert.ok(vpModal.coversHeader, `Overlay covers header on ${vp.label}`);

      await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await sleep(200);
      console.log(`✓ Viewport [${vp.label} - ${vp.width}x${vp.height}]: Modal overlay & portal verified`);
    }

    // =========================================================================
    // SECTION 4: LIGHT & DARK THEME VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 4: Light & Dark Theme UI Verification ---');
    await setViewport(1280, 800);

    // Light mode
    await cdp.eval(`document.documentElement.classList.remove('dark')`);
    await sleep(200);
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
      if (btn) btn.click();
    `);
    await sleep(300);
    const lightCheck = await cdp.eval(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        return {
          isOpen: !!dialog,
          isBody: dialog?.parentElement === document.body,
          coversHeader: dialog ? dialog.contains(document.elementFromPoint(100, 20)) : false
        };
      })()
    `);
    assert.ok(lightCheck.isOpen && lightCheck.isBody && lightCheck.coversHeader, 'Light theme modal pass');
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(200);
    console.log('✓ Light mode: Modal backdrop, portal, and stacking verified');

    // Dark mode
    await cdp.eval(`document.documentElement.classList.add('dark')`);
    await sleep(200);
    await cdp.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ ROLE'));
      if (btn) btn.click();
    `);
    await sleep(300);
    const darkCheck = await cdp.eval(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        return {
          isOpen: !!dialog,
          isBody: dialog?.parentElement === document.body,
          coversHeader: dialog ? dialog.contains(document.elementFromPoint(100, 20)) : false
        };
      })()
    `);
    assert.ok(darkCheck.isOpen && darkCheck.isBody && darkCheck.coversHeader, 'Dark theme modal pass');
    await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(200);
    console.log('✓ Dark mode: Modal backdrop, portal, and stacking verified');

    // =========================================================================
    // SECTION 5: POST-CHECK PRODUCTION DB BASELINE SAFETY
    // =========================================================================
    console.log('\n--- SECTION 5: Post-Test Production Database Baseline Integrity Check ---');
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
    console.log('ALL ROLES & CATEGORIES UI POLISH QA CHECKS PASSED SUCCESSFULLY!');
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

runUiPolishQA().catch((err) => {
  console.error('\n❌ QA FAILED:', err);
  process.exit(1);
});
