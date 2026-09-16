import { PomodoroTimer } from '@/components/pomodoro-timer';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <PomodoroTimer />
      <div className="mt-6 text-center text-xs font-code tracking-widest text-white/80">4S6VNO</div>
    </main>
  );
}
