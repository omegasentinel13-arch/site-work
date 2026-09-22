import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { createRestorePlan, getBackupFilePathById } from '@/lib/backup';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    // Only Administrators can simulate/plan database restoration
    if (session.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: Only Administrators can simulate database restoration.' },
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

      zipBuffer = fs.readFileSync(filePath);
    }

    const plan = await createRestorePlan(zipBuffer);

    return NextResponse.json({ plan });
  } catch (error: any) {
    console.error('Error simulating restore:', error);
    return NextResponse.json({ error: error.message || 'Restore simulation failed' }, { status: 500 });
  }
}
