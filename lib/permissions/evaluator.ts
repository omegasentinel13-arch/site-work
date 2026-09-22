import { AuthorityTier } from '../auth/authority';
import { PermissionRepository } from '../db/repositories/permission-repo';

export interface CanAccessSession {
  id?: string;
  userId?: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  authorityTier?: AuthorityTier;
  isActive?: boolean;
  assignedSiteIds?: string[];
}

export interface CanAccessParams {
  session: CanAccessSession | null | undefined;
  page: string;
  action: string;
  siteId?: string | null;            // Caller-supplied siteId (untrusted claim)
  resourceSiteId?: string | null;    // Persisted entity siteId (authoritative)
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  ruleSource:
    | 'AUTHENTICATION_REQUIRED'
    | 'ACCOUNT_INACTIVE'
    | 'KING_MAKER_PLATFORM_AUTHORITY'
    | 'SUPERIOR_PRIME_PLATFORM_AUTHORITY'
    | 'SITE_MISMATCH_REJECTED'
    | 'UNASSIGNED_SITE_DENY'
    | 'USER_SITE_EXPLICIT_DENY'
    | 'USER_SITE_EXPLICIT_ALLOW'
    | 'USER_GLOBAL_EXPLICIT_DENY'
    | 'USER_GLOBAL_EXPLICIT_ALLOW'
    | 'ROLE_BASELINE_ALLOW'
    | 'LEGACY_FALLBACK_ALLOW'
    | 'DEFAULT_DENY';
  effectiveSiteId?: string | null;
}

/**
 * Evaluates fallback behavior for unconfigured permissions, preserving 100% parity with
 * existing ADMIN, SITE_MANAGER, and VIEWER roles.
 */
export function evaluateLegacyFallback(
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
  page: string,
  action: string,
  userId: string,
  effectiveSiteId: string | null,
  isGlobalAdmin: boolean
): boolean {
  // Controlled recovery on Audit Trail requires explicit permission for Standard Admin
  if (page === 'PAGE_AUDIT_TRAIL' && action === 'RESTORE') {
    return false;
  }

  if (role === 'ADMIN' || isGlobalAdmin) {
    return true;
  }

  if (role === 'SITE_MANAGER') {
    const isOperational =
      page.startsWith('PAGE_ATTENDANCE_') ||
      page.startsWith('PAGE_FINANCE_') ||
      page.startsWith('PAGE_REPORTS_') ||
      page === 'PAGE_DASHBOARD';

    const isLookupView =
      action === 'VIEW' &&
      (page === 'PAGE_SETUP_SITES' ||
       page === 'PAGE_SETUP_CATEGORIES' ||
       page === 'PAGE_SETUP_ROLES');

    if (!isOperational && !isLookupView) return false;

    // Disallow dangerous administrative mutations
    if (action === 'DELETE' || action === 'MANAGE' || action === 'PERMANENT_DELETE') {
      return false;
    }

    if (effectiveSiteId) {
      return PermissionRepository.isUserAssignedToSite(userId, effectiveSiteId);
    }
    return true;
  }

  if (role === 'VIEWER') {
    if (action !== 'VIEW' && action !== 'EXPORT') return false;
    const isAllowedPage =
      page.startsWith('PAGE_ATTENDANCE_') ||
      page.startsWith('PAGE_FINANCE_') ||
      page.startsWith('PAGE_REPORTS_') ||
      page === 'PAGE_DASHBOARD' ||
      page === 'PAGE_SETUP_SITES' ||
      page === 'PAGE_SETUP_CATEGORIES' ||
      page === 'PAGE_SETUP_ROLES';

    if (!isAllowedPage) return false;

    if (effectiveSiteId) {
      return PermissionRepository.isUserAssignedToSite(userId, effectiveSiteId);
    }
    return true;
  }

  return false;
}

/**
 * Deterministic permission evaluation service implementing the 5-stage pipeline:
 * Principal -> Page -> Action -> Site Scope -> ALLOW / DENY
 * 
 * Strict Precedence:
 * EXPLICIT USER SITE DENY > EXPLICIT USER SITE ALLOW >
 * EXPLICIT USER GLOBAL DENY > EXPLICIT USER GLOBAL ALLOW >
 * ROLE BASELINE > LEGACY ROLE FALLBACK > DEFAULT DENY
 */
