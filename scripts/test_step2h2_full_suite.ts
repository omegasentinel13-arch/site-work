import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Setup isolated QA database via atomic VACUUM INTO snapshot
const prodDbPath = path.resolve('data/site_work.db');
const testDbPath = path.resolve('data/test_site_work.db');

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const sourceDb = new DatabaseSync(prodDbPath);
sourceDb.exec(`VACUUM INTO '${testDbPath.replace(/\\/g, '/')}'`);
sourceDb.close();

// Point environment to isolated test DB BEFORE loading any DB or repo modules
process.env.DATABASE_PATH = testDbPath;

async function runQaSuite() {
  console.log('====================================================');
  console.log('STEP 2H.2: COMPREHENSIVE QA VERIFICATION SUITE');
  console.log('====================================================');

  const { getDb, closeDb } = await import('@/lib/db');
  const { canAccess } = await import('@/lib/permissions/evaluator');
  const { PermissionRepository } = await import('@/lib/db/repositories/permission-repo');
  const { getUserById } = await import('@/lib/db/repositories/user-repo');
  const { canManageAuthority } = await import('@/lib/auth/authority');

  const db = getDb();
  console.log('Connected to QA database:', testDbPath);

  PermissionRepository.seedStandardDefinitions();

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName}`);
      throw new Error(`Assertion failed for: ${testName}`);
    }
  }

  // Fetch users
  const superiorPrimeUser = getUserById('usr-admin-1');
  const clientPrimeUser = getUserById('usr-f7825275-d30e-4b89-9d6b-994b50532984'); // abadmin
  const standardAdminUser = getUserById('usr-9f94fd49-edcd-4a5d-89c4-a304fe9730dd'); // STAR-SCREW
  const engineerUser = getUserById('usr-eng-1'); // engineer2

  assert(Boolean(superiorPrimeUser), 'Superior Prime user exists (Iamadmin)');
  assert(Boolean(clientPrimeUser), 'Client Prime user exists (abadmin)');
  assert(Boolean(standardAdminUser), 'Standard Admin user exists (STAR-SCREW)');
  assert(Boolean(engineerUser), 'Standard engineer exists (engineer2)');

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Site Authority & Rule 10 Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 1: Site Authority & Rule 10 Enforcement ---');

  // Clear STAR-SCREW site assignments first
  PermissionRepository.setUserSites(standardAdminUser!.id, []);
  let assigned = PermissionRepository.getUserAssignedSiteIds(standardAdminUser!.id);
  assert(assigned.length === 0, 'Standard Admin initially has 0 assigned sites');

  // 1A. Standard Admin without site assignment is DENIED with UNASSIGNED_SITE_DENY
  const stdAdminDenied = canAccess({
    session: {
      userId: standardAdminUser!.id,
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'VIEW',
    resourceSiteId: 'site-1',
  });
  assert(
    stdAdminDenied.allowed === false && stdAdminDenied.ruleSource === 'UNASSIGNED_SITE_DENY',
    'Standard Admin without site assignment is DENIED at Step 4 (UNASSIGNED_SITE_DENY)'
  );

  // 1B. Assign Standard Admin strictly to site-1
  PermissionRepository.setUserSites(standardAdminUser!.id, ['site-1']);
  assigned = PermissionRepository.getUserAssignedSiteIds(standardAdminUser!.id);
  assert(assigned.length === 1 && assigned[0] === 'site-1', 'Standard Admin assigned to site-1');

  // Now site-1 access is ALLOWED
  const stdAdminSite1 = canAccess({
    session: {
      userId: standardAdminUser!.id,
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'VIEW',
    resourceSiteId: 'site-1',
  });
  assert(stdAdminSite1.allowed === true, 'Standard Admin assigned to site-1 is ALLOWED for site-1');

  // But site-2 access is still DENIED (Isolation intact)
  const stdAdminSite2 = canAccess({
    session: {
      userId: standardAdminUser!.id,
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'VIEW',
    resourceSiteId: 'site-2',
  });
  assert(
    stdAdminSite2.allowed === false && stdAdminSite2.ruleSource === 'UNASSIGNED_SITE_DENY',
    'Standard Admin assigned only to site-1 is DENIED for unassigned site-2 (UNASSIGNED_SITE_DENY)'
  );

  // 1C. Client Prime (abadmin) automatically bypasses site scoping (Rule 10)
  PermissionRepository.setUserSites(clientPrimeUser!.id, []);
  const clientPrimeSite1 = canAccess({
    session: {
      userId: clientPrimeUser!.id,
      role: 'ADMIN',
      authorityTier: 'CLIENT_PRIME',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'VIEW',
    resourceSiteId: 'site-1',
  });
  const clientPrimeSite2 = canAccess({
    session: {
      userId: clientPrimeUser!.id,
      role: 'ADMIN',
      authorityTier: 'CLIENT_PRIME',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'VIEW',
    resourceSiteId: 'site-2',
  });
  assert(
    clientPrimeSite1.allowed === true && clientPrimeSite2.allowed === true,
    'Client Prime (PRIME) automatically bypasses site scoping across all sites'
  );

  // 1D. Superior Prime automatically holds root platform authority
  const superiorPrimeAccess = canAccess({
    session: {
      userId: superiorPrimeUser!.id,
      role: 'ADMIN',
      authorityTier: 'SUPERIOR_PRIME',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'VIEW',
    resourceSiteId: 'site-2',
  });
  assert(
    superiorPrimeAccess.allowed === true && superiorPrimeAccess.ruleSource === 'SUPERIOR_PRIME_PLATFORM_AUTHORITY',
    'Superior Prime holds root platform authority (SUPERIOR_PRIME_PLATFORM_AUTHORITY)'
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Recursive Admin Delegation & Authority Hierarchy
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Authority Hierarchy & Delegation ---');

  const supPrimeSession = { id: superiorPrimeUser!.id, role: superiorPrimeUser!.role, authorityTier: superiorPrimeUser!.authority_tier };
  const clientPrimeSession = { id: clientPrimeUser!.id, role: clientPrimeUser!.role, authorityTier: clientPrimeUser!.authority_tier };
  const stdAdminSession = { id: standardAdminUser!.id, role: standardAdminUser!.role, authorityTier: standardAdminUser!.authority_tier };

  // Superior Prime can manage Client Prime, Standard Admin, Standard
  assert(canManageAuthority(supPrimeSession, clientPrimeUser!), 'Superior Prime can manage Client Prime');
  assert(canManageAuthority(supPrimeSession, standardAdminUser!), 'Superior Prime can manage Standard Admin');
  assert(canManageAuthority(supPrimeSession, engineerUser!), 'Superior Prime can manage Standard user');

  // Client Prime can manage Standard Admin and Standard users
  assert(canManageAuthority(clientPrimeSession, standardAdminUser!), 'Client Prime can manage Standard Admin');
  assert(canManageAuthority(clientPrimeSession, engineerUser!), 'Client Prime can manage Standard user');

  // Client Prime CANNOT manage Superior Prime or self
  assert(!canManageAuthority(clientPrimeSession, superiorPrimeUser!), 'Client Prime CANNOT manage Superior Prime');
  assert(!canManageAuthority(clientPrimeSession, clientPrimeUser!), 'Client Prime CANNOT manage self');

  // Standard Admin CANNOT manage Superior Prime or Client Prime
  assert(!canManageAuthority(stdAdminSession, superiorPrimeUser!), 'Standard Admin CANNOT manage Superior Prime');
  assert(!canManageAuthority(stdAdminSession, clientPrimeUser!), 'Standard Admin CANNOT manage Client Prime');

  // Standard Admin CAN manage peers and Standard users
  assert(canManageAuthority(stdAdminSession, standardAdminUser!), 'Standard Admin can manage peer Standard Admin');
  assert(canManageAuthority(stdAdminSession, engineerUser!), 'Standard Admin can manage Standard user');

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Batch Site Assignment API & Version Increment
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Batch Site Assignment & Version Increment ---');

  const initialVersion = PermissionRepository.getPermissionVersion(standardAdminUser!.id);
  const updatedSites = PermissionRepository.setUserSites(standardAdminUser!.id, ['site-1', 'site-2']);
  const newVersion = PermissionRepository.getPermissionVersion(standardAdminUser!.id);

  assert(updatedSites.length === 2 && updatedSites.includes('site-1') && updatedSites.includes('site-2'), 'setUserSites atomically assigned 2 sites');
  assert(newVersion === initialVersion + 1, 'setUserSites incremented permission_version atomically');

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Permission Overrides (ALLOW / DENY / RESET)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Granular User Overrides ---');

  // Assign engineer to site-1 first so site isolation check passes
  PermissionRepository.setUserSites(engineerUser!.id, ['site-1']);

  const def = PermissionRepository.getPermissionDefinitionByPageAction('PAGE_ATTENDANCE_DAILY', 'EDIT');
  assert(Boolean(def), 'Permission definition exists for PAGE_ATTENDANCE_DAILY:EDIT');

  const vBeforeOverride = PermissionRepository.getPermissionVersion(engineerUser!.id);

  // Set explicit DENY override
  PermissionRepository.setUserOverride({
    userId: engineerUser!.id,
    permissionId: def!.id,
    siteId: null,
    effect: 'DENY',
    grantedBy: superiorPrimeUser!.id,
  });
  const vAfterDeny = PermissionRepository.getPermissionVersion(engineerUser!.id);
  assert(vAfterDeny === vBeforeOverride + 1, 'Setting DENY override incremented permission_version');

  const denyAccess = canAccess({
    session: {
      userId: engineerUser!.id,
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'EDIT',
    resourceSiteId: 'site-1',
  });
  assert(denyAccess.allowed === false && denyAccess.ruleSource === 'USER_GLOBAL_EXPLICIT_DENY', 'Explicit DENY override enforced');

  // Remove override (RESET)
  PermissionRepository.removeUserOverride(engineerUser!.id, def!.id, null);
  const vAfterReset = PermissionRepository.getPermissionVersion(engineerUser!.id);
  assert(vAfterReset === vAfterDeny + 1, 'Removing override (RESET) incremented permission_version');

  const resetAccess = canAccess({
    session: {
      userId: engineerUser!.id,
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      isActive: true,
    },
    page: 'PAGE_ATTENDANCE_DAILY',
    action: 'EDIT',
    resourceSiteId: 'site-1',
  });
  assert(resetAccess.allowed === true, 'After removing DENY override, SITE_MANAGER can EDIT attendance on assigned site');

  console.log('\n====================================================');
  console.log(`ALL ${totalTests} TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
  console.log('====================================================');

  closeDb();
}

runQaSuite()
  .then(() => {
    // Clean up isolated test database
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
        console.log('Test database cleaned up successfully.');
      } catch (e) {
        console.log('Note: Test DB cleanup deferred.');
      }
    }
  })
  .catch((err) => {
    console.error('QA Suite Failed:', err);
    process.exit(1);
  });
