import csv

from perfhound.csv_writer import write_csv
from perfhound.model import Metric, Sample


def test_write_csv_summary_and_timeseries(tmp_path):
    samples = [
        Sample(timestamp=0.0, cpu_time_ms=10.0, memory_mb=100.0, fps=60.0),
        Sample(timestamp=1.0, cpu_time_ms=20.0, memory_mb=110.0, fps=30.0),
        Sample(timestamp=2.0, cpu_time_ms=30.0, memory_mb=120.0, fps=45.0),
    ]
    path = tmp_path / "out.csv"
    write_csv(str(path), samples, (Metric.CPU, Metric.MEMORY, Metric.FPS))

    rows = list(csv.reader(path.open()))
    # Summary block
    assert rows[0] == ["# summary"]
    assert rows[1] == ["metric", "unit", "min", "max", "average"]
    summary = {r[0]: r for r in rows[2:5]}
    assert summary["cpu_time_ms"] == ["cpu_time_ms", "ms", "10.000", "30.000", "20.000"]
    assert summary["memory_mb"] == ["memory_mb", "MB", "100.000", "120.000", "110.000"]
    assert summary["fps"] == ["fps", "frames/sec", "30.000", "60.000", "45.000"]

    # Time series block
    assert rows[5] == []
    assert rows[6] == ["# timeseries"]
    assert rows[7] == ["timestamp", "cpu_time_ms", "memory_mb", "fps"]
    assert rows[8] == ["0.000", "10.000", "100.000", "60.000"]


def test_write_csv_respects_metric_subset(tmp_path):
    samples = [Sample(timestamp=0.0, cpu_time_ms=10.0, memory_mb=100.0, fps=60.0)]
    path = tmp_path / "out.csv"
    write_csv(str(path), samples, (Metric.CPU,))

    rows = list(csv.reader(path.open()))
    # Only cpu column in timeseries header.
    assert rows[5] == ["timestamp", "cpu_time_ms"]
    assert rows[6] == ["0.000", "10.000"]


def test_write_csv_empty_cells_for_missing(tmp_path):
    samples = [Sample(timestamp=0.0, cpu_time_ms=None, memory_mb=100.0, fps=None)]
    path = tmp_path / "out.csv"
    write_csv(str(path), samples, (Metric.CPU, Metric.MEMORY, Metric.FPS))

    rows = list(csv.reader(path.open()))
    summary = {r[0]: r for r in rows[2:5]}
    # CPU has no values -> empty summary cells, not fabricated numbers.
    assert summary["cpu_time_ms"] == ["cpu_time_ms", "ms", "", "", ""]
    # Timeseries row: missing values are empty strings.
    assert rows[8] == ["0.000", "", "100.000", ""]
