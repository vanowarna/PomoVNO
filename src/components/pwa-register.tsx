"use client";

import { useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/** Sends every build asset this page already loaded to the service worker so it is cached for offline use. */
function cacheLoadedAssets(worker: ServiceWorker | null | undefined) {
  if (!worker) return;
  const urls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => name.includes('/_next/static/'));
  worker.postMessage({ type: 'CACHE_URLS', urls });
}

export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // A service worker in development would cache hot-reload chunks; make sure none is left behind.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((r) => void r.unregister()));
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'SHELL_UPDATED') return;
      toast({
        title: 'Update ready',
        description: 'A new version of PomoVNO is available offline.',
        action: (
          <ToastAction altText="Reload to update" onClick={() => window.location.reload()}>
            Reload
          </ToastAction>
        ),
      });
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        cacheLoadedAssets(registration.active);
      } catch {
        // Registration can fail in private modes or unsupported contexts; the app still works online.
      }
    };

    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', () => void register(), { once: true });

    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return null;
}
