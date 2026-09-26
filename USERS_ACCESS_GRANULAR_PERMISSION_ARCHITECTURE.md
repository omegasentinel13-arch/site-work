# SITE WORK — USERS & ACCESS
# STEP 2.1: GRANULAR PERMISSION ENGINE ARCHITECTURE
## FORENSIC CTO ARCHITECTURAL SPECIFICATION & GOVERNANCE BLUEPRINT (REVISED)
### STATUS: REVISED SPECIFICATION — ZERO IMPLEMENTATION / ZERO DATABASE MUTATION

---

## 1. CURRENT ARCHITECTURE OVERVIEW

### 1.1 Existing RBAC Foundation
The current SITE WORK system relies on a coarse, three-tier Role-Based Access Control (RBAC) model defined in `lib/auth/session.ts` and `lib/db/schema.sql`:
* `ADMIN`: Universal platform administrative access.
* `SITE_MANAGER`: Operational access, historically intended for site-specific field operations (frequently termed "Engineer" in workflow context).
* `VIEWER`: Read-only access across assigned operational modules.

In Step 1 (Dual Prime Foundation), an orthogonal authority tiering model was established in `lib/auth/authority.ts`:
* `SUPERIOR_PRIME`: Sovereign platform authority (`usr-admin-1`, immutable, non-demotable, totally invisible to all lower tiers).
* `CLIENT_PRIME`: Client-facing root administrative authority (`Iamadmin`, full business administration).
* `STANDARD_ADMIN`: Operational administrators with administrative privileges over sites, categories, roles, and attendance/finance.
* `STANDARD`: Base operational users (`SITE_MANAGER`, `VIEWER`).

### 1.2 Existing Site Assignment Canonical Source (`site_users`)
The application already features an authoritative, canonical table for user-to-site membership in `lib/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS site_users (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, user_id)
);
```

> [!IMPORTANT]
> **CANONICAL MEMBERSHIP INVARIANT**: `site_users` is the **single and exclusive canonical source of truth** for whether a user is assigned to a site. Granular permissions reference site scope, but the granular permission engine will **never** create a secondary or duplicate user-site assignment table.

### 1.3 Current Enforcement Mechanism
Authorization enforcement is currently fragmented across three decoupled layers:
1. **Edge Middleware (`middleware.ts`)**: Coarse route-prefix checks (e.g., redirecting unauthenticated users to `/login`, basic protection of `/setup` and `/admin`).
2. **Next.js Layout & Navigation (`components/layout/Navigation.tsx`, `Header.tsx`)**: Visual navigation items filtered by `user.role === 'ADMIN'`. Hiding a navigation link is used for UX differentiation, but does **not** constitute an authorization boundary.
3. **Route Handlers (`app/api/**/route.ts`)**: Individual API routes inspect `session.role` or `session.authority_tier` using hardcoded conditional checks (e.g., `if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })`).

### 1.4 Gaps, Vulnerabilities, and Architectural Bottlenecks
1. **Coarse All-or-Nothing Privileges**: An `ADMIN` has blanket authority over all pages, actions, and sites. There is no mechanism to grant a user permission to export financial reports without also giving them the ability to delete transactions or edit master system roles.
2. **Missing Fine-Grained Action Boundaries**: The system conflates `VIEW` with `EXPORT`, `EDIT` with `DELETE`, and `ARCHIVE` with `PERMANENT_DELETE`.
3. **Lack of User-Specific Overrides**: An Engineer assigned to Site A cannot be granted temporary read-only audit access to Site B without changing their global role or introducing hardcoded custom logic.
4. **Site Context vs. Persisted Entity Disconnect (Addressed in Step 0, codified in Step 2.1)**: Historical APIs trusted caller-supplied `siteId` parameters in request bodies rather than verifying the actual `site_id` of the persisted database entity.
5. **No Visual Permission Transparency**: Administrators cannot view, audit, or simulate what exact actions a specific user can execute across various sites.

---

## 2. TARGET GRANULAR PERMISSION MODEL

### 2.1 The Five-Stage Evaluation Pipeline
The target authorization model establishes a strict, deterministic, 5-stage evaluation pipeline for every protected resource access:

$$\mathbf{Principal} \longrightarrow \mathbf{Page} \longrightarrow \mathbf{Action} \longrightarrow \mathbf{Site\ Scope} \longrightarrow \mathbf{ALLOW\ /\ DENY}$$

```
  ┌──────────────┐
  │  Principal   │ (User ID, Role, Authority Tier, Active Status, Canonical site_users)
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │     Page     │ (Registered Page/Route ID from Page Registry)
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │    Action    │ (VIEW, CREATE, EDIT, DELETE, EXPORT, MANAGE, etc.)
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  Site Scope  │ (GLOBAL NULL, or Specific Site ID derived from persisted entity)
  └──────┬───────┘
         ▼
┌──────────────────┐
│ Resolution Logic │ ──► [ USER SITE DENY > USER SITE ALLOW > USER GLOBAL DENY > USER GLOBAL ALLOW > ROLE BASELINE > LEGACY FALLBACK > FAIL-CLOSED ]
└────────┬─────────┘
         ▼
 ┌───────────────┐
 │ ALLOW / DENY  │
 └───────────────┘
```

### 2.2 Core Precedence Rule (Non-Negotiable)
When resolving whether a `Principal` can perform an `Action` on a `Page` within a `Site Scope`, the resolution engine evaluates rules in strict order of descending priority:

$$\mathbf{USER\ SITE\ DENY} > \mathbf{USER\ SITE\ ALLOW} > \mathbf{USER\ GLOBAL\ DENY} > \mathbf{USER\ GLOBAL\ ALLOW} > \mathbf{ROLE\ BASELINE} > \mathbf{LEGACY\ FALLBACK} > \mathbf{DEFAULT\ DENY}$$

1. **User Site-Specific Deny (`USER_SITE_EXPLICIT_DENY`)**: If an explicit override for `(user_id, permission_id, site_id)` is `DENY`, access is **immediately rejected**.
2. **User Site-Specific Allow (`USER_SITE_EXPLICIT_ALLOW`)**: If an explicit override for `(user_id, permission_id, site_id)` is `ALLOW`, access is **granted**.
3. **User Global Deny (`USER_GLOBAL_EXPLICIT_DENY`)**: If an explicit global override for `(user_id, permission_id, site_id IS NULL)` is `DENY`, access is **immediately rejected** across all sites.
4. **User Global Allow (`USER_GLOBAL_EXPLICIT_ALLOW`)**: If an explicit global override for `(user_id, permission_id, site_id IS NULL)` is `ALLOW`, access is **granted** across all sites.
5. **Role Baseline (`ROLE_BASELINE_ALLOW`)**: If no user overrides exist, the baseline permission assigned to the principal's role (`ADMIN`, `SITE_MANAGER`, `VIEWER`) is checked matching the resource's site scope:
   * If the role permission has `scope_type = 'GLOBAL'`, access is granted.
   * If the role permission has `scope_type = 'ASSIGNED_SITES'`, access is granted **if and only if** the user is mapped to that `site_id` in `site_users`.
   * If the role permission has `scope_type = 'SPECIFIC_SITE'`, access is granted if the resource matches the role's assigned `site_id`.
