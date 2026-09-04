import { UserSession } from './session';

export type ActionType = 'READ' | 'WRITE' | 'ADMIN';

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Access forbidden for this site or action') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Validates whether the current session has permission for the specified site and action.
 */
export function validateSiteAccess(
  session: UserSession | null,
  siteId: string | undefined | null,
  action: ActionType = 'READ'
): void {
  if (!session) {
    throw new UnauthorizedError('Please log in to continue.');
  }

  // ADMIN has full access everywhere
  if (session.role === 'ADMIN') {
    return;
  }

  // Non-admins attempting admin-only global actions
  if (action === 'ADMIN') {
    throw new ForbiddenError('Administrator privileges required.');
  }

  // Read-only viewers cannot perform WRITE actions
  if (action === 'WRITE' && session.role === 'VIEWER') {
    throw new ForbiddenError('Viewer accounts have read-only access.');
  }

  // Verify site assignment if a siteId is specified
  if (siteId) {
    const isAssigned = session.assignedSiteIds.includes(siteId);
    if (!isAssigned) {
      throw new ForbiddenError(`You do not have access to site: ${siteId}`);
    }
  }
}

/**
 * Checks if user has admin privileges.
 */
export function requireAdmin(session: UserSession | null): void {
  if (!session) {
    throw new UnauthorizedError('Please log in to continue.');
  }
  if (session.role !== 'ADMIN') {
    throw new ForbiddenError('Administrator privileges required.');
  }
}
