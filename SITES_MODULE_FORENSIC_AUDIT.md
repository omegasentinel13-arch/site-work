# SITES MODULE FORENSIC AUDIT & ARCHITECTURAL SAFETY REPORT

**Project**: SITE WORK — Enterprise Construction ERP  
**Module**: Sites Infrastructure, Lifecycle Governance & Global Workspace  
**Author**: Principal CTO, Senior Full-Stack Architect, Database Safety Engineer, UX Architect, Security Engineer & QA Lead  
**Status**: READ-ONLY FORENSIC AUDIT COMPLETE — PENDING USER APPROVAL  
**Date**: September 2026  

---

## 1. Executive Summary & Forensic Baseline

A comprehensive, read-only forensic inspection of the SITE WORK application was executed. This audit covers the database schema, foreign key dependency graph, repository layers, API endpoints, navigation components, session/RBAC boundaries, and UI workflows.

### Verified Database Baseline

| Entity | Current Verified Count | Invariant Status |
| :--- | :--- | :--- |
| `users` | **4** | Preserved (1 Admin, 2 Site Managers, 1 Viewer) |
| `sites` | **6** | Preserved (Site 1, Site 2, 4 Villa Project entries) |
| `site_users` | **3** | Preserved (2 on Site 1, 1 on Site 2) |
| `work_categories` | **4** | Preserved |
| `work_roles` | **23** | Preserved |
| `attendance_records` | **18** | **Critical Financial/Labor Data** (All attached to Site 1) |
| `financial_transactions` | **4** | **Critical Financial Data** (All attached to Site 1: ₹6.0L credit, ₹1.25L debit) |
| `investors` | **1** | Preserved |
| `audit_logs` | **424** | Preserved (423 baseline + 1 verified LOGIN_SUCCESS) |
| `supply_items` | **0** | Preserved |

- `PRAGMA integrity_check`: **`ok`**
- `PRAGMA foreign_key_check`: **`[]`** (Zero foreign key violations)

---

## 2. Foreign Key Dependency Graph & Hard Constraints

Inspection of `pragma_foreign_key_list` reveals the exact dependency graph referencing `sites(id)`:

```
                          ┌──────────────────────────┐
                          │        sites(id)         │
                          └─────────────┬────────────┘
                                        │
     ┌──────────────────┬───────────────┼───────────────┬──────────────────┐
     │ ON DELETE        │ ON DELETE     │ ON DELETE     │ ON DELETE        │ ON DELETE
     │ RESTRICT         │ RESTRICT      │ RESTRICT      │ RESTRICT         │ CASCADE
     ▼                  ▼               ▼               ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌───────────┐ ┌────────────────┐ ┌──────────────┐
│  attendance_ │ │  financial_  │ │ site_role_│ │   site_users   │ │ supply_items │
│   records    │ │ transactions │ │   rates   │ │   (junction)   │ │  (catalog)   │
└──────────────┘ └──────────────┘ └───────────┘ └────────────────┘ └──────────────┘
```

### Forensic Implications of Database Constraints:
1. **`attendance_records.site_id`**: Configured with `ON DELETE RESTRICT`. Any attempt to execute `DELETE FROM sites WHERE id = 'site-1'` will trigger a fatal `SQLITE_CONSTRAINT_FOREIGNKEY` crash in SQLite.
2. **`financial_transactions.site_id`**: Configured with `ON DELETE RESTRICT`. Historical credit/debit records are legally binding financial entries and must **never** be deleted or orphaned.
3. **`site_role_rates.site_id`** & **`site_users.site_id`**: Configured with `ON DELETE RESTRICT`.
4. **Conclusion**: Hard/Permanent deletion of any site containing historical attendance records or financial transactions is **fundamentally unsafe and legally non-compliant**. It must be strictly intercepted and prevented at the repository and API levels with a clear, human-readable rejection explanation.

---

## 3. Existing Implementation Forensic Review

### 3.1 Navigation & Branding
- **Desktop Navigation** (`components/layout/Navigation.tsx`, line 69):
  - Current label: `'Project Sites'` -> Must be updated to: `'SITES'`.
- **Mobile Navigation** (`components/layout/Header.tsx`, line 137):
  - Current label: `'Project Sites'` -> Must be updated to: `'SITES'`.
- **Site Selector**:
  - Located in `components/layout/Header.tsx`. Filters by `is_archived = 0`.
  - Works seamlessly with the site context.

