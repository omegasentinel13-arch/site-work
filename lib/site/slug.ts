import { SiteRecord } from '@/lib/db/repositories/site-repo';
import { UserSession } from '@/lib/auth/session';

/**
 * Computes a unique canonical slug for each site.
 * Rule:
 * 1. If site.id matches `site-(\d+)`, canonical slug is `site${num}` (e.g. `site-1` -> `site1`, `site-2` -> `site2`).
 * 2. If code exists and is unique across active sites: slug is code in lowercase alphanumeric (e.g. `S-03A` -> `s03a`).
 * 3. Otherwise, derived from id: e.g. `site` + id suffix.
 */
export function getCanonicalSiteSlug(site: SiteRecord, allSites: SiteRecord[] = []): string {
  const numMatch = site.id.match(/^site-(\d+)$/i);
  if (numMatch) {
    return `site${numMatch[1]}`;
  }

  // If code exists, check if code-based slug is unique among allSites
  if (site.code) {
    const codeSlug = site.code.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (codeSlug.length > 0) {
      const conflictingSites = allSites.filter(
        (s) => s.id !== site.id && s.code && s.code.toLowerCase().replace(/[^a-z0-9]/g, '') === codeSlug
      );
      if (conflictingSites.length === 0) {
        return codeSlug;
      }
    }
  }

  // Fallback for UUID or non-standard IDs: use site + first 8 alphanumeric chars of ID
  const cleanId = site.id.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanId.startsWith('site') ? cleanId.slice(0, 12) : `site${cleanId.slice(0, 8)}`;
}

/**
 * Resolves a URL slug to a site and determines if the requested slug is canonical.
 * Handles:
 * - Exact canonical slug match (e.g. `site1`) -> isCanonical: true
 * - Aliases: `site-1`, `s-01`, `s01`, `S-01`, raw site id, etc. -> isCanonical: false, returns canonicalSlug for 307 redirect
 */
export function resolveSiteBySlug(
  rawSlug: string,
  sites: SiteRecord[]
): { site: SiteRecord | null; isCanonical: boolean; canonicalSlug: string | null } {
  if (!rawSlug || !sites || sites.length === 0) {
    return { site: null, isCanonical: false, canonicalSlug: null };
  }

  const slug = rawSlug.trim().toLowerCase();

  // First pass: check for exact canonical match
  for (const site of sites) {
    const canonical = getCanonicalSiteSlug(site, sites);
    if (canonical.toLowerCase() === slug) {
      return { site, isCanonical: true, canonicalSlug: canonical };
    }
  }

  // Second pass: check for alias matches
  for (const site of sites) {
    const canonical = getCanonicalSiteSlug(site, sites);

    // Alias 1: exact site ID (e.g. `site-1`, `site-2`, UUID)
    if (site.id.toLowerCase() === slug) {
      return { site, isCanonical: false, canonicalSlug: canonical };
    }

    // Alias 2: site ID without hyphens
    if (site.id.toLowerCase().replace(/-/g, '') === slug) {
      return { site, isCanonical: false, canonicalSlug: canonical };
    }

    // Alias 3: site code with or without punctuation (e.g. `s-01`, `s01`)
    if (site.code) {
      const codeRaw = site.code.toLowerCase();
      const codeClean = codeRaw.replace(/[^a-z0-9]/g, '');
      if (codeRaw === slug || codeClean === slug) {
        return { site, isCanonical: false, canonicalSlug: canonical };
      }
    }

    // Alias 4: site name slugified
    const nameClean = site.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nameClean.length > 0 && nameClean === slug) {
      return { site, isCanonical: false, canonicalSlug: canonical };
    }

    // Alias 5: `site-` + number if canonical is `site` + number
    const numMatch = canonical.match(/^site(\d+)$/i);
    if (numMatch && slug === `site-${numMatch[1]}`) {
      return { site, isCanonical: false, canonicalSlug: canonical };
    }
  }

  return { site: null, isCanonical: false, canonicalSlug: null };
}

/**
 * Returns a deterministic fallback site for the user if the requested site is unauthorized or unavailable.
 * Admins have access to all sites; other roles are constrained to assignedSiteIds.
 */
export function getDeterministicFallbackSite(
  session: UserSession,
  sites: SiteRecord[],
  preferredSiteId?: string | null
): SiteRecord | null {
  if (!sites || sites.length === 0) {
    return null;
  }

  // Filter accessible sites
  let allowedSites = sites;
  if (session.role !== 'ADMIN') {
    allowedSites = sites.filter((s) => session.assignedSiteIds.includes(s.id));
  }

  if (allowedSites.length === 0) {
    return null;
  }

  // Prefer active (non-archived) sites if available
  const activeAllowed = allowedSites.filter((s) => s.is_archived === 0);
  const candidatePool = activeAllowed.length > 0 ? activeAllowed : allowedSites;

  // Check preferredSiteId if valid and allowed
  if (preferredSiteId) {
    const preferred = candidatePool.find((s) => s.id === preferredSiteId);
    if (preferred) {
      return preferred;
    }
  }

  // Sort deterministically: Site 1 / site-1 first, then name ascending, then id ascending
  const sorted = [...candidatePool].sort((a, b) => {
    if (a.id === 'site-1') return -1;
    if (b.id === 'site-1') return 1;
    if (a.id === 'site-2') return -1;
    if (b.id === 'site-2') return 1;
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });

  return sorted[0] || null;
}
