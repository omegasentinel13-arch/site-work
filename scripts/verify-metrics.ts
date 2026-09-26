import { DatabaseSync } from 'node:sqlite';

const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true } as any);
console.log('--- PRODUCTION DB METRICS ---');
console.log('users:', prodDb.prepare('SELECT count(*) as c FROM users').get());
console.log('sites:', prodDb.prepare('SELECT count(*) as c FROM sites').get());
console.log('work_categories:', prodDb.prepare('SELECT count(*) as c FROM work_categories').get());
console.log('work_roles:', prodDb.prepare('SELECT count(*) as c FROM work_roles').get());
console.log('attendance_records:', prodDb.prepare('SELECT count(*) as c FROM attendance_records').get());
console.log('financial_transactions:', prodDb.prepare('SELECT count(*) as c FROM financial_transactions').get());
console.log('audit_logs:', prodDb.prepare('SELECT count(*) as c FROM audit_logs').get());
console.log('system_lifecycle_records:', prodDb.prepare('SELECT count(*) as c FROM system_lifecycle_records').get());
console.log('integrity_check:', prodDb.prepare('PRAGMA integrity_check').get());
console.log('foreign_key_check:', prodDb.prepare('PRAGMA foreign_key_check').all().length);
prodDb.close();

const testDb = new DatabaseSync('data/test_site_work.db', { readOnly: true } as any);
console.log('--- TEST DB METRICS ---');
console.log('users:', testDb.prepare('SELECT count(*) as c FROM users').get());
console.log('sites:', testDb.prepare('SELECT count(*) as c FROM sites').get());
console.log('integrity_check:', testDb.prepare('PRAGMA integrity_check').get());
console.log('foreign_key_check:', testDb.prepare('PRAGMA foreign_key_check').all().length);
testDb.close();
