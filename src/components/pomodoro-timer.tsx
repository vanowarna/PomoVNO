"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Tone from 'tone';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsModal, type Settings } from '@/components/settings-modal';
import {
  Play,
  Pause,
  RotateCcw,
  Settings as SettingsIcon,
  Expand,
  Shrink,
} from 'lucide-react';

type Mode = 'work' | 'shortBreak' | 'longBreak';

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export function PomodoroTimer() {
  const [settings, setSettings] = useState<Settings>({
    work: 25,
    shortBreak: 5,
    longBreak: 15,
    soundEnabled: true,
  });
  const [mode, setMode] = useState<Mode>('work');
  const [timeLeft, setTimeLeft] = useState(settings.work * 60);
  const [isActive, setIsActive] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const synth = useRef<Tone.Synth | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synth.current = new Tone.Synth().toDestination();

      const onFullScreenChange = () => {
        setIsFullScreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', onFullScreenChange);
      
      return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
    }
  }, []);

  const playNotification = useCallback(() => {
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 1000); // 5 flashes * 0.2s duration

    if (settings.soundEnabled && synth.current) {
      synth.current.triggerAttackRelease('C5', '0.5s');
    }
  }, [settings.soundEnabled]);
  
  const resetTimer = useCallback((newMode: Mode) => {
    switch (newMode) {
      case 'work':
        setTimeLeft(settings.work * 60);
        break;
      case 'shortBreak':
        setTimeLeft(settings.shortBreak * 60);
        break;
      case 'longBreak':
        setTimeLeft(settings.longBreak * 60);
        break;
    }
  }, [settings]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      playNotification();
      let nextMode: Mode = 'work';
      if (mode === 'work') {
        const newSessions = sessions + 1;
        setSessions(newSessions);
        nextMode = newSessions % 4 === 0 ? 'longBreak' : 'shortBreak';
      } else {
        nextMode = 'work';
      }
      setMode(nextMode);
      resetTimer(nextMode);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, timeLeft, mode, sessions, playNotification, resetTimer]);
  
  const handleModeChange = (newMode: Mode) => {
    if(mode === newMode) return;
    setMode(newMode);
    resetTimer(newMode);
    setIsActive(false);
  }

  useEffect(() => {
    resetTimer(mode);
    setIsActive(false);
  }, [settings, resetTimer, mode]);
  
  const toggleActive = () => {
    if (timeLeft === 0) return;
    setIsActive(!isActive);
  };

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    setIsSettingsOpen(false);
  };

  const toggleFullScreen = () => {
    if (!isFullScreen) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const manualReset = () => {
    setIsActive(false);
    resetTimer(mode);
  }

  return (
    <>
      {isFlashing && (
        <div className="pointer-events-none fixed inset-0 z-[100] bg-white flash-overlay-animation" />
      )}
      <div className="absolute top-6 right-6 flex items-center gap-2">
        <Button onClick={() => setIsSettingsOpen(true)} variant="ghost" size="icon" aria-label="Settings">
          <SettingsIcon className="h-6 w-6" />
        </Button>
        <Button onClick={toggleFullScreen} variant="ghost" size="icon" aria-label="Toggle Fullscreen">
          {isFullScreen ? <Shrink className="h-6 w-6" /> : <Expand className="h-6 w-6" />}
        </Button>
      </div>
      <div className="flex flex-col items-center">
        <Tabs value={mode} className="w-[280px] sm:w-[400px]">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="work" onClick={() => handleModeChange('work')}>Work</TabsTrigger>
            <TabsTrigger value="shortBreak" onClick={() => handleModeChange('shortBreak')}>Short Break</TabsTrigger>
            <TabsTrigger value="longBreak" onClick={() => handleModeChange('longBreak')}>Long Break</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="my-10 text-center">
          <h1 className="text-8xl font-black tabular-nums sm:text-9xl">
            {formatTime(timeLeft)}
          </h1>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Button
            onClick={toggleActive}
            size="lg"
            className="w-36 h-16 text-2xl rounded-2xl"
          >
            {isActive ? <Pause size={28} /> : <Play size={28} />}
            <span className="ml-2">{isActive ? 'Pause' : 'Start'}</span>
          </Button>
          <Button onClick={manualReset} variant="secondary" size="lg" className="h-16 w-16 rounded-2xl" aria-label="Reset Timer">
            <RotateCcw size={28} />
          </Button>
        </div>
      </div>
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </>
  );
}
