import React from 'react';

export default function DashboardLoading() {
  return (
    <div className="space-y-4 sm:space-y-6 animate-pulse" aria-busy="true" aria-label="Loading page content">
      {/* Header Banner Skeleton */}
      <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-24 bg-slate-200 rounded"></div>
          <div className="h-7 w-48 sm:w-64 bg-slate-200 rounded"></div>
          <div className="h-3 w-36 bg-slate-100 rounded"></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-11 w-28 bg-slate-200 rounded-lg"></div>
          <div className="h-11 w-28 bg-slate-200 rounded-lg"></div>
        </div>
      </div>

      {/* Summary Metrics Row Skeleton */}
      <div className="bg-slate-900 rounded-xl p-4 sm:p-5 shadow-sm grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="space-y-1.5">
          <div className="h-3 w-16 bg-slate-700 rounded"></div>
          <div className="h-6 w-24 bg-slate-800 rounded"></div>
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-16 bg-slate-700 rounded"></div>
          <div className="h-6 w-24 bg-slate-800 rounded"></div>
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-16 bg-slate-700 rounded"></div>
          <div className="h-6 w-24 bg-slate-800 rounded"></div>
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-16 bg-slate-700 rounded"></div>
          <div className="h-6 w-24 bg-slate-800 rounded"></div>
        </div>
      </div>

      {/* Content Card Skeleton */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="h-5 w-40 bg-slate-200 rounded"></div>
        <div className="space-y-3">
          <div className="h-12 w-full bg-slate-100 rounded-lg"></div>
          <div className="h-12 w-full bg-slate-100 rounded-lg"></div>
          <div className="h-12 w-full bg-slate-100 rounded-lg"></div>
        </div>
      </div>
    </div>
  );
}
