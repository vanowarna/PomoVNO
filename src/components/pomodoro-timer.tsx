"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Expand,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Shrink,
  SkipForward,
  Keyboard,
  Wifi,
  WifiOff,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsModal } from '@/components/settings-modal';
import { useToast } from '@/hooks/use-toast';
import {
  addWorkSessionToHistory,
  clampRemainingMs,
  DEFAULT_SETTINGS,
  formatTimerMs,
  getModeDurationMs,
  getNextMode,
  getTodayKey,
  PRESETS,
  safeParseJSON,
  shouldAutoStart,
  STORAGE_KEYS,
  type DailyHistory,
  type Mode,
  type PomodoroSettings,
  type TimerSnapshot,
  validateSettings,
} from '@/lib/pomodoro';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INITIAL_STATE: TimerSnapshot = {
  mode: 'work',
  isRunning: false,
  remainingMs: getModeDurationMs('work', DEFAULT_SETTINGS),
  endTimestamp: null,
  completedWorkSessionsInCycle: 0,
};

export function PomodoroTimer() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState<TimerSnapshot>(INITIAL_STATE);
  const [dailyHistory, setDailyHistory] = useState<DailyHistory>({});
  const [focusLabel, setFocusLabel] = useState('');
  const [isHydrated, setIsHydrated] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const timerRef = useRef(timer);
  const settingsRef = useRef(settings);
  const intervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  }, []);

  const todaySummary = dailyHistory[getTodayKey()] ?? { sessions: 0, focusMinutes: 0 };

  const weeklySummary = useMemo(() => {
    const keys = Object.keys(dailyHistory).sort().slice(-7);
    return keys.reduce(
      (acc, key) => {
        acc.sessions += dailyHistory[key].sessions;
        acc.focusMinutes += dailyHistory[key].focusMinutes;
        return acc;
      },
      { sessions: 0, focusMinutes: 0 }
    );
  }, [dailyHistory]);

  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const persistTimer = useCallback((nextTimer: TimerSnapshot) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.timer, JSON.stringify(nextTimer));
  }, []);

  const updateTimer = useCallback(
    (updater: (prev: TimerSnapshot) => TimerSnapshot) => {
      setTimer((prev) => {
        const next = updater(prev);
        persistTimer(next);
        return next;
      });
    },
    [persistTimer]
  );

  const playSound = useCallback(() => {
    if (!settingsRef.current.soundEnabled || typeof window === 'undefined') {
      return;
    }

    const context = audioContextRef.current;
    if (!context || context.state !== 'running') {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.001;
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
  }, []);

  const ensureAudioReady = useCallback(async () => {
    if (typeof window === 'undefined' || !settingsRef.current.soundEnabled) {
      return;
    }

    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) {
        return;
      }
      audioContextRef.current = new Ctx();
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'denied') {
      toast({
        title: 'Notifications blocked',
        description: 'Enable notifications in browser settings if you want alerts.',
      });
    }
  }, [toast]);

  const showCompletionNotification = useCallback((title: string, body: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (!settingsRef.current.notificationsEnabled || notificationPermission !== 'granted') return;

    try {
      new window.Notification(title, { body });
    } catch {
      // ignore browser-specific failures
    }
  }, [notificationPermission]);

  const completeInterval = useCallback((manualSkip = false, completionTimestamp = Date.now()) => {
    const current = timerRef.current;
    const currentSettings = settingsRef.current;
    const modeLabel = current.mode === 'work' ? 'Work' : current.mode === 'shortBreak' ? 'Short break' : 'Long break';

    if (!manualSkip && current.mode === 'work') {
      setDailyHistory((prev) => {
        const next = addWorkSessionToHistory(prev, currentSettings.work);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(next));
        }
        return next;
      });
    }

    const { nextMode, nextCompletedInCycle } = getNextMode(
      current.mode,
      current.completedWorkSessionsInCycle,
      currentSettings
    );
    const nextDuration = getModeDurationMs(nextMode, currentSettings);
    const autoStart = shouldAutoStart(nextMode, currentSettings);

    if (currentSettings.visualAlerts && !manualSkip) {
      setIsFlashing(true);
      window.setTimeout(() => setIsFlashing(false), 900);
    }

    if (!manualSkip) {
      playSound();
      showCompletionNotification(
        nextMode === 'work' ? 'Back to focus' : 'Time for a break',
        `${modeLabel} ended. ${nextMode === 'work' ? 'Start focusing again.' : 'Take a mindful break.'}`
      );
    }

    setLiveAnnouncement(
      manualSkip
        ? `Skipped ${modeLabel}. ${nextMode === 'work' ? 'Work session ready.' : 'Break ready.'}`
        : `${modeLabel} finished. ${nextMode === 'work' ? 'Work session ready.' : 'Break ready.'}`
    );

    updateTimer(() => ({
      mode: nextMode,
      completedWorkSessionsInCycle: nextCompletedInCycle,
      isRunning: autoStart && !manualSkip,
      remainingMs: nextDuration,
      endTimestamp: autoStart && !manualSkip ? completionTimestamp + nextDuration : null,
    }));
  }, [playSound, showCompletionNotification, updateTimer]);

  const syncFromClock = useCallback(() => {
    const current = timerRef.current;
    if (!current.isRunning || !current.endTimestamp) return;

    const now = Date.now();
    const remaining = current.endTimestamp - now;
    if (remaining <= 0) {
      completeInterval(false, current.endTimestamp);
      return;
    }

    updateTimer((prev) => ({
      ...prev,
      remainingMs: clampRemainingMs(remaining),
    }));
  }, [completeInterval, updateTimer]);

  const startTimer = useCallback(async () => {
    await ensureAudioReady();
    updateTimer((prev) => {
      if (prev.isRunning) return prev;
      const duration = clampRemainingMs(prev.remainingMs);
      return {
        ...prev,
        isRunning: true,
        remainingMs: duration,
        endTimestamp: Date.now() + duration,
      };
    });
  }, [ensureAudioReady, updateTimer]);

  const pauseTimer = useCallback(() => {
    updateTimer((prev) => {
      if (!prev.isRunning || !prev.endTimestamp) {
        return { ...prev, isRunning: false, endTimestamp: null };
      }
      return {
        ...prev,
        isRunning: false,
        remainingMs: clampRemainingMs(prev.endTimestamp - Date.now()),
        endTimestamp: null,
      };
    });
  }, [updateTimer]);

  const resetTimer = useCallback(() => {
    updateTimer((prev) => ({
      ...prev,
      isRunning: false,
      endTimestamp: null,
      remainingMs: getModeDurationMs(prev.mode, settingsRef.current),
      completedWorkSessionsInCycle: prev.mode === 'work' ? 0 : prev.completedWorkSessionsInCycle,
    }));
    setLiveAnnouncement('Timer reset.');
  }, [updateTimer]);

  const skipInterval = useCallback(() => {
    completeInterval(true, Date.now());
  }, [completeInterval]);

  const addOneMinute = useCallback(() => {
    updateTimer((prev) => {
      const nextRemaining = clampRemainingMs(prev.remainingMs + 60_000);
      return {
        ...prev,
        remainingMs: nextRemaining,
        endTimestamp: prev.isRunning ? Date.now() + nextRemaining : null,
      };
    });
    setLiveAnnouncement('Added one minute.');
  }, [updateTimer]);

  const switchMode = useCallback((nextMode: Mode) => {
    updateTimer((prev) => ({
      ...prev,
      mode: nextMode,
      isRunning: false,
      endTimestamp: null,
      remainingMs: getModeDurationMs(nextMode, settingsRef.current),
      completedWorkSessionsInCycle: nextMode === 'work' ? 0 : prev.completedWorkSessionsInCycle,
    }));
    setLiveAnnouncement(`${nextMode === 'work' ? 'Work' : nextMode === 'shortBreak' ? 'Short break' : 'Long break'} selected.`);
  }, [updateTimer]);

  const saveSettings = useCallback(async (nextSettings: PomodoroSettings) => {
    setSettings(nextSettings);

    if (nextSettings.notificationsEnabled && notificationPermission === 'default') {
      await requestNotificationPermission();
    }

    updateTimer((prev) => {
      const nextRemaining = getModeDurationMs(prev.mode, nextSettings);
      return {
        ...prev,
        isRunning: false,
        endTimestamp: null,
        remainingMs: nextRemaining,
      };
    });
    setLiveAnnouncement('Settings saved.');
  }, [notificationPermission, requestNotificationPermission, updateTimer]);

  const applyPreset = useCallback((presetKey: string) => {
    const preset = PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;

    const merged = validateSettings({ ...settingsRef.current, ...preset.values }).settings;
    setSettings(merged);
    updateTimer((prev) => ({
      ...prev,
      isRunning: false,
      endTimestamp: null,
      remainingMs: getModeDurationMs(prev.mode, merged),
    }));
    setLiveAnnouncement(`${preset.label} preset applied.`);
  }, [updateTimer]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;

    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      toast({ title: 'Fullscreen unavailable', description: 'Your browser does not allow fullscreen mode here.' });
    }
  }, [toast]);

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismissInstallPrompt = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.installPromptDismissed, '1');
    }
    setInstallDismissed(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(window.navigator.onLine);
    const savedDismissal = window.localStorage.getItem(STORAGE_KEYS.installPromptDismissed);
    setInstallDismissed(savedDismissal === '1');

    const savedSettings = safeParseJSON<Partial<PomodoroSettings>>(window.localStorage.getItem(STORAGE_KEYS.settings));
    const validatedSettings = validateSettings(savedSettings ?? {}).settings;
    setSettings(validatedSettings);

    const savedTimer = safeParseJSON<TimerSnapshot>(window.localStorage.getItem(STORAGE_KEYS.timer));
    if (savedTimer) {
      const sanitizedTimer: TimerSnapshot = {
        mode: savedTimer.mode,
        isRunning: Boolean(savedTimer.isRunning),
        remainingMs: clampRemainingMs(savedTimer.remainingMs),
        endTimestamp: savedTimer.endTimestamp,
        completedWorkSessionsInCycle: Math.max(0, Math.round(savedTimer.completedWorkSessionsInCycle || 0)),
      };

      if (sanitizedTimer.isRunning && sanitizedTimer.endTimestamp) {
        const remaining = sanitizedTimer.endTimestamp - Date.now();
        if (remaining > 0) {
          sanitizedTimer.remainingMs = remaining;
        } else {
          sanitizedTimer.isRunning = false;
          sanitizedTimer.endTimestamp = null;
          sanitizedTimer.remainingMs = getModeDurationMs(sanitizedTimer.mode, validatedSettings);
        }
      }

      setTimer(sanitizedTimer);
      persistTimer(sanitizedTimer);
    } else {
      const first = {
        ...INITIAL_STATE,
        remainingMs: getModeDurationMs('work', validatedSettings),
      };
      setTimer(first);
      persistTimer(first);
    }

    const savedHistory = safeParseJSON<DailyHistory>(window.localStorage.getItem(STORAGE_KEYS.history));
    if (savedHistory) {
      setDailyHistory(savedHistory);
    }

    const savedFocus = window.localStorage.getItem(STORAGE_KEYS.focus);
    if (savedFocus) {
      setFocusLabel(savedFocus);
    }

    if ('Notification' in window) {
      setNotificationPermission(window.Notification.permission);
    } else {
      setNotificationPermission('unsupported');
    }

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setDeferredPrompt(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    setIsHydrated(true);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [persistTimer]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [isHydrated, settings]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.focus, focusLabel);
  }, [focusLabel, isHydrated]);

  useEffect(() => {
    if (!timer.isRunning) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    syncFromClock();
    intervalRef.current = window.setInterval(syncFromClock, 1000);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [syncFromClock, timer.isRunning]);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;

    const reSync = () => syncFromClock();
    const onPageShow = () => syncFromClock();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncFromClock();
      }
    };

    window.addEventListener('focus', reSync);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', reSync);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', reSync);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', reSync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isHydrated, syncFromClock]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const modeLabel = timer.mode === 'work' ? 'WORK' : 'BREAK';
    document.title = timer.isRunning ? `(${formatTimerMs(timer.remainingMs)}) ${modeLabel} | PomoVNO` : 'Pomodoro Timer | Vano';
  }, [timer.isRunning, timer.mode, timer.remainingMs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || isSettingsOpen) return;

      const key = event.key.toLowerCase();
      if (key === ' ' || event.code === 'Space') {
        event.preventDefault();
        if (timerRef.current.isRunning) {
          pauseTimer();
        } else {
          void startTimer();
        }
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        resetTimer();
      } else if (key === 's') {
        event.preventDefault();
        skipInterval();
      } else if (key === 'f') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (key === '1') {
        event.preventDefault();
        switchMode('work');
      } else if (key === '2') {
        event.preventDefault();
        switchMode('shortBreak');
      } else if (key === '3') {
        event.preventDefault();
        switchMode('longBreak');
      } else if (key === '?') {
        event.preventDefault();
        setIsHelpOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSettingsOpen, pauseTimer, resetTimer, skipInterval, startTimer, switchMode, toggleFullscreen]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const cycleProgress = Math.min(timer.completedWorkSessionsInCycle, settings.longBreakInterval);
  const modeText = timer.mode === 'work' ? 'Focus' : timer.mode === 'shortBreak' ? 'Short Break' : 'Long Break';

  const showInstallCard = !isStandalone && !installDismissed;
  const showIosHint = typeof window !== 'undefined' && /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !('standalone' in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone);

  return (
    <>
      {isFlashing ? <div className="pointer-events-none fixed inset-0 z-[100] bg-white/40 flash-overlay-animation" /> : null}

      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      <div className="w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            {isOnline ? <Wifi className="h-3.5 w-3.5" aria-hidden="true" /> : <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />}
            {isOnline ? 'Online' : 'Offline'}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => setIsHelpOpen((prev) => !prev)} variant="ghost" size="icon" aria-label="Keyboard shortcuts">
              <Keyboard className="h-5 w-5" />
            </Button>
            <Button onClick={() => setIsSettingsOpen(true)} variant="ghost" size="icon" aria-label="Settings">
              <SettingsIcon className="h-5 w-5" />
            </Button>
            <Button onClick={toggleFullscreen} variant="ghost" size="icon" aria-label="Toggle fullscreen">
              {isFullscreen ? <Shrink className="h-5 w-5" /> : <Expand className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {showInstallCard && (deferredPrompt || showIosHint) ? (
          <div className="rounded-xl border border-white/20 bg-card/60 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">Install PomoVNO</p>
                <p className="text-muted-foreground">
                  {deferredPrompt
                    ? 'Install for quick access and offline timer usage after first load.'
                    : 'On iOS Safari: tap Share, then “Add to Home Screen”.'}
                </p>
              </div>
              <div className="flex gap-2">
                {deferredPrompt ? (
                  <Button size="sm" onClick={triggerInstall}>
                    <Download className="mr-1 h-4 w-4" /> Install
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={dismissInstallPrompt}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-card/30 p-4 sm:p-6">
          <Tabs value={timer.mode} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="work" onClick={() => switchMode('work')}>Work</TabsTrigger>
              <TabsTrigger value="shortBreak" onClick={() => switchMode('shortBreak')}>Short Break</TabsTrigger>
              <TabsTrigger value="longBreak" onClick={() => switchMode('longBreak')}>Long Break</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="mt-4 space-y-2 text-center">
            <p className="text-sm text-muted-foreground">{modeText}</p>
            <h1 className={cn('font-black tabular-nums text-6xl sm:text-8xl')} aria-label={`Remaining time ${formatTimerMs(timer.remainingMs)}`}>
              {formatTimerMs(timer.remainingMs)}
            </h1>
            <p className="text-xs text-muted-foreground">
              Session {Math.min(cycleProgress + 1, settings.longBreakInterval)} of {settings.longBreakInterval} • Completed in cycle: {cycleProgress}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => (timer.isRunning ? pauseTimer() : void startTimer())}
              size="lg"
              className="h-14 min-w-32 rounded-2xl text-lg"
            >
              {timer.isRunning ? <Pause size={22} /> : <Play size={22} />}
              <span className="ml-2">{timer.isRunning ? 'Pause' : 'Start'}</span>
            </Button>
            <Button onClick={resetTimer} variant="secondary" size="lg" className="h-14 min-w-14 rounded-2xl" aria-label="Reset timer">
              <RotateCcw size={20} />
            </Button>
            <Button onClick={skipInterval} variant="secondary" size="lg" className="h-14 min-w-14 rounded-2xl" aria-label="Skip interval">
              <SkipForward size={20} />
            </Button>
            <Button onClick={addOneMinute} variant="secondary" size="lg" className="h-14 min-w-14 rounded-2xl" aria-label="Add one minute">
              <Plus size={20} />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-white/10 bg-card/20 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="focus-label">Current focus</Label>
            <Input
              id="focus-label"
              value={focusLabel}
              maxLength={80}
              onChange={(event) => setFocusLabel(event.target.value)}
              placeholder="What are you focusing on?"
            />
            <p className="text-xs text-muted-foreground">Stored locally on this device.</p>
          </div>
          <div className="rounded-lg border border-white/10 p-3 text-sm">
            <p className="font-medium">Daily focus summary</p>
            <p className="mt-1 text-muted-foreground">Today: {todaySummary.sessions} sessions • {todaySummary.focusMinutes} minutes</p>
            <p className="text-muted-foreground">Last 7 days: {weeklySummary.sessions} sessions • {weeklySummary.focusMinutes} minutes</p>
          </div>
        </div>

        {isHelpOpen ? (
          <div className="rounded-xl border border-white/20 bg-card/60 p-3 text-sm">
            <p className="font-medium">Keyboard shortcuts</p>
            <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
              <li>Space — Start/Pause</li>
              <li>R — Reset</li>
              <li>S — Skip interval</li>
              <li>F — Fullscreen</li>
              <li>1/2/3 — Work/Short/Long</li>
            </ul>
          </div>
        ) : null}
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={(nextSettings) => {
          void saveSettings(nextSettings);
          setIsSettingsOpen(false);
        }}
        onApplyPreset={applyPreset}
        notificationPermission={notificationPermission}
        onRequestNotificationPermission={requestNotificationPermission}
      />
    </>
  );
}
