import { getDb, runTransaction } from '../index';
import crypto from 'crypto';
import { 
  registerArchivedEntity, 
  registerRecycledEntity, 
  removeLifecycleRecord,
  getLifecycleRecord 
} from './global-lifecycle-repo';
import { evaluateSiteDependencies } from '@/lib/lifecycle/site-dependency';
import { generateNameSlug, generateCodeSlug } from '@/lib/site/slug';

export interface SiteRecord {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  is_archived: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  routing_mode?: 'NAME' | 'CODE';
  canonical_slug?: string;
  lifecycle_state?: 'ACTIVE' | 'ARCHIVED' | 'RECYCLE_BIN';
  recycled_at?: string | null;
  keep_permanently?: number;
}

export type SiteFilter = 'ACTIVE' | 'ALL' | 'ARCHIVED' | 'RECYCLE_BIN' | boolean;

export function getAllSites(
  filterOrIncludeArchived: SiteFilter = false,
  userAllowedSiteIds?: string[] | null
): SiteRecord[] {
  const db = getDb();
  let query = `
    SELECT 
      s.*,
      COALESCE(slr.state, CASE WHEN s.is_archived = 1 THEN 'ARCHIVED' ELSE 'ACTIVE' END) as lifecycle_state,
      slr.recycled_at,
      COALESCE(slr.keep_permanently, 0) as keep_permanently
    FROM sites s
    LEFT JOIN system_lifecycle_records slr 
      ON slr.entity_type = 'SITE' AND slr.entity_id = s.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  // Filter mode parsing
  if (filterOrIncludeArchived === false || filterOrIncludeArchived === 'ACTIVE') {
    query += ` AND s.is_archived = 0 AND (slr.state IS NULL OR slr.state != 'RECYCLE_BIN')`;
  } else if (filterOrIncludeArchived === 'ARCHIVED') {
    query += ` AND s.is_archived = 1 AND (slr.state IS NULL OR slr.state = 'ARCHIVED')`;
  } else if (filterOrIncludeArchived === 'RECYCLE_BIN') {
    query += ` AND slr.state = 'RECYCLE_BIN'`;
  } else if (filterOrIncludeArchived === true || filterOrIncludeArchived === 'ALL') {
    // 'ALL' in general list includes Active and Archived, but excludes Recycle Bin
    query += ` AND (slr.state IS NULL OR slr.state != 'RECYCLE_BIN')`;
  }

  if (userAllowedSiteIds && userAllowedSiteIds.length > 0) {
    const placeholders = userAllowedSiteIds.map(() => '?').join(',');
    query += ` AND s.id IN (${placeholders})`;
    params.push(...userAllowedSiteIds);
  } else if (userAllowedSiteIds && userAllowedSiteIds.length === 0) {
    return [];
  }

  query += ` ORDER BY s.name ASC`;
  return db.prepare(query).all(...params) as SiteRecord[];
}

export function getSiteById(id: string): SiteRecord | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT 
      s.*,
      COALESCE(slr.state, CASE WHEN s.is_archived = 1 THEN 'ARCHIVED' ELSE 'ACTIVE' END) as lifecycle_state,
      slr.recycled_at,
      COALESCE(slr.keep_permanently, 0) as keep_permanently
    FROM sites s
    LEFT JOIN system_lifecycle_records slr 
      ON slr.entity_type = 'SITE' AND slr.entity_id = s.id
    WHERE s.id = ?
  `).get(id) as SiteRecord | undefined;
  return row || null;
}

export function getSiteByHistoricalSlug(slug: string): SiteRecord | null {
  const db = getDb();
  try {
    const row = db
      .prepare('SELECT site_id FROM site_slug_history WHERE LOWER(slug) = LOWER(?)')
      .get(slug) as { site_id: string } | undefined;
    if (row) {
      return getSiteById(row.site_id);
    }
  } catch {}
  return null;
}

export function createSite(
  name: string,
  code: string | null,
  location: string | null,
  createdBy: string | null,
  routingMode: 'NAME' | 'CODE' = 'NAME'
): string {
  const db = getDb();
  return runTransaction(db, () => {
    const id = `site-${crypto.randomUUID()}`;
    const trimmedName = name.trim();
    const trimmedCode = code ? code.trim() : null;
    const trimmedLocation = location ? location.trim() : null;

    let baseSlug = '';
    if (routingMode === 'CODE' && trimmedCode) {
      baseSlug = generateCodeSlug(trimmedCode);
    } else {
      baseSlug = generateNameSlug(trimmedName);
    }

    const otherSites = getAllSites(false);
    const otherSlugs = new Set(otherSites.map((s) => s.canonical_slug?.toLowerCase()).filter(Boolean));
    let candidate = baseSlug;
    let count = 2;
    while (otherSlugs.has(candidate.toLowerCase())) {
      candidate = `${baseSlug}-${count}`;
      count++;
    }

    db.prepare(`
      INSERT INTO sites (id, name, code, location, is_archived, created_by, created_at, updated_at, routing_mode, canonical_slug)
      VALUES (?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'), ?, ?)
    `).run(id, trimmedName, trimmedCode, trimmedLocation, createdBy, routingMode, candidate);

    return id;
  });
}

