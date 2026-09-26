"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Expand,
  Keyboard,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Shrink,
  SkipForward,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsModal } from '@/components/settings-modal';
import { toast } from '@/hooks/use-toast';
import { useWakeLock } from '@/hooks/use-wake-lock';
import {
  addTimeToSnapshot,
  advanceTimer,
  createIdleSnapshot,
  DEFAULT_SETTINGS,
  formatMinutes,
  formatTimerMs,
  getModeDurationMs,
  getRecentSummary,
  MINUTE_MS,
  MODE_LABELS,
  pauseSnapshot,
  pruneHistory,
  recordCompletedIntervals,
  safeParseJSON,
  sanitizeHistory,
  sanitizeSnapshot,
  startSnapshot,
  STORAGE_KEYS,
  transitionToNext,
  validateSettings,
  type CompletedInterval,
  type DailyHistory,
  type Mode,
  type PomodoroSettings,
  type TimerSnapshot,
} from '@/lib/pomodoro';
import {
  getNotificationPermission,
  playChime,
  requestNotificationPermission,
  showSystemNotification,
  storage,
  unlockAudio,
  vibrate,
} from '@/lib/browser';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type NotificationState = NotificationPermission | 'unsupported';

const TICK_MS = 250;
/** Completions older than this happened while the app was closed/frozen: summarise instead of alarming. */
const STALE_COMPLETION_MS = 60_000;
const DEFAULT_TITLE = 'PomoVNO · Pomodoro Timer';

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const isActivatableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'tab');

