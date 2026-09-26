'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function AdminAccessRequestsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/setup/users?accessRequests=true');
  }, [router]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
      <h2 className="text-base font-bold text-slate-800 dark:text-zinc-200">
        Redirecting to Users &amp; Access...
      </h2>
      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-sm">
        Access Request governance is now centrally managed within the Users &amp; Access console.
      </p>
      <Link
        href="/setup/users?accessRequests=true"
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
      >
        Go to Users &amp; Access <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
