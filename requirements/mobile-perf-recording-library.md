# Mobile Performance Recording Library

## Overview

A Python library that records performance metrics (CPU time, memory, FPS) of the main process of mobile apps on Android and iOS devices, usable both programmatically from Python (including inside Appium tests) and manually from a CLI. The library is distributed via PyPI/pip and writes results to CSV.

## Goals

- Record CPU time, memory, and FPS of the main process of a running app on a connected Android or iOS device.
- Usable two ways: as an imported Python library and as a standalone CLI.
- Produce a CSV output containing a summary (min/max/average per stat) plus a raw time-series for graphing.
- Work with only the device uid and app package as required inputs.
- Be parallel-safe when used programmatically.

## Users

- **Test automation engineers** — import the library into Python/Appium tests to capture performance during test execution.
- **Manual QA / developers** — start and stop a recording from a terminal while manually exercising the app.
- **Downstream tooling** — consumes the CSV output for reporting, charting, or CI dashboards.

## Functional Requirements

### Distribution

- The library must be installable via `pip` (published to PyPI or installable from a wheel/sdist).
- Python is the only supported language for now.

### Metrics

- Default recorded stats: **CPU time**, **Memory**, **FPS**.
- The set of stats must be reducible via an argument, to a minimum of 1 stat (e.g. CPU only).
- **CPU is recorded as CPU time, not a percentage**, on both platforms (see Metric Collection).
- Metrics track the app's **main process only** (the primary pid for the package); child/secondary processes are out of scope.

### Metric Collection

- **CPU time**
  - **iOS**: via `xcrun xctrace record` attached to the app's **main process only**, using `--attach <pid>` (not `XCTCPUMetric`, which is XCTest-only and cannot attach to a running app from a host-side library). CPU time is scoped to that single process, matching the Android `/proc/<pid>/stat` behavior. The pid is resolved from the app bundle on the device at recording start.
  - **Android**: read cumulative CPU time from `/proc/<pid>/stat` (fields `utime` + `stime`, in clock ticks), converted to milliseconds. Each sample records the CPU time consumed during the sampling interval (the delta between consecutive reads). The main-process pid is resolved from the package at start.
- **Memory**
  - Standardized to **MB** in the CSV on both platforms.
  - **iOS**: via `xctrace` (Allocations/VM-tracking template) attached to the app's **main process only** (`--attach <pid>`).
  - **Android**: via `adb shell dumpsys meminfo <package>` PSS total, converted from kB to MB.
- **FPS**
  - **Android**: reset frame stats at recording start with `adb shell dumpsys gfxinfo <package> reset`, then sample `adb shell dumpsys gfxinfo <package> framestats` and derive the frame rate per interval. Best-effort; may read 0 when the app is not actively rendering.
  - **iOS**: via `xctrace` Core Animation frame-rate data, attached to the app's main process. Best-effort.

### iOS Process Scoping (pinned)

- iOS metrics are scoped to the app's **main process only**, via `xctrace`'s `--attach <pid>`.
- `XCTCPUMetric` is explicitly **not used**: it is an XCTest-only API that runs inside a performance-test `measure` block on the device, and cannot attach to an already-running app from a host-side Python library. Its scoping (current process / `XCUIApplication` / current thread) is irrelevant to this library's design.
- The main-process pid is resolved from the app bundle identifier on the device immediately before the trace starts; if the process is not running at that moment, recording fails loudly (matching Android, which also fails loudly when `/proc/<pid>` is unavailable).

### Automation (Python API)

- The library exposes a session-object API:
  ```python
  rec = start_recording(device_id="<uid>", package="com.example.app", ...)
  # ... run appium test steps ...
  rec.stop("results.csv")
  ```
- Required inputs to start: device **uid** and **app package**.
- Multiple recording sessions (different devices) may be active simultaneously; each `start_recording(...)` call returns an independent session handle.
- A stopped session must finalize and write its output file; a session that is never stopped must not leave device-side monitoring running (see auto-timeout).

### Manual (CLI)

- A `start` command that takes the device **uid** and **app package** as required arguments.
- An `end` command that stops the recording; no arguments are required to end.
- One recording per terminal process (natural, since the CLI is a foreground process).
- CLI output is the same CSV format as the Python API.

### Recording lifecycle

- Recording starts when explicitly started and ends when explicitly stopped.
- If the user passes a `max_duration` argument, the recording auto-stops after that duration even without an explicit stop.
- If `max_duration` is not passed, there is no automatic cap; the recording continues until explicitly stopped.
- Sampling interval defaults to **1 second** and is configurable via an argument.

### Output (CSV)

- Output is a single CSV file containing:
  - A **summary block**: one row per stat with **min**, **max**, and **average** values.
  - A **raw time-series**: every sampled reading with a timestamp, suitable for graphing.
- Units are standard: CPU time in `ms` (per sample interval), memory in `MB`, FPS in `frames/sec`; units are indicated in the CSV header.
- Missing/unsupported values for a stat on a given platform are handled explicitly (empty cell or documented sentinel), never silently fabricated.

### Error handling

- If the device disconnects or a tool (`adb`/`xctrace`) fails mid-recording, the library must **fail loudly** (clear exception in Python, non-zero exit with a message in the CLI).
- On failure, any samples already collected up to the point of failure must be salvaged and written to the output file before the error is raised.

## Non-functional Requirements

- **Platform support**: Android via `adb`; iOS via `xcrun xctrace` only. iOS recording requires a macOS host.
- **Device connection**: any device visible to `adb`/`xctrace` (USB or wireless), keyed by its uid.
- **Performance**: sampling overhead on the host must be low enough not to materially skew the measured app.
- **Reliability**: no partial/empty files on a clean stop; no orphaned device-side sampling processes after a stop or timeout.
- **Usability**: minimal required inputs (uid + package); sensible defaults for everything else.
- **Compatibility**: works inside a Python/Appium test context without blocking the test thread indefinitely.

## Out of Scope

- Network-based distributed recording or a remote server/agent model.
- Languages other than Python.
- Rooting/jailbreaking devices to obtain privileged metrics.
- App-side instrumentation (the app under test is not modified).
- Real-time streaming dashboards or live charts (output is file-based CSV).
- Custom/exotic metrics beyond CPU, memory, and FPS in the initial version.
- iOS metrics via XCUITest (iOS uses `xctrace` only).
- Monitoring child/secondary processes of the app (main process only).
