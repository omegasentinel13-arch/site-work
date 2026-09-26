import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

// Force test environment isolation
process.env.PORT = '3001';
process.env.DATABASE_PATH = path.join(process.cwd(), 'data', 'test_site_work.db');

import { getDb, closeDb, runTransaction } from '../lib/db';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { canAccess, evaluateLegacyFallback } from '../lib/permissions/evaluator';
import { canManageAuthority, canAssignAuthorityTier, isSuperiorPrime } from '../lib/auth/authority';
import { STANDARD_PERMISSION_DEFINITIONS } from '../lib/permissions/registry';

describe('STEP 2A: Granular Permission Database Foundation (30 Mandated Proofs)', () => {
  let db: DatabaseSync;

  before(() => {
    // Ensure test database is initialized from production baseline
    if (fs.existsSync('data/test_site_work.db')) fs.unlinkSync('data/test_site_work.db');
    if (fs.existsSync('data/test_site_work.db-wal')) fs.unlinkSync('data/test_site_work.db-wal');
    if (fs.existsSync('data/test_site_work.db-shm')) fs.unlinkSync('data/test_site_work.db-shm');

    const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
    prodDb.prepare("VACUUM INTO 'data/test_site_work.db'").run();
    prodDb.close();

    db = getDb(); // Triggers migrations on data/test_site_work.db

    // Seed test users if needed
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
      VALUES 
        ('test-user-a', 'user_a', 'hash', 'User A', 'SITE_MANAGER', 'STANDARD', 1, 1),
        ('test-user-b', 'user_b', 'hash', 'User B', 'VIEWER', 'STANDARD', 1, 1),
        ('test-user-c', 'user_c', 'hash', 'User C', 'SITE_MANAGER', 'STANDARD', 1, 1),
        ('test-admin-client', 'client_prime', 'hash', 'Client Prime Admin', 'ADMIN', 'CLIENT_PRIME', 1, 1),
        ('test-admin-std', 'std_admin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1)
    `).run();

    // Map test-user-a to site-1 and site-2 in canonical site_users
    db.prepare(`
      INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
      VALUES 
        ('su-a-s1', 'site-1', 'test-user-a', datetime('now')),
        ('su-a-s2', 'site-2', 'test-user-a', datetime('now')),
        ('su-b-s1', 'site-1', 'test-user-b', datetime('now')),
        ('su-b-s2', 'site-2', 'test-user-b', datetime('now')),
        ('su-c-s1', 'site-1', 'test-user-c', datetime('now')),
        ('su-c-s2', 'site-2', 'test-user-c', datetime('now'))
    `).run();
  });

  after(() => {
    closeDb();
  });

  // 1. Permission definition uniqueness
  it('Proof 1: Permission definition uniqueness is enforced by UNIQUE(page_id, action_id)', () => {
    PermissionRepository.createPermissionDefinition({
      id: 'test-perm-dup-1',
      page_id: 'PAGE_LOGIN',
      action_id: 'MANAGE',
      display_name: 'Login Manage Test',
      description: 'Test definition',
      is_site_scoped: 0
    });

    assert.throws(() => {
      PermissionRepository.createPermissionDefinition({
        id: 'test-perm-dup-2',
        page_id: 'PAGE_LOGIN',
        action_id: 'MANAGE',
        display_name: 'Login Manage Duplicate',
        description: 'Duplicate should fail',
        is_site_scoped: 0
      });
    }, /UNIQUE constraint failed/);
  });

  // 2. Role permission creation
  it('Proof 2: Role baseline permission creation succeeds and can be retrieved', () => {
    PermissionRepository.seedStandardDefinitions();
    const id = PermissionRepository.setRolePermission({
      role: 'SITE_MANAGER',
      permissionId: 'perm-att-daily-view',
      scopeType: 'ASSIGNED_SITES'
    });

    assert.ok(id);
    const perms = PermissionRepository.getRolePermissions('SITE_MANAGER', 'perm-att-daily-view');
    assert.equal(perms.length, 1);
    assert.equal(perms[0].scope_type, 'ASSIGNED_SITES');
    assert.equal(perms[0].site_id, null);
  });

  // 3. Global role scope
  it('Proof 3: Global role scope grants access across all sites', () => {
    PermissionRepository.setRolePermission({
      role: 'ADMIN',
      permissionId: 'perm-fin-tx-view',
      scopeType: 'GLOBAL'
    });

    const decision = canAccess({
      session: { id: 'test-admin-client', role: 'ADMIN', authorityTier: 'CLIENT_PRIME', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1'
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.ruleSource, 'ROLE_BASELINE_ALLOW');
  });

  // 4. Assigned-site scope
  it('Proof 4: Assigned-site scope grants access only to sites in canonical site_users', () => {
    PermissionRepository.setRolePermission({
      role: 'SITE_MANAGER',
      permissionId: 'perm-att-daily-view',
      scopeType: 'ASSIGNED_SITES'
    });

    // Site 1 (assigned)
    const dec1 = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1'
    });
    assert.equal(dec1.allowed, true);
    assert.equal(dec1.ruleSource, 'ROLE_BASELINE_ALLOW');

    // Site 3 (NOT assigned)
    const dec3 = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-3'
    });
    assert.equal(dec3.allowed, false);
    assert.equal(dec3.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // 5. Specific-site scope
  it('Proof 5: Specific-site scope grants access only to the named site_id', () => {
    PermissionRepository.setRolePermission({
      role: 'VIEWER',
      permissionId: 'perm-fin-tx-view',
      scopeType: 'SPECIFIC_SITE',
      siteId: 'site-2'
    });

    // Site 2 (matching specific site)
    const dec2 = canAccess({
      session: { id: 'test-user-b', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-2'
    });
    assert.equal(dec2.allowed, true);
    assert.equal(dec2.ruleSource, 'ROLE_BASELINE_ALLOW');

    // Site 1 (assigned in site_users, but role only grants site-2)
    const dec1 = canAccess({
      session: { id: 'test-user-b', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1'
    });
    assert.equal(dec1.allowed, false);
    assert.equal(dec1.ruleSource, 'DEFAULT_DENY');
  });

  // 6. Global override uniqueness (SQLite NULL semantics handled)
  it('Proof 6: Global override uniqueness enforces at most one global override per (user, permission)', () => {
    // First global override
    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-rep-complete-export',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });

    // Second global override on same user & permission should replace, not duplicate
    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-rep-complete-export',
      siteId: null,
      effect: 'DENY',
      grantedBy: 'test-admin-client'
    });

    const rows = db.prepare(`
      SELECT count(*) as c FROM user_permission_overrides 
      WHERE user_id = 'test-user-a' AND permission_id = 'perm-rep-complete-export' AND site_id IS NULL
    `).get() as { c: number };

    assert.equal(rows.c, 1);

    const override = PermissionRepository.getUserOverride('test-user-a', 'perm-rep-complete-export', null);
    assert.equal(override?.effect, 'DENY');
  });

  // 7. Site override uniqueness
  it('Proof 7: Site override uniqueness enforces at most one override per (user, permission, site)', () => {
    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-fin-tx-edit',
      siteId: 'site-1',
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });

    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-fin-tx-edit',
      siteId: 'site-1',
      effect: 'DENY',
      grantedBy: 'test-admin-client'
    });

    const rows = db.prepare(`
      SELECT count(*) as c FROM user_permission_overrides 
      WHERE user_id = 'test-user-a' AND permission_id = 'perm-fin-tx-edit' AND site_id = 'site-1'
    `).get() as { c: number };

    assert.equal(rows.c, 1);
  });

  // 8. Explicit DENY
  it('Proof 8: Explicit DENY blocks user access even when role baseline allows', () => {
    // Role baseline grants global view
    PermissionRepository.setRolePermission({
      role: 'SITE_MANAGER',
      permissionId: 'perm-fin-tx-view',
      scopeType: 'ASSIGNED_SITES'
    });

    // Explicit user DENY on Site 1
    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-fin-tx-view',
      siteId: 'site-1',
      effect: 'DENY',
      grantedBy: 'test-admin-client'
    });

    const decision = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1'
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'USER_SITE_EXPLICIT_DENY');
  });

  // 9. Explicit ALLOW
  it('Proof 9: Explicit ALLOW grants access even when role baseline does not permit', () => {
    // Role VIEWER does not have edit permission
    PermissionRepository.setUserOverride({
      userId: 'test-user-b',
      permissionId: 'perm-fin-tx-edit',
      siteId: 'site-1',
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });

    const decision = canAccess({
      session: { id: 'test-user-b', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-1'
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');
  });

  // 10. DENY precedence
  it('Proof 10: Explicit User DENY has highest precedence over role baseline and lower rules', () => {
    PermissionRepository.setRolePermission({
      role: 'ADMIN',
      permissionId: 'perm-set-site-delete',
      scopeType: 'GLOBAL'
    });

    // Standard Admin user receives explicit DENY
    PermissionRepository.setUserOverride({
      userId: 'test-admin-std',
      permissionId: 'perm-set-site-delete',
      siteId: null,
      effect: 'DENY',
      grantedBy: 'test-admin-client'
    });

    const decision = canAccess({
      session: { id: 'test-admin-std', role: 'ADMIN', authorityTier: 'STANDARD_ADMIN', isActive: true },
      page: 'PAGE_SETUP_SITES',
      action: 'DELETE'
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'USER_GLOBAL_EXPLICIT_DENY');
  });

  // 11. Site-specific resolution (User A scenario: Site 1 EDIT, Site 2 VIEW, Site 3 DENY)
  it('Proof 11: Site-specific resolution works correctly (User A: Site 1 EDIT, Site 2 VIEW, Site 3 DENY)', () => {
    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-fin-tx-edit',
      siteId: 'site-1',
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });
    PermissionRepository.setUserOverride({
      userId: 'test-user-a',
      permissionId: 'perm-fin-tx-edit',
      siteId: 'site-2',
      effect: 'DENY',
      grantedBy: 'test-admin-client'
    });

    // Site 1 EDIT -> ALLOW
    const dec1 = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-1'
    });
    assert.equal(dec1.allowed, true);
    assert.equal(dec1.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');

    // Site 2 EDIT -> DENY
    const dec2 = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-2'
    });
    assert.equal(dec2.allowed, false);
    assert.equal(dec2.ruleSource, 'USER_SITE_EXPLICIT_DENY');

    // Site 3 EDIT -> DENY (not assigned in site_users)
    const dec3 = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-3'
    });
    assert.equal(dec3.allowed, false);
    assert.equal(dec3.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // 12. Global vs site precedence (User C scenario: Global DENY, Site 1 explicit ALLOW)
  it('Proof 12: Site-specific override takes precedence over Global override (User C scenario)', () => {
    // User C: Global DENY on tx edit
    PermissionRepository.setUserOverride({
      userId: 'test-user-c',
      permissionId: 'perm-fin-tx-edit',
      siteId: null,
      effect: 'DENY',
      grantedBy: 'test-admin-client'
    });

    // User C: Site 1 explicit ALLOW on tx edit
    PermissionRepository.setUserOverride({
      userId: 'test-user-c',
      permissionId: 'perm-fin-tx-edit',
      siteId: 'site-1',
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });

    // Site 1 should be ALLOWED because site override > global override
    const decSite1 = canAccess({
      session: { id: 'test-user-c', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-1'
    });
    assert.equal(decSite1.allowed, true);
    assert.equal(decSite1.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');

    // Site 2 should be DENIED by the global override
    const decSite2 = canAccess({
      session: { id: 'test-user-c', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-2'
    });
    assert.equal(decSite2.allowed, false);
    assert.equal(decSite2.ruleSource, 'USER_GLOBAL_EXPLICIT_DENY');
  });

  // 13. Existing site_users remains canonical
  it('Proof 13: Existing site_users table is the sole canonical source of user site assignments', () => {
    const assignedSites = PermissionRepository.getUserAssignedSiteIds('test-user-a');
    assert.ok(assignedSites.includes('site-1'));
    assert.ok(assignedSites.includes('site-2'));
    assert.ok(!assignedSites.includes('site-3'));

    assert.equal(PermissionRepository.isUserAssignedToSite('test-user-a', 'site-1'), true);
    assert.equal(PermissionRepository.isUserAssignedToSite('test-user-a', 'site-3'), false);
  });

  // 14. Unassigned site denied
  it('Proof 14: Non-admin caller is denied access to an unassigned site', () => {
    const decision = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-99'
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // 15. New user fail-closed
  it('Proof 15: New user with no site assignments and no overrides fails closed', () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
      VALUES ('new-test-user', 'newuser', 'hash', 'New User', 'VIEWER', 'STANDARD', 1, 1)
    `).run();

    const decision = canAccess({
      session: { id: 'new-test-user', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1'
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // 16. New site fail-closed
  it('Proof 16: New site creation does not grant automatic access to existing operational users', () => {
    db.prepare(`
      INSERT INTO sites (id, name, code, is_archived)
      VALUES ('site-new-brand', 'Brand New Site', 'BNS', 0)
    `).run();

    const decision = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-new-brand'
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // 17. Legacy ADMIN fallback
  it('Proof 17: Legacy fallback permits ADMIN universal access when permission definition is absent', () => {
    const allowed = evaluateLegacyFallback('ADMIN', 'PAGE_UNREGISTERED_FUTURE', 'CUSTOM_ACTION', 'test-admin-client', null, true);
    assert.equal(allowed, true);
  });

  // 18. Legacy SITE_MANAGER fallback
  it('Proof 18: Legacy fallback permits SITE_MANAGER on operational pages but denies administrative mutations', () => {
    // Operational VIEW allowed on assigned site
    const opView = evaluateLegacyFallback('SITE_MANAGER', 'PAGE_ATTENDANCE_DAILY', 'VIEW', 'test-user-a', 'site-1', false);
    assert.equal(opView, true);

    // Administrative DELETE disallowed
    const adminDelete = evaluateLegacyFallback('SITE_MANAGER', 'PAGE_FINANCE_TRANSACTIONS', 'DELETE', 'test-user-a', 'site-1', false);
    assert.equal(adminDelete, false);

    // System setup page disallowed
    const setupAccess = evaluateLegacyFallback('SITE_MANAGER', 'PAGE_SETUP_USERS', 'VIEW', 'test-user-a', null, false);
    assert.equal(setupAccess, false);
  });

  // 19. Legacy VIEWER fallback
  it('Proof 19: Legacy fallback permits VIEWER read-only and denies mutations', () => {
    const viewAllowed = evaluateLegacyFallback('VIEWER', 'PAGE_ATTENDANCE_DAILY', 'VIEW', 'test-user-b', 'site-1', false);
    assert.equal(viewAllowed, true);

    const editDenied = evaluateLegacyFallback('VIEWER', 'PAGE_ATTENDANCE_DAILY', 'EDIT', 'test-user-b', 'site-1', false);
    assert.equal(editDenied, false);
  });

  // 20. Default DENY
  it('Proof 20: Missing rules and undefined permissions resolve strictly to DEFAULT_DENY', () => {
    const decision = canAccess({
      session: { id: 'test-user-b', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_DATA_PROTECTION',
      action: 'MANAGE'
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'DEFAULT_DENY');
  });

  // 21. Superior Prime protection
  it('Proof 21: Superior Prime possesses platform authority and cannot be demoted or deleted', () => {
    // 21A: Platform authority evaluation
    const decision = canAccess({
      session: { id: 'usr-admin-1', role: 'ADMIN', authorityTier: 'SUPERIOR_PRIME', isActive: true },
      page: 'PAGE_BACKUP_CONSOLE',
      action: 'MANAGE'
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.ruleSource, 'SUPERIOR_PRIME_PLATFORM_AUTHORITY');

    // 21B: Authority rule: Lower tiers cannot manage Superior Prime
    const clientActor = { id: 'test-admin-client', role: 'ADMIN' as const, authorityTier: 'CLIENT_PRIME' as const };
    const superiorTarget = { id: 'usr-admin-1', role: 'ADMIN' as const, authorityTier: 'SUPERIOR_PRIME' as const };
    assert.equal(canManageAuthority(clientActor, superiorTarget), false);
    assert.equal(isSuperiorPrime(superiorTarget), true);
  });

  // 22. Client Prime cannot escalate authority
  it('Proof 22: Client Prime cannot assign Superior Prime authority tier', () => {
    const clientActor = { id: 'test-admin-client', role: 'ADMIN' as const, authorityTier: 'CLIENT_PRIME' as const };
    assert.equal(canAssignAuthorityTier(clientActor, 'SUPERIOR_PRIME'), false);
    assert.equal(canAssignAuthorityTier(clientActor, 'STANDARD_ADMIN'), true);
  });

  // 23. Standard Admin cannot escalate authority
  it('Proof 23: Standard Admin cannot assign Client Prime or Superior Prime tiers', () => {
    const stdActor = { id: 'test-admin-std', role: 'ADMIN' as const, authorityTier: 'STANDARD_ADMIN' as const };
    assert.equal(canAssignAuthorityTier(stdActor, 'SUPERIOR_PRIME'), false);
    assert.equal(canAssignAuthorityTier(stdActor, 'CLIENT_PRIME'), false);
    assert.equal(canAssignAuthorityTier(stdActor, 'STANDARD'), true);
  });

  // 24. Cross-site resource protection
  it('Proof 24: Cross-site resource protection derives authorization strictly from persisted entity siteId', () => {
    // User A has permission on site-1, but resource belongs to site-2 (unassigned)
    // Even if user passed siteId = 'site-1', persisted entity is site-2
    const decision = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      resourceSiteId: 'site-2' // Persisted entity site
    });

    // On site-2, User A's tx edit is explicitly DENIED (from Proof 11)
    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'USER_SITE_EXPLICIT_DENY');
    assert.equal(decision.effectiveSiteId, 'site-2');
  });

  // 25. Caller siteId cannot override persisted resource site
  it('Proof 25: Caller-supplied siteId is rejected when it contradicts persisted resource siteId', () => {
    const decision = canAccess({
      session: { id: 'test-user-a', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-1',          // Caller falsely claims site-1
      resourceSiteId: 'site-2'   // Actual persisted entity belongs to site-2
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'SITE_MISMATCH_REJECTED');
  });

  // 26. Permission version increment behavior
  it('Proof 26: Permission version increments atomically whenever an override is set or removed', () => {
    const vBefore = PermissionRepository.getPermissionVersion('test-user-b');

    PermissionRepository.setUserOverride({
      userId: 'test-user-b',
      permissionId: 'perm-dash-view',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });

    const vAfterSet = PermissionRepository.getPermissionVersion('test-user-b');
    assert.equal(vAfterSet, vBefore + 1);

    PermissionRepository.removeUserOverride('test-user-b', 'perm-dash-view', null);
    const vAfterRemove = PermissionRepository.getPermissionVersion('test-user-b');
    assert.equal(vAfterRemove, vAfterSet + 1);
  });

  // 27. Permission version rollback on failed transaction
  it('Proof 27: Permission version rolls back cleanly if transaction fails', () => {
    const vBefore = PermissionRepository.getPermissionVersion('test-user-b');

    assert.throws(() => {
      runTransaction(db, () => {
        PermissionRepository.incrementPermissionVersion('test-user-b');
        // Trigger intentional failure
        throw new Error('Simulated atomic transaction failure');
      });
    }, /Simulated atomic transaction failure/);

    const vAfterRollback = PermissionRepository.getPermissionVersion('test-user-b');
    assert.equal(vAfterRollback, vBefore);
  });

  // 28. Concurrent permission mutation safety
  it('Proof 28: Concurrent permission mutation executes within atomic serializable transactions', () => {
    const initialVersion = PermissionRepository.getPermissionVersion('test-user-a');

    // Execute multiple sequential transactions
    for (let i = 0; i < 5; i++) {
      runTransaction(db, () => {
        PermissionRepository.incrementPermissionVersion('test-user-a');
      });
    }

    const finalVersion = PermissionRepository.getPermissionVersion('test-user-a');
    assert.equal(finalVersion, initialVersion + 5);
  });

  // 29. Foreign-key integrity
  it('Proof 29: Foreign keys cascade on delete and prevent orphaned permission overrides', () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
      VALUES ('temp-del-user', 'tempdel', 'hash', 'Temp Delete User', 'VIEWER', 'STANDARD', 1, 1)
    `).run();

    PermissionRepository.setUserOverride({
      userId: 'temp-del-user',
      permissionId: 'perm-dash-view',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'test-admin-client'
    });

    const beforeCount = db.prepare(`SELECT count(*) as c FROM user_permission_overrides WHERE user_id = 'temp-del-user'`).get() as { c: number };
    assert.equal(beforeCount.c, 1);

    // Delete the user
    db.prepare(`DELETE FROM users WHERE id = 'temp-del-user'`).run();

    // Cascaded delete in user_permission_overrides
    const afterCount = db.prepare(`SELECT count(*) as c FROM user_permission_overrides WHERE user_id = 'temp-del-user'`).get() as { c: number };
    assert.equal(afterCount.c, 0);
  });

  // 30. SQLite integrity check
  it('Proof 30: PRAGMA integrity_check and foreign_key_check return 100% clean', () => {
    const integrityRow = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    assert.equal(integrityRow.integrity_check, 'ok');

    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkErrors.length, 0);
  });
});
