import type { SiteRecord } from '@/lib/db/repositories/site-repo';
import type { UserSession } from '@/lib/auth/session';
import type { Site, User } from '@/context/site-context';

/**
 * Safely serializes a server-side SQLite SiteRecord into a plain JSON object literal
 * conforming to React Server Component (RSC) boundary rules (Object.prototype).
 *
 * Rules:
 * - Must return a brand new object literal (Object.prototype).
 * - Must never pass raw null-prototype rows from node:sqlite.
 * - Preserves all required fields: id, name, code, location, is_archived, routing_mode, canonical_slug.
 * - For nullable fields, uses `val == null ? null : String(val)` to avoid converting empty strings to null.
 */
export function serializeSiteForClient(site: SiteRecord): Site {
  return {
    id: String(site.id),
    name: String(site.name),
    code: site.code == null ? null : String(site.code),
    location: site.location == null ? null : String(site.location),
    is_archived: Number(site.is_archived),
    routing_mode: site.routing_mode == null ? 'NAME' : (String(site.routing_mode) as 'NAME' | 'CODE'),
    canonical_slug: site.canonical_slug == null ? null : String(site.canonical_slug),
  };
}

/**
 * Safely serializes a server-side UserSession into a plain JSON object literal
 * conforming to React Server Component (RSC) boundary rules.
 */
export function serializeUserForClient(session: UserSession): User {
  return {
    id: String(session.userId),
    username: String(session.username),
    fullName: String(session.fullName),
    role: session.role,
    authorityTier: session.authorityTier == null ? undefined : String(session.authorityTier),
    assignedSiteIds: Array.isArray(session.assignedSiteIds)
      ? session.assignedSiteIds.map(String)
      : [],
  };
}
