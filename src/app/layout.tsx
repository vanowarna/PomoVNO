import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { PwaRegister } from '@/components/pwa-register';

export const metadata: Metadata = {
  title: 'PomoVNO · Pomodoro Timer',
  description: 'A minimal, free and open source Pomodoro timer that installs as an app and works fully offline.',
  applicationName: 'PomoVNO',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PomoVNO',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icons/icon-192.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={cn('font-body antialiased', 'bg-background text-foreground')} suppressHydrationWarning>
        {/* Toaster mounts first so toasts raised by the page's startup effects are not dropped. */}
        <Toaster />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
