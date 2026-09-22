import { getDb } from '../index';
import crypto from 'crypto';

export type LifecycleState = 'ARCHIVED' | 'RECYCLE_BIN';

export interface GlobalLifecycleRecord {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  source_module: string;
  source_route: string;
  restore_destination: string;
  state: LifecycleState;
  keep_permanently: number;
  archived_at: string | null;
  recycled_at: string | null;
  performed_by: string | null;
  performed_by_name?: string | null;
  metadata?: string | null;
  created_at: string;
  updated_at: string;
  canPermanentlyDelete?: boolean;
  blockingReason?: string | null;
}

/**
 * Returns all CURRENT archived entities across the system.
 */
export function getGlobalArchivedItems(entityType?: string, search?: string): GlobalLifecycleRecord[] {
  const db = getDb();
  let query = `
    SELECT 
      slr.*,
      u.full_name as performed_by_name
    FROM system_lifecycle_records slr
    LEFT JOIN users u ON slr.performed_by = u.id
    WHERE slr.state = 'ARCHIVED'
  `;
  const params: unknown[] = [];

  if (entityType && entityType !== 'ALL') {
    query += ` AND slr.entity_type = ?`;
    params.push(entityType);
  }

  if (search && search.trim()) {
    query += ` AND (slr.entity_name LIKE ? OR slr.source_module LIKE ?)`;
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  query += ` ORDER BY slr.updated_at DESC`;
  return db.prepare(query).all(...params) as GlobalLifecycleRecord[];
}

/**
 * Returns all CURRENT recycled entities across the system.
 */
export function getGlobalRecycledItems(entityType?: string, search?: string): GlobalLifecycleRecord[] {
  const db = getDb();
  let query = `
    SELECT 
      slr.*,
      u.full_name as performed_by_name
    FROM system_lifecycle_records slr
    LEFT JOIN users u ON slr.performed_by = u.id
    WHERE slr.state = 'RECYCLE_BIN'
  `;
  const params: unknown[] = [];

  if (entityType && entityType !== 'ALL') {
    query += ` AND slr.entity_type = ?`;
    params.push(entityType);
  }

  if (search && search.trim()) {
    query += ` AND (slr.entity_name LIKE ? OR slr.source_module LIKE ?)`;
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  query += ` ORDER BY slr.updated_at DESC`;
  return db.prepare(query).all(...params) as GlobalLifecycleRecord[];
}

/**
 * Gets the current lifecycle record for a specific entity.
 */
export function getLifecycleRecord(entityType: string, entityId: string): GlobalLifecycleRecord | null {
  const db = getDb();
  let row = db.prepare(`
    SELECT slr.*, u.full_name as performed_by_name
    FROM system_lifecycle_records slr
    LEFT JOIN users u ON slr.performed_by = u.id
    WHERE slr.entity_type = ? AND slr.entity_id = ?
  `).get(entityType, entityId) as GlobalLifecycleRecord | undefined;

  if (!row) {
    let altType: string | null = null;
    if (entityType === 'ROLE') altType = 'WORK_ROLE';
    else if (entityType === 'WORK_ROLE') altType = 'ROLE';
    else if (entityType === 'CATEGORY') altType = 'WORK_CATEGORY';
    else if (entityType === 'WORK_CATEGORY') altType = 'CATEGORY';

    if (altType) {
      row = db.prepare(`
        SELECT slr.*, u.full_name as performed_by_name
        FROM system_lifecycle_records slr
        LEFT JOIN users u ON slr.performed_by = u.id
        WHERE slr.entity_type = ? AND slr.entity_id = ?
      `).get(altType, entityId) as GlobalLifecycleRecord | undefined;
    }
  }

  return row || null;
}

/**
 * Registers an entity into CURRENT archived status.
 */
export function registerArchivedEntity(data: {
  entityType: string;
  entityId: string;
  entityName: string;
  sourceModule: string;
  sourceRoute: string;
  restoreDestination: string;
  userId: string | null;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  const existing = getLifecycleRecord(data.entityType, data.entityId);
  const enrichedMetadata = {
    original_source_route: data.sourceRoute,
    archived_by: data.userId,
    ...data.metadata,
  };
  const metadataStr = JSON.stringify(enrichedMetadata);

  if (existing) {
    db.prepare(`
      UPDATE system_lifecycle_records
      SET 
        entity_name = ?,
        source_module = ?,
        source_route = ?,
        restore_destination = ?,
        state = 'ARCHIVED',
        archived_at = datetime('now'),
        performed_by = ?,
        metadata = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.entityName,
      data.sourceModule,
      data.sourceRoute,
      data.restoreDestination,
      data.userId,
      metadataStr,
      existing.id
    );
  } else {
    const id = `lfc-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO system_lifecycle_records (
        id, entity_type, entity_id, entity_name,
        source_module, source_route, restore_destination,
        state, keep_permanently, archived_at, recycled_at,
        performed_by, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ARCHIVED', 0, datetime('now'), null, ?, ?, datetime('now'), datetime('now'))
    `).run(
      id,
      data.entityType,
      data.entityId,
      data.entityName,
      data.sourceModule,
      data.sourceRoute,
      data.restoreDestination,
      data.userId,
      metadataStr
    );
  }
}

/**
 * Registers an entity into CURRENT recycle-bin status.
 */
export function registerRecycledEntity(data: {
  entityType: string;
  entityId: string;
  entityName: string;
  sourceModule: string;
  sourceRoute: string;
  restoreDestination: string;
  userId: string | null;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  const existing = getLifecycleRecord(data.entityType, data.entityId);
  const enrichedMetadata = {
    retention_policy: '30_DAYS',
    retention_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    original_source_route: data.sourceRoute,
    recycled_by: data.userId,
    ...data.metadata,
  };
  const metadataStr = JSON.stringify(enrichedMetadata);

  if (existing) {
    db.prepare(`
      UPDATE system_lifecycle_records
      SET 
        entity_name = ?,
        source_module = ?,
        source_route = ?,
        restore_destination = ?,
        state = 'RECYCLE_BIN',
        recycled_at = datetime('now'),
        performed_by = ?,
        metadata = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.entityName,
      data.sourceModule,
      data.sourceRoute,
      data.restoreDestination,
      data.userId,
      metadataStr,
      existing.id
    );
  } else {
    const id = `lfc-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO system_lifecycle_records (
        id, entity_type, entity_id, entity_name,
        source_module, source_route, restore_destination,
        state, keep_permanently, archived_at, recycled_at,
        performed_by, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RECYCLE_BIN', 0, null, datetime('now'), ?, ?, datetime('now'), datetime('now'))
    `).run(
      id,
      data.entityType,
      data.entityId,
      data.entityName,
      data.sourceModule,
      data.sourceRoute,
      data.restoreDestination,
      data.userId,
      metadataStr
    );
  }
}

/**
 * Toggles the "Keep Permanently" flag on a recycled entity.
 */
export function toggleLifecycleKeepPermanently(lifecycleRecordId: string, keep: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE system_lifecycle_records
    SET keep_permanently = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(keep ? 1 : 0, lifecycleRecordId);
}

/**
 * Removes an entity from the lifecycle registry when restored to full active status in its primary workspace.
 */
export function removeLifecycleRecord(entityType: string, entityId: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM system_lifecycle_records
    WHERE entity_type = ? AND entity_id = ?
  `).run(entityType, entityId);
}
