# Protocol Fixtures

These files are captured from a real `cl-sdk` simulator WebSocket run and are used by `test/parse.test.mjs`.

Captured endpoints:

- `overview.json` plus `overview-*.bin`: `/_/ws/overview` reset metadata and int16 `[min, max, flags]` chunks.
- `live_streaming.json` plus `cl_spikes-*.bin`: `/_/ws/live_streaming` headers and `cl_spikes` binary payloads.

Refresh fixtures while the simulator is running:

```bash
python tools/capture_protocol.py --seconds 5 --out test/fixtures
```

The spike payload layout under test is:

```text
timestamps: N * uint64 little-endian
channels:   N * uint8
padding:    align samples to 8 bytes
samples:    N * 75 * float32 little-endian
```
