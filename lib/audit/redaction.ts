/**
 * Centralized Audit Redaction & Sanitization Engine
 * 
 * Provides centralized defense-in-depth sanitization for all audit payloads,
 * metadata, and actor identities before serialization across API boundaries.
 */

export interface RedactionContext {
  isSuperiorPrimeCaller: boolean;
  superiorPrimeIdentifiers?: Set<string>; // Set of usernames, user IDs, and emails of Superior Prime accounts
}

const REDACTED_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'passwordplaintext',
  'password_hash',
  'passwordhash',
  'token',
  'token_hash',
  'tokenhash',
  'refreshtoken',
  'recoverytoken',
  'recovery_token',
  'recoverycode',
  'recovery_code',
  'otp',
  'otp_code',
  'secret',
  'session_secret',
  'session_token',
  'sessiontoken',
  'access_token',
  'accesstoken',
  'auth_token',
  'authtoken',
  'secret_key',
  'secret_token',
  'client_secret',
  'credential',
  'credentials',
  'cookie',
  'cookies',
  'authorization',
  'auth_header',
  'apikey',
  'api_key',
  'private_key',
  'jwt',
  'database_path',
  'db_path',
  'filepath',
  'file_path',
  'full_path'
]);

// Pattern to catch JWT-like strings
const JWT_PATTERN = /^eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;

// Pattern to catch bcrypt hashes
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// Pattern to catch local filesystem paths
const FS_PATH_PATTERN = /(?:[a-zA-Z]:[\\/][^<>"|?*\n\r\s]+|\/(?:Users|home|root|var|etc|tmp)\/[^<>"|?*\n\r\s]+)/gi;

/**
 * Sanitizes a single primitive value.
 */
function sanitizePrimitive(
  val: unknown,
  context?: RedactionContext
): unknown {
  if (typeof val === 'string') {
    // 0. Check if string is a nested JSON string (object or array)
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        const redacted = redactPayload(parsed, context);
        return JSON.stringify(redacted);
      } catch {
        // not valid JSON, continue with normal primitive sanitization
      }
    }

    // 1. Check for bcrypt hash
    if (BCRYPT_PATTERN.test(val)) {
      return '[REDACTED]';
    }

    // 2. Check for JWT tokens
    if (JWT_PATTERN.test(val)) {
      return '[REDACTED]';
    }

    let sanitized = val;

    // 3. Scrub absolute filesystem paths
    if (FS_PATH_PATTERN.test(sanitized)) {
      sanitized = sanitized.replace(FS_PATH_PATTERN, '[REDACTED_PATH]');
    }

    // 4. Scrub Superior Prime identifiers for lower authorities
    if (context && !context.isSuperiorPrimeCaller && context.superiorPrimeIdentifiers && context.superiorPrimeIdentifiers.size > 0) {
      for (const spIdent of context.superiorPrimeIdentifiers) {
        if (!spIdent || spIdent.length < 3) continue;
        const regex = new RegExp(`\\b${escapeRegExp(spIdent)}\\b`, 'gi');
        if (regex.test(sanitized)) {
          sanitized = sanitized.replace(regex, '[REDACTED]');
        }
      }
    }

    return sanitized;
  }

  return val;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively redacts sensitive keys and values from an object or array.
 */
export function redactPayload(
  data: unknown,
  context?: RedactionContext
): unknown {
  if (data === null || data === undefined) {
    return null;
  }

  // Handle primitives
  if (typeof data !== 'object') {
    return sanitizePrimitive(data, context);
  }

  // Handle Arrays
  if (Array.isArray(data)) {
    return data.map((item) => redactPayload(item, context));
  }

  // Handle Objects
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '');

    // Check if key is inherently sensitive
    let isSensitiveKey = false;
    for (const secretKey of REDACTED_KEYS) {
      const normalizedSecret = secretKey.replace(/[-_]/g, '');
      if (lowerKey === normalizedSecret || lowerKey.includes(normalizedSecret)) {
        isSensitiveKey = true;
        break;
      }
    }

    if (isSensitiveKey) {
      result[key] = '[REDACTED]';
      continue;
    }

    // If caller is lower authority, check if key itself is a Superior Prime identifier
    if (context && !context.isSuperiorPrimeCaller && context.superiorPrimeIdentifiers) {
      let isSpKey = false;
      for (const spIdent of context.superiorPrimeIdentifiers) {
        if (spIdent && key.toLowerCase() === spIdent.toLowerCase()) {
          isSpKey = true;
          break;
        }
      }
      if (isSpKey) {
        result[key] = '[REDACTED]';
        continue;
      }
    }

    if (val !== null && typeof val === 'object') {
      result[key] = redactPayload(val, context);
    } else {
      result[key] = sanitizePrimitive(val, context);
    }
  }

  return result;
}

/**
 * Safely parses and redacts JSON strings or objects.
 */
export function safeParseAndRedact(
  jsonString: string | null | undefined,
  context?: RedactionContext
): Record<string, unknown> | null {
  if (!jsonString) return null;
  try {
    const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    return redactPayload(parsed, context) as Record<string, unknown>;
  } catch {
    // If not valid JSON, treat as string
    return { raw: sanitizePrimitive(jsonString, context) };
  }
}
