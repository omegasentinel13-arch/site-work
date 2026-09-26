import React from 'react';
import Link from 'next/link';
import { FileText, ArrowLeft, Shield, Mail, CheckCircle2, AlertTriangle } from 'lucide-react';

export const metadata = {
  title: 'Terms of Service | SITE WORK — AB Constructions & Interiors',
  description: 'Terms of Service and Acceptable Use Policy governing access to the SITE WORK management platform.',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] text-slate-800 dark:text-[#DBDEE1] py-8 sm:py-14 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation / Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#2B2D31]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#18191C] p-1 border border-slate-900 dark:border-[#4A4D52] shadow-sm flex items-center justify-center shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="AB Constructions Logo" className="w-full h-full object-contain rounded-lg" />
            </div>
            <div>
              <span className="text-xs font-black tracking-widest text-slate-900 dark:text-[#F2F3F5] uppercase block">
                AB CONSTRUCTIONS &amp; INTERIORS
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                SITE WORK Management System
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/privacy"
              className="text-xs font-semibold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Privacy Policy
            </Link>
            <span className="text-slate-300 dark:text-zinc-700">|</span>
            <Link
              href="/login"
              className="inline-flex items-center text-xs font-bold text-slate-900 dark:text-[#1ED760] hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Back to Sign In
            </Link>
          </div>
        </div>

        {/* Main Document Card */}
        <main className="bg-white dark:bg-[#1E1F22] rounded-xl border border-slate-200 dark:border-[#3A3D42] shadow-sm p-6 sm:p-10 space-y-8">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60 mb-3">
              <FileText className="w-3.5 h-3.5" />
              Operational Use Agreement
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-[#F2F3F5] tracking-tight">
              Terms of Service
            </h1>
            <p className="mt-2 text-xs sm:text-sm text-slate-500 dark:text-[#949BA4]">
              Last Updated: <time dateTime="2026-09-26">September 26, 2026</time> &bull; Effective Immediately
            </p>
          </div>

          {/* Legal Notice */}
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-lg text-xs leading-relaxed text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong>Administrative Operational Notice:</strong> These Terms of Service define the terms and acceptable use conditions for authorized access to the SITE WORK proprietary system. This document outlines operational rules and enterprise responsibilities and does not constitute formal legal advice.
            </div>
          </div>

          {/* Section 1: Acceptance */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              1. Acceptance of Terms
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              By accessing, browsing, submitting an access request to, or logging into the <strong>SITE WORK</strong> platform, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our associated{' '}
              <Link href="/privacy" className="text-slate-900 dark:text-[#1ED760] font-semibold underline">
                Privacy Policy
              </Link>
              . If you do not agree to these terms, you must not access or use the application.
            </p>
          </section>

          {/* Section 2: Authorized Use */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              2. Authorized Users &amp; Scope of Access
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              SITE WORK is a restricted enterprise application operated exclusively for the business operations of <strong>AB CONSTRUCTIONS &amp; INTERIORS</strong>. Access is strictly limited to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>Authorized employees, site engineers, supervisors, and project auditors.</li>
              <li>Vetted subcontractors and construction personnel holding verified project credentials.</li>
              <li>Prospective users submitting legitimate account access requests via the public request portal.</li>
            </ul>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Public registration does not confer automatic access. All requested accounts remain in a pending, unauthenticated status until formally vetted and approved by an authorized system administrator.
            </p>
          </section>

          {/* Section 3: Credential Security */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              3. User Accounts &amp; Credential Responsibility
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Users assigned an account within SITE WORK are solely responsible for maintaining the confidentiality of their authentication credentials:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>You must select a strong, unique password meeting platform complexity rules (minimum 8 characters).</li>
              <li>You must not share, transfer, or disclose your login credentials to any third party.</li>
              <li>You must promptly notify the system administrator at <a href="mailto:omegasentinel13@gmail.com" className="underline font-semibold">omegasentinel13@gmail.com</a> if you suspect unauthorized use or credential compromise.</li>
              <li>All activities executed under your authenticated session are deemed your authorized acts.</li>
            </ul>
          </section>

          {/* Section 4: Acceptable Use */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              4. Acceptable Use Policy
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Users agree to access SITE WORK solely for lawful, authorized construction management tasks. You agree NOT to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>Attempt to bypass, defeat, or manipulate role-based access control (RBAC) checks or site permission boundaries.</li>
              <li>Perform unauthorized vulnerability scanning, penetration testing, SQL injection, or stress testing against the platform.</li>
              <li>Use automated tools, crawlers, or scrapers to extract application source code, financial ledger entries, or attendance data.</li>
              <li>Submit false, fraudulent, or intentionally fabricated attendance records, expense vouchers, or materials receipts.</li>
              <li>Impersonate any other individual, employee, or administrator within the organization.</li>
              <li>Introduce malicious scripts, viruses, or disruptive code into the application infrastructure.</li>
            </ul>
          </section>

          {/* Section 5: Role & Site Permissions */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              5. Site-Specific Permissions &amp; Data Accuracy
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Users are granted access strictly to specific construction site workspaces and functional modules corresponding to their operational duties. Users recording workforce attendance, materials deliveries, or financial transactions are responsible for ensuring all logged figures accurately reflect genuine site activities.
            </p>
          </section>

          {/* Section 6: Administrative Controls */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              6. Administrative Controls &amp; Account Termination
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              AB CONSTRUCTIONS &amp; INTERIORS reserves the right, at its sole discretion and without prior notice, to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>Approve, deny, or place access requests on administrative hold.</li>
              <li>Modify, elevate, or restrict role permissions and site assignments.</li>
              <li>Suspend, deactivate, or permanently terminate accounts due to policy violations, employment cessation, or security threats.</li>
              <li>Revert, modify, or archive inaccurate or unauthorized operational records in the audit trail.</li>
            </ul>
          </section>

          {/* Section 7: Intellectual Property */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              7. Intellectual Property Rights
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              All content, software code, user interface designs, database schemas, trademarks, logos, and system architecture comprising the SITE WORK platform are the exclusive intellectual property of AB CONSTRUCTIONS &amp; INTERIORS. Unauthorized copying, decompilation, redistribution, or commercial exploitation is strictly prohibited.
            </p>
          </section>

          {/* Section 8: Availability & Limitation of Liability */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              8. Service Availability &amp; Limitation of Liability
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              SITE WORK is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis for internal business management. While we endeavor to maintain high platform availability, AB CONSTRUCTIONS &amp; INTERIORS does not guarantee uninterrupted, error-free operation or immunity from scheduled maintenance downtime.
            </p>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              To the fullest extent permitted by applicable law, AB CONSTRUCTIONS &amp; INTERIORS and its management shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of your access to or inability to use the platform.
            </p>
          </section>

          {/* Section 9: Modifications to Terms */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              9. Modifications to Terms
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              We reserve the right to revise or update these Terms of Service periodically to reflect evolving platform capabilities, administrative procedures, or regulatory standards. The updated date at the top of this document indicates the latest revision. Continued use of the platform constitutes acceptance of revised terms.
            </p>
          </section>

          {/* Section 10: Contact */}
          <section className="space-y-3 pt-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              10. Contact Information
            </h2>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              For operational questions, access inquiries, or notices regarding these Terms of Service, please contact:
            </p>
            <div className="p-4 bg-slate-50 dark:bg-[#18191C] rounded-lg border border-slate-200 dark:border-[#2B2D31] space-y-1 text-xs sm:text-sm">
              <p className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                AB CONSTRUCTIONS &amp; INTERIORS
              </p>
              <p className="text-slate-600 dark:text-zinc-400">
                Application: SITE WORK Project Management System
              </p>
              <p className="flex items-center gap-1.5 text-slate-700 dark:text-[#DBDEE1] pt-1">
                <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <a href="mailto:omegasentinel13@gmail.com" className="font-medium hover:underline text-slate-900 dark:text-white">
                  omegasentinel13@gmail.com
                </a>
              </p>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="pt-4 text-center text-xs text-slate-500 dark:text-zinc-500 space-y-2">
          <p>&copy; {new Date().getFullYear()} AB CONSTRUCTIONS &amp; INTERIORS. All rights reserved.</p>
          <div className="flex justify-center space-x-4 text-[11px]">
            <Link href="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
            <span>&bull;</span>
            <Link href="/terms" className="text-slate-900 dark:text-white font-semibold underline">
              Terms of Service
            </Link>
            <span>&bull;</span>
            <Link href="/login" className="hover:underline">
              Sign In
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
