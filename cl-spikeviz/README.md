# cl-spikeviz

Standalone browser visualizer for Cortical Labs `cl-sdk` simulator streams.

The project is intentionally lightweight:

- static HTML/CSS and vanilla JS ES modules
- no framework, no build step
- no required CDN in production
- live mode via WebSocket and optional demo mode
- optional WebGL/Three.js 3D track

## What it includes

- Core 2D dashboard (MVP kept intact):
  - raster plot
  - MEA activity heatmap
  - waveform viewer
- Experimental 3D track:
  - 64-channel 8×8 microelectrode array
  - activity-driven height and color
  - short pulse/ripple animation for spikes and events
  - selected channel highlight
  - hover/click channel sync with 2D views
- Existing controls preserved:
  - host / port / window / channel / theme
  - pause / resume, reset
  - auto-select active channel
  - demo mode (`?demo=1`)
  - compact embed mode (`?compact=1`)
  - copy debug info
  - export CSV / export debug bundle

## Project structure (important files)

- `index.html` — layout, controls, status bar, view tabs
- `css/style.css` — dashboard + 3D visual theme
- `js/main.mjs` — orchestration and view switching
- `js/ws.mjs` — WebSocket clients for live stream and overview
- `js/state.mjs` — shared app state
- `js/raster.mjs`, `js/heatmap.mjs`, `js/waveforms.mjs` — 2D views
- `js/three-view.mjs` — optional Three.js 3D MEA view
- `js/protocol.mjs` — binary protocol parser
- `js/demo.mjs` — local synthetic demo event generator
- `tools/run_simulator.py` — start local simulator stream helper
- `tools/capture_protocol.py` — capture binary protocol payloads for fixtures
- `test/*.test.mjs` — parser and browser smoke coverage
- `vendor/three.module.js` — local pinned Three.js module

## Run the app

```bash
cd cl-spikeviz
python3 -m http.server 8080
```

Open in browser:

- default dashboard (live): `http://127.0.0.1:8080/?host=127.0.0.1&port=1025&window=5`
- demo mode: `http://127.0.0.1:8080/?demo=1`
- 3D mode: `http://127.0.0.1:8080/?demo=1&view=3d`
- split view: `http://127.0.0.1:8080/?demo=1&view=split&compact=1`

WebSocket endpoints:

- `ws://127.0.0.1:1025/_/ws/overview`
- `ws://127.0.0.1:1025/_/ws/live_streaming`

## Live simulator (Python)

Recommended setup uses Python 3.12+:

```bash
cd cl-spikeviz
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python cl-sdk
.venv/bin/python tools/run_simulator.py --seconds 300
```

If `cl` is unavailable, `tools/run_simulator.py` now returns a clear install note instead of a stack trace.

## URL parameters

- `host` (default `127.0.0.1`)
- `port` (default `1025`)
- `window` (1–10 seconds, default `5`)
- `channel` (preset selected channel)
- `theme=dark` or `theme=light`
- `view=2d` (default), `view=3d`, `view=split`
- `demo=1`
- `compact=1`
- `pause=1`

## 3D view behavior

- works as an optional mode and does not replace the 2D dashboard
- uses the same shared state as 2D views
- respects pause and freezes visual state when paused
- handles resize
- shows fallback text if WebGL is unavailable
- designed for readability in dashboard, split, and compact layouts

## Embeds

The app has iframe helpers and compact mode for embed usage.

```html
<iframe
  src="https://your-host/cl-spikeviz/?host=127.0.0.1&port=1025&compact=1&view=split"
  width="100%"
  height="720"
  title="cl-spikeviz">
</iframe>
```

## Exports and diagnostics

- `Copy debug` — copies current URL, mode, endpoint state, FPS, channel and totals
- `Export CSV` — exports rolling events in CSV
- `Export debug bundle` — exports snapshot JSON for troubleshooting

## Testing

Install once:

```bash
npm install
```

Run tests:

```bash
npm test
npm run test:parse
npm run test:ui
```

Playwright Chromium install (если нужно):

```bash
npx playwright install chromium
```

Capture protocol fixtures from a live run:

```bash
python3 tools/capture_protocol.py --seconds 5 --out test/fixtures
```

## Troubleshooting

- `ModuleNotFoundError: No module named 'cl'` -> install `cl-sdk` in the same interpreter used for simulator.
- `overview` or `live_streaming` not connected -> check simulator process and socket availability on port `1025`.
- `overview connected` but no heatmap movement -> check `/ _/ws/overview` and endpoint health.
- `live_streaming connected` but no spikes yet -> wait few seconds or try demo mode to confirm UI path.
- 3D blank scene -> check browser WebGL and fallback behavior.
- Embeds look cramped -> use `?compact=1`.

## License

MIT
