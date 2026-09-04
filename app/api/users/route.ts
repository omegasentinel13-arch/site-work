import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { 
  getAllUsers, 
  createUser, 
  updateUser, 
  updateUsername,
  updatePassword,
  getUserById,
  getUserAssignedSites,
  deleteUser
} from '@/lib/db/repositories/user-repo';
import { logAudit } from '@/lib/audit/logger';

export async function GET() {
  const session = await getSession();
  try {
    requireAdmin(session);
    const users = getAllUsers();
    const enriched = users.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      recoveryEmail: u.recovery_email,
      isActive: u.is_active === 1,
      assignedSiteIds: u.role === 'ADMIN' ? [] : getUserAssignedSites(u.id),
      createdAt: u.created_at,
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
    requireAdmin(session);
    const body = await req.json();
    const { username, password, fullName, role, recoveryEmail, siteIds } = body;

    if (!username || !password || !fullName || !role) {
      return NextResponse.json({ error: 'Username, password, full name, and role are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 });
    }

    const userId = createUser({
      username: username.trim(),
      passwordPlainText: password,
      fullName: fullName.trim(),
      role,
      recoveryEmail: recoveryEmail ? recoveryEmail.trim().toLowerCase() : null,
      siteIds: siteIds || [],
    });

    logAudit({
      entityType: 'SECURITY',
      entityId: userId,
      action: 'USER_CREATE',
      userId: session!.userId,
      afterState: { username: username.trim(), fullName: fullName.trim(), role, siteIds },
    });

    return NextResponse.json({ success: true, userId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error creating user';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { id, fullName, role, isActive, recoveryEmail, siteIds } = body;

    if (!id || !fullName || !role) {
      return NextResponse.json({ error: 'ID, full name, and role are required' }, { status: 400 });
    }

    const existingUser = getUserById(id);
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    updateUser({
      id,
      fullName: fullName.trim(),
      role,
      isActive: isActive !== false,
      recoveryEmail: recoveryEmail ? recoveryEmail.trim().toLowerCase() : null,
      siteIds,
    });

    logAudit({
      entityType: 'SECURITY',
      entityId: id,
      action: 'USER_UPDATE',
      userId: session!.userId,
      beforeState: { role: existingUser.role, isActive: existingUser.is_active === 1 },
      afterState: { fullName: fullName.trim(), role, isActive: isActive !== false, siteIds },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating user';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// Dedicated actions: Reset Password or Change Username
export async function PATCH(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { id, action, newPassword, confirmPassword, newUsername } = body;

    if (!id || !action) {
      return NextResponse.json({ error: 'User ID and action are required' }, { status: 400 });
    }

    const targetUser = getUserById(id);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (action === 'RESET_PASSWORD') {
      if (!newPassword || newPassword.length < 8) {
        return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
      }
      if (confirmPassword && newPassword !== confirmPassword) {
        return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
      }

      updatePassword(targetUser.id, newPassword);

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'PASSWORD_RESET',
        userId: session!.userId,
        afterState: { targetUsername: targetUser.username, action: 'ADMIN_RESET_PASSWORD' },
      });

      return NextResponse.json({ success: true, message: 'Password reset successfully for user' });
    }

    if (action === 'CHANGE_USERNAME') {
      if (!newUsername || !newUsername.trim()) {
        return NextResponse.json({ error: 'New username is required' }, { status: 400 });
      }

      const oldUsername = targetUser.username;
      updateUsername(targetUser.id, newUsername.trim());

      logAudit({
        entityType: 'SECURITY',
        entityId: targetUser.id,
        action: 'USERNAME_CHANGE',
        userId: session!.userId,
        beforeState: { oldUsername },
        afterState: { newUsername: newUsername.trim() },
      });

      return NextResponse.json({ success: true, message: 'Username updated successfully' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error managing user credentials';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);

    const url = new URL(req.url);
    let id = url.searchParams.get('id');

    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch {}
    }

    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const targetId = id.trim();

    // Prevent self-deletion of currently logged-in administrator
    if (session!.userId === targetId) {
      return NextResponse.json(
        { error: 'You cannot delete your own active administrator account.' },
        { status: 400 }
      );
    }

    const targetUser = getUserById(targetId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Call deleteUser with actingAdminId so deletion and audit logging are transactionally coupled
    deleteUser(targetId, session!.userId);

    return NextResponse.json({
      success: true,
      message: `User @${targetUser.username} was deleted successfully.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error deleting user';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

