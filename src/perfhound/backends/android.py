"""Android backend: metrics via adb.

- CPU time: cumulative utime+stime from /proc/<pid>/stat (clock ticks -> ms),
  reported as the delta since the previous sample.
- Memory: PSS total from `dumpsys meminfo <package>` (kB -> MB).
- FPS: `dumpsys gfxinfo <package> reset` at start, then `framestats` per sample.
"""

from __future__ import annotations

import re
import time
from typing import Optional

from ..errors import DeviceNotFoundError, RecordingError
from ..model import Metric, Sample
from ..runner import SubprocessRunner
from . import Collector

_PID_RE = re.compile(rb"^(\d+)\s*$")


def _pid_for_package(runner: SubprocessRunner, device_id: str, package: str) -> int:
    out = runner.run(["adb", "-s", device_id, "shell", "pidof", package]).strip()
    match = _PID_RE.match(out.encode())
    if not match:
        raise DeviceNotFoundError(f"no running process found for package '{package}'")
    return int(match.group(1))


class AndroidCollector:
    def __init__(
        self,
        runner: SubprocessRunner,
        device_id: str,
        package: str,
        metrics: tuple[Metric, ...],
        now: callable = time.time,
    ) -> None:
        self._runner = runner
        self._device_id = device_id
        self._package = package
        self._metrics = metrics
        self._now = now
        self._pid = _pid_for_package(runner, device_id, package)
        self._last_cpu_ms: Optional[float] = None

    def reset(self) -> None:
        if Metric.FPS in self._metrics:
            # Reset frame stats so framestats only spans this recording.
            self._runner.run(
                [
                    "adb",
                    "-s",
                    self._device_id,
                    "shell",
                    "dumpsys",
                    "gfxinfo",
                    self._package,
                    "reset",
                ]
            )
        if Metric.CPU in self._metrics:
            # Prime the cumulative CPU counter so the first delta is meaningful.
            self._last_cpu_ms = self._read_cpu_ms()

    def sample(self) -> Sample:
        sample = Sample(timestamp=self._now())
        if Metric.CPU in self._metrics:
            current = self._read_cpu_ms()
            if self._last_cpu_ms is not None:
                sample.cpu_time_ms = max(0.0, current - self._last_cpu_ms)
            self._last_cpu_ms = current
        if Metric.MEMORY in self._metrics:
            sample.memory_mb = self._read_memory_mb()
        if Metric.FPS in self._metrics:
            sample.fps = self._read_fps()
        return sample

    def close(self) -> None:
        return None

    def _read_cpu_ms(self) -> float:
        try:
            stat = self._runner.run(
                [
                    "adb",
                    "-s",
                    self._device_id,
                    "shell",
                    "cat",
                    f"/proc/{self._pid}/stat",
                ]
            ).strip()
        except RecordingError:
            raise
        except Exception as exc:  # command failed -> process likely gone
            raise RecordingError(
                f"failed to read /proc/{self._pid}/stat for package '{self._package}'"
            ) from exc

        # Format: pid (comm) state ppid ... utime stime ...
        # `comm` may contain spaces and parens, so split on the LAST ')' and
        # parse the fields that follow. After comm, the sequence is:
        #   state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt
        #   cmajflt utime stime ...
        # utime is the 12th token (index 11) and stime the 13th (index 12).
        after = stat[stat.rfind(")") + 2 :].split()
        if len(after) < 13:
            raise RecordingError(f"unexpected /proc/{self._pid}/stat content: {stat!r}")
        utime = int(after[11])
        stime = int(after[12])
        # Convert clock ticks to milliseconds (100 ticks/sec on Android).
        return (utime + stime) * 10.0

    def _read_memory_mb(self) -> float:
        out = self._runner.run(
            [
                "adb",
                "-s",
                self._device_id,
                "shell",
                "dumpsys",
                "meminfo",
                self._package,
            ]
        )
        # PSS total is the row whose first column is "TOTAL"; the Pss value is
        # the first numeric column after it.
        for line in out.splitlines():
            if line.strip().startswith("TOTAL"):
                parts = line.split()
                try:
                    pss_kb = int(parts[1])
                except (IndexError, ValueError):
                    continue
                return pss_kb / 1024.0
        raise RecordingError(f"could not parse PSS from meminfo for '{self._package}'")

    def _read_fps(self) -> Optional[float]:
        out = self._runner.run(
            [
                "adb",
                "-s",
                self._device_id,
                "shell",
                "dumpsys",
                "gfxinfo",
                self._package,
                "framestats",
            ]
        )
        return _parse_framestats_fps(out)


def _parse_framestats_fps(out: str) -> Optional[float]:
    """Derive frames-per-second from gfxinfo framestats output.

    Each non-header line is one frame: 15 comma-separated fields, the first
    being the vsync timestamp in nanoseconds. Returns None when there are too
    few frames to compute a rate (best-effort, not fabricated).
    """
    timestamps = []
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith("---") or "," not in line:
            continue
        parts = line.split(",")
        if len(parts) < 2:
            continue
        try:
            timestamps.append(int(parts[0]))
        except ValueError:
            continue
    if len(timestamps) < 2:
        return None
    span_s = (timestamps[-1] - timestamps[0]) / 1e9
    if span_s <= 0:
        return None
    return (len(timestamps) - 1) / span_s
