import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { SiteExportData, SystemExportData } from './types';
import { BaseReportMetadata } from '../pdf/types';
import { drawDocumentHeader } from '../pdf/headers';
import { applyDocumentFooters } from '../pdf/footers';
import { getBaseTableOptions } from '../pdf/tables';
import { PDF_THEME, formatPDFCurrency } from '../pdf/theme';

function ensureSpace(doc: jsPDF, neededHeight = 35): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const currentY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : 40;
  if (currentY + neededHeight > pageHeight - PDF_THEME.margins.bottom) {
    doc.addPage();
    return PDF_THEME.margins.top + 5;
  }
  return currentY;
}

function drawSectionHeading(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, y, PDF_THEME.page.portrait.usableWidth, 7, 1, 1, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text(title.toUpperCase(), PDF_THEME.margins.left + 3, y + 4.8);

  return y + 9;
}

/**
 * Generates an exhaustive, multi-section Consolidated Site Report PDF.
 */
export function generateSiteCompletePDF(data: SiteExportData, username = 'Authorized User'): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const siteCodeLabel = data.site.code ? ' (' + data.site.code + ')' : '';

  const meta: BaseReportMetadata = {
    siteName: data.site.name,
    siteCode: data.site.code,
    reportTitle: 'COMPLETE SITE REPORT',
    periodLabel: data.period.label,
    generatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    generatedBy: username,
    filtersSummary: 'Scope: ' + data.site.name + ' | Period: ' + data.period.label,
  };

  const startY = drawDocumentHeader(doc, meta, 'portrait');

  // 1. Executive Summary KPI Strip (2 rows)
  const activeDays = new Set(data.attendanceRecords.map((r) => r.date)).size;
  const avgDaily = activeDays > 0 ? (data.totalWorkerDays / activeDays).toFixed(1) : '0';
  const totalExpenditurePaise = data.totalLabourCostPaise + data.financialSummary.totalDebitPaise;

  const kpiBoxHeight = 22;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, kpiBoxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const col1 = PDF_THEME.margins.left + 4;
  const col2 = PDF_THEME.margins.left + 65;
  const col3 = PDF_THEME.margins.left + 125;

  doc.text('OPERATIONAL WORKFORCE', col1, startY + 5);
  doc.text('FINANCIAL CASH FLOW', col2, startY + 5);
  doc.text('TOTAL SITE OUTLAY', col3, startY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_THEME.colors.textMuted);

  doc.text('Recorded W-Days: ' + data.totalWorkerDays.toFixed(1), col1, startY + 10);
  doc.text('Active Working Days: ' + activeDays + ' (' + avgDaily + ' w/day)', col1, startY + 14.5);
  doc.text('Labour Cost: ' + formatPDFCurrency(data.totalLabourCostPaise), col1, startY + 19);

  doc.text('Opening Balance: ' + formatPDFCurrency(data.openingBalancePaise), col2, startY + 10);
  doc.text('Credits: ' + formatPDFCurrency(data.financialSummary.totalCreditPaise) + ' | Debits: ' + formatPDFCurrency(data.financialSummary.totalDebitPaise), col2, startY + 14.5);
  doc.text('Closing Balance: ' + formatPDFCurrency(data.closingBalancePaise), col2, startY + 19);

  doc.text('Consolidated Outlay:', col3, startY + 10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_THEME.colors.accent);
  doc.text(formatPDFCurrency(totalExpenditurePaise), col3, startY + 15);

  let curY = startY + kpiBoxHeight + 5;

  // 2. Section 1: Site Profile & Operational Scope
  curY = drawSectionHeading(doc, curY, '1. Site Profile & Operational Scope');
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Attribute', 'Details', 'Operational Status']],
    body: [
      ['Site Name & Identifier', data.site.name + siteCodeLabel, 'Active Construction Project'],
      ['Project Location', data.site.location || 'Main Operational Area', 'Jurisdiction Verified'],
      ['Reporting History Span', data.period.label, data.period.isUnbounded ? 'Full Project Lifetime' : 'Filtered Period'],
      ['Attendance & Ledger Activity', data.attendanceRecords.length + ' worker logs recorded', data.financialRecords.length + ' financial transactions recorded'],
    ],
  });

  // 3. Section 2: Role Breakdown
  curY = ensureSpace(doc, 40);
  curY = drawSectionHeading(doc, curY, '2. Workforce Role Breakdown & Labour Deployment');
  if (data.roleRollup.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Role Name', 'Category', 'Full Days', 'Half Days', 'Worker-Days', 'Labour Cost (INR)']],
      body: [['No workforce attendance recorded for this scope.', '', '', '', '', '₹0.00']],
    });
  } else {
    const roleRows: RowInput[] = data.roleRollup.map((r) => [
      r.roleName,
      r.categoryName,
      String(r.fullDays),
      String(r.halfDays),
      r.workerDays.toFixed(1),
      { content: formatPDFCurrency(r.totalCostPaise), styles: { halign: 'right' } },
    ]);
    roleRows.push([
      { content: 'TOTAL LABOUR ROLLUP', colSpan: 4, styles: { fontStyle: 'bold' } },
      { content: data.totalWorkerDays.toFixed(1), styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(data.totalLabourCostPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ]);
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Role Name', 'Category', 'Full', 'Half', 'W-Days', 'Labour Cost (INR)']],
      body: roleRows,
    });
  }

  // 4. Section 3: Work Category Summary
  curY = ensureSpace(doc, 40);
  curY = drawSectionHeading(doc, curY, '3. Work Category Summary & Cost Allocation');
  if (data.categoryRollup.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Category Name', 'Worker-Days', 'Shift Breakdown', 'Labour Outlay (INR)', 'Share %']],
      body: [['No category attendance recorded.', '', '', '₹0.00', '0.0%']],
    });
  } else {
    const catRows: RowInput[] = data.categoryRollup.map((c) => {
      const share = data.totalLabourCostPaise > 0 
        ? ((c.totalCostPaise / data.totalLabourCostPaise) * 100).toFixed(1) + '%' 
        : '0.0%';
      return [
        c.categoryName,
        c.workerDays.toFixed(1),
        c.fullDays + ' Full + ' + c.halfDays + ' Half',
        { content: formatPDFCurrency(c.totalCostPaise), styles: { halign: 'right' } },
        { content: share, styles: { halign: 'right' } },
      ];
    });
    catRows.push([
      { content: 'TOTAL CATEGORY DEPLOYMENT', styles: { fontStyle: 'bold' } },
      { content: data.totalWorkerDays.toFixed(1), styles: { fontStyle: 'bold' } },
      '',
      { content: formatPDFCurrency(data.totalLabourCostPaise), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: '100.0%', styles: { fontStyle: 'bold', halign: 'right' } },
    ]);
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Category Name', 'W-Days', 'Shifts', 'Labour Cost (INR)', 'Cost Share']],
      body: catRows,
    });
  }

  // 5. Section 4: Daily Attendance Operational Log
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '4. Daily Attendance Operational Log');
  if (data.attendanceRecords.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Role & Category', 'Daily Rate', 'Shifts Recorded', 'Worker-Days', 'Daily Cost (INR)']],
      body: [['No daily attendance logs recorded for this scope.', '', '', '', '', '₹0.00']],
    });
  } else {
    const attRows: RowInput[] = data.attendanceRecords.slice(0, 300).map((r) => [
      r.date,
      (r.role_name || 'Role') + '\n(' + (r.category_name || 'Category') + ')',
      formatPDFCurrency(r.rate_snapshot_paise),
      r.full_day_count + ' Full + ' + r.half_day_count + ' Half',
      r.worker_days.toFixed(1),
      { content: formatPDFCurrency(r.total_cost_paise), styles: { halign: 'right' } },
    ]);
    if (data.attendanceRecords.length > 300) {
      attRows.push([
        { content: '... and ' + (data.attendanceRecords.length - 300) + ' additional daily records (see full Excel/JSON data)', colSpan: 6, styles: { fontStyle: 'italic', halign: 'center' } },
      ]);
    }
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Role & Category', 'Daily Rate', 'Shifts', 'W-Days', 'Daily Cost']],
      body: attRows,
    });
  }

  // 6. Section 5: Financial Statement & Cash Flow
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '5. Financial Statement & Cash Flow Position');
  const fin = data.financialSummary;
  const finRows: RowInput[] = [
    ['Opening Cash Balance (Carried Forward)', formatPDFCurrency(data.openingBalancePaise)],
    ['Total Inflows / Credits Received', formatPDFCurrency(fin.totalCreditPaise)],
    ['Total Site Expenses / Debits Outlay', '(' + formatPDFCurrency(fin.totalDebitPaise) + ')'],
    [
      { content: 'Net Operational Cash Balance', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(data.closingBalancePaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ],
  ];
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Financial Position Metric', 'Reconciliation Amount (INR)']],
    body: finRows,
  });

  // 7. Section 6: Debit Expenses Breakdown by Category
  curY = ensureSpace(doc, 40);
  curY = drawSectionHeading(doc, curY, '6. Debit Expenses Breakdown by Category');
  const debitBreakdownEntries: Array<[string, number]> = (
    [
      ['Materials & Supplies', fin.suppliesDebitPaise],
      ['Special Worker Tasks & Overtime', fin.specialWorkerTaskDebitPaise],
    ] as Array<[string, number]>
  ).filter(([_, amount]) => amount > 0);
  if (debitBreakdownEntries.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Expense Category', 'Total Outflow (INR)', 'Share %']],
      body: [['No debit expenses recorded.', '₹0.00', '0.0%']],
    });
  } else {
    const debitRows: RowInput[] = debitBreakdownEntries.map(([cat, amount]) => {
      const share = fin.totalDebitPaise > 0 ? ((amount / fin.totalDebitPaise) * 100).toFixed(1) + '%' : '0.0%';
      return [
        cat.toUpperCase(),
        { content: formatPDFCurrency(amount), styles: { halign: 'right' } },
        { content: share, styles: { halign: 'right' } },
      ];
    });
    debitRows.push([
      { content: 'TOTAL DEBIT OUTLAY', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(fin.totalDebitPaise), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: '100.0%', styles: { fontStyle: 'bold', halign: 'right' } },
    ]);
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Expense Category', 'Total Outflow (INR)', 'Share of Debits']],
      body: debitRows,
    });
  }

  // 8. Section 7: Financial Transactions Ledger
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '7. Financial Transactions Ledger');
  if (data.financialRecords.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Type', 'Category', 'Description', 'Inflow', 'Outflow', 'Running Balance']],
      body: [['No financial transactions recorded for this scope.', '', '', '', '-', '-', formatPDFCurrency(data.openingBalancePaise)]],
    });
  } else {
    let running = data.openingBalancePaise;
    const txRows: RowInput[] = data.financialRecords.slice(0, 300).map((t) => {
      if (t.type === 'CREDIT') running += t.amount_paise;
      else running -= t.amount_paise;

      return [
        t.date,
        t.type,
        t.debit_category || 'CREDIT',
        t.description,
        t.type === 'CREDIT' ? { content: formatPDFCurrency(t.amount_paise), styles: { halign: 'right' } } : '-',
        t.type === 'DEBIT' ? { content: formatPDFCurrency(t.amount_paise), styles: { halign: 'right' } } : '-',
        { content: formatPDFCurrency(running), styles: { halign: 'right', fontStyle: 'bold' } },
      ];
    });
    if (data.financialRecords.length > 300) {
      txRows.push([
        { content: '... and ' + (data.financialRecords.length - 300) + ' additional ledger records (see full Excel/JSON data)', colSpan: 7, styles: { fontStyle: 'italic', halign: 'center' } },
      ]);
    }
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Type', 'Category', 'Description', 'Inflow', 'Outflow', 'Balance']],
      body: txRows,
    });
  }

  // 9. Section 8: Metadata & Report Verification
  curY = ensureSpace(doc, 30);
  curY = drawSectionHeading(doc, curY, '8. Report Verification & Audit Metadata');
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Metadata Field', 'Value']],
    body: [
      ['Report Title', meta.reportTitle],
      ['Site Authority Scope', data.site.name + ' (Code: ' + (data.site.code || 'N/A') + ')'],
      ['Reporting Temporal Bounds', data.period.label],
      ['Generated At (UTC/Local)', meta.generatedAt || 'N/A'],
      ['Generated By Authorized User', meta.generatedBy || 'N/A'],
      ['Audited Record Quantities', data.attendanceRecords.length + ' Attendance Records, ' + data.financialRecords.length + ' Transactions'],
    ],
  });

  // Stamp running footers across ALL pages
  applyDocumentFooters(doc, meta, 'portrait');

  return Buffer.from(doc.output('arraybuffer'));
}

