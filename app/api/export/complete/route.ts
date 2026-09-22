import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getSiteById, getAllSites } from '@/lib/db/repositories/site-repo';
import { logAudit } from '@/lib/audit/logger';
import {
  resolveExportPeriod,
  getScopeHistoricalDateBounds,
  collectSiteExportData,
  collectSystemExportData,
  generateSiteCompleteJSON,
  generateSystemCompleteJSON,
  generateSiteCompletePDF,
  generateSystemCompletePDF,
  generateCompleteSiteExcel,
  generateCompleteSystemExcel,
  createCompleteExportZip,
  createFullReportZip,
  ExportScope,
  PeriodPreset,
  ExportManifest,
} from '@/lib/export/complete';
import { sanitizeReportFilename, buildContentDispositionHeader } from '@/lib/export/pdf/filename';
import { generateReportBundle } from '@/lib/reports/bundle';
import { REPORT_DEFINITIONS, ReportType } from '@/lib/reports/registry';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  let session: any = null;
  let requestedScope: ExportScope = 'SITE';
  let targetSiteId: string | undefined;

  try {
    // 1. Authenticate user
    session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    // 2. Viewer accounts are strictly forbidden from Complete Export
    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Complete export is restricted to Administrators and Engineers.' },
        { status: 403 }
      );
    }

    // 3. Parse JSON Body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const {
      scope,
      siteId,
      period = 'ALL_DATA',
      from,
      to,
      startDate,
      endDate,
      format = 'ZIP',
      formats = ['PDF', 'EXCEL', 'JSON'],
      reportType,
      type,
    } = body;

    const rawType = (reportType || type || '') as string;
    const isAllSites =
      rawType === 'ALL_SITES_CONSOLIDATED' ||
      rawType === 'SYSTEM_COMPLETE' ||
      scope === 'ALL_SITES' ||
      scope === 'SYSTEM' ||
      siteId === 'ALL';

    requestedScope = isAllSites ? 'SYSTEM' : ((scope as ExportScope) || (session.role === 'ADMIN' && !siteId ? 'SYSTEM' : 'SITE'));
    targetSiteId = isAllSites ? undefined : siteId;

    // 4. Validate Scope & RBAC
    if (requestedScope !== 'SYSTEM' && requestedScope !== 'SITE') {
      return NextResponse.json({ error: 'Invalid scope. Must be SYSTEM or SITE.' }, { status: 400 });
    }

    const isGlobalAdmin =
      session.role === 'ADMIN' ||
      session.authorityTier === 'KING_MAKER' ||
      session.authorityTier === 'SUPERIOR_PRIME';

    let authorizedSiteIds: string[] | undefined;

    if (requestedScope === 'SYSTEM') {
      const allDbSites = getAllSites();
      const authorizedSites = isGlobalAdmin
        ? allDbSites
        : allDbSites.filter((s) => session.assignedSiteIds?.includes(s.id));

      if (authorizedSites.length === 0) {
        return NextResponse.json(
          { error: 'No authorized sites available for consolidated export.' },
          { status: 403 }
        );
      }
      authorizedSiteIds = isGlobalAdmin ? undefined : authorizedSites.map((s) => s.id);
    } else if (requestedScope === 'SITE') {
      if (!siteId || typeof siteId !== 'string' || !siteId.trim() || siteId === 'ALL') {
        return NextResponse.json({ error: 'siteId is required for site-level export' }, { status: 400 });
      }

      const site = getSiteById(siteId.trim());
      if (!site) {
        return NextResponse.json({ error: 'Site not found' }, { status: 404 });
      }

      // Check Engineer authorization for this specific site
      if (session.role !== 'ADMIN' && !session.assignedSiteIds.includes(siteId.trim())) {
        return NextResponse.json(
          { error: 'You are not authorized to export data for this site.' },
          { status: 403 }
        );
      }
    }

    const effectiveFrom = from || startDate;
    const effectiveTo = to || endDate;

    // 5. Validate Date Parameters for CUSTOM period
    if (period === 'CUSTOM' || (effectiveFrom && effectiveTo)) {
      if (period === 'CUSTOM') {
        if (!effectiveFrom || !DATE_REGEX.test(effectiveFrom)) {
          return NextResponse.json(
            { error: 'Invalid or missing "from" date. Format: YYYY-MM-DD' },
            { status: 400 }
          );
        }
        if (!effectiveTo || !DATE_REGEX.test(effectiveTo)) {
          return NextResponse.json(
            { error: 'Invalid or missing "to" date. Format: YYYY-MM-DD' },
            { status: 400 }
          );
        }
      }
      if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
        return NextResponse.json(
          { error: '"from" date cannot be after "to" date.' },
          { status: 400 }
        );
      }
    }

    // 6. Resolve Period with true historical boundaries
    const dateBounds = getScopeHistoricalDateBounds(requestedScope === 'SITE' ? targetSiteId : authorizedSiteIds);
    const resolvedPeriod = resolveExportPeriod(
      period as PeriodPreset,
      effectiveFrom,
      effectiveTo,
      dateBounds
    );

    // 7. Audit Log Request
    logAudit({
      entityType: 'EXPORT',
      entityId: targetSiteId || 'SYSTEM',
      action: 'COMPLETE_EXPORT_REQUESTED',
      siteId: targetSiteId || null,
      userId: session.userId,
      beforeState: null,
      afterState: {
        scope: requestedScope,
        siteId: targetSiteId,
        period: resolvedPeriod.preset,
        periodLabel: resolvedPeriod.label,
        format,
        formats,
      },
    });

    const sessionUserInfo = {
      id: session.userId,
      username: session.username,
      role: session.role,
    };

    // 7b. Check if Full Report ZIP or multi-report bundle is requested
    const isFullReportZip =
      format === 'FULL_REPORT_ZIP' ||
      format === 'FULL_ZIP' ||
      (Array.isArray(body.reportTypes) && body.reportTypes.length > 0);

    if (isFullReportZip) {
      const requestedReportTypes: ReportType[] =
        Array.isArray(body.reportTypes) && body.reportTypes.length > 0
          ? body.reportTypes
          : (Object.keys(REPORT_DEFINITIONS) as ReportType[]);

      const bundle = await generateReportBundle({
        scope: requestedScope === 'SYSTEM' ? 'ALL_SITES' : 'SITE',
        siteId: targetSiteId,
        startDate: effectiveFrom,
        endDate: effectiveTo,
        periodPreset: resolvedPeriod.preset as any,
        reportTypes: requestedReportTypes,
        includePdf: true,
        includeExcel: true,
        session,
      });

      const zipBuf = await createFullReportZip({
        baseName: (bundle.siteName || 'Consolidated_Sites').replace(/[^a-zA-Z0-9_\-]/g, '_'),
        scope: bundle.scope,
        siteName: bundle.siteName,
        siteCode: bundle.siteCode,
        siteId: bundle.siteId,
        period: {
          preset: bundle.period.preset,
          from: bundle.period.startDate || null,
          to: bundle.period.endDate || null,
          label: bundle.period.label,
        },
        generatedBy: sessionUserInfo,
        reports: bundle.reports,
      });

      const zipFilename = sanitizeReportFilename(
        bundle.siteName || 'All_Sites',
        `full_report_archive_${bundle.period.preset}`,
        'zip'
      );

      logAudit({
        entityType: 'EXPORT',
        entityId: targetSiteId || 'SYSTEM',
        action: 'COMPLETE_EXPORT_GENERATED',
        siteId: targetSiteId || null,
        userId: session.userId,
        beforeState: null,
        afterState: {
          format: 'FULL_REPORT_ZIP',
          bytes: zipBuf.length,
          reportCount: bundle.reports.length,
          reports: bundle.reports.map((r) => r.reportType),
        },
      });

      return new Response(new Uint8Array(zipBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': buildContentDispositionHeader(zipFilename),
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    }

    // 8. Collect data and generate requested artifacts
    if (requestedScope === 'SITE') {
      const site = getSiteById(targetSiteId!)!;
      const siteExportData = collectSiteExportData(site.id, resolvedPeriod);
      const baseFilename = `${site.name}_${resolvedPeriod.preset}_${resolvedPeriod.startDate || 'START'}_to_${resolvedPeriod.endDate || 'END'}`;

      const meta = {
        siteName: site.name,
        siteCode: site.code,
        reportTitle: `Complete Site Report — ${site.name}`,
        periodLabel: resolvedPeriod.label,
        generatedBy: session.username,
        generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      };

      // Handle standalone formats if requested
      if (format === 'JSON') {
        const jsonStr = generateSiteCompleteJSON(siteExportData, session.username);
        const jsonBuf = Buffer.from(jsonStr, 'utf-8');
        const filename = sanitizeReportFilename(site.name, `complete_${resolvedPeriod.preset}`, 'json');

        logAudit({
          entityType: 'EXPORT',
          entityId: site.id,
          action: 'COMPLETE_EXPORT_GENERATED',
          siteId: site.id,
          userId: session.userId,
          beforeState: null,
          afterState: { format: 'JSON', bytes: jsonBuf.length },
        });

        return new Response(new Uint8Array(jsonBuf), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': buildContentDispositionHeader(filename),
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          },
        });
      }

      if (format === 'PDF') {
        const pdfBuf = generateSiteCompletePDF(siteExportData, session.username);
        const filename = sanitizeReportFilename(site.name, `complete_${resolvedPeriod.preset}`, 'pdf');

        logAudit({
          entityType: 'EXPORT',
          entityId: site.id,
          action: 'COMPLETE_EXPORT_GENERATED',
          siteId: site.id,
          userId: session.userId,
          beforeState: null,
          afterState: { format: 'PDF', bytes: pdfBuf.length },
        });

        return new Response(new Uint8Array(pdfBuf), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': buildContentDispositionHeader(filename),
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          },
        });
      }

      if (format === 'EXCEL') {
        const excelBuf = await generateCompleteSiteExcel(siteExportData, meta);
        const filename = sanitizeReportFilename(site.name, `complete_${resolvedPeriod.preset}`, 'xlsx');

        logAudit({
          entityType: 'EXPORT',
          entityId: site.id,
          action: 'COMPLETE_EXPORT_GENERATED',
          siteId: site.id,
          userId: session.userId,
          beforeState: null,
          afterState: { format: 'EXCEL', bytes: excelBuf.length },
        });

        return new Response(new Uint8Array(excelBuf), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': buildContentDispositionHeader(filename),
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
          },
        });
      }

      // Default: Package into ZIP
      const formatsToInclude = Array.isArray(formats) && formats.length > 0 ? formats : ['PDF', 'EXCEL', 'JSON'];
      let jsonBuf: Buffer | undefined;
      let pdfBuf: Buffer | undefined;
      let excelBuf: Buffer | undefined;

      if (formatsToInclude.includes('JSON')) {
        const jsonStr = generateSiteCompleteJSON(siteExportData, session.username);
        jsonBuf = Buffer.from(jsonStr, 'utf-8');
      }

      if (formatsToInclude.includes('PDF')) {
        pdfBuf = generateSiteCompletePDF(siteExportData, session.username);
      }

      if (formatsToInclude.includes('EXCEL')) {
        excelBuf = await generateCompleteSiteExcel(siteExportData, meta);
      }

      const manifest: ExportManifest = {
        application: 'SITE WORK Enterprise System',
        exportVersion: 1,
        exportType: 'COMPLETE_SITE',
        generatedAt: new Date().toISOString(),
        generatedBy: sessionUserInfo,
        scope: {
          type: 'SITE',
          siteId: site.id,
          siteName: site.name,
          siteCode: site.code,
        },
        period: {
          preset: resolvedPeriod.preset,
          from: resolvedPeriod.startDate || null,
          to: resolvedPeriod.endDate || null,
          label: resolvedPeriod.label,
        },
        formatsIncluded: formatsToInclude,
        recordCounts: {
          attendanceRecords: siteExportData.attendanceRecords.length,
          financialTransactions: siteExportData.financialRecords.length,
          workRoles: siteExportData.roles.length,
          workCategories: siteExportData.categories.length,
          sites: 1,
        },
        files: [],
      };

      const zipBuf = await createCompleteExportZip({
        baseName: baseFilename.replace(/[^a-zA-Z0-9_\-]/g, '_'),
        manifest,
        jsonBuffer: jsonBuf,
        pdfBuffer: pdfBuf,
        excelBuffer: excelBuf,
      });

      const zipFilename = sanitizeReportFilename(site.name, `complete_archive_${resolvedPeriod.preset}`, 'zip');

      logAudit({
        entityType: 'EXPORT',
        entityId: site.id,
        action: 'COMPLETE_EXPORT_GENERATED',
        siteId: site.id,
        userId: session.userId,
        beforeState: null,
        afterState: { format: 'ZIP', bytes: zipBuf.length, formatsIncluded: formatsToInclude },
      });

      return new Response(new Uint8Array(zipBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': buildContentDispositionHeader(zipFilename),
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    }

    // requestedScope === 'SYSTEM'
    const systemExportData = collectSystemExportData(resolvedPeriod, authorizedSiteIds);
    const baseFilename = `System_Wide_${resolvedPeriod.preset}_${resolvedPeriod.startDate || 'START'}_to_${resolvedPeriod.endDate || 'END'}`;

    const meta = {
      siteName: 'Enterprise All Sites',
      siteCode: 'ALL',
      reportTitle: 'Complete Enterprise System Report',
      periodLabel: resolvedPeriod.label,
      generatedBy: session.username,
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    if (format === 'JSON') {
      const jsonStr = generateSystemCompleteJSON(systemExportData, session.username);
      const jsonBuf = Buffer.from(jsonStr, 'utf-8');
      const filename = sanitizeReportFilename('Enterprise_System', `complete_${resolvedPeriod.preset}`, 'json');

      logAudit({
        entityType: 'EXPORT',
        entityId: 'SYSTEM',
        action: 'COMPLETE_EXPORT_GENERATED',
        siteId: null,
        userId: session.userId,
        beforeState: null,
        afterState: { format: 'JSON', bytes: jsonBuf.length },
      });

      return new Response(new Uint8Array(jsonBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': buildContentDispositionHeader(filename),
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    }

    if (format === 'PDF') {
      const pdfBuf = generateSystemCompletePDF(systemExportData, session.username);
      const filename = sanitizeReportFilename('Enterprise_System', `complete_${resolvedPeriod.preset}`, 'pdf');

      logAudit({
        entityType: 'EXPORT',
        entityId: 'SYSTEM',
        action: 'COMPLETE_EXPORT_GENERATED',
        siteId: null,
        userId: session.userId,
        beforeState: null,
        afterState: { format: 'PDF', bytes: pdfBuf.length },
      });

      return new Response(new Uint8Array(pdfBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': buildContentDispositionHeader(filename),
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    }

    if (format === 'EXCEL') {
      const excelBuf = await generateCompleteSystemExcel(systemExportData, meta);
      const filename = sanitizeReportFilename('Enterprise_System', `complete_${resolvedPeriod.preset}`, 'xlsx');

      logAudit({
        entityType: 'EXPORT',
        entityId: 'SYSTEM',
        action: 'COMPLETE_EXPORT_GENERATED',
        siteId: null,
        userId: session.userId,
        beforeState: null,
        afterState: { format: 'EXCEL', bytes: excelBuf.length },
      });

      return new Response(new Uint8Array(excelBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': buildContentDispositionHeader(filename),
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      });
    }

    // Default ZIP for System
    const formatsToInclude = Array.isArray(formats) && formats.length > 0 ? formats : ['PDF', 'EXCEL', 'JSON'];
    let jsonBuf: Buffer | undefined;
    let pdfBuf: Buffer | undefined;
    let excelBuf: Buffer | undefined;

    if (formatsToInclude.includes('JSON')) {
      const jsonStr = generateSystemCompleteJSON(systemExportData, session.username);
      jsonBuf = Buffer.from(jsonStr, 'utf-8');
    }

    if (formatsToInclude.includes('PDF')) {
      pdfBuf = generateSystemCompletePDF(systemExportData, session.username);
    }

    if (formatsToInclude.includes('EXCEL')) {
      excelBuf = await generateCompleteSystemExcel(systemExportData, meta);
    }

    const totalAttendanceRecs = systemExportData.sitesData.reduce((s, sd) => s + sd.attendanceRecords.length, 0);
    const totalFinRecs = systemExportData.sitesData.reduce((s, sd) => s + sd.financialRecords.length, 0);

    const manifest: ExportManifest = {
      application: 'SITE WORK Enterprise System',
      exportVersion: 1,
      exportType: 'COMPLETE_SYSTEM',
      generatedAt: new Date().toISOString(),
      generatedBy: sessionUserInfo,
      scope: {
        type: 'SYSTEM',
        totalSites: systemExportData.aggregatedSummary.totalSites,
      },
      period: {
        preset: resolvedPeriod.preset,
        from: resolvedPeriod.startDate || null,
        to: resolvedPeriod.endDate || null,
        label: resolvedPeriod.label,
      },
      formatsIncluded: formatsToInclude,
      recordCounts: {
        attendanceRecords: totalAttendanceRecs,
        financialTransactions: totalFinRecs,
        workRoles: systemExportData.sitesData[0]?.roles.length || 0,
        workCategories: systemExportData.sitesData[0]?.categories.length || 0,
        sites: systemExportData.aggregatedSummary.totalSites,
      },
      files: [],
    };

    const zipBuf = await createCompleteExportZip({
      baseName: baseFilename.replace(/[^a-zA-Z0-9_\-]/g, '_'),
      manifest,
      jsonBuffer: jsonBuf,
      pdfBuffer: pdfBuf,
      excelBuffer: excelBuf,
    });

    const zipFilename = sanitizeReportFilename('Enterprise_System', `complete_archive_${resolvedPeriod.preset}`, 'zip');

    logAudit({
      entityType: 'EXPORT',
      entityId: 'SYSTEM',
      action: 'COMPLETE_EXPORT_GENERATED',
      siteId: null,
      userId: session.userId,
      beforeState: null,
      afterState: { format: 'ZIP', bytes: zipBuf.length, formatsIncluded: formatsToInclude },
    });

    return new Response(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': buildContentDispositionHeader(zipFilename),
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (err: unknown) {
    if (session) {
      logAudit({
        entityType: 'EXPORT',
        entityId: targetSiteId || 'SYSTEM',
        action: 'COMPLETE_EXPORT_FAILED',
        siteId: targetSiteId || null,
        userId: session.userId,
        beforeState: null,
        afterState: {
          error: err instanceof Error ? err.message : 'Unknown error',
          scope: requestedScope,
        },
      });
    }

    const msg = err instanceof Error ? err.message : 'Error generating complete export';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
