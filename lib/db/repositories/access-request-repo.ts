import { getDb, runTransaction } from '../index';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { DatabaseSync } from 'node:sqlite';
import { logAudit, logAuditInTransaction } from '@/lib/audit/logger';
import {
  dispatchAccessRequestEmail,
  renderNewAccessRequestEmail,
  renderAccessRequestApprovedEmail,
  renderAccessRequestDeniedEmail,
} from '@/lib/email/access-request-mailer';
import { canAccess } from '@/lib/permissions/evaluator';

export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED' | 'EXPIRED';
export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEV_CAPTURED';
export type NotificationType = 'NEW_REQUEST' | 'APPROVAL' | 'DENIAL' | 'REMINDER';

export interface AccessRequestRecord {
  id: string;
  requester_full_name: string;
  requested_username: string;
  requested_email: string;
  requested_role_id: string;
  requested_role_name_snapshot: string;
  password_hash: string;
  status: AccessRequestStatus;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewer_role: string | null;
  review_reason: string | null;
  denial_reason: string | null;
  approval_timestamp: string | null;
  expires_at: string | null;
  request_metadata: string | null;
  status_token_hash: string | null;
}

export interface AccessRequestNotificationRecord {
  id: string;
  access_request_id: string;
  recipient_user_id: string;
  recipient_email: string;
  notification_type: NotificationType;
  delivery_status: NotificationDeliveryStatus;
  created_at: string;
  sent_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

export interface ApproverPrincipal {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: string;
  authorityTier: string;
  delegationSource: 'PRIME_AUTHORITY' | 'PERMISSION_MATRIX';
}

// Requestable public role whitelist
export const PUBLIC_REQUESTABLE_ROLES: Record<string, { id: string; name: string }> = {
  SITE_MANAGER: { id: 'SITE_MANAGER', name: 'Engineer / Site Manager' },
  VIEWER: { id: 'VIEWER', name: 'Viewer / Auditor' },
};

function generateRequestId(): string {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    rand += chars[bytes[i] % chars.length];
  }
  return `AR-${rand}`;
}

export class AccessRequestRepository {
  /**
   * Resolves eligible approvers who should receive access request notifications.
   * Deterministic, 100% permission-driven pipeline (Zero hardcoded tiers, accounts, or emails):
   * 1. Query active users (is_active = 1) who have a valid, non-empty recovery_email.
   * 2. Evaluates eligibility using the canonical permission engine:
   *    - Excludes accounts with explicit DENY overrides on ACCESS_REQUEST_REVIEW.
   *    - Confirms access via canAccess (PAGE_ACCESS_REQUESTS / PAGE_SETUP_USERS) or explicit ALLOW overrides.
   * 3. Sanitizes and deduplicates by email address case-insensitively.
   * 4. When an administrator updates their recovery_email, future queries immediately
   *    and automatically read the updated address directly from the database.
   */
  static resolveAccessRequestApprovers(dbInstance?: DatabaseSync): ApproverPrincipal[] {
    const db = dbInstance || getDb();
    const approversMap = new Map<string, ApproverPrincipal>();
    const seenEmails = new Set<string>();

    const rows = db.prepare(`
      SELECT id, username, full_name, role, authority_tier, is_active, recovery_email, created_at
      FROM users
      WHERE is_active = 1
        AND recovery_email IS NOT NULL
        AND TRIM(recovery_email) != ''
      ORDER BY 
        CASE authority_tier
          WHEN 'KING_MAKER' THEN 1
          WHEN 'SUPERIOR_PRIME' THEN 2
          WHEN 'CLIENT_PRIME' THEN 3
          WHEN 'STANDARD_ADMIN' THEN 4
          ELSE 5
        END ASC,
        created_at ASC
    `).all() as Array<{
      id: string;
      username: string;
      full_name: string;
      role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
      authority_tier: string;
      is_active: number;
      recovery_email: string;
      created_at: string;
    }>;

    for (const r of rows) {
      if (!r.recovery_email || !r.recovery_email.trim()) continue;
      const trimmedEmail = r.recovery_email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) continue;

      // Canonical Permission Evaluation via canAccess engine
      const session = {
        id: r.id,
        userId: r.id,
        role: r.role,
        authorityTier: r.authority_tier as any,
        isActive: Boolean(r.is_active),
      };

      const accessDecision = canAccess({
        session,
        page: 'PAGE_ACCESS_REQUESTS',
        action: 'ACCESS_REQUEST_REVIEW',
      });

      if (accessDecision.allowed && !seenEmails.has(trimmedEmail)) {
        seenEmails.add(trimmedEmail);
        approversMap.set(r.id, {
          id: r.id,
          username: r.username,
          fullName: r.full_name,
          email: trimmedEmail,
          role: r.role,
          authorityTier: r.authority_tier,
          delegationSource: 'PERMISSION_MATRIX',
        });
      }
    }

