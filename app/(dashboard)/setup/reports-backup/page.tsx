'use client';

// Canonical route alias for /setup/reports-backup -> /admin/data-protection
// Re-exports canonical DataProtectionCenterPage to ensure single source of truth without duplication.
import DataProtectionCenterPage from '../../admin/data-protection/page';

export default DataProtectionCenterPage;
