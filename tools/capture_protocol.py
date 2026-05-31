#!/usr/bin/env python3
"""Capture initial cl-sdk WebSocket messages for parser self-review."""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any

import websockets


async def main() -> None:
    parser = argparse.ArgumentParser(description="Capture cl-sdk websocket headers and binary payloads.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1025)
    parser.add_argument("--out", type=Path, default=Path("test/fixtures"))
    parser.add_argument("--binary-count", type=int, default=3)
    parser.add_argument("--seconds", type=float, default=None, help="Capture for this many seconds instead of stopping only by binary count.")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + args.seconds if args.seconds else None
    overview_task = asyncio.create_task(capture_overview(args.host, args.port, args.out, args.binary_count, deadline))
    live_task = asyncio.create_task(capture_live(args.host, args.port, args.out, args.binary_count, deadline))
    await asyncio.gather(overview_task, live_task)


async def capture_overview(host: str, port: int, out: Path, binary_count: int, deadline: float | None) -> None:
    uri = f"ws://{host}:{port}/_/ws/overview"
    records: list[dict[str, Any]] = []

    async with websockets.connect(uri) as websocket:
        while should_continue(records, binary_count, deadline):
            message = await recv_until_deadline(websocket, deadline)
            if message is None:
                break
            if isinstance(message, str):
                records.append({"type": "text", "message": json.loads(message)})
            else:
                index = len([record for record in records if record["type"] == "binary"])
                filename = f"overview-{index}.bin"
                (out / filename).write_bytes(message)
                records.append({"type": "binary", "file": filename, "bytes": len(message), "hex": message[:32].hex()})

    (out / "overview.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


async def capture_live(host: str, port: int, out: Path, binary_count: int, deadline: float | None) -> None:
    uri = f"ws://{host}:{port}/_/ws/live_streaming"
    records: list[dict[str, Any]] = []
    pending_header: dict[str, Any] | None = None

    async with websockets.connect(uri) as websocket:
        await websocket.send(json.dumps({"action": "subscribe", "type": "data_stream", "name": "cl_spikes"}))
        await websocket.send(json.dumps({"action": "subscribe", "type": "data_stream", "name": "cl_stims"}))

        while should_continue(records, binary_count, deadline):
            message = await recv_until_deadline(websocket, deadline)
            if message is None:
                break
            if isinstance(message, str):
                pending_header = json.loads(message)
                records.append({"type": "text", "message": pending_header})
            elif pending_header:
                index = len([record for record in records if record["type"] == "binary"])
                status = pending_header.get("status", "payload")
                filename = f"{status}-{index}.bin"
                (out / filename).write_bytes(message)
                records.append({
                    "type": "binary",
                    "status": status,
                    "header": pending_header,
                    "file": filename,
                    "bytes": len(message),
                    "hex": message[:32].hex(),
                })
                pending_header = None

    (out / "live_streaming.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


def should_continue(records: list[dict[str, Any]], binary_count: int, deadline: float | None) -> bool:
    if deadline is not None:
        return time.monotonic() < deadline
    return binary_record_count(records) < binary_count


def binary_record_count(records: list[dict[str, Any]]) -> int:
    return sum(1 for record in records if record["type"] == "binary")


async def recv_until_deadline(websocket, deadline: float | None):
    if deadline is None:
        return await websocket.recv()

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None

    try:
        return await asyncio.wait_for(websocket.recv(), timeout=remaining)
    except TimeoutError:
        return None


if __name__ == "__main__":
    asyncio.run(main())