export function PomodoroTimer() {
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState<TimerSnapshot>(() => createIdleSnapshot('work', DEFAULT_SETTINGS));
  const [history, setHistory] = useState<DailyHistory>({});
  const [focusLabel, setFocusLabel] = useState('');
  const [isHydrated, setIsHydrated] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationState>('unsupported');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installHint, setInstallHint] = useState<'none' | 'ios'>('none');
  const [installDismissed, setInstallDismissed] = useState(true);
  const [announcement, setAnnouncement] = useState('');

  // Refs are the source of truth for event handlers, so rapid events (tick + focus + key)
  // never act on a stale snapshot and an interval can never be completed twice.
  const timerRef = useRef(timer);
  const settingsRef = useRef(settings);
  const historyRef = useRef(history);
  const focusLabelRef = useRef(focusLabel);

  useWakeLock(isHydrated && timer.isRunning && settings.keepScreenAwake);

  const commit = useCallback((next: TimerSnapshot, persist = true) => {
    timerRef.current = next;
    setTimer(next);
    if (persist) storage.set(STORAGE_KEYS.timer, JSON.stringify(next));
  }, []);

  const handleCompletions = useCallback(
    (completed: CompletedInterval[], next: TimerSnapshot, now: number) => {
      if (completed.length === 0) return;

      const nextHistory = pruneHistory(recordCompletedIntervals(historyRef.current, completed));
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      storage.set(STORAGE_KEYS.history, JSON.stringify(nextHistory));

      const last = completed[completed.length - 1];
      const nextLabel = MODE_LABELS[next.mode];
      const message = `${MODE_LABELS[last.mode]} finished. ${nextLabel} ${next.isRunning ? 'started' : 'is ready'}.`;
      setAnnouncement(message);

      if (now - last.endedAt > STALE_COMPLETION_MS) {
        const focusCount = completed.filter((item) => item.mode === 'work').length;
        toast({
          title: 'Welcome back',
          description:
            focusCount > 0
              ? `${focusCount} focus session${focusCount === 1 ? '' : 's'} finished while you were away. ${message}`
              : message,
        });
        return;
      }

      const current = settingsRef.current;
      const kind = next.mode === 'work' ? 'work' : 'break';
      if (current.soundEnabled) playChime(kind);
      if (current.vibrationEnabled) vibrate(kind === 'work' ? [300, 120, 300, 120, 300] : [200, 100, 200]);
      if (current.visualAlerts) setFlashKey((key) => key + 1);
      if (current.notificationsEnabled && (document.visibilityState !== 'visible' || !document.hasFocus())) {
        const focus = focusLabelRef.current.trim();
        void showSystemNotification(
          kind === 'work' ? 'Back to focus' : 'Time for a break',
          focus && kind === 'work' ? `${message} Focus: ${focus}` : message
        );
      }
    },
    []
  );

  const tick = useCallback(() => {
    const current = timerRef.current;
    if (!current.isRunning) return;
    const now = Date.now();
    const { timer: next, completed } = advanceTimer(current, settingsRef.current, now);
    if (completed.length > 0) {
      commit(next);
      handleCompletions(completed, next, now);
    } else if (Math.ceil(next.remainingMs / 1000) !== Math.ceil(current.remainingMs / 1000)) {
      // Running state is derived from endTimestamp, so per-second updates need no persistence.
      commit(next, false);
    }
  }, [commit, handleCompletions]);

  const startTimer = useCallback(() => {
    void unlockAudio();
    const current = timerRef.current;
    if (current.isRunning) return;
    commit(startSnapshot(current, Date.now()));
    setAnnouncement(`${MODE_LABELS[current.mode]} started.`);
  }, [commit]);

  const pauseTimer = useCallback(() => {
    const current = timerRef.current;
    if (!current.isRunning) return;
    commit(pauseSnapshot(current, Date.now()));
    setAnnouncement('Paused.');
  }, [commit]);

  const toggleTimer = useCallback(() => {
    if (timerRef.current.isRunning) pauseTimer();
    else startTimer();
  }, [pauseTimer, startTimer]);

  const resetTimer = useCallback(() => {
    const current = timerRef.current;
    const fullDuration = getModeDurationMs(current.mode, settingsRef.current);
    const alreadyFresh = !current.isRunning && current.remainingMs === fullDuration && current.durationMs === fullDuration;
    // Resetting an untouched timer resets the whole cycle.
    const keepCycle = alreadyFresh ? 0 : current.completedWorkSessionsInCycle;
    commit(createIdleSnapshot(current.mode, settingsRef.current, keepCycle));
    setAnnouncement(alreadyFresh ? 'Cycle reset.' : 'Timer reset.');
  }, [commit]);

  const skipInterval = useCallback(() => {
    const now = Date.now();
    const current = timerRef.current;
    const next = transitionToNext(pauseSnapshot(current, now), settingsRef.current, now, { skipped: true });
    commit(next);
    setAnnouncement(`Skipped ${MODE_LABELS[current.mode].toLowerCase()}. ${MODE_LABELS[next.mode]} is ready.`);
  }, [commit]);

  const addOneMinute = useCallback(() => {
    commit(addTimeToSnapshot(timerRef.current, MINUTE_MS, Date.now()));
    setAnnouncement('Added one minute.');
  }, [commit]);

  const switchMode = useCallback(
    (mode: Mode) => {
      const current = timerRef.current;
      if (mode === current.mode) return;
      commit(createIdleSnapshot(mode, settingsRef.current, current.completedWorkSessionsInCycle));
      setAnnouncement(`${MODE_LABELS[mode]} selected.`);
    },
    [commit]
  );

  const askNotificationPermission = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
    if (permission === 'denied') {
      toast({ title: 'Notifications blocked', description: 'Allow notifications for this site in your browser settings.' });
    }
    return permission;
  }, []);

  const saveSettings = useCallback(
    (next: PomodoroSettings) => {
      settingsRef.current = next;
      setSettings(next);
      storage.set(STORAGE_KEYS.settings, JSON.stringify(next));

      // Only an untouched, idle timer picks up a new duration right away; a running or
      // paused interval keeps its length and the new durations apply from the next one.
      const current = timerRef.current;
      const untouched = !current.isRunning && current.remainingMs === current.durationMs;
      if (untouched && getModeDurationMs(current.mode, next) !== current.durationMs) {
        commit(createIdleSnapshot(current.mode, next, current.completedWorkSessionsInCycle));
      }
      setAnnouncement('Settings saved.');
    },
    [commit]
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      toast({ title: 'Fullscreen unavailable', description: 'Your browser does not allow fullscreen here.' });
    }
  }, []);

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismissInstall = useCallback(() => {
    storage.set(STORAGE_KEYS.installPromptDismissed, '1');
    setInstallDismissed(true);
  }, []);

  // Hydrate from storage and wire up global listeners (once).
  useEffect(() => {
    const loadedSettings = validateSettings(safeParseJSON(storage.get(STORAGE_KEYS.settings))).settings;
    settingsRef.current = loadedSettings;
    setSettings(loadedSettings);

    const loadedHistory = sanitizeHistory(safeParseJSON(storage.get(STORAGE_KEYS.history)));
    historyRef.current = loadedHistory;
    setHistory(loadedHistory);

    const loadedFocus = (storage.get(STORAGE_KEYS.focus) ?? '').slice(0, 80);
    focusLabelRef.current = loadedFocus;
    setFocusLabel(loadedFocus);

    const now = Date.now();
    const saved =
      sanitizeSnapshot(safeParseJSON(storage.get(STORAGE_KEYS.timer)), loadedSettings) ??
      createIdleSnapshot('work', loadedSettings);
    const { timer: restored, completed } = advanceTimer(saved, loadedSettings, now);
    commit(restored);
    handleCompletions(completed, restored, now);

    setNotificationPermission(getNotificationPermission());
    setIsOnline(navigator.onLine);
    setCanFullscreen(Boolean(document.fullscreenEnabled));

    const nav = navigator as Navigator & { standalone?: boolean };
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    setInstallHint(isIos && !isStandalone ? 'ios' : 'none');
    setInstallDismissed(isStandalone || storage.get(STORAGE_KEYS.installPromptDismissed) === '1');

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setInstallDismissed(true);
    };
    // Mobile browsers only allow audio after a gesture; resume on every gesture since iOS
    // suspends the context again whenever the app is backgrounded.
    const onGesture = () => void unlockAudio();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture);

    setIsHydrated(true);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [commit, handleCompletions]);

  // Clock: poll the wall clock while running, and re-sync whenever the page wakes up.
  useEffect(() => {
    if (!timer.isRunning) return;
    const id = window.setInterval(tick, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [tick, timer.isRunning]);

  // Keep other tabs of the app in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.timer) {
        const next = sanitizeSnapshot(safeParseJSON(event.newValue), settingsRef.current);
        if (next) commit(advanceTimer(next, settingsRef.current, Date.now()).timer, false);
      } else if (event.key === STORAGE_KEYS.settings) {
        const next = validateSettings(safeParseJSON(event.newValue)).settings;
        settingsRef.current = next;
        setSettings(next);
      } else if (event.key === STORAGE_KEYS.history) {
        const next = sanitizeHistory(safeParseJSON(event.newValue));
        historyRef.current = next;
        setHistory(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [commit]);

  useEffect(() => {
    focusLabelRef.current = focusLabel;
    if (isHydrated) storage.set(STORAGE_KEYS.focus, focusLabel);
  }, [focusLabel, isHydrated]);

  useEffect(() => {
    const started = timer.isRunning || timer.remainingMs < timer.durationMs;
    document.title = started
      ? `${timer.isRunning ? '' : '⏸ '}${formatTimerMs(timer.remainingMs)} · ${MODE_LABELS[timer.mode]} | PomoVNO`
      : DEFAULT_TITLE;
  }, [timer.durationMs, timer.isRunning, timer.mode, timer.remainingMs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isEditableTarget(event.target) || isSettingsOpen) return;

      const key = event.key.toLowerCase();
      if (key === ' ') {
        // Let a focused button/tab handle its own Space activation.
        if (isActivatableTarget(event.target)) return;
        event.preventDefault();
        toggleTimer();
        return;
      }

      const actions: Record<string, () => void> = {
        r: resetTimer,
        s: skipInterval,
        '+': addOneMinute,
        '=': addOneMinute,
        f: () => void toggleFullscreen(),
        '1': () => switchMode('work'),
        '2': () => switchMode('shortBreak'),
        '3': () => switchMode('longBreak'),
        '?': () => setIsHelpOpen((open) => !open),
      };
      const action = actions[key];
      if (!action || (key === 'f' && !canFullscreen)) return;
      event.preventDefault();
      action();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addOneMinute, canFullscreen, isSettingsOpen, resetTimer, skipInterval, switchMode, toggleFullscreen, toggleTimer]);

  const today = getRecentSummary(history, 1);
  const week = getRecentSummary(history, 7);
  const progress = timer.durationMs > 0 ? 1 - timer.remainingMs / timer.durationMs : 0;
  const cycleLength = settings.longBreakInterval;
  const cycleDone = Math.min(timer.completedWorkSessionsInCycle, cycleLength);
  const showInstall = !installDismissed && (deferredPrompt !== null || installHint === 'ios');

  return (
    <>
      {flashKey > 0 ? (
        <div key={flashKey} className="flash-overlay-animation pointer-events-none fixed inset-0 z-[100] bg-white" aria-hidden="true" />
      ) : null}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="w-full max-w-xl space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div className="min-h-6 text-xs text-muted-foreground" role="status">
            {!isOnline ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-1">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Offline
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <Button onClick={() => setIsHelpOpen((open) => !open)} variant="ghost" size="icon" aria-label="Keyboard shortcuts" aria-expanded={isHelpOpen} className="hidden sm:inline-flex">
              <Keyboard className="h-5 w-5" />
            </Button>
            <Button onClick={() => setIsSettingsOpen(true)} variant="ghost" size="icon" aria-label="Settings">
              <SettingsIcon className="h-5 w-5" />
            </Button>
            {canFullscreen ? (
              <Button onClick={toggleFullscreen} variant="ghost" size="icon" aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                {isFullscreen ? <Shrink className="h-5 w-5" /> : <Expand className="h-5 w-5" />}
              </Button>
            ) : null}
          </div>
        </header>

        {showInstall ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-white/15 bg-card/60 p-3 text-sm">
            <div>
              <p className="font-medium">Install PomoVNO</p>
              <p className="text-muted-foreground">
                {deferredPrompt ? 'Add it to your home screen. It works fully offline.' : 'Tap Share, then “Add to Home Screen” to use it offline.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {deferredPrompt ? (
                <Button size="sm" onClick={triggerInstall}>
                  <Download className="mr-1 h-4 w-4" /> Install
                </Button>
              ) : null}
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={dismissInstall} aria-label="Dismiss install prompt">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-card/30 p-4 sm:p-6" aria-label="Timer">
          <Tabs value={timer.mode} onValueChange={(value) => switchMode(value as Mode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="work">Focus</TabsTrigger>
              <TabsTrigger value="shortBreak">Short</TabsTrigger>
              <TabsTrigger value="longBreak">Long</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className={cn('mt-6 text-center transition-opacity duration-300', isHydrated ? 'opacity-100' : 'opacity-0')}>
            <h1 className="sr-only">PomoVNO Pomodoro timer</h1>
            <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">{MODE_LABELS[timer.mode]}</p>
            <p role="timer" aria-label={`${formatTimerMs(timer.remainingMs)} remaining`} className="mt-1 font-black tabular-nums leading-none text-[clamp(4.5rem,24vw,8.5rem)]">
              {formatTimerMs(timer.remainingMs)}
            </p>

            <div className="mx-auto mt-5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div className="h-full rounded-full bg-white transition-[width] duration-300 ease-linear" style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }} />
            </div>

            <div className="mt-4 flex justify-center gap-2" role="img" aria-label={`${cycleDone} of ${cycleLength} focus sessions completed this cycle`}>
              {Array.from({ length: cycleLength }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    'h-2 w-2 rounded-full border border-white/40',
                    index < cycleDone && 'border-white bg-white',
                    index === cycleDone && timer.mode === 'work' && 'border-white'
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-3">
            <Button onClick={resetTimer} variant="secondary" size="icon" className="h-14 w-14 rounded-2xl" aria-label="Reset timer (press again to reset the cycle)">
              <RotateCcw className="h-5 w-5" />
            </Button>
            <Button onClick={toggleTimer} size="lg" className="h-16 min-w-36 rounded-2xl text-lg">
              {timer.isRunning ? <Pause className="h-6 w-6" aria-hidden="true" /> : <Play className="h-6 w-6" aria-hidden="true" />}
              <span className="ml-2">{timer.isRunning ? 'Pause' : timer.remainingMs < timer.durationMs ? 'Resume' : 'Start'}</span>
            </Button>
            <Button onClick={skipInterval} variant="secondary" size="icon" className="h-14 w-14 rounded-2xl" aria-label="Skip to next interval">
              <SkipForward className="h-5 w-5" />
            </Button>
          </div>
          <div className="mt-3 flex justify-center">
            <Button onClick={addOneMinute} variant="ghost" size="sm" className="text-muted-foreground" aria-label="Add one minute">
              <Plus className="mr-1 h-4 w-4" /> 1 min
            </Button>
          </div>
        </section>

        <section className="grid gap-3 rounded-3xl border border-white/10 bg-card/20 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="focus-label">Current focus</Label>
            <Input
              id="focus-label"
              value={focusLabel}
              maxLength={80}
              enterKeyHint="done"
              autoComplete="off"
              onChange={(event) => setFocusLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
              }}
              placeholder="What are you working on?"
            />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl border border-white/10 p-3">
              <dt className="text-xs text-muted-foreground">Today</dt>
              <dd className="mt-1 font-semibold tabular-nums">{formatMinutes(today.focusMinutes)}</dd>
              <dd className="text-xs text-muted-foreground">
                {today.sessions} session{today.sessions === 1 ? '' : 's'}
              </dd>
            </div>
            <div className="rounded-xl border border-white/10 p-3">
              <dt className="text-xs text-muted-foreground">Last 7 days</dt>
              <dd className="mt-1 font-semibold tabular-nums">{formatMinutes(week.focusMinutes)}</dd>
              <dd className="text-xs text-muted-foreground">
                {week.sessions} session{week.sessions === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>
        </section>

        {isHelpOpen ? (
          <section className="rounded-xl border border-white/15 bg-card/60 p-3 text-sm" aria-label="Keyboard shortcuts">
            <ul className="grid gap-1 text-muted-foreground sm:grid-cols-2">
              <li><kbd className="font-mono text-foreground">Space</kbd> start / pause</li>
              <li><kbd className="font-mono text-foreground">R</kbd> reset (twice: reset cycle)</li>
              <li><kbd className="font-mono text-foreground">S</kbd> skip interval</li>
              <li><kbd className="font-mono text-foreground">+</kbd> add one minute</li>
              <li><kbd className="font-mono text-foreground">1 2 3</kbd> focus / short / long</li>
              {canFullscreen ? <li><kbd className="font-mono text-foreground">F</kbd> fullscreen</li> : null}
              <li><kbd className="font-mono text-foreground">?</kbd> toggle this help</li>
            </ul>
          </section>
        ) : null}
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        timerIsActive={timer.isRunning || timer.remainingMs < timer.durationMs}
        onSave={saveSettings}
        notificationPermission={notificationPermission}
        onRequestNotificationPermission={askNotificationPermission}
      />
    </>
  );
}