function drawSiteDividerBanner(
  doc: jsPDF,
  siteData: SiteExportData,
  index: number,
  total: number
): number {
  const y = PDF_THEME.margins.top;
  doc.setFillColor(...PDF_THEME.colors.primary);
  doc.roundedRect(PDF_THEME.margins.left, y, PDF_THEME.page.portrait.usableWidth, 14, 1.5, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  const codeStr = siteData.site.code ? ' (' + siteData.site.code + ')' : '';
  doc.text(
    'SITE ' + (index + 1) + ' OF ' + total + ': ' + siteData.site.name.toUpperCase() + codeStr,
    PDF_THEME.margins.left + 4,
    y + 5.5
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(215, 225, 235);
  doc.text(
    'Database ID: ' +
      siteData.site.id +
      '  |  Location: ' +
      (siteData.site.location || 'Main Operational Area') +
      '  |  Scope: Site Comprehensive Sub-Report',
    PDF_THEME.margins.left + 4,
    y + 10.5
  );

  return y + 18;
}

/**
 * Renders sections 3 through 10 for an individual site within the System Complete PDF.
 */
function renderSystemSiteSections(
  doc: jsPDF,
  data: SiteExportData,
  meta: BaseReportMetadata,
  initialY: number,
  username: string
): number {
  const siteCodeLabel = data.site.code ? ' (' + data.site.code + ')' : '';
  const suffix = ' — ' + data.site.name;

  let curY = initialY;

  // 3. SITE PROFILE & OPERATIONAL SCOPE
  curY = drawSectionHeading(doc, curY, '3. SITE PROFILE & OPERATIONAL SCOPE' + suffix);
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Attribute', 'Details', 'Operational Status']],
    body: [
      ['Site Name & Identifier', data.site.name + siteCodeLabel, 'Active Construction Project'],
      ['Database Site ID', data.site.id, 'Verified Database Identity'],
      ['Project Location', data.site.location || 'Main Operational Area', 'Jurisdiction Verified'],
      ['Reporting History Span', data.period.label, data.period.isUnbounded ? 'Full Project Lifetime' : 'Filtered Period'],
      [
        'Attendance & Ledger Activity',
        data.attendanceRecords.length + ' worker logs recorded',
        data.financialRecords.length + ' financial transactions recorded',
      ],
    ],
  });

  // 4. WORKFORCE ROLE BREAKDOWN & LABOUR DEPLOYMENT
  curY = ensureSpace(doc, 40);
  curY = drawSectionHeading(doc, curY, '4. WORKFORCE ROLE BREAKDOWN & LABOUR DEPLOYMENT' + suffix);
  if (data.roleRollup.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Role Name', 'Category', 'Full Days', 'Half Days', 'Worker-Days', 'Labour Cost (INR)']],
      body: [[{ content: 'No workforce attendance recorded for this site.', colSpan: 6, styles: { halign: 'center', fontStyle: 'italic' } }]],
    });
  } else {
    const roleRows: RowInput[] = data.roleRollup.map((r) => [
      r.roleName,
      r.categoryName,
      String(r.fullDays),
      String(r.halfDays),
      r.workerDays.toFixed(1),
      { content: formatPDFCurrency(r.totalCostPaise), styles: { halign: 'right' } },
    ]);
    roleRows.push([
      { content: 'TOTAL LABOUR ROLLUP', colSpan: 4, styles: { fontStyle: 'bold' } },
      { content: data.totalWorkerDays.toFixed(1), styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(data.totalLabourCostPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ]);
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Role Name', 'Category', 'Full', 'Half', 'W-Days', 'Labour Cost (INR)']],
      body: roleRows,
    });
  }

  // 5. WORK CATEGORY SUMMARY & COST ALLOCATION
  curY = ensureSpace(doc, 40);
  curY = drawSectionHeading(doc, curY, '5. WORK CATEGORY SUMMARY & COST ALLOCATION' + suffix);
  if (data.categoryRollup.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Category Name', 'Worker-Days', 'Shift Breakdown', 'Labour Outlay (INR)', 'Share %']],
      body: [[{ content: 'No category attendance recorded for this site.', colSpan: 5, styles: { halign: 'center', fontStyle: 'italic' } }]],
    });
  } else {
    const catRows: RowInput[] = data.categoryRollup.map((c) => {
      const share =
        data.totalLabourCostPaise > 0
          ? ((c.totalCostPaise / data.totalLabourCostPaise) * 100).toFixed(1) + '%'
          : '0.0%';
      return [
        c.categoryName,
        c.workerDays.toFixed(1),
        c.fullDays + ' Full + ' + c.halfDays + ' Half',
        { content: formatPDFCurrency(c.totalCostPaise), styles: { halign: 'right' } },
        { content: share, styles: { halign: 'right' } },
      ];
    });
    catRows.push([
      { content: 'TOTAL CATEGORY DEPLOYMENT', styles: { fontStyle: 'bold' } },
      { content: data.totalWorkerDays.toFixed(1), styles: { fontStyle: 'bold' } },
      '',
      { content: formatPDFCurrency(data.totalLabourCostPaise), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: '100.0%', styles: { fontStyle: 'bold', halign: 'right' } },
    ]);
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Category Name', 'W-Days', 'Shifts', 'Labour Cost (INR)', 'Cost Share']],
      body: catRows,
    });
  }

  // 6. DAILY ATTENDANCE OPERATIONAL LOG
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '6. DAILY ATTENDANCE OPERATIONAL LOG' + suffix);
  if (data.attendanceRecords.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Role & Category', 'Daily Rate', 'Shifts Recorded', 'Worker-Days', 'Daily Cost (INR)']],
      body: [[{ content: 'No daily attendance logs recorded for this site.', colSpan: 6, styles: { halign: 'center', fontStyle: 'italic' } }]],
    });
  } else {
    const attRows: RowInput[] = data.attendanceRecords.slice(0, 300).map((r) => [
      r.date,
      (r.role_name || 'Role') + '\n(' + (r.category_name || 'Category') + ')',
      formatPDFCurrency(r.rate_snapshot_paise),
      r.full_day_count + ' Full + ' + r.half_day_count + ' Half',
      r.worker_days.toFixed(1),
      { content: formatPDFCurrency(r.total_cost_paise), styles: { halign: 'right' } },
    ]);
    if (data.attendanceRecords.length > 300) {
      attRows.push([
        {
          content:
            '... and ' +
            (data.attendanceRecords.length - 300) +
            ' additional daily records (see full Excel/JSON data)',
          colSpan: 6,
          styles: { fontStyle: 'italic', halign: 'center' },
        },
      ]);
    }
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Role & Category', 'Daily Rate', 'Shifts', 'W-Days', 'Daily Cost']],
      body: attRows,
    });
  }

  // 7. FINANCIAL STATEMENT & CASH FLOW POSITION
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '7. FINANCIAL STATEMENT & CASH FLOW POSITION' + suffix);
  const fin = data.financialSummary;
  const finRows: RowInput[] = [
    ['Opening Cash Balance (Carried Forward)', formatPDFCurrency(data.openingBalancePaise)],
    ['Total Inflows / Credits Received', formatPDFCurrency(fin.totalCreditPaise)],
    ['Total Site Expenses / Debits Outlay', '(' + formatPDFCurrency(fin.totalDebitPaise) + ')'],
    [
      { content: 'Net Operational Cash Balance', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(data.closingBalancePaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ],
  ];
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Financial Position Metric', 'Reconciliation Amount (INR)']],
    body: finRows,
  });

  // 8. DEBIT EXPENSES BREAKDOWN BY CATEGORY
  curY = ensureSpace(doc, 40);
  curY = drawSectionHeading(doc, curY, '8. DEBIT EXPENSES BREAKDOWN BY CATEGORY' + suffix);
  const debitBreakdownEntries: Array<[string, number]> = (
    [
      ['Materials & Supplies', fin.suppliesDebitPaise],
      ['Special Worker Tasks & Overtime', fin.specialWorkerTaskDebitPaise],
    ] as Array<[string, number]>
  ).filter(([_, amount]) => amount > 0);
  if (debitBreakdownEntries.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Expense Category', 'Total Outflow (INR)', 'Share %']],
      body: [[{ content: 'No debit expenses recorded for this site.', colSpan: 3, styles: { halign: 'center', fontStyle: 'italic' } }]],
    });
  } else {
    const debitRows: RowInput[] = debitBreakdownEntries.map(([cat, amount]) => {
      const share =
        fin.totalDebitPaise > 0 ? ((amount / fin.totalDebitPaise) * 100).toFixed(1) + '%' : '0.0%';
      return [
        cat.toUpperCase(),
        { content: formatPDFCurrency(amount), styles: { halign: 'right' } },
        { content: share, styles: { halign: 'right' } },
      ];
    });
    debitRows.push([
      { content: 'TOTAL DEBIT OUTLAY', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(fin.totalDebitPaise), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: '100.0%', styles: { fontStyle: 'bold', halign: 'right' } },
    ]);
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Expense Category', 'Total Outflow (INR)', 'Share of Debits']],
      body: debitRows,
    });
  }

  // 9. FINANCIAL TRANSACTIONS LEDGER
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '9. FINANCIAL TRANSACTIONS LEDGER' + suffix);
  if (data.financialRecords.length === 0) {
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Type', 'Category', 'Description', 'Inflow', 'Outflow', 'Running Balance']],
      body: [
        [
          {
            content: 'No financial transactions recorded for this site.',
            colSpan: 7,
            styles: { halign: 'center', fontStyle: 'italic' },
          },
        ],
      ],
    });
  } else {
    let running = data.openingBalancePaise;
    const txRows: RowInput[] = data.financialRecords.slice(0, 300).map((t) => {
      if (t.type === 'CREDIT') running += t.amount_paise;
      else running -= t.amount_paise;

      return [
        t.date,
        t.type,
        t.debit_category || 'CREDIT',
        t.description,
        t.type === 'CREDIT' ? { content: formatPDFCurrency(t.amount_paise), styles: { halign: 'right' } } : '-',
        t.type === 'DEBIT' ? { content: formatPDFCurrency(t.amount_paise), styles: { halign: 'right' } } : '-',
        { content: formatPDFCurrency(running), styles: { halign: 'right', fontStyle: 'bold' } },
      ];
    });
    if (data.financialRecords.length > 300) {
      txRows.push([
        {
          content:
            '... and ' +
            (data.financialRecords.length - 300) +
            ' additional ledger records (see full Excel/JSON data)',
          colSpan: 7,
          styles: { fontStyle: 'italic', halign: 'center' },
        },
      ]);
    }
    autoTable(doc, {
      ...getBaseTableOptions(doc, meta, 'portrait', curY),
      head: [['Date', 'Type', 'Category', 'Description', 'Inflow', 'Outflow', 'Balance']],
      body: txRows,
    });
  }

  // 10. SITE REPORT VERIFICATION & AUDIT METADATA
  curY = ensureSpace(doc, 30);
  curY = drawSectionHeading(doc, curY, '10. SITE REPORT VERIFICATION & AUDIT METADATA' + suffix);
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Metadata Field', 'Value']],
    body: [
      ['Site Authority Scope', data.site.name + siteCodeLabel],
      ['Database Site ID', data.site.id],
      ['Reporting Temporal Bounds', data.period.label],
      ['Generated At (UTC/Local)', meta.generatedAt || 'N/A'],
      ['Generated By Authorized User', meta.generatedBy || username],
      [
        'Audited Record Quantities',
        data.attendanceRecords.length + ' Attendance Records, ' + data.financialRecords.length + ' Transactions',
      ],
      ['Verification Status', 'Audited & Reconciled'],
    ],
  });

  return (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : curY + 10;
}

