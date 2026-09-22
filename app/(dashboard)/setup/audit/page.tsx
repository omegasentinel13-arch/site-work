'use client';

// Route normalization / backward compatibility for legacy /setup/audit route
// Re-exports canonical AuditTrailPage to ensure single source of truth without duplication.
import AuditTrailPage from '../audit-trail/page';

export default AuditTrailPage;
