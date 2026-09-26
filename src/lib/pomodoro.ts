// Pure timer logic. No DOM / React here so it can be unit tested with `npm test`.

export type Mode = 'work' | 'shortBreak' | 'longBreak';

export const MODES: readonly Mode[] = ['work', 'shortBreak', 'longBreak'];

export const MODE_LABELS: Record<Mode, string> = {
  work: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

export interface PomodoroSettings {
  work: number;
  shortBreak: number;
  longBreak: number;
  longBreakInterval: number;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  notificationsEnabled: boolean;
  visualAlerts: boolean;
  keepScreenAwake: boolean;
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
  /** Time left. Authoritative while paused; derived from `endTimestamp` while running. */
  remainingMs: number;
  /** Full length of the current interval (grows when minutes are added). */
  durationMs: number;
  /** Wall-clock end of the interval while running, otherwise null. */
  endTimestamp: number | null;
  completedWorkSessionsInCycle: number;
}

export interface CompletedInterval {
  mode: Mode;
  durationMs: number;
  endedAt: number;
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
} as const;

export const DEFAULT_SETTINGS: PomodoroSettings = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakInterval: 4,
  soundEnabled: true,
  vibrationEnabled: true,
  notificationsEnabled: false,
  visualAlerts: true,
  keepScreenAwake: true,
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

export const MINUTE_MS = 60_000;
const MAX_DURATION_MS = 12 * 60 * MINUTE_MS;
/** Upper bound on intervals replayed after the app was closed (auto-start chains). */
const MAX_CATCH_UP = 100;
/** Days of history kept in storage. */
const HISTORY_RETENTION_DAYS = 400;

const BOOLEAN_SETTINGS = [
  'soundEnabled',
  'vibrationEnabled',
  'notificationsEnabled',
  'visualAlerts',
  'keepScreenAwake',
  'autoStartBreaks',
  'autoStartWork',
] as const;

type NumericSetting = keyof typeof DURATION_LIMITS;

export function formatTimerMs(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getModeDurationMs(mode: Mode, settings: PomodoroSettings): number {
  return settings[mode] * MINUTE_MS;
}

export function clampRemainingMs(milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) return 0;
  return Math.min(Math.max(milliseconds, 0), MAX_DURATION_MS);
}

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's clock). */
export function getDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function safeParseJSON<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function validateSettings(input: Partial<Record<keyof PomodoroSettings, unknown>> | null | undefined): {
  settings: PomodoroSettings;
  errors: Partial<Record<keyof PomodoroSettings, string>>;
} {
  const source = input && typeof input === 'object' ? input : {};
  const errors: Partial<Record<keyof PomodoroSettings, string>> = {};
  const settings: PomodoroSettings = { ...DEFAULT_SETTINGS };

  const labels: Record<NumericSetting, string> = {
    work: 'Work duration',
    shortBreak: 'Short break duration',
    longBreak: 'Long break duration',
    longBreakInterval: 'Long break interval',
  };

  (Object.keys(DURATION_LIMITS) as NumericSetting[]).forEach((key) => {
    const { min, max } = DURATION_LIMITS[key];
    const raw = source[key];
    if (raw === undefined) return;
    const value = raw === '' || raw === null ? NaN : Number(raw);
    if (!Number.isFinite(value)) {
      errors[key] = `${labels[key]} must be a number.`;
      return;
    }
    const rounded = Math.round(value);
    if (rounded < min || rounded > max) {
      errors[key] = `${labels[key]} must be between ${min} and ${max}.`;
    }
    settings[key] = Math.min(Math.max(rounded, min), max);
  });

  BOOLEAN_SETTINGS.forEach((key) => {
    if (typeof source[key] === 'boolean') settings[key] = source[key] as boolean;
  });

  return { settings, errors };
}

export function getNextMode(
  currentMode: Mode,
  completedWorkSessionsInCycle: number,
  settings: PomodoroSettings
): { nextMode: Mode; nextCompletedInCycle: number } {
  if (currentMode === 'work') {
    const nextCompleted = completedWorkSessionsInCycle + 1;
    // `>=` (not `%`) so lowering the interval mid-cycle still triggers the long break.
    const nextMode = nextCompleted >= settings.longBreakInterval ? 'longBreak' : 'shortBreak';
    return { nextMode, nextCompletedInCycle: nextCompleted };
  }
  if (currentMode === 'longBreak') {
    return { nextMode: 'work', nextCompletedInCycle: 0 };
  }
  return { nextMode: 'work', nextCompletedInCycle: completedWorkSessionsInCycle };
}

export function shouldAutoStart(mode: Mode, settings: PomodoroSettings): boolean {
  return mode === 'work' ? settings.autoStartWork : settings.autoStartBreaks;
}

export function createIdleSnapshot(
  mode: Mode,
  settings: PomodoroSettings,
  completedWorkSessionsInCycle = 0
): TimerSnapshot {
  const durationMs = getModeDurationMs(mode, settings);
  return {
    mode,
    isRunning: false,
    remainingMs: durationMs,
    durationMs,
    endTimestamp: null,
    completedWorkSessionsInCycle,
  };
}

/** Moves to the interval after `timer`. Skips never auto-start the next interval. */
export function transitionToNext(
  timer: TimerSnapshot,
  settings: PomodoroSettings,
  at: number,
  { skipped = false }: { skipped?: boolean } = {}
): TimerSnapshot {
  const { nextMode, nextCompletedInCycle } = getNextMode(timer.mode, timer.completedWorkSessionsInCycle, settings);
  const next = createIdleSnapshot(nextMode, settings, nextCompletedInCycle);
  if (!skipped && shouldAutoStart(nextMode, settings)) {
    return { ...next, isRunning: true, endTimestamp: at + next.durationMs };
  }
  return next;
}

/**
 * Brings a snapshot up to date with the wall clock. Handles any number of
 * intervals that finished while the page was throttled, asleep, or closed.
 */
export function advanceTimer(
  timer: TimerSnapshot,
  settings: PomodoroSettings,
  now: number
): { timer: TimerSnapshot; completed: CompletedInterval[] } {
  const completed: CompletedInterval[] = [];
  let current = timer;

  while (current.isRunning && current.endTimestamp !== null && current.endTimestamp <= now) {
    if (completed.length >= MAX_CATCH_UP) {
      current = createIdleSnapshot(current.mode, settings, current.completedWorkSessionsInCycle);
      break;
    }
    completed.push({ mode: current.mode, durationMs: current.durationMs, endedAt: current.endTimestamp });
    current = transitionToNext(current, settings, current.endTimestamp);
  }

  if (current.isRunning && current.endTimestamp !== null) {
    const remainingMs = clampRemainingMs(current.endTimestamp - now);
    if (remainingMs !== current.remainingMs) current = { ...current, remainingMs };
  }

  return { timer: current, completed };
}

export function startSnapshot(timer: TimerSnapshot, now: number): TimerSnapshot {
  if (timer.isRunning) return timer;
  const remainingMs = timer.remainingMs > 0 ? timer.remainingMs : timer.durationMs;
  return { ...timer, isRunning: true, remainingMs, endTimestamp: now + remainingMs };
}

export function pauseSnapshot(timer: TimerSnapshot, now: number): TimerSnapshot {
  if (!timer.isRunning) return timer;
  const remainingMs = timer.endTimestamp === null ? timer.remainingMs : clampRemainingMs(timer.endTimestamp - now);
  return { ...timer, isRunning: false, remainingMs, endTimestamp: null };
}

export function addTimeToSnapshot(timer: TimerSnapshot, deltaMs: number, now: number): TimerSnapshot {
  const current = timer.isRunning && timer.endTimestamp !== null ? timer.endTimestamp - now : timer.remainingMs;
  const remainingMs = clampRemainingMs(current + deltaMs);
  const applied = remainingMs - clampRemainingMs(current);
  return {
    ...timer,
    remainingMs,
    durationMs: clampRemainingMs(Math.max(timer.durationMs + applied, remainingMs)),
    endTimestamp: timer.isRunning ? now + remainingMs : null,
  };
}

/** Validates an untrusted (stored) snapshot. Returns null if it is unusable. */
export function sanitizeSnapshot(raw: unknown, settings: PomodoroSettings): TimerSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!MODES.includes(value.mode as Mode)) return null;
  const mode = value.mode as Mode;

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const durationMs = clampRemainingMs(num(value.durationMs) ?? getModeDurationMs(mode, settings)) || getModeDurationMs(mode, settings);
  const remainingMs = Math.min(clampRemainingMs(num(value.remainingMs) ?? durationMs), durationMs);
  const endTimestamp = num(value.endTimestamp);
  const isRunning = value.isRunning === true && endTimestamp !== null;
  const completed = Math.max(0, Math.min(Math.round(num(value.completedWorkSessionsInCycle) ?? 0), DURATION_LIMITS.longBreakInterval.max));

  return {
    mode,
    isRunning,
    remainingMs,
    durationMs,
    endTimestamp: isRunning ? endTimestamp : null,
    completedWorkSessionsInCycle: completed,
  };
}

