import React from 'react';
import Link from 'next/link';
import { Shield, Lock, Mail, ArrowLeft, FileText, CheckCircle2, ExternalLink } from 'lucide-react';

export const metadata = {
  title: 'Privacy Policy | SITE WORK — AB Constructions & Interiors',
  description: 'Privacy Policy and Google API Services User Data Policy disclosure for SITE WORK management platform.',
};

export default function PrivacyPolicyPage() {
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
              href="/terms"
              className="text-xs font-semibold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Terms of Service
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
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 mb-3">
              <Shield className="w-3.5 h-3.5" />
              Official Legal &amp; Governance Policy
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-[#F2F3F5] tracking-tight">
              Privacy Policy
            </h1>
            <p className="mt-2 text-xs sm:text-sm text-slate-500 dark:text-[#949BA4]">
              Last Updated: <time dateTime="2026-09-26">September 26, 2026</time> &bull; Effective Immediately
            </p>
          </div>

          {/* Section 1: Overview */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              1. Organization &amp; Application Identity
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              <strong>SITE WORK</strong> is a dedicated enterprise resource and project management application operated by <strong>AB CONSTRUCTIONS &amp; INTERIORS</strong>. The platform is designed exclusively to facilitate internal project oversight, construction workforce attendance logging, site finance tracking, materials records, and role-based administrative access control for authorized personnel, contractors, and site supervisors.
            </p>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              This Privacy Policy explains how information is collected, processed, protected, and utilized within the SITE WORK application, including our integration with transactional communication APIs.
            </p>
          </section>

          {/* Section 2: Data Collected */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              2. Information We Collect
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              We collect and process only the minimal operational information necessary to deliver authenticated project management functions:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>
                <strong>User Account Details:</strong> Full name, chosen username, work or personal recovery email address, and assigned site roles (e.g., Administrator, Site Manager, Auditor/Viewer).
              </li>
              <li>
                <strong>Authentication Credentials:</strong> Passwords are cryptographically salted and hashed using standard bcrypt algorithms before database storage. Raw plaintext passwords are never recorded, logged, or retrievable.
              </li>
              <li>
                <strong>Access Request Information:</strong> For individuals requesting an account via the public request portal, we store requester full name, requested username, email address, desired role, submission timestamps, and client IP address / User-Agent strings used solely for abuse prevention, rate-limiting, and security auditing.
              </li>
              <li>
                <strong>Operational Construction Records:</strong> Site project assignments, daily workforce attendance tallies, contractor logs, materials inventory vouchers, and expense transaction ledgers created by authorized staff during business activities.
              </li>
              <li>
                <strong>Security Audit Trail:</strong> Automated system logs tracking administrative actions (such as account approvals, role updates, password changes, and access-request evaluations) for platform accountability.
              </li>
            </ul>
          </section>

          {/* Section 3: Data Usage */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              3. Purpose &amp; Use of Information
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Information processed within SITE WORK is utilized strictly for legitimate operational purposes:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>Authenticating users and verifying authorization for designated construction sites.</li>
              <li>Evaluating and processing submitted access requests by designated administrators.</li>
              <li>Transmitting transactional operational notifications (e.g., access request alerts, approval confirmations, account recovery).</li>
              <li>Maintaining an immutable internal audit trail for governance, fraud prevention, and platform integrity.</li>
              <li>Fulfilling internal business accounting and construction site attendance oversight.</li>
            </ul>
          </section>

          {/* Section 4: Google Gmail API Disclosure (CRITICAL GOOGLE REQUIREMENT) */}
          <section className="space-y-3 p-4 sm:p-6 bg-slate-50 dark:bg-[#18191C] rounded-xl border border-slate-300 dark:border-[#3A3D42]">
            <div className="flex items-center gap-2 text-slate-900 dark:text-[#F2F3F5]">
              <Lock className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
              <h2 className="text-base sm:text-lg font-bold">
                4. Google API Services &amp; Gmail Sensitive Scope Disclosure
              </h2>
            </div>
            
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              SITE WORK utilizes Google APIs solely to dispatch automated, transactional administrative emails. Specifically, our application connects to the official Google Gmail REST API requesting only the following sensitive OAuth scope:
            </p>

            <div className="p-3 bg-white dark:bg-[#111214] rounded-lg border border-slate-200 dark:border-[#2B2D31] font-mono text-xs text-slate-800 dark:text-emerald-400 break-all">
              https://www.googleapis.com/auth/gmail.send
            </div>

            <div className="space-y-2 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <p className="font-semibold text-slate-900 dark:text-[#F2F3F5]">
                Exact Scope Purpose:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Sending automated notification alerts to designated administrators when an access request is submitted.</li>
                <li>Sending automated account review outcome emails (e.g., approval with login directions or denial notifications) to requesters.</li>
              </ul>

              <p className="font-semibold text-slate-900 dark:text-[#F2F3F5] pt-2">
                What SITE WORK Does NOT Do:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-zinc-400">
                <li>We do <strong>NOT</strong> read, inspect, or scan Gmail messages or attachments.</li>
                <li>We do <strong>NOT</strong> search Gmail mailboxes or retrieve message threads.</li>
                <li>We do <strong>NOT</strong> access, store, or monitor inbox contents or contact lists.</li>
                <li>We do <strong>NOT</strong> modify, delete, label, or forward existing Gmail messages.</li>
                <li>We do <strong>NOT</strong> request any broad or restricted scopes such as <code className="font-mono text-xs">mail.google.com</code>, <code className="font-mono text-xs">gmail.readonly</code>, or <code className="font-mono text-xs">gmail.modify</code>.</li>
              </ul>

              <div className="mt-3 p-3 bg-white dark:bg-[#111214] rounded-lg border-l-4 border-emerald-500 text-xs leading-relaxed text-slate-800 dark:text-[#DBDEE1]">
                <strong>Google API Services User Data Policy Compliance:</strong><br />
                SITE WORK&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline text-emerald-700 dark:text-[#1ED760] inline-flex items-center gap-0.5"
                >
                  Google API Services User Data Policy
                  <ExternalLink className="w-3 h-3 inline" />
                </a>
                , including the Limited Use requirements.
              </div>

              <p className="text-[11px] text-slate-500 dark:text-zinc-500 pt-1 italic">
                Notice: Google has not endorsed, sponsored, or certified the SITE WORK management system. Google and Gmail are registered trademarks of Google LLC.
              </p>
            </div>
          </section>

          {/* Section 5: Third-Party Data Sharing */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              5. Data Sharing &amp; Third-Party Providers
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              AB CONSTRUCTIONS &amp; INTERIORS does <strong>never sell, lease, rent, or trade</strong> user or application data to advertisers, data brokers, or marketing platforms. Data is shared only with verified technical infrastructure providers strictly necessary to execute system functionality:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li>
                <strong>Cloud Hosting Infrastructure (Railway):</strong> The application server and encrypted database storage are deployed on Railway cloud infrastructure located in isolated data centers with strict volume access boundaries.
              </li>
              <li>
                <strong>Transactional Email Services (Google APIs):</strong> Outbound notification payloads (recipient address, subject, and message content) are transmitted over TLS port 443 via the Google Gmail REST API for message delivery.
              </li>
              <li>
                <strong>Legal Compliance:</strong> We may disclose information only if required by applicable law, court order, or governmental regulation to protect the rights, property, or safety of the enterprise.
              </li>
            </ul>
          </section>

          {/* Section 6: Security & Storage */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              6. Data Security &amp; Storage Architecture
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              SITE WORK incorporates robust technical and organizational security controls verified within our codebase:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              <li><strong>Password Protection:</strong> Passwords are secured using salted bcrypt hashing algorithms.</li>
              <li><strong>Granular Role-Based Access Control (RBAC):</strong> Strict authority tiers (King Maker, Client Prime, Standard Administrator, Site Manager, Viewer) prevent unauthorized viewing or elevation of privileges.</li>
              <li><strong>Session Security:</strong> Authenticated sessions use secure, HTTP-only cookie tokens with origin verification.</li>
              <li><strong>Server-Side Secret Management:</strong> OAuth credentials, refresh tokens, and API secrets are stored securely in server-side environment variables and are never bundled into client-side code.</li>
              <li><strong>Audit Logging:</strong> Administrative actions are logged with immutable audit records.</li>
            </ul>
            <p className="text-[11px] text-slate-500 dark:text-zinc-500 italic">
              While we enforce rigorous technical controls, no electronic transmission or database storage mechanism can guarantee absolute, 100% invulnerability. Users are responsible for safeguarding their login credentials.
            </p>
          </section>

          {/* Section 7: Retention & Rights */}
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              7. Data Retention &amp; User Rights
            </h2>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Application operational data, account profiles, attendance logs, and financial vouchers are retained as necessary to support ongoing construction projects, fulfill statutory accounting requirements, maintain audit continuity, and defend legal claims.
            </p>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-[#B5BAC1]">
              Authorized users and access requesters may inquire regarding the personal information associated with their account, request correction of inaccurate profile data, or request account deactivation by contacting the system administrator at the address below.
            </p>
          </section>

          {/* Section 8: Contact */}
          <section className="space-y-3 pt-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-[#F2F3F5] border-b border-slate-100 dark:border-[#2B2D31] pb-2">
              8. Contact Information
            </h2>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-[#B5BAC1]">
              For inquiries regarding this Privacy Policy, data handling practices, or Google OAuth integration disclosures, please contact:
            </p>
            <div className="p-4 bg-slate-50 dark:bg-[#18191C] rounded-lg border border-slate-200 dark:border-[#2B2D31] space-y-1 text-xs sm:text-sm">
              <p className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                AB CONSTRUCTIONS &amp; INTERIORS
              </p>
              <p className="text-slate-600 dark:text-zinc-400">
                Application: SITE WORK Project Management System
              </p>
              <p className="flex items-center gap-1.5 text-slate-700 dark:text-[#DBDEE1] pt-1">
                <Mail className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
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
            <Link href="/privacy" className="text-slate-900 dark:text-white font-semibold underline">
              Privacy Policy
            </Link>
            <span>&bull;</span>
            <Link href="/terms" className="hover:underline">
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
