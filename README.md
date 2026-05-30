# cl-spikeviz

![status](https://img.shields.io/badge/status-live_dashboard-blue) ![type](https://img.shields.io/badge/type-browsers_visualizer-6a5cff) ![license](https://img.shields.io/badge/license-MIT-brightgreen)

**cl-spikeviz** is a lightweight, browser-based visualizer for Cortical Labs `cl-sdk` stream data.

It is designed as a no-framework, no-build-step static web application that can run from any simple file server. The project includes a stable 2D dashboard as the production-safe baseline and an experimental Three.js 3D MEA track.

--- 

## What this project does

`cl-spikeviz` connects to the simulator WebSocket API and streams neural activity in near real time.

It supports:

- **Live mode** from `cl-sdk` simulator endpoints
- **Demo mode** with local synthetic activity generation
- **2D dashboard mode** (default, stable)
- **3D MEA mode** (optional experimental)
- **Split mode** (2D + 3D simultaneously)
- Data diagnostics, export, and debug workflows

---

## Why this project exists

The goal is to provide a practical lab-style viewer for spike/stim workflows:

- quick situational awareness of MEA activity
- immediate access to selected-channel waveforms
- readable activity overlays without sci-fi decoration
- reproducible behavior in browser screenshots and iframe embeds

---

## Core features

### Dashboards and visual views

- **Raster view**: rolling spike/stim activity across channels
- **MEA heatmap**: compressed channel activity over time
- **Waveform view**: latest samples for the selected channel
- **3D MEA array**: 64 electrodes arranged as 8×8 nodes
- **View switching**: `2D`, `3D`, `split`

### State and interaction

- Shared selected channel across all views
- Hover/click sync from 3D to 2D panels
- Pause/resume and buffer reset
- Auto channel mode
- Debug and export actions

### Controls preserved

- host
- port
- window size
- channel
- theme
- pause/resume
- reset
- compact view for iframe embedding

### Optional tools

- `Copy debug`
- `Copy iframe`
- `Export CSV`
- `Export bundle`

---

## Repository layout

This repository root intentionally references the actual app folder:

- [`cl-spikeviz/`](./cl-spikeviz) — application source and assets

Inside `cl-spikeviz/`:

- `index.html` — app shell and controls
- `css/style.css` — dashboard styling and layout
- `js/main.mjs` — app orchestration and view state
- `js/ws.mjs` — WebSocket clients for both streams
- `js/state.mjs` — shared state model
- `js/protocol.mjs` — binary protocol decoding
- `js/raster.mjs`, `js/heatmap.mjs`, `js/waveforms.mjs` — 2D renderers
- `js/three-view.mjs` — optional Three.js MEA renderer
- `js/demo.mjs` — demo event generator
- `tools/run_simulator.py` — simulator bootstrap and install guidance
- `tools/capture_protocol.py` — protocol capture utility
- `test/*.test.mjs` — parser and browser smoke tests
- `vendor/three.module.js` — pinned Three.js bundle for static deployment

---

## Quickstart

### 1) Start web server

```bash
cd cl-spikeviz
python3 -m http.server 8080
```

### 2) Open in browser

- Demo dashboard: `http://127.0.0.1:8080/?demo=1`
- Demo 3D view: `http://127.0.0.1:8080/?demo=1&view=3d`
- Demo split view: `http://127.0.0.1:8080/?demo=1&view=split&compact=1`
- Demo preset with dark theme: `http://127.0.0.1:8080/?demo=1&theme=dark&compact=1`

### 3) Live mode (optional)

Use `tools/run_simulator.py` and keep simulator on port `1025`:

- `ws://127.0.0.1:1025/_/ws/overview`
- `ws://127.0.0.1:1025/_/ws/live_streaming`

Then open:

`http://127.0.0.1:8080/?host=127.0.0.1&port=1025&window=5`

---

## Query parameters

| Parameter | Description | Default |
|---|---|---|
| `host` | Target simulator host | `127.0.0.1` |
| `port` | Target simulator port | `1025` |
| `window` | Raster window in seconds | `5` |
| `channel` | Preselect a channel | first channel |
| `theme` | `dark` or `light` | `dark` |
| `view` | `2d`, `3d`, `split` | `2d` |
| `compact` | Compact layout for embeds (`1` to enable) | `0` |
| `demo` | Synthetic demo stream (`1` to enable) | disabled |
| `pause` | Start in paused mode (`1` to enable) | disabled |

---

## Live and demo mode behavior

### Demo mode

- Requires no Python dependencies.
- Useful for screenshots, CI screenshots, and UI checks.
- No WebSocket dependency.

### Live mode

- Requires a working `cl-sdk` environment.
- Data arrives over both `overview` and `live_streaming` channels.
- State is parsed and propagated to all views from one shared model.

---

## Data flow

1. WebSockets connect to both endpoints.
2. Payloads are parsed by protocol handlers.
3. `js/state.mjs` accumulates activity windows.
4. Views (`2D` and `3D`) consume the same state model.
5. UI controls mutate the same model, so view transitions remain synchronized.

---

## 3D view details

The 3D track is intentionally optional and additive.

- 64 electrodes, 8×8 arrangement
- Channel activity drives height, glow, color intensity
- Spike/stim events create short-lived pulse visuals
- Selected channel is highlighted with a clear visual ring/outline
- Hover and click interact with shared selected channel state
- WebGL unavailable fallback message is shown instead of failing silently
- Resize is handled explicitly
- Pause freezes last visible state

---

## Embedding

Use these URLs directly, or copy generated iframe snippets from the app.

```html
<iframe
  src="https://your-host/cl-spikeviz/?host=127.0.0.1&port=1025&compact=1&view=split"
  width="100%"
  height="720"
  title="cl-spikeviz"
  style="border:0">
</iframe>
```

For constrained containers, add `compact=1` and reduce height.

---

## Local simulator setup

For reproducible local simulation:

```bash
cd cl-spikeviz
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python cl-sdk
.venv/bin/python tools/run_simulator.py --seconds 300
```

If `cl-sdk` is not available in your Python environment, the simulator helper prints a clear installation message and exits safely.

---

## Development and debugging

- Shared state is intentionally centralized to keep 2D and 3D coherent.
- 3D is lazy-loaded when needed (`view=3d` / `view=split`) and does not replace the 2D MVP.
- Export and copy tools are designed for quick issue reproduction and support workflows.

### Debug/export actions

- **Copy debug**: compact state snapshot (endpoint status, selected channel, FPS, totals)
- **Copy iframe**: embed snippet for the current state
- **Export CSV**: latest event window export
- **Export bundle**: JSON payload with diagnostics and current buffer summary

---

## Commands

```bash
# install test dependencies
npm install

# parser + UI smoke checks
npm test
npm run test:parse
npm run test:ui
```

If Playwright needs a browser runtime:

```bash
npx playwright install chromium
```

Capture fixtures from a live run:

```bash
python3 tools/capture_protocol.py --seconds 5 --out test/fixtures
```

---

## Troubleshooting

- **`ModuleNotFoundError: No module named 'cl'`**
  - install `cl-sdk` into the same interpreter used for `tools/run_simulator.py`.
- **Only one WebSocket is connected**
  - verify simulator process is healthy and both endpoints are available.
- **No spikes while connected**
  - wait for warm-up or inspect subscription/stream timing.
- **3D panel looks empty**
  - check browser WebGL support and console output.
- **UI overflows in embed**
  - enable `compact=1`.

---

## Known limitations and roadmap direction

- 3D mode is experimental and intentionally additive.
- Design direction is dashboard-first, not decorative.
- Future work should preserve parser, controls, and endpoint behavior while improving styling and interaction polish.

---

## License

MIT
