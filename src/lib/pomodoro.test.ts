import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTimeToSnapshot,
  advanceTimer,
  createIdleSnapshot,
  DEFAULT_SETTINGS,
  formatMinutes,
  formatTimerMs,
  getDateKey,
  getNextMode,
  getRecentSummary,
  MINUTE_MS,
  pauseSnapshot,
  pruneHistory,
  recordCompletedIntervals,
  sanitizeHistory,
  sanitizeSnapshot,
  startSnapshot,
  transitionToNext,
  validateSettings,
  type PomodoroSettings,
} from './pomodoro.ts';

const settings: PomodoroSettings = { ...DEFAULT_SETTINGS, autoStartBreaks: true, autoStartWork: false };

test('formatTimerMs rounds up to whole seconds and never goes negative', () => {
  assert.equal(formatTimerMs(25 * MINUTE_MS), '25:00');
  assert.equal(formatTimerMs(59_001), '01:00');
  assert.equal(formatTimerMs(59_000), '00:59');
  assert.equal(formatTimerMs(1), '00:01');
  assert.equal(formatTimerMs(0), '00:00');
  assert.equal(formatTimerMs(-500), '00:00');
  assert.equal(formatTimerMs(120 * MINUTE_MS), '120:00');
});

test('getDateKey uses the local calendar date', () => {
  assert.equal(getDateKey(new Date(2024, 0, 5, 0, 30)), '2024-01-05');
  assert.equal(getDateKey(new Date(2024, 11, 31, 23, 59)), '2024-12-31');
});

test('validateSettings clamps, rounds and reports errors', () => {
  const { settings: s, errors } = validateSettings({ work: 500, shortBreak: 4.6, longBreak: '' as unknown as number });
  assert.equal(s.work, 180);
  assert.equal(s.shortBreak, 5);
  assert.equal(s.longBreak, DEFAULT_SETTINGS.longBreak);
  assert.ok(errors.work);
  assert.ok(errors.longBreak);
  assert.equal(errors.shortBreak, undefined);
});

test('validateSettings ignores junk and fills defaults', () => {
  const { settings: s, errors } = validateSettings({ soundEnabled: 'yes' as unknown as boolean, bogus: 1 } as never);
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.deepEqual(errors, {});
  assert.deepEqual(validateSettings(null).settings, DEFAULT_SETTINGS);
});

test('getNextMode cycles work → short breaks → long break', () => {
  assert.deepEqual(getNextMode('work', 0, settings), { nextMode: 'shortBreak', nextCompletedInCycle: 1 });
  assert.deepEqual(getNextMode('shortBreak', 1, settings), { nextMode: 'work', nextCompletedInCycle: 1 });
  assert.deepEqual(getNextMode('work', 3, settings), { nextMode: 'longBreak', nextCompletedInCycle: 4 });
  assert.deepEqual(getNextMode('longBreak', 4, settings), { nextMode: 'work', nextCompletedInCycle: 0 });
});

test('getNextMode still gives a long break when the interval is lowered mid-cycle', () => {
  assert.equal(getNextMode('work', 3, { ...settings, longBreakInterval: 2 }).nextMode, 'longBreak');
});

test('start / pause keep time based on the wall clock', () => {
  const idle = createIdleSnapshot('work', settings);
  const running = startSnapshot(idle, 1_000);
  assert.equal(running.endTimestamp, 1_000 + 25 * MINUTE_MS);
  const paused = pauseSnapshot(running, 1_000 + 10 * MINUTE_MS);
  assert.equal(paused.remainingMs, 15 * MINUTE_MS);
  assert.equal(paused.isRunning, false);
  assert.equal(paused.endTimestamp, null);
  assert.equal(startSnapshot(running, 5_000), running, 'starting twice is a no-op');
});

test('advanceTimer only updates remaining time before the end', () => {
  const running = startSnapshot(createIdleSnapshot('work', settings), 0);
  const { timer, completed } = advanceTimer(running, settings, 60_000);
  assert.equal(completed.length, 0);
  assert.equal(timer.remainingMs, 24 * MINUTE_MS);
});

test('advanceTimer completes work and auto-starts the break from the exact end time', () => {
  const running = startSnapshot(createIdleSnapshot('work', settings), 0);
  const end = 25 * MINUTE_MS;
  const { timer, completed } = advanceTimer(running, settings, end + 2_000);
  assert.deepEqual(completed, [{ mode: 'work', durationMs: end, endedAt: end }]);
  assert.equal(timer.mode, 'shortBreak');
  assert.equal(timer.isRunning, true);
  assert.equal(timer.endTimestamp, end + 5 * MINUTE_MS);
  assert.equal(timer.remainingMs, 5 * MINUTE_MS - 2_000);
  assert.equal(timer.completedWorkSessionsInCycle, 1);
});

