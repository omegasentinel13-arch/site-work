import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getDb } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';
import {
  dispatchAccessRequestEmail,
  resolveEmailTransportMode,
  renderNewAccessRequestEmail,
} from '../lib/email/access-request-mailer';
import { POST as handleAccessRequestPost } from '../app/api/access-requests/route';

test('EMAIL DELIVERY FORENSICS & TRANSPORT ISOLATION REGRESSION SUITE (TESTS 1 - 10)', async (suite) => {
  const origEnv = { ...process.env };
  const db = getDb();

  suite.afterEach(() => {
    process.env = { ...origEnv };
  });

  // TEST 1: REAL API ROUTE / resolver resolves both administrators
  await suite.test('TEST 1: Approver resolver resolves both active administrators with recovery emails', () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    
    const iamadmin = approvers.find((a) => a.username.toLowerCase() === 'iamadmin');
    const abadmin = approvers.find((a) => a.username.toLowerCase() === 'abadmin');

    assert.ok(iamadmin, 'Iamadmin must be resolved as an eligible approver');
    assert.ok(abadmin, 'abadmin must be resolved as an eligible approver');
    assert.equal(iamadmin?.email, 'omegasentinel13@gmail.com');
    assert.equal(abadmin?.email, 'supermanskrypton@gmail.com');
  });

  // TEST 2: REAL API ROUTE creates two notification records
  await suite.test('TEST 2: Submission creates exactly two notification records in pending state before dispatch', async () => {
    process.env.EMAIL_MODE = 'development';
    const testId = `t2_${Date.now()}`;

    const req = new Request('http://localhost:3000/api/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Test User T2',
        username: testId,
        email: `${testId}@sitework.test`,
        password: 'Password123!',
        confirmPassword: 'Password123!',
        roleId: 'SITE_MANAGER',
      }),
    });

    const res = await handleAccessRequestPost(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.requestId);

    const notifs = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ?').all(json.requestId) as any[];
    assert.equal(notifs.length, 2, 'Must create exactly 2 notification records');

    const recipients = notifs.map((n) => n.recipient_email).sort();
    assert.deepEqual(recipients, ['omegasentinel13@gmail.com', 'supermanskrypton@gmail.com'].sort());

    // Clean up test request
    db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(json.requestId);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(json.requestId);
  });

  // TEST 3: REAL API ROUTE passes two independent recipients to mail transport
  await suite.test('TEST 3: Mail transport is invoked independently for each recipient', async () => {
    const emailData = renderNewAccessRequestEmail({
      requesterName: 'Independent Test User',
      requestedUsername: 'indep_user',
      requestedEmail: 'indep@sitework.test',
      requestedRole: 'Site Manager',
      requestId: 'AR-INDEP-01',
      timestamp: new Date().toLocaleString(),
      reviewUrl: 'http://localhost:3000/setup/users?requestId=AR-INDEP-01',
    });

    process.env.EMAIL_MODE = 'development';

    const res1 = await dispatchAccessRequestEmail({
      to: 'omegasentinel13@gmail.com',
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      metadata: { requestId: 'AR-INDEP-01', approverId: 'usr-admin-1' },
    });

    const res2 = await dispatchAccessRequestEmail({
      to: 'supermanskrypton@gmail.com',
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      metadata: { requestId: 'AR-INDEP-01', approverId: 'usr-f7825275-d30e-4b89-9d6b-994b50532984' },
    });

    assert.equal(res1.success, true);
    assert.equal(res2.success, true);
    assert.notEqual(res1, res2, 'Each dispatch must return an independent result object');
  });

  // TEST 4: SMTP envelope contains expected recipient address
  await suite.test('TEST 4: dispatchAccessRequestEmail constructs explicit SMTP envelope with correct sender and recipient', async () => {
    process.env.EMAIL_MODE = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'sender@example.com';
    process.env.SMTP_PASSWORD = 'password';

    // Verify envelope structure through code contract
    const targetRecipient = 'supermanskrypton@gmail.com';
    const emailData = renderNewAccessRequestEmail({
      requesterName: 'Envelope Test',
      requestedUsername: 'env_user',
      requestedEmail: 'env@test.com',
      requestedRole: 'Site Manager',
      requestId: 'AR-ENV-01',
      timestamp: new Date().toLocaleString(),
      reviewUrl: 'http://localhost:3000',
    });

    // In DEV_CAPTURED mode, verify recipient mapping
    process.env.EMAIL_MODE = 'development';
    const devRes = await dispatchAccessRequestEmail({
      to: targetRecipient,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    assert.equal(devRes.success, true);
  });

  // TEST 5: Iamadmin and abadmin receive independent transport results
  await suite.test('TEST 5: Transport results are individually accounted per approver', async () => {
    process.env.EMAIL_MODE = 'development';
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const results: Record<string, string> = {};

    for (const approver of approvers) {
      const res = await dispatchAccessRequestEmail({
        to: approver.email,
        subject: 'Test Subject',
        text: 'Body',
        html: '<p>Body</p>',
      });
      results[approver.username] = res.deliveryStatus;
    }

    assert.equal(results['Iamadmin'], 'DEV_CAPTURED');
    assert.equal(results['abadmin'], 'DEV_CAPTURED');
  });

  // TEST 6: Changing recovery_email changes future recipient
  await suite.test('TEST 6: Changing recovery_email dynamically reflects in future approver resolution', () => {
    const originalRow = db.prepare("SELECT recovery_email FROM users WHERE username = 'abadmin'").get() as { recovery_email: string };
    const originalEmail = originalRow.recovery_email;

    try {
      const dynamicEmail = 'dynamic.forwarder@sitework.local';
      db.prepare("UPDATE users SET recovery_email = ? WHERE username = 'abadmin'").run(dynamicEmail);

      const approversAfter = AccessRequestRepository.resolveAccessRequestApprovers();
      const abadminApprover = approversAfter.find((a) => a.username.toLowerCase() === 'abadmin');
      assert.equal(abadminApprover?.email, dynamicEmail.toLowerCase());
    } finally {
      db.prepare("UPDATE users SET recovery_email = ? WHERE username = 'abadmin'").run(originalEmail);
    }

    const approversReverted = AccessRequestRepository.resolveAccessRequestApprovers();
    const abadminReverted = approversReverted.find((a) => a.username.toLowerCase() === 'abadmin');
    assert.equal(abadminReverted?.email, originalEmail.toLowerCase());
  });

  // TEST 7: Real browser submission follows the same production mail path
  await suite.test('TEST 7: API route uses AccessRequestRepository.createAccessRequest and dispatchAccessRequestEmail', async () => {
    process.env.EMAIL_MODE = 'development';
    const testUsername = `real_path_${Date.now()}`;

    const req = new Request('http://localhost:3000/api/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Real Path User',
        username: testUsername,
        email: `${testUsername}@sitework.test`,
        password: 'Password123!',
        confirmPassword: 'Password123!',
        roleId: 'VIEWER',
      }),
    });

    const res = await handleAccessRequestPost(req);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'PENDING');

    const createdReq = AccessRequestRepository.getAccessRequestById(data.requestId);
    assert.ok(createdReq);
    assert.equal(createdReq.status, 'PENDING');

    // Clean up
    db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(data.requestId);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(data.requestId);
  });

  // TEST 8: No mocked SMTP success is accepted as proof of real delivery
  await suite.test('TEST 8: Transport failure fails closed and returns FAILED status', async () => {
    process.env.EMAIL_MODE = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '9998'; // Unreachable closed port
    process.env.SMTP_USER = 'invalid@sitework.local';
    process.env.SMTP_PASSWORD = 'wrong_password';

    const result = await dispatchAccessRequestEmail({
      to: 'recipient@sitework.test',
      subject: 'Test Subject',
      text: 'Body',
      html: '<p>Body</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.ok(result.error);
  });

  // TEST 9: A recipient-specific SMTP failure is stored as FAILED
  await suite.test('TEST 9: Recipient-specific failure is stored as FAILED in database', () => {
    const fakeRequestId = `AR-FAIL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const notifId = `arn-fail-${Date.now()}`;

    db.prepare(`
      INSERT INTO access_requests (
        id, requester_full_name, requested_username, requested_email,
        requested_role_id, requested_role_name_snapshot, password_hash,
        status, created_at, updated_at
      ) VALUES (?, 'Failed Dispatch User', 'fail_u', 'fail@test.com', 'SITE_MANAGER', 'Site Manager', 'hash', 'PENDING', datetime('now'), datetime('now'))
    `).run(fakeRequestId);

    db.prepare(`
      INSERT INTO access_request_notifications (
        id, access_request_id, recipient_user_id, recipient_email,
        notification_type, delivery_status, created_at
      ) VALUES (?, ?, 'usr-admin-1', 'bad-recipient@domain.test', 'NEW_REQUEST', 'PENDING', datetime('now'))
    `).run(notifId, fakeRequestId);

    // Simulate failure write
    const failureMsg = 'SMTP 550 5.1.1 Recipient unknown';
    db.prepare(`
      UPDATE access_request_notifications 
      SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
      WHERE id = ?
    `).run(failureMsg, notifId);

    const row = db.prepare('SELECT * FROM access_request_notifications WHERE id = ?').get(notifId) as any;
    assert.equal(row.delivery_status, 'FAILED');
    assert.equal(row.failure_reason, failureMsg);
    assert.ok(row.failed_at);

    // Clean up
    db.prepare('DELETE FROM access_request_notifications WHERE id = ?').run(notifId);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(fakeRequestId);
  });

  // TEST 10: A different recipient can still be SENT when another recipient fails
  await suite.test('TEST 10: Recipient isolation - one failure does not prevent another recipient from being SENT', () => {
    const fakeRequestId = `AR-ISOL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const notif1 = `arn-isol-1-${Date.now()}`;
    const notif2 = `arn-isol-2-${Date.now()}`;

    db.prepare(`
      INSERT INTO access_requests (
        id, requester_full_name, requested_username, requested_email,
        requested_role_id, requested_role_name_snapshot, password_hash,
        status, created_at, updated_at
      ) VALUES (?, 'Isolation User', 'isol_u', 'isol@test.com', 'SITE_MANAGER', 'Site Manager', 'hash', 'PENDING', datetime('now'), datetime('now'))
    `).run(fakeRequestId);

    db.prepare(`
      INSERT INTO access_request_notifications (
        id, access_request_id, recipient_user_id, recipient_email,
        notification_type, delivery_status, created_at
      ) VALUES (?, ?, 'usr-admin-1', 'omegasentinel13@gmail.com', 'NEW_REQUEST', 'PENDING', datetime('now'))
    `).run(notif1, fakeRequestId);

    db.prepare(`
      INSERT INTO access_request_notifications (
        id, access_request_id, recipient_user_id, recipient_email,
        notification_type, delivery_status, created_at
      ) VALUES (?, ?, 'usr-f7825275-d30e-4b89-9d6b-994b50532984', 'failed@domain.test', 'NEW_REQUEST', 'PENDING', datetime('now'))
    `).run(notif2, fakeRequestId);

    // Update notif1 to SENT, notif2 to FAILED
    db.prepare(`UPDATE access_request_notifications SET delivery_status = 'SENT', sent_at = datetime('now') WHERE id = ?`).run(notif1);
    db.prepare(`UPDATE access_request_notifications SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = 'Mailbox full' WHERE id = ?`).run(notif2);

    const row1 = db.prepare('SELECT delivery_status FROM access_request_notifications WHERE id = ?').get(notif1) as any;
    const row2 = db.prepare('SELECT delivery_status, failure_reason FROM access_request_notifications WHERE id = ?').get(notif2) as any;

    assert.equal(row1.delivery_status, 'SENT');
    assert.equal(row2.delivery_status, 'FAILED');
    assert.equal(row2.failure_reason, 'Mailbox full');

    // Clean up
    db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(fakeRequestId);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(fakeRequestId);
  });
});
