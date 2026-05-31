# Limitations

`cl-spikeviz` v0.1 is a simulator-stream preview for reviewers. It is not a complete client for every `cl-sdk` visualization feature.

## Scope

- Targets browser visualization of `cl-sdk` simulator WebSocket streams.
- Uses the current live-verified `/_/ws/overview` and `/_/ws/live_streaming` endpoints for simulator overview and `cl_spikes` payloads.
- Does not require CL1 hardware.
- Does not assume access to hardware-only behavior.

## Protocol Limits

- The public `cl-sdk` docs describe enabling the WebSocket server, but do not publish a standalone versioned protocol for the two endpoint payload layouts.
- Parser compatibility is guarded by captured fixtures, a live `cl-sdk` 0.29.0 recapture, and source review for cases that were not emitted during capture.
- Generic custom data streams are not rendered. Messages with `status` values `new_data`, `attributes_reset`, and `attributes_updated` are ignored.
- Stim events are parsed when the stream provides `cl_stims`, but the binary `cl_stims` layout is source-observed and parser-tested, not live-verified. Neither the committed fixtures nor the 2026-05-31 live recapture contained stim binary payloads, so this requires verification with a stim-producing stream.
- The app does not send stimulation commands to the simulator.

## Browser Limits

- Live mode connects from the browser to `ws://<host>:<port>`. Browser mixed-content rules can block `ws://` connections when the app is served over `https://`.
- GitHub Pages can host demo mode, but live simulator mode usually needs local static hosting or another setup that avoids mixed-content restrictions.
- The isometric 3D canvas view is an optional preview surface. The 2D dashboard remains the default path.

## Data and Rendering Limits

- Demo mode is deterministic synthetic browser data for UI review only.
- Recording replay mode consumes a simplified `cl-spikeviz` snapshot JSON, not full HDF5 files from `neurons.record()`.
- Snapshot replay stores spike/stim events and optional 75-sample spike waveforms. It derives overview activity during playback instead of preserving every original overview chunk.
- The 3D view is an optional preview surface and shares the same parsed event state as the 2D dashboard.
- The CSV export covers the rolling local event window, not a full simulator recording.
- Local pause freezes visual state handling; it does not pause the upstream simulator.

## Review Boundaries

For v0.1, review should focus on:

- whether connection diagnostics are understandable
- whether documented parser assumptions match current `cl-sdk` source and fixtures
- whether demo mode is useful without setup
- whether live mode can connect to a local simulator and render incoming events
- whether unsupported cases are visible enough for future work
