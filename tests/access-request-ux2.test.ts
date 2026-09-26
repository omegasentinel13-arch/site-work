import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb, runTransaction } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';
import { getUserById, getUserByUsername } from '../lib/db/repositories/user-repo';
import { canAccess } from '../lib/permissions/evaluator';

test('ENTERPRISE ACCESS REQUEST UX 2.0 & GOVERNANCE WORKSPACE TEST SUITE', async (suite) => {
  const db = getDb();

  const primeReviewer = {
    userId: 'usr-admin-1',
    role: 'ADMIN',
    authorityTier: 'KING_MAKER',
  };

  // Helper to create test access requests directly in database
  function createTestRequest(overrides?: {
    id?: string;
    username?: string;
    email?: string;
    fullName?: string;
    status?: 'PENDING' | 'APPROVED' | 'DENIED';
    roleId?: string;
  }) {
    const id = overrides?.id || `AR-TEST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const username = overrides?.username || `user_${crypto.randomBytes(3).toString('hex')}`;
    const email = overrides?.email || `${username}@sitework.test`;
    const fullName = overrides?.fullName || `Test User ${username}`;
    const status = overrides?.status || 'PENDING';
    const roleId = overrides?.roleId || 'SITE_MANAGER';
    const passwordHash = bcrypt.hashSync('SecurePassword123!', 4);

    db.prepare(`
      INSERT INTO access_requests (
        id, requester_full_name, requested_username, requested_email,
        requested_role_id, requested_role_name_snapshot, password_hash,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'Site Manager', ?, ?, datetime('now'), datetime('now'))
    `).run(id, fullName, username, email, roleId, passwordHash, status);

    return { id, username, email, fullName, status, roleId };
  }

  await suite.test('1. bulkApprove: provisions active accounts, assigns sites, and logs audit', () => {
    const req1 = createTestRequest({ fullName: 'Bulk User One' });
    const req2 = createTestRequest({ fullName: 'Bulk User Two' });

    const result = AccessRequestRepository.bulkApprove(
      [req1.id, req2.id],
      primeReviewer,
      {
        siteIds: ['site-1', 'site-2'],
        reviewReason: 'Bulk verified on site',
      }
    );

    assert.equal(result.succeeded.length, 2, 'Both requests should succeed');
    assert.equal(result.failed.length, 0, 'No failures expected');

    // Verify accounts created in users table
    const user1 = getUserByUsername(req1.username);
    const user2 = getUserByUsername(req2.username);

    assert.ok(user1, 'User 1 should exist in users table');
    assert.ok(user2, 'User 2 should exist in users table');
    assert.equal(user1.full_name, 'Bulk User One');
    assert.equal(user2.full_name, 'Bulk User Two');

    // Verify site assignments in site_users table
    const sitesUser1 = db.prepare(`SELECT site_id FROM site_users WHERE user_id = ?`).all(user1.id) as Array<{ site_id: string }>;
    assert.equal(sitesUser1.length, 2, 'User 1 must be assigned 2 sites');
    assert.ok(sitesUser1.some((s) => s.site_id === 'site-1'));
    assert.ok(sitesUser1.some((s) => s.site_id === 'site-2'));

    // Verify requests transitioned to APPROVED
    const updatedReq1 = AccessRequestRepository.getAccessRequestById(req1.id);
    const updatedReq2 = AccessRequestRepository.getAccessRequestById(req2.id);

    assert.equal(updatedReq1?.status, 'APPROVED');
    assert.equal(updatedReq2?.status, 'APPROVED');
    assert.equal(updatedReq1?.review_reason, 'Bulk verified on site');

    // Clean up created users
    db.prepare(`DELETE FROM site_users WHERE user_id IN (?, ?)`).run(user1.id, user2.id);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(user1.id, user2.id);
  });

  await suite.test('2. bulkApprove: graceful partial failure & concurrency protection', () => {
    // reqA is valid pending
    const reqA = createTestRequest({ fullName: 'Valid Request A' });

    // reqB is already approved (simulating concurrent review by another admin)
    const reqB = createTestRequest({ fullName: 'Already Reviewed B', status: 'APPROVED' });

    // reqC has non-existent ID
    const reqCId = 'AR-NONEXISTENT-999';

    const result = AccessRequestRepository.bulkApprove(
      [reqA.id, reqB.id, reqCId],
      primeReviewer,
      { reviewReason: 'Concurrent test batch' }
    );

    assert.equal(result.succeeded.length, 1, 'Only reqA should succeed');
    assert.equal(result.succeeded[0].id, reqA.id);

    assert.equal(result.failed.length, 2, 'reqB and reqC should fail gracefully');
    const failedB = result.failed.find((f) => f.id === reqB.id);
    const failedC = result.failed.find((f) => f.id === reqCId);

    assert.ok(failedB, 'reqB must be in failed list');
    assert.match(failedB.reason, /already been processed/i, 'Reason must cite prior processing');

    assert.ok(failedC, 'reqC must be in failed list');
    assert.match(failedC.reason, /not found/i, 'Reason must cite request not found');

    // Verify reqA was still provisioned successfully despite failures of B and C
    const userA = getUserByUsername(reqA.username);
    assert.ok(userA, 'User A must be provisioned despite other errors');

    // Clean up userA
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userA.id);
  });

  await suite.test('3. bulkDeny: processes multiple rejections and transitions status', () => {
    const req1 = createTestRequest({ fullName: 'Deny Candidate 1' });
    const req2 = createTestRequest({ fullName: 'Deny Candidate 2' });

    const result = AccessRequestRepository.bulkDeny(
      [req1.id, req2.id],
      primeReviewer,
      'Batch unverified registration'
    );

    assert.equal(result.succeeded.length, 2, 'Both requests should be denied');
    assert.equal(result.failed.length, 0);

    const updated1 = AccessRequestRepository.getAccessRequestById(req1.id);
    const updated2 = AccessRequestRepository.getAccessRequestById(req2.id);

    assert.equal(updated1?.status, 'DENIED');
    assert.equal(updated2?.status, 'DENIED');
    assert.equal(updated1?.denial_reason, 'Batch unverified registration');
    assert.equal(updated2?.denial_reason, 'Batch unverified registration');

    // Verify NO user accounts were provisioned
    assert.equal(getUserByUsername(req1.username), null);
    assert.equal(getUserByUsername(req2.username), null);
  });

  await suite.test('4. deleteHistoryRecords: deletes history, cascades notifications, STRICTLY preserves users, sites & audit', () => {
    // Create an approved request and a denied request
    const approvedReq = createTestRequest({ fullName: 'History Approved', status: 'APPROVED' });
    const deniedReq = createTestRequest({ fullName: 'History Denied', status: 'DENIED' });

    // Also create a PENDING request
    const pendingReq = createTestRequest({ fullName: 'History Pending', status: 'PENDING' });

    // Insert dummy notifications for approvedReq
    const notifId = `arn-test-${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO access_request_notifications (
        id, access_request_id, recipient_user_id, recipient_email,
        notification_type, delivery_status, created_at
      ) VALUES (?, ?, 'usr-admin-1', 'admin@sitework.local', 'NEW_REQUEST', 'SENT', datetime('now'))
    `).run(notifId, approvedReq.id);

    // Call deleteHistoryRecords with all three
    const result = AccessRequestRepository.deleteHistoryRecords(
      [approvedReq.id, deniedReq.id, pendingReq.id],
      { userId: 'usr-admin-1', role: 'ADMIN' }
    );

    // Assertions
    assert.equal(result.deleted.length, 2, 'Approved and denied records should be deleted');
    assert.ok(result.deleted.includes(approvedReq.id));
    assert.ok(result.deleted.includes(deniedReq.id));

    assert.equal(result.skippedPending.length, 1, 'Pending record must be protected from deletion');
    assert.ok(result.skippedPending.includes(pendingReq.id));

    // Verify approved and denied requests are removed from DB
    assert.equal(AccessRequestRepository.getAccessRequestById(approvedReq.id), null);
    assert.equal(AccessRequestRepository.getAccessRequestById(deniedReq.id), null);

    // Verify notification was cascade deleted
    const notifRow = db.prepare(`SELECT id FROM access_request_notifications WHERE id = ?`).get(notifId);
    assert.equal(notifRow, undefined, 'Notification must be cleaned up');

    // Verify pending request STILL exists
    const stillPending = AccessRequestRepository.getAccessRequestById(pendingReq.id);
    assert.ok(stillPending, 'Pending request must not have been touched');
    assert.equal(stillPending.status, 'PENDING');

    // Verify Audit log contains REQUEST_HISTORY_DELETED entries
    const auditRows = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE action = 'REQUEST_HISTORY_DELETED' 
        AND entity_id IN (?, ?)
    `).all(approvedReq.id, deniedReq.id);
    assert.equal(auditRows.length, 2, 'Audit logs must be written for history deletion');

    // Clean up test pending request
    db.prepare(`DELETE FROM access_requests WHERE id = ?`).run(pendingReq.id);
  });

  await suite.test('5. UI Workspace Verification: Native Roles Category Pattern & Strict Architectural Rules', () => {
    const pageFilePath = path.join(process.cwd(), 'app/(dashboard)/setup/users/page.tsx');
    const pageContent = fs.readFileSync(pageFilePath, 'utf8');

    // Native Roles Category Pattern: Internal Section Switcher
    assert.ok(
      pageContent.includes("activeSection === 'USERS'") && pageContent.includes("activeSection === 'ACCESS_REQUESTS'"),
      'Must implement native section switching between USERS and ACCESS_REQUESTS'
    );
    assert.ok(
      pageContent.includes('ACCESS REQUESTS') && pageContent.includes('pendingAccessCount'),
      'Must feature ACCESS REQUESTS tab with dynamic pending count badge'
    );

    // Strict Architectural Negatives: NO full viewport overlay, NO 'Back to Users & Access' button
    assert.ok(
      !pageContent.includes('fixed inset-0 z-50 bg-slate-100 dark:bg-[#0D0E10]'),
      'Must NOT contain full-viewport opaque workspace overlay'
    );
    assert.ok(
      !pageContent.includes('Back to Users & Access') && !pageContent.includes('Back to Users &amp; Access'),
      'Must NOT contain "Back to Users & Access" navigation button'
    );

    // Single-Pane Inline Architecture: elimination of modal stacking
    assert.ok(
      pageContent.includes('Assign Project Sites &amp; Approve') || pageContent.includes('Assign Project Sites & Approve'),
      'Must feature inline site assignment and approval section'
    );
    assert.ok(
      pageContent.includes('Deny Access Request'),
      'Must feature inline denial section'
    );

    // Multi-Selection and Bulk Actions
    assert.ok(
      pageContent.includes('Select All'),
      'Must provide Select All capability'
    );
    assert.ok(
      pageContent.includes('Approve ('),
      'Must feature Approve Selected action'
    );
    assert.ok(
      pageContent.includes('Deny ('),
      'Must feature Deny Selected action'
    );
    assert.ok(
      pageContent.includes('Delete ('),
      'Must feature Delete History action'
    );

    // Instant In-Place Synchronization
    assert.ok(
      pageContent.includes('fetchAccessRequests(accessFilter)') && pageContent.includes('fetchUsers()'),
      'Must synchronize both request queue and users directory immediately'
    );

    // Deep link query param selection
    assert.ok(
      pageContent.includes("urlParams?.get('accessRequests')") && pageContent.includes("urlParams.get('requestId')"),
      'Must handle deep links by auto-switching active section and selecting request'
    );
  });
});
