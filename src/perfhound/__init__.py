"""perfhound - record mobile app performance (CPU time, memory, FPS)."""

from .errors import DeviceNotFoundError, PerfhoundError, RecordingError
from .model import Metric, RecordingConfig, Sample
from .session import RecordingSession, start_recording

__version__ = "0.1.0"

__all__ = [
    "start_recording",
    "RecordingSession",
    "RecordingConfig",
    "Metric",
    "Sample",
    "PerfhoundError",
    "DeviceNotFoundError",
    "RecordingError",
    "__version__",
]
