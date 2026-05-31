#!/usr/bin/env python3
"""Export a compact cl-spikeviz recording snapshot from captured fixtures."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path
from typing import Any

FORMAT = "cl-spikeviz-recording"
VERSION = 1
SAMPLES_PER_SPIKE = 75
TIMESTAMP_BYTES = 8
CHANNEL_BYTES = 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a cl-spikeviz recording snapshot from captured fixtures.")
    parser.add_argument("--fixtures", type=Path, default=Path("test/fixtures"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--preview-duration-ms",
        type=float,
        default=0,
        help="Repeat captured events until this duration for browser-preview sample recordings.",
    )
    parser.add_argument(
        "--preview-cycle-ms",
        type=float,
        default=500,
        help="Cycle interval used with --preview-duration-ms.",
    )
    args = parser.parse_args()

    overview_records = read_json(args.fixtures / "overview.json")
    live_records = read_json(args.fixtures / "live_streaming.json")
    snapshot = build_snapshot_from_records(args.fixtures, overview_records, live_records)
    if args.preview_duration_ms > 0:
        snapshot = expand_preview_snapshot(snapshot, args.preview_duration_ms, args.preview_cycle_ms)
    write_snapshot(args.out, snapshot)


def read_json(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_snapshot(path: Path, snapshot: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")


def build_snapshot_from_records(
    base: Path,
    overview_records: list[dict[str, Any]],
    live_records: list[dict[str, Any]],
) -> dict[str, Any]:
    fps = find_frames_per_second(live_records)
    channel_count = find_channel_count(overview_records)
    events = collect_events(base, live_records)
    events.sort(key=lambda event: (event["timestamp_frames"], 0 if event["type"] == "spike" else 1, event["channel"]))

    origin = events[0]["timestamp_frames"] if events else 0
    snapshot_events = [to_snapshot_event(event, origin, fps) for event in events]
    duration_ms = max((event["t_ms"] for event in snapshot_events), default=0)

    return {
        "format": FORMAT,
        "version": VERSION,
        "frames_per_second": fps,
        "channel_count": channel_count,
        "duration_ms": duration_ms,
        "events": snapshot_events,
    }


def expand_preview_snapshot(
    snapshot: dict[str, Any],
    target_duration_ms: float,
    cycle_ms: float,
) -> dict[str, Any]:
    """Expand a short fixture capture into a demo-like review sample replay."""

    events = snapshot["events"]
    if not events or target_duration_ms <= snapshot["duration_ms"]:
        return snapshot

    spike_templates = [event for event in events if event["type"] == "spike"]
    if not spike_templates:
        return snapshot

    fps = int(snapshot["frames_per_second"])
    channel_count = int(snapshot["channel_count"])
    cycle = max(float(cycle_ms), 50)
    chunks_per_cycle = 10
    frames_per_ms = fps / 1000
    expanded: list[dict[str, Any]] = []
    tick = 0
    start_ms = 0.0
    while start_ms <= target_duration_ms:
        active_channels = [
            tick % channel_count,
            (tick * 7 + 11) % channel_count,
            (tick * 13 + 5) % channel_count,
        ]
        stim_channel = (tick * 5 + 3) % channel_count if tick % 9 == 0 else None

        for chunk in range(chunks_per_cycle):
            chunk_ms = start_ms + chunk * (cycle / chunks_per_cycle)
            if stim_channel is not None and chunk == 0 and chunk_ms <= target_duration_ms:
                expanded.append({
                    "t_ms": normalize_ms(chunk_ms),
                    "type": "stim",
                    "channel": stim_channel,
                })

            for index, channel in enumerate(active_channels):
                if (chunk + channel + tick) % 3 == 0:
                    continue
                t_ms = normalize_ms(chunk_ms + (channel % 17) / frames_per_ms)
                if float(t_ms) > target_duration_ms:
                    continue
                template = spike_templates[(tick + chunk + index) % len(spike_templates)]
                expanded.append({
                    "t_ms": t_ms,
                    "type": "spike",
                    "channel": channel,
                    "samples": template["samples"],
                })

        tick += 1
        start_ms += cycle

    result = dict(snapshot)
    result["duration_ms"] = normalize_ms(target_duration_ms)
    result["events"] = sorted(expanded, key=lambda event: (float(event["t_ms"]), 0 if event["type"] == "spike" else 1, event["channel"]))
    return result


def find_frames_per_second(live_records: list[dict[str, Any]]) -> int:
    for record in live_records:
        message = record.get("message") or {}
        if record.get("type") == "text" and message.get("status") == "reset":
            fps = int(message.get("frames_per_second") or 0)
            if fps > 0:
                return fps
    raise ValueError("live_streaming capture does not contain a reset frames_per_second value")


def find_channel_count(overview_records: list[dict[str, Any]]) -> int:
    for record in overview_records:
        message = record.get("message") or {}
        means = message.get("channel_mean")
        if record.get("type") == "text" and isinstance(means, list) and means:
            return len(means)
    raise ValueError("overview capture does not contain channel metadata")


def collect_events(base: Path, live_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for record in live_records:
        if record.get("type") != "binary":
            continue

        status = record.get("status")
        header = record.get("header") or {}
        payload = (base / record["file"]).read_bytes()
        if status == "cl_spikes":
            events.extend(parse_spikes(payload, int(header.get("spike_count") or 0)))
        elif status == "cl_stims":
            events.extend(parse_stims(payload, int(header.get("stim_count") or 0)))
    return events


def parse_spikes(payload: bytes, spike_count: int) -> list[dict[str, Any]]:
    if spike_count <= 0:
        return []

    channels_offset = spike_count * TIMESTAMP_BYTES
    samples_offset = channels_offset + spike_count * CHANNEL_BYTES + channel_padding(spike_count)
    expected = samples_offset + spike_count * SAMPLES_PER_SPIKE * 4
    if len(payload) < expected:
        raise ValueError(f"cl_spikes payload is {len(payload)} bytes, expected at least {expected}")

    events: list[dict[str, Any]] = []
    for index in range(spike_count):
        timestamp = struct.unpack_from("<Q", payload, index * TIMESTAMP_BYTES)[0]
        channel = payload[channels_offset + index]
        sample_start = samples_offset + index * SAMPLES_PER_SPIKE * 4
        samples = struct.unpack_from(f"<{SAMPLES_PER_SPIKE}f", payload, sample_start)
        events.append({
            "timestamp_frames": timestamp,
            "type": "spike",
            "channel": channel,
            "samples": [round(float(sample), 3) for sample in samples],
        })
    return events


def parse_stims(payload: bytes, stim_count: int) -> list[dict[str, Any]]:
    if stim_count <= 0:
        return []

    channels_offset = stim_count * TIMESTAMP_BYTES
    expected = channels_offset + stim_count * CHANNEL_BYTES
    if len(payload) < expected:
        raise ValueError(f"cl_stims payload is {len(payload)} bytes, expected at least {expected}")

    events: list[dict[str, Any]] = []
    for index in range(stim_count):
        events.append({
            "timestamp_frames": struct.unpack_from("<Q", payload, index * TIMESTAMP_BYTES)[0],
            "type": "stim",
            "channel": payload[channels_offset + index],
        })
    return events


def to_snapshot_event(event: dict[str, Any], origin: int, fps: int) -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "t_ms": ms_value(event["timestamp_frames"] - origin, fps),
        "type": event["type"],
        "channel": event["channel"],
    }
    if event["type"] == "spike":
        snapshot["samples"] = event["samples"]
    return snapshot


def ms_value(frames: int, fps: int) -> int | float:
    value = round((frames * 1000) / fps, 3)
    return int(value) if float(value).is_integer() else value


def normalize_ms(value: float) -> int | float:
    rounded = round(value, 3)
    return int(rounded) if rounded.is_integer() else rounded


def channel_padding(count: int) -> int:
    return (TIMESTAMP_BYTES - ((count * CHANNEL_BYTES) & (TIMESTAMP_BYTES - 1))) & (TIMESTAMP_BYTES - 1)


if __name__ == "__main__":
    main()
