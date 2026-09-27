"""Backend protocol and helpers.

Each platform exposes a collector that reads metrics from the device at a
moment in time. Collectors are kept synchronous and stateless (apart from
closing) so the session can schedule them and own the sample loop.
"""

from __future__ import annotations

from typing import Protocol

from ..model import Sample


class Collector(Protocol):
    """Reads metrics from a device. Returns a Sample with available metrics."""

    def sample(self) -> Sample:
        """Read one sample from the device."""

    def reset(self) -> None:
        """Prepare device-side counters at recording start (e.g. frame stats)."""

    def close(self) -> None:
        """Release any resources (e.g. stop a trace)."""