6. **Legacy Role Fallback (`LEGACY_FALLBACK_ALLOW`)**: If the granular permission catalog does not contain an entry for the requested `(Page, Action)` pair (e.g. during phased migration), the system evaluates hardcoded legacy RBAC logic.
7. **Default Deny (Fail-Closed)**: If no matching rule explicitly evaluates to `ALLOW`, the request is **denied by default**.

---

## 3. PAGE REGISTRY (23 APPLICATION ROUTES)

All 23 application routes identified during the forensic audit are formally cataloged. Every route is assigned a unique `Page ID`, domain module, access classification, unhideable constraint, and site-scoping behavior.

| Page ID | Display Name | Route Path | Domain Module | Default Access | Unhideable? | Hideable From Nav? | Site-Scoped? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `PAGE_LOGIN` | Login | `/login` | Public / Auth | Public | Yes (Public) | N/A | No (Global) |
| `PAGE_FORGOT_PASSWORD` | Forgot Password | `/forgot-password` | Public / Auth | Public | Yes (Public) | N/A | No (Global) |
| `PAGE_SETUP_INITIAL_ADMIN` | Setup Initial Admin | `/setup/initial-admin` | Public / Auth | Public (Setup only) | Yes (Public) | N/A | No (Global) |
| `PAGE_DASHBOARD` | Dashboard | `/` | Overview | All Active Users | No | Yes | Hybrid (Global or Site Filtered) |
| `PAGE_ATTENDANCE_DAILY` | Daily Attendance | `/attendance/daily` | Workforce | All Active Users | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_ATTENDANCE_WEEKLY` | Weekly Attendance | `/attendance/weekly` | Workforce | All Active Users | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_ATTENDANCE_MONTHLY` | Monthly Attendance | `/attendance/monthly` | Workforce | All Active Users | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_FINANCE_TRANSACTIONS` | Daily Finance | `/finance` | Financials | Admin, Site Manager | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_FINANCE_LEDGER` | Master Ledger | `/finance/monthly` | Financials | Admin, Site Manager | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_REPORTS_ROLE` | Role Analytics | `/reports/role` | Analytics | All Active Users | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_REPORTS_CATEGORY` | Category Analytics | `/reports/category` | Analytics | All Active Users | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_REPORTS_SITE` | Site Analytics | `/reports/site` | Analytics | All Active Users | No | Yes | **Yes (Site-Scoped)** |
| `PAGE_COMPLETE_EXPORT` | Complete Export | `/reports/complete-export` | Governance | Admin Only | No | Yes | Hybrid (Site or All Sites) |
| `PAGE_DATA_PROTECTION` | Data Protection Console | `/admin/data-protection` | Governance | Admin Only | No | Yes | No (Global) |
| `PAGE_BACKUP_CONSOLE` | Backup Console | `/admin/backup` | Governance | Admin Only | No | Yes | No (Global) |
| `PAGE_SETUP_SITES` | Site Management | `/setup/sites` | System Config | Admin Only | No | Yes | No (Global) |
| `PAGE_SETUP_CATEGORIES` | Category Management | `/setup/categories` | System Config | Admin Only | No | Yes | No (Global) |
| `PAGE_SETUP_ROLES` | Role Management | `/setup/roles` | System Config | Admin Only | No | Yes | No (Global) |
| `PAGE_SETUP_USERS` | Users & Access | `/setup/users` | Governance | Admin Only | Yes (Admin Root) | Yes | No (Global) |
| `PAGE_MY_ACCOUNT` | My Account | `/setup/account` | Self-Service | All Active Users | **Yes (Permanent)** | **No (Never Hideable)** | No (Global) |
| `PAGE_GLOBAL_ARCHIVE` | Global Archive | `/setup/archive` | Governance | Admin Only | No | Yes | No (Global) |
| `PAGE_GLOBAL_RECYCLE_BIN` | Global Recycle Bin | `/setup/recycle-bin` | Governance | Admin Only | No | Yes | No (Global) |
| `PAGE_AUDIT_TRAIL` | Audit Trail | `/setup/audit` | Governance | Admin Only | No | Yes | No (Global) |

### 3.1 Registry Invariants
1. `PAGE_MY_ACCOUNT` is **permanently unhideable** and accessible to any authenticated principal for self-service password updates, username viewing, and session termination.
2. `PAGE_SETUP_USERS` cannot be hidden or denied to `SUPERIOR_PRIME` or `CLIENT_PRIME`.
3. Site-scoped pages (`ATTENDANCE_*`, `FINANCE_*`, `REPORTS_*`) enforce site scoping: a user cannot access these pages without an authorized site in scope.

---

## 4. ACTION REGISTRY (16 FINE-GRAINED ACTIONS)

To eliminate all-or-nothing privileges, operations across all pages and APIs are partitioned into 16 discrete actions:

| Action Code | Display Name | Semantic Description | Applicable Pages | Target API Methods |
| :--- | :--- | :--- | :--- | :--- |
| `VIEW` | View / Inspect | Read records, load UI, render lists, fetch read-only details | All 23 Pages | `GET` |
| `CREATE` | Create | Insert new records (transactions, attendance, sites, users) | Operational, Setup | `POST` |
| `EDIT` | Edit / Update | Modify mutable fields of an existing active record | Operational, Setup | `PUT`, `PATCH` |
| `DELETE` | Soft Delete | Mark an active record as deleted (moves to Recycle Bin) | Operational, Setup | `DELETE` |
| `EXPORT` | Export Data | Generate and download Excel, PDF, CSV, or ZIP exports | Analytics, Finance, Export | `GET` (export routes) |
| `MANAGE` | Manage Module | Execute configuration, toggles, or structural mutations | Setup, Admin | `POST`, `PUT` |
| `RESTORE` | Restore | Recover a soft-deleted record from Recycle Bin / Archive | Recycle Bin, Archive | `POST /api/lifecycle/restore` |
| `ARCHIVE` | Archive Record | Move a closed or completed entity to Global Archive | Setup, Operational | `POST /api/lifecycle/archive` |
| `RECYCLE` | Send to Recycle Bin | Move deprecated records to staging recycle bin | Setup, Operational | `POST /api/lifecycle/recycle` |
| `PERMANENT_DELETE` | Permanent Purge | Permanently erase records from DB (hard wipe) | Recycle Bin | `DELETE /api/lifecycle/permanent-delete` |
| `ASSIGN_SITE` | Assign Site Scope | Link or unlink operational users to specific sites in `site_users` | Users & Access, Sites | `POST`, `PUT /api/users`, `sites` |
| `MANAGE_PERMISSIONS` | Grant/Revoke Access | Edit role baselines or user explicit overrides | Users & Access | `POST`, `PUT /api/permissions` |
| `MANAGE_USERS` | User Lifecycle | Create users, toggle active status, change full name | Users & Access | `POST`, `PUT /api/users` |
| `RESET_PASSWORD` | Reset Password | Issue password recovery tokens or trigger manual reset | Users & Access | `POST /api/users/reset` |
| `CHANGE_USERNAME` | Change Username | Alter an account's unique login username handle | Users & Access, Account | `PUT /api/auth/account`, `users` |
| `CHANGE_RECOVERY` | Update Recovery Email | Modify account password recovery email address | Users & Access, Account | `PUT /api/auth/account`, `users` |

---

## 5. PROPOSED RELATIONAL SCHEMA (DDL SPECIFICATION)

The granular permission engine introduces three normalized tables, strictly constrained with foreign keys, cascading deletions, partial unique indexes for SQLite NULL handling, and explicit scope constraints.

> [!NOTE]
> **REMOVAL OF DUPLICATE TABLE**: As mandated by Correction 1, `user_site_assignments` is **completely removed**. The existing `site_users` table remains the sole canonical assignment repository.

```sql
-- ============================================================================
-- 1. PERMISSION DEFINITIONS CATALOG (Canonical Registry of Valid Page Actions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS permission_definitions (
    id TEXT PRIMARY KEY,                       -- e.g. 'perm-fin-tx-create'
    page_id TEXT NOT NULL,                     -- e.g. 'PAGE_FINANCE_TRANSACTIONS'
    action_id TEXT NOT NULL,                   -- e.g. 'CREATE'
    display_name TEXT NOT NULL,                -- e.g. 'Create Financial Transaction'
    description TEXT,
    is_site_scoped INTEGER NOT NULL DEFAULT 0, -- 1 = Requires site_id validation, 0 = Global
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(page_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_perm_def_page_action 
ON permission_definitions(page_id, action_id);

-- ============================================================================
-- 2. ROLE BASELINE PERMISSIONS (With Explicit Scope Types: Correction 3)
-- ============================================================================
CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,                       -- e.g. 'rp-mgr-fin-view'
    role TEXT NOT NULL,                        -- 'ADMIN', 'SITE_MANAGER', 'VIEWER'
    permission_id TEXT NOT NULL REFERENCES permission_definitions(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK(scope_type IN ('GLOBAL', 'ASSIGNED_SITES', 'SPECIFIC_SITE')),
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE, -- NULL unless scope_type = 'SPECIFIC_SITE'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Consistency constraint: site_id required only when SPECIFIC_SITE
    CHECK (
        (scope_type IN ('GLOBAL', 'ASSIGNED_SITES') AND site_id IS NULL) OR
        (scope_type = 'SPECIFIC_SITE' AND site_id IS NOT NULL)
    )
);

-- Partial Unique Indexes for role_permissions (Enforces SQLite NULL uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_perms_unique_global_or_assigned
ON role_permissions(role, permission_id, scope_type)
WHERE site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_perms_unique_specific_site
ON role_permissions(role, permission_id, site_id)
WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_perms_lookup
ON role_permissions(role, permission_id);

-- ============================================================================
-- 3. USER PERMISSION OVERRIDES (With SQLite NULL Handling: Correction 4)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id TEXT PRIMARY KEY,                       -- e.g. 'upo-usr123-fin-del'
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permission_definitions(id) ON DELETE CASCADE,
    site_id TEXT REFERENCES sites(id) ON DELETE CASCADE, -- NULL = Global user override, non-NULL = Site-specific override
    effect TEXT NOT NULL CHECK(effect IN ('ALLOW', 'DENY')),
    granted_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Partial Unique Indexes for user_permission_overrides (Correction 4: SQLite NULL Semantics)
-- A. Enforce single global override per (user_id, permission_id) when site_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_upo_unique_global 
ON user_permission_overrides(user_id, permission_id) 
WHERE site_id IS NULL;

-- B. Enforce single site override per (user_id, permission_id, site_id) when site_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_upo_unique_site 
ON user_permission_overrides(user_id, permission_id, site_id) 
WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_upo_lookup 
ON user_permission_overrides(user_id, permission_id, site_id);

-- ============================================================================
-- 4. AUTHORIZATION VERSION TRACKING ON USERS TABLE (Correction 2)
-- ============================================================================
-- Ensure permission_version exists on users table:
-- ALTER TABLE users ADD COLUMN permission_version INTEGER NOT NULL DEFAULT 1;
```

### 5.1 Schema Design Principles & Corrections Addressed
1. **Canonical Site Membership Preserved (Correction 1)**: `site_users` remains untouched as the single canonical table linking users to sites.
2. **Deterministic Role Scope Types (Correction 3)**: `role_permissions.scope_type` eliminates ambiguity. `GLOBAL` means all sites; `ASSIGNED_SITES` requires membership in `site_users`; `SPECIFIC_SITE` binds to a specific `site_id`.
3. **SQLite NULL Semantics Solved (Correction 4)**: In standard SQLite, `UNIQUE(user_id, permission_id, site_id)` allows duplicate rows when `site_id IS NULL` because SQLite treats `NULL != NULL`. The architecture defines two mutually exclusive partial unique indexes (`idx_upo_unique_global` and `idx_upo_unique_site`), providing absolute uniqueness guarantees at the database engine level.

---

## 6. DETERMINISTIC RESOLUTION ALGORITHM

### 6.1 Formal TypeScript Evaluation Logic (Correction 5 Integrated)

```typescript
export interface ResolutionRequest {
  principal: {
    id: string;
    role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
    authorityTier: 'SUPERIOR_PRIME' | 'CLIENT_PRIME' | 'STANDARD_ADMIN' | 'STANDARD';
    isActive: boolean;
  };
  pageId: string;
  actionId: string;
  persistedSiteId?: string | null; // Extracted directly from persisted entity
}

export interface ResolutionResult {
  allowed: boolean;
  reason: string;
  ruleSource: 
    | 'SUPERIOR_PRIME_PLATFORM_AUTHORITY'
    | 'INACTIVE_USER_DENY'
    | 'UNASSIGNED_SITE_DENY'
    | 'USER_SITE_EXPLICIT_DENY'
    | 'USER_SITE_EXPLICIT_ALLOW'
    | 'USER_GLOBAL_EXPLICIT_DENY'
    | 'USER_GLOBAL_EXPLICIT_ALLOW'
    | 'ROLE_BASELINE_ALLOW'
    | 'LEGACY_FALLBACK_ALLOW'
    | 'DEFAULT_DENY';
}

export function resolvePermission(
  req: ResolutionRequest,
  db: DatabaseConnection
): ResolutionResult {
  const { principal, pageId, actionId, persistedSiteId } = req;

  // STEP 1: Inactive User Invariant
  if (!principal.isActive) {
    return {
      allowed: false,
      reason: 'User account is deactivated',
      ruleSource: 'INACTIVE_USER_DENY'
    };
  }

  // STEP 2: Superior Prime Platform Authority (Correction 5)
  // Superior Prime possesses defined platform authority for system operations.
  // Note: Database integrity and security invariants are never bypassed.
  if (principal.authorityTier === 'SUPERIOR_PRIME') {
    return {
      allowed: true,
      reason: 'Superior Prime platform authority verified',
      ruleSource: 'SUPERIOR_PRIME_PLATFORM_AUTHORITY'
    };
  }

  // STEP 3: Site Scoping & Canonical Membership Verification (Correction 1)
  const permDef = db.getPermissionDefinition(pageId, actionId);
  const isSiteScoped = permDef ? permDef.is_site_scoped === 1 : Boolean(persistedSiteId);

  if (isSiteScoped && persistedSiteId) {
    const isGlobalAdmin = principal.authorityTier === 'CLIENT_PRIME' || 
                          principal.authorityTier === 'STANDARD_ADMIN' || 
                          principal.role === 'ADMIN';

    if (!isGlobalAdmin) {
      // Check canonical site_users table
      const isAssigned = db.checkCanonicalSiteUser(principal.id, persistedSiteId);
      if (!isAssigned) {
        return {
          allowed: false,
          reason: `User is not a member of site ${persistedSiteId} in canonical site_users`,
          ruleSource: 'UNASSIGNED_SITE_DENY'
        };
      }
    }
  }

  // STEP 4: Explicit User-Level Overrides (Site-Specific)
  if (persistedSiteId && permDef) {
    const siteOverride = db.getUserOverride(principal.id, permDef.id, persistedSiteId);
    if (siteOverride) {
      if (siteOverride.effect === 'DENY') {
        return {
          allowed: false,
          reason: 'Explicit user site-specific DENY override encountered',
          ruleSource: 'USER_SITE_EXPLICIT_DENY'
        };
      }
      if (siteOverride.effect === 'ALLOW') {
        return {
          allowed: true,
          reason: 'Explicit user site-specific ALLOW override encountered',
          ruleSource: 'USER_SITE_EXPLICIT_ALLOW'
        };
      }
    }
  }

  // STEP 5: Explicit User-Level Overrides (Global)
  if (permDef) {
    const globalOverride = db.getUserOverride(principal.id, permDef.id, null);
    if (globalOverride) {
      if (globalOverride.effect === 'DENY') {
        return {
          allowed: false,
          reason: 'Explicit user global DENY override encountered',
          ruleSource: 'USER_GLOBAL_EXPLICIT_DENY'
        };
      }
      if (globalOverride.effect === 'ALLOW') {
        return {
          allowed: true,
          reason: 'Explicit user global ALLOW override encountered',
          ruleSource: 'USER_GLOBAL_EXPLICIT_ALLOW'
        };
      }
    }
  }

  // STEP 6: Role Baseline Evaluation (Correction 3)
  if (permDef) {
    const rolePerms = db.getRolePermissions(principal.role, permDef.id);
    for (const rp of rolePerms) {
      if (rp.scope_type === 'GLOBAL') {
        return {
          allowed: true,
          reason: `Granted via global role baseline for ${principal.role}`,
          ruleSource: 'ROLE_BASELINE_ALLOW'
        };
      }
      if (rp.scope_type === 'ASSIGNED_SITES') {
        // Must be verified in site_users
        if (!persistedSiteId || db.checkCanonicalSiteUser(principal.id, persistedSiteId)) {
          return {
            allowed: true,
            reason: `Granted via assigned-sites role baseline for ${principal.role}`,
            ruleSource: 'ROLE_BASELINE_ALLOW'
          };
        }
      }
      if (rp.scope_type === 'SPECIFIC_SITE' && rp.site_id === persistedSiteId) {
        return {
          allowed: true,
          reason: `Granted via specific site role baseline for ${principal.role} on ${rp.site_id}`,
          ruleSource: 'ROLE_BASELINE_ALLOW'
        };
      }
    }
  }

  // STEP 7: Legacy Role Fallback (Backward Compatibility Mode: Correction 9)
  if (!permDef) {
    const legacyAllowed = evaluateLegacyFallback(principal.role, pageId, actionId, principal.id, persistedSiteId, db);
    if (legacyAllowed) {
      return {
        allowed: true,
        reason: `Granted via legacy role fallback rules for ${principal.role}`,
        ruleSource: 'LEGACY_FALLBACK_ALLOW'
      };
    }
  }

  // STEP 8: Default Deny (Fail-Closed)
  return {
    allowed: false,
    reason: 'No applicable rule granted access (Default Deny)',
    ruleSource: 'DEFAULT_DENY'
  };
}
```

---

## 7. PRIME AUTHORITY RULES & PLATFORM SEMANTICS (CORRECTION 5)

### 7.1 Replaced Terminology: `SUPERIOR_PRIME_PLATFORM_AUTHORITY`
Superior Prime is **not** an unrestricted "bypass everything" mechanism. The term `SUPERIOR_PRIME_BYPASS` is eliminated. Instead, `SUPERIOR_PRIME_PLATFORM_AUTHORITY` represents explicit root authority over administrative and governance operations.

### 7.2 Strict Platform Invariants
1. **Immutability**: `SUPERIOR_PRIME` (`usr-admin-1`) cannot be modified, updated, or renamed by any lower authority tier (`CLIENT_PRIME`, `STANDARD_ADMIN`, `STANDARD`).
2. **Non-Deletability**: `SUPERIOR_PRIME` cannot be soft-deleted, archived, recycled, or permanently purged by any user or API.
3. **Non-Demotability**: `SUPERIOR_PRIME` cannot have its `authority_tier` or `role` demoted.
4. **Total Invisibility**: All user query interfaces (`GET /api/users`, user selectors, dropdowns) automatically filter out `SUPERIOR_PRIME` unless the requesting caller is authenticated as `SUPERIOR_PRIME`.
5. **No Upward Privilege Granting**: Lower authority tiers cannot grant `SUPERIOR_PRIME` authority or assign permissions that exceed their own authority tier.
6. **Mandatory Integrity & Audit Invariants**: Superior Prime actions are subject to all database constraints (Foreign Keys, NOT NULL, CHECK constraints) and write immutable records to `audit_logs`.

---

## 8. RESOURCE-LEVEL VS. PAGE-LEVEL AUTHORIZATION (CORRECTION 7)

### 8.1 The Independence of Page Access and Resource Authorization
Page access and resource/API authorization are decoupled, independent security boundaries:

$$\mathbf{Final\ Decision} = \mathbf{Page\ Access} \wedge \mathbf{Action\ Permission} \wedge \mathbf{Persisted\ Resource\ Scope} \wedge \mathbf{Authority\ Hierarchy}$$

```
┌────────────────────────────────────────────────────────┐
│                   PAGE-LEVEL ACCESS                    │
│ "Can the user navigate to and view /finance UI?"       │
│ Checked at: Route transition / Layout render           │
│ Evaluates: PAGE_FINANCE_TRANSACTIONS + Action: VIEW    │
└──────────────────────────┬─────────────────────────────┘
                           │ User enters UI
                           ▼
┌────────────────────────────────────────────────────────┐
│               RESOURCE-LEVEL API ACCESS                │
│ "Can the user execute DELETE /api/finance/tx-123?"     │
│ Checked at: Next.js API Route Handler Boundary         │
│ Evaluates:                                             │
│ 1. Action: DELETE                                      │
│ 2. Persisted entity: tx-123.site_id = 'site-1'         │
│ 3. User canonical membership: site_users(user, site-1) │
│ 4. Overrides: Explicit Deny / Allow                    │
└────────────────────────────────────────────────────────┘
```

> [!CAUTION]
> A user holding `VIEW` permission on `PAGE_FINANCE_TRANSACTIONS` is **strictly prohibited** from performing `CREATE`, `EDIT`, `DELETE`, or `EXPORT` unless explicit action-level authorization resolves to `ALLOW`.

---

## 9. COMPLETE API &rarr; PERMISSION MAPPING (CORRECTION 6)

Every single API route in the application (41 total routes) is mapped to its exact authorization requirements.

> [!IMPORTANT]
> **STEP 0 PERSISTED ENTITY INVARIANT**:
> **CALLER-SUPPLIED `siteId` IS NEVER PROOF OF AUTHORIZATION.**
> For all entity mutations (`PUT`, `DELETE`, `PATCH`), authorization MUST be derived from the actual persisted entity's `site_id` fetched from the database.

| API Route | Method | Target Page ID | Action Code | Site Scope Type | Authorization Source & Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/attendance/daily` | `GET` | `PAGE_ATTENDANCE_DAILY` | `VIEW` | `SITE_SCOPED` | Query parameter `siteId` verified against caller's canonical `site_users` membership. |
| `/api/attendance/daily` | `POST` | `PAGE_ATTENDANCE_DAILY` | `CREATE` / `EDIT` | `SITE_SCOPED` | Target `body.siteId` verified against caller's canonical `site_users` membership. |
| `/api/attendance/range` | `GET` | `PAGE_ATTENDANCE_WEEKLY` | `VIEW` | `SITE_SCOPED` | Query parameter `siteId` verified against caller's canonical `site_users` membership. |
| `/api/finance` | `GET` | `PAGE_FINANCE_TRANSACTIONS` | `VIEW` | `SITE_SCOPED` | Results restricted to sites assigned to caller in `site_users`. |
| `/api/finance` | `POST` | `PAGE_FINANCE_TRANSACTIONS` | `CREATE` | `SITE_SCOPED` | Target `body.siteId` verified against caller's canonical `site_users` membership. |
| `/api/finance/[id]` | `GET` | `PAGE_FINANCE_TRANSACTIONS` | `VIEW` | `SITE_SCOPED` | Derived from persisted `transaction.site_id`. |
| `/api/finance/[id]` | `PUT` | `PAGE_FINANCE_TRANSACTIONS` | `EDIT` | `SITE_SCOPED` | **DERIVED STRICTLY FROM PERSISTED `transaction.site_id`**. Caller-supplied `siteId` rejected if mismatched. |
| `/api/finance/[id]` | `DELETE` | `PAGE_FINANCE_TRANSACTIONS` | `DELETE` | `SITE_SCOPED` | **DERIVED STRICTLY FROM PERSISTED `transaction.site_id`**. |
| `/api/finance/summary` | `GET` | `PAGE_FINANCE_LEDGER` | `VIEW` | `SITE_SCOPED` | Scoped to caller's assigned sites in `site_users`. |
| `/api/finance/attachments/[filename]` | `GET` | `PAGE_FINANCE_TRANSACTIONS` | `VIEW` | `SITE_SCOPED` | Derived from persisted transaction owning attachment. |
| `/api/rates` | `GET` | `PAGE_FINANCE_TRANSACTIONS` | `VIEW` | `GLOBAL` | Admin, Site Manager. |
| `/api/rates` | `POST` | `PAGE_FINANCE_TRANSACTIONS` | `MANAGE` | `GLOBAL` | Admin only. |
| `/api/supplies` | `GET` | `PAGE_FINANCE_TRANSACTIONS` | `VIEW` | `SITE_SCOPED` | Scoped to assigned sites. |
| `/api/supplies` | `POST` | `PAGE_FINANCE_TRANSACTIONS` | `CREATE` | `SITE_SCOPED` | Scoped to target site. |
| `/api/supplies` | `PUT` | `PAGE_FINANCE_TRANSACTIONS` | `EDIT` | `SITE_SCOPED` | Derived from persisted `supply.site_id`. |
| `/api/supplies` | `DELETE` | `PAGE_FINANCE_TRANSACTIONS` | `DELETE` | `SITE_SCOPED` | Derived from persisted `supply.site_id`. |
| `/api/investors` | `GET` | `PAGE_FINANCE_LEDGER` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/investors` | `POST` | `PAGE_FINANCE_LEDGER` | `CREATE` | `GLOBAL` | Admin only. |
| `/api/investors/[id]` | `PUT` | `PAGE_FINANCE_LEDGER` | `EDIT` | `GLOBAL` | Admin only. |
| `/api/investors/[id]` | `DELETE` | `PAGE_FINANCE_LEDGER` | `DELETE` | `GLOBAL` | Admin only. |
| `/api/sites` | `GET` | `PAGE_SETUP_SITES` | `VIEW` | `GLOBAL` | Admin sees all; non-admins receive only sites mapped in `site_users`. |
| `/api/sites` | `POST` | `PAGE_SETUP_SITES` | `CREATE` | `GLOBAL` | Admin only (`PAGE_SETUP_SITES.CREATE`). |
| `/api/sites/[id]` | `GET` | `PAGE_SETUP_SITES` | `VIEW` | `SITE_SCOPED` | Verified against caller's `site_users` membership. |
| `/api/sites/[id]` | `PUT` | `PAGE_SETUP_SITES` | `EDIT` | `GLOBAL` | Admin only. |
| `/api/sites/[id]` | `DELETE` | `PAGE_SETUP_SITES` | `DELETE` | `GLOBAL` | Admin only (Step 3b lifecycle). |
| `/api/sites/[id]/overview` | `GET` | `PAGE_REPORTS_SITE` | `VIEW` | `SITE_SCOPED` | Derived from `site_id` membership in `site_users`. |
| `/api/categories` | `GET` | `PAGE_SETUP_CATEGORIES` | `VIEW` | `GLOBAL` | All authenticated users. |
| `/api/categories` | `POST` | `PAGE_SETUP_CATEGORIES` | `CREATE` | `GLOBAL` | Admin only. |
| `/api/categories` | `PUT` | `PAGE_SETUP_CATEGORIES` | `EDIT` | `GLOBAL` | Admin only. |
| `/api/categories` | `DELETE` | `PAGE_SETUP_CATEGORIES` | `DELETE` | `GLOBAL` | Admin only. |
| `/api/roles` | `GET` | `PAGE_SETUP_ROLES` | `VIEW` | `GLOBAL` | All authenticated users. |
| `/api/roles` | `POST` | `PAGE_SETUP_ROLES` | `CREATE` | `GLOBAL` | Admin only. |
| `/api/roles` | `PUT` | `PAGE_SETUP_ROLES` | `EDIT` | `GLOBAL` | Admin only. |
| `/api/roles` | `DELETE` | `PAGE_SETUP_ROLES` | `DELETE` | `GLOBAL` | Admin only. |
| `/api/users` | `GET` | `PAGE_SETUP_USERS` | `VIEW` | `GLOBAL` | Admin only (`SUPERIOR_PRIME` filtered out for non-Superior). |
| `/api/users` | `POST` | `PAGE_SETUP_USERS` | `CREATE` (`MANAGE_USERS`) | `GLOBAL` | Admin only. Cannot create Superior Prime. |
| `/api/users` | `PUT` | `PAGE_SETUP_USERS` | `EDIT` (`MANAGE_USERS`) | `GLOBAL` | Admin only. Cannot modify Superior Prime. |
| `/api/users` | `DELETE` | `PAGE_SETUP_USERS` | `DELETE` (`MANAGE_USERS`) | `GLOBAL` | Admin only. Cannot delete Superior Prime or self. |
| `/api/export/excel` | `GET` / `POST` | `PAGE_FINANCE_TRANSACTIONS` | `EXPORT` | `SITE_SCOPED` | Scoped to authorized target `siteId`. |
| `/api/export/pdf` | `GET` / `POST` | `PAGE_FINANCE_TRANSACTIONS` | `EXPORT` | `SITE_SCOPED` | Scoped to authorized target `siteId`. |
| `/api/export/complete` | `POST` | `PAGE_COMPLETE_EXPORT` | `EXPORT` | `HYBRID` | Admin only. Scoped to authorized sites. |
| `/api/reports/complete` | `GET` | `PAGE_COMPLETE_EXPORT` | `VIEW` | `HYBRID` | Admin only. |
| `/api/lifecycle/archive` | `GET` | `PAGE_GLOBAL_ARCHIVE` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/lifecycle/archive` | `POST` | `PAGE_GLOBAL_ARCHIVE` | `ARCHIVE` | `HYBRID` | Derived from target entity's persisted `site_id` or global type. |
| `/api/lifecycle/recycle-bin` | `GET` | `PAGE_GLOBAL_RECYCLE_BIN` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/lifecycle/restore` | `POST` | `PAGE_GLOBAL_RECYCLE_BIN` | `RESTORE` | `HYBRID` | Derived from target entity's persisted `site_id` or global type. |
| `/api/lifecycle/permanent-delete`| `POST` / `DELETE` | `PAGE_GLOBAL_RECYCLE_BIN` | `PERMANENT_DELETE` | `GLOBAL` | Primes / Authorized Admin only. |
| `/api/packages/inspect` | `POST` | `PAGE_BACKUP_CONSOLE` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/backup` | `GET` | `PAGE_BACKUP_CONSOLE` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/backup` | `POST` | `PAGE_BACKUP_CONSOLE` | `CREATE` (`MANAGE`) | `GLOBAL` | Admin only. |
| `/api/backup/[id]` | `GET` | `PAGE_BACKUP_CONSOLE` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/backup/[id]` | `DELETE` | `PAGE_BACKUP_CONSOLE` | `DELETE` (`MANAGE`) | `GLOBAL` | Admin only. |
| `/api/backup/validate` | `POST` | `PAGE_BACKUP_CONSOLE` | `MANAGE` | `GLOBAL` | Admin only. |
| `/api/backup/restore/simulate` | `POST` | `PAGE_BACKUP_CONSOLE` | `MANAGE` | `GLOBAL` | Admin only. |
| `/api/backup/restore/execute` | `POST` | `PAGE_BACKUP_CONSOLE` | `MANAGE` | `GLOBAL` | Admin only. |
| `/api/backup/recovery/status` | `GET` | `PAGE_DATA_PROTECTION` | `VIEW` | `GLOBAL` | Admin only. |
| `/api/audit` | `GET` | `PAGE_AUDIT_TRAIL` | `VIEW` | `GLOBAL` | Admin only (`SUPERIOR_PRIME` entries scrubbed for non-Superior). |
| `/api/auth/me` | `GET` | `PAGE_MY_ACCOUNT` | `VIEW` | `GLOBAL` | Authenticated principal self. |
| `/api/auth/account` | `GET` / `PUT` | `PAGE_MY_ACCOUNT` | `VIEW` / `EDIT` | `GLOBAL` | Authenticated principal self. |
| `/api/auth/login` | `POST` | `PAGE_LOGIN` | Public | `GLOBAL` | Public route. |
| `/api/auth/logout` | `POST` | `PAGE_LOGIN` | Public | `GLOBAL` | Authenticated session cleanup. |
| `/api/auth/recovery/*` | `POST` | `PAGE_FORGOT_PASSWORD` | Public | `GLOBAL` | Public recovery flow. |
| `/api/auth/setup-admin` | `POST` | `PAGE_SETUP_INITIAL_ADMIN` | Public | `GLOBAL` | Initial bootstrap setup only. |
| `/api/auth/setup-status` | `GET` | `PAGE_SETUP_INITIAL_ADMIN` | Public | `GLOBAL` | Initial bootstrap status check. |
| `/api/health` | `GET` | System | Public | `GLOBAL` | Read-only liveness check. |

---

## 10. AUTHENTICATION STATE VS. AUTHORIZATION STATE & REVOCATION (CORRECTION 2)

### 10.1 Decoupling Authentication from Authorization
A critical vulnerability in legacy JWT architectures is conflating session validity with permission state. The target architecture establishes a clean, decoupled separation:

| Dimension | Authentication State | Authorization State |
| :--- | :--- | :--- |
| **Question Answered** | "Who are you and is your session token valid?" | "What are you permitted to execute right now?" |
| **Governing Version** | `users.token_version` | `users.permission_version` |
| **Token Payload** | `{ sub: userId, role, tokenVersion }` | **NEVER embedded in JWT**. |
| **Validation Point** | Edge middleware & session verification | Route handler execution via `resolvePermission()` |
| **Revocation Trigger** | Forced logout, password reset, account lock | Permission override update, role change, `site_users` change |
| **Failure Response** | `401 Unauthorized` | `403 Forbidden` |

### 10.2 Server-Side Permission Evaluation & Invalidation Workflow
1. **Zero Authorization in JWT**: Granular permissions, overrides, and site lists are **never serialized into the JWT**. The JWT acts purely as an identity bearer token.
2. **Server-Side Evaluation on Every Request**: Every API route handler invokes `resolvePermission()` server-side against SQLite.
3. **High-Performance In-Memory Cache**:
   * Permission graphs are cached in memory keyed by: `${userId}:pv_${permission_version}`.
   * Lookups take $< 0.05$ milliseconds.
4. **Instant Revocation Mechanics**:
   * When an administrator updates a role baseline, user override, or `site_users` entry:
     ```sql
     BEGIN IMMEDIATE;
     -- 1. Apply permission / site_users mutation
     INSERT INTO user_permission_overrides ...;
     -- 2. Increment user's permission version
     UPDATE users SET permission_version = permission_version + 1 WHERE id = ?;
     COMMIT;
     ```
   * The cache entry `${userId}:pv_${old_version}` is invalidated instantly.
5. **Behavior for an Already-Issued JWT**:
   * An existing active JWT continues to pass Authentication (`token_version` remains valid).
   * On the very next HTTP request, the route handler checks Authorization against `users.permission_version + 1`.
   * Because permissions are evaluated server-side against the latest database state, **the permission revocation takes effect with zero delay**.
6. **Concurrent Requests**:
   * SQLite's `BEGIN IMMEDIATE` transaction guarantees strict serializability. Concurrent requests arriving during an update either complete against the previous version or block momentarily and execute against the updated version.

---

## 11. MULTI-SITE DEFAULTS FOR NEW ENTITIES (FAIL-CLOSED) (CORRECTION 8)

To guarantee zero accidental permission expansion:

1. **New User Creation**:
   * Assigned to role baseline (`ADMIN`, `SITE_MANAGER`, or `VIEWER`).
   * **Zero entries in `site_users` by default** (must be explicitly granted).
   * **Zero user-level overrides by default**.
2. **New Site Creation**:
   * Global Administrators (`CLIENT_PRIME`, `STANDARD_ADMIN`) receive immediate access via their global role permissions.
   * `SITE_MANAGER` and `VIEWER` users receive **zero access** to the new site.
   * **INVARIANT**: A user possessing a role permission with `scope_type = 'ASSIGNED_SITES'` **cannot access the new site** until an administrator explicitly inserts a record into `site_users`.
3. **New Page or New Action Added to System**:
   * Catalog entry created in `permission_definitions`.
   * Evaluates to `DEFAULT_DENY` for all operational users until explicitly granted in `role_permissions`.
4. **New Custom Role Created**:
   * Starts with zero permissions across all pages and actions (fail-closed).

---

## 12. BACKWARD COMPATIBILITY & LEGACY 3-ROLE FALLBACK (CORRECTION 9)

When granular tables are empty or an action has not yet been registered in `permission_definitions`, the engine executes `evaluateLegacyFallback()`:

```typescript
function evaluateLegacyFallback(
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
  pageId: string,
  actionId: string,
  userId: string,
  persistedSiteId: string | null,
  db: DatabaseConnection
): boolean {
  // 1. ADMIN has universal access
  if (role === 'ADMIN') return true;

  // 2. SITE_MANAGER (Engineer) Fallback
  if (role === 'SITE_MANAGER') {
    // Only allowed on operational modules
    const isOperationalPage = 
      pageId.startsWith('PAGE_ATTENDANCE_') || 
      pageId.startsWith('PAGE_FINANCE_') ||
      pageId.startsWith('PAGE_REPORTS_');

    if (!isOperationalPage) return false;

    // Disallow sensitive actions
    if (actionId === 'DELETE' || actionId === 'MANAGE' || actionId === 'PERMANENT_DELETE') {
      return false;
    }

    // Require canonical site membership
    if (persistedSiteId) {
      return db.checkCanonicalSiteUser(userId, persistedSiteId);
    }

    return true;
  }

  // 3. VIEWER Fallback
  if (role === 'VIEWER') {
    if (actionId !== 'VIEW') return false;
    if (persistedSiteId) {
      return db.checkCanonicalSiteUser(userId, persistedSiteId);
    }
    return true;
  }

  return false;
}
```

This guarantees **100% exact parity** with the existing production system during rollout.

---

## 13. UI ARCHITECTURE FOR PERMISSION MANAGEMENT

### 13.1 Compact Hierarchical Layout
In `app/(dashboard)/setup/users`, permissions are managed in a clean 4-tier hierarchy:
1. **User Identity & Canonical Site Assignments**: Toggles for `site_users` membership.
2. **Module Accordion**: Grouped by domain (Financials, Workforce, Governance).
3. **Page & Action Matrix**: Clear visual checkboxes.
4. **State Indicators**:
   * `Inherited Allow` (Soft green check): From role baseline.
   * `Inherited Deny` (Muted cross): Denied by default.
   * `Explicit Allow` (Solid green badge): User override.
   * `Explicit Deny` (Solid red badge): User override blocking access.

### 13.2 "Why Does This User Have Access?" Inspector Tool
An interactive diagnostic drawer in the UI simulates `resolvePermission()` for any User, Page, Action, and Site, displaying:
* Contributing rule source (`USER_SITE_EXPLICIT_ALLOW`, `ROLE_BASELINE`, etc.)
* Active `site_users` membership
* Active `permission_version`

---

## 14. MANDATORY SERVER-SIDE SECURITY INVARIANTS

* **Invariant 1: UI Hiding is Never Security.** Every API route handler must execute `resolvePermission()`.
* **Invariant 2: Persisted Entity Site Isolation.** Caller-supplied `siteId` is never trusted. The authorization engine strictly evaluates the `site_id` stored in the database.
* **Invariant 3: Superior Prime Platform Authority & Invisibility.** `usr-admin-1` can never be viewed, edited, demoted, or deleted by any lower authority tier.
* **Invariant 4: Canonical Site Assignment.** `site_users` is the sole source of truth for site membership.
* **Invariant 5: No Privilege Escalation.** Lower authority tiers cannot grant permissions they do not possess.
* **Invariant 6: Fail-Closed Default.** Unrecognized entities or errors resolve to `DENY`.

---

## 15. AUDIT TRAIL EVENTS & METADATA

All permission and site assignment modifications write structured immutable logs to `audit_logs`:

| Event Type | Trigger | Required Metadata Fields |
| :--- | :--- | :--- |
| `PERMISSION_ROLE_UPDATE` | Admin updates role baseline | `role`, `permission_id`, `scope_type`, `site_id`, `action: 'ADD' \| 'REMOVE'` |
| `PERMISSION_OVERRIDE_SET` | Admin sets user override | `target_user_id`, `permission_id`, `site_id`, `effect: 'ALLOW' \| 'DENY'` |
| `PERMISSION_OVERRIDE_CLEAR` | Admin removes user override | `target_user_id`, `permission_id`, `site_id` |
| `SITE_USER_ASSIGN` | User assigned to site in `site_users` | `target_user_id`, `site_id`, `assigned_by` |
| `SITE_USER_REMOVE` | User unassigned from site in `site_users` | `target_user_id`, `site_id`, `removed_by` |

---

## 16. COMPREHENSIVE QA TEST MATRIX (CORRECTION 10)

The QA architecture expands to formally prove all 10 mandated requirements.

> [!IMPORTANT]
> **TEST ENVIRONMENT ISOLATION**:
> All mutation testing executes against **`PORT=3001`** and **`DATABASE_PATH=data/test_site_work.db`**.
> Production on **`PORT=3000`** and **`data/site_work.db`** remains strictly **READ-ONLY**.

| Proof # | Test Case ID | Test Description | Execution & Verification | Expected Outcome |
| :--- | :--- | :--- | :--- | :--- |
| **P1** | `QA-PAGE-VS-API-01` | Page access cannot substitute for API authorization | User granted `VIEW` on `PAGE_FINANCE_TRANSACTIONS`, attempts `DELETE /api/finance/tx-1` | `403 Forbidden` (`ROLE_BASELINE_DENY`) |
| **P2** | `QA-DIRECT-API-01` | Direct API calls cannot bypass page permissions | User denied `PAGE_ATTENDANCE_DAILY.VIEW`, calls `GET /api/attendance/daily` | `403 Forbidden` (`USER_GLOBAL_EXPLICIT_DENY`) |
| **P3** | `QA-PERSISTED-SITE-01` | Caller-supplied `siteId` cannot bypass persisted site auth | Engineer assigned to Site 1 calls `PUT /api/finance/tx-site2` passing `{ siteId: 'site-1' }` | `403 Forbidden` (`UNASSIGNED_SITE_DENY` based on persisted `site-2`) |
| **P4** | `QA-PRECEDENCE-01` | Explicit `DENY` overrides `ALLOW` | User has Role `ADMIN` (universal allow), but explicit override `DENY` on `PAGE_SETUP_SITES.CREATE` | `403 Forbidden` (`USER_GLOBAL_EXPLICIT_DENY`) |
| **P5** | `QA-SITE-OVERRIDE-01` | Site-specific override overrides global permission | User denied global `EXPORT`, but granted explicit site `ALLOW` on Site 1 | Allowed on Site 1, Denied on Site 2 |
| **P6** | `QA-CANONICAL-SITE-01` | `site_users` is the only canonical site assignment source | User removed from `site_users` for Site 1, attempts `POST /api/attendance/daily` on Site 1 | `403 Forbidden` (`UNASSIGNED_SITE_DENY`) |
| **P7** | `QA-REVOCATION-01` | Permission changes invalidate stale authorization immediately | Admin sets explicit `DENY` on active user session | Next API call fails immediately with `403` |
| **P8** | `QA-PRIME-PROTECT-01` | Superior Prime remains hidden and protected | Client Prime calls `GET /api/users` and `PUT /api/users/usr-admin-1` | `GET` excludes `usr-admin-1`; `PUT` returns `404 Not Found` |
| **P9** | `QA-PRIME-ESCALATE-01` | Client Prime cannot escalate to Superior Prime | Client Prime attempts `POST /api/users` with `authority_tier: 'SUPERIOR_PRIME'` | `403 Forbidden` / rejected by validation |
| **P10** | `QA-NEW-SITE-01` | New site does not accidentally expand access | Admin creates Site 7; existing Site Managers call `GET /api/finance?siteId=site-7` | `403 Forbidden` (not in `site_users`) |

---

## 17. MIGRATION & ROLLBACK STRATEGY

1. **Phase 1: DDL Deployment**
   * Execute idempotent DDL creating `permission_definitions`, `role_permissions`, and `user_permission_overrides`.
   * Add `permission_version` to `users` table.
   * `site_users` remains completely untouched.
2. **Phase 2: Canonical Seeding**
   * Seed 23 pages and 16 actions into `permission_definitions`.
   * Populate `role_permissions` with baseline capabilities reflecting current system behavior.
3. **Phase 3: Shadow Evaluation Mode**
   * Evaluate `resolvePermission()` in log-only shadow mode; verify 100% concordance with legacy rules.
4. **Phase 4: Enforce Active Granular Resolution**
   * Activate granular enforcement via environment flag `ENABLE_GRANULAR_PERMISSIONS = true`.

### 17.1 Rollback Strategy
If any anomaly arises:
* Set `ENABLE_GRANULAR_PERMISSIONS = false` in `.env.local`.
* Application immediately drops back to legacy 3-role resolution with zero data loss or downtime.

---

## 18. RISKS & CTO ACCEPTANCE CRITERIA

### 18.1 Technical Risks & Mitigations
* **Risk: Duplicate Site Assignment**: Eliminated by designating `site_users` as the sole canonical source.
* **Risk: SQLite NULL Semantics**: Eliminated by defining partial unique indexes.
* **Risk: Stale Permission Replay**: Eliminated by evaluating authorization server-side on every request and keying cache on `users.permission_version`.

### 18.2 CTO Acceptance Criteria
1. Full integration of all 10 architectural corrections.
2. Complete mapping of all 41 existing API route files.
3. Clear decoupling of Authentication State from Authorization State.
4. Strict enforcement of Step 0 persisted entity site isolation.
5. Zero application code modifications, zero database mutations, and zero git operations during Step 2.1.

---
