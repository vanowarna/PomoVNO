"use client";

import { useEffect, useState, type ChangeEvent } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { DURATION_LIMITS, PRESETS, type PomodoroSettings, validateSettings } from '@/lib/pomodoro';
import { cn } from '@/lib/utils';

type NotificationState = NotificationPermission | 'unsupported';
type NumericField = keyof typeof DURATION_LIMITS;
/** Number inputs are edited as strings so the field can be cleared while typing. */
type Draft = Omit<PomodoroSettings, NumericField> & Record<NumericField, string>;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PomodoroSettings;
  timerIsActive: boolean;
  onSave: (settings: PomodoroSettings) => void;
  notificationPermission: NotificationState;
  onRequestNotificationPermission: () => Promise<NotificationState>;
}

const toDraft = (settings: PomodoroSettings): Draft => ({
  ...settings,
  work: String(settings.work),
  shortBreak: String(settings.shortBreak),
  longBreak: String(settings.longBreak),
  longBreakInterval: String(settings.longBreakInterval),
});

const DURATION_FIELDS: { key: NumericField; label: string; hint?: string }[] = [
  { key: 'work', label: 'Focus' },
  { key: 'shortBreak', label: 'Short break' },
  { key: 'longBreak', label: 'Long break' },
  { key: 'longBreakInterval', label: 'Long break after', hint: 'focus sessions' },
];

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  timerIsActive,
  onSave,
  notificationPermission,
  onRequestNotificationPermission,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [errors, setErrors] = useState<Partial<Record<keyof PomodoroSettings, string>>>({});

  // Start from the saved settings every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setDraft(toDraft(settings));
      setErrors({});
    }
  }, [isOpen, settings]);

  const supportsWakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const supportsVibration = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  const notificationHint =
    notificationPermission === 'unsupported'
      ? 'Not supported here. On iPhone, install the app to the home screen first.'
      : notificationPermission === 'denied'
        ? 'Blocked. Allow notifications for this site in browser settings.'
        : 'Alert when an interval ends while the app is in the background.';

  const handleNumber = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setDraft((prev) => ({ ...prev, [name]: value }));
  };

  const handleSwitch = (name: keyof PomodoroSettings) => (checked: boolean) => {
    setDraft((prev) => ({ ...prev, [name]: checked }));
  };

  const handleNotifications = async (checked: boolean) => {
    if (!checked) {
      handleSwitch('notificationsEnabled')(false);
      return;
    }
    // Ask while we still have the user gesture from the toggle.
    const permission =
      notificationPermission === 'granted' ? 'granted' : await onRequestNotificationPermission();
    handleSwitch('notificationsEnabled')(permission === 'granted');
  };

  const applyPreset = (values: (typeof PRESETS)[number]['values']) => {
    setDraft((prev) => ({
      ...prev,
      work: String(values.work),
      shortBreak: String(values.shortBreak),
      longBreak: String(values.longBreak),
    }));
    setErrors({});
  };

  const handleSave = () => {
    const result = validateSettings(draft);
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    onSave(result.settings);
    onClose();
  };

  const activePreset = PRESETS.find(
    (preset) =>
      String(preset.values.work) === draft.work &&
      String(preset.values.shortBreak) === draft.shortBreak &&
      String(preset.values.longBreak) === draft.longBreak
  )?.key;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved on this device only.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Presets</h3>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant={activePreset === preset.key ? 'default' : 'outline'}
                  className="h-auto flex-col gap-0 whitespace-normal px-2 py-2"
                  aria-pressed={activePreset === preset.key}
                  onClick={() => applyPreset(preset.values)}
                >
                  <span className="text-xs">{preset.label.replace(/\s[\d/]+$/, '')}</span>
                  <span className="font-mono text-xs opacity-70">
                    {preset.values.work}/{preset.values.shortBreak}/{preset.values.longBreak}
                  </span>
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Durations (minutes)</h3>
            <div className="grid grid-cols-2 gap-3">
              {DURATION_FIELDS.map(({ key, label, hint }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    name={key}
                    type="number"
                    inputMode="numeric"
                    min={DURATION_LIMITS[key].min}
                    max={DURATION_LIMITS[key].max}
                    step={1}
                    value={draft[key]}
                    onChange={handleNumber}
                    aria-invalid={Boolean(errors[key])}
                    aria-describedby={`${key}-hint`}
                    className={cn(errors[key] && 'border-destructive')}
                  />
                  <p id={`${key}-hint`} className={cn('text-xs', errors[key] ? 'text-red-400' : 'text-muted-foreground')}>
                    {errors[key] ?? hint ?? `${DURATION_LIMITS[key].min}–${DURATION_LIMITS[key].max}`}
                  </p>
                </div>
              ))}
            </div>
            {timerIsActive ? (
              <p className="text-xs text-muted-foreground">The current interval keeps its length; new durations apply from the next one.</p>
            ) : null}
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Flow</h3>
            <SettingSwitch id="auto-break" label="Auto-start breaks" checked={draft.autoStartBreaks} onCheckedChange={handleSwitch('autoStartBreaks')} />
            <SettingSwitch id="auto-work" label="Auto-start focus" checked={draft.autoStartWork} onCheckedChange={handleSwitch('autoStartWork')} />
            {supportsWakeLock ? (
              <SettingSwitch
                id="wake-lock"
                label="Keep screen on"
                description="While the timer runs, so alerts fire on time on phones."
                checked={draft.keepScreenAwake}
                onCheckedChange={handleSwitch('keepScreenAwake')}
              />
            ) : null}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Alerts</h3>
            <SettingSwitch id="sound" label="Sound" checked={draft.soundEnabled} onCheckedChange={handleSwitch('soundEnabled')} />
            {supportsVibration ? (
              <SettingSwitch id="vibration" label="Vibration" checked={draft.vibrationEnabled} onCheckedChange={handleSwitch('vibrationEnabled')} />
            ) : null}
            <SettingSwitch id="flash" label="Screen flash" checked={draft.visualAlerts} onCheckedChange={handleSwitch('visualAlerts')} />
            <SettingSwitch
              id="notifications"
              label="Notifications"
              description={notificationHint}
              checked={draft.notificationsEnabled}
              disabled={notificationPermission === 'unsupported' || notificationPermission === 'denied'}
              onCheckedChange={(checked) => void handleNotifications(checked)}
            />
          </section>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SettingSwitchProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function SettingSwitch({ id, label, description, checked, disabled, onCheckedChange }: SettingSwitchProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}
