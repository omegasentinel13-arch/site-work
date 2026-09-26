import fs from 'fs';
import path from 'path';

// Parse .env.local manually
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

import { dispatchAccessRequestEmail, renderNewAccessRequestEmail, verifySmtpConnection, resolveEmailTransportMode } from '../lib/email/access-request-mailer';
import { getSmtpConfig } from '../lib/email/mailer';

async function main() {
  console.log('EMAIL_MODE:', process.env.EMAIL_MODE);
  console.log('Resolved transport mode:', resolveEmailTransportMode());
  console.log('SMTP Config:', getSmtpConfig());

  console.log('Verifying SMTP connection...');
  const conn = await verifySmtpConnection();
  console.log('SMTP Connection result:', conn);

  const approvers = [
    { name: 'Iamadmin', email: 'omegasentinel13@gmail.com' },
    { name: 'abadmin', email: 'supermanskrypton@gmail.com' },
  ];

  for (const approver of approvers) {
    console.log(`\n--- Testing send to ${approver.name} (${approver.email}) ---`);
    const emailData = renderNewAccessRequestEmail({
      requesterName: 'Forensic Test User',
      requestedUsername: 'forensic_test',
      requestedEmail: 'forensic_test@example.com',
      requestedRole: 'Site Manager',
      requestId: 'AR-FORENSIC-01',
      timestamp: new Date().toLocaleString(),
      reviewUrl: 'http://localhost:3000/setup/users?requestId=AR-FORENSIC-01',
    });

    const result = await dispatchAccessRequestEmail({
      to: approver.email,
      subject: `TEST: ${emailData.subject}`,
      text: emailData.text,
      html: emailData.html,
      metadata: { test: true },
    });

    console.log(`Result for ${approver.email}:`, result);
  }
}

main().catch(console.error);
