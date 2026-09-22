import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { getGlobalArchivedItems } from '@/lib/db/repositories/global-lifecycle-repo';

export async function GET(req: Request) {
  const session = await getSession();
  const access = canAccess({
    session,
    page: 'PAGE_GLOBAL_ARCHIVE',
    action: 'VIEW',
  });
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType') || undefined;
    const search = searchParams.get('search') || undefined;

    const items = getGlobalArchivedItems(entityType, search);
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching archived items';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
