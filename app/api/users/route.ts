import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  getAllUsers, 
  createUser, 
  updateUser, 
  updateUsername, 
  updatePassword, 
  updateRecoveryEmail,
  setUserActiveState,
  getUserById, 
  getUserByUsername,
  getUserAssignedSites, 
  deleteUser 
} from '@/lib/db/repositories/user-repo';
import { 
  canManageAuthority, 
  canAssignAuthorityTier, 
  canModifyCredentials, 
  canDeleteUser,
  isSuperiorPrime, 
  isClientPrime 
} from '@/lib/auth/authority';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { sendNewUserNotificationEmail } from '@/lib/email/mailer';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'VIEW',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const url = req ? new URL(req.url) : null;
    const targetId = url?.searchParams.get('id') || url?.searchParams.get('userId');
    const targetUsername = url?.searchParams.get('username');

    const canSeeRecovery = (target: { id: string; authority_tier: string }) => {
      if (!session) return false;
      if (session.authorityTier === 'KING_MAKER' || session.authorityTier === 'SUPERIOR_PRIME') return true;
      if (session.userId === target.id) return true;
      if (session.authorityTier === 'CLIENT_PRIME') {
        return target.authority_tier !== 'SUPERIOR_PRIME' && target.authority_tier !== 'KING_MAKER';
      }
      if (session.authorityTier === 'STANDARD_ADMIN') {
        return target.authority_tier === 'STANDARD';
      }
      return false;
    };

    // Single User Detail query by ID
    if (targetId) {
      const u = getUserById(targetId.trim(), session);
      if (!u) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({
        user: {
          id: u.id,
          username: u.username,
          fullName: u.full_name,
          role: u.role,
          authorityTier: u.authority_tier,
          recoveryEmail: canSeeRecovery(u) ? u.recovery_email : null,
          isActive: u.is_active === 1,
          assignedSiteIds: getUserAssignedSites(u.id),
          permissionVersion: (u as any).permission_version || 1,
          tokenVersion: u.token_version,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        }
      });
    }

    // Single User Detail query by Username
    if (targetUsername) {
      const u = getUserByUsername(targetUsername.trim(), session);
      if (!u) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({
        user: {
          id: u.id,
          username: u.username,
          fullName: u.full_name,
          role: u.role,
          authorityTier: u.authority_tier,
          recoveryEmail: canSeeRecovery(u) ? u.recovery_email : null,
          isActive: u.is_active === 1,
          assignedSiteIds: getUserAssignedSites(u.id),
          permissionVersion: (u as any).permission_version || 1,
          tokenVersion: u.token_version,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        }
      });
    }

    // Server-side filtering: hides SUPERIOR_PRIME unless caller is Superior Prime
    const users = getAllUsers(session);
    const enriched = users.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      authorityTier: u.authority_tier,
      recoveryEmail: canSeeRecovery(u) ? u.recovery_email : null,
      isActive: u.is_active === 1,
      assignedSiteIds: getUserAssignedSites(u.id),
      permissionVersion: (u as any).permission_version || 1,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    }));

    return NextResponse.json({ users: enriched });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching users';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'MANAGE_USERS',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { 
      username, 
      password, 
      fullName, 
      role, 
      authorityTier, 
      recoveryEmail, 
      siteIds, 
      assignedSiteIds,
      isActive 
    } = body;

    const resolvedSiteIds = siteIds || assignedSiteIds || [];

    if (!username || !password || !fullName || !role) {
      return NextResponse.json({ error: 'Username, password, full name, and role are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 });
    }

    if (role !== 'ADMIN' && role !== 'SITE_MANAGER' && role !== 'VIEWER') {
      return NextResponse.json({ error: 'Invalid operational role' }, { status: 400 });
    }

    // Role and tier escalation prevention
    if (role === 'ADMIN' && !canAssignAuthorityTier(session, 'STANDARD_ADMIN')) {
      return NextResponse.json({ error: 'Insufficient authority to create an Administrator account.' }, { status: 403 });
    }

    if (authorityTier && !canAssignAuthorityTier(session, authorityTier)) {
      return NextResponse.json({ error: `Insufficient authority to create a user with authority tier '${authorityTier}'.` }, { status: 403 });
    }

    const userId = createUser({
      username: username.trim(),
      passwordPlainText: password,
      fullName: fullName.trim(),
      role,
      authorityTier,
      recoveryEmail: recoveryEmail ? recoveryEmail.trim().toLowerCase() : null,
      siteIds: resolvedSiteIds,
      isActive: isActive !== false,
      mustChangePassword: body.mustChangePassword !== undefined ? Boolean(body.mustChangePassword) : false,
    }, session);

    const resolvedTier = authorityTier || (role === 'ADMIN' ? 'STANDARD_ADMIN' : 'STANDARD');

    const auditEntry = logAudit({
      entityType: 'SECURITY',
      entityId: userId,
      action: 'USER_CREATED',
      userId: session!.userId,
      afterState: { 
        username: username.trim(), 
        fullName: fullName.trim(), 
        role, 
        authorityTier: resolvedTier,
        isActive: isActive !== false,
        siteIds: resolvedSiteIds,
        recoveryEmailProvided: Boolean(recoveryEmail),
      },
    });

    // Safely dispatch asynchronous notification to both Prime email addresses
    try {
      const siteNames = (resolvedSiteIds && resolvedSiteIds.length > 0)
        ? resolvedSiteIds.map((sid: string) => {
            const s = getSiteById(sid);
            return s ? `${s.name} (${s.code || s.id})` : sid;
          })
        : undefined;

      const siteScope = role === 'ADMIN' 
        ? 'ALL SITES' 
        : (resolvedSiteIds.length > 0 ? 'SELECTED SITES' : 'NO SITE ACCESS');

      sendNewUserNotificationEmail({
        fullName: fullName.trim(),
        username: username.trim(),
        authorityTier: resolvedTier,
        role,
        createdBy: `@${session!.username}`,
        createdAt: new Date().toISOString(),
        siteScope,
        siteNames,
        auditId: auditEntry?.id,
      }).catch((e) => console.error('Background user creation notification error:', e));
    } catch (e) {
      console.error('Failed to dispatch user creation notification email:', e);
    }

    return NextResponse.json({ success: true, userId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error creating user';
    const status = msg.includes('Insufficient authority') ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'MANAGE_USERS',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const body = await req.json();
    const { 
      id, 
      userId, 
      fullName, 
      role, 
      authorityTier, 
      isActive, 
      recoveryEmail, 
      siteIds, 
      assignedSiteIds 
    } = body;

    const targetId = id || userId;
    const resolvedSiteIds = siteIds !== undefined ? siteIds : assignedSiteIds;

    if (!targetId || !fullName || !role) {
      return NextResponse.json({ error: 'ID, full name, and role are required' }, { status: 400 });
    }

    // Protected lookup: Returns null if target is Superior Prime and caller is not
    const existingUser = getUserById(targetId, session);
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Authority hierarchy check
    if (!canManageAuthority(session, existingUser)) {
      return NextResponse.json({ error: 'Insufficient authority to modify this user.' }, { status: 403 });
    }

    // Self-deactivation prevention
    if (session!.userId === targetId && isActive === false) {
      return NextResponse.json({ error: 'You cannot deactivate your own active administrator account.' }, { status: 400 });
    }

    // King Maker root protection
    if (existingUser.authority_tier === 'KING_MAKER') {
      if (authorityTier && authorityTier !== 'KING_MAKER') {
        return NextResponse.json({ error: 'King Maker authority tier cannot be altered or downgraded.' }, { status: 403 });
      }
      if (isActive === false) {
        return NextResponse.json({ error: 'King Maker account cannot be deactivated.' }, { status: 400 });
      }
      if (role && role !== 'ADMIN') {
        return NextResponse.json({ error: 'King Maker operational role cannot be altered.' }, { status: 400 });
      }
    }

    // Role escalation prevention
    if (role === 'ADMIN' && existingUser.role !== 'ADMIN') {
      if (!canAssignAuthorityTier(session, 'STANDARD_ADMIN')) {
        return NextResponse.json({ error: 'Insufficient authority to promote a user to Administrator.' }, { status: 403 });
      }
    }

    updateUser({
      id: targetId,
      fullName: fullName.trim(),
      role,
      authorityTier,
      isActive: isActive !== false,
      recoveryEmail: recoveryEmail ? recoveryEmail.trim().toLowerCase() : null,
      siteIds: resolvedSiteIds,
    }, session);

    // Determine audit action
    let auditAction: 'USER_ACTIVATED' | 'USER_DEACTIVATED' | 'ROLE_CHANGED' | 'RECOVERY_EMAIL_CHANGED' | 'USER_UPDATED' = 'USER_UPDATED';
    if (isActive !== undefined && (existingUser.is_active === 1) !== Boolean(isActive)) {
      auditAction = isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
    } else if (role && role !== existingUser.role) {
      auditAction = 'ROLE_CHANGED';
    } else if (recoveryEmail !== undefined && recoveryEmail !== existingUser.recovery_email) {
      auditAction = 'RECOVERY_EMAIL_CHANGED';
    }

    logAudit({
      entityType: 'SECURITY',
      entityId: targetId,
      action: auditAction,
      userId: session!.userId,
      beforeState: { 
        role: existingUser.role, 
        authorityTier: existingUser.authority_tier, 
        isActive: existingUser.is_active === 1,
      },
      afterState: { 
        fullName: fullName.trim(), 
        role, 
        authorityTier: authorityTier || existingUser.authority_tier,
        isActive: isActive !== false, 
        siteIds: resolvedSiteIds,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating user';
    const status = msg.includes('Insufficient authority') ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// Dedicated actions: Reset Password, Change Username, Activate, Deactivate, Change Role
export async function PATCH(req: Request) {
  const session = await getSession();
  try {
    const body = await req.json();
    const { 
      id, 
      userId, 
      action, 
      newPassword, 
      confirmPassword, 
      newUsername,
      newRole,
      newRecoveryEmail 
    } = body;
    const targetId = id || userId;

    if (!targetId || !action) {
      return NextResponse.json({ error: 'User ID and action are required' }, { status: 400 });
    }

    // Required permission mapping
    const permAction = action === 'RESET_PASSWORD' ? 'RESET_PASSWORD' : 'MANAGE_USERS';

    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: permAction,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    // Protected lookup: Returns null if target is Superior Prime and caller is not
    const targetUser = getUserById(targetId, session);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 1. PASSWORD RESET
    if (action === 'RESET_PASSWORD') {
      if (!canModifyCredentials(session, targetUser)) {
        return NextResponse.json({ error: 'Insufficient authority to reset password for this user.' }, { status: 403 });
      }

      if (!newPassword || newPassword.length < 8) {
        return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
      }
      if (confirmPassword && newPassword !== confirmPassword) {
        return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
      }

      updatePassword(targetUser.id, newPassword, session);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'PASSWORD_RESET',
        userId: session!.userId,
        afterState: { targetUsername: targetUser.username, action: 'ADMIN_RESET_PASSWORD' },
      });

      return NextResponse.json({ success: true, message: 'Password reset successfully for user' });
    }

    // 2. CHANGE USERNAME
    if (action === 'CHANGE_USERNAME') {
      if (!canModifyCredentials(session, targetUser)) {
        return NextResponse.json({ error: 'Insufficient authority to change username for this user.' }, { status: 403 });
      }

      if (!newUsername || !newUsername.trim()) {
        return NextResponse.json({ error: 'New username is required' }, { status: 400 });
      }

      const oldUsername = targetUser.username;
      updateUsername(targetUser.id, newUsername.trim(), session);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'USERNAME_CHANGED',
        userId: session!.userId,
        beforeState: { oldUsername },
        afterState: { newUsername: newUsername.trim() },
      });

      return NextResponse.json({ success: true, message: 'Username updated successfully' });
    }

    // 3. ACTIVATE ACCOUNT
    if (action === 'ACTIVATE') {
      if (!canManageAuthority(session, targetUser)) {
        return NextResponse.json({ error: 'Insufficient authority to modify this user.' }, { status: 403 });
      }

      setUserActiveState(targetUser.id, true, session);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'USER_ACTIVATED',
        userId: session!.userId,
        beforeState: { isActive: targetUser.is_active === 1 },
        afterState: { isActive: true },
      });

      return NextResponse.json({ success: true, message: `User @${targetUser.username} activated.` });
    }

    // 4. DEACTIVATE ACCOUNT
    if (action === 'DEACTIVATE') {
      if (!canManageAuthority(session, targetUser)) {
        return NextResponse.json({ error: 'Insufficient authority to modify this user.' }, { status: 403 });
      }
      if (targetUser.authority_tier === 'KING_MAKER') {
        return NextResponse.json({ error: 'King Maker account cannot be deactivated.' }, { status: 400 });
      }
      if (session!.userId === targetUser.id) {
        return NextResponse.json({ error: 'You cannot deactivate your own active administrator account.' }, { status: 400 });
      }

      setUserActiveState(targetUser.id, false, session);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'USER_DEACTIVATED',
        userId: session!.userId,
        beforeState: { isActive: targetUser.is_active === 1 },
        afterState: { isActive: false },
      });

      return NextResponse.json({ success: true, message: `User @${targetUser.username} deactivated.` });
    }

    // 5. CHANGE OPERATIONAL ROLE
    if (action === 'CHANGE_ROLE') {
      if (!canManageAuthority(session, targetUser)) {
        return NextResponse.json({ error: 'Insufficient authority to modify this user.' }, { status: 403 });
      }
      if (targetUser.authority_tier === 'KING_MAKER') {
        return NextResponse.json({ error: 'King Maker operational role cannot be changed.' }, { status: 400 });
      }
      if (!newRole || (newRole !== 'ADMIN' && newRole !== 'SITE_MANAGER' && newRole !== 'VIEWER')) {
        return NextResponse.json({ error: 'Valid operational role is required' }, { status: 400 });
      }
      if (newRole === 'ADMIN' && targetUser.role !== 'ADMIN') {
        if (!canAssignAuthorityTier(session, 'STANDARD_ADMIN')) {
          return NextResponse.json({ error: 'Insufficient authority to promote a user to Administrator.' }, { status: 403 });
        }
      }

      updateUser({
        id: targetUser.id,
        fullName: targetUser.full_name,
        role: newRole,
        authorityTier: newRole === 'ADMIN' && targetUser.authority_tier === 'STANDARD' ? 'STANDARD_ADMIN' : targetUser.authority_tier,
        isActive: targetUser.is_active === 1,
        recoveryEmail: targetUser.recovery_email,
      }, session);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'ROLE_CHANGED',
        userId: session!.userId,
        beforeState: { role: targetUser.role },
        afterState: { role: newRole },
      });

      return NextResponse.json({ success: true, message: `Role changed to ${newRole}.` });
    }

    // 6. CHANGE RECOVERY EMAIL
    if (action === 'CHANGE_RECOVERY_EMAIL') {
      if (!canModifyCredentials(session, targetUser)) {
        return NextResponse.json({ error: 'Insufficient authority to update recovery email for this user.' }, { status: 403 });
      }

      updateRecoveryEmail(targetUser.id, newRecoveryEmail || null, session);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'RECOVERY_EMAIL_CHANGED',
        userId: session!.userId,
        beforeState: { recoveryEmailProvided: Boolean(targetUser.recovery_email) },
        afterState: { recoveryEmailProvided: Boolean(newRecoveryEmail) },
      });

      return NextResponse.json({ success: true, message: 'Recovery email updated successfully.' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error managing user account';
    const status = msg.includes('Insufficient authority') ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'MANAGE_USERS',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const url = new URL(req.url);
    let id = url.searchParams.get('id') || url.searchParams.get('userId');

    if (!id) {
      try {
        const body = await req.json();
        id = body.id || body.userId;
      } catch {}
    }

    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const targetId = id.trim();

    // Prevent self-deletion
    if (session!.userId === targetId) {
      return NextResponse.json(
        { error: 'You cannot delete your own active administrator account.' },
        { status: 400 }
      );
    }

    // Protected lookup: Returns null if target is Superior Prime and caller is not
    const targetUser = getUserById(targetId, session);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check authority: cannot delete Primes or targets of equal/higher authority
    if (!canDeleteUser(session, targetUser)) {
      return NextResponse.json({ error: 'Insufficient authority to delete this user.' }, { status: 403 });
    }

    // Call deleteUser with session for tier authorization
    deleteUser(targetId, session!);

    return NextResponse.json({
      success: true,
      message: `User @${targetUser.username} was deleted successfully.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error deleting user';
    const status = msg.includes('Insufficient authority') || msg.includes('privileges required') ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
