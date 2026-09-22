'use client';

import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { ConflictRecord } from '@/lib/backup/import/types';

interface ConflictCenterCardProps {
  conflicts: ConflictRecord[];
}

export function ConflictCenterCard({ conflicts }: ConflictCenterCardProps) {
  if (!conflicts || conflicts.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-amber-500/10 dark:bg-amber-950/20 px-4 py-3 border-b border-slate-900 dark:border-[#33353A] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
            Conflict Center ({conflicts.length} Record Conflict{conflicts.length > 1 ? 's' : ''} Detected)
          </h4>
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Non-Destructive: Skip / Keep Existing</span>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        <p className="text-xs text-slate-600 dark:text-zinc-400">
          The following records exist in both the active database and the incoming backup package, but with differing attributes.
          In accordance with the <strong>Zero-Data-Loss Invariant</strong>, the recovery engine will <strong>NEVER</strong> overwrite active database records.
          All conflicts below are marked <code>SKIP</code> and your active data is preserved.
        </p>

        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {conflicts.map((conflict, idx) => (
            <div
              key={`${conflict.table}-${conflict.naturalKey}-${idx}`}
              className="p-3 rounded-xl border border-slate-300 dark:border-[#33353A] bg-slate-50/50 dark:bg-[#202225] space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-[#2B2D31] text-[10px] font-black uppercase tracking-wider text-slate-800 dark:text-zinc-200 border border-slate-300 dark:border-[#3A3D42]">
                    {conflict.table}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                    {conflict.naturalKey}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  Action: SKIP (Keep Active)
                </span>
              </div>

              {/* Field Differences Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#2B2D31]">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-100 dark:bg-[#2B2D31] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-2">Field</th>
                      <th className="p-2 text-emerald-700 dark:text-emerald-400">Active Database Value (Preserved)</th>
                      <th className="p-2 text-rose-700 dark:text-rose-400">Incoming Backup Value (Ignored)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                    {conflict.fieldDifferences.map((diff) => (
                      <tr key={diff.field}>
                        <td className="p-2 font-mono font-bold text-slate-800 dark:text-zinc-200">{diff.field}</td>
                        <td className="p-2 font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/10">
                          {diff.existingValue !== null && diff.existingValue !== undefined ? String(diff.existingValue) : '<null>'}
                        </td>
                        <td className="p-2 font-mono text-rose-700 dark:text-rose-300 bg-rose-50/40 dark:bg-rose-950/10 line-through">
                          {diff.incomingValue !== null && diff.incomingValue !== undefined ? String(diff.incomingValue) : '<null>'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
