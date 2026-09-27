# perfhound

A Python library that records mobile app performance metrics — **CPU time**, **memory**, and **FPS** — of the main process of Android and iOS apps. Usable programmatically (including inside Appium tests) or manually from the CLI.

## Install

```bash
pip install perfhound
```

## Quick start (Python)

```python
from perfhound import start_recording

rec = start_recording(device_id="ABC123", package="com.example.app")
# ... run your appium test steps ...
rec.stop("results.csv")
```

Reduce the recorded stats (down to one):

```python
rec = start_recording("ABC123", "com.example.app", metrics=["cpu"])
```

## CLI

```bash
perfhound start ABC123 com.example.app --out results.csv
# ... exercise the app ...
perfhound end --out results.csv
```

## Output

The CSV contains a summary block (min / max / average per stat) plus a raw time-series with timestamps:

| metric | unit | min | max | average |
|--------|------|-----|-----|---------|
| cpu_time_ms | ms | 12.0 | 340.0 | 120.5 |
| memory_mb | MB | 184.2 | 210.1 | 196.3 |
| fps | frames/sec | 0 | 60.0 | 41.7 |

## Metric collection

- **CPU time** — Android: `/proc/<pid>/stat` `utime`+`stime` deltas; iOS: `xctrace` attached to the main process.
- **Memory** — Android: PSS from `dumpsys meminfo`; iOS: `xctrace`. Standardized to MB.
- **FPS** — Android: `gfxinfo` frame-stats (reset at start); iOS: `xctrace` Core Animation. Best-effort.

iOS recording requires a macOS host with Xcode command-line tools.

## Development

```bash
pip install -e ".[dev]"
pytest
```