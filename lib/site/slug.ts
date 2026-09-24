import type { SiteRecord } from '@/lib/db/repositories/site-repo';
import type { UserSession } from '@/lib/auth/session';

/**
 * Generates a Mode A (Name-based) canonical slug.
 * - 'Site 1' -> 'site1'
 * - 'Site 2' -> 'site2'
 * - 'SIVASAKTHI SITE' -> 'sivasakthi-site'
 * - 'Villa Project Phase 1 (Updated)' -> 'villa-project-phase-1-updated'
 */
export function generateNameSlug(name: string): string {
  if (!name) return 'site';
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === 'site 1') return 'site1';
  if (trimmed.toLowerCase() === 'site 2') return 'site2';

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'site';
}

/**
 * Generates a Mode B (Code-based) canonical slug.
 * - 'S-01' -> 's01'
 * - 'S-07' -> 's07'
 */
export function generateCodeSlug(code: string): string {
  if (!code) return 'site';
  const clean = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean || 'site';
}

/**
 * Computes the unique canonical slug for a site.
 * Prioritizes persistent site.canonical_slug.
 * Otherwise deterministically derives from routing_mode (NAME vs CODE).
 */
export function getCanonicalSiteSlug(site: SiteRecord, allSites: SiteRecord[] = []): string {
  if (site.canonical_slug) {
    return site.canonical_slug;
  }

  // Identity preservation for default sites
  if (site.id === 'site-1' || site.name.trim().toLowerCase() === 'site 1') {
    return 'site1';
  }
  if (site.id === 'site-2' || site.name.trim().toLowerCase() === 'site 2') {
    return 'site2';
  }

  // Derive based on routing mode
  let baseSlug = '';
  if (site.routing_mode === 'CODE' && site.code) {
    baseSlug = generateCodeSlug(site.code);
  } else {
    baseSlug = generateNameSlug(site.name);
  }

  // Collision avoidance against other sites
  const otherSites = allSites.filter((s) => s.id !== site.id);
  const otherSlugs = new Set(
    otherSites.map((s) => (s.canonical_slug ? s.canonical_slug.toLowerCase() : ''))
  );

  let finalSlug = baseSlug;
  let counter = 2;
  while (otherSlugs.has(finalSlug.toLowerCase())) {
    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  return finalSlug;
}

/**
 * Resolves a URL slug to a site and determines if the requested slug is canonical.
 * Handles:
 * - Exact canonical slug match (e.g. `site1`, `sivasakthi-site`) -> isCanonical: true
 * - Aliases: `site-1`, `s-01`, `s01`, `S-01`, raw site id, etc. -> isCanonical: false, returns canonicalSlug for 307 redirect
 * - Historical aliases via optional historicalFinder -> isCanonical: false, returns canonicalSlug for 307 redirect
 *
 * NOTE: Canonical resolution always takes precedence over historical alias resolution.
 */
export function resolveSiteBySlug(
  rawSlug: string,
  sites: SiteRecord[],
  historicalFinder?: (slug: string) => SiteRecord | null
): { site: SiteRecord | null; isCanonical: boolean; canonicalSlug: string | null } {
  if (!rawSlug || !sites || sites.length === 0) {
    return { site: null, isCanonical: false, canonicalSlug: null };
  }

  const slug = rawSlug.trim().toLowerCase();

  // First pass: check for exact canonical match (Always takes precedence)
  for (const site of sites) {
    const canonical = getCanonicalSiteSlug(site, sites);
    if (canonical.toLowerCase() === slug) {
      return { site, isCanonical: true, canonicalSlug: canonical };
    }
  }

  // Second pass: check for in-memory alias matches (ID, code, slugified name)
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

  // Third pass: check historical aliases via server-provided finder if available
  if (historicalFinder) {
    try {
      const historicalSite = historicalFinder(slug);
      if (historicalSite) {
        const canonical = getCanonicalSiteSlug(historicalSite, sites);
        return { site: historicalSite, isCanonical: false, canonicalSlug: canonical };
      }
    } catch {
      // Historical lookup failure fails safely
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
