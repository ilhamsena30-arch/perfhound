"""CSV output: a summary block plus a raw time series."""

from __future__ import annotations

import csv
from typing import Optional, Sequence

from .model import Metric, Sample
from .stats import summarize

UNITS = {
    Metric.CPU.value: "ms",
    Metric.MEMORY.value: "MB",
    Metric.FPS.value: "frames/sec",
}

_METRIC_ORDER = (Metric.CPU, Metric.MEMORY, Metric.FPS)


def _fmt(value: Optional[float]) -> str:
    return "" if value is None else f"{value:.3f}"


def write_csv(path: str, samples: Sequence[Sample], metrics: Sequence[Metric]) -> None:
    """Write samples to a CSV with a summary block and a raw time series.

    Only the requested metrics (in canonical order) appear as columns. Missing
    per-sample values are written as empty cells rather than fabricated numbers.
    """
    columns = [m for m in _METRIC_ORDER if m in metrics]

    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)

        # Summary block: one row per stat with min / max / average.
        writer.writerow(["# summary"])
        writer.writerow(["metric", "unit", "min", "max", "average"])
        for metric in columns:
            summary = summarize(getattr(s, metric.value) for s in samples)
            if summary is None:
                writer.writerow([metric.value, UNITS[metric.value], "", "", ""])
            else:
                low, high, avg = summary
                writer.writerow(
                    [metric.value, UNITS[metric.value], _fmt(low), _fmt(high), _fmt(avg)]
                )

        writer.writerow([])

        # Raw time series.
        writer.writerow(["# timeseries"])
        writer.writerow(["timestamp"] + [m.value for m in columns])
        for sample in samples:
            writer.writerow(
                [f"{sample.timestamp:.3f}"] + [_fmt(getattr(sample, m.value)) for m in columns]
            )
