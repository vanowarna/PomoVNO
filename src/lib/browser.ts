// Small, defensive wrappers around browser APIs. Every call may be unavailable
// (SSR, private mode, older mobile browsers) so nothing here throws.

export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or storage disabled: the app keeps working in memory.
    }
  },
};

type AudioContextCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;

/** Must be called from a user gesture at least once so mobile browsers allow playback later. */
export async function unlockAudio(): Promise<void> {
  try {
    if (!audioContext) {
      const Ctor: AudioContextCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      audioContext = new Ctor();
    }
    if (audioContext.state !== 'running') await audioContext.resume();
  } catch {
    // ignore
  }
}

/** A soft chime: rising for "back to work", falling for "break". */
export function playChime(kind: 'work' | 'break'): void {
  const ctx = audioContext;
  if (!ctx || ctx.state !== 'running') return;
  const notes = kind === 'work' ? [660, 880, 1320] : [1320, 880, 660];
  const start = ctx.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const at = start + index * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

export function vibrate(pattern: number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (getNotificationPermission() === 'unsupported') return 'unsupported';
  try {
    return await window.Notification.requestPermission();
  } catch {
    return getNotificationPermission();
  }
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active ? registration : null;
  } catch {
    return null;
  }
}

/**
 * Shows a system notification. Mobile Chrome only supports notifications
 * through the service worker (`new Notification()` throws there), so that
 * path is preferred and the constructor is the desktop fallback.
 */
export async function showSystemNotification(title: string, body: string): Promise<void> {
  if (getNotificationPermission() !== 'granted') return;
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body,
    tag: 'pomovno-interval',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
  };

  const registration = await getServiceWorkerRegistration();
  if (registration) {
    try {
      await registration.showNotification(title, options);
      return;
    } catch {
      // fall through
    }
  }
  try {
    new window.Notification(title, options);
  } catch {
    // ignore
  }
}
