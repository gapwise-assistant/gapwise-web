import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/gapwise-g-v2.png',
  },
  title: 'Gapwise | Find the Question That Unlocks the Next Decision',
  description:
    'Gapwise is a persistent collaborative thinking agent that turns your messy context into a live map of knowns, decisions, assumptions, and unknowns — then finds the highest-value question you should answer next.',
  keywords: [
    'Gapwise',
    'Collaborative Partner Agent',
    'Clarity Graph',
    'Uncertainty Prioritization Engine',
    'Gemini 3.5 Flash',
    'Google ADK',
  ],
};

export const viewport = {
  themeColor: '#0891b2',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