export function sanitizeHistory(raw: unknown): DailyHistory {
  if (!raw || typeof raw !== 'object') return {};
  const history: DailyHistory = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, entry]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !entry || typeof entry !== 'object') return;
    const { sessions, focusMinutes } = entry as Record<string, unknown>;
    if (typeof sessions !== 'number' || typeof focusMinutes !== 'number') return;
    if (!Number.isFinite(sessions) || !Number.isFinite(focusMinutes)) return;
    history[key] = { sessions: Math.max(0, Math.round(sessions)), focusMinutes: Math.max(0, Math.round(focusMinutes)) };
  });
  return history;
}

export function addWorkSessionToHistory(history: DailyHistory, focusMinutes: number, dateKey = getDateKey()): DailyHistory {
  const current = history[dateKey] ?? { sessions: 0, focusMinutes: 0 };
  return {
    ...history,
    [dateKey]: {
      sessions: current.sessions + 1,
      focusMinutes: current.focusMinutes + Math.max(0, Math.round(focusMinutes)),
    },
  };
}

export function recordCompletedIntervals(history: DailyHistory, completed: CompletedInterval[]): DailyHistory {
  return completed.reduce(
    (acc, interval) =>
      interval.mode === 'work'
        ? addWorkSessionToHistory(acc, interval.durationMs / MINUTE_MS, getDateKey(new Date(interval.endedAt)))
        : acc,
    history
  );
}

/** Totals for the last `days` calendar days, including today. */
export function getRecentSummary(history: DailyHistory, days: number, now: Date = new Date()): DailySummary {
  const summary: DailySummary = { sessions: 0, focusMinutes: 0 };
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const entry = history[getDateKey(day)];
    if (entry) {
      summary.sessions += entry.sessions;
      summary.focusMinutes += entry.focusMinutes;
    }
  }
  return summary;
}

export function pruneHistory(history: DailyHistory, now: Date = new Date(), days = HISTORY_RETENTION_DAYS): DailyHistory {
  const cutoff = getDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  return Object.fromEntries(Object.entries(history).filter(([key]) => key > cutoff));
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
