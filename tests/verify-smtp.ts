import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { DatabaseSync } from 'node:sqlite';

const rootDir = process.cwd();
const envPath = path.join(rootDir, '.env.local');
const envExists = fs.existsSync(envPath);

console.log('.env.local exists:', envExists ? 'YES' : 'NO');

// Safely load environment variables from .env.local without exposing values
if (envExists) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      process.env[key] = val;
    }
  }
}

const hasHost = Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim().length > 0);
const hasPort = Boolean(process.env.SMTP_PORT && process.env.SMTP_PORT.trim().length > 0);
const hasSecure = Boolean(process.env.SMTP_SECURE && process.env.SMTP_SECURE.trim().length > 0);
const hasUser = Boolean(process.env.SMTP_USER && process.env.SMTP_USER.trim().length > 0);
const hasPassword = Boolean(process.env.SMTP_PASSWORD && process.env.SMTP_PASSWORD.trim().length > 0);
const hasFrom = Boolean(process.env.SMTP_FROM && process.env.SMTP_FROM.trim().length > 0);

console.log('SMTP_HOST configured:', hasHost ? 'YES' : 'NO');
console.log('SMTP_PORT configured:', hasPort ? 'YES' : 'NO');
console.log('SMTP_SECURE configured:', hasSecure ? 'YES' : 'NO');
console.log('SMTP_USER configured:', hasUser ? 'YES' : 'NO');
console.log('SMTP_PASSWORD configured:', hasPassword ? 'YES' : 'NO');
console.log('SMTP_FROM configured:', hasFrom ? 'YES' : 'NO');

async function testConnection() {
  if (!hasHost || !hasUser || !hasPassword) {
    console.log('SMTP connection verification: NOT RUN (Missing credentials)');
    return;
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASSWORD!.trim(),
      },
    });

    await transporter.verify();
    console.log('SMTP connection verification: PASS');
  } catch (err: unknown) {
    let errorMsg = 'Unknown SMTP connection error';
    if (err instanceof Error) {
      errorMsg = err.message
        .replace(process.env.SMTP_PASSWORD || '', '***')
        .replace(process.env.SMTP_USER || '', '***');
    }
    console.log('SMTP connection verification: FAIL');
    console.log('Sanitized error:', errorMsg);
  }
}

async function verifyDatabase() {
  const dbPath = path.join(rootDir, 'data', 'site_work.db');
  const db = new DatabaseSync(dbPath);

  const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const sitesCount = (db.prepare('SELECT COUNT(*) as c FROM sites').get() as { c: number }).c;
  const siteUsersCount = (db.prepare('SELECT COUNT(*) as c FROM site_users').get() as { c: number }).c;

  console.log('Database users:', usersCount);
  console.log('Database sites:', sitesCount);
  console.log('Database site_users:', siteUsersCount);

  db.close();
}

async function main() {
  await testConnection();
  await verifyDatabase();
}

main().catch(err => {
  console.error('Fatal execution error:', err.message);
});
