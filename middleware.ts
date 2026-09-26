import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Known non-site top-level path segments
const NON_SITE_PREFIXES = new Set([
  'login',
  'request-access',
  'signup',
  'forgot-password',
  'privacy',
  'terms',
  'api',
  '_next',
  'attendance',
  'finance',
  'reports',
  'setup',
  'admin',
  'account',
  'dashboard',
  'transactions',
  'analytics',
  'sites',
  'favicon.ico',
  'logo.png',
]);

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const currentPath = pathname + search;

  // Skip static files or asset extensions
  if (pathname.includes('.') && !pathname.endsWith('.html')) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-current-path', currentPath);

  // If visiting public auth/legal routes, pass through without rewrite or auth block
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/request-access') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname === '/privacy' ||
    pathname === '/terms'
  ) {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    response.headers.set('x-current-path', currentPath);
    return response;
  }

  const segments = pathname.split('/').filter(Boolean);

  // Check if first segment looks like a candidate site slug
  if (segments.length > 0) {
    const candidateSlug = segments[0];

    if (!NON_SITE_PREFIXES.has(candidateSlug.toLowerCase())) {
      // It is a site-prefixed URL: e.g. /site1, /site1/attendance/monthly, /site-1/transactions
      const subSegments = segments.slice(1);
      const rawSubPath = '/' + subSegments.join('/');

      // Canonical sub-route mapping to internal App Router pages
      let internalSubPath = rawSubPath;
      if (rawSubPath === '' || rawSubPath === '/' || rawSubPath === '/dashboard') {
        internalSubPath = '/';
      } else if (rawSubPath === '/transactions') {
        internalSubPath = '/finance';
      } else if (rawSubPath === '/analytics') {
        internalSubPath = '/reports/role';
      } else if (rawSubPath === '/sites') {
        internalSubPath = '/setup/sites';
      }

      requestHeaders.set('x-site-slug', candidateSlug);
      requestHeaders.set('x-sub-path', internalSubPath);
      requestHeaders.set('x-raw-sub-path', rawSubPath);

      const targetUrl = new URL(internalSubPath + search, request.url);

      const response = NextResponse.rewrite(targetUrl, {
        request: {
          headers: requestHeaders,
        },
      });

      response.headers.set('x-current-path', currentPath);
      response.headers.set('x-site-slug', candidateSlug);
      response.headers.set('x-sub-path', internalSubPath);
      return response;
    }
  }

  // Not site-prefixed (e.g. /attendance/daily, /finance, or /)
  requestHeaders.set('x-site-slug', '');
  requestHeaders.set('x-sub-path', pathname);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('x-current-path', currentPath);
  response.headers.set('x-site-slug', '');
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api routes (/api/*)
     * - Next.js internal static assets (/_next/static/*, /_next/image/*)
     * - Static asset files (favicon.ico, logo.png)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|logo.png).*)',
  ],
};
