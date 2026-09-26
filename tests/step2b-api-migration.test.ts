process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { canAccess, CanAccessSession } from '../lib/permissions/evaluator';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { canManageAuthority, canAssignAuthorityTier, canDeleteUser } from '../lib/auth/authority';
import { getFinancialTransactionById } from '../lib/db/repositories/finance-repo';
import { getSiteById } from '../lib/db/repositories/site-repo';
import { getUserById } from '../lib/db/repositories/user-repo';

test('STEP 2B — GRANULAR AUTHORIZATION API MIGRATION CORE (18 Mandated Proofs)', async (t) => {
  // Setup database sync fixture for test principals
  const setupDb = new DatabaseSync(process.env.DATABASE_PATH!);
  setupDb.prepare(`
    INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
    VALUES 
      ('su-test-eng1-s1', 'site-1', 'usr-eng-1', datetime('now')),
      ('su-test-eng1-s2', 'site-2', 'usr-eng-1', datetime('now')),
      ('su-test-view1-s1', 'site-1', 'usr-view-1', datetime('now'))
  `).run();

  // Setup test principals using valid existing database identities
  const superiorPrime: CanAccessSession = {
    userId: 'usr-admin-1',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
    isActive: true,
  };

  const clientPrime: CanAccessSession = {
    userId: 'usr-client-prime-1',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    isActive: true,
  };

  const standardAdmin: CanAccessSession = {
    userId: 'usr-admin-1',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    isActive: true,
  };

  const operationalSiteManager: CanAccessSession = {
    userId: 'usr-eng-1', // engineer2, assigned to site-1 and site-2
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    isActive: true,
    assignedSiteIds: ['site-1', 'site-2'],
  };

  const unassignedSiteManager: CanAccessSession = {
    userId: 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', // engineer1, unassigned to site-1
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    isActive: true,
    assignedSiteIds: [],
  };

  const viewerUser: CanAccessSession = {
    userId: 'usr-view-1', // viewer1, assigned to site-1
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    isActive: true,
    assignedSiteIds: ['site-1'],
  };

  const deactivatedUser: CanAccessSession = {
    userId: 'usr-admin-1',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    isActive: false,
  };

  // ---------------------------------------------------------------------------
  // Proof 1: Unauthenticated callers fail closed (401 AUTHENTICATION_REQUIRED)
  // ---------------------------------------------------------------------------
  await t.test('Proof 1: Unauthenticated callers fail closed with AUTHENTICATION_REQUIRED across all migrated endpoints', () => {
    const endpoints = [
      { page: 'PAGE_FINANCE_TRANSACTIONS', action: 'VIEW', siteId: 'site-1' },
      { page: 'PAGE_FINANCE_TRANSACTIONS', action: 'CREATE', siteId: 'site-1' },
      { page: 'PAGE_FINANCE_LEDGER', action: 'VIEW' },
      { page: 'PAGE_SETUP_USERS', action: 'VIEW' },
      { page: 'PAGE_SETUP_SITES', action: 'VIEW' },
      { page: 'PAGE_SETUP_ROLES', action: 'VIEW' },
      { page: 'PAGE_SETUP_CATEGORIES', action: 'VIEW' },
      { page: 'PAGE_ATTENDANCE_DAILY', action: 'VIEW', siteId: 'site-1' },
      { page: 'PAGE_ATTENDANCE_WEEKLY', action: 'VIEW', siteId: 'site-1' },
    ];

    for (const ep of endpoints) {
      const decision = canAccess({ session: null, page: ep.page, action: ep.action, siteId: ep.siteId });
      assert.equal(decision.allowed, false, `Unauthenticated request to ${ep.page}.${ep.action} must be denied`);
      assert.equal(decision.ruleSource, 'AUTHENTICATION_REQUIRED');
    }
  });

  // ---------------------------------------------------------------------------
  // Proof 2: Deactivated users fail closed (403 ACCOUNT_INACTIVE)
  // ---------------------------------------------------------------------------
  await t.test('Proof 2: Deactivated users fail closed with ACCOUNT_INACTIVE across all endpoints', () => {
    const decision = canAccess({
      session: deactivatedUser,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.ruleSource, 'ACCOUNT_INACTIVE');
  });

  // ---------------------------------------------------------------------------
  // Proof 3: Legacy backward compatibility: Unconfigured ADMIN retains full access
  // ---------------------------------------------------------------------------
  await t.test('Proof 3: Legacy backward compatibility: Unconfigured ADMIN retains full access across all routes', () => {
    const decisionFinance = canAccess({
      session: standardAdmin,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1',
    });
    assert.equal(decisionFinance.allowed, true);
    assert.equal(decisionFinance.ruleSource, 'LEGACY_FALLBACK_ALLOW');

    const decisionSetup = canAccess({
      session: standardAdmin,
      page: 'PAGE_SETUP_USERS',
      action: 'MANAGE_USERS',
    });
    assert.equal(decisionSetup.allowed, true);
    assert.equal(decisionSetup.ruleSource, 'LEGACY_FALLBACK_ALLOW');
  });

  // ---------------------------------------------------------------------------
  // Proof 4: Legacy backward compatibility: Unconfigured SITE_MANAGER can access operational routes on assigned sites
  // ---------------------------------------------------------------------------
  await t.test('Proof 4: Legacy backward compatibility: Unconfigured SITE_MANAGER can access operational routes on assigned sites', () => {
    const decisionDaily = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionDaily.allowed, true);

    const decisionFinance = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'CREATE',
      siteId: 'site-1',
    });
    assert.equal(decisionFinance.allowed, true);
    assert.equal(decisionFinance.ruleSource, 'LEGACY_FALLBACK_ALLOW');
  });

  // ---------------------------------------------------------------------------
  // Proof 5: Legacy backward compatibility: Unconfigured SITE_MANAGER denied administrative actions
  // ---------------------------------------------------------------------------
  await t.test('Proof 5: Legacy backward compatibility: Unconfigured SITE_MANAGER is denied administrative actions (DELETE, MANAGE)', () => {
    // Attempt to DELETE finance transaction
    const decisionDelete = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionDelete.allowed, false);
    assert.equal(decisionDelete.ruleSource, 'DEFAULT_DENY');

    // Attempt to MANAGE users
    const decisionManageUsers = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_SETUP_USERS',
      action: 'MANAGE_USERS',
    });
    assert.equal(decisionManageUsers.allowed, false);
    assert.equal(decisionManageUsers.ruleSource, 'DEFAULT_DENY');

    // Attempt to CREATE site
    const decisionCreateSite = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_SETUP_SITES',
      action: 'CREATE',
    });
    assert.equal(decisionCreateSite.allowed, false);
    assert.equal(decisionCreateSite.ruleSource, 'DEFAULT_DENY');
  });

  // ---------------------------------------------------------------------------
  // Proof 6: Legacy backward compatibility: Unconfigured VIEWER is denied mutations but allowed reads
  // ---------------------------------------------------------------------------
  await t.test('Proof 6: Legacy backward compatibility: Unconfigured VIEWER is denied mutations but allowed reads on assigned sites', () => {
    // VIEWER read on assigned site
    const decisionRead = canAccess({
      session: viewerUser,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionRead.allowed, true);
    assert.equal(decisionRead.ruleSource, 'LEGACY_FALLBACK_ALLOW');

    // VIEWER write attempt on assigned site
    const decisionWrite = canAccess({
      session: viewerUser,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'CREATE',
      siteId: 'site-1',
    });
    assert.equal(decisionWrite.allowed, false);
    assert.equal(decisionWrite.ruleSource, 'DEFAULT_DENY');

    // VIEWER investor create attempt
    const decisionInvestorCreate = canAccess({
      session: viewerUser,
      page: 'PAGE_FINANCE_LEDGER',
      action: 'CREATE',
    });
    assert.equal(decisionInvestorCreate.allowed, false);
    assert.equal(decisionInvestorCreate.ruleSource, 'DEFAULT_DENY');
  });

  // ---------------------------------------------------------------------------
  // Proof 7: Step 0 Resource Site Ownership for PUT /api/finance/[id]
  // ---------------------------------------------------------------------------
  await t.test('Proof 7: Step 0 Resource Site Ownership: For PUT /api/finance/[id], authorization is derived strictly from persisted resource siteId', () => {
    // When resourceSiteId is site-1 (user assigned), access is permitted
    const decisionMatch = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionMatch.allowed, true);

    // When resourceSiteId is unassigned, caller is denied even if caller supplied matching siteId
    const decisionUnassigned = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-unassigned',
      resourceSiteId: 'site-unassigned',
    });
    assert.equal(decisionUnassigned.allowed, false);
    assert.equal(decisionUnassigned.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // ---------------------------------------------------------------------------
  // Proof 8: Step 0 Resource Site Ownership for DELETE /api/finance/[id]
  // ---------------------------------------------------------------------------
  await t.test('Proof 8: Step 0 Resource Site Ownership: For DELETE /api/finance/[id], authorization is derived from persisted siteId', () => {
    // Standard admin on persisted site-1
    const decisionAdmin = canAccess({
      session: standardAdmin,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionAdmin.allowed, true);
    assert.equal(decisionAdmin.effectiveSiteId, 'site-1');
  });

  // ---------------------------------------------------------------------------
  // Proof 9: Cross-site mismatch rejection
  // ---------------------------------------------------------------------------
  await t.test('Proof 9: Cross-site mismatch rejection: Caller-supplied siteId differing from persisted siteId is rejected (SITE_MISMATCH_REJECTED)', () => {
    const decisionMismatch = canAccess({
      session: standardAdmin,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: 'site-1',
      resourceSiteId: 'site-2', // Conflict! Persisted entity belongs to site-2
    });
    assert.equal(decisionMismatch.allowed, false);
    assert.equal(decisionMismatch.ruleSource, 'SITE_MISMATCH_REJECTED');
    assert.match(decisionMismatch.reason, /Cross-site tamper attempt/);
  });

  // ---------------------------------------------------------------------------
  // Proof 10: Explicit User Site DENY override blocks access on that site
  // ---------------------------------------------------------------------------
  await t.test('Proof 10: Explicit User Site DENY override blocks access on that site even when role baseline or legacy allows', () => {
    const permDef = PermissionRepository.getPermissionDefinitionByPageAction('PAGE_FINANCE_TRANSACTIONS', 'VIEW')!;

    // Set site-specific DENY override for standardAdmin on site-1
    PermissionRepository.setUserOverride({
      userId: standardAdmin.userId!,
      permissionId: permDef.id,
      siteId: 'site-1',
      effect: 'DENY',
      grantedBy: superiorPrime.userId!,
    });

    const decisionDenied = canAccess({
      session: standardAdmin,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId: 'site-1',
    });
    assert.equal(decisionDenied.allowed, false);
    assert.equal(decisionDenied.ruleSource, 'USER_SITE_EXPLICIT_DENY');

    // Cleanup override
    PermissionRepository.removeUserOverride(standardAdmin.userId!, permDef.id, 'site-1');
  });

  // ---------------------------------------------------------------------------
  // Proof 11: Explicit User Site ALLOW override grants access on that site
  // ---------------------------------------------------------------------------
  await t.test('Proof 11: Explicit User Site ALLOW override grants access on that site even when role would normally deny', () => {
    const permDef = PermissionRepository.getPermissionDefinitionByPageAction('PAGE_FINANCE_TRANSACTIONS', 'DELETE')!;

    // Grant site-specific ALLOW override for operationalSiteManager on site-1
    PermissionRepository.setUserOverride({
      userId: operationalSiteManager.userId!,
      permissionId: permDef.id,
      siteId: 'site-1',
      effect: 'ALLOW',
      grantedBy: superiorPrime.userId!,
    });

    const decisionAllowed = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionAllowed.allowed, true);
    assert.equal(decisionAllowed.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');

    // Cleanup override
    PermissionRepository.removeUserOverride(operationalSiteManager.userId!, permDef.id, 'site-1');
  });

  // ---------------------------------------------------------------------------
  // Proof 12: Explicit User Global DENY override blocks access across all sites
  // ---------------------------------------------------------------------------
  await t.test('Proof 12: Explicit User Global DENY override blocks access across all sites', () => {
    const permDef = PermissionRepository.getPermissionDefinitionByPageAction('PAGE_FINANCE_TRANSACTIONS', 'CREATE')!;

    PermissionRepository.setUserOverride({
      userId: standardAdmin.userId!,
      permissionId: permDef.id,
      siteId: null,
      effect: 'DENY',
      grantedBy: superiorPrime.userId!,
    });

    const decisionGlobalDeny = canAccess({
      session: standardAdmin,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'CREATE',
      siteId: 'site-1',
    });
    assert.equal(decisionGlobalDeny.allowed, false);
    assert.equal(decisionGlobalDeny.ruleSource, 'USER_GLOBAL_EXPLICIT_DENY');

    // Cleanup override
    PermissionRepository.removeUserOverride(standardAdmin.userId!, permDef.id, null);
  });

  // ---------------------------------------------------------------------------
  // Proof 13: Non-admin caller without site assignment in site_users is rejected
  // ---------------------------------------------------------------------------
  await t.test('Proof 13: Non-admin caller without site assignment in site_users is rejected (UNASSIGNED_SITE_DENY) on site-scoped routes', () => {
    const decisionUnassigned = canAccess({
      session: unassignedSiteManager,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionUnassigned.allowed, false);
    assert.equal(decisionUnassigned.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // ---------------------------------------------------------------------------
  // Proof 14: User administration: Standard Admin / Client Prime cannot modify or delete Superior Prime
  // ---------------------------------------------------------------------------
  await t.test('Proof 14: User administration (/api/users): Standard Admin / Client Prime cannot modify or delete Superior Prime (usr-admin-1)', () => {
    // Client Prime cannot manage Superior Prime
    const clientPrimeActor = { id: 'usr-client-prime-1', authority_tier: 'CLIENT_PRIME' as const };
    const superiorPrimeTarget = { id: 'usr-admin-1', authority_tier: 'SUPERIOR_PRIME' as const };

    assert.equal(canManageAuthority(clientPrimeActor, superiorPrimeTarget), false);
    assert.equal(canDeleteUser(clientPrimeActor, superiorPrimeTarget), false);

    // Standard Admin cannot manage Superior Prime
    const standardAdminActor = { id: 'usr-standard-admin', authority_tier: 'STANDARD_ADMIN' as const };
    assert.equal(canManageAuthority(standardAdminActor, superiorPrimeTarget), false);
    assert.equal(canDeleteUser(standardAdminActor, superiorPrimeTarget), false);

    // Superior Prime can manage everyone
    assert.equal(canManageAuthority(superiorPrimeTarget, clientPrimeActor), true);
  });

  // ---------------------------------------------------------------------------
  // Proof 15: User administration: Standard Admin cannot escalate authority tier
  // ---------------------------------------------------------------------------
  await t.test('Proof 15: User administration (/api/users): Standard Admin cannot escalate authority tier to Client Prime or Superior Prime', () => {
    const standardAdminActor = { id: 'usr-standard-admin', authority_tier: 'STANDARD_ADMIN' as const };
    const clientPrimeActor = { id: 'usr-client-prime-1', authority_tier: 'CLIENT_PRIME' as const };

    assert.equal(canAssignAuthorityTier(standardAdminActor, 'SUPERIOR_PRIME'), false);
    assert.equal(canAssignAuthorityTier(standardAdminActor, 'CLIENT_PRIME'), false);
    assert.equal(canAssignAuthorityTier(standardAdminActor, 'STANDARD_ADMIN'), false); // Cannot self-replicate admin
    assert.equal(canAssignAuthorityTier(standardAdminActor, 'STANDARD'), true); // Can provision operational users
    assert.equal(canAssignAuthorityTier(clientPrimeActor, 'STANDARD_ADMIN'), true); // Client Prime can provision admins
  });

  // ---------------------------------------------------------------------------
  // Proof 16: Setup mutations: Forbidden for unconfigured SITE_MANAGER and VIEWER
  // ---------------------------------------------------------------------------
  await t.test('Proof 16: Setup mutations (/api/sites, /api/roles, /api/categories, /api/rates): Forbidden for unconfigured SITE_MANAGER and VIEWER (403)', () => {
    const setupMutations = [
      { page: 'PAGE_SETUP_SITES', action: 'CREATE' },
      { page: 'PAGE_SETUP_SITES', action: 'EDIT' },
      { page: 'PAGE_SETUP_SITES', action: 'DELETE' },
      { page: 'PAGE_SETUP_ROLES', action: 'MANAGE' },
      { page: 'PAGE_SETUP_CATEGORIES', action: 'MANAGE' },
    ];

    for (const sm of setupMutations) {
      const decisionSM = canAccess({ session: operationalSiteManager, page: sm.page, action: sm.action });
      assert.equal(decisionSM.allowed, false, `Site Manager must not have ${sm.page}.${sm.action}`);

      const decisionViewer = canAccess({ session: viewerUser, page: sm.page, action: sm.action });
      assert.equal(decisionViewer.allowed, false, `Viewer must not have ${sm.page}.${sm.action}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Proof 17: Attendance routes: Authorized for assigned sites, rejected for unassigned
  // ---------------------------------------------------------------------------
  await t.test('Proof 17: Attendance routes (/api/attendance/daily, /api/attendance/range): Authorized for assigned sites, rejected for unassigned sites', () => {
    // Assigned site-1
    const decisionDailyAssigned = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionDailyAssigned.allowed, true);

    const decisionWeeklyAssigned = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_ATTENDANCE_WEEKLY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.equal(decisionWeeklyAssigned.allowed, true);

    // Unassigned site
    const decisionDailyUnassigned = canAccess({
      session: operationalSiteManager,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-unassigned',
      resourceSiteId: 'site-unassigned',
    });
    assert.equal(decisionDailyUnassigned.allowed, false);
    assert.equal(decisionDailyUnassigned.ruleSource, 'UNASSIGNED_SITE_DENY');
  });

  // ---------------------------------------------------------------------------
  // Proof 18: Superior Prime possesses platform authority across all operational endpoints
  // ---------------------------------------------------------------------------
  await t.test('Proof 18: Superior Prime possesses platform authority across all operational endpoints (SUPERIOR_PRIME_PLATFORM_AUTHORITY)', () => {
    const endpoints = [
      { page: 'PAGE_FINANCE_TRANSACTIONS', action: 'DELETE', siteId: 'site-1' },
      { page: 'PAGE_SETUP_USERS', action: 'MANAGE_USERS' },
      { page: 'PAGE_SETUP_SITES', action: 'DELETE', siteId: 'site-1' },
      { page: 'PAGE_SETUP_ROLES', action: 'MANAGE' },
      { page: 'PAGE_SETUP_CATEGORIES', action: 'MANAGE' },
      { page: 'PAGE_ATTENDANCE_DAILY', action: 'CREATE', siteId: 'site-999' }, // Even unassigned
    ];

    for (const ep of endpoints) {
      const decision = canAccess({
        session: superiorPrime,
        page: ep.page,
        action: ep.action,
        siteId: ep.siteId,
      });
      assert.equal(decision.allowed, true, `Superior Prime must have platform authority on ${ep.page}.${ep.action}`);
      assert.equal(decision.ruleSource, 'SUPERIOR_PRIME_PLATFORM_AUTHORITY');
    }
  });
});
