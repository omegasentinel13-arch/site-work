import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { executeDualPrimeIdentityHandover } from '../lib/auth/identity-migration';
import { 
  getAllUsers, 
  getUserById, 
  getUserByUsername, 
  createUser, 
  updateUser, 
  updatePassword, 
  updateUsername, 
  updateRecoveryEmail, 
  deleteUser, 
  countActiveAdmins 
} from '../lib/db/repositories/user-repo';
import { 
  isSuperiorPrime, 
  isClientPrime, 
  isStandardAdmin, 
  canManageAuthority, 
  canModifyCredentials, 
  canAssignAuthorityTier, 
  canDeleteUser 
} from '../lib/auth/authority';
import { UserSession } from '../lib/auth/session';

// Setup QA test database using exact copy of production baseline
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_site_work.db');
const PROD_DB_PATH = path.join(process.cwd(), 'data', 'site_work.db');

function resetTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);

  const prodDb = new DatabaseSync(PROD_DB_PATH, { readOnly: true });
  prodDb.prepare(`VACUUM INTO '${TEST_DB_PATH}'`).run();
  prodDb.close();

  // Apply schema migration on test database
  const testDb = new DatabaseSync(TEST_DB_PATH);
  testDb.exec('PRAGMA journal_mode = WAL;');
  testDb.exec('PRAGMA foreign_keys = ON;');
  
  const tableInfo = testDb.prepare('PRAGMA table_info(users);').all() as { name: string }[];
  const cols = new Set(tableInfo.map(c => c.name));
  if (!cols.has('authority_tier')) {
    testDb.exec("ALTER TABLE users ADD COLUMN authority_tier TEXT NOT NULL DEFAULT 'STANDARD';");
    testDb.exec("UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE role = 'ADMIN' AND authority_tier = 'STANDARD';");
  }
  testDb.close();
}

