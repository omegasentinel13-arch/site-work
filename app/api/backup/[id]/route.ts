import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getSession } from '@/lib/auth/session';
import { getBackupFilePathById, readManifestFromZip, deleteBackupFromStorage } from '@/lib/backup';
import { logAudit } from '@/lib/audit/logger';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot download backup archives.' },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    const filePath = await getBackupFilePathById(id);

    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Backup archive not found.' }, { status: 404 });
    }

    const manifest = await readManifestFromZip(filePath);
    if (!manifest) {
      return NextResponse.json({ error: 'Corrupt backup: missing manifest.' }, { status: 500 });
    }

    // Role-based Access Control Check
    if (session.role === 'SITE_MANAGER') {
      if (manifest.scope === 'SYSTEM') {
        return NextResponse.json(
          { error: 'Access denied: System-wide backups can only be downloaded by Administrators.' },
          { status: 403 }
        );
      }
      if (manifest.siteId && !session.assignedSiteIds.includes(manifest.siteId)) {
        return NextResponse.json(
          { error: 'Access denied: You are not assigned to this project site.' },
          { status: 403 }
        );
      }
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error: any) {
    console.error('Error downloading backup:', error);
    return NextResponse.json({ error: error.message || 'Failed to download backup' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: Only Administrators can delete backup archives.' },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    const filePath = await getBackupFilePathById(id);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Backup not found.' }, { status: 404 });
    }

    const fileName = path.basename(filePath);
    if (fileName.startsWith('pre-restore-safety_') || id.startsWith('pre-restore-safety_') || id.startsWith('safety-')) {
      return NextResponse.json(
        { error: 'Recovery safety snapshots are protected from deletion to preserve system recovery continuity.' },
        { status: 403 }
      );
    }

    const manifest = await readManifestFromZip(filePath);
    if (manifest?.backupId?.startsWith('safety-') || (manifest as any)?.isPreRestoreBackup) {
      return NextResponse.json(
        { error: 'Recovery safety snapshots are protected from deletion to preserve system recovery continuity.' },
        { status: 403 }
      );
    }

    const deleted = await deleteBackupFromStorage(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Backup not found or could not be deleted.' }, { status: 404 });
    }

    try {
      logAudit({
        entityType: 'SECURITY',
        entityId: id,
        action: 'DELETE',
        siteId: null,
        userId: session.userId,
        beforeState: { backupId: id },
        afterState: { deleted: true },
      });
    } catch {}

    return NextResponse.json({ success: true, message: 'Backup deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting backup:', error);
    if (error.message?.includes('PROTECTED_SAFETY_SNAPSHOT')) {
      return NextResponse.json(
        { error: 'Recovery safety snapshots are protected from deletion to preserve system recovery continuity.' },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message || 'Failed to delete backup' }, { status: 500 });
  }
}
