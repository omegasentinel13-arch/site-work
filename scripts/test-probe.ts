import fs from 'fs';
import path from 'path';

// Parse .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import nodemailer from 'nodemailer';
import { getSmtpConfig } from '../lib/email/mailer';

async function testHeaders() {
  const config = getSmtpConfig()!;
  console.log('Using SMTP from:', config.from);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  for (const recipient of ['omegasentinel13@gmail.com', 'supermanskrypton@gmail.com']) {
    console.log(`\nSending detailed probe to ${recipient}...`);
    const info = await transporter.sendMail({
      from: config.from,
      to: recipient,
      subject: `SITE WORK Forensic Delivery Probe [${recipient}]`,
      text: `Automated forensic verification probe delivered to: ${recipient} at ${new Date().toISOString()}`,
      html: `<p>Automated forensic verification probe delivered to: <strong>${recipient}</strong></p><p>Timestamp: ${new Date().toISOString()}</p>`,
    });

    console.log(`Probe result for ${recipient}:`);
    console.log('- Message ID:', info.messageId);
    console.log('- Envelope:', info.envelope);
    console.log('- Accepted:', info.accepted);
    console.log('- Rejected:', info.rejected);
    console.log('- Response:', info.response);
  }
}

testHeaders().catch(console.error);
