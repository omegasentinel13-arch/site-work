import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { restoreRole, restoreCategory } from '@/lib/db/repositories/role-repo';
import { toggleSiteArchived, restoreSiteFromRecycleBin } from '@/lib/db/repositories/site-repo';
import { getLifecycleRecord } from '@/lib/db/repositories/global-lifecycle-repo';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const body = await req.json();
    const { entityType, entityId, source } = body;

    if (!entityType || !entityId) {
      return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 });
    }

    if (source === 'AUDIT_TRAIL') {
      const accessAuditRestore = canAccess({ session, page: 'PAGE_AUDIT_TRAIL', action: 'RESTORE' });
      if (!accessAuditRestore.allowed) {
        return NextResponse.json(
          { error: accessAuditRestore.reason || 'Access denied: Audit Trail restore requires explicit authorization' },
          { status: accessAuditRestore.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
        );
      }
    } else {
      const accessArchive = canAccess({ session, page: 'PAGE_GLOBAL_ARCHIVE', action: 'RESTORE' });
      const accessRecycle = canAccess({ session, page: 'PAGE_GLOBAL_RECYCLE_BIN', action: 'RESTORE' });
      const accessAuditRestore = canAccess({ session, page: 'PAGE_AUDIT_TRAIL', action: 'RESTORE' });

      if (!accessArchive.allowed && !accessRecycle.allowed && !accessAuditRestore.allowed) {
        return NextResponse.json(
          { error: accessAuditRestore.reason || accessRecycle.reason || accessArchive.reason || 'Access denied' },
          { status: accessAuditRestore.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
        );
      }
    }

    const type = entityType.toUpperCase().trim();
    const db = getDb();

    if (type === 'WORK_ROLE' || type === 'ROLE') {
      const role = db.prepare(`SELECT * FROM work_roles WHERE id = ?`).get(entityId) as {
        id: string;
        category_id: string;
        name: string;
        is_active: number;
      } | undefined;

      if (!role) {
        return NextResponse.json({ error: `Role '${entityId}' not found` }, { status: 404 });
      }

      // Collision Check 1: Parent category must exist and be active
      const cat = db.prepare(`SELECT * FROM work_categories WHERE id = ?`).get(role.category_id) as {
        id: string;
        name: string;
        is_active: number;
      } | undefined;

      if (!cat || cat.is_active === 0) {
        return NextResponse.json({
          error: `Cannot restore role '${role.name}': parent category '${cat?.name || role.category_id}' is inactive or in the Recycle Bin. Please restore the category first.`,
          isBlocked: true,
        }, { status: 409 });
      }

      // Collision Check 2: Name uniqueness within the same category among active roles
      const duplicateRole = db.prepare(`
        SELECT id FROM work_roles 
        WHERE category_id = ? AND LOWER(name) = LOWER(?) AND id != ? AND is_active = 1
      `).get(role.category_id, role.name, role.id);

      if (duplicateRole) {
        return NextResponse.json({
          error: `Cannot restore role '${role.name}': an active role with this name already exists in category '${cat.name}'.`,
          isBlocked: true,
        }, { status: 409 });
      }

      restoreRole(entityId, session!.userId);
      return NextResponse.json({ success: true, message: 'Role restored successfully' });
    }

    if (type === 'WORK_CATEGORY' || type === 'CATEGORY') {
      const cat = db.prepare(`SELECT * FROM work_categories WHERE id = ?`).get(entityId) as {
        id: string;
        name: string;
        is_active: number;
      } | undefined;

      if (!cat) {
        return NextResponse.json({ error: `Category '${entityId}' not found` }, { status: 404 });
      }

      // Collision Check: Category name uniqueness among active categories
      const duplicateCat = db.prepare(`
        SELECT id FROM work_categories 
        WHERE LOWER(name) = LOWER(?) AND id != ? AND is_active = 1
      `).get(cat.name, cat.id);

      if (duplicateCat) {
        return NextResponse.json({
          error: `Cannot restore category '${cat.name}': an active category with this name already exists.`,
          isBlocked: true,
        }, { status: 409 });
      }

      restoreCategory(entityId, session!.userId);
      return NextResponse.json({ success: true, message: 'Category restored successfully' });
    }

    if (type === 'SITE') {
      const site = db.prepare(`SELECT * FROM sites WHERE id = ?`).get(entityId) as {
        id: string;
        name: string;
        code: string | null;
        is_archived: number;
      } | undefined;

      if (!site) {
        return NextResponse.json({ error: `Site '${entityId}' not found` }, { status: 404 });
      }

      // Collision Check 1: Site name uniqueness among active sites
      const duplicateSiteName = db.prepare(`
        SELECT id FROM sites 
        WHERE LOWER(name) = LOWER(?) AND id != ? AND is_archived = 0
      `).get(site.name, site.id);

      if (duplicateSiteName) {
        return NextResponse.json({
          error: `Cannot restore site '${site.name}': an active site with this name already exists.`,
          isBlocked: true,
        }, { status: 409 });
      }

      // Collision Check 2: Site code uniqueness among active sites
      if (site.code) {
        const duplicateSiteCode = db.prepare(`
          SELECT id FROM sites 
          WHERE LOWER(code) = LOWER(?) AND id != ? AND is_archived = 0
        `).get(site.code, site.id);

        if (duplicateSiteCode) {
          return NextResponse.json({
            error: `Cannot restore site '${site.name}': an active site with code '${site.code}' already exists.`,
            isBlocked: true,
          }, { status: 409 });
        }
      }

      const lfc = getLifecycleRecord('SITE', entityId);
      if (lfc && lfc.state === 'RECYCLE_BIN') {
        restoreSiteFromRecycleBin(entityId, false, session!.userId);
        logAudit({
          entityType: 'SITE',
          entityId,
          action: 'SITE_RESTORED_FROM_RECYCLE_BIN',
          siteId: entityId,
          userId: session!.userId,
          afterState: { state: 'ACTIVE', is_archived: 0 },
        });
      } else {
        toggleSiteArchived(entityId, false, session!.userId);
        logAudit({
          entityType: 'SITE',
          entityId,
          action: 'SITE_RESTORED',
          siteId: entityId,
          userId: session!.userId,
          afterState: { state: 'ACTIVE', is_archived: 0 },
        });
      }
      return NextResponse.json({ success: true, message: 'Site restored successfully' });
    }

    return NextResponse.json({ error: `Unsupported entity type: ${entityType}` }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error restoring entity';
    if (msg.includes('Admin') || msg.includes('Access denied') || msg.includes('Unauthorized') || msg.includes('permission')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
