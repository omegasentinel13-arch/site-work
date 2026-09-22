import { SiteExportData, SystemExportData } from './types';

export function generateSiteCompleteJSON(data: SiteExportData, username = 'system'): string {
  const exportPayload = {
    application: 'SITE WORK',
    exportVersion: 1,
    exportType: 'COMPLETE_SITE',
    generatedAt: new Date().toISOString(),
    generatedBy: username,
    scope: {
      type: 'SITE',
      siteId: data.site.id,
      siteName: data.site.name,
      siteCode: data.site.code,
      siteLocation: data.site.location,
    },
    period: {
      preset: data.period.preset,
      from: data.period.startDate || null,
      to: data.period.endDate || null,
      label: data.period.label,
      isUnbounded: data.period.isUnbounded,
    },
    summary: {
      attendance: {
        totalRecords: data.attendanceRecords.length,
        totalWorkerDays: Number(data.totalWorkerDays.toFixed(1)),
        totalLabourCostPaise: data.totalLabourCostPaise,
        totalLabourCostINR: Number((data.totalLabourCostPaise / 100).toFixed(2)),
      },
      finance: {
        totalTransactions: data.financialRecords.length,
        openingBalancePaise: data.openingBalancePaise,
        openingBalanceINR: Number((data.openingBalancePaise / 100).toFixed(2)),
        totalCreditsPaise: data.financialSummary.totalCreditPaise,
        totalCreditsINR: Number((data.financialSummary.totalCreditPaise / 100).toFixed(2)),
        totalDebitsPaise: data.financialSummary.totalDebitPaise,
        totalDebitsINR: Number((data.financialSummary.totalDebitPaise / 100).toFixed(2)),
        closingBalancePaise: data.closingBalancePaise,
        closingBalanceINR: Number((data.closingBalancePaise / 100).toFixed(2)),
        debitBreakdownByCategory: {
          suppliesPaise: data.financialSummary.suppliesDebitPaise,
          suppliesINR: Number((data.financialSummary.suppliesDebitPaise / 100).toFixed(2)),
          specialWorkerTaskPaise: data.financialSummary.specialWorkerTaskDebitPaise,
          specialWorkerTaskINR: Number((data.financialSummary.specialWorkerTaskDebitPaise / 100).toFixed(2)),
        },
      },
    },
    categories: data.categories.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sort_order,
    })),
    roles: data.roles.map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.category_id,
      categoryName: r.category_name,
      defaultRatePaise: r.default_rate_paise,
      effectiveRatePaise: r.effective_rate_paise || r.default_rate_paise,
    })),
    roleRollup: data.roleRollup.map((r) => ({
      roleId: r.roleId,
      roleName: r.roleName,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      workerDays: Number(r.workerDays.toFixed(1)),
      fullDays: r.fullDays,
      halfDays: r.halfDays,
      totalCostPaise: r.totalCostPaise,
      totalCostINR: Number((r.totalCostPaise / 100).toFixed(2)),
    })),
    categoryRollup: data.categoryRollup.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      workerDays: Number(c.workerDays.toFixed(1)),
      fullDays: c.fullDays,
      halfDays: c.halfDays,
      totalCostPaise: c.totalCostPaise,
      totalCostINR: Number((c.totalCostPaise / 100).toFixed(2)),
    })),
    attendance: data.attendanceRecords.map((r) => ({
      id: r.id,
      date: r.date,
      roleId: r.role_id,
      roleName: r.role_name,
      categoryId: r.category_id,
      categoryName: r.category_name,
      rateSnapshotPaise: r.rate_snapshot_paise,
      rateSnapshotINR: Number((r.rate_snapshot_paise / 100).toFixed(2)),
      fullDayCount: r.full_day_count,
      halfDayCount: r.half_day_count,
      totalWorkers: r.total_workers,
      workerDays: Number(r.worker_days.toFixed(1)),
      totalCostPaise: r.total_cost_paise,
      totalCostINR: Number((r.total_cost_paise / 100).toFixed(2)),
    })),
    financialTransactions: data.financialRecords.map((t) => ({
      id: t.id,
      date: t.date,
      type: t.type,
      debitCategory: t.debit_category,
      amountPaise: t.amount_paise,
      amountINR: Number((t.amount_paise / 100).toFixed(2)),
      description: t.description,
      referenceNote: t.reference_note,
    })),
    recordCounts: {
      attendanceRecords: data.attendanceRecords.length,
      financialTransactions: data.financialRecords.length,
      workRoles: data.roles.length,
      workCategories: data.categories.length,
      sites: 1,
    },
  };

  return JSON.stringify(exportPayload, null, 2);
}

