import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getUserById, getUserAssignedSites } from '../db/repositories/user-repo';

const SESSION_COOKIE_NAME = 'site_work_session';

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.trim().length < 32) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: SESSION_SECRET environment variable is required and must be at least 32 characters long in production.'
      );
    }
    return new TextEncoder().encode(secret);
  }

  // Development fallback (Explicitly development only)
  return new TextEncoder().encode(
    secret || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
  );
}

export interface UserSession {
  userId: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  assignedSiteIds: string[];
  tokenVersion: number;
}

export async function createSessionCookie(payload: UserSession): Promise<string> {
  const secretKey = getSecretKey();

  const token = await new SignJWT({
    userId: payload.userId,
    username: payload.username,
    fullName: payload.fullName,
    role: payload.role,
    assignedSiteIds: payload.assignedSiteIds,
    tokenVersion: payload.tokenVersion || 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey);

  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 86400, // 24 hours
  });

  return token;
}

export async function getSession(): Promise<UserSession | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);

    const userId = payload.userId as string;
    const tokenVersion = (payload.tokenVersion as number) || 1;

    // Verify user exists and check active status + token version in SQLite
    const user = getUserById(userId);
    if (!user || user.is_active === 0) {
      return null;
    }

    // If token_version was incremented (e.g. after password reset, username change, or logout), reject old session
    if (user.token_version !== tokenVersion) {
      return null;
    }

    const assignedSiteIds = user.role === 'ADMIN' ? [] : getUserAssignedSites(user.id);

    return {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      assignedSiteIds,
      tokenVersion: user.token_version,
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
