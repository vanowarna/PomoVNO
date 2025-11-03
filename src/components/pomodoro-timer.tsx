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
import { cn } from '@/lib/utils';

type Mode = 'work' | 'shortBreak' | 'longBreak';

const formatTime = (time: number, showMilliseconds: boolean): string => {
  const totalSeconds = Math.floor(time / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const ms = Math.floor(time % 1000);

  if (showMilliseconds) {
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export function PomodoroTimer() {
  const [settings, setSettings] = useState<Settings>({
    work: 25,
    shortBreak: 5,
    longBreak: 15,
    soundEnabled: true,
    showMilliseconds: false,
  });
  const [mode, setMode] = useState<Mode>('work');
  const [timeLeft, setTimeLeft] = useState(settings.work * 60 * 1000);
  const [isActive, setIsActive] = useState(false);
  const [sessions, setSessions] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const synth = useRef<Tone.Synth | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const nextModeRef = useRef<Mode | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const startAudio = async () => {
        await Tone.start();
        synth.current = new Tone.Synth().toDestination();
      };
      startAudio();

      const onFullScreenChange = () => {
        setIsFullScreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', onFullScreenChange);
      
      return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
    }
  }, []);

  const playNotification = useCallback(() => {
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 2000); 

    if (settings.soundEnabled && synth.current && Tone.context.state === 'running') {
      synth.current.triggerAttackRelease('C5', '0.5s');
    }
  }, [settings.soundEnabled]);

  const resetTimer = useCallback((newMode: Mode, newSettings?: Settings) => {
    const currentSettings = newSettings || settings;
    let newTime;
    switch (newMode) {
      case 'work':
        newTime = currentSettings.work * 60 * 1000;
        break;
      case 'shortBreak':
        newTime = currentSettings.shortBreak * 60 * 1000;
        break;
      case 'longBreak':
        newTime = currentSettings.longBreak * 60 * 1000;
        break;
    }
    setMode(newMode);
    setTimeLeft(newTime);
  }, [settings]);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setIsActive(false);
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const interval = settings.showMilliseconds ? 10 : 1000;
    const startTime = Date.now();
    const endTime = startTime + timeLeft;

    timerIntervalRef.current = setInterval(() => {
      const newTimeLeft = endTime - Date.now();

      if (newTimeLeft <= 0) {
        setTimeLeft(0);
        playNotification();
        stopTimer();

        if (mode === 'work') {
          const newSessions = sessions + 1;
          setSessions(newSessions);
          nextModeRef.current = newSessions % 4 === 0 ? 'longBreak' : 'shortBreak';
        } else {
          if (mode === 'longBreak') {
            setSessions(0);
          }
          nextModeRef.current = 'work';
        }
      } else {
        setTimeLeft(newTimeLeft);
      }
    }, interval);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isActive, timeLeft, mode, sessions, settings, playNotification, stopTimer]);

  useEffect(() => {
    if (timeLeft === 0 && nextModeRef.current) {
      resetTimer(nextModeRef.current);
      nextModeRef.current = null;
    }
  }, [timeLeft, resetTimer]);

  useEffect(() => {
    if(timeLeft > 0 && timeLeft < (settings[mode] * 60 * 1000)) {
        if(mode !== 'work' || sessions > 0){
            setIsActive(true);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, mode]);

  useEffect(() => {
    stopTimer();
    resetTimer(mode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  
  const handleModeChange = (newMode: Mode) => {
    if(mode === newMode) return;
    stopTimer();
    setSessions(0); // Reset sessions if user manually changes mode
    resetTimer(newMode);
  }
  
  const toggleActive = () => {
    if (Tone.context.state !== 'running') {
        Tone.start();
    }
    setIsActive(!isActive);
  };

  const manualReset = () => {
    stopTimer();
    setSessions(0);
    resetTimer(mode);
  }

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    setIsSettingsOpen(false);
    stopTimer();
    resetTimer(mode, newSettings);
  };

  const toggleFullScreen = async () => {
    try {
      if (!isFullScreen) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen API error:", err);
    }
  };

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
          <h1 className={cn(
            "font-black tabular-nums",
            settings.showMilliseconds ? "text-7xl sm:text-8xl" : "text-8xl sm:text-9xl"
          )}>
            {formatTime(timeLeft, settings.showMilliseconds)}
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
