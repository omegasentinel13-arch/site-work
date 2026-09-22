import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RecoveryJournalEntry } from './types';

function getJournalFilePath(): string {
  return path.join(process.cwd(), 'data', 'backups', 'recovery_journal.jsonl');
}

export function appendRecoveryJournal(entry: Omit<RecoveryJournalEntry, 'eventId'>): RecoveryJournalEntry {
  const fullEntry: RecoveryJournalEntry = {
    eventId: `rec-ev-${crypto.randomUUID()}`,
    ...entry,
  };

  const journalPath = getJournalFilePath();
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify(fullEntry) + '\n';
  fs.appendFileSync(journalPath, line, 'utf-8');

  return fullEntry;
}

export function readRecoveryJournal(limit = 100): RecoveryJournalEntry[] {
  const journalPath = getJournalFilePath();
  if (!fs.existsSync(journalPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(journalPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const entries: RecoveryJournalEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip corrupted line
      }
    }

    return entries.reverse().slice(0, limit);
  } catch (err) {
    console.error('Error reading recovery journal:', err);
    return [];
  }
}
