import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { getSession } from '@/lib/auth/session';
import { classifyPackage } from '@/lib/packages/classifier';
import { PackageAction } from '@/lib/packages/types';
import { getBackupFilePathById, readManifestFromZip } from '@/lib/backup/storage-registry';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB Maximum Upload Boundary

export async function POST(req: Request) {
  try {
    // 1. Authenticate user session
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot inspect packages.' },
        { status: 403 }
      );
    }

    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload Too Large: Package archive exceeds maximum 100 MB limit.' },
        { status: 413 }
      );
    }

    let zipBuffer: Buffer;
    let fileNameHint: string | undefined = undefined;

    const contentType = req.headers.get('content-type') || '';

    // Branch A: Multipart File Upload
    if (contentType.includes('multipart/form-data')) {
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch (err: any) {
        return NextResponse.json(
          { error: 'Malformed multipart form data: ' + (err.message || 'Invalid upload') },
          { status: 400 }
        );
      }

      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json(
          { error: 'No package file provided in upload. Expected form field "file".' },
          { status: 400 }
        );
      }

      fileNameHint = file.name;

      // Validate 100 MB size limit
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: 'Payload Too Large: Package archive exceeds maximum 100 MB limit.' },
          { status: 413 }
        );
      }

      // Validate ZIP extension
      if (file.name && !file.name.toLowerCase().endsWith('.zip')) {
        return NextResponse.json(
          { error: 'Unsupported Media Type: Package must be a .zip archive.' },
          { status: 415 }
        );
      }

      const arrayBuf = await file.arrayBuffer();
      zipBuffer = Buffer.from(arrayBuf);

      // Validate ZIP magic bytes (0x50 0x4B)
      if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
        return NextResponse.json(
          { error: 'Unsupported Media Type: File is not a valid ZIP archive.' },
          { status: 415 }
        );
      }
    } else {
      // Branch B: Stored backup reference via JSON body
      let body: any;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
      }

      const { backupId } = body || {};
      if (!backupId || typeof backupId !== 'string' || !backupId.trim()) {
        return NextResponse.json(
          { error: 'backupId is required when not uploading a file.' },
          { status: 400 }
        );
      }

      const cleanBackupId = backupId.trim();

      // Traversal / Format check on backupId: letters, digits, dash, underscore only
      if (!/^[a-zA-Z0-9_-]+$/.test(cleanBackupId)) {
        return NextResponse.json(
          { error: 'Invalid backupId format. Path traversal characters are prohibited.' },
          { status: 400 }
        );
      }

      // Resolve strictly through storage registry (never arbitrary path)
      const filePath = await getBackupFilePathById(cleanBackupId);
      if (!filePath || !fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: `Backup archive not found: ${cleanBackupId}` },
          { status: 404 }
        );
      }

      // Stored archive ACL validation
      const storedManifest = await readManifestFromZip(filePath);
      if (storedManifest) {
        if (session.role === 'SITE_MANAGER') {
          if (storedManifest.scope === 'SYSTEM') {
            return NextResponse.json(
              { error: 'Access denied: Site Managers are not authorized to inspect system recovery backups.' },
              { status: 403 }
            );
          }
          if (storedManifest.siteId && !session.assignedSiteIds.includes(storedManifest.siteId)) {
            return NextResponse.json(
              { error: 'Access denied: You are not assigned to this project site.' },
              { status: 403 }
            );
          }
        }
      }

      zipBuffer = fs.readFileSync(filePath);
      fileNameHint = cleanBackupId;
    }

    // 2. Classify package using the verified content-based classifier
    const inspectionResult = await classifyPackage(zipBuffer, fileNameHint);

    // 3. Post-Classification RBAC Boundary Enforcement
    if (session.role === 'SITE_MANAGER') {
      // Diagnostic inspection of corrupt or unrecognized packages (isValid === false)
      // returns 200 OK without evaluating site/system ownership rules.
      if (inspectionResult.isValid) {
        // Rule 1: SITE_MANAGER must never inspect SYSTEM_RECOVERY_BACKUP
        if (inspectionResult.classification === 'SYSTEM_RECOVERY_BACKUP') {
          return NextResponse.json(
            { error: 'Access denied: Site Managers are not authorized to inspect system recovery packages.' },
            { status: 403 }
          );
        }

        // Rule 2: SYSTEM report export forbidden for SITE_MANAGER
        if (inspectionResult.classification === 'REPORT_EXPORT' && inspectionResult.scope === 'SYSTEM') {
          return NextResponse.json(
            { error: 'Access denied: Site Managers can only inspect site-scoped report exports.' },
            { status: 403 }
          );
        }

        // Rule 3: Site ownership validation for valid SITE packages
        if (inspectionResult.scope === 'SITE') {
          if (!inspectionResult.siteId || !session.assignedSiteIds.includes(inspectionResult.siteId)) {
            return NextResponse.json(
              { error: 'Access denied: You are not assigned to this project site.' },
              { status: 403 }
            );
          }
        }
      }
    }

    // 4. Action Filtering by RBAC Role
    const filteredActions: PackageAction[] = [];
    for (const action of inspectionResult.availableActions) {
      if (session.role === 'ADMIN') {
        filteredActions.push(action);
      } else if (session.role === 'SITE_MANAGER') {
        // Site Managers never receive database restore actions
        if (action !== 'SIMULATE_DATABASE_RESTORE' && action !== 'EXECUTE_DATABASE_RESTORE') {
          filteredActions.push(action);
        }
      }
    }

    const finalResult = {
      ...inspectionResult,
      availableActions: filteredActions,
    };

    return NextResponse.json(finalResult, { status: 200 });
  } catch (error: any) {
    console.error('Error in package inspection API:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred during package inspection.' },
      { status: 500 }
    );
  }
}
