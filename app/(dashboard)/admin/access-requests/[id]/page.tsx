'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function AdminAccessRequestDetailRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const requestId = params.id;

  useEffect(() => {
    if (requestId) {
      router.replace(`/setup/users?requestId=${encodeURIComponent(requestId)}`);
    } else {
      router.replace('/setup/users?accessRequests=true');
    }
  }, [router, requestId]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
      <h2 className="text-base font-bold text-slate-800 dark:text-zinc-200">
        Opening Access Request in Users &amp; Access...
      </h2>
      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-sm">
        Review claim #{requestId} is now managed directly inside the unified Users &amp; Access console.
      </p>
      <Link
        href={`/setup/users?requestId=${encodeURIComponent(requestId)}`}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
      >
        Go to Users &amp; Access <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
