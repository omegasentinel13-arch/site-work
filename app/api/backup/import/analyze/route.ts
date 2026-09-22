import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { getBackupFilePathById } from '@/lib/backup';
import { analyzeBackupPackage } from '@/lib/backup/import';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot import backup packages.' },
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
        return NextResponse.json({ error: 'backupId or uploaded file is required.' }, { status: 400 });
      }

      const filePath = await getBackupFilePathById(backupId);
      if (!filePath || !fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Backup archive not found.' }, { status: 404 });
      }

      zipBuffer = fs.readFileSync(filePath);
    }

    const report = await analyzeBackupPackage(zipBuffer);

    return NextResponse.json({ report });
  } catch (error: any) {
    console.error('Error analyzing backup package:', error);
    return NextResponse.json({ error: error.message || 'Backup package analysis failed' }, { status: 500 });
  }
}
