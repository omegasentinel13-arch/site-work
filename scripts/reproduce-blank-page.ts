import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.cwd(), '.chrome_reproduce_temp');

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
    const res = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return res.result?.result?.value;
  }
}

async function main() {
  console.log('=== STARTING LOGIN BLANK PAGE REPRODUCTION VIA CHROME CDP ===');

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
      await new Promise((r) => setTimeout(r, 200));
      retries--;
    }
  }

  const cdp = new CdpClient(pageWsUrl);
  await cdp.connect();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  cdp.ws.addEventListener('message', (ev) => {
    const data = JSON.parse(ev.data.toString());
    if (data.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER CONSOLE]', data.params.type, data.params.args.map((a: any) => a.value || a.description).join(' '));
    }
    if (data.method === 'Network.responseReceived') {
      const { url, status } = data.params.response;
      if (url.includes('/api/') || url.includes('site') || !url.includes('.js')) {
        console.log(`[NETWORK RESPONSE] ${status} ${url}`);
      }
    }
    if (data.method === 'Network.loadingFailed') {
      console.log(`[NETWORK FAILED] ${data.params.errorText} ${data.params.url}`);
    }
  });

  const targetUrl = 'https://site-work-app-production.up.railway.app/login';
  console.log(`Navigating to ${targetUrl}...`);
  await cdp.send('Page.navigate', { url: targetUrl });

  // Wait for login form to render
  await new Promise((r) => setTimeout(r, 2000));

  const hasForm = await cdp.eval(`!!document.querySelector('form')`);
  console.log('Login form rendered:', hasForm);

  // Type credentials using React native value setter
  console.log('Entering credentials...');
  await cdp.eval(`
    const setReactValue = (input, val) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const inputs = document.querySelectorAll('input');
    setReactValue(inputs[0], 'Iamadmin');
    setReactValue(inputs[1], 'Admin123!@#');
  `);

  console.log('Submitting login form...');
  await cdp.eval(`
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);

  // Observe navigation over the next 5 seconds
  for (let i = 1; i <= 5; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const currentHref = await cdp.eval(`window.location.href`);
    const bodyLength = await cdp.eval(`document.body.innerText.length`);
    const bodyText = await cdp.eval(`document.body.innerText.slice(0, 100).replace(/\\n/g, ' ')`);
    const bodyHtml = await cdp.eval(`document.body.innerHTML.slice(0, 200)`);
    console.log(`T+${i}s: href="${currentHref}" | textLen=${bodyLength} | text="${bodyText}" | html="${bodyHtml}"`);
  }

  // Cleanup
  chromeProc.kill();
  console.log('=== CDP REPRODUCTION COMPLETE ===');
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
