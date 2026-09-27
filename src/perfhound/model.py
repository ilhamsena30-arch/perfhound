"""Data model for recordings."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Metric(str, Enum):
    """The metrics perfhound can record. Values double as CSV column names."""

    CPU = "cpu_time_ms"
    MEMORY = "memory_mb"
    FPS = "fps"


@dataclass
class Sample:
    """A single timestamped reading. Missing metrics are None (empty in CSV)."""

    timestamp: float
    cpu_time_ms: Optional[float] = None
    memory_mb: Optional[float] = None
    fps: Optional[float] = None


@dataclass
class RecordingConfig:
    """Everything needed to start a recording."""

    device_id: str
    package: str
    metrics: tuple[Metric, ...] = (Metric.CPU, Metric.MEMORY, Metric.FPS)
    interval: float = 1.0
    max_duration: Optional[float] = None
    platform: Optional[str] = None  # "auto" (default), "android", or "ios"
