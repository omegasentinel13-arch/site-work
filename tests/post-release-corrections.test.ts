import assert from 'node:assert/strict';
import { getDb, runTransaction } from '../lib/db';
import { 
  getAllSites, 
  getSiteById, 
  getSiteByHistoricalSlug,
  createSite, 
  updateSite, 
  SiteRecord 
} from '../lib/db/repositories/site-repo';
import { 
  generateNameSlug, 
  generateCodeSlug, 
  getCanonicalSiteSlug, 
  resolveSiteBySlug, 
  getDeterministicFallbackSite 
} from '../lib/site/slug';
import { 
  classifyRoute, 
  isOperationalRoute, 
  isAdministrativeRoute 
} from '../lib/site/routes';
import { normalizeSafeRedirectPath } from '../lib/auth/redirect';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING POST-RELEASE PRODUCTION QA VERIFICATION SUITE');
  console.log('SPECIFICATIONS: J1 THROUGH J16');
  console.log('====================================================\n');

  const db = getDb();
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // J1: Login Render & No-Next Default Destination
  // --------------------------------------------------------------------------
  test('J1: Default URL points directly to canonical site dashboard without double-hop redirect', () => {
    const allSites = getAllSites(false);
    assert.ok(allSites.length >= 2, 'Must have at least 2 active sites');
    
    // Simulate user session with access to Site 1
    const session = {
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      fullName: 'System Administrator',
      role: 'ADMIN' as const,
      assignedSiteIds: [],
      tokenVersion: 1,
    };
    const defaultSite = getDeterministicFallbackSite(session, allSites);
    assert.ok(defaultSite, 'Default site must resolve');
    const defaultSlug = getCanonicalSiteSlug(defaultSite, allSites);
    assert.equal(defaultSlug, 'site1', 'Admin default canonical slug must be site1');

    // Simulate login page target resolution when next is absent
    const nextParam = null;
    let target = `/${defaultSlug}`;
    if (nextParam) {
      const validated = normalizeSafeRedirectPath(nextParam);
      if (validated && validated !== '/') target = validated;
    }
    assert.equal(target, '/site1', 'Destination must be direct /site1 dashboard');
  });

  // --------------------------------------------------------------------------
  // J2: Safe Relative Next Navigation
  // --------------------------------------------------------------------------
  test('J2: Valid relative next parameter navigates directly to target', () => {
    const nextParam = '/site2/attendance/monthly?date=2026-09';
    const validated = normalizeSafeRedirectPath(nextParam);
    assert.equal(validated, '/site2/attendance/monthly?date=2026-09');

    let target = '/site1';
    if (nextParam) {
      const v = normalizeSafeRedirectPath(nextParam);
      if (v && v !== '/') target = v;
    }
    assert.equal(target, '/site2/attendance/monthly?date=2026-09');
  });

  // --------------------------------------------------------------------------
  // J3: Malicious / External Next Rejection
  // --------------------------------------------------------------------------
  test('J3: Malicious, external, or malformed next parameters are discarded in favor of defaultUrl', () => {
    const defaultUrl = '/site1';
    const maliciousInputs = [
      'https://evil.com/phish',
      'http://attacker.org',
      '//evil.com',
      '/\\evil.com',
      '\\attacker.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '',
      '/',
      '   ',
    ];

    for (const input of maliciousInputs) {
      const validated = normalizeSafeRedirectPath(input);
      let target = defaultUrl;
      if (input) {
        const v = normalizeSafeRedirectPath(input);
        if (v && v !== '/') target = v;
      }
      assert.equal(target, defaultUrl, `Input "${input}" must fall back to defaultUrl`);
    }
  });

  // --------------------------------------------------------------------------
  // J4: Mode A Name Slug Generation
  // --------------------------------------------------------------------------
  test('J4: Mode A generates deterministic canonical slugs from names', () => {
    assert.equal(generateNameSlug('Site 1'), 'site1');
    assert.equal(generateNameSlug('Site 2'), 'site2');
    assert.equal(generateNameSlug('SIVASAKTHI SITE'), 'sivasakthi-site');
    assert.equal(generateNameSlug('Sivasakthi Construction Project'), 'sivasakthi-construction-project');
    assert.equal(generateNameSlug('Villa Project Phase 1 (Updated)'), 'villa-project-phase-1-updated');
    assert.equal(generateNameSlug('Special Site & Workshop! (Phase #2)'), 'special-site-workshop-phase-2');
  });

  // --------------------------------------------------------------------------
  // J5: Mode B Code Slug Generation
  // --------------------------------------------------------------------------
  test('J5: Mode B generates canonical slugs from site code', () => {
    assert.equal(generateCodeSlug('S-01'), 's01');
    assert.equal(generateCodeSlug('S-07'), 's07');
    assert.equal(generateCodeSlug('SITE-09A'), 'site09a');
  });

  // --------------------------------------------------------------------------
  // J6: Rename & 307 Alias Redirect
  // --------------------------------------------------------------------------
  test('J6: Site rename stores old slug in history and resolves via 307 alias', () => {
    // Create temporary site in NAME mode
    const tempId = createSite('Test Alpha Project', 'T-ALP', 'Building A', 'usr-admin-1', 'NAME');
    const createdSite = getSiteById(tempId);
    assert.ok(createdSite);
    assert.equal(createdSite.canonical_slug, 'test-alpha-project');

    // Rename site
    updateSite(tempId, 'Test Alpha Renovated', 'T-ALP', 'Building A');
    const updatedSite = getSiteById(tempId);
    assert.ok(updatedSite);
    assert.equal(updatedSite.canonical_slug, 'test-alpha-renovated');

    // Query old slug
    const allSites = getAllSites(false);
    const oldResolution = resolveSiteBySlug('test-alpha-project', allSites, getSiteByHistoricalSlug);
    assert.ok(oldResolution.site, 'Old slug must resolve to the site');
    assert.equal(oldResolution.site.id, tempId);
    assert.equal(oldResolution.isCanonical, false, 'Old slug must be flagged as non-canonical');
    assert.equal(oldResolution.canonicalSlug, 'test-alpha-renovated', 'Old slug must point to new canonical slug');

    // Clean up
    db.prepare('DELETE FROM sites WHERE id = ?').run(tempId);
    db.prepare('DELETE FROM site_slug_history WHERE site_id = ?').run(tempId);
  });

  // --------------------------------------------------------------------------
  // J7: Category A Operational Route Fallback
  // --------------------------------------------------------------------------
  test('J7: Category A operational routes fallback to authorized site on same sub-page & query', () => {
    const operationalPaths = [
      '/attendance/daily',
      '/attendance/weekly',
      '/attendance/monthly',
      '/finance',
      '/transactions',
      '/reports/role',
      '/reports/site',
      '/reports/complete-export',
      '/analytics',
    ];

    for (const p of operationalPaths) {
      assert.equal(isOperationalRoute(p), true, `${p} must be operational`);
      assert.equal(classifyRoute(p), 'OPERATIONAL', `${p} category must be OPERATIONAL`);
    }

    // Engineer with Site 2 only requests /site1/attendance/monthly?date=2026-09-23
    const session = {
      userId: 'usr-eng-1',
      username: 'Site2Engineer',
      fullName: 'Site 2 Engineer',
      role: 'SITE_MANAGER' as const,
      assignedSiteIds: ['site-2'],
      tokenVersion: 1,
    };
    const allSites = getAllSites(false);
    const fallback = getDeterministicFallbackSite(session, allSites);
    assert.ok(fallback);
    assert.equal(fallback.id, 'site-2');
    const fallbackSlug = getCanonicalSiteSlug(fallback, allSites);
    assert.equal(fallbackSlug, 'site2');

    const subPath = '/attendance/monthly';
    const search = '?date=2026-09-23';
    const target = isOperationalRoute(subPath) ? `/${fallbackSlug}${subPath}${search}` : `/${fallbackSlug}`;
    assert.equal(target, '/site2/attendance/monthly?date=2026-09-23');
  });

  // --------------------------------------------------------------------------
  // J8: Category B Admin Route Fallback
  // --------------------------------------------------------------------------
  test('J8: Category B administrative routes fallback to authorized dashboard, never preserving admin view', () => {
    const adminPaths = [
      '/setup/sites',
      '/setup/roles',
      '/setup/users',
      '/setup/audit-trail',
      '/setup/categories',
      '/setup/archive',
      '/setup/recycle-bin',
      '/setup/account',
      '/admin/data-protection',
      '/admin/backup',
      '/account',
      '/sites',
    ];

    for (const p of adminPaths) {
      assert.equal(isAdministrativeRoute(p), true, `${p} must be administrative`);
      assert.equal(classifyRoute(p), 'ADMINISTRATIVE', `${p} category must be ADMINISTRATIVE`);
    }

    const session = {
      userId: 'usr-eng-1',
      username: 'Site2Engineer',
      fullName: 'Site 2 Engineer',
      role: 'SITE_MANAGER' as const,
      assignedSiteIds: ['site-2'],
      tokenVersion: 1,
    };
    const allSites = getAllSites(false);
    const fallback = getDeterministicFallbackSite(session, allSites);
    assert.ok(fallback);
    const fallbackSlug = getCanonicalSiteSlug(fallback, allSites);

    const subPath = '/setup/sites';
    const search = '';
    const target = isOperationalRoute(subPath) ? `/${fallbackSlug}${subPath}${search}` : `/${fallbackSlug}`;
    assert.equal(target, '/site2', 'Must redirect to /site2 dashboard, NEVER /site2/setup/sites');
  });

  // --------------------------------------------------------------------------
  // J9: Zero Authorized Sites Safety Boundary
  // --------------------------------------------------------------------------
  test('J9: Authenticated user with zero authorized sites returns null fallback', () => {
    const zeroSiteSession = {
      userId: 'usr-zero',
      username: 'ZeroSitesUser',
      fullName: 'Zero Sites',
      role: 'SITE_MANAGER' as const,
      assignedSiteIds: [],
      tokenVersion: 1,
    };
    const allSites = getAllSites(false);
    const fallback = getDeterministicFallbackSite(zeroSiteSession, allSites);
    assert.equal(fallback, null, 'Must return null fallback for zero-site user');
  });

  // --------------------------------------------------------------------------
  // J10: Database Transaction Atomicity
  // --------------------------------------------------------------------------
  test('J10: runTransaction ensures atomic rollback on error', () => {
    const initialHistoryCount = (db.prepare('SELECT COUNT(*) as c FROM site_slug_history').get() as any).c;
    
    try {
      runTransaction(db, () => {
        db.prepare("INSERT INTO site_slug_history (slug, site_id, created_at) VALUES ('atomic-test-slug', 'site-1', datetime('now'))").run();
        throw new Error('Intentional transaction test rollback');
      });
    } catch (err: any) {
      assert.equal(err.message, 'Intentional transaction test rollback');
    }

    const currentHistoryCount = (db.prepare('SELECT COUNT(*) as c FROM site_slug_history').get() as any).c;
    assert.equal(currentHistoryCount, initialHistoryCount, 'Transaction rollback must leave slug history unchanged');
  });

  // --------------------------------------------------------------------------
  // J11: Login Next Operational Re-Auth
  // --------------------------------------------------------------------------
  test('J11: Login destination re-authorization redirects unauthorized operational route to authorized equivalent', () => {
    const session = {
      userId: 'usr-site2',
      username: 'Site2User',
      fullName: 'Site 2 User',
      role: 'SITE_MANAGER' as const,
      assignedSiteIds: ['site-2'],
      tokenVersion: 1,
    };
    const allSites = getAllSites(false);
    const requestedNext = '/site1/attendance/monthly?date=2026-09-23';

    // Simulate server boundary resolution
    const segments = requestedNext.split('?')[0].split('/').filter(Boolean);
    const candidateSlug = segments[0]; // 'site1'
    const subPath = '/' + segments.slice(1).join('/'); // '/attendance/monthly'
    const search = '?date=2026-09-23';

    const resolution = resolveSiteBySlug(candidateSlug, allSites);
    assert.ok(resolution.site);
    assert.equal(resolution.site.id, 'site-1');

    // Check user access: site-1 is not in assignedSiteIds ['site-2']
    const hasAccess = session.role === 'ADMIN' || session.assignedSiteIds.includes(resolution.site.id);
    assert.equal(hasAccess, false, 'User must not have access to site-1');

    // Re-route
    const fallback = getDeterministicFallbackSite(session, allSites);
    assert.ok(fallback);
    const fallbackSlug = getCanonicalSiteSlug(fallback, allSites);
    assert.equal(fallbackSlug, 'site2');

    const destination = isOperationalRoute(subPath) ? `/${fallbackSlug}${subPath}${search}` : `/${fallbackSlug}`;
    assert.equal(destination, '/site2/attendance/monthly?date=2026-09-23');
  });

  // --------------------------------------------------------------------------
  // J12: Login Next Admin Re-Auth
  // --------------------------------------------------------------------------
  test('J12: Login destination re-authorization redirects unauthorized admin route to authorized dashboard', () => {
    const session = {
      userId: 'usr-site2',
      username: 'Site2User',
      fullName: 'Site 2 User',
      role: 'SITE_MANAGER' as const,
      assignedSiteIds: ['site-2'],
      tokenVersion: 1,
    };
    const allSites = getAllSites(false);
    const requestedNext = '/site1/setup/sites';

    const segments = requestedNext.split('?')[0].split('/').filter(Boolean);
    const candidateSlug = segments[0]; // 'site1'
    const subPath = '/' + segments.slice(1).join('/'); // '/setup/sites'

    const resolution = resolveSiteBySlug(candidateSlug, allSites);
    assert.ok(resolution.site);
    const hasAccess = session.role === 'ADMIN' || session.assignedSiteIds.includes(resolution.site.id);
    assert.equal(hasAccess, false);

    const fallback = getDeterministicFallbackSite(session, allSites);
    assert.ok(fallback);
    const fallbackSlug = getCanonicalSiteSlug(fallback, allSites);

    const destination = isOperationalRoute(subPath) ? `/${fallbackSlug}${subPath}` : `/${fallbackSlug}`;
    assert.equal(destination, '/site2', 'Must redirect to /site2 dashboard, NEVER /site2/setup/sites');
  });

  // --------------------------------------------------------------------------
  // J13: Login Next Authorized Page
  // --------------------------------------------------------------------------
  test('J13: Login destination re-authorization preserves authorized target', () => {
    const session = {
      userId: 'usr-site2',
      username: 'Site2User',
      fullName: 'Site 2 User',
      role: 'SITE_MANAGER' as const,
      assignedSiteIds: ['site-2'],
      tokenVersion: 1,
    };
    const allSites = getAllSites(false);
    const requestedNext = '/site2/attendance/monthly';

    const segments = requestedNext.split('?')[0].split('/').filter(Boolean);
    const candidateSlug = segments[0];
    const subPath = '/' + segments.slice(1).join('/');

    const resolution = resolveSiteBySlug(candidateSlug, allSites);
    assert.ok(resolution.site);
    const hasAccess = session.role === 'ADMIN' || session.assignedSiteIds.includes(resolution.site.id);
    assert.equal(hasAccess, true, 'User must have access to site-2');

    const destination = `/${getCanonicalSiteSlug(resolution.site, allSites)}${subPath}`;
    assert.equal(destination, '/site2/attendance/monthly');
  });

  // --------------------------------------------------------------------------
  // J14: Mode A Code-Only Change
  // --------------------------------------------------------------------------
  test('J14: NAME mode site code-only change does NOT alter canonical slug or create history', () => {
    const tempId = createSite('Sivasakthi Project 14', 'S-01', 'Location X', 'usr-admin-1', 'NAME');
    const siteBefore = getSiteById(tempId);
    assert.ok(siteBefore);
    assert.equal(siteBefore.canonical_slug, 'sivasakthi-project-14');

    const historyBeforeCount = (db.prepare('SELECT COUNT(*) as c FROM site_slug_history WHERE site_id = ?').get(tempId) as any).c;

    // Change code only: S-01 -> S-02
    updateSite(tempId, 'Sivasakthi Project 14', 'S-02', 'Location X');

    const siteAfter = getSiteById(tempId);
    assert.ok(siteAfter);
    assert.equal(siteAfter.code, 'S-02');
    assert.equal(siteAfter.canonical_slug, 'sivasakthi-project-14', 'Canonical slug must remain unchanged');

    const historyAfterCount = (db.prepare('SELECT COUNT(*) as c FROM site_slug_history WHERE site_id = ?').get(tempId) as any).c;
    assert.equal(historyAfterCount, historyBeforeCount, 'No slug history should be created');

    // Clean up
    db.prepare('DELETE FROM sites WHERE id = ?').run(tempId);
    db.prepare('DELETE FROM site_slug_history WHERE site_id = ?').run(tempId);
  });

  // --------------------------------------------------------------------------
  // J15: Mode B Name-Only Change
  // --------------------------------------------------------------------------
  test('J15: CODE mode site name-only change does NOT alter canonical slug or create history', () => {
    const tempId = createSite('Initial Name 15', 'S-15A', 'Location Y', 'usr-admin-1', 'CODE');
    const siteBefore = getSiteById(tempId);
    assert.ok(siteBefore);
    assert.equal(siteBefore.canonical_slug, 's15a');

    const historyBeforeCount = (db.prepare('SELECT COUNT(*) as c FROM site_slug_history WHERE site_id = ?').get(tempId) as any).c;

    // Change name only: 'Initial Name 15' -> 'Brand New Long Name 15'
    updateSite(tempId, 'Brand New Long Name 15', 'S-15A', 'Location Y');

    const siteAfter = getSiteById(tempId);
    assert.ok(siteAfter);
    assert.equal(siteAfter.name, 'Brand New Long Name 15');
    assert.equal(siteAfter.canonical_slug, 's15a', 'Canonical slug must remain s15a');

    const historyAfterCount = (db.prepare('SELECT COUNT(*) as c FROM site_slug_history WHERE site_id = ?').get(tempId) as any).c;
    assert.equal(historyAfterCount, historyBeforeCount, 'No slug history should be created');

    // Clean up
    db.prepare('DELETE FROM sites WHERE id = ?').run(tempId);
    db.prepare('DELETE FROM site_slug_history WHERE site_id = ?').run(tempId);
  });

  // --------------------------------------------------------------------------
  // J16: Mode B Code Change
  // --------------------------------------------------------------------------
  test('J16: CODE mode code change updates canonical slug and preserves old slug via 307 alias', () => {
    const tempId = createSite('Tower Project 16', 'S-16A', 'Location Z', 'usr-admin-1', 'CODE');
    const siteBefore = getSiteById(tempId);
    assert.ok(siteBefore);
    assert.equal(siteBefore.canonical_slug, 's16a');

    // Change code: S-16A -> S-16B
    updateSite(tempId, 'Tower Project 16', 'S-16B', 'Location Z');

    const siteAfter = getSiteById(tempId);
    assert.ok(siteAfter);
    assert.equal(siteAfter.canonical_slug, 's16b', 'Canonical slug must update to s16b');

    // Verify old slug resolution
    const allSites = getAllSites(false);
    const oldResolution = resolveSiteBySlug('s16a', allSites, getSiteByHistoricalSlug);
    assert.ok(oldResolution.site);
    assert.equal(oldResolution.site.id, tempId);
    assert.equal(oldResolution.isCanonical, false, 's16a must be flagged non-canonical');
    assert.equal(oldResolution.canonicalSlug, 's16b', 's16a must point to s16b');

    // Clean up
    db.prepare('DELETE FROM sites WHERE id = ?').run(tempId);
    db.prepare('DELETE FROM site_slug_history WHERE site_id = ?').run(tempId);
  });

  // --------------------------------------------------------------------------
  // J17: RSC Serialization Safety Regression Test (Digest 1133208979 Fix)
  // --------------------------------------------------------------------------
  test('J17: RSC serialization strips null prototypes and preserves all routing fields with Object.prototype', async () => {
    const { serializeSiteForClient, serializeUserForClient } = await import('../lib/site/serialization');
    const rawSites = getAllSites(false);
    assert.ok(rawSites.length >= 2);

    // Verify raw SQLite row objects have null prototype (the root cause of digest 1133208979)
    assert.equal(Object.getPrototypeOf(rawSites[0]), null, 'Raw SQLite row must have null prototype');

    // Run serialization
    const serializedSites = rawSites.map(serializeSiteForClient);
    const rawSession = {
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      fullName: 'System Administrator',
      role: 'ADMIN' as const,
      authorityTier: 'KING_MAKER' as any,
      assignedSiteIds: ['site-1', 'site-2'],
      tokenVersion: 1,
    };
    const serializedUser = serializeUserForClient(rawSession);

    // Assert user serialization
    assert.equal(Object.getPrototypeOf(serializedUser), Object.prototype, 'User must have standard Object.prototype');
    assert.equal(serializedUser.id, 'usr-admin-1');
    assert.equal(serializedUser.username, 'Iamadmin');
    assert.equal(Array.isArray(serializedUser.assignedSiteIds), true);
    assert.deepEqual(serializedUser.assignedSiteIds, ['site-1', 'site-2']);

    // Assert site serialization
    for (const site of serializedSites) {
      assert.equal(Object.getPrototypeOf(site), Object.prototype, 'Serialized site must have standard Object.prototype');
      assert.equal(typeof site.id, 'string');
      assert.equal(typeof site.name, 'string');
      assert.equal(typeof site.is_archived, 'number');
      assert.ok(site.routing_mode === 'NAME' || site.routing_mode === 'CODE');
      assert.equal(typeof site.canonical_slug, 'string');
      assert.ok(site.canonical_slug.length > 0);

      // Verify no functions, undefined, or circular references
      for (const [key, val] of Object.entries(site)) {
        assert.notEqual(val, undefined, `Property ${key} must not be undefined`);
        assert.notEqual(typeof val, 'function', `Property ${key} must not be a function`);
      }
    }

    // Verify exact routing fields for canonical sites
    const site1 = serializedSites.find((s) => s.id === 'site-1');
    assert.ok(site1, 'Site 1 must exist');
    assert.equal(site1.routing_mode, 'NAME');
    assert.equal(site1.canonical_slug, 'site1');

    const site2 = serializedSites.find((s) => s.id === 'site-2');
    assert.ok(site2, 'Site 2 must exist');
    assert.equal(site2.routing_mode, 'NAME');
    assert.equal(site2.canonical_slug, 'site2');

    const villaSite = serializedSites.find((s) => s.id.includes('9f089532') || s.name.includes('Villa'));
    if (villaSite) {
      assert.equal(villaSite.routing_mode, 'NAME');
      assert.ok(villaSite.canonical_slug!.startsWith('villa-project-phase-1-updated'));
    }

    // Flight RSC JSON serializability assertion
    const payload = JSON.stringify({ initialUser: serializedUser, initialSites: serializedSites });
    const parsed = JSON.parse(payload);
    assert.equal(parsed.initialSites.length, serializedSites.length);
    assert.equal(Object.getPrototypeOf(parsed.initialSites[0]), Object.prototype);
  });

  console.log('\n====================================================');
  console.log(`ALL TESTS PASSED: ${passed}/${total}`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