    return Array.from(approversMap.values());
  }

  /**
   * Submits a new public access request.
   * Transactional, exact username collision checks, public role validation,
   * safe password hashing, notification queuing, and audit logging.
   */
  static createAccessRequest(params: {
    fullName: string;
    username: string;
    email: string;
    passwordPlainText: string;
    roleId: string;
    metadata?: Record<string, unknown>;
  }): { request: AccessRequestRecord; statusToken: string; approverCount: number; dispatchPromise?: Promise<void> } {
    const db = getDb();

    // 1. Full name validation
    const fullName = (params.fullName || '').trim();
    if (!fullName || fullName.length < 2) {
      throw new Error('Full Name is required and must be at least 2 characters long.');
    }
    if (fullName.length > 100) {
      throw new Error('Full Name must not exceed 100 characters.');
    }

    // 2. Exact username validation (Case-sensitive, character-sensitive, NO silent trimming)
    const rawUsername = params.username;
    if (typeof rawUsername !== 'string' || !rawUsername) {
      throw new Error('Username is required.');
    }
    if (rawUsername.length < 3 || rawUsername.length > 40) {
      throw new Error('Username must be between 3 and 40 characters long.');
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(rawUsername)) {
      throw new Error('Username can only contain alphanumeric characters, underscores, hyphens, and periods.');
    }

    // 3. Email validation
    const rawEmail = (params.email || '').trim().toLowerCase();
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      throw new Error('A valid email address is required.');
    }

    // 4. Password validation
    const password = params.passwordPlainText;
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    // 5. Role validation & Public Requestable Policy
    const normalizedRoleId = (params.roleId || '').trim();
    if (!normalizedRoleId) {
      throw new Error('Please select an intended role.');
    }

    // Check if role is an unapproved privileged role
    if (
      normalizedRoleId === 'ADMIN' ||
      normalizedRoleId === 'KING_MAKER' ||
      normalizedRoleId === 'SUPERIOR_PRIME' ||
      normalizedRoleId === 'CLIENT_PRIME' ||
      normalizedRoleId === 'STANDARD_ADMIN'
    ) {
      throw new Error('Administrative and privileged roles cannot be requested publicly. Please contact a Prime Administrator.');
    }

    const requestableRole = PUBLIC_REQUESTABLE_ROLES[normalizedRoleId];
    if (!requestableRole) {
      throw new Error(`The role '${normalizedRoleId}' is not valid or cannot be requested publicly.`);
    }

    // 6. Duplicate checking
    // A. Active user with exact username
    const existingUser = db.prepare(`SELECT id FROM users WHERE username = ? COLLATE BINARY`).get(rawUsername);
    if (existingUser) {
      throw new Error('Username already exists or is unavailable. Please choose another username.');
    }

    // B. Active user with same email
    const existingEmailUser = db.prepare(`SELECT id FROM users WHERE recovery_email = ? COLLATE NOCASE`).get(rawEmail);
    if (existingEmailUser) {
      throw new Error('An account linked to this email address already exists. Please sign in or use password recovery.');
    }

    // C. Existing pending request with exact username
    const existingPendingUsername = db.prepare(`
      SELECT id FROM access_requests 
      WHERE requested_username = ? COLLATE BINARY AND status = 'PENDING'
    `).get(rawUsername);
    if (existingPendingUsername) {
      throw new Error('An access request for this username is currently pending administrator review.');
    }

    // D. Existing pending request with same email
    const existingPendingEmail = db.prepare(`
      SELECT id FROM access_requests 
      WHERE requested_email = ? COLLATE NOCASE AND status = 'PENDING'
    `).get(rawEmail);
    if (existingPendingEmail) {
      throw new Error('An access request for this email address is currently pending administrator review.');
    }

    // 7. Credentials & tokens
    const passwordHash = bcrypt.hashSync(password, 10);
    const requestId = generateRequestId();
    const statusToken = crypto.randomBytes(24).toString('hex');
    const statusTokenHash = crypto.createHash('sha256').update(statusToken).digest('hex');

    // 8. Resolve approvers
    const approvers = this.resolveAccessRequestApprovers(db);

    // 9. Atomic Transaction Execution
    const requestRecord: AccessRequestRecord = runTransaction(db, () => {
      const nowIso = new Date().toISOString();

      db.prepare(`
        INSERT INTO access_requests (
          id, requester_full_name, requested_username, requested_email,
          requested_role_id, requested_role_name_snapshot, password_hash,
          status, created_at, updated_at, request_metadata, status_token_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now'), datetime('now'), ?, ?)
      `).run(
        requestId,
        fullName,
        rawUsername,
        rawEmail,
        requestableRole.id,
        requestableRole.name,
        passwordHash,
        params.metadata ? JSON.stringify(params.metadata) : null,
        statusTokenHash
      );

      // Create notification records for each approver
      const notifStmt = db.prepare(`
        INSERT INTO access_request_notifications (
          id, access_request_id, recipient_user_id, recipient_email,
          notification_type, delivery_status, created_at
        ) VALUES (?, ?, ?, ?, 'NEW_REQUEST', 'PENDING', datetime('now'))
      `);

      for (const approver of approvers) {
        const notifId = `arn-${crypto.randomUUID()}`;
        notifStmt.run(notifId, requestId, approver.id, approver.email);
      }

      logAuditInTransaction(db, {
        entityType: 'ACCESS_REQUEST',
        entityId: requestId,
        action: 'REQUEST_SUBMITTED',
        afterState: {
          requestId,
          requesterFullName: fullName,
          requestedUsername: rawUsername,
          requestedEmail: rawEmail,
          requestedRole: requestableRole.name,
          approverCount: approvers.length,
        },
      });

      return db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(requestId) as AccessRequestRecord;
    });

    // 10. Safe Sequential Notification Dispatch
    // (Failures here update notification record to FAILED without aborting the pending request)
    const dispatchPromise = (async () => {
      const reviewUrl = `${process.env.APP_URL || 'http://localhost:3000'}/setup/users?requestId=${requestId}`;
      
      // Sequential dispatch to prevent concurrent socket contention on SMTP transport
      for (const approver of approvers) {
        try {
          const emailData = renderNewAccessRequestEmail({
            requesterName: fullName,
            requestedUsername: rawUsername,
            requestedEmail: rawEmail,
            requestedRole: requestableRole.name,
            requestId,
            timestamp: new Date().toLocaleString(),
            reviewUrl,
          });

          const result = await dispatchAccessRequestEmail({
            to: approver.email,
            subject: emailData.subject,
            text: emailData.text,
            html: emailData.html,
            metadata: { requestId, approverId: approver.id },
          });

          if (result.success && result.deliveryStatus === 'SENT') {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'SENT', sent_at = datetime('now'), failure_reason = NULL
              WHERE access_request_id = ? AND recipient_user_id = ?
            `).run(requestId, approver.id);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_SENT',
              userId: approver.id,
              afterState: {
                recipient: approver.email,
                requestId,
                transport: 'SMTP',
                messageId: result.messageId,
                smtpResponse: result.response,
                envelope: result.envelope,
              },
            });
          } else if (result.success && result.deliveryStatus === 'DEV_CAPTURED') {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'DEV_CAPTURED', sent_at = datetime('now'), failure_reason = NULL
              WHERE access_request_id = ? AND recipient_user_id = ?
            `).run(requestId, approver.id);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_SENT',
              userId: approver.id,
              afterState: { recipient: approver.email, requestId, transport: 'DEV_INBOX' },
            });
          } else {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
              WHERE access_request_id = ? AND recipient_user_id = ?
            `).run(result.error || 'Dispatch error', requestId, approver.id);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_FAILED',
              userId: approver.id,
              afterState: {
                recipient: approver.email,
                error: result.error,
                messageId: result.messageId,
                smtpResponse: result.response,
              },
            });
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          try {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
              WHERE access_request_id = ? AND recipient_user_id = ?
            `).run(errorMsg, requestId, approver.id);
          } catch {}
        }
      }
    })();

    return { request: requestRecord, statusToken, approverCount: approvers.length, dispatchPromise };
  }

  static getAccessRequestById(id: string): AccessRequestRecord | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(id) as AccessRequestRecord | undefined;
    return row || null;
  }

  static getAccessRequestByStatusToken(token: string): AccessRequestRecord | null {
    if (!token || typeof token !== 'string') return null;
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const row = db.prepare(`SELECT * FROM access_requests WHERE status_token_hash = ?`).get(tokenHash) as AccessRequestRecord | undefined;
    return row || null;
  }

  static listAccessRequests(filter?: { status?: AccessRequestStatus }): AccessRequestRecord[] {
    const db = getDb();
    if (filter?.status) {
      return db.prepare(`
        SELECT * FROM access_requests 
        WHERE status = ? 
        ORDER BY created_at DESC
      `).all(filter.status) as AccessRequestRecord[];
    }
    return db.prepare(`
      SELECT * FROM access_requests 
      ORDER BY 
        CASE WHEN status = 'PENDING' THEN 0 ELSE 1 END,
        created_at DESC
    `).all() as AccessRequestRecord[];
  }

  static countPendingRequests(): number {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as count FROM access_requests WHERE status = 'PENDING'`).get() as { count: number };
    return row?.count || 0;
  }

  static getNotificationsForRequest(requestId: string): AccessRequestNotificationRecord[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM access_request_notifications 
      WHERE access_request_id = ? 
      ORDER BY created_at ASC
    `).all(requestId) as AccessRequestNotificationRecord[];
  }

  /**
   * Approves an access request and provisions an active user account atomically.
   */
  static approveAccessRequest(
    requestId: string,
    reviewer: { userId: string; role: string; authorityTier?: string },
    options?: { siteIds?: string[]; reviewReason?: string }
  ): { user: { id: string; username: string; fullName: string; role: string }; request: AccessRequestRecord } {
    const db = getDb();

    return runTransaction(db, () => {
      // 1. Re-read and lock request
      const request = db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(requestId) as AccessRequestRecord | undefined;
      if (!request) {
        throw new Error(`Access request not found: ${requestId}`);
      }

      if (request.status !== 'PENDING') {
        throw new Error(`Request has already been processed (Current status: ${request.status}).`);
      }

      // 2. Re-check username collision against users table (Exact binary check)
      const existingUser = db.prepare(`SELECT id FROM users WHERE username = ? COLLATE BINARY`).get(request.requested_username);
      if (existingUser) {
        throw new Error(`Username '@${request.requested_username}' has already been taken by an active account.`);
      }

      // 3. Re-check email collision
      const existingEmail = db.prepare(`SELECT id FROM users WHERE recovery_email = ? COLLATE NOCASE`).get(request.requested_email);
      if (existingEmail) {
        throw new Error(`Email address '${request.requested_email}' is already linked to an existing account.`);
      }

      // 4. Validate requested role still exists / is allowed
      if (request.requested_role_id !== 'SITE_MANAGER' && request.requested_role_id !== 'VIEWER') {
        throw new Error(`Requested role '${request.requested_role_id}' is invalid or deactivated.`);
      }

      // 5. Create active user account
      const userId = `usr-${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();

      db.prepare(`
        INSERT INTO users (
          id, username, password_hash, full_name, role,
          authority_tier, recovery_email, token_version, is_active,
          permission_version, must_change_password, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          'STANDARD', ?, 1, 1,
          1, 0, datetime('now'), datetime('now')
        )
      `).run(
        userId,
        request.requested_username,
        request.password_hash,
        request.requester_full_name,
        request.requested_role_id,
        request.requested_email
      );

      // 6. Assign sites if specified
      if (options?.siteIds && Array.isArray(options.siteIds) && options.siteIds.length > 0) {
        const siteStmt = db.prepare(`
          INSERT INTO site_users (id, site_id, user_id, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `);
        for (const sId of options.siteIds) {
          siteStmt.run(`su-${crypto.randomUUID()}`, sId, userId);
        }
      }

      // 7. Update access request status to APPROVED
      db.prepare(`
        UPDATE access_requests
        SET status = 'APPROVED',
            reviewed_at = datetime('now'),
            reviewed_by = ?,
            reviewer_role = ?,
            review_reason = ?,
            approval_timestamp = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        reviewer.userId,
        reviewer.role,
        options?.reviewReason || 'Approved by administrator',
        requestId
      );

      // 8. Create notification record for post-approval user notification
      const approvalNotifId = `arn-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO access_request_notifications (
          id, access_request_id, recipient_user_id, recipient_email,
          notification_type, delivery_status, created_at
        ) VALUES (?, ?, ?, ?, 'APPROVAL', 'PENDING', datetime('now'))
      `).run(approvalNotifId, requestId, userId, request.requested_email);

      // 9. Audit Logging
      logAuditInTransaction(db, {
        entityType: 'ACCESS_REQUEST',
        entityId: requestId,
        action: 'REQUEST_APPROVED',
        userId: reviewer.userId,
        afterState: {
          requestId,
          createdUserId: userId,
          username: request.requested_username,
          role: request.requested_role_id,
          email: request.requested_email,
          reviewedBy: reviewer.userId,
        },
      });

      logAuditInTransaction(db, {
        entityType: 'SECURITY',
        entityId: userId,
        action: 'USER_CREATED',
        userId: reviewer.userId,
        afterState: {
          source: 'ACCESS_REQUEST_APPROVAL',
          requestId,
          username: request.requested_username,
          fullName: request.requester_full_name,
          role: request.requested_role_id,
          assignedSites: options?.siteIds || [],
        },
      });

      const updatedRequest = db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(requestId) as AccessRequestRecord;

      // 10. Asynchronously send approval email
      (async () => {
        try {
          const signInUrl = `${process.env.APP_URL || 'http://localhost:3000'}/login`;
          const emailData = renderAccessRequestApprovedEmail({
            fullName: request.requester_full_name,
            username: request.requested_username,
            role: request.requested_role_name_snapshot,
            signInUrl,
          });

          const res = await dispatchAccessRequestEmail({
            to: request.requested_email,
            subject: emailData.subject,
            text: emailData.text,
            html: emailData.html,
            metadata: { requestId, userId },
          });

          if (res.success && res.deliveryStatus === 'SENT') {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'SENT', sent_at = datetime('now')
              WHERE id = ?
            `).run(approvalNotifId);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_SENT',
              userId: reviewer.userId,
              afterState: { type: 'APPROVAL', recipient: request.requested_email, transport: 'SMTP' },
            });
          } else if (res.success && res.deliveryStatus === 'DEV_CAPTURED') {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'DEV_CAPTURED', sent_at = datetime('now')
              WHERE id = ?
            `).run(approvalNotifId);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_SENT',
              userId: reviewer.userId,
              afterState: { type: 'APPROVAL', recipient: request.requested_email, transport: 'DEV_INBOX' },
            });
          } else {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
              WHERE id = ?
            `).run(res.error || 'Approval email failed', approvalNotifId);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
              WHERE id = ?
            `).run(msg, approvalNotifId);
          } catch {}
        }
      })().catch(() => {});

      return {
        user: {
          id: userId,
          username: request.requested_username,
          fullName: request.requester_full_name,
          role: request.requested_role_id,
        },
        request: updatedRequest,
      };
    });
  }

  /**
   * Denies an access request atomically.
   */
  static denyAccessRequest(
    requestId: string,
    reviewer: { userId: string; role: string; authorityTier?: string },
    reason?: string
  ): AccessRequestRecord {
    const db = getDb();

    return runTransaction(db, () => {
      const request = db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(requestId) as AccessRequestRecord | undefined;
      if (!request) {
        throw new Error(`Access request not found: ${requestId}`);
      }

      if (request.status !== 'PENDING') {
        throw new Error(`Request has already been processed (Current status: ${request.status}).`);
      }

      db.prepare(`
        UPDATE access_requests
        SET status = 'DENIED',
            reviewed_at = datetime('now'),
            reviewed_by = ?,
            reviewer_role = ?,
            denial_reason = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        reviewer.userId,
        reviewer.role,
        reason || null,
        requestId
      );

      const denialNotifId = `arn-${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO access_request_notifications (
          id, access_request_id, recipient_user_id, recipient_email,
          notification_type, delivery_status, created_at
        ) VALUES (?, ?, ?, ?, 'DENIAL', 'PENDING', datetime('now'))
      `).run(denialNotifId, requestId, reviewer.userId, request.requested_email);

      logAuditInTransaction(db, {
        entityType: 'ACCESS_REQUEST',
        entityId: requestId,
        action: 'REQUEST_DENIED',
        userId: reviewer.userId,
        afterState: {
          requestId,
          username: request.requested_username,
          email: request.requested_email,
          reviewedBy: reviewer.userId,
          denialReason: reason || null,
        },
      });

      const updatedRequest = db.prepare(`SELECT * FROM access_requests WHERE id = ?`).get(requestId) as AccessRequestRecord;

      // Asynchronously send denial email
      (async () => {
        try {
          const emailData = renderAccessRequestDeniedEmail({
            fullName: request.requester_full_name,
            username: request.requested_username,
            reason,
          });

          const res = await dispatchAccessRequestEmail({
            to: request.requested_email,
            subject: emailData.subject,
            text: emailData.text,
            html: emailData.html,
            metadata: { requestId },
          });

          if (res.success && res.deliveryStatus === 'SENT') {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'SENT', sent_at = datetime('now')
              WHERE id = ?
            `).run(denialNotifId);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_SENT',
              userId: reviewer.userId,
              afterState: { type: 'DENIAL', recipient: request.requested_email, transport: 'SMTP' },
            });
          } else if (res.success && res.deliveryStatus === 'DEV_CAPTURED') {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'DEV_CAPTURED', sent_at = datetime('now')
              WHERE id = ?
            `).run(denialNotifId);

            logAudit({
              entityType: 'ACCESS_REQUEST',
              entityId: requestId,
              action: 'NOTIFICATION_SENT',
              userId: reviewer.userId,
              afterState: { type: 'DENIAL', recipient: request.requested_email, transport: 'DEV_INBOX' },
            });
          } else {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
              WHERE id = ?
            `).run(res.error || 'Denial email failed', denialNotifId);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            db.prepare(`
              UPDATE access_request_notifications 
              SET delivery_status = 'FAILED', failed_at = datetime('now'), failure_reason = ?
              WHERE id = ?
            `).run(msg, denialNotifId);
          } catch {}
        }
      })().catch(() => {});

      return updatedRequest;
    });
  }

  /**
   * Bulk approves multiple access requests transactionally per request.
   * Partial failures are gracefully caught and reported per request ID.
   */
  static bulkApprove(
    requestIds: string[],
    reviewer: { userId: string; role: string; authorityTier?: string },
    options?: { siteIds?: string[]; reviewReason?: string }
  ): {
    succeeded: Array<{ id: string; username: string; fullName: string }>;
    failed: Array<{ id: string; reason: string }>;
  } {
    const succeeded: Array<{ id: string; username: string; fullName: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of requestIds) {
      try {
        const res = this.approveAccessRequest(id, reviewer, options);
        succeeded.push({
          id,
          username: res.user.username,
          fullName: res.user.fullName,
        });
      } catch (err: unknown) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Bulk denies multiple access requests transactionally per request.
   * Partial failures are gracefully caught and reported per request ID.
   */
  static bulkDeny(
    requestIds: string[],
    reviewer: { userId: string; role: string; authorityTier?: string },
    reason?: string
  ): {
    succeeded: Array<{ id: string; username: string }>;
    failed: Array<{ id: string; reason: string }>;
  } {
    const succeeded: Array<{ id: string; username: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of requestIds) {
      try {
        const res = this.denyAccessRequest(id, reviewer, reason);
        succeeded.push({
          id,
          username: res.requested_username,
        });
      } catch (err: unknown) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { succeeded, failed };
  }

  /**
   * Deletes historical access request records (status != 'PENDING').
   * Guarantees:
   * - Strict rejection of deleting PENDING requests.
   * - Associated notifications are removed (cascade).
   * - User accounts (users), site_users, and audit logs are NEVER deleted.
   * - Records audit trail for the deletion.
   */
  static deleteHistoryRecords(
    requestIds: string[],
    reviewer: { userId: string; role: string }
  ): {
    deleted: string[];
    skippedPending: string[];
    notFound: string[];
  } {
    const db = getDb();
    const deleted: string[] = [];
    const skippedPending: string[] = [];
    const notFound: string[] = [];

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return { deleted, skippedPending, notFound };
    }

    for (const id of requestIds) {
      const row = db.prepare(`SELECT id, status, requested_username FROM access_requests WHERE id = ?`).get(id) as { id: string; status: string; requested_username: string } | undefined;
      if (!row) {
        notFound.push(id);
        continue;
      }

      if (row.status === 'PENDING') {
        skippedPending.push(id);
        continue;
      }

      // Safe deletion of historical record
      runTransaction(db, () => {
        db.prepare(`DELETE FROM access_request_notifications WHERE access_request_id = ?`).run(id);
        db.prepare(`DELETE FROM access_requests WHERE id = ?`).run(id);

        logAuditInTransaction(db, {
          entityType: 'ACCESS_REQUEST',
          entityId: id,
          action: 'REQUEST_HISTORY_DELETED',
          userId: reviewer.userId,
          afterState: {
            id,
            username: row.requested_username,
            priorStatus: row.status,
          },
        });
      });

      deleted.push(id);
    }

    return { deleted, skippedPending, notFound };
  }
}
