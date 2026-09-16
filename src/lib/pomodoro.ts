export type Mode = 'work' | 'shortBreak' | 'longBreak';

export interface PomodoroSettings {
  work: number;
  shortBreak: number;
  longBreak: number;
  longBreakInterval: number;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  visualAlerts: boolean;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
}

export interface DailySummary {
  sessions: number;
  focusMinutes: number;
}

export type DailyHistory = Record<string, DailySummary>;

export interface TimerSnapshot {
  mode: Mode;
  isRunning: boolean;
  remainingMs: number;
  endTimestamp: number | null;
  completedWorkSessionsInCycle: number;
}

export interface PomodoroPreset {
  key: string;
  label: string;
  values: Pick<PomodoroSettings, 'work' | 'shortBreak' | 'longBreak'>;
}

export const STORAGE_KEYS = {
  settings: 'pomovno.settings.v2',
  timer: 'pomovno.timer.v2',
  focus: 'pomovno.focus.v1',
  history: 'pomovno.history.v1',
  installPromptDismissed: 'pomovno.install.dismissed.v1',
};

export const DEFAULT_SETTINGS: PomodoroSettings = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakInterval: 4,
  soundEnabled: true,
  notificationsEnabled: false,
  visualAlerts: true,
  autoStartBreaks: true,
  autoStartWork: false,
};

export const PRESETS: PomodoroPreset[] = [
  { key: 'classic', label: 'Classic 25/5/15', values: { work: 25, shortBreak: 5, longBreak: 15 } },
  { key: 'extended', label: 'Extended 50/10/20', values: { work: 50, shortBreak: 10, longBreak: 20 } },
  { key: 'deep-work', label: 'Deep Work 90/20/30', values: { work: 90, shortBreak: 20, longBreak: 30 } },
];

export const DURATION_LIMITS = {
  work: { min: 1, max: 180 },
  shortBreak: { min: 1, max: 60 },
  longBreak: { min: 1, max: 120 },
  longBreakInterval: { min: 2, max: 12 },
} as const;

const MINUTE_MS = 60_000;
const MAX_DURATION_MS = 12 * 60 * MINUTE_MS;

export function formatTimerMs(milliseconds: number): string {
  const clamped = Math.max(0, milliseconds);
  const totalSeconds = Math.ceil(clamped / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getModeDurationMs(mode: Mode, settings: PomodoroSettings): number {
  if (mode === 'work') return settings.work * MINUTE_MS;
  if (mode === 'shortBreak') return settings.shortBreak * MINUTE_MS;
  return settings.longBreak * MINUTE_MS;
}

export function clampRemainingMs(milliseconds: number): number {
  return Math.min(Math.max(milliseconds, 0), MAX_DURATION_MS);
}

export function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function safeParseJSON<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function validateSettings(input: Partial<PomodoroSettings>): {
  settings: PomodoroSettings;
  errors: Partial<Record<keyof PomodoroSettings, string>>;
} {
  const base = { ...DEFAULT_SETTINGS, ...input };
  const errors: Partial<Record<keyof PomodoroSettings, string>> = {};

  const enforceInt = (
    key: 'work' | 'shortBreak' | 'longBreak' | 'longBreakInterval',
    min: number,
    max: number,
    label: string
  ) => {
    const value = Number(base[key]);
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      errors[key] = `${label} must be a number.`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (base as any)[key] = DEFAULT_SETTINGS[key];
      return;
    }

    const rounded = Math.round(value);
    if (rounded < min || rounded > max) {
      errors[key] = `${label} must be between ${min} and ${max}.`;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (base as any)[key] = Math.min(Math.max(rounded, min), max);
  };

  enforceInt('work', DURATION_LIMITS.work.min, DURATION_LIMITS.work.max, 'Work duration');
  enforceInt('shortBreak', DURATION_LIMITS.shortBreak.min, DURATION_LIMITS.shortBreak.max, 'Short break duration');
  enforceInt('longBreak', DURATION_LIMITS.longBreak.min, DURATION_LIMITS.longBreak.max, 'Long break duration');
  enforceInt(
    'longBreakInterval',
    DURATION_LIMITS.longBreakInterval.min,
    DURATION_LIMITS.longBreakInterval.max,
    'Long break interval'
  );

  return {
    settings: {
      work: base.work,
      shortBreak: base.shortBreak,
      longBreak: base.longBreak,
      longBreakInterval: base.longBreakInterval,
      soundEnabled: Boolean(base.soundEnabled),
      notificationsEnabled: Boolean(base.notificationsEnabled),
      visualAlerts: Boolean(base.visualAlerts),
      autoStartBreaks: Boolean(base.autoStartBreaks),
      autoStartWork: Boolean(base.autoStartWork),
    },
    errors,
  };
}

export function getNextMode(currentMode: Mode, completedWorkSessionsInCycle: number, settings: PomodoroSettings): {
  nextMode: Mode;
  nextCompletedInCycle: number;
} {
  if (currentMode === 'work') {
    const nextCompleted = completedWorkSessionsInCycle + 1;
    if (nextCompleted % settings.longBreakInterval === 0) {
      return { nextMode: 'longBreak', nextCompletedInCycle: nextCompleted };
    }
    return { nextMode: 'shortBreak', nextCompletedInCycle: nextCompleted };
  }

  if (currentMode === 'longBreak') {
    return { nextMode: 'work', nextCompletedInCycle: 0 };
  }

  return { nextMode: 'work', nextCompletedInCycle: completedWorkSessionsInCycle };
}

export function shouldAutoStart(mode: Mode, settings: PomodoroSettings): boolean {
  return mode === 'work' ? settings.autoStartWork : settings.autoStartBreaks;
}

export function addWorkSessionToHistory(history: DailyHistory, workMinutes: number, dateKey = getTodayKey()): DailyHistory {
  const current = history[dateKey] ?? { sessions: 0, focusMinutes: 0 };
  return {
    ...history,
    [dateKey]: {
      sessions: current.sessions + 1,
      focusMinutes: current.focusMinutes + workMinutes,
    },
  };
}
