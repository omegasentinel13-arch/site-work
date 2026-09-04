'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { FinancialSummary } from '@/lib/domain/finance-engine';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

export default function SiteReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  const [year] = useState<number>(() => new Date().getFullYear());
  const [month] = useState<number>(() => new Date().getMonth() + 1);
  const [attRecords, setAttRecords] = useState<AttendanceDbRecord[]>([]);
  const [finSummary, setFinSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const fetchSiteReport = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    try {
      const attRes = await fetch(
        `/api/attendance/range?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}`
      );
      if (attRes.ok) {
        const data = await attRes.json();
        setAttRecords(data.records || []);
      }

      const finRes = await fetch(
        `/api/finance/summary?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}`
      );
      if (finRes.ok) {
        const data = await finRes.json();
        setFinSummary(data.summary);
      }
    } catch (err) {
      console.error('Error fetching site report:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, startDateStr, endDateStr]);

  useEffect(() => {
    fetchSiteReport();
  }, [fetchSiteReport]);

  const totalLabourCostPaise = attRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const totalWorkerDays = attRecords.reduce((sum, r) => sum + r.worker_days, 0);
  const totalWorkers = attRecords.reduce((sum, r) => sum + r.total_workers, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Executive Site Summary
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5]">
            {selectedSite?.name || 'Site'} — Performance Report
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            {monthLabel} | Location: <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.location || 'Not Specified'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PdfExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'SITE_REPORT',
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Performance_Report_${monthLabel.replace(/\s+/g, '_')}.pdf`}
            label="Export PDF"
          />

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'SITE_REPORT',
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Performance_Report_${monthLabel.replace(/\s+/g, '_')}.xlsx`}
            label="Export Excel"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading site summary report...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Operational Workforce Summary */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              Operational Workforce Metrics
            </h2>

            <div className="space-y-2.5 sm:space-y-3 text-xs sm:text-sm">
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4] font-medium">Total Recorded Worker-Days</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{totalWorkerDays}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4] font-medium">Total Headcount Recorded</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{totalWorkers}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4] font-medium">Active Days in Period</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                  {new Set(attRecords.map((r) => r.date)).size} Days
                </span>
              </div>
              <div className="flex justify-between items-center py-3 bg-slate-900 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-white px-3.5 sm:px-4 rounded-lg shadow-sm">
                <span className="font-bold text-emerald-400 dark:text-[#1ED760] text-xs sm:text-sm">Total Operational Labour Cost</span>
                <span className="font-black text-emerald-400 dark:text-[#1ED760] text-sm sm:text-base truncate ml-2" title={formatINR(totalLabourCostPaise)}>
                  {formatINR(totalLabourCostPaise)}
                </span>
              </div>
            </div>
          </div>

          {/* Cash Financial Statement */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              Actual Cash Movement Statement
            </h2>

            <div className="space-y-2.5 sm:space-y-3 text-xs sm:text-sm">
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4] font-medium">Opening Balance</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                  {formatINR(finSummary?.openingBalancePaise || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-emerald-700 dark:text-[#86EFAC] font-semibold">Credits Received (Inflow)</span>
                <span className="font-bold text-emerald-800 dark:text-[#1ED760]">
                  +{formatINR(finSummary?.totalCreditPaise || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-rose-700 dark:text-[#FCA5A5] font-semibold">Total Debits (Outflow)</span>
                <span className="font-bold text-rose-800 dark:text-[#F87171]">
                  -{formatINR(finSummary?.totalDebitPaise || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center py-3 bg-slate-900 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-white px-3.5 sm:px-4 rounded-lg shadow-sm">
                <span className="font-bold text-slate-200 dark:text-[#F2F3F5] text-xs sm:text-sm">Closing Cash Balance</span>
                <span className="font-black text-white dark:text-[#1ED760] text-sm sm:text-base truncate ml-2" title={formatINR(finSummary?.closingBalancePaise || 0)}>
                  {formatINR(finSummary?.closingBalancePaise || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
