import { UserSession } from './session';

export type AuthorityTier = 'KING_MAKER' | 'SUPERIOR_PRIME' | 'CLIENT_PRIME' | 'STANDARD_ADMIN' | 'STANDARD';

export interface AuthorityPrincipal {
  id?: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  authorityTier?: AuthorityTier;
}

const TIER_RANK: Record<AuthorityTier, number> = {
  KING_MAKER: 5,
  SUPERIOR_PRIME: 4,
  CLIENT_PRIME: 3,
  STANDARD_ADMIN: 2,
  STANDARD: 1,
};

/**
 * Resolves the effective authority tier for a principal.
 */
export function getAuthorityTier(principal: AuthorityPrincipal | null | undefined | any): AuthorityTier {
  if (!principal) return 'STANDARD';
  const tier = principal.authorityTier || principal.authority_tier;
  if (tier) {
    return tier as AuthorityTier;
  }
  // Backward compatibility fallback based on role
  if (principal.role === 'ADMIN') {
    return 'STANDARD_ADMIN';
  }
  return 'STANDARD';
}

/**
 * Checks if the principal is King Maker (hidden platform authority).
 */
export function isKingMaker(principal: AuthorityPrincipal | null | undefined): boolean {
  return getAuthorityTier(principal) === 'KING_MAKER';
}

/**
 * Checks if the principal is Superior Prime (legacy platform authority).
 */
export function isSuperiorPrime(principal: AuthorityPrincipal | null | undefined): boolean {
  return getAuthorityTier(principal) === 'SUPERIOR_PRIME';
}

/**
 * Checks if the principal is Client Prime (organization operational root).
 */
export function isClientPrime(principal: AuthorityPrincipal | null | undefined): boolean {
  return getAuthorityTier(principal) === 'CLIENT_PRIME';
}

/**
 * Checks if the principal is any Prime authority (King Maker, Superior Prime, or Client Prime).
 */
export function isPrimeAuthority(principal: AuthorityPrincipal | null | undefined): boolean {
  const tier = getAuthorityTier(principal);
  return tier === 'KING_MAKER' || tier === 'SUPERIOR_PRIME' || tier === 'CLIENT_PRIME';
}

/**
 * Checks if the principal is a Standard Administrator.
 */
export function isStandardAdmin(principal: AuthorityPrincipal | null | undefined): boolean {
  return getAuthorityTier(principal) === 'STANDARD_ADMIN';
}

/**
 * Validates whether an acting authority can manage/edit a target user.
 * 
 * Rules:
 * 1. KING_MAKER can manage everyone (CLIENT_PRIME, STANDARD_ADMIN, STANDARD). Cannot self-demote or self-delete.
 * 2. KING_MAKER CANNOT be managed, queried, or modified by any lower authority.
 * 3. Superior Prime can manage everyone except self-demotion or self-deletion and cannot manage KING_MAKER.
 * 4. Client Prime can manage Standard Admins, Engineers, and Viewers.
 * 5. Client Prime CANNOT manage KING_MAKER, Superior Prime, or another Client Prime.
 * 6. Standard Admins CANNOT manage KING_MAKER, Superior Prime, Client Prime, or peer Standard Admins.
 * 7. Non-admins cannot manage anyone.
 */
export function canManageAuthority(
  actor: AuthorityPrincipal | null | undefined,
  target: AuthorityPrincipal | null | undefined
): boolean {
  if (!actor || !target) return false;
  
  const actorTier = getAuthorityTier(actor);
  const targetTier = getAuthorityTier(target);

  // Target is King Maker: ONLY King Maker can manage King Maker self
  if (targetTier === 'KING_MAKER') {
    return actorTier === 'KING_MAKER';
  }

  // King Maker can manage all lower tiers
  if (actorTier === 'KING_MAKER') {
    return true;
  }

  // Target is Superior Prime: ONLY King Maker or Superior Prime can manage Superior Prime
  if (targetTier === 'SUPERIOR_PRIME') {
    return actorTier === 'SUPERIOR_PRIME';
  }

  // Superior Prime can manage all lower tiers (CLIENT_PRIME, STANDARD_ADMIN, STANDARD)
  if (actorTier === 'SUPERIOR_PRIME') {
    return true;
  }

  // Target is Client Prime: ONLY King Maker or Superior Prime can manage Client Prime
  if (targetTier === 'CLIENT_PRIME') {
    return false; // actor is not KING_MAKER or SUPERIOR_PRIME (checked above)
  }

  // Client Prime can manage Standard Admins and Standard users (Engineers, Viewers)
  if (actorTier === 'CLIENT_PRIME') {
    return targetTier === 'STANDARD_ADMIN' || targetTier === 'STANDARD';
  }

  // Standard Admins can manage Standard Admins (for creator delegation) and Standard users
  if (actorTier === 'STANDARD_ADMIN') {
    return targetTier === 'STANDARD_ADMIN' || targetTier === 'STANDARD';
  }

  return false;
}

