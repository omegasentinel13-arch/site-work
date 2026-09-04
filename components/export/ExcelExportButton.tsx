'use client';

import React, { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { downloadReportExcel, ExportExcelOptions } from '@/lib/export/client-excel-download';

export interface ExcelExportButtonProps {
  payload: ExportExcelOptions;
  fallbackFilename?: string;
  className?: string;
  label?: string;
  disabled?: boolean;
  onError?: (errMessage: string) => void;
}

export function ExcelExportButton({
  payload,
  fallbackFilename,
  className = '',
  label = 'Export Excel',
  disabled = false,
  onError,
}: ExcelExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const isExportingRef = React.useRef(false);

  const handleExport = async () => {
    if (isExportingRef.current || loading || disabled || !payload.siteId) return;
    isExportingRef.current = true;
    setLoading(true);
    try {
      await downloadReportExcel(payload, fallbackFilename);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      if (onError) {
        onError(msg);
      } else {
        alert(msg);
      }
    } finally {
      isExportingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading || disabled || !payload.siteId}
      aria-label={label}
      title={label}
      className={`min-h-[44px] inline-flex items-center justify-center px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 dark:active:bg-[#3A3D42] border border-slate-900 dark:border-[#4A4D52] hover:border-slate-900 dark:hover:border-[#1ED760]/60 text-xs sm:text-sm font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 mr-1.5 text-emerald-700 dark:text-[#1ED760] animate-spin shrink-0" />
          <span>Exporting…</span>
        </>
      ) : (
        <>
          <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-700 dark:text-[#1ED760] shrink-0" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}