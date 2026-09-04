import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { getDb } from '@/lib/db';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const db = getDb();

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const entityType = searchParams.get('entityType');

    let query = `
      SELECT a.*, u.username as user_name, s.name as site_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN sites s ON a.site_id = s.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (siteId) {
      query += ` AND a.site_id = ?`;
      params.push(siteId);
    }
    if (entityType) {
      query += ` AND a.entity_type = ?`;
      params.push(entityType);
    }

    query += ` ORDER BY a.created_at DESC LIMIT 200`;

    const logs = db.prepare(query).all(...params);
    return NextResponse.json({ logs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching audit logs';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
