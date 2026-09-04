const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Sanitizes a filename for HTTP Content-Disposition attachment.
 * Defends against CRLF, directory traversal, Windows reserved names,
 * and dangerous punctuation.
 */
export function sanitizeReportFilename(rawBase: string, suffix: string, ext = 'pdf'): string {
  // 1. Normalize Unicode to NFKC and strip ASCII control characters and CRLF
  let clean = (rawBase || '')
    .normalize('NFKC')
    .replace(/[\r\n\x00-\x1f\x7f]/g, '');

  // 2. Strip path traversal sequences and filesystem dangerous characters
  clean = clean.replace(/[\\/:*?"<>|;,%]/g, '_');

  // 3. Normalize whitespace to underscores and collapse consecutive underscores
  clean = clean.replace(/[\s_]+/g, '_').trim();

  // 4. Strip leading and trailing dots or underscores
  clean = clean.replace(/^[\._]+|[\._]+$/g, '');

  // 5. Clean suffix similarly
  const cleanSuffix = (suffix || '')
    .normalize('NFKC')
    .replace(/[\r\n\x00-\x1f\x7f\\/:*?"<>|;,%]/g, '_')
    .replace(/[\s_]+/g, '_')
    .replace(/^[\._]+|[\._]+$/g, '');

  // 6. Combine base and suffix with length limitation (80 chars max before extension)
  let combined = cleanSuffix ? `${clean}_${cleanSuffix}` : clean;
  if (combined.length > 80) {
    combined = combined.substring(0, 80).replace(/[\._]+$/, '');
  }

  // 7. Test for empty string or Windows reserved device names
  if (!combined || WINDOWS_RESERVED_NAMES.test(combined)) {
    combined = 'site_work_report';
  }

  return `${combined}.${ext}`;
}

/**
 * Constructs an RFC 5987 / RFC 6266 compliant Content-Disposition header.
 * Uses ASCII fallback in filename="..." and percent-encoded UTF-8 in filename*=UTF-8''...
 */
export function buildContentDispositionHeader(filename: string): string {
  // Ensure no CRLF can ever leak into header value
  const stripped = filename.replace(/[\r\n]/g, '');
  const asciiFallback = stripped.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const utf8Encoded = encodeURIComponent(stripped);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}