export function updateSite(
  id: string,
  name: string,
  code: string | null,
  location: string | null
): void {
  const db = getDb();
  runTransaction(db, () => {
    const existingSite = getSiteById(id);
    if (!existingSite) {
      throw new Error(`Site with id ${id} not found`);
    }

    const trimmedName = name.trim();
    const trimmedCode = code ? code.trim() : null;
    const trimmedLocation = location ? location.trim() : null;
    const routingMode = existingSite.routing_mode || 'NAME';
    let newCanonicalSlug = existingSite.canonical_slug || '';

    let shouldUpdateSlug = false;
    if (routingMode === 'NAME') {
      // IF routing_mode = NAME:
      // name changes: recalculate canonical_slug from new name, store old canonical_slug in history, update canonical_slug, 307 old -> new
      // code changes: DO NOT change canonical_slug, DO NOT create slug history, URL remains unchanged
      if (trimmedName.toLowerCase() !== existingSite.name.toLowerCase()) {
        shouldUpdateSlug = true;
        const baseSlug = generateNameSlug(trimmedName);
        const otherSites = getAllSites(false).filter((s) => s.id !== id);
        const otherSlugs = new Set(otherSites.map((s) => s.canonical_slug?.toLowerCase()).filter(Boolean));
        let candidate = baseSlug;
        let count = 2;
        while (otherSlugs.has(candidate.toLowerCase())) {
          candidate = `${baseSlug}-${count}`;
          count++;
        }
        newCanonicalSlug = candidate;
      }
    } else if (routingMode === 'CODE') {
      // IF routing_mode = CODE:
      // name changes: DO NOT change canonical_slug, DO NOT create slug history, URL remains unchanged
      // code changes: recalculate canonical_slug from new code, store old canonical_slug in history, update canonical_slug, 307 old -> new
      const existingCode = existingSite.code ? existingSite.code.toLowerCase() : '';
      const nextCode = trimmedCode ? trimmedCode.toLowerCase() : '';
      if (existingCode !== nextCode && trimmedCode) {
        shouldUpdateSlug = true;
        const baseSlug = generateCodeSlug(trimmedCode);
        const otherSites = getAllSites(false).filter((s) => s.id !== id);
        const otherSlugs = new Set(otherSites.map((s) => s.canonical_slug?.toLowerCase()).filter(Boolean));
        let candidate = baseSlug;
        let count = 2;
        while (otherSlugs.has(candidate.toLowerCase())) {
          candidate = `${baseSlug}-${count}`;
          count++;
        }
        newCanonicalSlug = candidate;
      }
    }

    if (shouldUpdateSlug && existingSite.canonical_slug && existingSite.canonical_slug !== newCanonicalSlug) {
      // Reconcile site_slug_history: if new canonical slug is in history for this site, remove it
      db.prepare('DELETE FROM site_slug_history WHERE LOWER(slug) = LOWER(?)').run(newCanonicalSlug);

      // Add old canonical slug to history
      db.prepare(
        "INSERT OR REPLACE INTO site_slug_history (slug, site_id, created_at) VALUES (?, ?, datetime('now'))"
      ).run(existingSite.canonical_slug, id);
    }

    db.prepare(`
      UPDATE sites 
      SET name = ?, code = ?, location = ?, canonical_slug = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(trimmedName, trimmedCode, trimmedLocation, newCanonicalSlug || existingSite.canonical_slug, id);
  });
}

export function toggleSiteArchived(id: string, isArchived: boolean, userId?: string | null): void {
  const db = getDb();
  const site = getSiteById(id);
  if (!site) return;

  if (isArchived) {
    db.prepare(`
      UPDATE sites 
      SET is_archived = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    registerArchivedEntity({
      entityType: 'SITE',
      entityId: id,
      entityName: site.name,
      sourceModule: 'Sites',
      sourceRoute: '/setup/sites',
      restoreDestination: '/setup/sites',
      userId: userId || null,
    });
  } else {
    db.prepare(`
      UPDATE sites 
      SET is_archived = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    removeLifecycleRecord('SITE', id);
  }
}

export function moveSiteToRecycleBin(id: string, userId?: string | null): void {
  const db = getDb();
  const site = getSiteById(id);
  if (!site) throw new Error('Site not found');

  db.prepare(`
    UPDATE sites 
    SET is_archived = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(id);

  registerRecycledEntity({
    entityType: 'SITE',
    entityId: id,
    entityName: site.name,
    sourceModule: 'Sites',
    sourceRoute: '/setup/sites',
    restoreDestination: '/setup/sites',
    userId: userId || null,
  });
}

export function restoreSiteFromRecycleBin(id: string, toArchived = false, userId?: string | null): void {
  const db = getDb();
  const site = getSiteById(id);
  if (!site) throw new Error('Site not found');

  if (toArchived) {
    db.prepare(`
      UPDATE sites 
      SET is_archived = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    registerArchivedEntity({
      entityType: 'SITE',
      entityId: id,
      entityName: site.name,
      sourceModule: 'Sites',
      sourceRoute: '/setup/sites',
      restoreDestination: '/setup/sites',
      userId: userId || null,
    });
  } else {
    db.prepare(`
      UPDATE sites 
      SET is_archived = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    removeLifecycleRecord('SITE', id);
  }
}

export function permanentlyDeleteSite(id: string): void {
  const db = getDb();
  const depReport = evaluateSiteDependencies(id);

  if (!depReport.canDelete) {
    throw new Error(depReport.blockingReason || 'Cannot delete site with active dependencies.');
  }

  // Pure atomic cleanup of empty operational configuration and parent record
  runTransaction(db, () => {
    db.prepare(`DELETE FROM site_users WHERE site_id = ?`).run(id);
    db.prepare(`DELETE FROM site_role_rates WHERE site_id = ?`).run(id);
    db.prepare(`DELETE FROM supply_items WHERE site_id = ?`).run(id);
    db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    removeLifecycleRecord('SITE', id);
  });
}

export function getSiteUserIds(siteId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`SELECT user_id FROM site_users WHERE site_id = ?`).all(siteId) as { user_id: string }[];
  return rows.map(r => r.user_id);
}

export function setSiteUsers(siteId: string, userIds: string[]): void {
  const db = getDb();
  const deleteStmt = db.prepare(`DELETE FROM site_users WHERE site_id = ?`);
  const insertStmt = db.prepare(`INSERT INTO site_users (id, site_id, user_id) VALUES (?, ?, ?)`);

  runTransaction(db, () => {
    // Find all users previously or currently assigned to this site
    const existingRows = db.prepare(`SELECT user_id FROM site_users WHERE site_id = ?`).all(siteId) as { user_id: string }[];
    const affectedUserIds = Array.from(new Set([...existingRows.map(r => r.user_id), ...userIds]));

    deleteStmt.run(siteId);
    for (const uId of userIds) {
      insertStmt.run(`su-${crypto.randomUUID()}`, siteId, uId);
    }

    // Atomically increment permission_version for all affected users
    try {
      const updatePvStmt = db.prepare(`UPDATE users SET permission_version = permission_version + 1 WHERE id = ?`);
      for (const uId of affectedUserIds) {
        updatePvStmt.run(uId);
      }
    } catch {
      // Safe fallback if column not yet added
    }
  });
}

export interface SitesKPISummary {
  totalSites: number;
  activeSites: number;
  archivedSites: number;
  sitesWithHistory: number;
  assignedPersonnelCount: number;
}

export function getSitesKPISummary(): SitesKPISummary {
  const db = getDb();

  // Active sites
  const activeCount = (db.prepare(`
    SELECT COUNT(*) as c FROM sites s
    LEFT JOIN system_lifecycle_records slr ON slr.entity_type = 'SITE' AND slr.entity_id = s.id
    WHERE s.is_archived = 0 AND (slr.state IS NULL OR slr.state != 'RECYCLE_BIN')
  `).get() as { c: number }).c;

  // Archived sites (excluding recycle bin)
  const archivedCount = (db.prepare(`
    SELECT COUNT(*) as c FROM sites s
    LEFT JOIN system_lifecycle_records slr ON slr.entity_type = 'SITE' AND slr.entity_id = s.id
    WHERE s.is_archived = 1 AND (slr.state IS NULL OR slr.state = 'ARCHIVED')
  `).get() as { c: number }).c;

  // Total visible enterprise sites (Active + Archived)
  const totalSites = activeCount + archivedCount;

  // Sites with operational history (> 0 attendance or > 0 financial transactions)
  const sitesWithHistory = (db.prepare(`
    SELECT COUNT(DISTINCT id) as c FROM (
      SELECT site_id as id FROM attendance_records
      UNION
      SELECT site_id as id FROM financial_transactions
    )
  `).get() as { c: number }).c;

  // Assigned personnel count (distinct active users assigned)
  const assignedPersonnelCount = (db.prepare(`
    SELECT COUNT(DISTINCT user_id) as c FROM site_users
  `).get() as { c: number }).c;

  return {
    totalSites,
    activeSites: activeCount,
    archivedSites: archivedCount,
    sitesWithHistory,
    assignedPersonnelCount,
  };
}

export interface SiteOperationalStats {
  site: SiteRecord;
  assignedUsers: {
    id: string;
    username: string;
    fullName: string;
    role: string;
  }[];
  financials: {
    transactionCount: number;
    totalCreditsPaise: number;
    totalDebitsPaise: number;
    netBalancePaise: number;
  };
  workforce: {
    recordCount: number;
    totalWorkerDays: number;
    totalLaborCostPaise: number;
    lastAttendanceDate: string | null;
  };
  recentActivity: {
    id: string;
    date: string;
    type: 'TRANSACTION' | 'ATTENDANCE';
    summary: string;
    amountOrCostPaise?: number;
  }[];
}

export function getSiteOperationalStats(siteId: string): SiteOperationalStats | null {
  const db = getDb();
  const site = getSiteById(siteId);
  if (!site) return null;

  // Assigned users
  const assignedUsers = (db.prepare(`
    SELECT u.id, u.username, u.full_name as fullName, u.role
    FROM site_users su
    JOIN users u ON su.user_id = u.id
    WHERE su.site_id = ?
    ORDER BY u.full_name ASC
  `).all(siteId) as { id: string; username: string; fullName: string; role: string }[]);

  // Financials
  const finRow = db.prepare(`
    SELECT 
      COUNT(*) as tx_count,
      COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) as credits,
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as debits
    FROM financial_transactions
    WHERE site_id = ?
  `).get(siteId) as { tx_count: number; credits: number; debits: number };

  const totalCreditsPaise = finRow ? Number(finRow.credits) : 0;
  const totalDebitsPaise = finRow ? Number(finRow.debits) : 0;
  const netBalancePaise = totalCreditsPaise - totalDebitsPaise;

  // Workforce / Attendance
  const attRow = db.prepare(`
    SELECT 
      COUNT(*) as record_count,
      COALESCE(SUM(worker_days), 0) as worker_days,
      COALESCE(SUM(total_cost_paise), 0) as labor_cost,
      MAX(date) as last_date
    FROM attendance_records
    WHERE site_id = ?
  `).get(siteId) as { record_count: number; worker_days: number; labor_cost: number; last_date: string | null };

  // Recent activity: combined recent transactions and attendance
  const recentTxs = (db.prepare(`
    SELECT id, date, type, amount_paise, description
    FROM financial_transactions
    WHERE site_id = ?
    ORDER BY date DESC, created_at DESC
    LIMIT 4
  `).all(siteId) as { id: string; date: string; type: string; amount_paise: number; description: string }[]).map(t => ({
    id: t.id,
    date: t.date,
    type: 'TRANSACTION' as const,
    summary: `${t.type === 'CREDIT' ? 'Credit Received' : 'Payment Disbursed'}: ${t.description}`,
    amountOrCostPaise: t.amount_paise,
  }));

  const recentAtt = (db.prepare(`
    SELECT date, SUM(worker_days) as w_days, SUM(total_cost_paise) as cost
    FROM attendance_records
    WHERE site_id = ?
    GROUP BY date
    ORDER BY date DESC
    LIMIT 4
  `).all(siteId) as { date: string; w_days: number; cost: number }[]).map((a, idx) => ({
    id: `att-agg-${idx}-${a.date}`,
    date: a.date,
    type: 'ATTENDANCE' as const,
    summary: `Daily Attendance: ${a.w_days} Worker-day${a.w_days === 1 ? '' : 's'} logged`,
    amountOrCostPaise: a.cost,
  }));

  // Interleave and sort by date desc
  const recentActivity = [...recentTxs, ...recentAtt]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  return {
    site,
    assignedUsers,
    financials: {
      transactionCount: finRow ? Number(finRow.tx_count) : 0,
      totalCreditsPaise,
      totalDebitsPaise,
      netBalancePaise,
    },
    workforce: {
      recordCount: attRow ? Number(attRow.record_count) : 0,
      totalWorkerDays: attRow ? Number(attRow.worker_days) : 0,
      totalLaborCostPaise: attRow ? Number(attRow.labor_cost) : 0,
      lastAttendanceDate: attRow ? attRow.last_date : null,
    },
    recentActivity,
  };
}
