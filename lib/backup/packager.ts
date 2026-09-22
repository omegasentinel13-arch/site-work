import JSZip from 'jszip';
import { calculateBufferSha256, generateChecksumsTxt } from './checksum-service';
import { BackupManifest, ManifestFileEntry } from './types';

export interface PackageFilePayload {
  zipPath: string;
  format: string;
  buffer: Buffer;
}

export interface PackagerResult {
  zipBuffer: Buffer;
  zipSha256: string;
  sizeBytes: number;
  manifest: BackupManifest;
}

function generateReadmeText(manifest: BackupManifest): string {
  return `================================================================================
SITE WORK — ENTERPRISE BACKUP & DISASTER RECOVERY ARCHIVE
================================================================================

Project:          ${manifest.projectName}
Backup ID:        ${manifest.backupId}
Timestamp:        ${manifest.backupTimestamp}
Application Ver:  ${manifest.applicationVersion}
Schema Ver:       ${manifest.schemaVersion}
Scope:            ${manifest.scope}${manifest.siteName ? ` (${manifest.siteName})` : ''}
Period:           ${manifest.periodPreset}
Restorable DB:    ${manifest.restorableAsDatabase ? 'YES (Full Disaster Recovery Database)' : 'NO (Reporting / Scoped Logical Archive)'}
Created By:       ${manifest.createdBy.username} (${manifest.createdBy.role})

--------------------------------------------------------------------------------
ARCHIVE CONTENTS & STRUCTURE
--------------------------------------------------------------------------------
${manifest.files.map((f) => `- ${f.path.padEnd(35)} [${f.format.padEnd(6)}]  ${f.sizeBytes.toLocaleString()} bytes  (SHA-256: ${f.sha256.substring(0, 12)}...)`).join('\n')}

--------------------------------------------------------------------------------
CRITICAL SAFETY & RESTORATION NOTICES
--------------------------------------------------------------------------------
1. DATABASE RESTORATION:
   Only archives with "Restorable DB: YES" can be used for physical database
   restoration via /admin/backup. Scoped or date-filtered archives cannot replace
   the active database and serve as historical reporting records only.

2. INTEGRITY VERIFICATION:
   Verify archive checksums using checksums.sha256 before initiating any restore.
   Command: sha256sum -c checksums.sha256

3. CONFIDENTIALITY:
   This archive contains corporate project records. Handle with appropriate
   access controls. Never upload unencrypted backups to untrusted cloud storage.

================================================================================
AB CONSTRUCTIONS & INTERIORS — Enterprise Engineering Management
================================================================================
`;
}

export async function packageBackupArchive(
  baseManifest: Omit<BackupManifest, 'files'>,
  payloadFiles: PackageFilePayload[]
): Promise<PackagerResult> {
  const zip = new JSZip();
  const manifestFileEntries: ManifestFileEntry[] = [];
  const checksumEntries: Array<{ path: string; sha256: string }> = [];

  // Add payload files
  for (const pf of payloadFiles) {
    // Security assertion: prevent path traversal or secret leakage
    if (pf.zipPath.includes('..') || pf.zipPath.startsWith('/') || pf.zipPath.startsWith('\\')) {
      throw new Error(`Invalid or dangerous zipPath: ${pf.zipPath}`);
    }
    if (pf.zipPath.includes('.env.local') || pf.zipPath.includes('node_modules')) {
      throw new Error(`Security violation: Prohibited file path in backup: ${pf.zipPath}`);
    }

    const fileSha256 = calculateBufferSha256(pf.buffer);
    zip.file(pf.zipPath, pf.buffer);

    manifestFileEntries.push({
      path: pf.zipPath,
      format: pf.format,
      sizeBytes: pf.buffer.length,
      sha256: fileSha256,
    });

    checksumEntries.push({
      path: pf.zipPath,
      sha256: fileSha256,
    });
  }

  // Generate finalized manifest
  const finalizedManifest: BackupManifest = {
    ...baseManifest,
    files: manifestFileEntries,
  };

  const manifestBuffer = Buffer.from(JSON.stringify(finalizedManifest, null, 2), 'utf-8');
  zip.file('manifest.json', manifestBuffer);
  checksumEntries.push({
    path: 'manifest.json',
    sha256: calculateBufferSha256(manifestBuffer),
  });

  // Generate README.txt
  const readmeText = generateReadmeText(finalizedManifest);
  const readmeBuffer = Buffer.from(readmeText, 'utf-8');
  zip.file('README.txt', readmeBuffer);
  checksumEntries.push({
    path: 'README.txt',
    sha256: calculateBufferSha256(readmeBuffer),
  });

  // Generate checksums.sha256
  const checksumsTxt = generateChecksumsTxt(checksumEntries);
  zip.file('checksums.sha256', Buffer.from(checksumsTxt, 'utf-8'));

  // Compress with DEFLATE level 9
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const zipSha256 = calculateBufferSha256(zipBuffer);

  return {
    zipBuffer,
    zipSha256,
    sizeBytes: zipBuffer.length,
    manifest: finalizedManifest,
  };
}
