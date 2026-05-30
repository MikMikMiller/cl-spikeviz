# Stream Protocol Notes

`cl-spikeviz` consumes the browser-facing WebSocket streams exposed by the `cl-sdk` simulator. This document records what the app currently uses, what was verified, and which parts remain assumptions rather than a stable public contract.

## Verification Sources

Checked on 2026-05-31:

- Public docs: `docs.corticallabs.com` and the `cl-sdk` README document enabling the simulator WebSocket server with `CL_SDK_WEBSOCKET=1`, `CL_SDK_WEBSOCKET_HOST`, and `CL_SDK_WEBSOCKET_PORT`.
- Public source: `Cortical-Labs/cl-sdk` commit `fea6277edd3169bdad4a46f0e1eadab3729058e7`.
- Local fixtures: `test/fixtures/overview.json`, `test/fixtures/live_streaming.json`, and referenced `.bin` payloads captured from a `cl-sdk` simulator run.

The public docs do not describe the `/_/ws/overview` and `/_/ws/live_streaming` payload layouts. Those endpoint paths and frame formats are source-observed from `src/cl/visualisation/_websocket_subprocess.py`, `src/cl/visualisation/web/analysis.mjs`, `src/cl/visualisation/web/engine.mjs`, and `src/cl/visualisation/_http_server.py`.

## WebSocket Setup

The simulator WebSocket server is disabled by default in `cl-sdk`. Enable it before `cl.open()`:

```bash
CL_SDK_WEBSOCKET=1
CL_SDK_WEBSOCKET_HOST=127.0.0.1
CL_SDK_WEBSOCKET_PORT=1025
```

`tools/run_simulator.py` sets those variables and then opens the simulator:

```bash
.venv/bin/python tools/run_simulator.py --host 127.0.0.1 --port 1025 --seconds 300
```

## Used Endpoints

### `/_/ws/overview`

Purpose: low-rate overview chunks for heatmap/raster context.

Initial text message:

```json
{
  "status": "reset",
  "analysisMs": 5,
  "channel_mean": [],
  "channel_stddev": []
}
```

Observed status update:

```json
{
  "status": "status",
  "channel_mean": [],
  "channel_stddev": []
}
```

Binary payload:

```text
chunk_count * channel_count * 3 * int16 little-endian
```

Each channel tuple is:

```text
min, max, flags
```

Known flag bits from `cl-sdk` source:

```text
1 << 0: has spike
1 << 1: has stim
```

Parser behavior:

- `channel_count` is inferred from `reset.channel_mean.length`.
- `analysisMs` defaults to `5` if missing or non-numeric.
- Payload byte length must be divisible by `channel_count * 3 * 2`.
- Chunks are accepted as signed 16-bit sample min/max/flags values.

### `/_/ws/live_streaming`

Purpose: subscribed live stream events for spikes, stims, and custom data streams.

Initial text message:

```json
{
  "status": "reset",
  "frames_per_second": 25000
}
```

Subscription messages sent by `cl-spikeviz`:

```json
{"action":"subscribe","type":"data_stream","name":"cl_spikes"}
{"action":"subscribe","type":"data_stream","name":"cl_stims"}
```

Observed spike header:

```json
{
  "status": "cl_spikes",
  "spike_count": 2
}
```

The next WebSocket message is binary:

```text
timestamps: spike_count * uint64 little-endian
channels:   spike_count * uint8
padding:    enough bytes to align samples to an 8-byte boundary
samples:    spike_count * 75 * float32 little-endian
```

Observed stim header:

```json
{
  "status": "cl_stims",
  "stim_count": 2
}
```

The next WebSocket message is binary:

```text
timestamps: stim_count * uint64 little-endian
channels:   stim_count * uint8
padding:    enough bytes to align the payload to an 8-byte boundary in current cl-sdk source
```

`cl-spikeviz` parses the timestamp and channel sections and tolerates trailing padding.

## Unsupported Cases

The app currently ignores these `live_streaming` text statuses:

- `new_data`
- `attributes_reset`
- `attributes_updated`

Those are used by generic `cl-sdk` data streams. `cl-spikeviz` is scoped to the simulator `cl_spikes`, `cl_stims`, and overview stream for v0.1.

The app also does not send overview `stimulate` or `reset` actions. Its reset button clears local visual state only.

## Fixture Capture Workflow

1. Start a simulator WebSocket server:

   ```bash
   uv venv --python 3.12 .venv
   uv pip install --python .venv/bin/python cl-sdk websockets
   .venv/bin/python tools/run_simulator.py --seconds 300
   ```

2. Capture fixtures:

   ```bash
   .venv/bin/python tools/capture_protocol.py --seconds 5 --out test/fixtures
   ```

3. Run parser tests:

   ```bash
   npm run test:parse
   ```

4. Review generated files:

   - `test/fixtures/overview.json`
   - `test/fixtures/overview-*.bin`
   - `test/fixtures/live_streaming.json`
   - `test/fixtures/cl_spikes-*.bin`
   - `test/fixtures/cl_stims-*.bin`, if stims occur during capture

5. Commit refreshed fixtures only with context:

   - `cl-sdk` version or source commit
   - capture command
   - whether spike, stim, overview, and custom stream messages were observed

## Parser Assumptions

- Endianness is little-endian, matching current `cl-sdk` NumPy `tobytes()` output on supported local simulator platforms.
- Channel IDs are unsigned 8-bit values.
- Spike waveforms are exactly 75 float32 samples, matching `LiveStreamingProtocol.SAMPLES_PER_SPIKE`.
- Each live binary payload immediately follows its JSON header.
- Unknown text messages are ignored unless they are needed to pair a binary payload.
- There is no protocol version field in the observed messages; fixture tests are the current compatibility guard.
