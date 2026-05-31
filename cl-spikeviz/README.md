# cl-spikeviz

`cl-spikeviz` is a standalone browser visualizer for Cortical Labs `cl-sdk` simulator streams.

It is intentionally small:

- static HTML/CSS/JavaScript modules
- no framework
- no build pipeline
- vendored Three.js for the optional 3D view
- local static hosting and GitHub Pages friendly

This v0.1 simulator preview is for reviewing stream handling, parser assumptions, and the browser UI around the `cl-sdk` simulator WebSocket output. It does not require CL1 hardware and does not claim support for hardware-only behavior.

## Reviewer Path

1. Run the browser demo:

   ```bash
   npm install
   python3 -m http.server 8080
   ```

   Open `http://127.0.0.1:8080/?demo=1`.

2. Run checks:

   ```bash
   npm test
   npm run test:ui
   ```

3. Review protocol notes:

   - [docs/STREAM_PROTOCOL.md](docs/STREAM_PROTOCOL.md)
   - [docs/LIMITATIONS.md](docs/LIMITATIONS.md)

4. Optional live simulator check:

   ```bash
   uv venv --python 3.12 .venv
   uv pip install --python .venv/bin/python cl-sdk websockets
   .venv/bin/python tools/run_simulator.py --seconds 300
   ```

   In a second terminal:

   ```bash
   python3 -m http.server 8080
   ```

   Open `http://127.0.0.1:8080/?host=127.0.0.1&port=1025`.

## Modes

### Demo Mode

Demo mode uses deterministic browser-generated sample activity. It is useful for UI review, screenshots, and smoke testing without Python or `cl-sdk`.

```text
http://127.0.0.1:8080/?demo=1
http://127.0.0.1:8080/?demo=1&view=3d
http://127.0.0.1:8080/?demo=1&view=split&compact=1
```

### Live Simulator Mode

Live mode connects to a running `cl-sdk` simulator WebSocket server.

The app currently consumes:

- `ws://<host>:<port>/_/ws/overview`
- `ws://<host>:<port>/_/ws/live_streaming`

Public `cl-sdk` documentation describes enabling the simulator WebSocket server with `CL_SDK_WEBSOCKET=1` and configuring host/port with `CL_SDK_WEBSOCKET_HOST` and `CL_SDK_WEBSOCKET_PORT`. The endpoint paths and binary framing are verified against `cl-sdk` 0.29.0 live simulator capture plus committed fixtures; see [docs/STREAM_PROTOCOL.md](docs/STREAM_PROTOCOL.md).

## What It Shows

- rolling spike/stim raster
- per-channel activity heatmap from overview chunks
- selected-channel waveform samples from `cl_spikes`
- optional 3D MEA grid view driven by the same parsed stream
- debug export, CSV export, iframe snippet, and connection health labels

The default view is the 2D dashboard. The 3D and split views are preview surfaces for review, not a replacement for the 2D path.

## Local Run

```bash
cd cl-spikeviz
npm install
python3 -m http.server 8080
```

Then open one of:

- Demo: `http://127.0.0.1:8080/?demo=1`
- Live simulator: `http://127.0.0.1:8080/?host=127.0.0.1&port=1025`

## Simulator Run

`tools/run_simulator.py` sets the WebSocket environment variables before calling `cl.open()`:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python cl-sdk websockets
.venv/bin/python tools/run_simulator.py --host 127.0.0.1 --port 1025 --seconds 300
```

Equivalent environment variables:

```bash
CL_SDK_WEBSOCKET=1
CL_SDK_WEBSOCKET_HOST=127.0.0.1
CL_SDK_WEBSOCKET_PORT=1025
```

## URL Parameters

- `host` default `127.0.0.1`
- `port` default `1025`
- `window` rolling raster window in seconds, 1-10
- `channel` initial selected channel
- `theme=dark` or `theme=light`
- `view=2d`, `view=3d`, or `view=split`
- `compact=1` for iframe or narrow layouts
- `demo=1` for deterministic browser demo data. Without `demo=1`, the app attempts live WebSocket mode.
- `pause=1` to start paused

## Repository Layout

- `index.html` - app shell, controls, and view containers
- `css/style.css` - layout and visual styling
- `js/app.mjs` - app orchestration, mode switching, and view switching
- `js/ws.mjs` - `cl-sdk` WebSocket client
- `js/protocol.mjs` - binary parser for overview, spikes, and stims
- `js/demo.mjs` - deterministic demo stream
- `js/raster.mjs`, `js/heatmap.mjs`, `js/waveforms.mjs` - 2D renderers
- `js/iso3d.mjs` - optional 3D renderer
- `tools/run_simulator.py` - local simulator launcher
- `tools/capture_protocol.py` - fixture capture utility
- `test/fixtures/` - captured simulator headers and binary payloads
- `docs/` - protocol, limitation, and deployment notes

## Testing

```bash
npm test
npm run test:parse
npm run test:ui
npm run test:stress -- --minutes=10
```

Install Playwright Chromium if needed:

```bash
npx playwright install chromium
```

## Capturing Protocol Fixtures

Start the simulator, then run:

```bash
python3 tools/capture_protocol.py --seconds 5 --out test/fixtures
```

The parser tests read `test/fixtures/overview.json`, `test/fixtures/live_streaming.json`, and referenced `.bin` payloads. Commit refreshed fixtures only when they come from a known `cl-sdk` simulator version and the docs are updated with what changed. For ad-hoc verification, capture to a temporary directory such as `/tmp/spikeviz-recapture` and do not commit those files.

## GitHub Pages

The app is static and can be served directly from this app directory as the web root. See [docs/GITHUB_PAGES.md](docs/GITHUB_PAGES.md) for deployment notes and live-mode caveats.

## Limitations

The preview is scoped to `cl-sdk` simulator streams. Unsupported protocol cases, fixture caveats, and browser security constraints are listed in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## License

MIT