/**
 * Generates an exhaustive, enterprise-grade Consolidated Complete System Report PDF across all accessible sites.
 * Required structure:
 * 1. Enterprise Executive Summary
 * 2. All Sites Performance & Financial Reconciliation
 * Then for EACH authorized system site:
 * 3. SITE PROFILE & OPERATIONAL SCOPE
 * 4. WORKFORCE ROLE BREAKDOWN & LABOUR DEPLOYMENT
 * 5. WORK CATEGORY SUMMARY & COST ALLOCATION
 * 6. DAILY ATTENDANCE OPERATIONAL LOG
 * 7. FINANCIAL STATEMENT & CASH FLOW POSITION
 * 8. DEBIT EXPENSES BREAKDOWN BY CATEGORY
 * 9. FINANCIAL TRANSACTIONS LEDGER
 * 10. SITE REPORT VERIFICATION & AUDIT METADATA
 * Finally:
 * 11. ENTERPRISE CONSOLIDATED TOTALS
 * 12. ENTERPRISE REPORT VERIFICATION & AUDIT METADATA
 */
export function generateSystemCompletePDF(data: SystemExportData, username = 'System Administrator'): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const meta: BaseReportMetadata = {
    siteName: 'ENTERPRISE SYSTEM',
    siteCode: 'ALL-SITES',
    reportTitle: 'COMPLETE SYSTEM REPORT',
    periodLabel: data.period.label,
    generatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    generatedBy: username,
    filtersSummary: 'Scope: All Active Sites (' + data.sitesData.length + ') | Period: ' + data.period.label,
  };

  const startY = drawDocumentHeader(doc, meta, 'portrait');

  // Enterprise KPI Strip
  const totalOutlayPaise = data.aggregatedSummary.totalLabourCostPaise + data.aggregatedSummary.totalDebitsPaise;
  const kpiHeight = 20;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, kpiHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const col1 = PDF_THEME.margins.left + 4;
  const col2 = PDF_THEME.margins.left + 65;
  const col3 = PDF_THEME.margins.left + 125;

  doc.text('SYSTEM-WIDE WORKFORCE', col1, startY + 4.8);
  doc.text('CONSOLIDATED CASH FLOW', col2, startY + 4.8);
  doc.text('TOTAL SYSTEM EXPENDITURE', col3, startY + 4.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_THEME.colors.textMuted);

  doc.text('Active Projects: ' + data.aggregatedSummary.totalSites, col1, startY + 9.5);
  doc.text('Total Worker-Days: ' + data.aggregatedSummary.totalWorkerDays.toFixed(1), col1, startY + 13.8);
  doc.text('System Labour Cost: ' + formatPDFCurrency(data.aggregatedSummary.totalLabourCostPaise), col1, startY + 18);

  doc.text('System Inflows: ' + formatPDFCurrency(data.aggregatedSummary.totalCreditsPaise), col2, startY + 9.5);
  doc.text('System Outflows: ' + formatPDFCurrency(data.aggregatedSummary.totalDebitsPaise), col2, startY + 13.8);
  doc.text('Net Cash Balance: ' + formatPDFCurrency(data.aggregatedSummary.netClosingBalancePaise), col2, startY + 18);

  doc.text('Consolidated Outlay:', col3, startY + 9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_THEME.colors.accent);
  doc.text(formatPDFCurrency(totalOutlayPaise), col3, startY + 14.5);

  let curY = startY + kpiHeight + 4;

  // 1. Enterprise Executive Summary
  curY = drawSectionHeading(doc, curY, '1. ENTERPRISE EXECUTIVE SUMMARY');
  const activeSitesCount = data.sitesData.filter(
    (s) => s.attendanceRecords.length > 0 || s.financialRecords.length > 0
  ).length;
  const idleSitesCount = data.sitesData.length - activeSitesCount;

  const execSummaryRows: RowInput[] = [
    ['Enterprise Authority Scope', 'All Managed Project Sites (' + data.sitesData.length + ' Total Sites)'],
    ['Active Reporting Period', data.period.label],
    [
      'Operational Sites Breakdown',
      activeSitesCount + ' Active Operational Sites, ' + idleSitesCount + ' Zero-Activity Sites',
    ],
    ['Consolidated Workforce Days', data.aggregatedSummary.totalWorkerDays.toFixed(1) + ' Worker-Days'],
    ['Total Consolidated Labour Cost', formatPDFCurrency(data.aggregatedSummary.totalLabourCostPaise)],
    ['Total Financial Inflows (Credits)', formatPDFCurrency(data.aggregatedSummary.totalCreditsPaise)],
    ['Total Financial Outflows (Debits)', formatPDFCurrency(data.aggregatedSummary.totalDebitsPaise)],
    ['Net Enterprise Cash Position', formatPDFCurrency(data.aggregatedSummary.netClosingBalancePaise)],
    ['Total Enterprise Operational Outlay', formatPDFCurrency(totalOutlayPaise)],
  ];
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    styles: {
      ...getBaseTableOptions(doc, meta, 'portrait', curY).styles,
      fontSize: 8,
      cellPadding: { top: 1.4, bottom: 1.4, left: 2.5, right: 2.5 },
    },
    headStyles: {
      ...getBaseTableOptions(doc, meta, 'portrait', curY).headStyles,
      fontSize: 8,
      cellPadding: { top: 1.6, bottom: 1.6, left: 2.5, right: 2.5 },
    },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 112 },
    },
    head: [['Enterprise Performance Metric', 'Consolidated System Metric Value']],
    body: execSummaryRows,
  });

  // 2. All Sites Performance & Financial Reconciliation
  curY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 4 : curY + 8;
  curY = drawSectionHeading(doc, curY, '2. ALL SITES PERFORMANCE & FINANCIAL RECONCILIATION');
  const siteRows: RowInput[] = data.sitesData.map((s) => [
    s.site.name,
    s.site.id,
    s.site.code || '-',
    s.totalWorkerDays.toFixed(1),
    { content: formatPDFCurrency(s.totalLabourCostPaise), styles: { halign: 'right' } },
    { content: formatPDFCurrency(s.financialSummary.totalCreditPaise), styles: { halign: 'right' } },
    { content: formatPDFCurrency(s.financialSummary.totalDebitPaise), styles: { halign: 'right' } },
    { content: formatPDFCurrency(s.closingBalancePaise), styles: { halign: 'right', fontStyle: 'bold' } },
  ]);
  siteRows.push([
    { content: 'CONSOLIDATED SYSTEM TOTAL', colSpan: 3, styles: { fontStyle: 'bold' } },
    { content: data.aggregatedSummary.totalWorkerDays.toFixed(1), styles: { fontStyle: 'bold' } },
    { content: formatPDFCurrency(data.aggregatedSummary.totalLabourCostPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    { content: formatPDFCurrency(data.aggregatedSummary.totalCreditsPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    { content: formatPDFCurrency(data.aggregatedSummary.totalDebitsPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    { content: formatPDFCurrency(data.aggregatedSummary.netClosingBalancePaise), styles: { fontStyle: 'bold', halign: 'right' } },
  ]);
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    styles: {
      ...getBaseTableOptions(doc, meta, 'portrait', curY).styles,
      fontSize: 7.5,
      cellPadding: { top: 1.4, bottom: 1.4, left: 1.5, right: 1.5 },
    },
    headStyles: {
      ...getBaseTableOptions(doc, meta, 'portrait', curY).headStyles,
      fontSize: 7.5,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 },
    },
    columnStyles: {
      0: { cellWidth: 35 }, // Project Site
      1: { cellWidth: 37 }, // Site ID
      2: { cellWidth: 14 }, // Code
      3: { cellWidth: 16, halign: 'right' }, // W-Days
      4: { cellWidth: 20, halign: 'right' }, // Labour Cost
      5: { cellWidth: 20, halign: 'right' }, // Inflows
      6: { cellWidth: 20, halign: 'right' }, // Outflows
      7: { cellWidth: 20, halign: 'right' }, // Closing Cash
    },
    head: [['Project Site', 'Site ID', 'Code', 'W-Days', 'Labour Cost', 'Inflows', 'Outflows', 'Closing Cash']],
    body: siteRows,
  });

  // For EACH authorized system site:
  // Render Site Divider Banner + sections 3 through 10
  for (let i = 0; i < data.sitesData.length; i++) {
    const s = data.sitesData[i];
    doc.addPage();
    const siteBannerY = drawSiteDividerBanner(doc, s, i, data.sitesData.length);
    renderSystemSiteSections(doc, s, meta, siteBannerY, username);
  }

  // Finally: Sections 11 and 12
  doc.addPage();
  curY = PDF_THEME.margins.top + 5;

  // 11. ENTERPRISE CONSOLIDATED TOTALS
  curY = drawSectionHeading(doc, curY, '11. ENTERPRISE CONSOLIDATED TOTALS');
  const enterpriseTotalsRows: RowInput[] = [
    [
      'Total Authorized Project Sites',
      data.sitesData.length +
        ' Managed Sites (' +
        activeSitesCount +
        ' Active, ' +
        idleSitesCount +
        ' Zero-Activity)',
    ],
    ['Consolidated Workforce Days', data.aggregatedSummary.totalWorkerDays.toFixed(1) + ' Worker-Days'],
    ['Total System Labour Outlay', formatPDFCurrency(data.aggregatedSummary.totalLabourCostPaise)],
    ['Total System Inflows (Credits)', formatPDFCurrency(data.aggregatedSummary.totalCreditsPaise)],
    ['Total System Expenses (Debits)', formatPDFCurrency(data.aggregatedSummary.totalDebitsPaise)],
    [
      { content: 'Net Consolidated System Cash Balance', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(data.aggregatedSummary.netClosingBalancePaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ],
    [
      { content: 'Total Consolidated Enterprise Outlay (Labour + Debits)', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(totalOutlayPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ],
  ];
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Enterprise Performance Dimension', 'Consolidated Value (INR / Units)']],
    body: enterpriseTotalsRows,
  });

  // 12. ENTERPRISE REPORT VERIFICATION & AUDIT METADATA
  curY = ensureSpace(doc, 45);
  curY = drawSectionHeading(doc, curY, '12. ENTERPRISE REPORT VERIFICATION & AUDIT METADATA');
  const totalSystemAttendance = data.sitesData.reduce((acc, s) => acc + s.attendanceRecords.length, 0);
  const totalSystemTransactions = data.sitesData.reduce((acc, s) => acc + s.financialRecords.length, 0);

  const enterpriseAuditRows: RowInput[] = [
    ['Report Document Title', meta.reportTitle],
    ['Enterprise Authority Scope', 'All Authorized Managed Sites (' + data.sitesData.length + ' Sites)'],
    ['Verified Site Identities (IDs)', data.sitesData.map((s) => s.site.id).join(', ')],
    ['Reporting Temporal Bounds', data.period.label],
    [
      'Audited Record Totals',
      totalSystemAttendance +
        ' Total Attendance Logs, ' +
        totalSystemTransactions +
        ' Total Financial Transactions across ' +
        data.sitesData.length +
        ' Sites',
    ],
    ['Generation Timestamp (UTC/Local)', meta.generatedAt || 'N/A'],
    ['Authorized System Auditor', meta.generatedBy || 'N/A'],
    ['Cryptographic & Integrity Status', 'Verified Authentic, Multi-Site Isolated & Reconciled'],
  ];
  autoTable(doc, {
    ...getBaseTableOptions(doc, meta, 'portrait', curY),
    head: [['Metadata Field', 'Enterprise Audit Record']],
    body: enterpriseAuditRows,
  });

  // Stamp running footers across ALL pages
  applyDocumentFooters(doc, meta, 'portrait');

  return Buffer.from(doc.output('arraybuffer'));
}
