import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getUserById, getUserAssignedSites } from '@/lib/db/repositories/user-repo';
import { jwtVerify } from 'jose';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { getDb } from '@/lib/db';
import {
  resolveExportPeriod,
  getScopeHistoricalDateBounds,
  collectSiteExportData,
  collectSystemExportData,
  ExportScope,
  PeriodPreset,
} from '@/lib/export/complete';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_COOKIE_NAME = 'site_work_session';

async function authenticateRequest(req: Request) {
  try {
    const s = await getSession();
    if (s) return s;
  } catch {
    // cookies() may be called outside Next.js request context (e.g. in test runner)
  }

  const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie');
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/(?:^|;\s*)site_work_session=([^;]+)/);
  if (!match) return null;
  const token = match[1];

  try {
    const secret = process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026';
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    const userId = payload.userId as string;
    const tokenVersion = (payload.tokenVersion as number) || 1;

    const user = getUserById(userId);
    if (!user || user.is_active === 0 || user.token_version !== tokenVersion) {
      return null;
    }

    const assignedSiteIds = user.role === 'ADMIN' ? [] : getUserAssignedSites(user.id);
    return {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      assignedSiteIds,
      tokenVersion: user.token_version,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    // 1. Authenticate user session
    const session = await authenticateRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    // 2. Viewer accounts are strictly forbidden from viewing Complete Report
    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Complete report viewing is restricted to Administrators and Engineers.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const scopeParam = searchParams.get('scope') || (session.role === 'ADMIN' ? 'SYSTEM' : 'SITE');
    const siteIdParam = searchParams.get('siteId') || undefined;
    const periodParam = (searchParams.get('period') || 'ALL_DATA') as PeriodPreset;
    const fromParam = searchParams.get('from') || undefined;
    const toParam = searchParams.get('to') || undefined;

    const requestedScope = scopeParam as ExportScope;

    // 3. Validate Scope & RBAC
    if (requestedScope !== 'SYSTEM' && requestedScope !== 'SITE') {
      return NextResponse.json({ error: 'Invalid scope. Must be SYSTEM or SITE.' }, { status: 400 });
    }

    if (requestedScope === 'SYSTEM') {
      if (session.role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'System-wide report requires Administrator privileges.' },
          { status: 403 }
        );
      }
    } else if (requestedScope === 'SITE') {
      if (!siteIdParam || !siteIdParam.trim()) {
        return NextResponse.json({ error: 'siteId is required for site-level report' }, { status: 400 });
      }

      const site = getSiteById(siteIdParam.trim());
      if (!site) {
        return NextResponse.json({ error: 'Site not found' }, { status: 404 });
      }

      if (session.role !== 'ADMIN' && !session.assignedSiteIds.includes(siteIdParam.trim())) {
        return NextResponse.json(
          { error: 'You are not authorized to view report for this site.' },
          { status: 403 }
        );
      }
    }

    // 4. Validate custom dates
    if (periodParam === 'CUSTOM') {
      if (!fromParam || !DATE_REGEX.test(fromParam) || !toParam || !DATE_REGEX.test(toParam)) {
        return NextResponse.json({ error: 'Valid from and to dates (YYYY-MM-DD) are required for CUSTOM period.' }, { status: 400 });
      }
      if (fromParam > toParam) {
        return NextResponse.json({ error: 'Start date cannot be after end date.' }, { status: 400 });
      }
    }

    // 5. Resolve period
    const bounds = getScopeHistoricalDateBounds(requestedScope === 'SITE' ? siteIdParam : undefined);
    const resolvedPeriod = resolveExportPeriod(periodParam, fromParam, toParam, bounds);

    const db = getDb();

    // 6. Collect report data
    if (requestedScope === 'SITE') {
      const siteExportData = collectSiteExportData(siteIdParam!.trim(), resolvedPeriod);

      const auditCountRow = db.prepare("SELECT count(*) as count FROM audit_logs WHERE site_id = ?").get(siteIdParam!.trim()) as { count: number } | undefined;
      const recentAudit = db.prepare("SELECT id, entity_type, action, created_at, user_id FROM audit_logs WHERE site_id = ? ORDER BY created_at DESC LIMIT 5").all(siteIdParam!.trim());

      return NextResponse.json({
        success: true,
        scope: 'SITE',
        period: resolvedPeriod,
        data: siteExportData,
        auditCount: auditCountRow?.count || 0,
        recentAudit,
      });
    } else {
      const systemExportData = collectSystemExportData(resolvedPeriod);

      const auditCountRow = db.prepare("SELECT count(*) as count FROM audit_logs").get() as { count: number } | undefined;
      const recentAudit = db.prepare("SELECT id, entity_type, action, created_at, user_id, site_id FROM audit_logs ORDER BY created_at DESC LIMIT 5").all();

      return NextResponse.json({
        success: true,
        scope: 'SYSTEM',
        period: resolvedPeriod,
        data: systemExportData,
        auditCount: auditCountRow?.count || 0,
        recentAudit,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to collect complete report data.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
