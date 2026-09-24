# Implementation Plan — Enterprise Complete / Overall Report Export System (Task 1)

This plan outlines the architecture and execution steps for **Task 1: Enterprise Complete / Overall Report Export System** in the **SITE WORK** application.

---

## 1. Overview & Architecture

### Business Goal
Allow authorized users to generate and download a **complete, consolidated export package (ZIP)** in a single user action. The package consolidates all relevant operational workforce and financial reports for a selected **Site** or the **Entire System** over any chosen date period (including full historical "All Data").

### Key Architectural Tenets
1. **Zero Logic Duplication**: Reuses existing trusted data repositories (`attendance-repo`, `finance-repo`, `site-repo`, `role-repo`) and domain calculation engines (`attendance-engine`, `finance-engine`).
2. **Strict Multi-Site Isolation & RBAC**:
   - `ADMIN`: Full system export + any authorized site.
   - `SITE_MANAGER` (Engineer in UI): Complete Export only for assigned/authorized sites. Cross-site requests or system export attempts result in `403 Forbidden`.
   - `VIEWER`: Completely blocked from the feature (`403 Forbidden` on API, hidden in UI).
3. **True ALL_DATA Bounds**: Unbounded query without artificial dates (`1970` or `2099`). Dynamically determines the actual `MIN(date)` and `MAX(date)` across persisted attendance and financial records for the selected scope. The manifest and headers reflect the true historical span.
4. **Complete Multi-Section PDF & Excel Workbooks**:
   - **Consolidated PDF**: Complete representation of all applicable reports for the site or system (Site Overview, Attendance Rollup, Daily Attendance, Weekly Matrix, Monthly Attendance, Role Breakdown, Category Summary, Finance Ledger, Monthly Statement, Metadata) using `jspdf` and `jspdf-autotable`.
   - **Consolidated Excel**: Multi-sheet `.xlsx` workbook using `exceljs` with full domain detail, accounting currency formatting, freeze panes, and auto-filters.
   - **Structured JSON**: Canonical domain export with metadata and data tables, strictly omitting secrets/hashes.
   - **Single ZIP Bundle**: Packaged with `jszip`, containing `manifest.json`, `data/*.json`, `pdf/*.pdf`, `excel/*.xlsx`, and `README.txt`.
5. **Zero Impact on Task 2**: No SQLite backup, snapshot, or restore functionality is implemented.

---

## 2. Proposed Changes & File Structure

```
SITE WORK/
├── lib/
│   ├── export/
│   │   ├── complete/
│   │   │   ├── types.ts              [NEW] Types & schemas for Complete Export
│   │   │   ├── periods.ts            [NEW] Date range calculation for all period presets
│   │   │   ├── data-collector.ts     [NEW] Unified data fetching & domain rollup service
│   │   │   ├── json-generator.ts     [NEW] Canonical structured JSON generator
│   │   │   ├── pdf-consolidator.ts   [NEW] Multi-section consolidated PDF generator
│   │   │   ├── excel-consolidator.ts [NEW] Multi-sheet consolidated Excel workbook generator
│   │   │   ├── zip-packager.ts       [NEW] In-memory ZIP packaging with manifest
│   │   │   └── index.ts              [NEW] Export facade
│   │   └── client-complete-export.ts [NEW] Client-side download trigger helper
│   └── audit/
│       └── logger.ts                 [MODIFY] Support 'EXPORT' entityType and complete export actions
├── app/
│   ├── api/
│   │   └── export/
│   │       └── complete/
│   │           └── route.ts          [NEW] POST /api/export/complete endpoint
│   └── (dashboard)/
│       └── reports/
│           └── complete-export/
│               └── page.tsx          [NEW] Dedicated Complete Export UI
├── components/
│   └── layout/
│       ├── Navigation.tsx            [MODIFY] Add 'Complete Export' under Reports for Admin/Engineer
│       └── Header.tsx                [MODIFY] Add 'Complete Export' to mobile drawer for Admin/Engineer
└── tests/
    └── complete-export.test.ts       [NEW] Master test suite for Complete Export
```

---

## 3. Detailed Component Design

