import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

export function prepareTestDatabase() {
  if (fs.existsSync('data/test_site_work.db')) fs.unlinkSync('data/test_site_work.db');
  if (fs.existsSync('data/test_site_work.db-wal')) fs.unlinkSync('data/test_site_work.db-wal');
  if (fs.existsSync('data/test_site_work.db-shm')) fs.unlinkSync('data/test_site_work.db-shm');

  const db = new DatabaseSync('data/site_work.db', { readOnly: true });
  db.prepare("VACUUM INTO 'data/test_site_work.db'").run();
  db.close();
  console.log('Clean data/test_site_work.db created from data/site_work.db baseline');
}

if (process.argv[1]?.includes('prepare-test-db')) {
  prepareTestDatabase();
}
