import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/context/theme-context';

export const metadata: Metadata = {
  title: 'AB CONSTRUCTIONS & INTERIORS — Workforce & Financial Tracking',
  description: 'Clean engineering site management utility for workforce attendance and financial tracking.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#111214',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var m = document.cookie.match(/(?:^|;\\s*)site_work_active_theme=([^;]+)/);
                var t = m ? decodeURIComponent(m[1]) : null;
                if (t === 'dark') {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[#F1F5F9] text-[#0F172A] dark:bg-[#111214] dark:text-[#F2F3F5] selection:bg-amber-100 selection:text-slate-900 dark:selection:bg-[#1ED760] dark:selection:text-[#07130B] overflow-x-hidden">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}