### 3.1 Date Period Calculation (`lib/export/complete/periods.ts`)
Supports the 9 required presets:
- `ALL_DATA`: Unbounded historical reporting without arbitrary dates. Dynamically calculates the earliest and latest recorded dates (`MIN(date)` and `MAX(date)` across `attendance_records` and `financial_transactions` for the scope). If no data exists, gracefully marks period as "All Recorded Data (No Records)".
- `TODAY`: Today's date (`YYYY-MM-DD` for both `from` and `to`).
- `LAST_7_DAYS`: Past 7 calendar days ending today.
- `LAST_30_DAYS`: Past 30 calendar days ending today.
- `THIS_MONTH`: First day to last day of current calendar month.
- `PREVIOUS_MONTH`: First day to last day of previous calendar month.
- `THIS_YEAR`: `YYYY-01-01` to `YYYY-12-31` of current year.
- `PREVIOUS_YEAR`: `YYYY-01-01` to `YYYY-12-31` of previous year.
- `CUSTOM`: Validated user-specified `from` and `to` dates (`YYYY-MM-DD`, with `from <= to`).

### 3.2 Unified Data Collector (`lib/export/complete/data-collector.ts`)
- Gathers data cleanly without redundant queries:
  - For `SITE`: Validates site assignment, fetches site metadata, categories, roles, attendance records in range, financial transactions in range, opening balance before `startDate`.
  - Computes domain rollups using `calculateDailySummary`, `calculateRoleAttendance`, and `calculateFinancialSummary`.
  - For `SYSTEM`: Iterates through all active sites (or all sites accessible to the caller), builds site-level packages, and computes system-level aggregated metrics.

### 3.3 Structured JSON Generator (`lib/export/complete/json-generator.ts`)
- Returns a stable, typed JSON contract:
  ```json
  {
    "application": "SITE WORK",
    "exportVersion": 1,
    "exportType": "COMPLETE_SITE" | "COMPLETE_SYSTEM",
    "generatedAt": "ISO timestamp",
    "scope": { ... },
    "period": { "preset": "...", "from": "...", "to": "...", "label": "..." },
    "summary": { "workerDays": 0, "totalLabourCostPaise": 0, "creditsPaise": 0, "debitsPaise": 0, "closingBalancePaise": 0 },
    "sites": [ ... ],
    "categories": [ ... ],
    "roles": [ ... ],
    "attendance": [ ... ],
    "financialTransactions": [ ... ],
    "recordCounts": { ... }
  }
  ```
- Strictly sanitizes output: no user passwords, password hashes, session tokens, or internal secrets.

### 3.4 Consolidated PDF Engine (`lib/export/complete/pdf-consolidator.ts`)
- Built on `jspdf` and `jspdf-autotable`.
- Reuses `PDF_THEME`, corporate header, running headers/footers, and table styling to produce a comprehensive multi-section report:
  - **Cover / Title Banner**: Application name, scope, site details, reporting period, export timestamp, generator info.
  - **Executive Summary & KPI Strip**: Operational metrics (Worker-Days, Labour Cost, Average Daily Headcount) and Financial KPIs (Inflows, Outlays, Net Position).
  - **Site Overview / Information Section**: Location, code, operating status, active dates.
  - **Attendance Information & Daily Rollup**: Daily attendance history with category sub-headers, worker-days, rates, and labor cost.
  - **Weekly Attendance Matrix**: Day-by-day weekly matrix rollup.
  - **Monthly Attendance Summary**: Monthly aggregated headcount and labor costs.
  - **Role Breakdown**: All roles and worker deployments with shift counts and costs.
  - **Category Summary**: Category rollups with worker days and financial weight.
  - **Financial Summary & Cash Flow**: Opening balance, credits, debits by category, closing balance.
  - **Financial Transactions Ledger**: Detailed ledger table (Date, Type, Category, Description, Reference, Inflow, Outflow, Running Balance).
  - **Monthly Financial Statement**: Monthly income vs expense breakdown.
  - **Metadata Block**: Export timestamp, record counts, system checksum.
- Multi-site system exports format an Executive Overview across all sites followed by complete applicable site sections for each authorized site.

### 3.5 Consolidated Excel Engine (`lib/export/complete/excel-consolidator.ts`)
- Built on `exceljs`, reusing `createExcelJsWorkbook`, `applyExcelJsTitleBanner`, `applyExcelJsKpiStrip`, `applyExcelJsTableHeader`, and accounting currency formatting (`₹#,##0.00`).
- **Sheets for Site Export**:
  1. `Executive Overview`: Corporate banner, KPI cards, high-level workforce & financial reconciliation.
  2. `Attendance Log`: Date, Role, Category, Full Days, Half Days, Worker-Days, Rate, Total Cost.
  3. `Role Breakdown`: Role Name, Category, Shifts, Worker-Days, Cost.
  4. `Category Summary`: Category Name, Shifts, Worker-Days, Cost.
  5. `Financial Ledger`: Date, Type, Category, Description, Inflow, Outflow, Running Balance.
  6. `Monthly Financials`: Monthly grouped totals and debit categories.
  7. `Report Metadata`: System version, export timestamp, period, record counts.
