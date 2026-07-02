# perfhound

In-pipeline performance capture for WebdriverIO + Appium. `perfhound` watches Android FPS, CPU,
and memory while your existing WDIO tests run, and turns raw samples into a percentile-based
report — JSON first, HTML for humans.

## Why not just use PerfDog?

[PerfDog](https://perfdog.qq.com/) is a capable standalone profiler, but it's a separate desktop
app: you run it by hand, alongside your test run, and stitch the results together yourself
afterward. `perfhound` takes a different position:

| | PerfDog | perfhound |
|---|---|---|
| Where it runs | Standalone desktop app | Inside your WDIO test lifecycle |
| Versioning | Not code | Lives in your repo, versioned with your tests |
| Cost | Commercial license | Free, MIT |
| Output | Proprietary session format | Plain JSON (canonical) + HTML (a reader of it) |
| CI | Not designed for it | Runs headless in any pipeline that runs your WDIO suite |

You lose PerfDog's live desktop UI and its breadth of non-Android/non-perf features. You gain a
metric that's captured automatically on every test run, attributable to a specific test label,
and diffable in version control like any other artifact.

## Install

```sh
npm install --save-dev perfhound
```

`webdriverio` and `@wdio/globals` are peer dependencies — `perfhound` uses whatever version of
WebdriverIO your project already has instead of bundling its own.

Requires [`adb`](https://developer.android.com/tools/adb) on `PATH` and a connected/authorized
Android device or emulator. If `adb` isn't found, `perfhound` logs one warning and still produces
a report — just without FPS/CPU/memory data (see [Graceful degradation](#graceful-degradation)).

## Quickstart

Register the service in `wdio.conf.ts`:

```ts
import PerfhoundService from 'perfhound/service';

export const config: WebdriverIO.Config = {
  // ...
  services: [
    [
      PerfhoundService,
      {
        packageName: 'com.example.app', // required for FPS/CPU/memory
        outputDir: './perfhound-report', // default shown
        html: true, // also render <label>.html, default true
      },
    ],
  ],
};
```

Sample around the interaction you care about:

```ts
it('renders the product list without stuttering', async () => {
  await browser.startPerfSample('product-list-scroll');

  await $('#product-list').scrollIntoView();
  // ... exercise the flow under test ...

  const report = await browser.stopPerfSample();
  console.log(report.metrics.fps); // { unit: 'fps', available: true, avg, p1, p99, sampleCount }
});
```

Each call writes `<outputDir>/<label>.json` (the canonical artifact) and, unless `html: false`,
`<outputDir>/<label>.html` (a static, dependency-free report you can open directly or publish as
a CI test artifact).

## The data contract

Everything downstream of collection reads the same `PerfReport` JSON shape (see
[`src/types.ts`](src/types.ts)). Three metrics — `fps`, `cpu`, `memory` — each report `avg`, `p1`
(1% low), and `p99` (1% high). The percentile math is symmetric, but what's meaningful isn't:

- **FPS** highlights **p1** (1% low) — the headline stat is stutter, not occasional high-fps bursts.
- **CPU** and **memory** highlight **p99** (1% high) — the headline stat is spikes and leak risk,
  not idle-tail lows.

The HTML renderer encodes this asymmetry; the JSON always carries all three stats per metric so
you're free to build your own dashboards on top of it.

## Graceful degradation

`perfhound` is built to never take down your test run:

- No `adb` on `PATH` → one warning at service startup, report generated without those metrics.
- No `packageName` configured → same: a warning, and a report with no metric data.
- Zero frames captured in a sample window → that metric is reported as `available: false`, never `NaN`.
- Calling `startPerfSample()` twice without a `stopPerfSample()` in between throws immediately,
  naming the still-open label, so you find the bug in your test rather than silently losing data.

## What's implemented in v1

- **Aggregator** (`src/aggregator/index.ts`): real, tested percentile math — this is the only
  piece of logic with no device-dependent seams.
- **Service** (`src/service/index.ts`): full WDIO lifecycle wiring, command registration, collector
  orchestration, JSON + HTML output, and all edge cases above.
- **HTML renderer** (`src/report/html.ts`): pure `PerfReport -> string`, no dependencies.
- **Collectors** (`src/collectors/*.ts`): interface, lifecycle (start/stop/flush), and adb
  plumbing are real. The actual `dumpsys` output parsing is a documented `// TODO` in each file —
  each stub cites the exact raw shape it needs to parse (`gfxinfo framestats` for FPS, `cpuinfo` /
  `/proc/<pid>/stat` for CPU, `meminfo` PSS for memory) so finishing it is a parsing exercise
  against known output, not a design problem.

## Roadmap (deliberately out of scope for v1)

- **iOS support.** The `Collector` interface is platform-agnostic by design, but no iOS collector
  (Instruments/`xcrun`-based) exists yet. `PerfReport.platform` is typed for exactly one value
  (`'android'`) today — widening it is the seam.
- **Allure adapter.** `PerfReport` is a stable JSON contract; an Allure attachment/plugin that
  reads it and renders it inside an existing Allure report is a natural v2 addition, not built here.

Both are excluded on purpose, not overlooked — the JSON contract is designed so neither requires
touching the aggregator or the existing Android collectors.

## Scripts

```sh
npm run build          # tsc -> dist/, with .d.ts declarations
npm test               # runs the aggregator unit tests
npm pack --dry-run     # inspect exactly what would be published
```
