import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { executeControlledRestore, getBackupFilePathById } from '@/lib/backup';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    // Strict Admin check
    if (session.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: Only Administrators can execute database restorations.' },
        { status: 403 }
      );
    }

    let zipBuffer: Buffer | null = null;
    let confirmationPhrase = '';
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      confirmationPhrase = (formData.get('confirmationPhrase') as string) || '';

      if (!file) {
        return NextResponse.json({ error: 'No backup file provided for restore.' }, { status: 400 });
      }
      const arrayBuf = await file.arrayBuffer();
      zipBuffer = Buffer.from(arrayBuf);
    } else {
      const body = await req.json();
      const { backupId, confirmationPhrase: phrase } = body;
      confirmationPhrase = phrase || '';

      if (!backupId) {
        return NextResponse.json({ error: 'backupId is required.' }, { status: 400 });
      }

      const filePath = await getBackupFilePathById(backupId);
      if (!filePath || !fs.existsSync(filePath)) {
        return NextResponse.json({ error: 'Backup archive not found.' }, { status: 404 });
      }

      zipBuffer = fs.readFileSync(filePath);
    }

    if (confirmationPhrase !== 'RESTORE CONFIRM') {
      return NextResponse.json(
        { error: 'Invalid confirmation phrase. You must enter "RESTORE CONFIRM" to proceed.' },
        { status: 400 }
      );
    }

    const result = await executeControlledRestore(zipBuffer, confirmationPhrase, session);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error executing restore:', error);
    return NextResponse.json({ error: error.message || 'Restore execution failed' }, { status: 500 });
  }
}
