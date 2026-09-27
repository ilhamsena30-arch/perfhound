"""Command-line interface: start/end recording from a terminal.

Usage:
    perfhound start <device_id> <package> [--metrics cpu,memory] [--interval 1] [--out file.csv]
    perfhound end [--out file.csv]
"""

from __future__ import annotations

import argparse
import atexit
import sys
from typing import Optional

from .session import RecordingSession, start_recording

_active: Optional[RecordingSession] = None


def _parse_metrics(value: str):
    return [m.strip() for m in value.split(",") if m.strip()]


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="perfhound", description="Record mobile app performance.")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="Start recording (uid + package required).")
    start.add_argument("device_id", help="Device uid.")
    start.add_argument("package", help="App package / bundle id.")
    start.add_argument("--metrics", default=None, help="Comma-separated stats: cpu,memory,fps.")
    start.add_argument("--interval", type=float, default=1.0, help="Sampling interval in seconds.")
    start.add_argument("--max-duration", type=float, default=None, help="Auto-stop after N seconds.")
    start.add_argument("--platform", default=None, choices=["android", "ios"], help="Force platform.")
    start.add_argument("--out", default=None, help="CSV output path.")

    end = sub.add_parser("end", help="Stop the current recording.")
    end.add_argument("--out", default=None, help="CSV output path (optional).")

    args = parser.parse_args(argv)

    global _active
    if args.command == "start":
        _active = start_recording(
            device_id=args.device_id,
            package=args.package,
            metrics=_parse_metrics(args.metrics) if args.metrics else None,
            interval=args.interval,
            max_duration=args.max_duration,
            platform=args.platform,
        )
        atexit.register(_stop_on_exit, args.out)
        print(
            f"recording started for {args.package} on {args.device_id}. "
            "Run `perfhound end` to stop.",
            file=sys.stderr,
        )
        return 0

    if args.command == "end":
        if _active is None:
            print("no active recording", file=sys.stderr)
            return 1
        _active.stop(args.out)
        print("recording stopped" + (f", saved to {args.out}" if args.out else ""), file=sys.stderr)
        _active = None
        return 0

    return 1


def _stop_on_exit(out: Optional[str]) -> None:
    global _active
    if _active is not None:
        try:
            _active.stop(out)
        except Exception as exc:  # noqa: BLE001 - best effort on exit
            print(f"warning: failed to finalize recording on exit: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