async function runTests() {
  console.log('=== STARTING DUAL PRIME IDENTITY FOUNDATION TESTS ===\n');

  // 1. Reset test database
  resetTestDb();
  process.env.DATABASE_PATH = TEST_DB_PATH;
  process.env.PORT = '3001';

  const testDb = new DatabaseSync(TEST_DB_PATH);
  testDb.exec('PRAGMA foreign_keys = ON;');

  // Verify test baseline before migration
  const usersBefore = testDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  const auditBefore = testDb.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number };
  const adminBefore = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const adminAuditBefore = testDb.prepare('SELECT COUNT(*) as c FROM audit_logs WHERE user_id = ?').get('usr-admin-1') as { c: number };

  assert.equal(usersBefore.c, 4, 'Test DB must start with 4 users');
  assert.equal(auditBefore.c, 429, 'Test DB must start with 429 audit logs');
  assert.equal(adminBefore.username, 'Iamadmin', 'usr-admin-1 must initially be Iamadmin');
  assert.equal(adminBefore.recovery_email, 'omegasentinel13@gmail.com');
  assert.equal(adminAuditBefore.c, 362, 'usr-admin-1 must have 362 audit logs');
  console.log('✔ Test Baseline Verified: 4 users, 429 audit logs (362 authored by usr-admin-1)');

  // 2. Test Rollback Atomicity
  console.log('\n--- Testing Rollback Safety ---');
  assert.throws(() => {
    // Attempt migration with existing username to force collision error
    executeDualPrimeIdentityHandover({
      db: testDb,
      targetProtectedUsername: 'engineer1', // deliberately collide with existing user
    });
  }, /already taken/, 'Handover must abort if protected username collides');

  // Verify test DB remained completely unchanged after rollback
  const usersAfterAbort = testDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  const adminAfterAbort = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const auditAfterAbort = testDb.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number };

  assert.equal(usersAfterAbort.c, 4, 'Rollback: users count must remain 4');
  assert.equal(adminAfterAbort.username, 'Iamadmin', 'Rollback: usr-admin-1 must still be Iamadmin');
  assert.equal(auditAfterAbort.c, 429, 'Rollback: audit count must remain 429');
  console.log('✔ Rollback Safety Verified: complete atomic rollback on failure');

  // 3. Execute Valid Dual Prime Identity Handover
  console.log('\n--- Testing Successful Identity Handover ---');
  const result = executeDualPrimeIdentityHandover({
    db: testDb,
    targetProtectedUsername: 'superior_prime',
    clientPrimeUsername: 'Iamadmin',
    clientPrimeRecoveryEmail: 'supermanskypton@gmail.com',
  });

  assert.ok(result.success, 'Handover must return success');
  assert.equal(result.superiorPrimeId, 'usr-admin-1');
  assert.equal(result.superiorPrimeUsername, 'superior_prime');
  assert.equal(result.clientPrimeId, 'usr-client-prime-1');
  assert.equal(result.clientPrimeUsername, 'Iamadmin');

  // Verify Superior Prime state
  const superiorPrime = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  assert.equal(superiorPrime.id, 'usr-admin-1', 'A: Superior Prime ID must remain usr-admin-1');
  assert.equal(superiorPrime.username, 'superior_prime', 'B: Superior Prime username must be superior_prime');
  assert.equal(superiorPrime.authority_tier, 'SUPERIOR_PRIME', 'C: authority_tier must be SUPERIOR_PRIME');
  assert.equal(superiorPrime.recovery_email, 'omegasentinel13@gmail.com', 'D: Recovery email must remain omegasentinel13@gmail.com');
  assert.equal(superiorPrime.role, 'ADMIN', 'Role must remain ADMIN');

  // Verify Client Prime state
  const clientPrime = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-client-prime-1') as any;
  assert.equal(clientPrime.id, 'usr-client-prime-1', 'E: Client Prime ID must be usr-client-prime-1');
  assert.equal(clientPrime.username, 'Iamadmin', 'F: Client Prime username must be Iamadmin');
  assert.equal(clientPrime.authority_tier, 'CLIENT_PRIME', 'G: authority_tier must be CLIENT_PRIME');
  assert.equal(clientPrime.recovery_email, 'supermanskypton@gmail.com', 'H: Recovery email must be supermanskypton@gmail.com');
  assert.equal(clientPrime.role, 'ADMIN', 'Role must be ADMIN');

  // Verify Audit Logs Continuity
  const superiorAuditCount = testDb.prepare('SELECT COUNT(*) as c FROM audit_logs WHERE user_id = ?').get('usr-admin-1') as { c: number };
  const totalAuditCount = testDb.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number };
  assert.equal(superiorAuditCount.c, 363, 'I: All 362 historical logs + 1 migration log must remain linked to usr-admin-1');
  assert.equal(totalAuditCount.c, 430, 'Total audit logs must be 430 (429 + 1 migration log)');

  // Verify migration audit event details
  const migrationAudit = testDb.prepare("SELECT * FROM audit_logs WHERE action = 'IDENTITY_RESOLUTION_MIGRATION'").get() as any;
  assert.ok(migrationAudit, 'Migration audit record must exist');
  assert.equal(migrationAudit.user_id, 'usr-admin-1');
  const afterState = JSON.parse(migrationAudit.after_state);
  assert.equal(afterState.newUsername, 'superior_prime');
  assert.equal(afterState.clientPrimeUsername, 'Iamadmin');
  assert.equal(afterState.clientPrimeRecoveryEmail, 'supermanskypton@gmail.com');
  assert.ok(!afterState.password, 'Audit log must contain ZERO plaintext passwords');
  assert.ok(!afterState.password_hash, 'Audit log must contain ZERO password hashes');
  console.log('✔ Handover Verified: Superior Prime protected, Client Prime created, 362 historical audit logs preserved');

  // 4. Test Enumeration & Discovery Shielding
  console.log('\n--- Testing Enumeration & Discovery Shielding ---');
  const superiorSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'superior_prime',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
    assignedSiteIds: [],
    tokenVersion: superiorPrime.token_version,
  };

  const clientSession: UserSession = {
    userId: 'usr-client-prime-1',
    username: 'Iamadmin',
    fullName: 'Client Administrator',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const standardAdminSession: UserSession = {
    userId: 'usr-std-admin',
    username: 'stdadmin',
    fullName: 'Standard Administrator',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const engineerSession: UserSession = {
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Site Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-2'],
    tokenVersion: 4,
  };

  // Superior Prime sees ALL users (5 total)
  const allUsersSeenBySuperior = getAllUsers(superiorSession);
  assert.equal(allUsersSeenBySuperior.length, 5, 'Superior Prime sees all 5 users');
  assert.ok(allUsersSeenBySuperior.some(u => u.username === 'superior_prime'), 'Superior Prime sees itself');
  assert.ok(allUsersSeenBySuperior.some(u => u.username === 'Iamadmin'), 'Superior Prime sees Client Prime');

  // Client Prime sees only operational users (4 total, excludes Superior Prime)
  const allUsersSeenByClient = getAllUsers(clientSession);
  assert.equal(allUsersSeenByClient.length, 4, 'Client Prime sees only 4 users');
  assert.ok(!allUsersSeenByClient.some(u => u.username === 'superior_prime'), 'Client Prime CANNOT see Superior Prime in listing');
  assert.ok(allUsersSeenByClient.some(u => u.username === 'Iamadmin'), 'Client Prime sees itself');

  // Standard Admin sees only operational users (excludes Superior Prime)
  const allUsersSeenByStdAdmin = getAllUsers(standardAdminSession);
  assert.equal(allUsersSeenByStdAdmin.length, 4, 'Standard Admin sees only 4 users');
  assert.ok(!allUsersSeenByStdAdmin.some(u => u.username === 'superior_prime'), 'Standard Admin CANNOT see Superior Prime');

  // Engineer sees only operational users
  const allUsersSeenByEng = getAllUsers(engineerSession);
  assert.equal(allUsersSeenByEng.length, 4, 'Engineer sees only 4 users');
  assert.ok(!allUsersSeenByEng.some(u => u.username === 'superior_prime'), 'Engineer CANNOT see Superior Prime');

  // Targeted lookups
  assert.equal(getUserById('usr-admin-1', clientSession), null, 'Client Prime querying Superior Prime by ID returns null');
  assert.equal(getUserByUsername('superior_prime', clientSession), null, 'Client Prime querying Superior Prime by username returns null');
  assert.equal(getUserById('usr-admin-1', standardAdminSession), null, 'Standard Admin querying Superior Prime by ID returns null');
  assert.equal(getUserById('usr-admin-1', engineerSession), null, 'Engineer querying Superior Prime by ID returns null');

  // Superior Prime querying itself
  assert.ok(getUserById('usr-admin-1', superiorSession), 'Superior Prime querying itself returns user record');
  console.log('✔ Enumeration & Discovery Shielding Verified: Superior Prime is 100% invisible to all lower authorities');

  // 5. Test Authority Protection Guards
  console.log('\n--- Testing Authority Hierarchy & Protection Guards ---');
  
  // Can Client Prime manage Superior Prime?
  assert.equal(canManageAuthority(clientSession, superiorPrime), false, 'Client Prime CANNOT manage Superior Prime');
  assert.equal(canModifyCredentials(clientSession, superiorPrime), false, 'Client Prime CANNOT modify Superior Prime credentials');
  assert.equal(canDeleteUser(clientSession, superiorPrime), false, 'Client Prime CANNOT delete Superior Prime');

  // Can Standard Admin manage Client Prime or Superior Prime?
  assert.equal(canManageAuthority(standardAdminSession, clientPrime), false, 'Standard Admin CANNOT manage Client Prime');
  assert.equal(canManageAuthority(standardAdminSession, superiorPrime), false, 'Standard Admin CANNOT manage Superior Prime');
  assert.equal(canDeleteUser(standardAdminSession, clientPrime), false, 'Standard Admin CANNOT delete Client Prime');

  // Can anyone delete Primes?
  assert.equal(canDeleteUser(superiorSession, superiorPrime), false, 'Superior Prime CANNOT delete self');
  assert.equal(canDeleteUser(superiorSession, clientPrime), false, 'Client Prime cannot be deleted via standard delete');

  // Can Client Prime assign SUPERIOR_PRIME?
  assert.equal(canAssignAuthorityTier(clientSession, 'SUPERIOR_PRIME'), false, 'Client Prime CANNOT assign SUPERIOR_PRIME');
  assert.equal(canAssignAuthorityTier(clientSession, 'CLIENT_PRIME'), false, 'Client Prime CANNOT assign CLIENT_PRIME');
  assert.equal(canAssignAuthorityTier(clientSession, 'STANDARD_ADMIN'), true, 'Client Prime CAN assign STANDARD_ADMIN');
  assert.equal(canAssignAuthorityTier(clientSession, 'STANDARD'), true, 'Client Prime CAN assign STANDARD');

  // Repository-level mutation rejections
  assert.throws(() => {
    updateUser({ id: 'usr-admin-1', fullName: 'Hacked', role: 'ADMIN', isActive: true }, clientSession);
  }, /Insufficient authority/, 'Repository: Client Prime updating Superior Prime must throw');

  assert.throws(() => {
    updatePassword('usr-admin-1', 'HackedPass123!', clientSession);
  }, /Insufficient authority/, 'Repository: Client Prime resetting Superior Prime password must throw');

  assert.throws(() => {
    updateUsername('usr-admin-1', 'hacked_name', clientSession);
  }, /Insufficient authority/, 'Repository: Client Prime changing Superior Prime username must throw');

  assert.throws(() => {
    updateRecoveryEmail('usr-admin-1', 'hacker@example.com', clientSession);
  }, /Insufficient authority/, 'Repository: Client Prime changing Superior Prime recovery email must throw');

  assert.throws(() => {
    deleteUser('usr-admin-1', clientSession);
  }, /Prime identities cannot be deleted|Insufficient authority/, 'Repository: Client Prime deleting Superior Prime must throw');

  assert.throws(() => {
    createUser({
      username: 'fake_superior',
      passwordPlainText: 'ValidPass123!',
      fullName: 'Fake Superior',
      role: 'ADMIN',
      authorityTier: 'SUPERIOR_PRIME',
    }, clientSession);
  }, /SUPERIOR_PRIME accounts cannot be created/, 'Repository: Creating SUPERIOR_PRIME must throw');

  console.log('✔ Authority Protection Guards Verified: all unauthorized mutations strictly rejected');

  // 6. Test PRAGMA Integrity and Foreign Key Checks on QA DB
  console.log('\n--- Testing Database Integrity on QA Database ---');
  const integrity = testDb.prepare('PRAGMA integrity_check;').get() as { integrity_check: string };
  const fkErrors = testDb.prepare('PRAGMA foreign_key_check;').all();
  assert.equal(integrity.integrity_check, 'ok', 'QA DB PRAGMA integrity_check must be ok');
  assert.equal(fkErrors.length, 0, 'QA DB PRAGMA foreign_key_check must have 0 errors');
  testDb.close();
  console.log('✔ QA DB Integrity Verified: integrity_check = ok, foreign_key_check = 0 errors');

  // 7. Test Production Database Safety (data/site_work.db MUST BE UNTOUCHED)
  console.log('\n--- Verifying Production Database Remains Untouched ---');
  const prodDb = new DatabaseSync(PROD_DB_PATH, { readOnly: true });
  const prodUsers = (prodDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const prodSites = (prodDb.prepare('SELECT COUNT(*) as c FROM sites').get() as { c: number }).c;
  const prodCategories = (prodDb.prepare('SELECT COUNT(*) as c FROM work_categories').get() as { c: number }).c;
  const prodRoles = (prodDb.prepare('SELECT COUNT(*) as c FROM work_roles').get() as { c: number }).c;
  const prodAttendance = (prodDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as { c: number }).c;
  const prodFinance = (prodDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as { c: number }).c;
  const prodAudit = (prodDb.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number }).c;
  const prodLifecycle = (prodDb.prepare('SELECT COUNT(*) as c FROM system_lifecycle_records').get() as { c: number }).c;
  const prodIntegrity = (prodDb.prepare('PRAGMA integrity_check;').get() as { integrity_check: string }).integrity_check;
  const prodFkErrors = (prodDb.prepare('PRAGMA foreign_key_check;').all()).length;

  const prodAdmin = prodDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  assert.equal(prodAdmin.username, 'Iamadmin', 'Production usr-admin-1 must remain Iamadmin');
  assert.equal(prodAdmin.recovery_email, 'omegasentinel13@gmail.com');

  assert.equal(prodUsers, 4, 'Production users must remain exactly 4');
  assert.equal(prodSites, 6, 'Production sites must remain exactly 6');
  assert.equal(prodCategories, 4, 'Production categories must remain exactly 4');
  assert.equal(prodRoles, 23, 'Production roles must remain exactly 23');
  assert.equal(prodAttendance, 18, 'Production attendance must remain exactly 18');
  assert.equal(prodFinance, 4, 'Production finance must remain exactly 4');
  assert.equal(prodAudit, 429, 'Production audit logs must remain exactly 429');
  assert.equal(prodLifecycle, 0, 'Production lifecycle records must remain exactly 0');
  assert.equal(prodIntegrity, 'ok', 'Production integrity_check must be ok');
  assert.equal(prodFkErrors, 0, 'Production foreign_key_check must be 0 errors');
  prodDb.close();

  console.log('✔ Production DB Verified: 100% UNTOUCHED (4 users, 6 sites, 4 categories, 23 roles, 18 attendance, 4 finance, 429 audit, 0 lifecycle)');
  console.log('\n=== ALL DUAL PRIME TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