export function generateSystemCompleteJSON(data: SystemExportData, username = 'system'): string {
  const allAttendance = data.sitesData.flatMap((s) => s.attendanceRecords);
  const allFinance = data.sitesData.flatMap((s) => s.financialRecords);

  const exportPayload = {
    application: 'SITE WORK',
    exportVersion: 1,
    exportType: 'COMPLETE_SYSTEM',
    generatedAt: new Date().toISOString(),
    generatedBy: username,
    scope: {
      type: 'SYSTEM',
      totalSites: data.aggregatedSummary.totalSites,
    },
    period: {
      preset: data.period.preset,
      from: data.period.startDate || null,
      to: data.period.endDate || null,
      label: data.period.label,
      isUnbounded: data.period.isUnbounded,
    },
    aggregatedSummary: {
      totalSites: data.aggregatedSummary.totalSites,
      totalWorkers: data.aggregatedSummary.totalWorkers,
      totalWorkerDays: Number(data.aggregatedSummary.totalWorkerDays.toFixed(1)),
      totalLabourCostPaise: data.aggregatedSummary.totalLabourCostPaise,
      totalLabourCostINR: Number((data.aggregatedSummary.totalLabourCostPaise / 100).toFixed(2)),
      totalCreditsPaise: data.aggregatedSummary.totalCreditsPaise,
      totalCreditsINR: Number((data.aggregatedSummary.totalCreditsPaise / 100).toFixed(2)),
      totalDebitsPaise: data.aggregatedSummary.totalDebitsPaise,
      totalDebitsINR: Number((data.aggregatedSummary.totalDebitsPaise / 100).toFixed(2)),
      netClosingBalancePaise: data.aggregatedSummary.netClosingBalancePaise,
      netClosingBalanceINR: Number((data.aggregatedSummary.netClosingBalancePaise / 100).toFixed(2)),
    },
    sites: data.sitesData.map((s) => ({
      siteId: s.site.id,
      siteName: s.site.name,
      siteCode: s.site.code,
      siteLocation: s.site.location,
      workerDays: Number(s.totalWorkerDays.toFixed(1)),
      labourCostINR: Number((s.totalLabourCostPaise / 100).toFixed(2)),
      creditsINR: Number((s.financialSummary.totalCreditPaise / 100).toFixed(2)),
      debitsINR: Number((s.financialSummary.totalDebitPaise / 100).toFixed(2)),
      closingBalanceINR: Number((s.closingBalancePaise / 100).toFixed(2)),
      attendanceRecordCount: s.attendanceRecords.length,
      financialTransactionCount: s.financialRecords.length,
    })),
    siteDetails: data.sitesData.map((s) => ({
      site: {
        id: s.site.id,
        name: s.site.name,
        code: s.site.code,
        location: s.site.location,
      },
      roleRollup: s.roleRollup,
      categoryRollup: s.categoryRollup,
      attendance: s.attendanceRecords.map((r) => ({
        date: r.date,
        roleName: r.role_name,
        categoryName: r.category_name,
        workerDays: r.worker_days,
        costPaise: r.total_cost_paise,
      })),
      financialTransactions: s.financialRecords.map((t) => ({
        date: t.date,
        type: t.type,
        category: t.debit_category,
        amountPaise: t.amount_paise,
        description: t.description,
      })),
    })),
    recordCounts: {
      attendanceRecords: allAttendance.length,
      financialTransactions: allFinance.length,
      sites: data.sitesData.length,
    },
  };

  return JSON.stringify(exportPayload, null, 2);
}
