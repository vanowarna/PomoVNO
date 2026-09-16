"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  DURATION_LIMITS,
  PRESETS,
  type PomodoroSettings,
  validateSettings,
} from '@/lib/pomodoro';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PomodoroSettings;
  onSave: (settings: PomodoroSettings) => void;
  onApplyPreset: (presetKey: string) => void;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestNotificationPermission: () => Promise<void>;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  onApplyPreset,
  notificationPermission,
  onRequestNotificationPermission,
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<PomodoroSettings>(settings);
  const [errors, setErrors] = useState<Partial<Record<keyof PomodoroSettings, string>>>({});

  useEffect(() => {
    setLocalSettings(settings);
    setErrors({});
  }, [settings, isOpen]);

  const notificationMessage = useMemo(() => {
    if (notificationPermission === 'unsupported') {
      return 'Notifications are not supported in this browser.';
    }
    if (notificationPermission === 'granted') {
      return 'Browser notifications are enabled.';
    }
    if (notificationPermission === 'denied') {
      return 'Notifications are blocked in browser settings.';
    }
    return 'Enable notifications after you save settings.';
  }, [notificationPermission]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocalSettings((prev) => ({
      ...prev,
      [name]: value === '' ? '' : Number(value),
    } as unknown as PomodoroSettings));
  };

  const handleSwitchChange = (name: keyof PomodoroSettings) => (checked: boolean) => {
    setLocalSettings((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleSave = () => {
    const result = validateSettings(localSettings);
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) {
      return;
    }
    onSave(result.settings);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Adjust focus durations and automation preferences.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-1">
          <section className="space-y-3">
            <h3 className="text-base font-semibold">Presets</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant="outline"
                  className="h-auto whitespace-normal py-2 text-left"
                  onClick={() => onApplyPreset(preset.key)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-base font-semibold">Durations (minutes)</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="work">Work</Label>
                <Input
                  id="work"
                  name="work"
                  type="number"
                  min={DURATION_LIMITS.work.min}
                  max={DURATION_LIMITS.work.max}
                  value={localSettings.work}
                  onChange={handleInputChange}
                />
                {errors.work ? <p className="text-xs text-destructive">{errors.work}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="shortBreak">Short break</Label>
                <Input
                  id="shortBreak"
                  name="shortBreak"
                  type="number"
                  min={DURATION_LIMITS.shortBreak.min}
                  max={DURATION_LIMITS.shortBreak.max}
                  value={localSettings.shortBreak}
                  onChange={handleInputChange}
                />
                {errors.shortBreak ? <p className="text-xs text-destructive">{errors.shortBreak}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="longBreak">Long break</Label>
                <Input
                  id="longBreak"
                  name="longBreak"
                  type="number"
                  min={DURATION_LIMITS.longBreak.min}
                  max={DURATION_LIMITS.longBreak.max}
                  value={localSettings.longBreak}
                  onChange={handleInputChange}
                />
                {errors.longBreak ? <p className="text-xs text-destructive">{errors.longBreak}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="longBreakInterval">Long break every</Label>
                <Input
                  id="longBreakInterval"
                  name="longBreakInterval"
                  type="number"
                  min={DURATION_LIMITS.longBreakInterval.min}
                  max={DURATION_LIMITS.longBreakInterval.max}
                  value={localSettings.longBreakInterval}
                  onChange={handleInputChange}
                />
                {errors.longBreakInterval ? (
                  <p className="text-xs text-destructive">{errors.longBreakInterval}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Completed work sessions before a long break.</p>
                )}
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-base font-semibold">Behavior</h3>
            <div className="space-y-3">
              <SettingSwitch
                id="sound-switch"
                label="Sound"
                description="Play a short tone when an interval ends."
                checked={localSettings.soundEnabled}
                onCheckedChange={handleSwitchChange('soundEnabled')}
              />
              <SettingSwitch
                id="visual-alert-switch"
                label="Visual alert"
                description="Show a subtle pulse when an interval ends."
                checked={localSettings.visualAlerts}
                onCheckedChange={handleSwitchChange('visualAlerts')}
              />
              <SettingSwitch
                id="auto-break-switch"
                label="Auto-start breaks"
                description="Automatically start short and long breaks."
                checked={localSettings.autoStartBreaks}
                onCheckedChange={handleSwitchChange('autoStartBreaks')}
              />
              <SettingSwitch
                id="auto-work-switch"
                label="Auto-start work"
                description="Automatically start work after a break ends."
                checked={localSettings.autoStartWork}
                onCheckedChange={handleSwitchChange('autoStartWork')}
              />
              <SettingSwitch
                id="notifications-switch"
                label="Desktop notifications"
                description={notificationMessage}
                checked={localSettings.notificationsEnabled}
                onCheckedChange={handleSwitchChange('notificationsEnabled')}
              />
              {localSettings.notificationsEnabled && notificationPermission !== 'granted' && notificationPermission !== 'unsupported' ? (
                <Button type="button" variant="outline" onClick={onRequestNotificationPermission}>
                  Request notification permission
                </Button>
              ) : null}
            </div>
          </section>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SettingSwitchProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function SettingSwitch({ id, label, description, checked, onCheckedChange }: SettingSwitchProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <div className="pr-4">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
