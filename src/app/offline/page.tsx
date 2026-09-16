export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        PomoVNO can still run offline after the first successful visit. Reconnect once to refresh assets.
      </p>
    </main>
  );
}
