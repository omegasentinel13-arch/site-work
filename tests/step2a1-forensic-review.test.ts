import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

process.env.PORT = '3001';
process.env.DATABASE_PATH = path.join(process.cwd(), 'data', 'test_site_work.db');

import { getDb, closeDb, runTransaction } from '../lib/db';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { canAccess } from '../lib/permissions/evaluator';
import { updateUser } from '../lib/db/repositories/user-repo';
import { setSiteUsers } from '../lib/db/repositories/site-repo';
import { REGISTERED_PAGES, STANDARD_PERMISSION_DEFINITIONS } from '../lib/permissions/registry';

describe('STEP 2A.1: Granular Permission Foundation Forensic Review Tests', () => {
  let db: DatabaseSync;

  before(() => {
    // Reset test database from production baseline
    if (fs.existsSync('data/test_site_work.db')) fs.unlinkSync('data/test_site_work.db');
    if (fs.existsSync('data/test_site_work.db-wal')) fs.unlinkSync('data/test_site_work.db-wal');
    if (fs.existsSync('data/test_site_work.db-shm')) fs.unlinkSync('data/test_site_work.db-shm');

    const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
    prodDb.prepare("VACUUM INTO 'data/test_site_work.db'").run();
    prodDb.close();

    db = getDb(); // Triggers migrations on data/test_site_work.db

    // Seed test users
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
      VALUES 
        ('usr-role-test', 'roletest', 'hash', 'Role Tester', 'SITE_MANAGER', 'STANDARD', 1, 1),
        ('usr-grantor-test', 'grantor', 'hash', 'Grantor Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1),
        ('usr-target-test', 'targetuser', 'hash', 'Target User', 'VIEWER', 'STANDARD', 1, 1)
    `).run();

    // Map usr-role-test to site-1 in site_users
    db.prepare(`
      INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
      VALUES ('su-rt-s1', 'site-1', 'usr-role-test', datetime('now'))
    `).run();

    PermissionRepository.seedStandardDefinitions();
  });

  after(() => {
    closeDb();
  });

  // ==========================================================================
  // 1. ROLE PERMISSION DETERMINISM TESTS
  // ==========================================================================
  describe('Area 1: Role Permission Determinism (SPECIFIC_SITE > ASSIGNED_SITES > GLOBAL)', () => {
    it('1.1: SPECIFIC_SITE beats ASSIGNED_SITES for matching site', () => {
      // Configure both ASSIGNED_SITES and SPECIFIC_SITE for SITE_MANAGER on perm-att-daily-view
      PermissionRepository.setRolePermission({
        role: 'SITE_MANAGER',
        permissionId: 'perm-att-daily-view',
        scopeType: 'ASSIGNED_SITES'
      });
      PermissionRepository.setRolePermission({
        role: 'SITE_MANAGER',
        permissionId: 'perm-att-daily-view',
        scopeType: 'SPECIFIC_SITE',
        siteId: 'site-1'
      });

      const decision = canAccess({
        session: { id: 'usr-role-test', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
        page: 'PAGE_ATTENDANCE_DAILY',
        action: 'VIEW',
        siteId: 'site-1'
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.ruleSource, 'ROLE_BASELINE_ALLOW');
      assert.match(decision.reason, /specific-site role baseline.*site-1/);
    });

    it('1.2: ASSIGNED_SITES beats GLOBAL on assigned site', () => {
      // Configure both GLOBAL and ASSIGNED_SITES for VIEWER on perm-rep-role-view
      PermissionRepository.setRolePermission({
        role: 'VIEWER',
        permissionId: 'perm-rep-role-view',
        scopeType: 'GLOBAL'
      });
      PermissionRepository.setRolePermission({
        role: 'VIEWER',
        permissionId: 'perm-rep-role-view',
        scopeType: 'ASSIGNED_SITES'
      });

      // Map usr-target-test to site-1
      db.prepare(`INSERT OR IGNORE INTO site_users (id, site_id, user_id) VALUES ('su-tt-s1', 'site-1', 'usr-target-test')`).run();

      const decision = canAccess({
        session: { id: 'usr-target-test', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
        page: 'PAGE_REPORTS_ROLE',
        action: 'VIEW',
        siteId: 'site-1'
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.ruleSource, 'ROLE_BASELINE_ALLOW');
      assert.match(decision.reason, /assigned-sites role baseline/);
    });

    it('1.3: Same-site SPECIFIC_SITE beats GLOBAL', () => {
      // Configure GLOBAL and SPECIFIC_SITE for VIEWER on perm-rep-cat-view
      PermissionRepository.setRolePermission({
        role: 'VIEWER',
        permissionId: 'perm-rep-cat-view',
        scopeType: 'GLOBAL'
      });
      PermissionRepository.setRolePermission({
        role: 'VIEWER',
        permissionId: 'perm-rep-cat-view',
        scopeType: 'SPECIFIC_SITE',
        siteId: 'site-1'
      });

      const decision = canAccess({
        session: { id: 'usr-target-test', role: 'VIEWER', authorityTier: 'STANDARD', isActive: true },
        page: 'PAGE_REPORTS_CATEGORY',
        action: 'VIEW',
        siteId: 'site-1'
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.ruleSource, 'ROLE_BASELINE_ALLOW');
      assert.match(decision.reason, /specific-site role baseline.*site-1/);
    });

    it('1.4: Unassigned site cannot inherit ASSIGNED_SITES', () => {
      // SITE_MANAGER has ASSIGNED_SITES for perm-att-daily-create
      PermissionRepository.setRolePermission({
        role: 'SITE_MANAGER',
        permissionId: 'perm-att-daily-create',
        scopeType: 'ASSIGNED_SITES'
      });

      // usr-role-test is NOT assigned to site-3
      const decision = canAccess({
        session: { id: 'usr-role-test', role: 'SITE_MANAGER', authorityTier: 'STANDARD', isActive: true },
        page: 'PAGE_ATTENDANCE_DAILY',
        action: 'CREATE',
        siteId: 'site-3'
      });

      assert.equal(decision.allowed, false);
      assert.equal(decision.ruleSource, 'UNASSIGNED_SITE_DENY');
    });

    it('1.5: GLOBAL still applies when no more-specific rule exists', () => {
      // ADMIN has only GLOBAL on perm-set-cat-view
      PermissionRepository.setRolePermission({
        role: 'ADMIN',
        permissionId: 'perm-set-cat-view',
        scopeType: 'GLOBAL'
      });

      const decision = canAccess({
        session: { id: 'usr-grantor-test', role: 'ADMIN', authorityTier: 'STANDARD_ADMIN', isActive: true },
        page: 'PAGE_SETUP_CATEGORIES',
        action: 'VIEW'
      });

      assert.equal(decision.allowed, true);
      assert.equal(decision.ruleSource, 'ROLE_BASELINE_ALLOW');
      assert.match(decision.reason, /global role baseline/);
    });
  });

  // ==========================================================================
  // 2. CASCADE / LIFECYCLE SAFETY TESTS
  // ==========================================================================
  describe('Area 2: Cascade & Lifecycle Safety Review', () => {
    it('2.1: RESTRICT prevents deleting permission_definitions while referenced by role_permissions', () => {
      // perm-att-daily-view is referenced in role_permissions
      assert.throws(() => {
        db.prepare(`DELETE FROM permission_definitions WHERE id = 'perm-att-daily-view'`).run();
      }, /FOREIGN KEY constraint failed/);

      // Verify definition still exists
      const def = PermissionRepository.getPermissionDefinition('perm-att-daily-view');
      assert.ok(def);
    });

    it('2.2: RESTRICT prevents deleting permission_definitions while referenced by user_permission_overrides', () => {
      PermissionRepository.setUserOverride({
        userId: 'usr-target-test',
        permissionId: 'perm-dash-view',
        siteId: null,
        effect: 'ALLOW',
        grantedBy: 'usr-grantor-test'
      });

      assert.throws(() => {
        db.prepare(`DELETE FROM permission_definitions WHERE id = 'perm-dash-view'`).run();
      }, /FOREIGN KEY constraint failed/);
    });

    it('2.3: RESTRICT prevents deleting sites while referenced by role_permissions', () => {
      // site-1 is referenced in role_permissions (from test 1.1)
      assert.throws(() => {
        db.prepare(`DELETE FROM sites WHERE id = 'site-1'`).run();
      }, /FOREIGN KEY constraint failed/);

      const site = db.prepare('SELECT id FROM sites WHERE id = ?').get('site-1');
      assert.ok(site);
    });

    it('2.4: RESTRICT prevents deleting sites while referenced by user_permission_overrides', () => {
      PermissionRepository.setUserOverride({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-edit',
        siteId: 'site-2',
        effect: 'DENY',
        grantedBy: 'usr-grantor-test'
      });

      assert.throws(() => {
        db.prepare(`DELETE FROM sites WHERE id = 'site-2'`).run();
      }, /FOREIGN KEY constraint failed/);
    });

    it('2.5: ON DELETE SET NULL preserves user_permission_overrides when granting admin is deleted', () => {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
        VALUES ('temp-grantor-admin', 'tempgrantor', 'hash', 'Temp Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1)
      `).run();

      PermissionRepository.setUserOverride({
        userId: 'usr-target-test',
        permissionId: 'perm-acc-edit',
        siteId: null,
        effect: 'ALLOW',
        grantedBy: 'temp-grantor-admin'
      });

      const overrideBefore = PermissionRepository.getUserOverride('usr-target-test', 'perm-acc-edit', null);
      assert.equal(overrideBefore?.granted_by, 'temp-grantor-admin');

      // Delete the granting admin
      db.prepare(`DELETE FROM users WHERE id = 'temp-grantor-admin'`).run();

      // Override must still exist, with granted_by safely set to NULL
      const overrideAfter = PermissionRepository.getUserOverride('usr-target-test', 'perm-acc-edit', null);
      assert.ok(overrideAfter);
      assert.equal(overrideAfter.granted_by, null);
      assert.equal(overrideAfter.effect, 'ALLOW');
    });
  });

  // ==========================================================================
  // 3. PERMISSION_VERSION COMPLETENESS TESTS
  // ==========================================================================
  describe('Area 3: Permission Version Completeness on All Mutation Paths', () => {
    it('3.1: Role permission mutation increments permission_version for all users of that role', () => {
      const vBefore = PermissionRepository.getPermissionVersion('usr-role-test');

      PermissionRepository.setRolePermission({
        role: 'SITE_MANAGER',
        permissionId: 'perm-fin-tx-create',
        scopeType: 'ASSIGNED_SITES'
      });

      const vAfter = PermissionRepository.getPermissionVersion('usr-role-test');
      assert.equal(vAfter, vBefore + 1);
    });

    it('3.2: Role permission removal increments permission_version for all users of that role', () => {
      const vBefore = PermissionRepository.getPermissionVersion('usr-role-test');

      PermissionRepository.removeRolePermission({
        role: 'SITE_MANAGER',
        permissionId: 'perm-fin-tx-create',
        scopeType: 'ASSIGNED_SITES'
      });

      const vAfter = PermissionRepository.getPermissionVersion('usr-role-test');
      assert.equal(vAfter, vBefore + 1);
    });

    it('3.3: assignUserToSite increments permission_version atomically', () => {
      const vBefore = PermissionRepository.getPermissionVersion('usr-role-test');

      PermissionRepository.assignUserToSite('usr-role-test', 'site-2');

      const vAfter = PermissionRepository.getPermissionVersion('usr-role-test');
      assert.equal(vAfter, vBefore + 1);
      assert.equal(PermissionRepository.isUserAssignedToSite('usr-role-test', 'site-2'), true);
    });

    it('3.4: removeUserFromSite increments permission_version atomically', () => {
      const vBefore = PermissionRepository.getPermissionVersion('usr-role-test');

      PermissionRepository.removeUserFromSite('usr-role-test', 'site-2');

      const vAfter = PermissionRepository.getPermissionVersion('usr-role-test');
      assert.equal(vAfter, vBefore + 1);
      assert.equal(PermissionRepository.isUserAssignedToSite('usr-role-test', 'site-2'), false);
    });

    it('3.5: updateUser increments permission_version atomically when role/tier/sites change', () => {
      const vBefore = PermissionRepository.getPermissionVersion('usr-target-test');

      updateUser({
        id: 'usr-target-test',
        fullName: 'Target User Updated',
        role: 'SITE_MANAGER',
        isActive: true,
        siteIds: ['site-1', 'site-2']
      }, null);

      const vAfter = PermissionRepository.getPermissionVersion('usr-target-test');
      assert.equal(vAfter, vBefore + 1);
    });

    it('3.6: setSiteUsers increments permission_version atomically for all affected users', () => {
      const vBeforeTarget = PermissionRepository.getPermissionVersion('usr-target-test');
      const vBeforeRole = PermissionRepository.getPermissionVersion('usr-role-test');

      // Update site-1 to assign usr-target-test and unassign usr-role-test
      setSiteUsers('site-1', ['usr-target-test']);

      const vAfterTarget = PermissionRepository.getPermissionVersion('usr-target-test');
      const vAfterRole = PermissionRepository.getPermissionVersion('usr-role-test');

      assert.equal(vAfterTarget, vBeforeTarget + 1);
      assert.equal(vAfterRole, vBeforeRole + 1);
    });

    it('3.7: Failed transaction rolls back permission_version cleanly', () => {
      const vBefore = PermissionRepository.getPermissionVersion('usr-target-test');

      assert.throws(() => {
        runTransaction(db, () => {
          PermissionRepository.incrementPermissionVersion('usr-target-test');
          throw new Error('Simulated transaction abort');
        });
      }, /Simulated transaction abort/);

      const vAfter = PermissionRepository.getPermissionVersion('usr-target-test');
      assert.equal(vAfter, vBefore);
    });
  });

  // ==========================================================================
  // 4. REGISTRY / ROUTE COVERAGE TESTS
  // ==========================================================================
  describe('Area 4: Registry & Route Coverage Verification', () => {
    it('4.1: All 23 registered pages in REGISTERED_PAGES have valid route and module properties', () => {
      const pageEntries = Object.entries(REGISTERED_PAGES);
      assert.equal(pageEntries.length, 23);

      for (const [id, meta] of pageEntries) {
        assert.equal(meta.id, id);
        assert.ok(meta.displayName.length > 0);
        assert.ok(meta.route.startsWith('/'));
        assert.ok(meta.module.length > 0);
      }
    });

    it('4.2: All standard permission definitions map to registered pages and valid actions', () => {
      assert.ok(STANDARD_PERMISSION_DEFINITIONS.length >= 36);

      for (const def of STANDARD_PERMISSION_DEFINITIONS) {
        assert.ok(REGISTERED_PAGES[def.page_id], `Unknown page_id: ${def.page_id}`);
        assert.ok(def.action_id.length > 0);
        assert.ok(def.display_name.length > 0);
      }
    });
  });
});
