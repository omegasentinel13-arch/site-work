import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { getBackupFilePathById } from '@/lib/backup';
import { analyzeBackupPackage, executeLogicalRecovery, AnalysisReport } from '@/lib/backup/import';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    // STRICT ROLE REQUIREMENT: Recovery execution is ADMIN only
    if (session.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: Only Administrators can execute database recovery operations.' },
        { status: 403 }
      );
    }

    let report: AnalysisReport | null = null;
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No backup file provided.' }, { status: 400 });
      }
      const arrayBuf = await file.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuf);
      report = await analyzeBackupPackage(zipBuffer);
    } else {
      const body = await req.json();
      if (body.report) {
        report = body.report;
      } else if (body.backupId) {
        const filePath = await getBackupFilePathById(body.backupId);
        if (!filePath || !fs.existsSync(filePath)) {
          return NextResponse.json({ error: 'Backup archive not found.' }, { status: 404 });
        }
        const zipBuffer = fs.readFileSync(filePath);
        report = await analyzeBackupPackage(zipBuffer);
      }
    }

    if (!report) {
      return NextResponse.json({ error: 'Analysis report or valid backupId is required.' }, { status: 400 });
    }

    if (report.isTampered) {
      return NextResponse.json(
        { error: 'Cannot execute recovery: Package failed cryptographic checksum validation.' },
        { status: 400 }
      );
    }

    const result = await executeLogicalRecovery(report, {
      actor: {
        userId: session.userId,
        username: session.username,
        role: session.role,
      },
    });

    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('Error executing logical recovery:', error);
    return NextResponse.json({ error: error.message || 'Logical recovery execution failed' }, { status: 500 });
  }
}
