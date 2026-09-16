# PomoVNO

PomoVNO is a minimal, installable, offline-first Pomodoro web app for desktop and mobile.

## Features

- Installable PWA (Android/Chrome + desktop Chromium; iOS Add to Home Screen)
- Offline app shell and local timer state after first successful online load
- Timestamp-based timer recovery across refresh/background throttling
- MM:SS timer display (no milliseconds)
- Work / short break / long break modes with cycle progress
- Presets: Classic 25/5/15, Extended 50/10/20, Deep Work 90/20/30
- Auto-start breaks and auto-start work options
- Skip interval and add +1 minute controls
- Keyboard shortcuts: Space, R, S, F, 1/2/3
- Local-only focus label and daily/weekly focus summary
- Optional sound, visual alerts, and browser notifications

## Development

```bash
npm install
npm run dev
```

App runs at `http://localhost:9002`.

## Production checks

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

## Install as PWA

### Android / Chrome / Desktop Chromium
1. Open the deployed app once while online.
2. Use browser install UI (or in-app install prompt).
3. Launch from home screen/app launcher.

### iOS / Safari
1. Open the deployed app in Safari while online.
2. Tap **Share** → **Add to Home Screen**.
3. Launch from the home screen icon.

## Offline behavior

- First load requires internet to cache app shell assets.
- After successful load/install, the timer UI and local state can run offline.
- Service worker caches shell/static assets and serves an offline fallback page when navigation cannot be fulfilled.
- Browser notifications/background behavior may vary by browser and OS policy.

## Verify service worker

1. Open browser devtools → Application (or Storage) → Service Workers.
2. Confirm `/sw.js` is registered and activated.
3. Load once online, then switch to offline mode in devtools.
4. Refresh and confirm app/offline fallback still renders.

`4S6VNO`