/**
 * Validates whether an acting authority can modify credentials (password/username/recovery) of a target.
 */
export function canModifyCredentials(
  actor: AuthorityPrincipal | null | undefined,
  target: AuthorityPrincipal | null | undefined
): boolean {
  // Self-credential management is handled by separate account routes
  if (actor?.id && target?.id && actor.id === target.id) {
    return true;
  }
  const actorTier = getAuthorityTier(actor);
  const targetTier = getAuthorityTier(target);

  // Target is King Maker: lower authorities can never modify
  if (targetTier === 'KING_MAKER' && actorTier !== 'KING_MAKER') {
    return false;
  }

  // Standard Admin cannot reset credentials of peer Standard Admin (only Primes / King Maker can)
  if (actorTier === 'STANDARD_ADMIN' && targetTier === 'STANDARD_ADMIN') {
    return false;
  }
  return canManageAuthority(actor, target);
}

/**
 * Validates whether an acting authority can assign a given authority tier to a target.
 * 
 * Rules:
 * - KING_MAKER can NEVER be assigned or created via API/UI.
 * - An actor may NEVER assign an authority tier higher than their own authority.
 * - KING_MAKER: can create CLIENT_PRIME, STANDARD_ADMIN, STANDARD. Cannot create KING_MAKER or SUPERIOR_PRIME.
 * - SUPERIOR_PRIME: can create CLIENT_PRIME, STANDARD_ADMIN, STANDARD. Cannot create SUPERIOR_PRIME or KING_MAKER.
 * - CLIENT_PRIME: can create STANDARD_ADMIN, STANDARD. Cannot create CLIENT_PRIME, SUPERIOR_PRIME, or KING_MAKER.
 * - STANDARD_ADMIN: can create STANDARD_ADMIN, STANDARD. Cannot create CLIENT_PRIME, SUPERIOR_PRIME, or KING_MAKER.
 * - STANDARD: cannot create administrative accounts.
 */
export function canAssignAuthorityTier(
  actor: AuthorityPrincipal | null | undefined,
  requestedTier: AuthorityTier
): boolean {
  if (!actor) return false;
  const actorTier = getAuthorityTier(actor);

  if (requestedTier === 'KING_MAKER' || requestedTier === 'SUPERIOR_PRIME') {
    // KING_MAKER and SUPERIOR_PRIME cannot be assigned via operational interfaces
    return false;
  }

  if (requestedTier === 'CLIENT_PRIME') {
    // Only King Maker and Superior Prime can provision or assign Client Prime
    return actorTier === 'KING_MAKER' || actorTier === 'SUPERIOR_PRIME';
  }

  if (requestedTier === 'STANDARD_ADMIN') {
    // King Maker, Superior Prime, Client Prime, and Standard Admin can provision Standard Admins
    return actorTier === 'KING_MAKER' || actorTier === 'SUPERIOR_PRIME' || actorTier === 'CLIENT_PRIME' || actorTier === 'STANDARD_ADMIN';
  }

  // STANDARD tier (Engineers / Viewers) can be assigned by any Admin tier
  return actorTier === 'KING_MAKER' || actorTier === 'SUPERIOR_PRIME' || actorTier === 'CLIENT_PRIME' || actorTier === 'STANDARD_ADMIN';
}

/**
 * Validates whether a user can be deleted.
 * 
 * Rules:
 * 1. KING_MAKER can NEVER be deleted by anyone under any circumstances.
 * 2. Superior Prime can NEVER be deleted by anyone.
 * 3. Client Prime can NEVER be deleted through standard delete operations.
 * 4. Standard Admins cannot delete peer Standard Admins (only Primes / King Maker can delete Admins).
 * 5. A lower or equal authority cannot delete a target.
 */
export function canDeleteUser(
  actor: AuthorityPrincipal | null | undefined,
  target: AuthorityPrincipal | null | undefined
): boolean {
  if (!actor || !target) return false;
  const actorTier = getAuthorityTier(actor);
  const targetTier = getAuthorityTier(target);

  if (targetTier === 'KING_MAKER' || targetTier === 'SUPERIOR_PRIME' || targetTier === 'CLIENT_PRIME') {
    return false; // King Maker and Primes cannot be deleted through standard delete operations
  }

  if (actor.id && target.id && actor.id === target.id) {
    return false; // Cannot self-delete
  }

  // Standard Admins cannot delete peer Standard Admins
  if (actorTier === 'STANDARD_ADMIN' && targetTier === 'STANDARD_ADMIN') {
    return false;
  }

  return canManageAuthority(actor, target);
}
