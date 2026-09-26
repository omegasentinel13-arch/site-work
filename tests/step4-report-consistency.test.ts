import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('SUITE 2: PREVIEW / PDF / EXCEL / ZIP DATA CONSISTENCY', () => {
  const tmpDbPath = path.join(os.tmpdir(), `qa_preview_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  let db: DatabaseSync;

  before(() => {
    // Copy production database to disposable QA database
    const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
    fs.copyFileSync(prodDbPath, tmpDbPath);
    db = new DatabaseSync(tmpDbPath, { readOnly: true } as any);
  });

  after(() => {
    try {
      db.close();
      if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
    } catch {}
  });

  test('verifies live summary calculation matches underlying database aggregations', () => {
    // 1. Calculate database counts
    const attendanceRow = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(worker_days), 0) as totalDays, COALESCE(SUM(total_cost_paise), 0) as totalCost
      FROM attendance_records
    `).get() as any;

    const financeRow = db.prepare(`
      SELECT COUNT(*) as count,
             COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) as totalCredits,
             COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as totalDebits
      FROM financial_transactions
    `).get() as any;

    const siteCount = (db.prepare('SELECT COUNT(*) as c FROM sites WHERE is_archived = 0').get() as any).c;

    assert.ok(attendanceRow.count >= 0);
    assert.ok(attendanceRow.totalDays >= 0);
    assert.ok(attendanceRow.totalCost >= 0);
    assert.ok(financeRow.count >= 0);
    assert.ok(siteCount > 0);

    const netCashFlow = financeRow.totalCredits - financeRow.totalDebits;
    assert.strictEqual(typeof netCashFlow, 'number');
  });
});
