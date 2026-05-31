# Changelog

## 2026-05-31 recording replay refresh

- Added compact JSON recording replay for browser-only review without Python or a running simulator.
- Added a committed sample recording at `assets/sample-recording.json`.
- Added fixture and live-capture export paths for replay snapshots.
- Updated README preview GIF/JPG assets from the running app after a 10-second simulator stream warmup.
- Added `npm run capture:assets:live` for simulator-backed media regeneration.
- Added `npm run capture:assets` for reproducible README media regeneration.
- Fixed initial view-tab state so direct `?view=3d` and `?view=split` URLs highlight the correct active tab.
- Added UI smoke coverage for recording reset after playback end and direct view-tab state.

## v0.1.0-simulator-preview

- Positioned the project as a no-framework browser visualizer for `cl-sdk` simulator streams.
- Documented demo and live simulator reviewer paths.
- Added stream protocol notes for the source-observed `/_/ws/overview` and `/_/ws/live_streaming` endpoints.
- Verified overview and `cl_spikes` framing against a live `cl-sdk` 0.29.0 simulator recapture.
- Recorded parser assumptions, unsupported message types, and fixture capture workflow.
- Added limitations and GitHub Pages deployment notes.
- Kept the 2D dashboard as the default view and left UI redesign out of this pass.
