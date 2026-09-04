'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR, toRupees } from '@/lib/domain/money';
import { calculateRoleAttendance, calculateDailySummary } from '@/lib/domain/attendance-engine';
import { TouchStepper } from '@/components/ui/TouchStepper';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Save, 
  CheckCircle2, 
  AlertCircle, 
  FileDown, 
  RotateCcw,
  Clock
} from 'lucide-react';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

interface RoleRowState {
  roleId: string;
  roleName: string;
  categoryId: string;
  categoryName: string;
  rateInPaise: number;
  fullDayCount: number;
  halfDayCount: number;
  hasRecord: boolean;
}

export default function DailyAttendancePage() {
  const { selectedSite, selectedSiteId, user } = useSite();
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [roles, setRoles] = useState<RoleRowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [exportLoading, setExportLoading] = useState<'pdf' | 'excel' | null>(null);

  const fetchAttendance = useCallback(async () => {
    if (!selectedSiteId || !selectedDate) return;
    setLoading(true);
    setSaveStatus('idle');
    setErrorMessage('');

    try {
      const res = await fetch(`/api/attendance/daily?siteId=${selectedSiteId}&date=${selectedDate}`);
      if (!res.ok) {
        throw new Error('Failed to load daily attendance');
      }
      const data = await res.json();
      setRoles(data.roles || []);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, selectedDate]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  // Handle Count Change
  const updateCounts = (roleId: string, field: 'fullDayCount' | 'halfDayCount', value: number) => {
    setRoles((prev) =>
      prev.map((r) => {
        if (r.roleId === roleId) {
          return { ...r, [field]: value };
        }
        return r;
      })
    );
    if (saveStatus === 'saved') {
      setSaveStatus('idle');
    }
  };

  // Grouped Categories with Live Calculations
  const calculatedSummary = useMemo(() => {
    const activeRoles = roles.filter((r) => r.fullDayCount > 0 || r.halfDayCount > 0);
    return calculateDailySummary(selectedDate, activeRoles);
  }, [roles, selectedDate]);

  const groupedCategories = useMemo(() => {
    const map = new Map<string, { categoryId: string; categoryName: string; roles: RoleRowState[] }>();
    for (const r of roles) {
      if (!map.has(r.categoryId)) {
        map.set(r.categoryId, {
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          roles: [],
        });
      }
      map.get(r.categoryId)!.roles.push(r);
    }
    return Array.from(map.values());
  }, [roles]);

  // Date Navigation Helpers
  const shiftDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const setToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Save Attendance to Backend
  const handleSave = async () => {
    if (!selectedSiteId) return;
    setSaveStatus('saving');
    setErrorMessage('');

    try {
      const itemsToSave = roles.map((r) => ({
        roleId: r.roleId,
        fullDayCount: r.fullDayCount,
        halfDayCount: r.halfDayCount,
        rateInPaise: r.rateInPaise,
      }));

      const res = await fetch('/api/attendance/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSiteId,
          date: selectedDate,
          items: itemsToSave,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save attendance');
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
      fetchAttendance();
    } catch (err: unknown) {
      setSaveStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Save error');
    }
  };

  // PDF Export
  const handleExportPDF = async () => {
    if (!selectedSiteId) return;
    setExportLoading('pdf');
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSiteId,
          type: 'DAILY_ATTENDANCE',
          date: selectedDate,
        }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedSite?.name || 'Site'}_Attendance_${selectedDate}.pdf`;
      a.click();
    } catch (err) {
      alert('Failed to export PDF');
    } finally {
      setExportLoading(null);
    }
  };

  const isReadOnly = user?.role === 'VIEWER';

  return (
    <div className="space-y-4 sm:space-y-6 pb-24 sm:pb-8">
      {/* Date Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
        {/* Date Selector Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1 border border-slate-900 dark:border-[#3A3D42] rounded-lg p-1 bg-[#F8F9FA] dark:bg-[#202225]">
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              className="w-11 h-11 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              title="Previous Day"
              aria-label="Previous Day"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center px-1.5 xs:px-2 space-x-2">
              <Calendar className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm font-black text-[#0F172A] dark:text-[#F2F3F5] focus:outline-none cursor-pointer input-no-zoom min-h-[44px]"
                aria-label="Attendance Date"
              />
            </div>

            <button
              type="button"
              onClick={() => shiftDate(1)}
              className="w-11 h-11 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              title="Next Day"
              aria-label="Next Day"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={setToday}
            className="min-h-[44px] px-3.5 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] text-xs font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg transition-colors touch-action-manipulation flex items-center justify-center shadow-sm"
          >
            Today
          </button>
        </div>

        {/* Action Controls (Save, PDF, Excel) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={exportLoading !== null}
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#4A4D52] text-xs font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg shadow-sm transition-colors touch-action-manipulation"
          >
            <FileDown className="w-4 h-4 mr-1.5 text-rose-600 dark:text-rose-400 shrink-0" />
            PDF
          </button>

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'DAILY_ATTENDANCE',
              date: selectedDate,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Attendance_${selectedDate}.xlsx`}
            label="Excel"
          />

          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'saving' || loading}
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] text-xs sm:text-sm font-bold rounded-lg shadow-sm border border-slate-900 dark:border-[#1ED760] transition-colors disabled:opacity-50 touch-action-manipulation"
            >
              {saveStatus === 'saving' ? (
                <>
                  <Clock className="w-4 h-4 mr-1.5 animate-spin text-white dark:text-[#07130B] shrink-0" />
                  Saving...
                </>
              ) : saveStatus === 'saved' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1.5 text-white dark:text-[#07130B] shrink-0" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1.5 text-white dark:text-[#07130B] shrink-0" />
                  Save Attendance
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-300 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-rose-700 dark:text-rose-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Daily Summary Stat Box */}
      <div className="bg-white dark:bg-[#202225] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl p-4 sm:p-5 shadow-sm border border-slate-900 dark:border-[#4A4D52]">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 items-center">
          <div>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
              Total Workers
            </span>
            <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-0.5">
              {calculatedSummary.totalWorkers}
            </span>
          </div>

          <div>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
              Full Day
            </span>
            <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-0.5">
              {calculatedSummary.fullDayCount}
            </span>
          </div>

          <div>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
              Half Day
            </span>
            <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-0.5">
              {calculatedSummary.halfDayCount}
            </span>
          </div>

          <div>
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
              Worker-Days
            </span>
            <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#1ED760] block mt-0.5">
              {calculatedSummary.workerDays}
            </span>
          </div>

          <div className="col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-slate-900 dark:border-[#3A3D42] pt-2.5 sm:pt-0 sm:pl-4">
            <span className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
              Daily Labour Cost
            </span>
            <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#1ED760] tracking-tight block mt-0.5 break-words">
              {formatINR(calculatedSummary.totalLabourCostPaise)}
            </span>
          </div>
        </div>
      </div>

      {/* Attendance Roles Entry by Category */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] text-sm font-semibold">
          Loading site roles and attendance...
        </div>
      ) : (
        <div className="space-y-6">
          {groupedCategories.map((group) => {
            const catSummary = calculatedSummary.categories.find((c) => c.categoryId === group.categoryId);
            const catWorkers = catSummary ? catSummary.totalWorkers : 0;
            const catWorkerDays = catSummary ? catSummary.workerDays : 0;
            const catCostPaise = catSummary ? catSummary.totalCostPaise : 0;

            return (
              <div
                key={group.categoryId}
                className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] overflow-hidden shadow-sm"
              >
                {/* Category Header */}
                <div className="bg-[#F8F9FA] dark:bg-[#202225] px-4 sm:px-6 py-3 border-b border-slate-900 dark:border-[#4A4D52] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <h2 className="text-sm font-black text-[#0F172A] dark:text-[#F2F3F5] uppercase tracking-wider">
                    {group.categoryName}
                  </h2>
                  <div className="flex items-center space-x-3 text-xs text-slate-600 dark:text-[#949BA4] font-semibold">
                    <span>{catWorkers} Workers ({catWorkerDays} w-days)</span>
                    <span className="text-slate-300 dark:text-[#3A3D42]">|</span>
                    <span className="text-slate-900 dark:text-[#1ED760] font-bold">{formatINR(catCostPaise)}</span>
                  </div>
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#F8F9FA] dark:bg-[#202225] text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                        <th className="py-2.5 px-4">Role</th>
                        <th className="py-2.5 px-4 text-right">Daily Rate</th>
                        <th className="py-2.5 px-4 text-center">Full Day</th>
                        <th className="py-2.5 px-4 text-center">Half Day</th>
                        <th className="py-2.5 px-4 text-center">Workers</th>
                        <th className="py-2.5 px-4 text-center">Worker-Days</th>
                        <th className="py-2.5 px-4 text-right">Line Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31] text-sm">
                      {group.roles.map((r) => {
                        const lineCalc = calculateRoleAttendance({
                          roleId: r.roleId,
                          roleName: r.roleName,
                          categoryId: r.categoryId,
                          categoryName: r.categoryName,
                          rateInPaise: r.rateInPaise,
                          fullDayCount: r.fullDayCount,
                          halfDayCount: r.halfDayCount,
                        });

                        const hasInput = r.fullDayCount > 0 || r.halfDayCount > 0;

                        return (
                          <tr
                            key={r.roleId}
                            className={`hover:bg-slate-50 dark:hover:bg-[#2B2D31] transition-colors ${
                              hasInput ? 'bg-emerald-50/60 dark:bg-[#0F291B]/40' : ''
                            }`}
                          >
                            <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5]">
                              {r.roleName}
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-600 dark:text-[#949BA4]">
                              {formatINR(r.rateInPaise)}
                            </td>
                            <td className="py-2 px-4 text-center">
                              <div className="inline-block">
                                <TouchStepper
                                  value={r.fullDayCount}
                                  onChange={(val) => updateCounts(r.roleId, 'fullDayCount', val)}
                                  disabled={isReadOnly}
                                />
                              </div>
                            </td>
                            <td className="py-2 px-4 text-center">
                              <div className="inline-block">
                                <TouchStepper
                                  value={r.halfDayCount}
                                  onChange={(val) => updateCounts(r.roleId, 'halfDayCount', val)}
                                  disabled={isReadOnly}
                                />
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-slate-800 dark:text-[#B5BAC1]">
                              {lineCalc.totalWorkers}
                            </td>
                            <td className="py-3 px-4 text-center font-medium text-slate-600 dark:text-[#949BA4]">
                              {lineCalc.workerDays}
                            </td>
                            <td className="py-3 px-4 text-right font-black text-[#0F172A] dark:text-[#F2F3F5]">
                              {formatINR(lineCalc.totalCostPaise)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card / Row View (Touch Friendly) */}
                <div className="md:hidden divide-y divide-slate-200 dark:divide-[#2B2D31]">
                  {group.roles.map((r) => {
                    const lineCalc = calculateRoleAttendance({
                      roleId: r.roleId,
                      roleName: r.roleName,
                      categoryId: r.categoryId,
                      categoryName: r.categoryName,
                      rateInPaise: r.rateInPaise,
                      fullDayCount: r.fullDayCount,
                      halfDayCount: r.halfDayCount,
                    });
                    const hasInput = r.fullDayCount > 0 || r.halfDayCount > 0;

                    return (
                      <div
                        key={r.roleId}
                        className={`p-3.5 xs:p-4 space-y-3 ${hasInput ? 'bg-emerald-50/60 dark:bg-[#0F291B]/40' : 'bg-white dark:bg-[#18191C]'}`}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-black text-[#0F172A] dark:text-[#F2F3F5] text-sm truncate">{r.roleName}</span>
                          <span className="text-xs font-semibold text-slate-600 dark:text-[#949BA4] shrink-0">
                            Rate: {formatINR(r.rateInPaise)}/day
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 xs:gap-3">
                          <TouchStepper
                            label="Full Day"
                            value={r.fullDayCount}
                            onChange={(val) => updateCounts(r.roleId, 'fullDayCount', val)}
                            disabled={isReadOnly}
                          />
                          <TouchStepper
                            label="Half Day"
                            value={r.halfDayCount}
                            onChange={(val) => updateCounts(r.roleId, 'halfDayCount', val)}
                            disabled={isReadOnly}
                          />
                        </div>

                        <div className="flex justify-between items-center pt-1 border-t border-slate-900 dark:border-[#2B2D31] text-xs font-semibold">
                          <span className="text-slate-600 dark:text-[#949BA4]">
                            {lineCalc.totalWorkers} Workers ({lineCalc.workerDays} w-days)
                          </span>
                          <span className="text-[#0F172A] dark:text-[#F2F3F5] font-black text-sm">
                            {formatINR(lineCalc.totalCostPaise)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Save Button on Mobile with safe clearance */}
      {!isReadOnly && (
        <div className="sm:hidden fixed bottom-4 right-4 z-40 pb-safe">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === 'saving' || loading}
            className="flex items-center min-h-[48px] px-5 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] rounded-full shadow-2xl font-bold text-sm tracking-wide touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Save className="w-4 h-4 mr-2 text-white dark:text-[#07130B] shrink-0" />
            {saveStatus === 'saving' ? 'Saving...' : 'Save Attendance'}
          </button>
        </div>
      )}
    </div>
  );
}