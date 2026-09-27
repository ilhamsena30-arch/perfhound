"""Exception hierarchy for perfhound."""


class PerfhoundError(Exception):
    """Base class for all perfhound errors."""


class DeviceNotFoundError(PerfhoundError):
    """Raised when the target device or app process cannot be found."""


class RecordingError(PerfhoundError):
    """Raised when recording fails (tooling missing, device failure, etc.)."""
