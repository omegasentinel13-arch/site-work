'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MasterLedgerPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/finance');
  }, [router]);

  return (
    <div className="flex items-center justify-center p-12 text-slate-500 dark:text-[#949BA4] text-sm">
      Redirecting to Transactions...
    </div>
  );
}
