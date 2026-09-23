/**
 * Sanitizes and normalizes a redirect path to ensure it is strictly
 * an internal, same-origin relative path.
 *
 * Rules:
 * - Must begin with a single '/'
 * - Must not begin with '//' or '/\' or '\' (protocol-relative / Windows UNC bypass)
 * - Must not contain external protocols (http:, https:, javascript:, data:, etc.)
 * - Safely preserves query parameters and hashes for internal navigation
 * - Returns '/' if the path is invalid, malicious, or empty
 */
export function normalizeSafeRedirectPath(rawPath?: string | null): string {
  if (!rawPath || typeof rawPath !== 'string') {
    return '/';
  }

  const trimmed = rawPath.trim();

  // Must begin with a single '/' and must not begin with '//', '/\', or '\'
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.startsWith('\\')
  ) {
    return '/';
  }

  // Reject URLs containing protocol prefixes (e.g. javascript:, data:, https:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return '/';
  }

  try {
    // Parse against a dummy base origin to validate internal path structure
    const parsed = new URL(trimmed, 'http://localhost');
    if (parsed.origin !== 'http://localhost') {
      return '/';
    }

    const safePath = parsed.pathname + parsed.search + parsed.hash;
    if (
      !safePath.startsWith('/') ||
      safePath.startsWith('//') ||
      safePath.startsWith('/\\')
    ) {
      return '/';
    }

    return safePath;
  } catch {
    return '/';
  }
}
