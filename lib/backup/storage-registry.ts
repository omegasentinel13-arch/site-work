import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { StoredBackupRecord, BackupManifest } from './types';
import { calculateFileSha256 } from './checksum-service';
import { UserSession } from '../auth/session';

function getBackupStorageDir(): string {
  const dir = path.join(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function readManifestFromZip(zipPath: string): Promise<BackupManifest | null> {
  try {
    const buffer = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buffer);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) return null;

    const manifestText = await manifestFile.async('string');
    return JSON.parse(manifestText) as BackupManifest;
  } catch {
    return null;
  }
}

export async function listStoredBackups(session: UserSession): Promise<StoredBackupRecord[]> {
  const storageDir = getBackupStorageDir();
  const entries = fs.readdirSync(storageDir, { withFileTypes: true });
  const records: StoredBackupRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.zip')) continue;

    const filePath = path.join(storageDir, entry.name);
    const stat = fs.statSync(filePath);
    const manifest = await readManifestFromZip(filePath);

    if (!manifest) continue;

    // Site Manager isolation: only show backups for assigned sites
    if (session.role === 'SITE_MANAGER') {
      if (manifest.scope === 'SYSTEM') continue; // Never show system backups
      if (manifest.siteId && !session.assignedSiteIds.includes(manifest.siteId)) continue;
    } else if (session.role === 'VIEWER') {
      return []; // Viewer sees nothing
    }

    const sha256 = calculateFileSha256(filePath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

    records.push({
      id: manifest.backupId || entry.name.replace(/\.zip$/, ''),
      fileName: entry.name,
      filePath,
      sizeBytes: stat.size,
      sizeFormatted: `${sizeMb} MB`,
      sha256,
      createdAt: manifest.backupTimestamp || stat.mtime.toISOString(),
      manifest,
      isPreRestoreBackup: entry.name.startsWith('pre-restore-safety_'),
    });
  }

  // Sort descending by timestamp
  return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function saveBackupToStorage(fileName: string, zipBuffer: Buffer): string {
  const storageDir = getBackupStorageDir();
  const filePath = path.join(storageDir, fileName);
  fs.writeFileSync(filePath, zipBuffer);
  return filePath;
}

export async function getBackupFilePathById(backupId: string): Promise<string | null> {
  const storageDir = getBackupStorageDir();
  const entries = fs.readdirSync(storageDir);

  for (const name of entries) {
    if (name.includes(backupId) && name.endsWith('.zip')) {
      return path.join(storageDir, name);
    }
  }

  // Fallback: inspect manifests
  for (const name of entries) {
    if (!name.endsWith('.zip')) continue;
    const fp = path.join(storageDir, name);
    const manifest = await readManifestFromZip(fp);
    if (manifest && manifest.backupId === backupId) {
      return fp;
    }
  }

  return null;
}

export async function deleteBackupFromStorage(backupId: string): Promise<boolean> {
  if (backupId.startsWith('pre-restore-safety_') || backupId.startsWith('safety-')) {
    throw new Error('PROTECTED_SAFETY_SNAPSHOT: Cannot delete pre-restore safety backup.');
  }

  const filePath = await getBackupFilePathById(backupId);
  if (!filePath) return false;

  const fileName = path.basename(filePath);
  if (fileName.startsWith('pre-restore-safety_') || fileName.startsWith('safety-')) {
    throw new Error('PROTECTED_SAFETY_SNAPSHOT: Cannot delete pre-restore safety backup.');
  }

  const manifest = await readManifestFromZip(filePath);
  if (manifest?.backupId?.startsWith('safety-')) {
    throw new Error('PROTECTED_SAFETY_SNAPSHOT: Cannot delete pre-restore safety backup.');
  }

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('Failed to delete backup file:', err);
    return false;
  }
}
