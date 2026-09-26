import { getDb } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import assert from 'node:assert/strict';

// Load .env.local
import fs from 'fs';
import path from 'path';
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

async function runMatrix() {
  const db = getDb();
  console.log('============================================================');
  console.log('STARTING MASTER CTO ACCESS REQUEST VERIFICATION MATRIX');
  console.log('============================================================');

  // PART 12: Controlled Multi-Recipient Real Submission Test
  console.log('\n--- PART 12: Controlled Multi-Recipient Real Submission Test ---');
  const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
  console.log('Resolved approvers count:', approvers.length);
  approvers.forEach((a, i) => console.log(`  [${i+1}] ${a.username} (${a.authorityTier}) -> ${a.email}`));

  assert.ok(approvers.some(a => a.username === 'Iamadmin' && a.email === 'omegasentinel13@gmail.com'), 'Iamadmin must be resolved');
  assert.ok(approvers.some(a => a.username === 'abadmin' && a.email === 'supermanskrypton@gmail.com'), 'abadmin must be resolved');

  const testId12 = Date.now().toString().slice(-4);
  const reqResult12 = AccessRequestRepository.createAccessRequest({
    fullName: `Multi Recipient QA ${testId12}`,
    username: `multi_qa_${testId12}`,
    email: `multi_qa_${testId12}@sitework.local`,
    passwordPlainText: 'ValidPassword123!',
    roleId: 'SITE_MANAGER',
  });

  console.log(`Created request: ${reqResult12.request.id}`);
  if (reqResult12.dispatchPromise) {
    console.log('Awaiting sequential SMTP dispatch...');
    await reqResult12.dispatchPromise;
  }

  const notifs12 = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ?').all(reqResult12.request.id) as any[];
  console.log('Notification records:');
  notifs12.forEach(n => console.log(`  Recipient: ${n.recipient_email} | Status: ${n.delivery_status} | SentAt: ${n.sent_at} | Failure: ${n.failure_reason}`));

  assert.equal(notifs12.length, 2, 'Must create exactly 2 notification records');
  assert.ok(notifs12.every(n => n.delivery_status === 'SENT'), 'Both notifications must be SENT via SMTP');
  console.log('PART 12: PASSED! Both approvers received SMTP delivery.');

  // PART 14: Dynamic Recovery Email Change Test
  console.log('\n--- PART 14: Dynamic Recovery Email Change Test ---');
  const origAbRow = db.prepare("SELECT recovery_email FROM users WHERE username = 'abadmin'").get() as { recovery_email: string };
  const originalEmail = origAbRow.recovery_email;
  const tempEmail = 'abadmin.dynamic.test@sitework.local';

  try {
    console.log(`Updating abadmin recovery_email from '${originalEmail}' to '${tempEmail}'...`);
    db.prepare("UPDATE users SET recovery_email = ? WHERE username = 'abadmin'").run(tempEmail);

    const approversDynamic = AccessRequestRepository.resolveAccessRequestApprovers();
    const abDynamic = approversDynamic.find(a => a.username === 'abadmin');
    console.log('abadmin resolved email after update:', abDynamic?.email);
    assert.equal(abDynamic?.email, tempEmail.toLowerCase(), 'Must immediately reflect updated email');

    // Create a request in dev mode to test dispatch to new email
    process.env.EMAIL_MODE = 'development';
    const testId14 = Date.now().toString().slice(-4);
    const reqResult14 = AccessRequestRepository.createAccessRequest({
      fullName: `Dynamic Email QA ${testId14}`,
      username: `dyn_qa_${testId14}`,
      email: `dyn_qa_${testId14}@sitework.local`,
      passwordPlainText: 'ValidPassword123!',
      roleId: 'VIEWER',
    });
    if (reqResult14.dispatchPromise) await reqResult14.dispatchPromise;

    const notifs14 = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ?').all(reqResult14.request.id) as any[];
    const abNotif = notifs14.find(n => n.recipient_user_id === abDynamic?.id);
    console.log('Notification sent to abadmin new email:', abNotif?.recipient_email, '| Status:', abNotif?.delivery_status);
    assert.equal(abNotif?.recipient_email, tempEmail.toLowerCase());
  } finally {
    console.log(`Restoring abadmin recovery_email to '${originalEmail}'...`);
    db.prepare("UPDATE users SET recovery_email = ? WHERE username = 'abadmin'").run(originalEmail);
    process.env.EMAIL_MODE = 'smtp';
  }

  const approversRestored = AccessRequestRepository.resolveAccessRequestApprovers();
  const abRestored = approversRestored.find(a => a.username === 'abadmin');
  assert.equal(abRestored?.email, originalEmail.toLowerCase(), 'Must revert cleanly to original email');
  console.log('PART 14: PASSED! Dynamic recovery email update and reversion verified.');

  // PART 15: Deactivation Test
  console.log('\n--- PART 15: Deactivation Test ---');
  try {
    console.log('Deactivating abadmin (is_active = 0)...');
    db.prepare("UPDATE users SET is_active = 0 WHERE username = 'abadmin'").run();

    const approversDeactivated = AccessRequestRepository.resolveAccessRequestApprovers();
    console.log('Approver count after deactivation:', approversDeactivated.length);
    assert.ok(!approversDeactivated.some(a => a.username === 'abadmin'), 'Deactivated admin must be excluded');
    console.log('abadmin is successfully excluded while deactivated.');
  } finally {
    console.log('Reactivating abadmin (is_active = 1)...');
    db.prepare("UPDATE users SET is_active = 1 WHERE username = 'abadmin'").run();
  }

  const approversReactivated = AccessRequestRepository.resolveAccessRequestApprovers();
  assert.ok(approversReactivated.some(a => a.username === 'abadmin'), 'Reactivated admin must be included again');
  console.log('PART 15: PASSED! Deactivation exclusion and reactivation inclusion verified.');

  // PART 16: Permission Delegation Test (STAR-SCREW)
  console.log('\n--- PART 16: Permission Delegation Test (STAR-SCREW) ---');
  const starUser = db.prepare("SELECT id, username, recovery_email FROM users WHERE username = 'STAR-SCREW'").get() as any;
  const starEmail = 'star.screw.qa@sitework.local';

  // Clean any old override
  db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_id = 'perm-gov-access-review'").run(starUser.id);
  db.prepare("UPDATE users SET recovery_email = NULL WHERE id = ?").run(starUser.id);

  let approvers16 = AccessRequestRepository.resolveAccessRequestApprovers();
  assert.ok(!approvers16.some(a => a.id === starUser.id), 'STAR-SCREW initially not an approver');
  console.log('Initial check: STAR-SCREW not an approver (no permission, no email).');

  try {
    // Step 1: Set recovery email and grant ACCESS_REQUEST_REVIEW
    console.log('Granting perm-gov-access-review (ALLOW) and setting recovery email for STAR-SCREW...');
    db.prepare("UPDATE users SET recovery_email = ? WHERE id = ?").run(starEmail, starUser.id);
    db.prepare(`
      INSERT INTO user_permission_overrides (id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at)
      VALUES (?, ?, 'perm-gov-access-review', NULL, 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(`upo-${starUser.id}-delegation-qa`, starUser.id);

    approvers16 = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(approvers16.some(a => a.id === starUser.id), 'STAR-SCREW must now be an approver');
    console.log('STAR-SCREW is now successfully included as an approver.');

    // Step 2: Revoke permission (DELETE override)
    console.log('Revoking permission (deleting override)...');
    db.prepare("DELETE FROM user_permission_overrides WHERE id = ?").run(`upo-${starUser.id}-delegation-qa`);

    approvers16 = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(!approvers16.some(a => a.id === starUser.id), 'STAR-SCREW must be excluded after revocation');
    console.log('STAR-SCREW is successfully excluded after revocation.');

    // Step 3: Explicit DENY
    console.log('Granting explicit DENY override...');
    db.prepare(`
      INSERT INTO user_permission_overrides (id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at)
      VALUES (?, ?, 'perm-gov-access-review', NULL, 'DENY', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(`upo-${starUser.id}-delegation-qa`, starUser.id);

    approvers16 = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(!approvers16.some(a => a.id === starUser.id), 'STAR-SCREW must be excluded with DENY override');
    console.log('STAR-SCREW is strictly excluded with explicit DENY override.');
  } finally {
    // Clean up STAR-SCREW
    db.prepare("DELETE FROM user_permission_overrides WHERE id = ?").run(`upo-${starUser.id}-delegation-qa`);
    db.prepare("UPDATE users SET recovery_email = NULL WHERE id = ?").run(starUser.id);
  }

  console.log('PART 16: PASSED! Delegation, revocation, and explicit DENY verified.');

  console.log('\n============================================================');
  console.log('ALL VERIFICATION MATRIX PARTS (12, 14, 15, 16) PASSED 100%!');
  console.log('============================================================');
}

runMatrix().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
