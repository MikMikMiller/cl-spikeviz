# cl-spikeviz

**cl-spikeviz** is a standalone browser visualizer for Cortical Labs `cl-sdk` Neural data streams.

The project is intentionally minimal from an infrastructure perspective:

- static HTML/CSS/JavaScript (ES modules)
- no framework
- no build pipeline
- no runtime CDN dependency (Three.js is vendored)
- local/static deployment ready

It supports both live mode from `cl-sdk` WebSocket endpoints and an internal demo mode.

---

## Project purpose

The primary goal is to provide a practical lab-style instrument-style dashboard for MEA activity:

- fast understanding of channel activity
- reliable channel-level inspection
- waveform and heatmap context in one UI
- optional 3D spatial view without breaking the existing 2D experience

The 2D dashboard remains the default and stable baseline.

---

## Core capabilities

### Live and synthetic data sources

- **Live mode**: streams from `cl-sdk` simulator WebSockets
- **Demo mode**: browser-generated synthetic stream for offline demonstration

### 2D visualization stack

- Raster view of spike/stim activity
- MEA activity heatmap
- Waveform viewer for selected channel

### 3D visualization stack (experimental)

- Optional 3D MEA scene with 64 electrodes in an 8×8 grid
- Real-time activity-driven visual changes:
  - pillar height
  - intensity and glow
  - spike/stim pulse cues
- Selected channel highlight
- Shared interaction and selection state with 2D views

### Dashboard controls and operations

- host, port, window, channel, theme
- pause/resume and reset
- auto-select active channel
- compact mode (`?compact=1`) for small containers
- copy debug / copy iframe
- export CSV and debug bundle

---

## Folder structure

`cl-spikeviz` is fully self-contained under this directory:

- `index.html` — app shell, controls, and view containers
- `css/style.css` — layout and visual styling
- `js/main.mjs` — app orchestration and view mode switching
- `js/state.mjs` — shared application state
- `js/ws.mjs` — WebSocket client handling and reconnect behavior
- `js/protocol.mjs` — binary parser for `live_streaming`
- `js/raster.mjs` — raster renderer
- `js/heatmap.mjs` — heatmap renderer
- `js/waveforms.mjs` — selected-channel waveform rendering
- `js/three-view.mjs` — optional 3D renderer using Three.js
- `js/demo.mjs` — deterministic demo data generator
- `js/canvas.mjs` — canvas helper routines
- `tools/run_simulator.py` — local simulator launcher and diagnostics
- `tools/capture_protocol.py` — protocol capture utility
- `test/` — parser and browser smoke tests
- `vendor/three.module.js` — local Three.js module

---

## Quickstart (2-minute path)

```bash
cd cl-spikeviz
python3 -m http.server 8080
```

Open in browser:

- Demo dashboard: `http://127.0.0.1:8080/?demo=1`
- Demo 3D: `http://127.0.0.1:8080/?demo=1&view=3d`
- Demo split: `http://127.0.0.1:8080/?demo=1&view=split&compact=1`

For live mode, assuming simulator is running on port 1025:

- `http://127.0.0.1:8080/?host=127.0.0.1&port=1025&window=5`

WebSocket endpoints consumed by the app:

- `ws://127.0.0.1:1025/_/ws/overview`
- `ws://127.0.0.1:1025/_/ws/live_streaming`

---

## Live setup (`cl-sdk`)

Recommended environment:

```bash
cd cl-spikeviz
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python cl-sdk
.venv/bin/python tools/run_simulator.py --seconds 300
```

If `cl` is missing, `tools/run_simulator.py` now fails with a clear message and install guidance.

---

## URL parameters

- `host` (default `127.0.0.1`)
- `port` (default `1025`)
- `window` (raster window in seconds)
- `channel` (preset channel number)
- `theme=dark` or `theme=light`
- `view=2d` (default), `view=3d`, `view=split`
- `compact=1` (compact layout)
- `demo=1` (use synthetic stream)
- `pause=1` (start paused)

---

## Data model and rendering behavior

- `overview` stream updates per-channel activity and flags used by heatmap and diagnostics.
- `live_streaming` stream provides spike/stim events and sample payloads.
- All renderers share one state container so channel selection and event timing stay consistent.
- Pause mode freezes the visible state rather than stopping socket updates inconsistently.
- 3D renderer is lazy-loaded only when needed and has explicit resize handling.
- WebGL fallback text is shown when hardware/WebGL is unavailable.

---

## Mode definitions

### 2D dashboard (default)

Stable, compact, lab-style view intended for routine monitoring and screenshots.

### 3D array view

Exploratory spatial view:

- 64-channel 3D electrode surface
- active channels encode through size/intensity
- transient pulse visuals on events
- selection highlight and interaction feedback

### Split view

Best for side-by-side comparison during validation and design reviews.

---

## Exports and diagnostics

Built-in actions:

- **Copy debug** — endpoint status, selected channel, fps, counters, and current URL
- **Copy iframe** — embeddable snippet for the current state
- **Export CSV** — event window export
- **Export bundle** — structured debug snapshot

---

## Testing and maintenance

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm test
npm run test:parse
npm run test:ui
npm run test:stress -- --minutes=60 --interval=1000
```

Stress profile (long-run headless demo):

```bash
# 10 minutes
npm run test:stress -- --minutes=10

# 20 minutes
npm run test:stress -- --minutes=20
```

Install browser runtime if needed for UI tests:

```bash
npx playwright install chromium
```

Capture protocol fixtures:

```bash
python3 tools/capture_protocol.py --seconds 5 --out test/fixtures
```

---

## Embedding

A compact embed usage pattern:

```html
<iframe
  src="https://your-host/cl-spikeviz/?host=127.0.0.1&port=1025&compact=1&view=split"
  width="100%"
  height="720"
  title="cl-spikeviz"
  frameborder="0">
</iframe>
```

Use `compact=1` for narrow dashboards and iFrame contexts.

---

## Troubleshooting

- **`ModuleNotFoundError: No module named 'cl'`**
  - Install `cl-sdk` in the interpreter used to run `tools/run_simulator.py`.
- **Only one socket is connected**
  - Wait for simulator warm-up or restart and check port availability.
- **No visible spikes**
  - Validate stream subscription timing and inspect `live_streaming` status.
- **3D canvas blank**
  - Check WebGL support; fallback text should appear if rendering is unavailable.
- **UI overflows in embed**
  - Enable `compact=1`.

---

## Contributing and iteration notes

- Keep parser and endpoint behavior stable.
- Preserve the 2D dashboard as the default user path.
- Treat 3D as an optional experimental track.
- Any visual redesign should remain readable and operationally meaningful.

---

## License

MIT
