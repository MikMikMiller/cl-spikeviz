# Stream Protocol Notes

`cl-spikeviz` consumes the browser-facing WebSocket streams exposed by the `cl-sdk` simulator. This document records what the app currently uses, what was verified, and which parts remain assumptions rather than a stable public contract.

## Verification Sources

Checked on 2026-05-31:

- Public docs: `docs.corticallabs.com` and the `cl-sdk` README document enabling the simulator WebSocket server with `CL_SDK_WEBSOCKET=1`, `CL_SDK_WEBSOCKET_HOST`, and `CL_SDK_WEBSOCKET_PORT`.
- Public source: `Cortical-Labs/cl-sdk` commit `fea6277edd3169bdad4a46f0e1eadab3729058e7`.
- Local fixtures: `test/fixtures/overview.json`, `test/fixtures/live_streaming.json`, and referenced `.bin` payloads captured from a `cl-sdk` simulator run.
- Live verification: local `cl-sdk` package version `0.29.0`, installed at `.venv/lib/python3.12/site-packages/cl`, launched with `tools/run_simulator.py --seconds 120 --host 127.0.0.1 --port 1025`, and recaptured for 10 seconds to `/tmp/spikeviz-recapture`.

The public docs do not describe the `/_/ws/overview` and `/_/ws/live_streaming` payload layouts. Those endpoint paths and frame formats are source-observed from `src/cl/visualisation/_websocket_subprocess.py`, `src/cl/visualisation/web/analysis.mjs`, `src/cl/visualisation/web/engine.mjs`, and `src/cl/visualisation/_http_server.py`, then checked against the live capture above.

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

Verification status: verified against live `cl-sdk` 0.29.0 capture and committed fixtures.

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

Verification status: `reset` and `cl_spikes` messages verified against live `cl-sdk` 0.29.0 capture and committed fixtures. `cl_stims` parsing remains source-observed plus parser-tested because no stim payload occurred during the live recapture or committed fixtures.

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

`cl-spikeviz` parses the timestamp and channel sections and tolerates trailing padding. This layout is source-observed and covered by parser tests; it still needs a live capture containing `cl_stims` before it can be marked live-verified.

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

## Recording Snapshot Format

`cl-spikeviz` can also replay a compact JSON snapshot in the browser. This format is owned by this visualizer. It is not the official `cl-sdk` recording format and it does not parse the HDF5 files produced by `neurons.record()`.

Top-level schema:

```json
{
  "format": "cl-spikeviz-recording",
  "version": 1,
  "frames_per_second": 25000,
  "channel_count": 64,
  "duration_ms": 61.08,
  "events": [
    { "t_ms": 0, "type": "spike", "channel": 5 },
    { "t_ms": 2.4, "type": "stim", "channel": 7 }
  ]
}
```

Fields:

- `format` must be `cl-spikeviz-recording`.
- `version` must be `1`.
- `frames_per_second` is the frame clock used to convert event times into the same timestamp units as live `cl_spikes` and `cl_stims`.
- `channel_count` is an integer from 1 to 256.
- `duration_ms` is the replay duration. It must be greater than or equal to the last event time.
- `events` is sorted by the browser parser before replay.

Event schema:

- `t_ms` is a non-negative number of milliseconds from the snapshot start. The exporter normalizes live capture timestamps so the first captured event is at `0`.
- `type` is `spike` or `stim`.
- `channel` is a zero-based channel index less than `channel_count`.
- `samples` is optional on spike events. If present, it must contain exactly 75 numeric values, matching `LiveStreamingProtocol.SAMPLES_PER_SPIKE`. If omitted, replay still shows the spike event and uses a flat placeholder waveform.

Replay integration:

- The browser converts `t_ms` to frame timestamps with `Math.round(t_ms / 1000 * frames_per_second)`.
- Replay calls the same app handlers as demo and live mode: `onOverviewReset`, `onLiveReset`, `onOverviewChunks`, `onSpikes`, and `onStims`.
- Overview chunks are derived from replay events during playback: spike/stim flags are set per channel, and spike waveform ranges provide the overview min/max values. The snapshot therefore stays compact instead of storing full overview frames.

Export workflows:

```bash
python3 tools/export_recording.py --fixtures test/fixtures --out assets/sample-recording.json --preview-duration-ms 5000 --preview-cycle-ms 500
```

```bash
.venv/bin/python tools/capture_protocol.py --seconds 5 --out /tmp/spikeviz-capture --recording-out /tmp/sample-recording.json
```

## Parser Assumptions

- Endianness is little-endian, matching current `cl-sdk` NumPy `tobytes()` output on supported local simulator platforms.
- Channel IDs are unsigned 8-bit values.
- Spike waveforms are exactly 75 float32 samples, matching `LiveStreamingProtocol.SAMPLES_PER_SPIKE`.
- Each live binary payload immediately follows its JSON header.
- Unknown text messages are ignored unless they are needed to pair a binary payload.
- There is no protocol version field in the observed messages; fixture tests are the current compatibility guard.
