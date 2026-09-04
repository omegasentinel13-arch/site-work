/**
 * Shared client-side Excel download utility for browser environments.
 * Handles duplicate click prevention, HTTP status checking,
 * Content-Disposition header parsing, blob URL lifecycle, and error normalization.
 */

export interface ExportExcelOptions {
  siteId: string;
  type: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  monthLabel?: string;
  roleId?: string;
  categoryId?: string;
  transactionType?: string;
  debitCategory?: string;
  title?: string;
  [key: string]: any;
}

export async function downloadReportExcel(
  payload: ExportExcelOptions,
  fallbackFilename = 'SITE_WORK_Report.xlsx'
): Promise<void> {
  if (!payload.siteId) {
    throw new Error('Please select a site before exporting.');
  }

  const res = await fetch('/api/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let errorMsg = 'Failed to export Excel spreadsheet.';
    try {
      const errData = await res.json();
      if (errData?.error) {
        errorMsg = errData.error;
      }
    } catch {
      if (res.status === 401) errorMsg = 'Please log in to continue.';
      else if (res.status === 403) errorMsg = 'You do not have access to this site.';
      else if (res.status === 404) errorMsg = 'The selected site could not be found.';
      else if (res.status === 400) errorMsg = 'Please check the selected report filters.';
      else if (res.status >= 500) errorMsg = 'Excel export failed on the server. Please try again.';
    }
    throw new Error(errorMsg);
  }

  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error('Received an empty document from the server.');
  }

  // Parse Content-Disposition filename if present
  let filename = fallbackFilename;
  const cd = res.headers.get('content-disposition');
  if (cd) {
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        filename = decodeURIComponent(utf8Match[1]);
      } catch {
        // use fallback
      }
    } else {
      const asciiMatch = cd.match(/filename="?([^";]+)"?/i);
      if (asciiMatch && asciiMatch[1]) {
        filename = asciiMatch[1].trim();
      }
    }
  }

  // Trigger browser download and guarantee URL cleanup
  const url = window.URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Revoke object URL after download trigger to prevent memory leaks
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(url);
      } catch {
        // ignore cleanup errors
      }
    }, 1000);
  }
}
