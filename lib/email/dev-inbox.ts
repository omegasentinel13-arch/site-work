import fs from 'fs';
import path from 'path';

export interface CapturedEmail {
  id: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const capturedEmails: CapturedEmail[] = [];

function getStorePath(): string {
  return path.join(process.cwd(), 'data', 'dev_captured_emails.json');
}

export function captureDevEmail(email: Omit<CapturedEmail, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): CapturedEmail {
  const record: CapturedEmail = {
    id: email.id || `mail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    to: email.to,
    from: email.from,
    subject: email.subject,
    text: email.text,
    html: email.html,
    timestamp: email.timestamp || new Date().toISOString(),
    metadata: email.metadata,
  };

  capturedEmails.push(record);

  try {
    const dir = path.dirname(getStorePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getStorePath(), JSON.stringify(capturedEmails, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal if writing to file fails in restricted test runner environments
  }

  // Safe developer visibility
  if (process.env.DEBUG_EMAIL === 'true' || process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line no-console
    console.log(`[DEV EMAIL CAPTURED] To: ${record.to} | Subject: ${record.subject}`);
  }

  return record;
}

export function getCapturedEmails(): CapturedEmail[] {
  return [...capturedEmails];
}

export function getLastCapturedEmail(): CapturedEmail | null {
  return capturedEmails.length > 0 ? capturedEmails[capturedEmails.length - 1] : null;
}

export function clearCapturedEmails(): void {
  capturedEmails.length = 0;
  try {
    const storePath = getStorePath();
    if (fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, JSON.stringify([], null, 2), 'utf8');
    }
  } catch {}
}