### 3.2 Site Management Page (`app/(dashboard)/setup/sites/page.tsx`)
- Current title is "Construction Sites Directory".
- Displays a basic grid of site cards with name, code, location, and simple archive toggle.
- Deficiencies identified:
  - Missing search functionality.
  - Missing status filter tabs (Active, All, Archived).
  - Missing non-fabricated KPI summary strip.
  - Missing deep "OPEN" site overview with workforce, financial snapshots, categories, and module shortcuts.
  - Lacks structured multi-tier lifecycle (Active -> Archive -> Recycle Bin -> Permanent Deletion).
  - Lacks strict typed confirmation dialogs (`DELETE`, `DELETE PERMANENTLY`).
  - No RBAC checks in the UI: Site Managers or Viewers navigating here currently see mutation buttons even though API rejects them.

### 3.3 Site API Routes & Repository
- `app/api/sites/route.ts`:
  - `GET`: Supports `?includeArchived=true`.
  - `POST`: Enforces `requireAdmin(session)`.
- `app/api/sites/[id]/route.ts`:
  - `GET`: Validates read access.
  - `PUT`: Enforces `requireAdmin(session)`.
  - `PATCH`: Toggles `is_archived`.
  - Missing `DELETE` method handler.
- `lib/db/repositories/site-repo.ts`:
  - `getAllSites(includeArchived, userAllowedSiteIds)`: Simple SQL select.
  - `toggleSiteArchived`: Only flips `is_archived` between 0 and 1.
  - Needs extension to support:
    - Recycle Bin status (`deleted_at`, `keep_permanently`).
    - Dependency analysis (`checkSiteDependencies(siteId)`).
    - Detailed site statistics (`getSiteOperationalStats(siteId)`).
    - Guarded permanent deletion.

### 3.4 My Account & Hidden Pages Architecture (`app/(dashboard)/setup/account/page.tsx`)
- Contains user credential management (Username, Password, Recovery Email).
- Currently has no entry point for "Hidden Pages" / "Advanced Lifecycle Control".
- Admin-only subtle section can be cleanly added to provide direct, secure access to:
  - **Global Archive** (`/setup/archive`)
  - **Global Recycle Bin** (`/setup/recycle-bin`)

---

## 4. Proposed Architectural Design

### 4.1 Schema Migration (Zero-Downtime, Invariant-Preserving)
To support the 4-tier lifecycle without altering existing tables destructively or breaking baseline counts:
```sql
ALTER TABLE sites ADD COLUMN deleted_at TEXT;
ALTER TABLE sites ADD COLUMN keep_permanently INTEGER NOT NULL DEFAULT 0;
```
- When `is_archived = 0 AND deleted_at IS NULL`: Site is **ACTIVE**.
- When `is_archived = 1 AND deleted_at IS NULL`: Site is **ARCHIVED**.
- When `deleted_at IS NOT NULL`: Site is in **RECYCLE BIN** (soft-deleted).
  - If `keep_permanently = 1`: Site will never be auto-purged.
  - If `keep_permanently = 0`: Retained with standard 30-day notice.

### 4.2 Lifecycle State Transitions & Safety Rules

| Transition | From State | To State | Action Name | Required Authorization | Confirmation Protocol |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Archive** | Active | Archived | `SITE_ARCHIVED` | ADMIN | Modal click confirmation |
| **Restore to Active** | Archived | Active | `SITE_RESTORED` | ADMIN | Modal click confirmation |
| **Move to Recycle Bin** | Archived or Active | Recycle Bin | `SITE_MOVED_TO_RECYCLE_BIN` | ADMIN | **Type `DELETE`** to confirm |
| **Restore from Bin** | Recycle Bin | Archived / Active | `SITE_RESTORED_FROM_RECYCLE_BIN` | ADMIN | Modal click confirmation |
| **Toggle Keep Permanently** | Recycle Bin | Recycle Bin | `SITE_KEEP_PERMANENTLY_TOGGLED` | ADMIN | Toggle switch |
| **Permanent Deletion** | Recycle Bin | *Purged* | `SITE_PERMANENTLY_DELETED` | ADMIN | **Type `DELETE PERMANENTLY`** + Dependency Check |

