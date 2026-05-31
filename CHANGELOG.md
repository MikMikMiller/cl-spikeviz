# Changelog

## 2026-05-31 sample replay and channel UX fix

- Extended the committed sample recording preview from a 61 ms fixture burst to a 30-second demo-like review window.
- Increased sample density and channel spread so Electrode Grid replay reads closer to the continuous demo stream.
- Made **Connect** leave sample replay and return to the previous demo/live stream instead of restarting the same recording.
- Enabled automatic active-channel selection by default and synced the selected-channel input to the current active channel.
- Added a grid replay regression test so **Load sample** does not immediately land on `recording ended`.
- Documented the preview expansion flags for regenerating `assets/sample-recording.json`.

## 2026-05-31 release media refresh

- Switched the default paper theme to a neutral lab-paper background so README media does not read as pink on GitHub.
- Added animated Electrode Grid preview media to the README asset set.
- Regenerated dashboard, Electrode Grid, 3D, and split preview GIF/JPG files from the running app.
- Updated capture automation so README GIFs include live stream motion plus channel-selection changes.
- Refreshed GitHub repository metadata for the simulator-stream visualizer positioning.

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
