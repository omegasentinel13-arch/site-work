import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getUserById, getUserAssignedSites } from '../db/repositories/user-repo';

import { AuthorityTier, getAuthorityTier } from './authority';

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
  authorityTier?: AuthorityTier;
  assignedSiteIds: string[];
  tokenVersion: number;
  lastActivity?: number;
}

export async function createSessionCookie(payload: UserSession): Promise<string> {
  const secretKey = getSecretKey();
  const nowSec = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    userId: payload.userId,
    username: payload.username,
    fullName: payload.fullName,
    role: payload.role,
    authorityTier: payload.authorityTier || (payload.role === 'ADMIN' ? 'STANDARD_ADMIN' : 'STANDARD'),
    assignedSiteIds: payload.assignedSiteIds,
    tokenVersion: payload.tokenVersion || 1,
    lastActivity: payload.lastActivity || nowSec,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey);

  try {
    const cookieStore = cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400, // 24 hours
    });
  } catch {
    // Safe fallback when running in Node.js test runner context without Next.js async storage
  }

  return token;
}

export async function verifySessionToken(token: string): Promise<UserSession | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);

    const nowSec = Math.floor(Date.now() / 1000);
    // Backward compatibility: fallback to payload.iat if lastActivity is missing
    const lastActivity = (payload.lastActivity as number) || (payload.iat as number) || nowSec;

    // 60 minutes = 3600 seconds inactivity limit
    if (nowSec - lastActivity > 3600) {
      return null;
    }

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
    const authorityTier: AuthorityTier = (user as any).authority_tier || (user.role === 'ADMIN' ? 'STANDARD_ADMIN' : 'STANDARD');

    return {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      authorityTier,
      assignedSiteIds,
      tokenVersion: user.token_version,
      lastActivity,
    };
  } catch {
    return null;
  }
}

export async function refreshSessionActivity(explicitToken?: string): Promise<{ success: boolean; refreshed: boolean; message?: string }> {
  try {
    let token = explicitToken;
    let cookieStore;
    try {
      cookieStore = cookies();
      if (!token) {
        token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      }
    } catch {
      // test runner context
    }

    if (!token) {
      return { success: false, refreshed: false, message: 'No session token' };
    }

    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);

    const nowSec = Math.floor(Date.now() / 1000);
    const lastActivity = (payload.lastActivity as number) || (payload.iat as number) || nowSec;

    // If expired past 60 min, cannot refresh
    if (nowSec - lastActivity > 3600) {
      return { success: false, refreshed: false, message: 'Session idle expired' };
    }

    // Throttling: only refresh if >= 5 minutes (300s) have passed since last activity
    if (payload.lastActivity && (nowSec - (payload.lastActivity as number) < 300)) {
      return { success: true, refreshed: false, message: 'Throttled (< 5 min)' };
    }

    const newToken = await new SignJWT({
      userId: payload.userId,
      username: payload.username,
      fullName: payload.fullName,
      role: payload.role,
      authorityTier: payload.authorityTier,
      assignedSiteIds: payload.assignedSiteIds,
      tokenVersion: payload.tokenVersion,
      lastActivity: nowSec,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(payload.iat || nowSec) // preserve original login issued-at
      .setExpirationTime(payload.exp || (nowSec + 86400)) // preserve original 24h ceiling
      .sign(secretKey);

    if (cookieStore) {
      cookieStore.set(SESSION_COOKIE_NAME, newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 86400,
      });
    }

    return { success: true, refreshed: true };
  } catch (err: any) {
    return { success: false, refreshed: false, message: err?.message || 'Verification error' };
  }
}

export async function getSession(): Promise<UserSession | null> {
  if (process.env.NODE_ENV !== 'production' && (globalThis as any).__TEST_SESSION__ !== undefined) {
    return (globalThis as any).__TEST_SESSION__;
  }
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    return verifySessionToken(token);
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
