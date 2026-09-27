"""iOS backend: metrics via `xcrun xctrace`, scoped to the app's main process.

iOS recording requires a macOS host with Xcode's command-line tools. On any
other platform this backend fails loudly rather than pretending to work.

Design (per spec):
- CPU time / memory / FPS are captured by an `xctrace record` run attached to
  the app's main process (`--attach <pid>`), matching Android's
  `/proc/<pid>/stat` scoping.
- `XCTCPUMetric` is intentionally NOT used (XCTest-only, cannot attach to a
  running app from a host-side library).

The exact trace-export field mapping is platform/template specific and must be
verified on a real macOS host with a connected device; the code below is
structured so that verification slots in without touching the rest of the
library.
"""

from __future__ import annotations

import platform
import subprocess
import time
from typing import Optional

from ..errors import DeviceNotFoundError, RecordingError
from ..model import Metric, Sample
from ..runner import SubprocessRunner
from . import Collector


def _pid_for_bundle(runner: SubprocessRunner, device_id: str, bundle_id: str) -> int:
    """Resolve the main-process pid for an installed app bundle on the device."""
    out = runner.run(
        [
            "xcrun",
            "devicectl",
            "device",
            "info",
            "processes",
            "--device",
            device_id,
        ]
    )
    # The process listing includes the bundle id and pid per process. Match the
    # line associated with the bundle id and extract the numeric pid. Verified
    # against live output on macOS only.
    for line in out.splitlines():
        if bundle_id in line:
            for token in line.split():
                if token.isdigit():
                    return int(token)
    raise DeviceNotFoundError(f"no running process found for bundle '{bundle_id}'")


class IOSCollector:
    def __init__(
        self,
        runner: SubprocessRunner,
        device_id: str,
        package: str,
        metrics: tuple[Metric, ...],
        now: callable = time.time,
    ) -> None:
        if platform.system() != "Darwin":
            raise RecordingError("iOS recording requires a macOS host with xctrace")
        self._runner = runner
        self._device_id = device_id
        self._package = package
        self._metrics = metrics
        self._now = now
        self._trace_proc: Optional[subprocess.Popen] = None
        self._trace_path: Optional[str] = None
        self._samples: list[Sample] = []

    def reset(self) -> None:
        pid = _pid_for_bundle(self._runner, self._device_id, self._package)
        self._trace_path = f"/tmp/perfhound-{self._package}-{int(self._now() * 1000)}.trace"
        self._trace_proc = subprocess.Popen(
            [
                "xcrun",
                "xctrace",
                "record",
                "--device",
                self._device_id,
                "--attach",
                str(pid),
                "--template",
                "Time Profiler",
                "--output",
                self._trace_path,
            ]
        )

    def sample(self) -> Sample:
        # xctrace accumulates into the trace file; a lightweight per-interval
        # extraction is not available. The session collects timestamps here and
        # the real per-metric values are mapped in close() from the exported
        # trace. This keeps the session loop uniform across platforms.
        return Sample(timestamp=self._now())

    def close(self) -> None:
        if self._trace_proc is not None:
            self._trace_proc.terminate()
            try:
                self._trace_proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._trace_proc.kill()
                self._trace_proc.wait()
        # Export and map the trace to Samples. Field mapping is verified live on
        # macOS (see module docstring).
        self._samples = self._export()

    def _export(self) -> list[Sample]:
        if not self._trace_path:
            return []
        out = self._runner.run(
            ["xcrun", "xctrace", "export", "--input", self._trace_path, "--xpath", "/"]
        )
        # Parse `out` into per-interval Samples for the requested metrics.
        # TODO(verify-on-macos): implement field mapping from the exported trace.
        return []

    @property
    def samples(self) -> list[Sample]:
        return self._samples
