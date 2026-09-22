import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, UnauthorizedError, ForbiddenError } from '@/lib/auth/permissions';
import { getDb } from '@/lib/db';
import { getSafeAttachmentPath } from '@/lib/finance/attachment';
import fs from 'fs';
import path from 'path';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(
  req: Request,
  { params }: { params: { filename: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to view attachments.' }, { status: 401 });
    }

    const { filename } = params;
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    // Strict path traversal prevention
    const safePath = getSafeAttachmentPath(filename);
    if (!safePath) {
      return NextResponse.json({ error: 'Attachment not found or invalid filename' }, { status: 404 });
    }

    // Resolve site ownership from database
    const db = getDb();
    const row = db.prepare(`
      SELECT site_id 
      FROM financial_transactions 
      WHERE attachment_url LIKE '%' || ?
      LIMIT 1
    `).get(filename) as { site_id: string } | undefined;

    if (!row) {
      return NextResponse.json({ error: 'Attachment record not found' }, { status: 404 });
    }

    // Enforce site READ authorization
    validateSiteAccess(session, row.site_id, 'READ');

    // Read and stream file
    const fileBuffer = fs.readFileSync(safePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : 'Error serving attachment';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
