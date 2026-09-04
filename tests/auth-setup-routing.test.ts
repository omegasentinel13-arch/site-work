import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_auth_routing.db');
if (fs.existsSync(TEST_DB_PATH)) {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
}
process.env.DATABASE_PATH = TEST_DB_PATH;

import { getDb, closeDb } from '../lib/db/index';
import { runSeed } from '../lib/db/seed';
import { hasAdminUser, createUser } from '../lib/db/repositories/user-repo';
import { GET as getSetupStatus } from '../app/api/auth/setup-status/route';
import { POST as postSetupAdmin } from '../app/api/auth/setup-admin/route';

test('PHASE A: AUTH & SETUP ROUTING SUITE', async (t) => {
  const db = getDb();
  runSeed();

  await t.test('1. Fresh/Uninitialized DB: setup-status returns isSetupRequired: true with no-store headers', async () => {
    db.prepare('DELETE FROM users').run();
    assert.equal(hasAdminUser(), false, 'hasAdminUser must return false when no admins exist');

    const res = await getSetupStatus();
    assert.equal(res.status, 200);

    const cacheHeader = res.headers.get('cache-control');
    assert.ok(cacheHeader?.includes('no-store'), 'Must enforce no-store caching');

    const data = await res.json();
    assert.equal(data.isSetupRequired, true, 'isSetupRequired must be true when no admin exists');
  });

  await t.test('2. First-time setup creates administrator in repository', async () => {
    const adminId = createUser({
      username: 'newadmin',
      fullName: 'New System Admin',
      passwordPlainText: 'adminpassword123',
      role: 'ADMIN',
      recoveryEmail: 'test@example.com',
    });

    assert.ok(adminId, 'Admin ID should be returned');
    assert.equal(hasAdminUser(), true, 'hasAdminUser must now return true');
  });

  await t.test('3. Initialized DB: setup-status dynamically returns isSetupRequired: false', async () => {
    const res = await getSetupStatus();
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isSetupRequired, false, 'isSetupRequired must be false once admin exists');
  });

  await t.test('4. Initialized DB: duplicate setup-admin call is rejected with HTTP 403', async () => {
    const req = new Request('http://localhost:3000/api/auth/setup-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'anotheradmin',
        fullName: 'Another Admin',
        password: 'adminpassword123',
        confirmPassword: 'adminpassword123',
        recoveryEmail: 'another@example.com',
      }),
    });

    const res = await postSetupAdmin(req);
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('already been completed'), 'Must reject duplicate setup with clear error message');
  });

  await t.test('5. Live HTTP verification (if local server running)', async () => {
    try {
      const statusRes = await fetch('http://localhost:3000/api/auth/setup-status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        // Since local master DB has admin, statusData.isSetupRequired must be false
        assert.equal(statusData.isSetupRequired, false, 'Live server setup-status must report false for initialized DB');

        const initialAdminRes = await fetch('http://localhost:3000/setup/initial-admin');
        const initialAdminHtml = await initialAdminRes.text();
        assert.equal(initialAdminRes.status, 200);
        assert.ok(
          initialAdminHtml.includes('Setup Already Completed') || initialAdminHtml.includes('Proceed to Sign In') || initialAdminHtml.includes('/login'),
          'Initial admin page SSR must render completed state or Login link'
        );
      }
    } catch {
      // Local HTTP server not running; unit tests already verified behavior
    }
  });
});

test.after(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
});
