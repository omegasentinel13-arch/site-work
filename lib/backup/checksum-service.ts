import crypto from 'node:crypto';
import fs from 'node:fs';

export function calculateBufferSha256(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function calculateFileSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return calculateBufferSha256(buffer);
}

export function verifyBufferSha256(buffer: Buffer | Uint8Array, expectedSha256: string): boolean {
  const actual = calculateBufferSha256(buffer);
  return actual.toLowerCase() === expectedSha256.toLowerCase();
}

export function verifyFileSha256(filePath: string, expectedSha256: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const actual = calculateFileSha256(filePath);
  return actual.toLowerCase() === expectedSha256.toLowerCase();
}

export function generateChecksumsTxt(files: Array<{ path: string; sha256: string }>): string {
  return files
    .map((f) => `${f.sha256}  ${f.path}`)
    .join('\n') + '\n';
}

export function parseChecksumsTxt(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const sha256 = parts[0];
      const filePath = parts.slice(1).join(' ').replace(/^[*]/, '');
      map.set(filePath, sha256);
    }
  }
  return map;
}

export const parseChecksumsFile = parseChecksumsTxt;
