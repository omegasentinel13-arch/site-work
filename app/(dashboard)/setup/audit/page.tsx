'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import { Filter } from 'lucide-react';

interface AuditLogItem {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  site_id: string | null;
  site_name: string | null;
  user_id: string | null;
  user_name: string | null;
  before_state: string | null;
  after_state: string | null;
  created_at: string;
}

export default function AuditTrailPage() {
  const { user } = useSite();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState<string>('ALL');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const url = filterEntity !== 'ALL' ? `/api/audit?entityType=${filterEntity}` : '/api/audit';
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
      }
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [filterEntity]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (user?.role !== 'ADMIN') {
    return (
      <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center shadow-sm">
        <p className="text-rose-600 dark:text-rose-400 font-bold">Access Denied. Administrator privileges required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Filter */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
            System Compliance &amp; Security
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            System Audit Trail
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Immutable log of all attendance updates, rate changes, cash movements, and admin mutations.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-slate-400 dark:text-zinc-400 shrink-0" />
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            aria-label="Filter audit logs by entity type"
            className="min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg px-3 py-2 bg-slate-50 dark:bg-[#111214] font-bold text-xs sm:text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] input-no-zoom touch-action-manipulation cursor-pointer"
          >
            <option value="ALL">All Entity Types</option>
            <option value="ATTENDANCE">Attendance Entries</option>
            <option value="FINANCE">Financial Transactions</option>
            <option value="RATE">Wage Rate Modifications</option>
            <option value="SITE">Site Changes</option>
            <option value="ROLE">Role Changes</option>
            <option value="USER">User Changes</option>
          </select>
        </div>
      </div>

      {/* Audit Logs Presentation (Desktop Table vs Mobile Cards) */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-zinc-400 font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading audit trail...
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-zinc-400 text-sm shadow-sm">
          No audit logs recorded yet.
        </div>
      ) : (
        <>
          {/* DESKTOP / TABLET VIEW: High-density Table */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 border-b border-slate-900 dark:border-[#3A3D42]">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-3">Entity</th>
                    <th className="py-3 px-3">Action</th>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Site Context</th>
                    <th className="py-3 px-4">Details / Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31] font-mono">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                      <td className="py-3 px-4 text-slate-500 dark:text-zinc-400 whitespace-nowrap">{log.created_at}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-bold text-slate-800 dark:text-zinc-200">{log.entity_type}</span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                            log.action === 'CREATE'
                              ? 'bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-emerald-300 dark:border-[#1A7F3C]/60'
                              : log.action === 'UPDATE'
                              ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700/60'
                              : 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700/60'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-800 dark:text-zinc-200 font-bold whitespace-nowrap">
                        {log.user_name || log.user_id || 'System'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-zinc-400 whitespace-nowrap">
                        {log.site_name || (log.site_id ? log.site_id : '—')}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-600 dark:text-zinc-300 max-w-xs break-words font-sans">
                        {log.after_state || log.before_state || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE VIEW: Stacked Responsive Cards (< 768px) */}
          <div className="md:hidden space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-2.5 text-xs"
              >
                {/* Top: Badges and Timestamp */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-[#2B2D31] pb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        log.action === 'CREATE'
                          ? 'bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-emerald-300 dark:border-[#1A7F3C]/60'
                          : log.action === 'UPDATE'
                          ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-700/60'
                          : 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700/60'
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-zinc-300 bg-slate-100 dark:bg-[#202225] border border-slate-900 dark:border-[#2B2D31] px-1.5 py-0.5 rounded text-[10px]">
                      {log.entity_type}
                    </span>
                  </div>

                  <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono shrink-0">
                    {log.created_at}
                  </span>
                </div>

                {/* Middle: User & Site Context */}
                <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-zinc-300">
                  <div>
                    <span className="text-slate-400 dark:text-zinc-500 block text-[10px] uppercase font-bold">User</span>
                    <strong className="text-slate-900 dark:text-white font-bold">{log.user_name || log.user_id || 'System'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-zinc-500 block text-[10px] uppercase font-bold">Site</span>
                    <strong className="text-slate-900 dark:text-white font-bold">{log.site_name || (log.site_id ? log.site_id : '—')}</strong>
                  </div>
                </div>

                {/* Bottom: Details / Payload */}
                {(log.after_state || log.before_state) && (
                  <div className="pt-2 border-t border-slate-100 dark:border-[#2B2D31]">
                    <span className="text-slate-400 dark:text-zinc-500 block text-[10px] uppercase font-bold mb-1">Details</span>
                    <p className="text-[11px] text-slate-700 dark:text-zinc-300 bg-slate-50 dark:bg-[#111214] p-2 rounded-md border border-slate-900 dark:border-[#2B2D31] break-words font-mono">
                      {log.after_state || log.before_state}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
