/**
 * Task 4 — Step 4: Crash-Safe Append-Only Recovery History Sidecar
 * Guarantees crash-safe atomic append with fsyncSync to data/backups/recovery_history.jsonl.
 */

import fs from 'node:fs';
import path from 'node:path';
import { RecoveryHistoryEntry } from './types';

const HISTORY_FILE_PATH = path.join(process.cwd(), 'data', 'backups', 'recovery_history.jsonl');

export function appendRecoveryHistory(entry: RecoveryHistoryEntry): void {
  const dir = path.dirname(HISTORY_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(entry) + '\n';
  const buffer = Buffer.from(line, 'utf-8');

  // Open in append mode ('a'), write, and immediately flush to disk via fsyncSync
  const fd = fs.openSync(HISTORY_FILE_PATH, 'a');
  try {
    fs.writeSync(fd, buffer, 0, buffer.length, null);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function getRecoveryHistory(): RecoveryHistoryEntry[] {
  if (!fs.existsSync(HISTORY_FILE_PATH)) {
    return [];
  }

  try {
    const content = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const records: RecoveryHistoryEntry[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        records.push(parsed);
      } catch {
        // Skip corrupted line to protect log integrity
      }
    }

    // Return most recent first
    return records.reverse();
  } catch (err) {
    console.error('Failed to read recovery history:', err);
    return [];
  }
}