#### Strict Dependency Check Algorithm:
```typescript
function canPermanentlyDeleteSite(siteId: string): { allowed: boolean; reason?: string; counts: DependencyCounts } {
  const counts = {
    attendance: countAttendanceRecords(siteId),
    transactions: countFinancialTransactions(siteId),
    roleRates: countSiteRoleRates(siteId),
    users: countSiteUsers(siteId),
    supplies: countSupplyItems(siteId)
  };

  if (counts.attendance > 0 || counts.transactions > 0) {
    return {
      allowed: false,
      reason: `Permanent deletion blocked: Site has ${counts.attendance} attendance records and ${counts.transactions} financial transactions. Operational & financial history must be preserved for audit compliance.`,
      counts
    };
  }

  return { allowed: true, counts };
}
```

### 4.3 Enterprise Site List & Non-Fabricated KPI Strip
The Sites page will compute and render a live KPI strip directly from verified SQLite records:
- **Total Sites**: `COUNT(*) FROM sites WHERE deleted_at IS NULL`
- **Active Sites**: `COUNT(*) FROM sites WHERE is_archived = 0 AND deleted_at IS NULL`
- **Archived Sites**: `COUNT(*) FROM sites WHERE is_archived = 1 AND deleted_at IS NULL`
- **Sites With Active History**: Count of sites having > 0 attendance records or financial transactions.
- **Total Personnel Assigned**: Count of distinct users mapped in `site_users`.

Search and filtering:
- Instant client-side search by name, code, and location.
- Tabbed filters: `Active` (default), `All`, `Archived`.

### 4.4 Dense Site Overview ("OPEN" Action)
Clicking "OPEN" triggers an enterprise slide-over or modal with real data:
1. **Header**: Site Name, Code, Location, Status Badge, Created Date.
2. **Workforce Snapshot**:
   - Assigned Engineers and Viewers (with full names, usernames, and roles).
   - Total Worker-Days accumulated, total labor cost (in INR).
   - Last recorded attendance date.
3. **Financial Snapshot**:
   - Total Inflow (Credits in INR).
   - Total Outflow (Debits in INR).
   - Net Cash Balance.
   - Transaction Count.
4. **Categories & Roles**:
   - Configured site rates or active roles used at this site.
5. **Recent Operational Activity**:
   - Chronological log of recent attendance dates and financial transactions for this site.
6. **Direct Module Shortcuts**:
   - Quick-action buttons that select this site and navigate directly to `/attendance/daily`, `/finance`, `/finance/monthly` (Master Ledger), and `/reports/site`.

### 4.5 Global Archive & Global Recycle Bin ("Hidden Pages")
Under `app/(dashboard)/setup/account/page.tsx`, an Admin-only section **"Advanced Governance / Hidden Pages"** provides a discrete disclosure toggle. Revealing it exposes:
- **Global Archive Workspace** (`/setup/archive`):
  - View all archived entities (Sites, Investors, Supplies).
  - Search, filter by entity type, and one-click Restore or Move to Recycle Bin.
- **Global Recycle Bin Workspace** (`/setup/recycle-bin`):
  - View all soft-deleted items across the enterprise.
  - Displays deletion date and human-readable retention notice ("Standard 30-day retention window").
  - "Keep Permanently" toggle to exempt critical records from automated purge.
  - Restore action.
  - Guarded Permanent Deletion action with dependency check and `DELETE PERMANENTLY` confirmation.

---

## 5. Security & RBAC Matrix

| Role | View Sites | Search / Filter | Open Site Overview | Create / Edit Site | Archive / Unarchive | Move to Bin / Restore | Hard Delete | Access Hidden Pages |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **ADMIN** | YES | YES | YES | YES | YES | YES | YES (guarded) | YES |
| **SITE_MANAGER** | Assigned only | YES | YES (read-only) | NO | NO | NO | NO | NO |
| **VIEWER** | Assigned only | YES | YES (read-only) | NO | NO | NO | NO | NO |

---

## 6. Verification & Safety Assurance

- **Zero Data Loss**: `Site 1`'s 18 attendance records and 4 financial transactions remain 100% untouched.
- **Zero Foreign Key Violations**: `PRAGMA foreign_key_check` executed after any test operation.
- **Baseline Preserved**: `users` (4), `sites` (6), `attendance_records` (18), `financial_transactions` (4), `investors` (1).
- **TypeScript Integrity**: `npx tsc --noEmit` must pass with zero errors.

---
*Report prepared for architectural sign-off prior to code modifications.*
