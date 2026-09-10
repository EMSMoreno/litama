# ITAM Demo — Setup

This is the Phase 0.5 demo scaffold: a local Electron app + a Chrome extension
that imports Excel rows into it, matching by Workday ID or serial number.
No real AD auth, no real server sync yet — those come after manager approval.

## 1. Desktop app (`itam-app/`)

```bash
cd itam-app
npm install
npm start
```

This launches the Electron window and starts a local API on
`http://localhost:4756` that the browser extension talks to.
Data is stored in `itam-app/itam-demo-data.json` (created on first run —
a plain JSON file, not a real database; fine for demo scale, and it means
there's nothing to compile, so `npm install` should just work with no
native build tools required).

The status bar checkbox ("Simulate online") is a demo-only toggle standing in
for real network detection — flip it off, import from the extension, and
you'll see "Local changes: N" tick up; flip it back on and watch it
briefly show "SYNCHRONIZING" before settling on "Last sync: ...".

## 2. Browser extension (`itam-extension/`)

The extension needs the SheetJS library to parse Excel files, which I
couldn't download in this sandboxed environment (no network access here).
One-time setup:

1. Download `xlsx.full.min.js` from the SheetJS project (the official
   CDN/GitHub release page) and save it as:
   `itam-extension/lib/xlsx.full.min.js`
2. In Chrome: go to `chrome://extensions`, enable Developer Mode, click
   "Load unpacked", and select the `itam-extension/` folder.

## 3. Try the demo flow

1. Start the desktop app (`npm start` in `itam-app/`).
2. Make a test Excel file with columns like: `Workday ID, Name, Project,
   Team Leader, Phone, Serial Number, Asset Type, Site` (headers are
   matched case-insensitively — see `HEADER_MAP` in `popup.js` if your
   real file uses different wording).
3. Click the extension icon, pick the file, hit "Import into ITAM".
4. Watch the app's Users/Assets tables populate within ~2 seconds
   (the renderer polls the local API).
5. Toggle "Simulate online" off in the app, import again, and see the
   offline/pending-changes state; toggle back on to see the sync animation.

## What's deliberately stubbed for the demo

- **Auth**: no AD login screen yet — assume a single logged-in identity.
- **Real sync to a central server**: everything here is local-only; the
  ONLINE/OFFLINE/SYNCHRONIZING states are simulated via the toggle, not
  driven by real network status or a real remote database.
- **AI matching**: header normalization is a static lookup table
  (`HEADER_MAP`), not an actual AI/LLM call. Good enough to demo the
  "instant profile creation" moment; worth revisiting once you're
  past approval and want it to handle genuinely messy/unpredictable
  column names.
- **Near-duplicate serial detection**: a simple edit-distance check
  (catches things like a single mistyped character) — flags them as
  "ambiguous" instead of auto-creating a duplicate asset.
- **Storage**: a JSON file instead of a real database, purely to avoid
  native-compilation setup pain during the demo phase. Worth switching
  to a proper embedded or server database (this is where the "company
  already has a DB" answer from earlier comes in) once you move past
  the demo — a JSON file won't hold up with 12 concurrent IT users.
