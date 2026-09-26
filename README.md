# PomoVNO

A minimal, free and open source Pomodoro timer. It installs as an app on any phone or desktop and works fully offline.

No accounts, no tracking, no network calls. Everything is stored on your device.

## Features

- **Offline-first PWA.** After one visit with a connection, the app opens instantly with no network, including in airplane mode.
- **Accurate timer.** Time is based on the wall clock, not on counting ticks, so it stays correct when the phone sleeps, the tab is throttled, or the app is closed. When you come back, any intervals that finished while you were away are recorded and the cycle picks up where it should be.
- Focus / short break / long break cycle, with progress dots and a progress bar.
- Presets: Classic 25/5/15, Extended 50/10/20, Deep Work 90/20/30, or custom durations.
- Auto-start breaks and/or focus sessions.
- Alerts: chime, vibration (Android), screen flash, and system notifications. On mobile, notifications go through the service worker.
- **Keep screen on** while the timer runs (Screen Wake Lock), so alerts fire on time on phones.
- Today and last-7-days focus summary (local calendar days).
- Keyboard shortcuts: `Space` start/pause · `R` reset (press twice to reset the cycle) · `S` skip · `+` add a minute · `1 2 3` modes · `F` fullscreen · `?` help.
- Tabs stay in sync, the remaining time shows in the title bar, and it respects reduced motion.

## Install on your phone

**Android (Chrome, Edge, Samsung Internet):** open the site, tap **Install** in the app (or browser menu → *Install app*).

**iPhone / iPad (Safari):** open the site, tap **Share → Add to Home Screen**. On iOS, notifications need iOS 16.4+ and only work in the installed app.

Open it once while online. After that it works offline. New versions download in the background, and the app offers a **Reload** when one is ready.

### Limits of the web platform

When a phone is locked or the app is in the background, the OS suspends web apps, so an alert can't sound at the exact second. The timer itself stays correct: reopening the app shows the right time and records the finished sessions. For on-time alerts, keep **Keep screen on** enabled (the default) and leave the app open.

## Development

Requires Node.js 22.18+.

```bash
npm install
npm run dev        # http://localhost:9002 (service worker disabled in dev)
```

```bash
npm test           # unit tests for the timer logic (node:test)
npm run typecheck
npm run lint
npm run build && npm start   # production build, service worker enabled
npm run check      # all of the above
```

### Project layout

| Path | Purpose |
| --- | --- |
| `src/lib/pomodoro.ts` | Pure timer / cycle / history logic (unit tested) |
| `src/lib/browser.ts` | Safe wrappers for storage, audio, vibration, notifications |
| `src/components/pomodoro-timer.tsx` | Main UI |
| `src/components/settings-modal.tsx` | Settings dialog |
| `public/sw.js` | Service worker (offline app shell, caching, notification clicks) |
| `public/manifest.webmanifest` | PWA manifest |

### Verify offline support

1. `npm run build && npm start`, then open `http://localhost:3000`.
2. DevTools → Application → Service Workers: `/sw.js` is activated. Cache Storage → `pomovno-shell-*` contains `/` plus its JS/CSS.
3. Network tab → **Offline**, then reload. The app loads and the timer works.

## License

[MIT](LICENSE). Free to use, modify and share.

`4S6VNO`
