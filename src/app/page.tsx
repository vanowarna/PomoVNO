import { PomodoroTimer } from '@/components/pomodoro-timer';

export default function Home() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center p-4">
      <PomodoroTimer />
      <div className="absolute bottom-4 text-sm font-code text-white">
        4S6VNO
      </div>
    </main>
  );
}
