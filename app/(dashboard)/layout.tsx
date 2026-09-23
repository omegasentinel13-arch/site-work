import React from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/auth/session';
import { SiteProvider } from '@/context/site-context';
import { Header } from '@/components/layout/Header';
import { Navigation } from '@/components/layout/Navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    const headersList = headers();
    const currentPath = headersList.get('x-current-path');

    if (currentPath && currentPath !== '/') {
      redirect(`/login?next=${encodeURIComponent(currentPath)}`);
    } else {
      redirect('/login');
    }
  }

  return (
    <SiteProvider>
      <div className="min-h-screen flex flex-col bg-[#F1F5F9] dark:bg-[#111214] text-[#0F172A] dark:text-[#F2F3F5] w-full transition-colors duration-150">
        <Header />
        <Navigation />
        <main className="flex-1 w-full max-w-7xl mx-auto px-2.5 xs:px-4 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-16 pb-safe">
          {children}
        </main>
      </div>
    </SiteProvider>
  );
}