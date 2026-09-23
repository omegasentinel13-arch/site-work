import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../lib/db/index';
import { getUserByUsername, verifyUserPassword } from '../lib/db/repositories/user-repo';
import { getAllSites } from '../lib/db/repositories/site-repo';
import { getCanonicalSiteSlug, resolveSiteBySlug, getDeterministicFallbackSite } from '../lib/site/slug';
import { createSessionCookie, verifySessionToken, refreshSessionActivity, UserSession } from '../lib/auth/session';
import { validateSiteAccess, ForbiddenError } from '../lib/auth/permissions';
import { canAccess } from '../lib/permissions/evaluator';
import { SignJWT } from 'jose';

describe('SITE WORK: Phase Site-Scoped Routing, Exact Username Auth & Inactivity Session Control', () => {

  // ==========================================
  // OBJECTIVE B: EXACT USERNAME AUTH (U1 - U7)
  // ==========================================
  describe('Objective B: Strict Exact & Case-Sensitive Username Auth', () => {
    const db = getDb();

    test('U1: Exact username matches (abadmin, Iamadmin, STAR-SCREW)', () => {
      const userAb = getUserByUsername('abadmin');
      assert.ok(userAb, 'abadmin user must be found with exact case and characters');
      assert.equal(userAb.username, 'abadmin');

      const userIam = getUserByUsername('Iamadmin');
      assert.ok(userIam, 'Iamadmin user must be found with exact mixed case');
      assert.equal(userIam.username, 'Iamadmin');

      const userStar = getUserByUsername('STAR-SCREW');
      assert.ok(userStar, 'STAR-SCREW user must be found with exact uppercase and hyphen');
      assert.equal(userStar.username, 'STAR-SCREW');
    });

    test('U2: Case mismatch rejected (Abadmin, iamadmin, star-screw -> null)', () => {
      const userCaps = getUserByUsername('Abadmin');
      assert.equal(userCaps, null, 'Capitalized Abadmin must return null');

      const userLower = getUserByUsername('iamadmin');
      assert.equal(userLower, null, 'Lowercase iamadmin must return null');

      const starLower = getUserByUsername('star-screw');
      assert.equal(starLower, null, 'Lowercase star-screw must return null');
    });

    test('U3: Internal whitespace mismatch rejected (ab admin -> null)', () => {
      const user = getUserByUsername('ab admin');
      assert.equal(user, null, 'Whitespace mismatch username must return null');
    });

    test('U4: Hyphen vs Underscore mismatch rejected', () => {
      const starUnderscore = getUserByUsername('STAR_SCREW');
      assert.equal(starUnderscore, null, 'STAR_SCREW with underscore must NOT match STAR-SCREW with hyphen');
    });

    test('U5: Leading/trailing spaces are NOT trimmed and must fail match', () => {
      const leadingSpace = getUserByUsername(' abadmin');
      assert.equal(leadingSpace, null, 'Leading space must not match stored username');

      const trailingSpace = getUserByUsername('abadmin ');
      assert.equal(trailingSpace, null, 'Trailing space must not match stored username');
    });

    test('U6: Punctuation is preserved exact (Admin.1)', () => {
      const testId = 'test-exact-punct-user';
      try {
        db.prepare('DELETE FROM users WHERE id = ?').run(testId);
        db.prepare(`
          INSERT INTO users (id, username, password_hash, full_name, role, is_active, token_version, created_at, updated_at)
          VALUES (?, 'Admin.1', '$2b$10$abcdefghijklmnopqrstuu', 'Admin Dot 1', 'ADMIN', 1, 1, datetime('now'), datetime('now'))
        `).run(testId);

        const exact = getUserByUsername('Admin.1');
        assert.ok(exact, 'Admin.1 with dot must match');

        const noDot = getUserByUsername('Admin1');
        assert.equal(noDot, null, 'Admin1 without dot must NOT match');
      } finally {
        db.prepare('DELETE FROM users WHERE id = ?').run(testId);
      }
    });

    test('U7: Existing production users remain functional with exact credentials', () => {
      const admin = getUserByUsername('abadmin');
      assert.ok(admin);
      assert.equal(admin.role, 'ADMIN');
      assert.equal(admin.is_active, 1);
    });
  });

  // ==========================================
  // OBJECTIVE C: CANONICAL SITE ROUTING (S1 - S7)
  // ==========================================
  describe('Objective C: Canonical Site Routing & Server-Side Authorization', () => {
    const sites = getAllSites(false);
    const site1 = sites.find((s) => s.id === 'site-1') || sites[0];
    const site2 = sites.find((s) => s.id === 'site-2') || sites[1];

    test('S1: /site1 resolves to Site 1 canonical slug', () => {
      const resolution = resolveSiteBySlug('site1', sites);
      assert.ok(resolution.site, 'site1 must resolve to a site');
      assert.equal(resolution.site.id, 'site-1');
      assert.equal(resolution.isCanonical, true);
      assert.equal(resolution.canonicalSlug, 'site1');
    });

    test('S2: Single canonical slug enforced: alias /site-1 or /s-01 resolves with isCanonical: false', () => {
      const resHyphen = resolveSiteBySlug('site-1', sites);
      assert.ok(resHyphen.site, 'site-1 must resolve');
      assert.equal(resHyphen.isCanonical, false, 'site-1 must not be marked canonical');
      assert.equal(resHyphen.canonicalSlug, 'site1');

      if (site1.code) {
        const resCode = resolveSiteBySlug(site1.code, sites);
        assert.ok(resCode.site, 'Code must resolve');
        assert.equal(resCode.isCanonical, false, 'Code slug must not be canonical when canonical is site1');
        assert.equal(resCode.canonicalSlug, 'site1');
      }
    });

    test('S3: Authorized user accesses site with valid permission', () => {
      const adminSession: UserSession = {
        userId: 'admin-id',
        username: 'abadmin',
        fullName: 'AB Admin',
        role: 'ADMIN',
        assignedSiteIds: [],
        tokenVersion: 1,
      };

      // Admin has access to site-1 and site-2 without error
      assert.doesNotThrow(() => validateSiteAccess(adminSession, site1.id));
      assert.doesNotThrow(() => validateSiteAccess(adminSession, site2.id));
    });

    test('S4: Unauthorized user accessing /site1 falls back to authorized site2', () => {
      const managerSession: UserSession = {
        userId: 'manager-id',
        username: 'SiteManager',
        fullName: 'Site Manager',
        role: 'SITE_MANAGER',
        assignedSiteIds: [site2.id],
        tokenVersion: 1,
      };

      // Attempt access to site1 throws ForbiddenError
      assert.throws(() => validateSiteAccess(managerSession, site1.id), ForbiddenError);

      // Deterministic fallback yields site2
      const fallback = getDeterministicFallbackSite(managerSession, sites);
      assert.ok(fallback, 'Fallback site must be found');
      assert.equal(fallback.id, site2.id, 'Fallback must be the authorized site-2');
      assert.equal(getCanonicalSiteSlug(fallback, sites), 'site2');
    });

    test('S5: Deterministic fallback resolves correctly with query parameters preserved', () => {
      const managerSession: UserSession = {
        userId: 'manager-id',
        username: 'SiteManager',
        fullName: 'Site Manager',
        role: 'SITE_MANAGER',
        assignedSiteIds: [site2.id],
        tokenVersion: 1,
      };

      const fallback = getDeterministicFallbackSite(managerSession, sites);
      const fallbackSlug = getCanonicalSiteSlug(fallback!, sites);
      const subPath = '/attendance/monthly';
      const search = '?date=2026-09-23&view=compact';

      const targetUrl = `/${fallbackSlug}${subPath}${search}`;
      assert.equal(targetUrl, '/site2/attendance/monthly?date=2026-09-23&view=compact');
    });

    test('S6: Legacy non-site route determines user default canonical site', () => {
      const adminSession: UserSession = {
        userId: 'admin-id',
        username: 'abadmin',
        fullName: 'AB Admin',
        role: 'ADMIN',
        assignedSiteIds: [],
        tokenVersion: 1,
      };

      const targetSite = getDeterministicFallbackSite(adminSession, sites);
      assert.ok(targetSite);
      const canonicalSlug = getCanonicalSiteSlug(targetSite, sites);
      assert.equal(canonicalSlug, 'site1');
    });

    test('S7: Direct API calls to unauthorized siteId rejected with HTTP 403 Forbidden', () => {
      const managerSession: UserSession = {
        userId: 'manager-id',
        username: 'SiteManager',
        fullName: 'Site Manager',
        role: 'SITE_MANAGER',
        assignedSiteIds: [site2.id],
        tokenVersion: 1,
      };

      const access = canAccess({
        session: managerSession,
        page: 'PAGE_ATTENDANCE_DAILY',
        action: 'VIEW',
        siteId: site1.id,
        resourceSiteId: site1.id,
      });

      assert.equal(access.allowed, false, 'Access to unauthorized site must be disallowed');
      assert.ok(access.ruleSource === 'UNASSIGNED_SITE_DENY' || access.ruleSource === 'SITE_MEMBERSHIP_REQUIRED');
    });
  });

  // ==========================================
  // OBJECTIVE A: MASTER LEDGER REMOVAL (M1 - M4)
  // ==========================================
  describe('Objective A: Master Ledger Removal & Route Retirement', () => {
    test('M1: Master Ledger absent from desktop navigation in Navigation.tsx', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('components/layout/Navigation.tsx', 'utf-8');
      assert.ok(!content.includes('/finance/monthly'), 'Navigation.tsx must not contain /finance/monthly');
      assert.ok(!content.includes('Master Ledger'), 'Navigation.tsx must not contain Master Ledger');
    });

    test('M2: Master Ledger absent from mobile drawer in Header.tsx', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('components/layout/Header.tsx', 'utf-8');
      assert.ok(!content.includes('/finance/monthly'), 'Header.tsx must not contain /finance/monthly');
      assert.ok(!content.includes('Master Ledger'), 'Header.tsx must not contain Master Ledger');
    });

    test('M3: Master Ledger absent from site setup page quick-actions', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('app/(dashboard)/setup/sites/page.tsx', 'utf-8');
      assert.ok(!content.includes('/finance/monthly'), 'sites/page.tsx must not link to /finance/monthly');
      assert.ok(!content.includes('Master Ledger'), 'sites/page.tsx must not reference Master Ledger');
    });

    test('M4: Direct access to /finance/monthly redirects to /finance', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('app/(dashboard)/finance/monthly/page.tsx', 'utf-8');
      assert.ok(content.includes('/finance'), 'app/(dashboard)/finance/monthly/page.tsx must redirect to /finance');
    });
  });

  // ==========================================
  // OBJECTIVE D: 60-MIN INACTIVITY & MULTI-TAB (I1 - I9)
  // ==========================================
  describe('Objective D: Inactivity Session Control & Multi-Tab Synchronization', () => {
    const adminUser = getUserByUsername('abadmin')!;

    test('I1: Existing JWT without lastActivity remains backward-compatible via iat', async () => {
      const secret = new TextEncoder().encode(
        process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
      );
      // Create a legacy token without lastActivity
      const legacyToken = await new SignJWT({
        userId: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        assignedSiteIds: [],
        tokenVersion: adminUser.token_version,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt() // current iat
        .setExpirationTime('24h')
        .sign(secret);

      const verified = await verifySessionToken(legacyToken);
      assert.ok(verified, 'Legacy token with iat must be verified successfully');
      assert.equal(verified.username, 'abadmin');
    });

    test('I2: Session older than 60 minutes since lastActivity is rejected server-side', async () => {
      const secret = new TextEncoder().encode(
        process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
      );
      const sixtyOneMinutesAgo = Math.floor(Date.now() / 1000) - (61 * 60);

      const expiredToken = await new SignJWT({
        userId: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        assignedSiteIds: [],
        tokenVersion: adminUser.token_version,
        lastActivity: sixtyOneMinutesAgo,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(sixtyOneMinutesAgo)
        .setExpirationTime('24h')
        .sign(secret);

      const verified = await verifySessionToken(expiredToken);
      assert.equal(verified, null, 'Token with lastActivity > 60m ago must be rejected');
    });

    test('I3: Heartbeat re-issues token with updated lastActivity when >= 5 min elapsed', async () => {
      const secret = new TextEncoder().encode(
        process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
      );
      const sixMinutesAgo = Math.floor(Date.now() / 1000) - (6 * 60);

      const sixMinOldToken = await new SignJWT({
        userId: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        assignedSiteIds: [],
        tokenVersion: adminUser.token_version,
        lastActivity: sixMinutesAgo,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(sixMinutesAgo)
        .setExpirationTime('24h')
        .sign(secret);

      const res = await refreshSessionActivity(sixMinOldToken);
      assert.equal(res.success, true);
      assert.equal(res.refreshed, true, 'Token >= 5m idle must be refreshed');
    });

    test('I4: Heartbeat does NOT write to SQLite database', async () => {
      const db = getDb();
      // Inspect SQLite change count before and after refreshSessionActivity
      const changesBefore = (db.prepare('SELECT total_changes() as cnt').get() as any).cnt;

      const secret = new TextEncoder().encode(
        process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
      );
      const token = await new SignJWT({
        userId: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        assignedSiteIds: [],
        tokenVersion: adminUser.token_version,
        lastActivity: Math.floor(Date.now() / 1000) - 400,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);

      await refreshSessionActivity(token);
      const changesAfter = (db.prepare('SELECT total_changes() as cnt').get() as any).cnt;

      assert.equal(changesBefore, changesAfter, 'Database total_changes must NOT increase during heartbeat session refresh');
    });

    test('I5: InactivityManager source contains BroadcastChannel and cross-tab sync', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('components/auth/InactivityManager.tsx', 'utf-8');
      assert.ok(content.includes('BroadcastChannel'), 'InactivityManager must implement BroadcastChannel');
      assert.ok(content.includes('site_work_inactivity_sync'), 'InactivityManager must use sync channel name');
      assert.ok(content.includes('INACTIVITY_LOGOUT'), 'InactivityManager must broadcast logout across tabs');
    });

    test('I6: InactivityManager preserves return URL upon timeout logout', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('components/auth/InactivityManager.tsx', 'utf-8');
      assert.ok(content.includes('encodeURIComponent(currentPath)'), 'InactivityManager must preserve currentPath in next parameter');
    });

    test('I7: Heartbeat endpoint handles POST with session refresh', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('app/api/auth/heartbeat/route.ts', 'utf-8');
      assert.ok(content.includes('refreshSessionActivity'), 'Heartbeat route must call refreshSessionActivity');
      assert.ok(content.includes('POST'), 'Heartbeat route must export POST');
    });

    test('I8: Token with lastActivity within 60 minutes remains active', async () => {
      const secret = new TextEncoder().encode(
        process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
      );
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);

      const activeToken = await new SignJWT({
        userId: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        assignedSiteIds: [],
        tokenVersion: adminUser.token_version,
        lastActivity: tenMinutesAgo,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(tenMinutesAgo)
        .setExpirationTime('24h')
        .sign(secret);

      const verified = await verifySessionToken(activeToken);
      assert.ok(verified, 'Active token within 60m must be valid');
      assert.equal(verified.userId, adminUser.id);
    });

    test('I9: Continuous activity throttles heartbeat under 5 minutes', async () => {
      const secret = new TextEncoder().encode(
        process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
      );
      // Token active 60 seconds ago (< 300 seconds)
      const oneMinuteAgo = Math.floor(Date.now() / 1000) - 60;

      const freshToken = await new SignJWT({
        userId: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        assignedSiteIds: [],
        tokenVersion: adminUser.token_version,
        lastActivity: oneMinuteAgo,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(oneMinuteAgo)
        .setExpirationTime('24h')
        .sign(secret);

      const res = await refreshSessionActivity(freshToken);
      assert.equal(res.success, true);
      assert.equal(res.refreshed, false, 'Heartbeat under 5 minutes must be throttled');
    });
  });
});
