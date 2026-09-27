"""Statistical aggregation over sampled values."""

from __future__ import annotations

from typing import Iterable, Optional


def summarize(values: Iterable[Optional[float]]) -> Optional[tuple[float, float, float]]:
    """Return (min, max, average) of the non-None values, or None if empty."""
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return (min(vals), max(vals), sum(vals) / len(vals))