export function canAccess(params: CanAccessParams): AccessDecision {
  const { session, page, action, siteId, resourceSiteId } = params;

  const principalId = session ? (session.id || session.userId) : undefined;

  // STEP 1: Authentication State Invariant
  if (!session || !principalId) {
    return {
      allowed: false,
      reason: 'Authentication required: no active session',
      ruleSource: 'AUTHENTICATION_REQUIRED',
      effectiveSiteId: null
    };
  }

  // STEP 2: Account Active Invariant
  if (session.isActive === false) {
    return {
      allowed: false,
      reason: 'User account is deactivated',
      ruleSource: 'ACCOUNT_INACTIVE',
      effectiveSiteId: null
    };
  }

  // STEP 3: King Maker & Platform Authority
  // King Maker possesses ultimate platform authority for operations, but database integrity and
  // active session requirements still apply.
  if (session.authorityTier === 'KING_MAKER') {
    return {
      allowed: true,
      reason: 'King Maker platform authority',
      ruleSource: 'KING_MAKER_PLATFORM_AUTHORITY',
      effectiveSiteId: resourceSiteId || siteId || null
    };
  }

  if (session.authorityTier === 'SUPERIOR_PRIME') {
    return {
      allowed: true,
      reason: 'Superior Prime platform authority',
      ruleSource: 'SUPERIOR_PRIME_PLATFORM_AUTHORITY',
      effectiveSiteId: resourceSiteId || siteId || null
    };
  }

  // STEP 4: Site Scoping & Persisted Resource Site Isolation (Step 0 Invariant)
  let effectiveSiteId: string | null = null;

  if (resourceSiteId !== undefined && resourceSiteId !== null) {
    effectiveSiteId = resourceSiteId;
    // Cross-site tamper detection: if caller supplied a differing siteId, reject immediately!
    if (siteId !== undefined && siteId !== null && siteId !== '' && siteId !== resourceSiteId) {
      return {
        allowed: false,
        reason: `Cross-site tamper attempt: caller-supplied siteId (${siteId}) contradicts persisted resource siteId (${resourceSiteId})`,
        ruleSource: 'SITE_MISMATCH_REJECTED',
        effectiveSiteId: resourceSiteId
      };
    }
  } else if (siteId !== undefined && siteId !== null && siteId !== '') {
    effectiveSiteId = siteId;
  }

  // Prime authority (Client Prime) holds inherent global platform site scope UNLESS restricted by King Maker.
  // King Maker was handled at Step 3.
  // Standard Admins and operational users require explicit site assignment in canonical site_users.
  const isPrime = session.authorityTier === 'CLIENT_PRIME';
  const isPrimeRestricted = isPrime && PermissionRepository.isPrimeSiteRestricted(principalId);
  const isGlobalAdmin = isPrime && !isPrimeRestricted;

  // Check canonical site_users table if the resource is site-scoped
  const permDef = PermissionRepository.getPermissionDefinitionByPageAction(page, action);
  const isSiteScoped = permDef ? permDef.is_site_scoped === 1 : Boolean(effectiveSiteId);

  if (isSiteScoped && effectiveSiteId && (!isPrime || isPrimeRestricted)) {
    const isAssigned = PermissionRepository.isUserAssignedToSite(principalId, effectiveSiteId);
    if (!isAssigned) {
      return {
        allowed: false,
        reason: `User is not assigned to site ${effectiveSiteId} in canonical site_users`,
        ruleSource: 'UNASSIGNED_SITE_DENY',
        effectiveSiteId
      };
    }
  }

  // STEP 5: Explicit User Overrides
  if (permDef) {
    // 5A: Site-Specific User Override
    if (effectiveSiteId) {
      const siteOverride = PermissionRepository.getUserOverride(principalId, permDef.id, effectiveSiteId);
      if (siteOverride) {
        if (siteOverride.effect === 'DENY') {
          return {
            allowed: false,
            reason: 'Explicit user site-specific DENY override encountered',
            ruleSource: 'USER_SITE_EXPLICIT_DENY',
            effectiveSiteId
          };
        }
        if (siteOverride.effect === 'ALLOW') {
          return {
            allowed: true,
            reason: 'Explicit user site-specific ALLOW override encountered',
            ruleSource: 'USER_SITE_EXPLICIT_ALLOW',
            effectiveSiteId
          };
        }
      }
    }

    // 5B: Global User Override
    const globalOverride = PermissionRepository.getUserOverride(principalId, permDef.id, null);
    if (globalOverride) {
      if (globalOverride.effect === 'DENY') {
        return {
          allowed: false,
          reason: 'Explicit user global DENY override encountered',
          ruleSource: 'USER_GLOBAL_EXPLICIT_DENY',
          effectiveSiteId
        };
      }
      if (globalOverride.effect === 'ALLOW') {
        return {
          allowed: true,
          reason: 'Explicit user global ALLOW override encountered',
          ruleSource: 'USER_GLOBAL_EXPLICIT_ALLOW',
          effectiveSiteId
        };
      }
    }

    // STEP 6: Role Baseline Evaluation (Strict deterministic precedence: SPECIFIC_SITE > ASSIGNED_SITES > GLOBAL)
    const rolePerms = PermissionRepository.getRolePermissions(session.role, permDef.id);

    // 6A: Check SPECIFIC_SITE for effectiveSiteId first (Highest Role Precedence)
    if (effectiveSiteId) {
      const specificSitePerm = rolePerms.find(
        rp => rp.scope_type === 'SPECIFIC_SITE' && rp.site_id === effectiveSiteId
      );
      if (specificSitePerm) {
        return {
          allowed: true,
          reason: `Granted via specific-site role baseline for ${session.role} on ${effectiveSiteId}`,
          ruleSource: 'ROLE_BASELINE_ALLOW',
          effectiveSiteId
        };
      }
    }

    // 6B: Check ASSIGNED_SITES second (Medium Role Precedence)
    const assignedSitesPerm = rolePerms.find(rp => rp.scope_type === 'ASSIGNED_SITES');
    if (assignedSitesPerm) {
      if (!effectiveSiteId || isGlobalAdmin || PermissionRepository.isUserAssignedToSite(principalId, effectiveSiteId)) {
        return {
          allowed: true,
          reason: `Granted via assigned-sites role baseline for ${session.role}`,
          ruleSource: 'ROLE_BASELINE_ALLOW',
          effectiveSiteId
        };
      }
      // Note: An unassigned site cannot inherit ASSIGNED_SITES.
    }

    // 6C: Check GLOBAL third (Lowest Role Precedence - applies when no more-specific rule exists)
    const globalPerm = rolePerms.find(rp => rp.scope_type === 'GLOBAL');
    if (globalPerm) {
      // If an ASSIGNED_SITES rule exists for this role, it restricts access to assigned sites unless user is Global Admin
      if (assignedSitesPerm && effectiveSiteId && !isGlobalAdmin) {
        // ASSIGNED_SITES took precedence and failed because the site is unassigned
      } else {
        return {
          allowed: true,
          reason: `Granted via global role baseline for ${session.role}`,
          ruleSource: 'ROLE_BASELINE_ALLOW',
          effectiveSiteId
        };
      }
    }
  }

  // STEP 7: Legacy Role Fallback (Backward Compatibility Mode)
  // Activated when no permission definition exists OR when no granular role baseline was configured for this role and permission.
  const hasConfiguredRoleBaseline = permDef ? PermissionRepository.getRolePermissions(session.role, permDef.id).length > 0 : false;
  if (!permDef || !hasConfiguredRoleBaseline) {
    const legacyAllowed = evaluateLegacyFallback(
      session.role,
      page,
      action,
      principalId,
      effectiveSiteId,
      isGlobalAdmin
    );
    if (legacyAllowed) {
      return {
        allowed: true,
        reason: `Granted via legacy role fallback rules for ${session.role}`,
        ruleSource: 'LEGACY_FALLBACK_ALLOW',
        effectiveSiteId
      };
    }
  }

  // STEP 8: Default Deny (Fail-Closed)
  return {
    allowed: false,
    reason: 'Access denied: no matching rule granted access (Default Deny)',
    ruleSource: 'DEFAULT_DENY',
    effectiveSiteId
  };
}
