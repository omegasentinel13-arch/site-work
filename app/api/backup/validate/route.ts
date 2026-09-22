import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { deepValidateBackupArchive, getBackupFilePathById, readManifestFromZip } from '@/lib/backup';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot validate backup archives.' },
        { status: 403 }
      );
    }

    let zipBuffer: Buffer | null = null;
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No backup file provided in upload.' }, { status: 400 });
      }
      const arrayBuf = await file.arrayBuffer();
      zipBuffer = Buffer.from(arrayBuf);
    } else {
      const body = await req.json();
      const { backupId } = body;
      if (!backupId) {
        return NextResponse.json({ error: 'backupId is required.' }, { status: 400 });
      }

      const filePath = await getBackupFilePathById(backupId);
      if (!filePath || !fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Backup archive not found.' }, { status: 404 });
      }

      // Role isolation check
      const manifest = await readManifestFromZip(filePath);
      if (session.role === 'SITE_MANAGER') {
        if (manifest?.scope === 'SYSTEM') {
          return NextResponse.json(
            { error: 'Access denied: You cannot validate system-wide backups.' },
            { status: 403 }
          );
        }
        if (manifest?.siteId && !session.assignedSiteIds.includes(manifest.siteId)) {
          return NextResponse.json(
            { error: 'Access denied: You are not assigned to this project site.' },
            { status: 403 }
          );
        }
      }

      zipBuffer = fs.readFileSync(filePath);
    }

    const validation = await deepValidateBackupArchive(zipBuffer);

    return NextResponse.json({
      isValid: validation.isValid,
      hasBlockingIssues: validation.hasBlockingIssues,
      conflicts: validation.conflicts,
      manifest: validation.manifest,
      dbMetrics: validation.dbMetrics,
      filesCatalog: validation.manifest?.files || [],
    });
  } catch (error: any) {
    console.error('Error validating backup:', error);
    return NextResponse.json({ error: error.message || 'Validation failed' }, { status: 500 });
  }
}
