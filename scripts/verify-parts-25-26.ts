import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getDb } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';

async function main() {
  console.log('================================================================');
  console.log('PART 25 & 26: DYNAMIC RECOVERY EMAIL & PERMISSION DELEGATION TESTS');
  console.log('================================================================\n');

  const db = getDb();

  // ============================================================================
  // PART 25: Dynamic Recovery Email Propagation
  // ============================================================================
  console.log('--- PART 25: Dynamic Recovery Email Propagation ---');

  // Step 1: Verify AB Admin currently points to supermanskrypton@gmail.com
  const abAdmin = db.prepare("SELECT id, recovery_email FROM users WHERE username = 'abadmin'").get() as any;
  console.log('1. Current AB Admin recovery email:', abAdmin.recovery_email);
  assert.equal(abAdmin.recovery_email, 'supermanskrypton@gmail.com');

  const originalEmail = abAdmin.recovery_email;
  const tempEmail = 'abadmin.dynamic.test@sitework.local';

  try {
    // Step 4: Temporarily change AB Admin recovery email in LOCALHOST
    console.log(`2. Updating AB Admin recovery_email to: ${tempEmail}`);
    db.prepare("UPDATE users SET recovery_email = ? WHERE username = 'abadmin'").run(tempEmail);

    // Step 5 & 6: Verify NEW email is targeted in resolver
    const approversUpdated = AccessRequestRepository.resolveAccessRequestApprovers();
    const abAdminUpdated = approversUpdated.find((a) => a.username.toLowerCase() === 'abadmin');
    console.log('3. Resolved AB Admin target after update:', abAdminUpdated?.email);
    assert.equal(abAdminUpdated?.email, tempEmail.toLowerCase());
    console.log('   ✓ [PASS] Dynamic recovery email updated target successfully');
  } finally {
    // Step 7: Restore supermanskrypton@gmail.com
    console.log('4. Restoring original recovery email: supermanskrypton@gmail.com');
    db.prepare("UPDATE users SET recovery_email = ? WHERE username = 'abadmin'").run(originalEmail);
  }

  // Step 8 & 9: Verify original address is targeted again
  const approversRestored = AccessRequestRepository.resolveAccessRequestApprovers();
  const abAdminRestored = approversRestored.find((a) => a.username.toLowerCase() === 'abadmin');
  console.log('5. Resolved AB Admin target after restore:', abAdminRestored?.email);
  assert.equal(abAdminRestored?.email, originalEmail.toLowerCase());
  console.log('   ✓ [PASS] Dynamic recovery email reverted successfully\n');

  // ============================================================================
  // PART 26: Permission Delegation Test
  // ============================================================================
  console.log('--- PART 26: Permission Delegation Test ---');

  // Find or use a test administrator: usr-test-delegated-admin
  const delegatedUser = db.prepare("SELECT id, username, recovery_email FROM users WHERE username = 'std_with_email'").get() as any;
  assert.ok(delegatedUser, 'Delegated user std_with_email must exist');
  console.log('1. Delegated test user:', delegatedUser.username, `(${delegatedUser.recovery_email})`);

  // Initial check: delegated user should NOT be an approver
  let approvers = AccessRequestRepository.resolveAccessRequestApprovers();
  assert.ok(!approvers.some((a) => a.id === delegatedUser.id), 'Delegated user must not initially have review authority');
  console.log('   Initial approvers count:', approvers.length);

  try {
    // Grant ACCESS_REQUEST_REVIEW via Permission Matrix
    console.log('2. Granting ACCESS_REQUEST_REVIEW override to:', delegatedUser.username);
    PermissionRepository.setUserOverride({
      userId: delegatedUser.id,
      permissionId: 'perm-gov-access-review',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    console.log('   Approvers count after grant:', approvers.length);
    const delegatedApprover = approvers.find((a) => a.id === delegatedUser.id);
    assert.ok(delegatedApprover, 'Delegated admin must be included in approver list');
    assert.equal(delegatedApprover?.email, delegatedUser.recovery_email.toLowerCase());
    console.log('   ✓ [PASS] Delegated administrator resolved with review permission');
  } finally {
    // Revoke permission
    console.log('3. Revoking ACCESS_REQUEST_REVIEW override from:', delegatedUser.username);
    PermissionRepository.removeUserOverride(delegatedUser.id, 'perm-gov-access-review', null);
  }

  // Verify revocation excludes administrator
  approvers = AccessRequestRepository.resolveAccessRequestApprovers();
  console.log('4. Approvers count after revocation:', approvers.length);
  assert.ok(!approvers.some((a) => a.id === delegatedUser.id), 'Delegated admin must be excluded after revocation');
  console.log('   ✓ [PASS] Permission revocation stops notification eligibility\n');

  console.log('================================================================');
  console.log('PART 25 & PART 26 VERIFICATION PASSED (100% SUCCESS)');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
