/**
 * Client-side Complete Export trigger utility for browser UI.
 * Handles in-flight request protection (single-flight locking),
 * RFC 5987 / RFC 6266 Content-Disposition header decoding,
 * blob lifecycle cleanup, and comprehensive error handling.
 */

export interface CompleteExportClientOptions {
  scope: 'SYSTEM' | 'SITE';
  siteId?: string;
  period: string;
  from?: string;
  to?: string;
  format?: 'ZIP' | 'PDF' | 'EXCEL' | 'JSON' | 'FULL_REPORT_ZIP' | 'FULL_ZIP';
  formats?: Array<'PDF' | 'EXCEL' | 'JSON'>;
  reportTypes?: string[];
}

// In-flight request tracking to protect against double-submission
let isExportInFlight = false;

export async function downloadCompleteExport(options: CompleteExportClientOptions): Promise<void> {
  if (isExportInFlight) {
    throw new Error('An export is already being generated. Please wait for it to finish.');
  }

  if (options.scope === 'SITE' && !options.siteId) {
    throw new Error('Please select a project site for site-level complete export.');
  }

  isExportInFlight = true;

  try {
    const res = await fetch('/api/export/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      let errorMsg = 'Failed to generate complete export.';
      try {
        const errData = await res.json();
        if (errData?.error) {
          errorMsg = errData.error;
        }
      } catch {
        if (res.status === 401) errorMsg = 'Your session has expired. Please log in again.';
        else if (res.status === 403) errorMsg = 'You are not authorized to perform this export.';
        else if (res.status === 404) errorMsg = 'The requested site could not be found.';
        else if (res.status === 400) errorMsg = 'Invalid export options or date range specified.';
        else if (res.status >= 500) errorMsg = 'Export generation failed on the server. Please try again.';
      }
      throw new Error(errorMsg);
    }

    const blob = await res.blob();
    if (!blob || blob.size === 0) {
      throw new Error('Received an empty archive payload from the server.');
    }

    // Determine fallback extension based on format
    let ext = 'zip';
    if (options.format === 'PDF') ext = 'pdf';
    else if (options.format === 'EXCEL') ext = 'xlsx';
    else if (options.format === 'JSON') ext = 'json';

    let fallbackFilename = `SITE_WORK_Complete_Export_${Date.now()}.${ext}`;

    // Parse Content-Disposition
    const cd = res.headers.get('content-disposition');
    if (cd) {
      const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match && utf8Match[1]) {
        try {
          fallbackFilename = decodeURIComponent(utf8Match[1]);
        } catch {
          // ignore
        }
      } else {
        const asciiMatch = cd.match(/filename="?([^";]+)"?/i);
        if (asciiMatch && asciiMatch[1]) {
          fallbackFilename = asciiMatch[1].trim();
        }
      }
    }

    // Trigger download
    const url = window.URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = fallbackFilename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 5000);
    }
  } finally {
    isExportInFlight = false;
  }
}

export function isCompleteExportInProgress(): boolean {
  return isExportInFlight;
}
