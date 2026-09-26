import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';
import {
  getAppBaseUrl,
  renderNewAccessRequestEmail,
  renderAccessRequestApprovedEmail,
  renderAccessRequestDeniedEmail,
  sendAccessRequestNotification,
  dispatchAccessRequestEmail,
} from '../lib/email/access-request-mailer';
import {
  getTransactionalEmailProvider,
  setTestEmailProvider,
  ResendEmailProvider,
  SmtpEmailProvider,
  DevCapturedEmailProvider,
  MockTransactionalEmailProvider,
} from '../lib/email/providers';

test('HTTPS TRANSACTIONAL EMAIL PROVIDER ARCHITECTURE (TESTS 1 - 18)', async (suite) => {
  const origEnv = { ...process.env };
  const db = getDb();

  suite.afterEach(() => {
    process.env = { ...origEnv };
    setTestEmailProvider(null);
  });

  // TEST 1: Approver resolution dynamically reads recovery_email from database
  await suite.test('TEST 1: Approver resolution reads recovery_email dynamically from users table (zero hardcoded emails)', () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(approvers.length >= 2, 'Should resolve at least two administrative approvers');
    
    for (const app of approvers) {
      assert.ok(app.id, 'Approver must have an id');
      assert.ok(app.email, 'Approver must have an email');
      assert.ok(app.email.includes('@'), 'Approver email must be a valid email format');

      // Verify the email matches the database record directly
      const userRow = db.prepare('SELECT recovery_email FROM users WHERE id = ?').get(app.id) as { recovery_email: string };
      assert.equal(app.email, userRow.recovery_email, `Resolved email for ${app.username} must match users.recovery_email in DB`);
    }
  });

  // TEST 2: Production URL generation never contains localhost
  await suite.test('TEST 2: Canonical production URL generation never contains localhost:3000', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_URL;
    delete process.env.APP_URL;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    process.env.RAILWAY_ENVIRONMENT = 'production';

    const defaultProdUrl = getAppBaseUrl();
    assert.ok(!defaultProdUrl.includes('localhost'), 'Production URL must not contain localhost');
    assert.ok(defaultProdUrl.startsWith('https://'), 'Production URL must start with https://');

    // Test with explicit RAILWAY_PUBLIC_DOMAIN
    process.env.RAILWAY_PUBLIC_DOMAIN = 'sitework.up.railway.app';
    assert.equal(getAppBaseUrl(), 'https://sitework.up.railway.app');

    // Test with explicit APP_BASE_URL
    process.env.APP_BASE_URL = 'https://custom-domain.com/';
    assert.equal(getAppBaseUrl(), 'https://custom-domain.com', 'Trailing slash must be stripped');
  });

  // TEST 3: Localhost URL generation uses localhost:3000 in non-production
  await suite.test('TEST 3: Localhost URL generation defaults to http://localhost:3000 in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.APP_BASE_URL;
    delete process.env.APP_URL;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    delete process.env.RAILWAY_ENVIRONMENT;

    assert.equal(getAppBaseUrl(), 'http://localhost:3000');
  });

  // TEST 4: Factory resolves ResendEmailProvider in production or EMAIL_PROVIDER=resend
  await suite.test('TEST 4: Provider factory resolves ResendEmailProvider when EMAIL_PROVIDER=resend or in production', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    const provider1 = getTransactionalEmailProvider();
    assert.equal(provider1.name, 'resend');
    assert.ok(provider1 instanceof ResendEmailProvider);

    delete process.env.EMAIL_PROVIDER;
    process.env.NODE_ENV = 'production';
    const provider2 = getTransactionalEmailProvider();
    assert.equal(provider2.name, 'resend');
  });

  // TEST 5: Factory resolves SmtpEmailProvider in non-production when configured
  await suite.test('TEST 5: Provider factory resolves SmtpEmailProvider when EMAIL_PROVIDER=smtp in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.EMAIL_PROVIDER = 'smtp';

    const provider = getTransactionalEmailProvider();
    assert.equal(provider.name, 'smtp');
    assert.ok(provider instanceof SmtpEmailProvider);
  });

  // TEST 6: SmtpEmailProvider refuses execution in production (fails closed)
  await suite.test('TEST 6: SmtpEmailProvider refuses execution and fails closed in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PROD_SMTP;
    const smtp = new SmtpEmailProvider();

    const result = await smtp.send({
      to: 'approver@sitework.test',
      subject: 'Test',
      text: 'Test content',
      html: '<p>Test content</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'SMTP_DISALLOWED_IN_PRODUCTION');
  });

  // TEST 7: DevCapturedEmailProvider refuses execution in production (fails closed)
  await suite.test('TEST 7: DevCapturedEmailProvider refuses execution and fails closed in production', async () => {
    process.env.NODE_ENV = 'production';
    const devCaptured = new DevCapturedEmailProvider();

    const result = await devCaptured.send({
      to: 'approver@sitework.test',
      subject: 'Test',
      text: 'Test content',
      html: '<p>Test content</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'DEV_CAPTURED_DISALLOWED_IN_PRODUCTION');
  });

  // TEST 8: Provider factory defaults safely to DevCapturedEmailProvider in offline development
  await suite.test('TEST 8: Provider factory defaults safely to DevCapturedEmailProvider in offline development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_MODE;
    delete process.env.RAILWAY_ENVIRONMENT;

    const provider = getTransactionalEmailProvider();
    assert.equal(provider.name, 'dev_captured');
    assert.ok(provider instanceof DevCapturedEmailProvider);
  });

  // TEST 9: setTestEmailProvider successfully intercepts dispatch calls
  await suite.test('TEST 9: Test provider hook intercepts all sendAccessRequestNotification calls', async () => {
    const mock = new MockTransactionalEmailProvider();
    setTestEmailProvider(mock);

    const result = await sendAccessRequestNotification({
      to: 'test-hook@sitework.test',
      subject: 'Hook Test',
      text: 'Hello from hook test',
      html: '<p>Hello from hook test</p>',
      metadata: { requestId: 'AR-HOOK-01' },
    });

    assert.equal(result.success, true);
    assert.equal(result.deliveryStatus, 'SENT');
    assert.equal(mock.sentMessages.length, 1);
    assert.equal(mock.sentMessages[0].to, 'test-hook@sitework.test');
    assert.equal(mock.sentMessages[0].subject, 'Hook Test');
  });

  // TEST 10: ResendEmailProvider fails safely with MISSING_API_KEY when key is absent
  await suite.test('TEST 10: ResendEmailProvider halts safely with MISSING_API_KEY when key is empty', async () => {
    const resend = new ResendEmailProvider('');
    const result = await resend.send({
      to: 'target@sitework.test',
      subject: 'No Key Test',
      text: 'Body',
      html: '<p>Body</p>',
    });

    assert.equal(result.success, false);
    assert.equal(result.deliveryStatus, 'FAILED');
    assert.equal(result.errorCode, 'MISSING_API_KEY');
    assert.ok(result.errorMessage?.includes('RESEND_API_KEY'));
  });

  // TEST 11: ResendEmailProvider masks API keys in error logging
  await suite.test('TEST 11: ResendEmailProvider masks API keys in error messages so credentials are never leaked', async () => {
    const fakeSecretKey = 're_123456789_SecretKeyValue';
    const resend = new ResendEmailProvider(fakeSecretKey);

    // Override global fetch temporarily to simulate API rejection containing the key
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        message: `Authentication failed for key ${fakeSecretKey}`,
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const result = await resend.send({
        to: 'target@sitework.test',
        subject: 'Key Leak Test',
        text: 'Body',
        html: '<p>Body</p>',
      });

      assert.equal(result.success, false);
      assert.equal(result.deliveryStatus, 'FAILED');
      assert.ok(!result.errorMessage?.includes(fakeSecretKey), 'Error message must NOT contain raw secret key');
      assert.ok(result.errorMessage?.includes('***'), 'Error message must contain masked asterisk replacement');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // TEST 12: ResendEmailProvider sends Idempotency-Key and proper headers over HTTPS
  await suite.test('TEST 12: ResendEmailProvider includes Idempotency-Key and proper HTTPS headers', async () => {
    const resend = new ResendEmailProvider('re_valid_dummy_key');
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails');
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ id: 'resend_msg_abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const result = await resend.send({
        to: 'approver@sitework.test',
        subject: 'Idempotent Test',
        text: 'Idempotent Body',
        html: '<p>Idempotent Body</p>',
        idempotencyKey: 'idem-key-778899',
      });

      assert.equal(result.success, true);
      assert.equal(result.providerMessageId, 'resend_msg_abc123');
      assert.equal(capturedHeaders['Authorization'], 'Bearer re_valid_dummy_key');
      assert.equal(capturedHeaders['Idempotency-Key'], 'idem-key-778899');
      assert.deepEqual(capturedBody.to, ['approver@sitework.test']);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // TEST 13: ResendEmailProvider handles simulated 403 / 422 errors gracefully
  await suite.test('TEST 13: ResendEmailProvider handles simulated 403 / 422 HTTP responses cleanly', async () => {
    const resend = new ResendEmailProvider('re_valid_dummy_key');

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        statusCode: 403,
        message: 'You can only send testing emails to your own email address.',
        name: 'validation_error',
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const result = await resend.send({
        to: 'unverified-recipient@gmail.com',
        subject: 'Sandbox Test',
        text: 'Body',
        html: '<p>Body</p>',
      });

      assert.equal(result.success, false);
      assert.equal(result.deliveryStatus, 'FAILED');
      assert.equal(result.errorCode, 'RESEND_HTTP_403');
      assert.ok(result.errorMessage?.includes('only send testing emails'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // TEST 14: MockTransactionalEmailProvider supports custom per-recipient rules
  await suite.test('TEST 14: MockTransactionalEmailProvider correctly applies per-recipient rules', async () => {
    const mock = new MockTransactionalEmailProvider();
    mock.addRule({
      recipientPattern: 'fail@sitework.test',
      status: 'FAILED',
      errorCode: 'SIMULATED_BOUNCE',
      errorMessage: 'Mailbox does not exist',
    });

    const resSuccess = await mock.send({
      to: 'success@sitework.test',
      subject: 'Pass',
      text: 'Pass',
      html: '<p>Pass</p>',
    });
    assert.equal(resSuccess.success, true);
    assert.equal(resSuccess.deliveryStatus, 'SENT');

    const resFailure = await mock.send({
      to: 'fail@sitework.test',
      subject: 'Fail',
      text: 'Fail',
      html: '<p>Fail</p>',
    });
    assert.equal(resFailure.success, false);
    assert.equal(resFailure.deliveryStatus, 'FAILED');
    assert.equal(resFailure.errorCode, 'SIMULATED_BOUNCE');
  });

  // TEST 15: Recipient isolation - partial delivery failure records accurate database status
  await suite.test('TEST 15: Recipient isolation - failure for recipient A does not prevent recipient B from being SENT', async () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(approvers.length >= 2, 'Need 2 approvers for isolation test');

    const [approver1, approver2] = approvers;
    const mock = new MockTransactionalEmailProvider();
    // Rule: approver1 succeeds, approver2 fails
    mock.addRule({
      recipientPattern: approver2.email,
      status: 'FAILED',
      errorCode: 'RECIPIENT_BLOCKED',
      errorMessage: 'Simulated bounce for approver2',
    });
    setTestEmailProvider(mock);

    const testId = `isol_${Date.now()}`;
    const result = await AccessRequestRepository.createAccessRequest({
      fullName: 'Isolation Test',
      username: testId,
      email: `${testId}@sitework.test`,
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    });

    await result.dispatchPromise;

    const notifs = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ? ORDER BY recipient_user_id ASC').all(result.request.id) as any[];
    const notif1 = notifs.find(n => n.recipient_user_id === approver1.id);
    const notif2 = notifs.find(n => n.recipient_user_id === approver2.id);

    assert.equal(notif1?.delivery_status, 'SENT', 'Approver 1 notification must be marked SENT');
    assert.equal(notif2?.delivery_status, 'FAILED', 'Approver 2 notification must be marked FAILED');
    assert.ok(notif2?.failure_reason?.includes('Simulated bounce for approver2'), 'Approver 2 must record specific failure reason');

    // Clean up
    db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(result.request.id);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(result.request.id);
  });

  // TEST 16: End-to-end access request submission with Mock records transport in audit logs
  await suite.test('TEST 16: End-to-end access request submission logs transport in audit log', async () => {
    const mock = new MockTransactionalEmailProvider();
    setTestEmailProvider(mock);

    const testId = `audit_${Date.now()}`;
    const result = await AccessRequestRepository.createAccessRequest({
      fullName: 'Audit Log Test',
      username: testId,
      email: `${testId}@sitework.test`,
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    });

    await result.dispatchPromise;

    const auditLogs = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE entity_type = 'ACCESS_REQUEST' AND entity_id = ? AND action = 'NOTIFICATION_SENT'
    `).all(result.request.id) as any[];

    assert.ok(auditLogs.length >= 1, 'Should have at least one NOTIFICATION_SENT audit record');
    const afterState = JSON.parse(auditLogs[0].after_state);
    assert.equal(afterState.transport, 'mock', 'Audit log must record the actual provider transport');

    // Clean up
    db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(result.request.id);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(result.request.id);
  });

  // TEST 17: Dynamic approver update - updating users.recovery_email immediately dispatches to new email
  await suite.test('TEST 17: Dynamic approver update immediately affects recipient address on subsequent requests', async () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const targetApprover = approvers[0];
    const originalEmail = targetApprover.email;
    const temporaryEmail = `temp_${Date.now()}@sitework.dynamic`;

    const mock = new MockTransactionalEmailProvider();
    setTestEmailProvider(mock);

    try {
      // Dynamically update recovery email in database
      db.prepare('UPDATE users SET recovery_email = ? WHERE id = ?').run(temporaryEmail, targetApprover.id);

      const updatedApprovers = AccessRequestRepository.resolveAccessRequestApprovers();
      const updatedMatch = updatedApprovers.find(a => a.id === targetApprover.id);
      assert.equal(updatedMatch?.email, temporaryEmail, 'Updated approver must reflect new recovery_email immediately');

      const testId = `dyn_${Date.now()}`;
      const result = await AccessRequestRepository.createAccessRequest({
        fullName: 'Dynamic Recipient Test',
        username: testId,
        email: `${testId}@sitework.test`,
        passwordPlainText: 'Password123!',
        roleId: 'SITE_MANAGER',
      });

      await result.dispatchPromise;

      const sentToTemp = mock.sentMessages.some(m => m.to === temporaryEmail);
      assert.ok(sentToTemp, `Dispatcher must have sent notification to new email: ${temporaryEmail}`);

      // Clean up request
      db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(result.request.id);
      db.prepare('DELETE FROM access_requests WHERE id = ?').run(result.request.id);
    } finally {
      // Revert recovery email
      db.prepare('UPDATE users SET recovery_email = ? WHERE id = ?').run(originalEmail, targetApprover.id);
    }
  });

  // TEST 18: Full lifecycle verification - public submission creates PENDING; approval creates user with canonical login URL
  await suite.test('TEST 18: Full request lifecycle - submission creates PENDING, approval generates canonical login URL', async () => {
    process.env.APP_BASE_URL = 'https://site-work-app-production.up.railway.app';
    const mock = new MockTransactionalEmailProvider();
    setTestEmailProvider(mock);

    const testId = `lifecycle_${Date.now()}`;
    const submission = await AccessRequestRepository.createAccessRequest({
      fullName: 'Lifecycle Test User',
      username: testId,
      email: `${testId}@sitework.test`,
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    });

    await submission.dispatchPromise;
    assert.equal(submission.request.status, 'PENDING');

    // Verify reviewer reviewUrl contains production base URL and never localhost
    const notificationMessage = mock.sentMessages[0];
    assert.ok(notificationMessage.html.includes('https://site-work-app-production.up.railway.app/setup/users?requestId='));
    assert.ok(!notificationMessage.html.includes('localhost'));

    // Approver approves request
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const reviewer = approvers[0];
    const approvalResult = AccessRequestRepository.approveAccessRequest(
      submission.request.id,
      { userId: reviewer.id, role: 'System Administrator' }
    );

    assert.ok(approvalResult.user?.id);

    // Wait for async approval email dispatch
    await new Promise(r => setTimeout(r, 100));

    // Verify approval email was sent with canonical login URL
    const approvalEmail = mock.sentMessages.find(m => m.to === `${testId}@sitework.test`);
    assert.ok(approvalEmail, 'Approval email must be dispatched to requester');
    assert.ok(approvalEmail.html.includes('https://site-work-app-production.up.railway.app/login'));
    assert.ok(!approvalEmail.html.includes('localhost'));

    // Clean up created user and notifications
    db.prepare('DELETE FROM access_request_notifications WHERE access_request_id = ?').run(submission.request.id);
    db.prepare('DELETE FROM access_requests WHERE id = ?').run(submission.request.id);
    if (approvalResult.user?.id) {
      db.prepare('DELETE FROM site_users WHERE user_id = ?').run(approvalResult.user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(approvalResult.user.id);
    }
  });
});
