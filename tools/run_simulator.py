#!/usr/bin/env python3
"""Run the cl-sdk simulator with the WebSocket stream enabled."""

from __future__ import annotations

import argparse
import sys
import time
from os import environ, getenv


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a cl-sdk simulator stream for cl-spikeviz.")
    parser.add_argument("--host", default=getenv("CL_SDK_WEBSOCKET_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(getenv("CL_SDK_WEBSOCKET_PORT", "1025")))
    parser.add_argument("--seconds", type=float, default=300.0)
    parser.add_argument("--ticks-per-second", type=float, default=100.0)
    args = parser.parse_args()

    environ["CL_SDK_WEBSOCKET"] = "1"
    environ["CL_SDK_WEBSOCKET_HOST"] = args.host
    environ["CL_SDK_WEBSOCKET_PORT"] = str(args.port)

    try:
        import cl
    except ModuleNotFoundError as exc:
        if exc.name != "cl":
            raise
        print(
            "cl-sdk is not installed in this Python environment.\n"
            "Install it with:\n"
            "  python3 -m venv .venv\n"
            "  source .venv/bin/activate\n"
            "  pip install cl-sdk",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    replay_path = getattr(cl, "_CL_SDK_REPLAY_PATH", None)
    if replay_path and "CL_SDK_REPLAY_PATH" not in environ:
        environ["CL_SDK_REPLAY_PATH"] = str(replay_path)

    print(f"Starting cl-sdk simulator WebSocket on ws://{args.host}:{args.port}", flush=True)
    with cl.open() as neurons:
      started = time.monotonic()
      for tick in neurons.loop(ticks_per_second=args.ticks_per_second, stop_after_seconds=args.seconds):
          if tick.iteration % int(args.ticks_per_second) == 0:
              elapsed = time.monotonic() - started
              print(f"streaming {elapsed:0.1f}s · tick {tick.iteration}", flush=True)


if __name__ == "__main__":
    main()
