import { PomodoroTimer } from '@/components/pomodoro-timer';

export default function Home() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center p-4">
      <PomodoroTimer />
    </main>
  );
}
