import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import assert from 'node:assert/strict';
import { getDb } from '../lib/db';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_access_req_temp');
const TARGET_URL = 'http://localhost:3000/request-access';

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

async function main() {
  console.log('================================================================');
  console.log('PART 21: REAL BROWSER WORKFLOW VERIFICATION VIA HEADLESS CHROME');
  console.log(`URL: ${TARGET_URL}`);
  console.log('================================================================\n');

  console.log('1. Spawning Google Chrome process...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9229',
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
      const tabs = await fetchJson('http://127.0.0.1:9229/json');
      if (Array.isArray(tabs)) {
        const page = tabs.find((t: any) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          cdp = new CdpClient(page.webSocketDebuggerUrl);
          await cdp.connect();
          break;
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  assert.ok(cdp, 'CDP connection to Chrome established');
  console.log('   ✓ Connected to Chrome DevTools Protocol');

  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.clearBrowserCookies');

  console.log('\n2. Navigating Chrome to:', TARGET_URL);
  await cdp.send('Page.navigate', { url: TARGET_URL });

  // Wait for the form inputs to appear in DOM
  console.log('   Waiting for Request Access form to mount...');
  let formReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    formReady = await cdp.eval(`!!document.querySelector('input[placeholder="e.g. Rahul Sharma"]')`);
    if (formReady) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(formReady, 'Form must mount with Full Name input field');
  console.log('   ✓ Form mounted successfully');
  // Wait 1.5 seconds for React hydration to complete
  await new Promise((r) => setTimeout(r, 1500));

  // Fill in form fields via React-compatible event dispatchers
  const testId = Date.now().toString().slice(-4);
  const fullName = `Rajesh Varma ${testId}`;
  const username = `rajesh_site_${testId}`;
  const email = `rajesh.site.${testId}@example.com`;
  const password = `Password@2026!${testId}`;

  console.log('\n3. Interacting with Form DOM inputs:');
  console.log(`   Full Name:        ${fullName}`);
  console.log(`   Username:         @${username}`);
  console.log(`   Email:            ${email}`);
  console.log(`   Role:             SITE_MANAGER (Engineer / Site Manager)`);

  async function typeInto(selector: string, text: string) {
    await cdp!.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, ${JSON.stringify(text)});
        } else {
          el.value = ${JSON.stringify(text)};
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await new Promise((r) => setTimeout(r, 100));
  }

  await typeInto('input[placeholder="e.g. Rahul Sharma"]', fullName);
  await typeInto('input[placeholder="e.g. rahul_eng"]', username);
  await typeInto('input[placeholder="rahul@example.com"]', email);
  await typeInto('input[placeholder="Min 8 characters"]', password);
  await typeInto('input[placeholder="Re-enter password"]', password);

  const inputValues = await cdp.eval(`(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({ placeholder: i.placeholder, value: i.value, valid: i.checkValidity() }));
  })()`);
  console.log('   DOM Inputs before submit:', JSON.stringify(inputValues, null, 2));

  console.log('\n4. Submitting form via form.requestSubmit()...');
  await cdp.eval(`(() => {
    const form = document.querySelector('form');
    if (form) {
      form.requestSubmit();
    } else {
      document.querySelector('button[type="submit"]')?.click();
    }
  })()`);

  // Wait for submission and confirmation screen
  console.log('   Waiting for confirmation screen and API/SMTP dispatch...');
  let confirmed = false;
  let pageText = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    pageText = await cdp.eval('document.body.innerText') || '';
    if (pageText.includes('Access Request Submitted') || pageText.includes('AR-')) {
      confirmed = true;
      break;
    }
    const errText = await cdp.eval(`document.querySelector('.text-rose-700')?.innerText`);
    if (errText) {
      console.log('   Form error rendered:', errText);
    }
  }

  assert.ok(confirmed, `Expected confirmation screen, page text was: ${pageText.slice(0, 300)}`);
  console.log('   ✓ Browser rendered confirmation screen: "Access Request Submitted"');

  const match = pageText.match(/AR-[A-Z0-9]{6}/);
  const requestId = match ? match[0] : null;
  console.log(`   Generated Request Reference: ${requestId}`);
  assert.ok(requestId, 'Request ID must be present in confirmation UI');

  // Close Chrome
  chromeProc.kill();
  console.log('   ✓ Chrome browser closed cleanly');

  // Inspect Database
  console.log('\n================================================================');
  console.log('5. LOCAL DATABASE FORENSIC VERIFICATION');
  console.log('================================================================');
  const db = getDb();

  const reqRecord = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId) as any;
  console.log('\n[ACCESS REQUEST RECORD]:');
  console.log(JSON.stringify({
    id: reqRecord.id,
    requester_full_name: reqRecord.requester_full_name,
    requested_username: reqRecord.requested_username,
    requested_email: reqRecord.requested_email,
    requested_role_id: reqRecord.requested_role_id,
    status: reqRecord.status,
    created_at: reqRecord.created_at,
  }, null, 2));

  assert.equal(reqRecord.status, 'PENDING');
  assert.equal(reqRecord.requester_full_name, fullName);
  assert.equal(reqRecord.requested_username, username);

  const notifs = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ?').all(requestId) as any[];
  console.log('\n[NOTIFICATION RECORDS]:');
  console.log(JSON.stringify(notifs, null, 2));

  assert.equal(notifs.length, 2, 'Must create exactly two notification records');
  const iamadminNotif = notifs.find((n) => n.recipient_email === 'omegasentinel13@gmail.com');
  const abadminNotif = notifs.find((n) => n.recipient_email === 'supermanskrypton@gmail.com');

  assert.ok(iamadminNotif, 'Iamadmin notification row must exist');
  assert.ok(abadminNotif, 'abadmin notification row must exist');

  console.log(`   Iamadmin delivery_status: ${iamadminNotif.delivery_status} (sent_at: ${iamadminNotif.sent_at})`);
  console.log(`   abadmin  delivery_status: ${abadminNotif.delivery_status} (sent_at: ${abadminNotif.sent_at})`);

  const audits = db.prepare('SELECT id, entity_type, entity_id, action, user_id, after_state, created_at FROM audit_logs WHERE entity_id = ?').all(requestId) as any[];
  console.log('\n[AUDIT LOG ENTRIES]:');
  console.log(JSON.stringify(audits, null, 2));

  console.log('\n================================================================');
  console.log('REAL BROWSER SUBMISSION + DATABASE VERIFICATION COMPLETED SUCCESSFULLY');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Browser QA failed:', err);
  process.exit(1);
});
