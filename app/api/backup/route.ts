import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { listStoredBackups, createEnterpriseBackup, BackupScope } from '@/lib/backup';
import { PeriodPreset } from '@/lib/export/complete';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot access backup archives.' },
        { status: 403 }
      );
    }

    const backups = await listStoredBackups(session);
    return NextResponse.json({ backups });
  } catch (error: any) {
    console.error('Error fetching backups:', error);
    return NextResponse.json({ error: error.message || 'Failed to list backups' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot create backup archives.' },
        { status: 403 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const scope: BackupScope = body.scope || (session.role === 'ADMIN' ? 'SYSTEM' : 'SITE');
    const siteId: string | undefined = body.siteId;
    const period: PeriodPreset = body.period || 'ALL_DATA';
    const from: string | undefined = body.from;
    const to: string | undefined = body.to;
    const includePdf: boolean = body.includePdf ?? true;
    const includeExcel: boolean = body.includeExcel ?? true;

    // Strict Server-Side RBAC Guard
    if (scope === 'SYSTEM' && session.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: System-wide backups require Administrator privileges.' },
        { status: 403 }
      );
    }

    if (scope === 'SITE' && session.role === 'SITE_MANAGER') {
      if (!siteId) {
        return NextResponse.json(
          { error: 'siteId is required for site-scoped backup.' },
          { status: 400 }
        );
      }
      if (!session.assignedSiteIds.includes(siteId)) {
        return NextResponse.json(
          { error: 'Access denied: You are not assigned to this project site.' },
          { status: 403 }
        );
      }
    }

    const result = await createEnterpriseBackup(
      {
        scope,
        siteId,
        period,
        from,
        to,
        includePdf,
        includeExcel,
      },
      session
    );

    return NextResponse.json({
      success: true,
      backup: {
        backupId: result.backupId,
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
        zipSha256: result.zipSha256,
        manifest: result.manifest,
      },
    });
  } catch (error: any) {
    console.error('Error creating backup:', error);
    let status = 500;
    if (error.message?.includes('Access denied') || error.message?.includes('Unauthorized')) {
      status = 403;
    } else if (error.message?.includes('CONCURRENT_BACKUP_IN_PROGRESS') || error.message?.includes('already in progress')) {
      status = 409;
    }
    return NextResponse.json({ error: error.message || 'Failed to create backup' }, { status });
  }
}
