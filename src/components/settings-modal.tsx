"use client";

import { useState, useEffect, type ChangeEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface Settings {
  work: number;
  shortBreak: number;
  longBreak: number;
  soundEnabled: boolean;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<Settings>(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocalSettings((prev) => ({
      ...prev,
      [name]: Number(value),
    }));
  };

  const handleSoundChange = (checked: boolean) => {
    setLocalSettings((prev) => ({
      ...prev,
      soundEnabled: checked,
    }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Customize your Pomodoro timer. Changes will apply from the next session.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <h3 className="text-lg font-medium">Time (minutes)</h3>
          <div className="grid grid-cols-3 items-center gap-4">
            <div className="space-y-2">
              <Label htmlFor="work">Work</Label>
              <Input
                id="work"
                name="work"
                type="number"
                value={localSettings.work}
                onChange={handleInputChange}
                className="text-center"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortBreak">Short Break</Label>
              <Input
                id="shortBreak"
                name="shortBreak"
                type="number"
                value={localSettings.shortBreak}
                onChange={handleInputChange}
                className="text-center"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="longBreak">Long Break</Label>
              <Input
                id="longBreak"
                name="longBreak"
                type="number"
                value={localSettings.longBreak}
                onChange={handleInputChange}
                className="text-center"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label htmlFor="sound-switch" className="text-base">Sound</Label>
                <p className="text-sm text-muted-foreground">
                    Play a sound at the end of each session.
                </p>
            </div>
            <Switch
              id="sound-switch"
              checked={localSettings.soundEnabled}
              onCheckedChange={handleSoundChange}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
