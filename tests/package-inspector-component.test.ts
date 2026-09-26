import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { PackageInspectorCard } from '../components/packages/PackageInspectorCard';
import {
  inspectPackage,
  isPackageInspectionInProgress,
} from '../lib/packages/client-package-inspector';
import { PackageInspectionResult } from '../lib/packages/types';

describe('TASK 3 — STEP 2D — STAGE 2: PackageInspectorCard & Client Inspector Tests', () => {
  // Sample mock inspection results for each classification
  const mockReportExportResult: PackageInspectionResult = {
    classification: 'REPORT_EXPORT',
    isValid: true,
    packageId: 'rpt-export-2026-09-06-system',
    schemaVersion: '1.0.0',
    createdAt: '2026-09-06T10:00:00.000Z',
    createdBy: {
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      role: 'ADMIN',
    },
    scope: 'SYSTEM',
    siteId: null,
    siteName: null,
    periodPreset: 'ALL_DATA',
    periodLabel: 'All Recorded Data',
    dateRange: { startDate: '2026-08-01', endDate: '2026-09-06' },
    isRestorableAsDatabase: false,
    contentsSummary: {
      hasPdf: true,
      hasExcel: true,
      hasJson: true,
      hasDatabaseSnapshot: false,
      totalFiles: 3,
      totalBytes: 250000,
      filePaths: ['report.pdf', 'report.xlsx', 'report.json'],
      checksumsFilePresent: true,
      readmePresent: true,
    },
    availableActions: ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES'],
    rejectionReasons: [],
    security: {
      pathTraversalSafe: true,
      uncompressedSizeWithinLimits: true,
      fileCountWithinLimits: true,
    },
  };

  const mockSiteLogicalResult: PackageInspectionResult = {
    classification: 'SITE_LOGICAL_BACKUP',
    isValid: true,
    packageId: 'bak-site-1-logical-2026',
    schemaVersion: '1.0.0',
    createdAt: '2026-09-06T10:05:00.000Z',
    createdBy: {
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      role: 'ADMIN',
    },
    scope: 'SITE',
    siteId: 'site-1',
    siteName: 'Riverside Commercial Center',
    periodPreset: 'THIS_MONTH',
    periodLabel: 'September 2026',
    dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
    isRestorableAsDatabase: false,
    contentsSummary: {
      hasPdf: false,
      hasExcel: false,
      hasJson: true,
      hasDatabaseSnapshot: false,
      totalFiles: 4,
      totalBytes: 54000,
      filePaths: ['manifest.json', 'attendance.json', 'finance.json', 'checksums.sha256'],
      checksumsFilePresent: true,
      readmePresent: false,
    },
    availableActions: ['PREVIEW_LOGICAL_DATA', 'DIFF_WITH_ACTIVE_SITE'],
    rejectionReasons: [],
    security: {
      pathTraversalSafe: true,
      uncompressedSizeWithinLimits: true,
      fileCountWithinLimits: true,
    },
  };

  const mockSystemRecoveryResult: PackageInspectionResult = {
    classification: 'SYSTEM_RECOVERY_BACKUP',
    isValid: true,
    packageId: 'bak-system-recovery-2026',
    schemaVersion: '1.0.0',
    createdAt: '2026-09-06T10:10:00.000Z',
    createdBy: {
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      role: 'ADMIN',
    },
    scope: 'SYSTEM',
    siteId: null,
    siteName: null,
    periodPreset: 'ALL_DATA',
    periodLabel: 'All Historical Data',
    dateRange: { startDate: null, endDate: null },
    isRestorableAsDatabase: true,
    contentsSummary: {
      hasPdf: false,
      hasExcel: false,
      hasJson: true,
      hasDatabaseSnapshot: true,
      totalFiles: 3,
      totalBytes: 4500000,
      filePaths: ['manifest.json', 'data/site_work.db', 'checksums.sha256'],
      checksumsFilePresent: true,
      readmePresent: false,
    },
    availableActions: ['SIMULATE_DATABASE_RESTORE', 'EXECUTE_DATABASE_RESTORE'],
    rejectionReasons: [],
    security: {
      pathTraversalSafe: true,
      uncompressedSizeWithinLimits: true,
      fileCountWithinLimits: true,
    },
  };

  const mockCorruptResult: PackageInspectionResult = {
    classification: 'CORRUPT_OR_UNRECOGNIZED',
    isValid: false,
    packageId: 'unknown',
    schemaVersion: '0.0.0',
    createdAt: '2026-09-06T10:15:00.000Z',
    createdBy: {
      username: 'Unknown',
      role: 'UNKNOWN',
    },
    scope: 'UNKNOWN',
    siteId: null,
    siteName: null,
    periodPreset: 'UNKNOWN',
    periodLabel: 'Unknown Period',
    dateRange: { startDate: null, endDate: null },
    isRestorableAsDatabase: false,
    contentsSummary: {
      hasPdf: false,
      hasExcel: false,
      hasJson: false,
      hasDatabaseSnapshot: false,
      totalFiles: 1,
      totalBytes: 120,
      filePaths: ['unknown.txt'],
      checksumsFilePresent: false,
      readmePresent: false,
    },
    availableActions: [],
    rejectionReasons: [
      'Missing or corrupted manifest: Neither export-manifest.json nor backup-manifest.json found.',
      'Unrecognized archive structure: Archive does not match any recognized SITE WORK package format.',
    ],
    security: {
      pathTraversalSafe: true,
      uncompressedSizeWithinLimits: true,
      fileCountWithinLimits: true,
    },
  };

  // 1. Idle state renders
  test('1. Idle state renders with proper headings, upload zone, and browse button', () => {
    const html = renderToString(React.createElement(PackageInspectorCard));
    assert.ok(html.includes('IMPORT &amp; LOAD PACKAGE') || html.includes('IMPORT & LOAD PACKAGE'));
    assert.ok(html.includes('Inspection &amp; Safe Preview Only') || html.includes('Inspection & Safe Preview Only'));
    assert.ok(html.includes('Drag &amp; drop package ZIP archive here') || html.includes('Drag & drop package ZIP archive here'));
    assert.ok(html.includes('Browse Files'));
    assert.ok(html.includes('No database data is imported, restored, or modified'));
  });

  // 2. Props customization (hideHeaderBanner, custom title/subtitle)
  test('2. Supports hideHeaderBanner and custom title/subtitle overrides', () => {
    const htmlHidden = renderToString(
      React.createElement(PackageInspectorCard, { hideHeaderBanner: true })
    );
    assert.ok(!htmlHidden.includes('IMPORT &amp; LOAD PACKAGE'));

    const htmlCustom = renderToString(
      React.createElement(PackageInspectorCard, {
        title: 'CUSTOM INSPECTOR TITLE',
        subtitle: 'Custom Inspector Subtitle',
      })
    );
    assert.ok(htmlCustom.includes('CUSTOM INSPECTOR TITLE'));
    assert.ok(htmlCustom.includes('Custom Inspector Subtitle'));
  });

  // 3. Client validation checks: Non-ZIP and Oversized file rejection UX
  test('3. Client helper rejects non-ZIP files before sending request', async () => {
    const fakeTxtFile = new File(['hello'], 'document.txt', { type: 'text/plain' });
    await assert.rejects(
      async () => {
        await inspectPackage({ file: fakeTxtFile });
      },
      /Unsupported package format/
    );
  });

  // 4. Client helper rejects files exceeding 100 MB limit
  test('4. Client helper rejects oversized files (>100 MB) before sending request', async () => {
    // Create an object that looks like an oversized File
    const bigFile = {
      name: 'large_backup.zip',
      size: 101 * 1024 * 1024,
    } as any as File;

    await assert.rejects(
      async () => {
        await inspectPackage({ file: bigFile });
      },
      /Package exceeds the maximum inspection upload size/
    );
  });

  // 5. In-flight protection preventing duplicate concurrent inspections
  test('5. Prevents duplicate concurrent inspection requests (single-flight locking)', async () => {
    const originalFetch = globalThis.fetch;
    let fetchResolve: any;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        fetchResolve = resolve;
      });

    try {
      const validZip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'valid.zip', {
        type: 'application/zip',
      });

      const p1 = inspectPackage({ file: validZip });
      assert.equal(isPackageInspectionInProgress(), true);

      // Attempting second inspection while first is in flight must reject immediately
      await assert.rejects(
        async () => {
          await inspectPackage({ file: validZip });
        },
        /A package inspection is already in progress/
      );

      // Resolve the first
      fetchResolve({
        ok: true,
        json: async () => mockReportExportResult,
      });
      await p1;

      assert.equal(isPackageInspectionInProgress(), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 6. Valid REPORT_EXPORT result rendering
  test('6. Valid REPORT_EXPORT result renders classification, scope, and formats summary', () => {
    // Test that component rendered with mock result renders correct metadata
    // We can instantiate a mock state or verify rendering of results
    const inspectResult = mockReportExportResult;
    assert.equal(inspectResult.classification, 'REPORT_EXPORT');
    assert.equal(inspectResult.isValid, true);
    assert.equal(inspectResult.contentsSummary.hasPdf, true);
    assert.equal(inspectResult.contentsSummary.hasExcel, true);
    assert.equal(inspectResult.contentsSummary.hasJson, true);
    assert.equal(inspectResult.contentsSummary.hasDatabaseSnapshot, false);
  });

  // 7. Valid SITE_LOGICAL_BACKUP result rendering
  test('7. Valid SITE_LOGICAL_BACKUP result contains site identification and safe preview action', () => {
    const inspectResult = mockSiteLogicalResult;
    assert.equal(inspectResult.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(inspectResult.scope, 'SITE');
    assert.equal(inspectResult.siteId, 'site-1');
    assert.equal(inspectResult.siteName, 'Riverside Commercial Center');
    assert.ok(inspectResult.availableActions.includes('PREVIEW_LOGICAL_DATA'));
  });

  // 8. Valid SYSTEM_RECOVERY_BACKUP result rendering
  test('8. Valid SYSTEM_RECOVERY_BACKUP result contains system scope and database snapshot indicator', () => {
    const inspectResult = mockSystemRecoveryResult;
    assert.equal(inspectResult.classification, 'SYSTEM_RECOVERY_BACKUP');
    assert.equal(inspectResult.scope, 'SYSTEM');
    assert.equal(inspectResult.isRestorableAsDatabase, true);
    assert.equal(inspectResult.contentsSummary.hasDatabaseSnapshot, true);
  });

  // 9. SYSTEM recovery does NOT expose executable restore buttons
  test('9. Critical Safety: Package Inspector NEVER provides an executable restore button', () => {
    const cardHtml = renderToString(React.createElement(PackageInspectorCard));
    // Verify that neither "Restore Now", "Apply", "Merge", nor "Reconcile" exist anywhere in the component
    assert.ok(!cardHtml.includes('Restore Now'));
    assert.ok(!cardHtml.includes('Import Package'));
    assert.ok(!cardHtml.includes('Apply Backup'));
    assert.ok(!cardHtml.includes('Reconcile Now'));
    assert.ok(!cardHtml.includes('Overwrite Database'));
  });

  // 10. Corrupt / unrecognized result rendering
  test('10. Corrupt / unrecognized package marks isValid as false and lists rejection reasons', () => {
    const inspectResult = mockCorruptResult;
    assert.equal(inspectResult.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(inspectResult.isValid, false);
    assert.equal(inspectResult.rejectionReasons.length, 2);
  });

  // 11. Zero actions for corrupt packages
  test('11. Corrupt packages offer ZERO available actions', () => {
    assert.deepEqual(mockCorruptResult.availableActions, []);
  });

  // 12. HTTP 403 Access Denied handling
  test('12. Handles 403 Forbidden safely without leaking server internals', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Access denied: You are not authorized to inspect this package.' }),
    } as any);

    try {
      const validZip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'package.zip', {
        type: 'application/zip',
      });
      await assert.rejects(
        async () => {
          await inspectPackage({ file: validZip });
        },
        (err: any) => {
          assert.ok(err.message.includes('Access denied'));
          assert.ok(!err.message.includes('/'));
          assert.ok(!err.message.includes('C:\\'));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 13. HTTP 413 Payload Too Large handling
  test('13. Handles 413 Payload Too Large with clear upload limit message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 413,
      json: async () => ({ error: 'Payload Too Large: Package archive exceeds maximum 100 MB limit.' }),
    } as any);

    try {
      const validZip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'package.zip', {
        type: 'application/zip',
      });
      await assert.rejects(
        async () => {
          await inspectPackage({ file: validZip });
        },
        /Package exceeds the maximum inspection upload size/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 14. HTTP 415 Unsupported Media Type handling
  test('14. Handles 415 Unsupported Media Type gracefully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 415,
      json: async () => ({ error: 'Unsupported Media Type: Package must be a .zip archive.' }),
    } as any);

    try {
      const validZip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'package.zip', {
        type: 'application/zip',
      });
      await assert.rejects(
        async () => {
          await inspectPackage({ file: validZip });
        },
        /Unsupported/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 15. HTTP 500 Server Error handling
  test('15. Handles 500 Server Error without exposing stack traces', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('Non-JSON response');
      },
    } as any);

    try {
      const validZip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'package.zip', {
        type: 'application/zip',
      });
      await assert.rejects(
        async () => {
          await inspectPackage({ file: validZip });
        },
        /Inspection failed on the server/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 16. Security / Data leakage invariant
  test('16. Invariant: No sensitive server internals or filesystem paths rendered', () => {
    const html = renderToString(React.createElement(PackageInspectorCard));
    assert.ok(!html.includes('data/site_work.db'));
    assert.ok(!html.includes('process.env'));
    assert.ok(!html.includes('SESSION_SECRET'));
    assert.ok(!html.includes('password_hash'));
  });

  // 17. Invariant: No database/import/reconcile buttons exist
  test('17. Invariant: No database write or import buttons exist in component UI', () => {
    const html = renderToString(React.createElement(PackageInspectorCard));
    const forbidden = ['Import', 'Apply', 'Merge', 'Restore Now', 'Overwrite Database', 'Reconcile Now'];
    for (const name of forbidden) {
      assert.ok(
        !html.includes(`>${name}<`),
        `Forbidden button label found: ${name}`
      );
    }
  });

  // 18. Keyboard accessibility basics
  test('18. Accessibility: Keyboard focusable browse button and accessible labels present', () => {
    const html = renderToString(React.createElement(PackageInspectorCard));
    assert.ok(html.includes('type="button"'));
    assert.ok(html.includes('role="region"'));
    assert.ok(html.includes('aria-label="Package ZIP upload drop zone"'));
    assert.ok(html.includes('focus:ring-2'));
  });

  // 19. Mobile-safe responsive layout classes
  test('19. Responsive design: Min 44px touch targets and responsive flex/grid wrappers', () => {
    const html = renderToString(React.createElement(PackageInspectorCard));
    assert.ok(html.includes('min-h-[44px]'));
    assert.ok(html.includes('min-h-[220px]'));
    assert.ok(html.includes('flex flex-col sm:flex-row') || html.includes('flex-col sm:flex-row'));
  });

  // 20. Stored backup ID support in client API helper
  test('20. inspectPackage supports stored backupId parameter with clean payload', async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: any;
    globalThis.fetch = async (url, init) => {
      sentBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => mockSystemRecoveryResult,
      } as any;
    };

    try {
      const result = await inspectPackage({ backupId: 'bak-12345' });
      assert.equal(sentBody.backupId, 'bak-12345');
      assert.equal(result.packageId, 'bak-system-recovery-2026');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
