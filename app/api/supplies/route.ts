import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, UnauthorizedError, ForbiddenError } from '@/lib/auth/permissions';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { getActiveSuppliesForSite, recordSupplyUsage } from '@/lib/db/repositories/supply-repo';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to view supplies.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'READ');

    const site = getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const supplies = getActiveSuppliesForSite(siteId);
    return NextResponse.json({ supplies });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : 'Error fetching supplies';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to record supply.' }, { status: 401 });
    }

    let body: { siteId?: string; name?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const { siteId, name } = body;
    if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Supply name is required.' }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return NextResponse.json({ error: 'Supply name cannot exceed 200 characters.' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'WRITE');

    const site = getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const item = recordSupplyUsage(siteId, trimmedName);
    return NextResponse.json({ success: true, item });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : 'Error recording supply';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
