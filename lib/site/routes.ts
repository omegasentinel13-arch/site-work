/**
 * Route Classification Engine for Site-Scoped Navigation & Fallback Policies.
 *
 * Policies:
 * - Category A (Operational Routes):
 *   Paths: /attendance/*, /finance, /transactions, /reports/*, /analytics
 *   Fallback Policy: Preserve the sub-path and query parameters under the authorized site.
 *   (e.g., /site1/attendance/monthly?date=... -> /site2/attendance/monthly?date=...)
 *
 * - Category B (Administrative / Site-Management Routes):
 *   Paths: /setup/*, /admin/*, /account, /sites
 *   Fallback Policy: DO NOT preserve the administrative sub-page. Redirect to the authorized site's
 *   DASHBOARD (e.g., /site1/setup/sites -> /site2). Administrative data/views are never rendered.
 */

export type RouteCategory = 'OPERATIONAL' | 'ADMINISTRATIVE' | 'DASHBOARD';

export function classifyRoute(subPath: string): RouteCategory {
  if (!subPath || subPath === '/' || subPath === '/dashboard') {
    return 'DASHBOARD';
  }

  const cleanPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
  const normalized = cleanPath.split('?')[0].toLowerCase();

  // Category A: Operational Routes
  if (
    normalized.startsWith('/attendance') ||
    normalized === '/finance' ||
    normalized.startsWith('/finance/') ||
    normalized === '/transactions' ||
    normalized.startsWith('/transactions/') ||
    normalized.startsWith('/reports') ||
    normalized === '/analytics' ||
    normalized.startsWith('/analytics/')
  ) {
    return 'OPERATIONAL';
  }

  // Category B: Administrative & Setup Routes
  if (
    normalized.startsWith('/setup') ||
    normalized.startsWith('/admin') ||
    normalized === '/account' ||
    normalized.startsWith('/account/') ||
    normalized === '/sites' ||
    normalized.startsWith('/sites/')
  ) {
    return 'ADMINISTRATIVE';
  }

  return 'DASHBOARD';
}

export function isOperationalRoute(subPath: string): boolean {
  return classifyRoute(subPath) === 'OPERATIONAL';
}

export function isAdministrativeRoute(subPath: string): boolean {
  return classifyRoute(subPath) === 'ADMINISTRATIVE';
}