test('advanceTimer catches up several intervals after the app was closed', () => {
  const auto = { ...settings, autoStartWork: true };
  const running = startSnapshot(createIdleSnapshot('work', auto), 0);
  // work(25) + short(5) + work(25) = 55 minutes, then 1 more minute into the next short break.
  const { timer, completed } = advanceTimer(running, auto, 56 * MINUTE_MS);
  assert.deepEqual(completed.map((c) => c.mode), ['work', 'shortBreak', 'work']);
  assert.equal(timer.mode, 'shortBreak');
  assert.equal(timer.remainingMs, 4 * MINUTE_MS);
  assert.equal(timer.completedWorkSessionsInCycle, 2);
});

test('advanceTimer stops when the next interval does not auto-start', () => {
  const noAuto = { ...settings, autoStartBreaks: false };
  const running = startSnapshot(createIdleSnapshot('work', noAuto), 0);
  const { timer, completed } = advanceTimer(running, noAuto, 10 * 60 * MINUTE_MS);
  assert.equal(completed.length, 1);
  assert.equal(timer.mode, 'shortBreak');
  assert.equal(timer.isRunning, false);
  assert.equal(timer.remainingMs, 5 * MINUTE_MS);
});

test('advanceTimer is idempotent (no double completion)', () => {
  const running = startSnapshot(createIdleSnapshot('work', settings), 0);
  const first = advanceTimer(running, settings, 25 * MINUTE_MS);
  const second = advanceTimer(first.timer, settings, 25 * MINUTE_MS);
  assert.equal(first.completed.length, 1);
  assert.equal(second.completed.length, 0);
  assert.equal(second.timer, first.timer);
});

test('skipping never auto-starts', () => {
  const next = transitionToNext(createIdleSnapshot('work', settings), settings, 0, { skipped: true });
  assert.equal(next.mode, 'shortBreak');
  assert.equal(next.isRunning, false);
});

test('addTimeToSnapshot extends both remaining time and duration', () => {
  const running = startSnapshot(createIdleSnapshot('shortBreak', settings), 0);
  const extended = addTimeToSnapshot(running, MINUTE_MS, 60_000);
  assert.equal(extended.remainingMs, 5 * MINUTE_MS);
  assert.equal(extended.durationMs, 6 * MINUTE_MS);
  assert.equal(extended.endTimestamp, 60_000 + 5 * MINUTE_MS);
  const paused = addTimeToSnapshot(createIdleSnapshot('work', settings), MINUTE_MS, 0);
  assert.equal(paused.endTimestamp, null);
  assert.equal(paused.remainingMs, 26 * MINUTE_MS);
});

test('sanitizeSnapshot rejects junk and repairs partial data', () => {
  assert.equal(sanitizeSnapshot(null, settings), null);
  assert.equal(sanitizeSnapshot({ mode: 'nap' }, settings), null);
  const legacy = sanitizeSnapshot(
    { mode: 'work', isRunning: true, remainingMs: 1000, endTimestamp: 42, completedWorkSessionsInCycle: 2 },
    settings
  );
  assert.equal(legacy?.durationMs, 25 * MINUTE_MS);
  assert.equal(legacy?.isRunning, true);
  const broken = sanitizeSnapshot({ mode: 'work', isRunning: true, endTimestamp: 'x', remainingMs: -5 }, settings);
  assert.equal(broken?.isRunning, false);
  assert.equal(broken?.remainingMs, 0);
});

test('history records completed work in local days and summarises calendar days', () => {
  const day = new Date(2024, 4, 10, 9, 0).getTime();
  const history = recordCompletedIntervals({}, [
    { mode: 'work', durationMs: 25 * MINUTE_MS, endedAt: day },
    { mode: 'shortBreak', durationMs: 5 * MINUTE_MS, endedAt: day + MINUTE_MS },
    { mode: 'work', durationMs: 26 * MINUTE_MS, endedAt: day + 2 * MINUTE_MS },
  ]);
  assert.deepEqual(history, { '2024-05-10': { sessions: 2, focusMinutes: 51 } });

  const withOld = { ...history, '2024-05-01': { sessions: 9, focusMinutes: 225 } };
  const now = new Date(2024, 4, 12);
  assert.deepEqual(getRecentSummary(withOld, 1, now), { sessions: 0, focusMinutes: 0 });
  assert.deepEqual(getRecentSummary(withOld, 7, now), { sessions: 2, focusMinutes: 51 });
});

test('sanitizeHistory and pruneHistory drop bad and stale entries', () => {
  const clean = sanitizeHistory({
    '2024-05-10': { sessions: 1, focusMinutes: 25 },
    nope: { sessions: 1, focusMinutes: 25 },
    '2024-05-11': { sessions: 'x', focusMinutes: 25 },
  });
  assert.deepEqual(Object.keys(clean), ['2024-05-10']);
  assert.deepEqual(pruneHistory(clean, new Date(2024, 4, 20), 5), {});
  assert.deepEqual(pruneHistory(clean, new Date(2024, 4, 12), 5), clean);
});

test('formatMinutes', () => {
  assert.equal(formatMinutes(0), '0m');
  assert.equal(formatMinutes(45), '45m');
  assert.equal(formatMinutes(60), '1h');
  assert.equal(formatMinutes(135), '2h 15m');
});