- **Sheets for System Export**:
  1. `System Overview`: Cross-site aggregate KPIs and site comparisons.
  2. `Sites Summary`: All sites, code, location, worker-days, labour cost, financial balance.
  3. `Consolidated Attendance`: Master workforce ledger.
  4. `Consolidated Finance`: Master transaction ledger.
  5. `Report Metadata`: Export details.

### 3.6 ZIP Packager (`lib/export/complete/zip-packager.ts`)
- Uses `JSZip` to generate a valid ZIP buffer:
  - `manifest.json`: Metadata, scope, period, generated timestamp, contained files, record counts.
  - `data/<name>.json`: Formatted JSON payload.
  - `pdf/<name>.pdf`: Binary PDF buffer.
  - `excel/<name>.xlsx`: Binary Excel workbook buffer.
  - `README.txt`: Plain-text descriptor and verification instructions.

### 3.7 Secure API Endpoint (`app/api/export/complete/route.ts`)
- Method: `POST`
- **Validation**:
  - Auth check: `401 Unauthorized` if not logged in.
  - Role check: `403 Forbidden` if `VIEWER`.
  - System scope check: `403 Forbidden` if non-admin requests `SYSTEM` scope.
  - Site scope check: `validateSiteAccess(session, siteId, 'READ')` -> `403 Forbidden` if site is unauthorized.
  - Input validation: validates `scope`, `period`, `from`, `to`, `formats`.
- **Audit Logging**: Logs `COMPLETE_EXPORT_GENERATED` with user, role, scope, and period.
- **Response**:
  - `Content-Type: application/zip` (or PDF/Excel/JSON if direct format requested).
  - Secure `Content-Disposition` header with `sanitizeReportFilename`.

### 3.8 Dedicated UI Page (`app/(dashboard)/reports/complete-export/page.tsx`)
- Placed under `/reports/complete-export`.
- Clean, responsive filter card matching SITE WORK UI design:
  - Scope: "Entire System" (Admin only) or Site Selector.
  - Period selector: 9 presets with custom date pickers.
  - Output formats: Checkboxes for PDF, Excel, JSON.
  - Primary button: `[ Download Complete Export (ZIP) ]` (min 44px height, loading spinner, duplicate-click disabled state).
  - Quick format download buttons: `[ Download PDF ]` and `[ Download Excel ]`.
  - Light & Dark theme compatibility (navy KPI accents in Light, Spotify green accents in Dark).
  - Mobile responsive (tested from 360px up to 1280px).

---

## 4. Verification Plan

### Automated Tests (`tests/complete-export.test.ts`)
1. **Authentication & Authorization**:
   - `401` on unauthenticated requests.
   - `403` on Viewer requests.
   - `403` on Engineer requesting unauthorized site or entire system.
   - `200` on Admin requesting system or any site.
   - `200` on Engineer requesting authorized site.
2. **Date Period Coverage**:
   - Tests `ALL_DATA`, `TODAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `THIS_MONTH`, `PREVIOUS_MONTH`, `THIS_YEAR`, `PREVIOUS_YEAR`, and `CUSTOM`.
3. **Empty State Behavior**:
   - Date ranges with 0 records return valid, uncorrupted ZIP, PDF, XLSX, and JSON files with empty-state indicators.
4. **Data Parity Verification**:
   - Cross-checks totals inside Complete Export against individual report calculation results.
5. **ZIP & File Integrity**:
   - Inspects generated ZIP: verifies `manifest.json`, valid PDF header (`%PDF`), valid Excel PK header, and valid JSON parsing.
6. **Regression Protection**:
   - Existing 162 tests run and must pass with 0 failures.

### Local Browser QA
- Test with Chrome CDP across required viewports: `360×800`, `375×812`, `390×844`, `412×811`, `430×932`, `800×360`, `812×375`, `844×390`, `932×430`, `1280×800`.
- Verify download trigger, ZIP reception, and contents unzipping.
- Test Light and Dark themes.
- Confirm local database records remain completely untouched.
- Confirm exactly ONE development server is left running on port 3000.
