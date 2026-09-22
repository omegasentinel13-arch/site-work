import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads', 'finance');

/**
 * Ensures the protected uploads directory exists.
 */
export function ensureUploadsDir(): string {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  return UPLOADS_DIR;
}

/**
 * Validates magic bytes for JPEG, PNG, and WebP images.
 */
export function validateMagicBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }

  // WebP: 'RIFF' at 0..3 and 'WEBP' at 8..11
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff === 'RIFF' && webp === 'WEBP') {
    return true;
  }

  return false;
}

/**
 * Validates attachment buffer, size, MIME type, extension, and magic bytes.
 */
export function validateAttachment(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): { valid: boolean; error?: string; extension?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file payload' };
  }

  if (buffer.length > MAX_ATTACHMENT_SIZE) {
    return { valid: false, error: 'File size exceeds maximum 5MB limit' };
  }

  // Sanitize and validate extension
  const cleanName = path.basename(originalFilename || '').toLowerCase();
  const ext = path.extname(cleanName);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Invalid file extension (${ext || 'none'}). Only JPEG, PNG, and WebP are allowed.`,
    };
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return {
      valid: false,
      error: `Invalid MIME type (${mimeType}). Only image/jpeg, image/png, and image/webp are allowed.`,
    };
  }

  // Validate file signature / magic bytes
  if (!validateMagicBytes(buffer)) {
    return {
      valid: false,
      error: 'File contents do not match valid image signature (MIME spoofing detected).',
    };
  }

  // Normalize extension
  const normalizedExt = ext === '.jpeg' ? '.jpg' : ext;
  return { valid: true, extension: normalizedExt };
}

/**
 * Saves validated buffer to protected storage with a random UUID filename.
 */
export function saveAttachmentBuffer(buffer: Buffer, extension: string): string {
  const dir = ensureUploadsDir();
  const filename = `${crypto.randomUUID()}${extension}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filename;
}

/**
 * Resolves safe absolute path for a filename, preventing directory traversal.
 */
export function getSafeAttachmentPath(filename: string): string | null {
  const clean = path.basename(filename);
  if (clean !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }

  const fullPath = path.join(UPLOADS_DIR, clean);
  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fullPath;
}

/**
 * Safely removes an attachment file if it exists.
 */
export function removeAttachmentFile(filename: string): void {
  const clean = path.basename(filename);
  const fullPath = path.join(UPLOADS_DIR, clean);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {}
  }
}
