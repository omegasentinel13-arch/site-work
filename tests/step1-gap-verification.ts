import http from 'http';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

const SESSION_SECRET = 'site_work_super_secret_session_key_min_32_characters_long_2026_engineering';
const SECRET_KEY = new TextEncoder().encode(SESSION_SECRET);

async function makeToken(payload: {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  authorityTier?: string;
  assignedSiteIds: string[];
  tokenVersion: number;
}): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET_KEY);
}

function apiRequest(
  urlPath: string,
  method: string,
  token?: string,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'http://localhost:3001');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Cookie'] = `site_work_session=${token}`;
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

export async function runGapVerification() {
  console.log('================================================================');
  console.log('SITE WORK — STEP 1.1 FINAL FORENSIC GAP VERIFICATION');
  console.log('Real HTTP Authorization Verification on port 3001');
  console.log('================================================================\n');

  const testDb = new DatabaseSync('data/test_site_work.db');
  testDb.exec('PRAGMA foreign_keys = ON;');

  // Ensure dual prime identity handover is executed on test DB
  let usersInTest = testDb.prepare('SELECT id, username, authority_tier, token_version FROM users').all() as any[];
  let supUser = usersInTest.find(u => u.authority_tier === 'SUPERIOR_PRIME');
  let clientUser = usersInTest.find(u => u.authority_tier === 'CLIENT_PRIME');

  if (!supUser || !clientUser) {
    console.log('Applying executeDualPrimeIdentityHandover to testDb...');
    const { executeDualPrimeIdentityHandover } = await import('../lib/auth/identity-migration');
    executeDualPrimeIdentityHandover({
      db: testDb,
      targetProtectedUsername: 'superior_prime',
      clientPrimeUsername: 'Iamadmin',
      clientPrimeRecoveryEmail: 'supermanskypton@gmail.com',
    });
    usersInTest = testDb.prepare('SELECT id, username, authority_tier, token_version FROM users').all() as any[];
    supUser = usersInTest.find(u => u.authority_tier === 'SUPERIOR_PRIME');
    clientUser = usersInTest.find(u => u.authority_tier === 'CLIENT_PRIME');
  }

  console.log('Test DB Users:', usersInTest);

  const engUser = usersInTest.find(u => u.id === 'usr-eng-1');
  const viewUser = usersInTest.find(u => u.id === 'usr-view-1');

  assert.ok(supUser, 'Superior Prime must exist in test DB');
  assert.ok(clientUser, 'Client Prime must exist in test DB');

  // Generate tokens
  const clientToken = await makeToken({
    userId: clientUser.id,
    username: clientUser.username,
    fullName: 'Client Administrator',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    assignedSiteIds: [],
    tokenVersion: clientUser.token_version,
  });

  const stdAdminToken = await makeToken({
    userId: 'usr-std-admin-test',
    username: 'test_std_admin',
    fullName: 'Test Standard Admin',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  });

  // Ensure test standard admin exists in test DB
  testDb.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, token_version, is_active, created_at, updated_at)
    VALUES ('usr-std-admin-test', 'test_std_admin', 'hash', 'Test Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, datetime('now'), datetime('now'))
  `).run();

  const engToken = await makeToken({
    userId: engUser.id,
    username: engUser.username,
    fullName: 'Site Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-2'],
    tokenVersion: engUser.token_version,
  });

  const viewToken = await makeToken({
    userId: viewUser.id,
    username: viewUser.username,
    fullName: 'Site Auditor',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: viewUser.token_version,
  });

  console.log('✓ Tokens generated for: Client Prime, Standard Admin, Engineer, Viewer\n');

  // Check 2.A: Client Prime GET /api/users -> Superior Prime must NOT appear
  console.log('--- Check 2.A: Client Prime GET /api/users ---');
  const res2A = await apiRequest('/api/users', 'GET', clientToken);
  console.log('HTTP: GET /api/users');
  console.log('Caller: Client Prime (@Iamadmin)');
  console.log('Status:', res2A.status);
  console.log('Users returned count:', res2A.body?.users?.length);
  const returnedUsernames = res2A.body?.users?.map((u: any) => u.username) || [];
  console.log('Returned usernames:', returnedUsernames);
  assert.equal(res2A.status, 200);
  assert.ok(!returnedUsernames.includes('superior_prime'), 'Superior Prime must NOT appear in Client Prime listing');
  assert.ok(returnedUsernames.includes('Iamadmin'), 'Client Prime must appear in listing');
  console.log('✓ Check 2.A Passed: Superior Prime is completely absent from user listing.\n');

  // Check 2.B: Client Prime attempts direct Superior Prime lookup
  // via PUT with non-matching ID or query
  console.log('--- Check 2.B: Client Prime attempts direct Superior Prime lookup ---');
  // If Client Prime tries to PUT or PATCH or DELETE with Superior Prime's ID
  const res2B = await apiRequest('/api/users', 'PUT', clientToken, {
    id: 'usr-admin-1',
    fullName: 'Attempted Lookup',
    role: 'ADMIN',
  });
  console.log('HTTP: PUT /api/users');
  console.log('Caller: Client Prime');
  console.log('Target ID: usr-admin-1 (Superior Prime)');
  console.log('Status:', res2B.status);
  console.log('Response:', res2B.body);
  assert.equal(res2B.status, 404, 'Direct lookup on Superior Prime by non-Superior must return 404 User not found');
  console.log('✓ Check 2.B Passed: Direct lookup returns 404 User not found (existence shielded).\n');

  // Check 2.C: Client Prime attempts PUT against Superior Prime
  console.log('--- Check 2.C: Client Prime attempts PUT against Superior Prime ---');
  const supBeforeC = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const res2C = await apiRequest('/api/users', 'PUT', clientToken, {
    userId: 'usr-admin-1',
    fullName: 'Malicious Rename',
    role: 'VIEWER',
  });
  console.log('HTTP: PUT /api/users');
  console.log('Caller: Client Prime');
  console.log('Status:', res2C.status);
  console.log('Response:', res2C.body);
  const supAfterC = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  assert.ok(res2C.status === 404 || res2C.status === 403, 'Must be rejected with 404 or 403');
  assert.equal(supBeforeC.full_name, supAfterC.full_name, 'DB state must remain unchanged');
  assert.equal(supBeforeC.role, supAfterC.role, 'Role must remain unchanged');
  console.log('✓ Check 2.C Passed: PUT against Superior Prime rejected, DB state unchanged.\n');

  // Check 2.D: Client Prime attempts PATCH credential reset against Superior Prime
  console.log('--- Check 2.D: Client Prime attempts PATCH credential reset against Superior Prime ---');
  const supBeforeD = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const res2D = await apiRequest('/api/users', 'PATCH', clientToken, {
    userId: 'usr-admin-1',
    action: 'RESET_PASSWORD',
    newPassword: 'HackedPassword123!',
    confirmPassword: 'HackedPassword123!',
  });
  console.log('HTTP: PATCH /api/users (RESET_PASSWORD)');
  console.log('Caller: Client Prime');
  console.log('Status:', res2D.status);
  console.log('Response:', res2D.body);
  const supAfterD = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  assert.ok(res2D.status === 404 || res2D.status === 403, 'Must be rejected with 404 or 403');
  assert.equal(supBeforeD.password_hash, supAfterD.password_hash, 'Password hash must remain unchanged');
  console.log('✓ Check 2.D Passed: Credential reset rejected, password hash unchanged.\n');

  // Check 2.E: Client Prime attempts username change against Superior Prime
  console.log('--- Check 2.E: Client Prime attempts username change against Superior Prime ---');
  const supBeforeE = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const res2E = await apiRequest('/api/users', 'PATCH', clientToken, {
    userId: 'usr-admin-1',
    action: 'CHANGE_USERNAME',
    newUsername: 'hacked_superior',
  });
  console.log('HTTP: PATCH /api/users (CHANGE_USERNAME)');
  console.log('Caller: Client Prime');
  console.log('Status:', res2E.status);
  console.log('Response:', res2E.body);
  const supAfterE = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  assert.ok(res2E.status === 404 || res2E.status === 403, 'Must be rejected with 404 or 403');
  assert.equal(supBeforeE.username, supAfterE.username, 'Username must remain unchanged');
  console.log('✓ Check 2.E Passed: Username change rejected, username unchanged.\n');

  // Check 2.F: Client Prime attempts recovery-email change against Superior Prime
  console.log('--- Check 2.F: Client Prime attempts recovery-email change against Superior Prime ---');
  const supBeforeF = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  const res2F = await apiRequest('/api/users', 'PUT', clientToken, {
    userId: 'usr-admin-1',
    fullName: supBeforeF.full_name,
    role: supBeforeF.role,
    recoveryEmail: 'hacker@example.com',
  });
  console.log('HTTP: PUT /api/users (Recovery Email)');
  console.log('Caller: Client Prime');
  console.log('Status:', res2F.status);
  console.log('Response:', res2F.body);
  const supAfterF = testDb.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
  assert.ok(res2F.status === 404 || res2F.status === 403, 'Must be rejected with 404 or 403');
  assert.equal(supBeforeF.recovery_email, supAfterF.recovery_email, 'Recovery email must remain unchanged');
  console.log('✓ Check 2.F Passed: Recovery email modification rejected, email unchanged.\n');

  // Check 2.G: Client Prime attempts to create another SUPERIOR_PRIME
  console.log('--- Check 2.G: Client Prime attempts to create another SUPERIOR_PRIME ---');
  const countBeforeG = (testDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const res2G = await apiRequest('/api/users', 'POST', clientToken, {
    username: 'rogue_superior',
    password: 'RoguePass123!',
    fullName: 'Rogue Superior Prime',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
  });
  console.log('HTTP: POST /api/users (SUPERIOR_PRIME creation)');
  console.log('Caller: Client Prime');
  console.log('Status:', res2G.status);
  console.log('Response:', res2G.body);
  const countAfterG = (testDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  assert.equal(res2G.status, 400, 'Must be rejected with 400');
  assert.equal(countBeforeG, countAfterG, 'No user must be created');
  console.log('✓ Check 2.G Passed: SUPERIOR_PRIME creation rejected, user count unchanged.\n');

  // Check 2.H: Standard Admin attempts any Prime mutation
  console.log('--- Check 2.H: Standard Admin attempts any Prime mutation ---');
  const res2H1 = await apiRequest('/api/users', 'PUT', stdAdminToken, {
    userId: clientUser.id,
    fullName: 'Hacked Client Prime',
    role: 'VIEWER',
  });
  console.log('HTTP: PUT /api/users on Client Prime');
  console.log('Caller: Standard Admin');
  console.log('Status:', res2H1.status);
  console.log('Response:', res2H1.body);
  assert.equal(res2H1.status, 400, 'Standard Admin mutating Client Prime must fail');
  assert.match(res2H1.body.error, /Insufficient authority/, 'Must report Insufficient authority');

  const res2H2 = await apiRequest('/api/users', 'DELETE', stdAdminToken, {
    id: clientUser.id,
  });
  console.log('HTTP: DELETE /api/users on Client Prime');
  console.log('Caller: Standard Admin');
  console.log('Status:', res2H2.status);
  console.log('Response:', res2H2.body);
  assert.equal(res2H2.status, 400, 'Standard Admin deleting Client Prime must fail');

  const res2H3 = await apiRequest('/api/users', 'PATCH', stdAdminToken, {
    id: 'usr-admin-1',
    action: 'RESET_PASSWORD',
    newPassword: 'HackedPassword123!',
  });
  console.log('HTTP: PATCH /api/users on Superior Prime');
  console.log('Caller: Standard Admin');
  console.log('Status:', res2H3.status);
  console.log('Response:', res2H3.body);
  assert.equal(res2H3.status, 404, 'Superior Prime not found for Standard Admin');
  console.log('✓ Check 2.H Passed: Standard Admin strictly blocked from mutating any Prime identity.\n');

  // Check 2.I: Engineer attempts user-management mutation
  console.log('--- Check 2.I: Engineer attempts user-management mutation ---');
  const res2I = await apiRequest('/api/users', 'POST', engToken, {
    username: 'engineer_created_user',
    password: 'Password123!',
    fullName: 'Unauthorized User',
    role: 'VIEWER',
  });
  console.log('HTTP: POST /api/users');
  console.log('Caller: Engineer (SITE_MANAGER)');
  console.log('Status:', res2I.status);
  console.log('Response:', res2I.body);
  assert.ok(res2I.status === 400 || res2I.status === 403, 'Engineer must be rejected');
  console.log('✓ Check 2.I Passed: Engineer strictly blocked from user-management mutation.\n');

  // Check 2.J: Viewer attempts user-management mutation
  console.log('--- Check 2.J: Viewer attempts user-management mutation ---');
  const res2J = await apiRequest('/api/users', 'DELETE', viewToken, {
    id: 'usr-eng-1',
  });
  console.log('HTTP: DELETE /api/users');
  console.log('Caller: Viewer');
  console.log('Status:', res2J.status);
  console.log('Response:', res2J.body);
  assert.ok(res2J.status === 400 || res2J.status === 403, 'Viewer must be rejected');
  console.log('✓ Check 2.J Passed: Viewer strictly blocked from user-management mutation.\n');

  testDb.close();
  console.log('================================================================');
  console.log('ALL REAL HTTP AUTHORIZATION CHECKS (A–J) PASSED COMPLETELY!');
  console.log('================================================================\n');
}

runGapVerification().catch(err => {
  console.error('Gap verification failed:', err);
  process.exit(1);
});
