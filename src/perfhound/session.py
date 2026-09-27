"""Recording session: owns the sample loop and lifecycle.

The session drives a platform collector. It runs a background sampling thread
so recording does not block the caller's test thread indefinitely, and handles
the start/stop lifecycle including the optional auto-timeout and salvage-on-
error behavior.
"""

from __future__ import annotations

import threading
import time
from typing import Optional

from .backends.android import AndroidCollector
from .backends.ios import IOSCollector
from .csv_writer import write_csv
from .errors import DeviceNotFoundError, PerfhoundError, RecordingError
from .model import Metric, RecordingConfig, Sample
from .runner import SubprocessRunner


def _detect_platform(runner: SubprocessRunner, device_id: str) -> str:
    """Classify the device as 'android' or 'ios'.

    An iOS device is any device `xcrun` knows about; adb devices are Android.
    `xcrun` is only present on macOS, so on other hosts we only accept Android.
    """
    try:
        out = runner.run(["adb", "devices"])
    except Exception:
        out = ""
    lines = [l for l in out.splitlines() if l.strip() and "List of devices" not in l]
    if any(device_id in line for line in lines):
        return "android"
    # Not found via adb; ask xctrace (macOS only).
    try:
        out = runner.run(["xcrun", "xctrace", "list", "devices"])
    except Exception:
        raise DeviceNotFoundError(
            f"device '{device_id}' not found via adb (and xctrace is unavailable)"
        )
    if device_id in out:
        return "ios"
    raise DeviceNotFoundError(f"device '{device_id}' not found")


def _make_collector(
    platform: str,
    runner: SubprocessRunner,
    config: RecordingConfig,
    now: callable,
):
    if platform == "android":
        return AndroidCollector(runner, config.device_id, config.package, config.metrics, now)
    if platform == "ios":
        return IOSCollector(runner, config.device_id, config.package, config.metrics, now)
    raise RecordingError(f"unsupported platform '{platform}'")


class RecordingSession:
    """An active recording for a single device+package."""

    def __init__(
        self,
        collector,
        config: RecordingConfig,
        *,
        now: callable = time.time,
        sleep: callable = time.sleep,
    ) -> None:
        self._collector = collector
        self._config = config
        self._now = now
        self._sleep = sleep
        self._samples: list[Sample] = []
        self._stopped = False
        self._closed = False
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._error: Optional[BaseException] = None
        self._started_at = self._now()

    def start(self) -> "RecordingSession":
        self._collector.reset()
        self._thread = threading.Thread(target=self._run, name="perfhound-sampler", daemon=True)
        self._thread.start()
        return self

    def stop(self, path: Optional[str] = None) -> list[Sample]:
        """Stop recording and write the CSV if a path is given.

        Always returns the collected samples; salvages data on error. Idempotent.
        """
        with self._lock:
            self._stopped = True
        if self._thread is not None:
            self._thread.join(timeout=max(self._config.interval * 2, 5.0))
        self._close_once()
        if path is not None:
            write_csv(path, self._samples, self._config.metrics)
        if self._error is not None:
            raise RecordingError(f"recording failed: {self._error}") from self._error
        return list(self._samples)

    def _close_once(self) -> None:
        """Release collector resources exactly once, from any thread."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
        try:
            self._collector.close()
        except PerfhoundError:
            # Close failures shouldn't hide the samples we already collected.
            pass

    @property
    def samples(self) -> list[Sample]:
        return list(self._samples)

    def _run(self) -> None:
        try:
            while True:
                with self._lock:
                    if self._stopped:
                        break
                sample = self._collector.sample()
                self._samples.append(sample)
                if (
                    self._config.max_duration is not None
                    and self._now() - self._started_at >= self._config.max_duration
                ):
                    with self._lock:
                        self._stopped = True
                    break
                self._sleep(self._config.interval)
        except BaseException as exc:  # noqa: BLE001 - salvage on any failure
            self._error = exc
        finally:
            # Release device-side monitoring (e.g. an iOS trace) even when the
            # session auto-stops or fails and the caller never calls stop().
            self._close_once()


def start_recording(
    device_id: str,
    package: str,
    *,
    metrics: Optional[tuple[str, ...]] = None,
    interval: float = 1.0,
    max_duration: Optional[float] = None,
    platform: Optional[str] = None,
    runner: Optional[SubprocessRunner] = None,
) -> RecordingSession:
    """Start recording performance metrics for an app.

    Required: device_id and package. Metrics default to CPU/Memory/FPS and can
    be reduced to a single stat. Returns a session handle; call ``stop()`` on it.
    """
    if interval <= 0:
        raise ValueError("interval must be > 0")

    metric_values: tuple[Metric, ...]
    if metrics is None:
        metric_values = (Metric.CPU, Metric.MEMORY, Metric.FPS)
    else:
        parsed = [Metric(m) for m in metrics]
        if not parsed:
            raise ValueError("metrics must contain at least one stat")
        metric_values = tuple(parsed)

    runner = runner or SubprocessRunner()
    if platform is None:
        platform = _detect_platform(runner, device_id)

    config = RecordingConfig(
        device_id=device_id,
        package=package,
        metrics=metric_values,
        interval=interval,
        max_duration=max_duration,
        platform=platform,
    )
    collector = _make_collector(platform, runner, config, time.time)
    return RecordingSession(collector, config, now=time.time, sleep=time.sleep).start()
