import {
  PackageInspectionResult,
} from './types';

export interface InspectPackageOptions {
  file?: File;
  backupId?: string;
}

// In-flight request lock to protect against concurrent duplicate submissions
let isInspectInFlight = false;

/**
 * Returns whether an inspection request is currently in progress.
 */
export function isPackageInspectionInProgress(): boolean {
  return isInspectInFlight;
}

/**
 * Client-side helper to inspect an uploaded ZIP package or stored backup via POST /api/packages/inspect.
 * Normalizes HTTP error responses into friendly, non-leaking user-facing error messages.
 */
export async function inspectPackage(
  options: InspectPackageOptions
): Promise<PackageInspectionResult> {
  if (isInspectInFlight) {
    throw new Error('A package inspection is already in progress. Please wait for it to complete.');
  }

  if (!options.file && !options.backupId) {
    throw new Error('Please select a package ZIP file or provide a backup ID to inspect.');
  }

  isInspectInFlight = true;

  try {
    let res: Response;

    if (options.file) {
      // Lightweight client-side validation for UX
      if (!options.file.name.toLowerCase().endsWith('.zip')) {
        throw new Error('Unsupported package format. Only .zip archives can be inspected.');
      }
      if (options.file.size > 100 * 1024 * 1024) {
        throw new Error('Package exceeds the maximum inspection upload size (100 MB).');
      }

      const formData = new FormData();
      formData.append('file', options.file);

      res = await fetch('/api/packages/inspect', {
        method: 'POST',
        body: formData,
      });
    } else {
      res = await fetch('/api/packages/inspect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ backupId: options.backupId }),
      });
    }

    if (!res.ok) {
      if (res.status === 413) {
        throw new Error('Package exceeds the maximum inspection upload size (100 MB).');
      }

      let friendlyError = 'Package inspection failed.';
      try {
        const errorBody = await res.json();
        if (errorBody?.error && typeof errorBody.error === 'string') {
          friendlyError = errorBody.error;
        }
      } catch {
        // Status code based friendly fallbacks
        if (res.status === 401) {
          friendlyError = 'Your session has expired. Please log in again.';
        } else if (res.status === 403) {
          friendlyError = 'Access denied: You are not authorized to inspect this package.';
        } else if (res.status === 404) {
          friendlyError = 'The requested backup package could not be found.';
        } else if (res.status === 415) {
          friendlyError = 'Unsupported package format. Please provide a valid .zip archive.';
        } else if (res.status === 429) {
          friendlyError = 'Too many requests. Please try again in a moment.';
        } else if (res.status >= 500) {
          friendlyError = 'Inspection failed on the server. Please try again.';
        }
      }
      throw new Error(friendlyError);
    }

    const data: PackageInspectionResult = await res.json();
    return data;
  } finally {
    isInspectInFlight = false;
  }
}
