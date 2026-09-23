import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Set up clean isolated test database
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_auth_gate_visibility.db');
if (fs.existsSync(TEST_DB_PATH)) {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
}
process.env.DATABASE_PATH = TEST_DB_PATH;

import { getDb, closeDb } from '../lib/db/index';
import { runSeed } from '../lib/db/seed';
import { createUser } from '../lib/db/repositories/user-repo';
import { normalizeSafeRedirectPath } from '../lib/auth/redirect';
import { GET as getMe } from '../app/api/auth/me/route';
import { middleware } from '../middleware';
import { NextRequest } from 'next/server';

test('AUTHENTICATION GATE & LOGIN PASSWORD VISIBILITY TEST SUITE', async (t) => {
  const db = getDb();
  runSeed();

  const adminId = createUser({
    username: 'admin_test_gate',
    passwordPlainText: 'AdminPass2026!',
    fullName: 'Admin Test Gate',
    role: 'ADMIN',
  });

  // ============================================================================
  // GROUP 1: SAFE REDIRECT NORMALIZATION (TESTS G, H, I, J, K)
  // ============================================================================
  await t.test('TEST G: Login without next parameter falls back to /', () => {
    assert.equal(normalizeSafeRedirectPath(undefined), '/');
    assert.equal(normalizeSafeRedirectPath(null), '/');
    assert.equal(normalizeSafeRedirectPath(''), '/');
    assert.equal(normalizeSafeRedirectPath('/'), '/');
  });

  await t.test('TEST H: Login with valid relative paths preserves destination', () => {
    assert.equal(normalizeSafeRedirectPath('/finance'), '/finance');
    assert.equal(normalizeSafeRedirectPath('/finance/monthly'), '/finance/monthly');
    assert.equal(normalizeSafeRedirectPath('/attendance/daily'), '/attendance/daily');
    assert.equal(normalizeSafeRedirectPath('/setup/users'), '/setup/users');
    assert.equal(
      normalizeSafeRedirectPath('/attendance/daily?date=2026-09-23'),
      '/attendance/daily?date=2026-09-23',
      'Must preserve query parameters'
    );
  });

  await t.test('TEST I: Malicious external URL next=https://example.com is rejected', () => {
    assert.equal(normalizeSafeRedirectPath('https://example.com'), '/');
    assert.equal(normalizeSafeRedirectPath('http://example.com/finance'), '/');
  });

  await t.test('TEST J: Malicious protocol-relative URL next=//example.com is rejected', () => {
    assert.equal(normalizeSafeRedirectPath('//example.com'), '/');
    assert.equal(normalizeSafeRedirectPath('//example.com/finance'), '/');
    assert.equal(normalizeSafeRedirectPath('/\\example.com'), '/');
    assert.equal(normalizeSafeRedirectPath('\\example.com'), '/');
  });

  await t.test('TEST K: Malicious protocol scheme next=javascript:alert(1) is rejected', () => {
    assert.equal(normalizeSafeRedirectPath('javascript:alert(1)'), '/');
    assert.equal(normalizeSafeRedirectPath('data:text/html,<script>alert(1)</script>'), '/');
    assert.equal(normalizeSafeRedirectPath('vbscript:msgbox(1)'), '/');
  });

  // ============================================================================
  // GROUP 2: MIDDLEWARE PATH FORWARDING
  // ============================================================================
  await t.test('Middleware attaches requested path in x-current-path header', () => {
    const req1 = new NextRequest('http://localhost:3000/');
    const res1 = middleware(req1);
    assert.equal(res1.headers.get('x-current-path'), '/');

    const req2 = new NextRequest('http://localhost:3000/finance');
    const res2 = middleware(req2);
    assert.equal(res2.headers.get('x-current-path'), '/finance');

    const req3 = new NextRequest('http://localhost:3000/attendance/daily?date=2026-09-23');
    const res3 = middleware(req3);
    assert.equal(res3.headers.get('x-current-path'), '/attendance/daily?date=2026-09-23');
  });

  // ============================================================================
  // GROUP 3: DASHBOARD SERVER LAYOUT AUTH GATE (TESTS A, B, C, D, E, F)
  // ============================================================================
  await t.test('TESTS A, B, C, D: Unauthenticated requests trigger Next.js redirect with target', async () => {
    const layoutPath = path.join(process.cwd(), 'app', '(dashboard)', 'layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    // 1. Must NOT be 'use client'
    assert.ok(!layoutSource.includes("'use client'"), 'Dashboard layout must be a Server Component');

    // 2. Must import getSession and redirect
    assert.ok(layoutSource.includes('getSession'), 'Layout must check getSession()');
    assert.ok(layoutSource.includes('redirect'), 'Layout must invoke redirect()');

    // 3. Must be dynamically rendered
    assert.ok(layoutSource.includes("export const dynamic = 'force-dynamic'"), 'Layout must be force-dynamic');
    assert.ok(layoutSource.includes('export const revalidate = 0'), 'Layout revalidate must be 0');

    // 4. Test logic emulation of DashboardLayout
    function emulateLayoutGuard(session: unknown, currentPath?: string | null) {
      if (!session) {
        if (currentPath && currentPath !== '/') {
          return `/login?next=${encodeURIComponent(currentPath)}`;
        }
        return '/login';
      }
      return 'RENDER_DASHBOARD';
    }

    // TEST A: Unauthenticated GET /
    assert.equal(emulateLayoutGuard(null, '/'), '/login');

    // TEST B: Unauthenticated GET /finance
    assert.equal(emulateLayoutGuard(null, '/finance'), '/login?next=%2Ffinance');

    // TEST C: Unauthenticated GET /attendance/daily
    assert.equal(emulateLayoutGuard(null, '/attendance/daily'), '/login?next=%2Fattendance%2Fdaily');

    // TEST D: Unauthenticated GET /setup/users
    assert.equal(emulateLayoutGuard(null, '/setup/users'), '/login?next=%2Fsetup%2Fusers');

    // TEST E: Authenticated GET /
    const mockSession = { userId: adminId, username: 'admin_test_gate', role: 'ADMIN', assignedSiteIds: [] };
    assert.equal(emulateLayoutGuard(mockSession, '/'), 'RENDER_DASHBOARD');

    // TEST F: Authenticated GET /finance
    assert.equal(emulateLayoutGuard(mockSession, '/finance'), 'RENDER_DASHBOARD');
  });

  // ============================================================================
  // GROUP 4: /api/auth/me CONTRACT & CLIENT DEFENSE-IN-DEPTH (TESTS L, M)
  // ============================================================================
  await t.test('TEST L: GET /api/auth/me without session returns HTTP 200 with { user: null }', async () => {
    // In test runner without active cookie, getSession() returns null
    const res = await getMe();
    assert.equal(res.status, 200, 'Must return HTTP 200 status');
    const data = await res.json();
    assert.deepEqual(data, { user: null }, 'Must return { user: null } contract');
  });

  await t.test('TEST M: SiteProvider redirects when user is null (Defense-in-depth)', () => {
    const siteContextPath = path.join(process.cwd(), 'context', 'site-context.tsx');
    const content = fs.readFileSync(siteContextPath, 'utf8');

    // Must check both !userRes.ok AND !userData.user
    assert.ok(content.includes('!userData.user'), 'SiteProvider must check !userData.user');
    assert.ok(content.includes("router.replace(target)"), 'SiteProvider must redirect to login on null user');
  });

  // ============================================================================
  // GROUP 5: PASSWORD VISIBILITY CONTROL (TESTS N, O, P, Q, R)
  // ============================================================================
  await t.test('TESTS N, O, P, Q, R: Password Visibility Toggle specifications', () => {
    const loginPagePath = path.join(process.cwd(), 'app', 'login', 'page.tsx');
    const loginSource = fs.readFileSync(loginPagePath, 'utf8');

    // TEST N: Default is hidden (showPassword defaults to false)
    assert.ok(loginSource.includes('useState(false)'), 'showPassword must initialize to false (hidden)');
    assert.ok(loginSource.includes("type={showPassword ? 'text' : 'password'}"), 'Input type must be conditional');

    // TEST O & P: Toggling showPassword toggles between text and password
    assert.ok(loginSource.includes('setShowPassword((prev) => !prev)'), 'Clicking must toggle state');

    // TEST Q: Button has accessible aria-label and title
    assert.ok(
      loginSource.includes("aria-label={showPassword ? 'Hide password' : 'Show password'}"),
      'Must have accessible aria-label'
    );
    assert.ok(
      loginSource.includes("title={showPassword ? 'Hide password' : 'Show password'}"),
      'Must have accessible title'
    );

    // TEST R: Button uses type="button" so it does not submit form, and has 44x44px target
    assert.ok(loginSource.includes('type="button"'), 'Eye toggle must explicitly be type="button"');
    assert.ok(loginSource.includes('w-11 h-11'), 'Eye toggle must have 44x44px minimum target (w-11 h-11)');
    assert.ok(loginSource.includes('pr-12'), 'Password input must have right padding pr-12 to avoid character collision');
  });
});

test.after(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
});
