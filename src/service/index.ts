import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Capabilities, Services } from '@wdio/types';
import type { Browser } from 'webdriverio';
import { buildReport } from '../aggregator/index.js';
import { isAdbAvailable } from '../collectors/adb.js';
import type { Collector } from '../collectors/collector.js';
import { CpuCollector } from '../collectors/cpu.js';
import { FpsCollector } from '../collectors/fps.js';
import { MemoryCollector } from '../collectors/memory.js';
import { renderHtmlReport } from '../report/html.js';
import {
  resolveConfig,
  type MetricName,
  type PerfhoundConfig,
  type PerfReport,
  type ResolvedPerfhoundConfig,
  type Sample,
} from '../types.js';

interface OpenSample {
  label: string;
  startedAt: number;
  collectors: Collector[];
}

/**
 * The service only decides WHEN to sample — it delegates all measurement to collectors.
 * Registers `browser.startPerfSample(label)` / `browser.stopPerfSample()` and owns collector lifecycle.
 */
export class PerfhoundService implements Services.ServiceInstance {
  private readonly resolvedConfig: ResolvedPerfhoundConfig;
  private adbAvailable = true;
  private open: OpenSample | undefined;

  constructor(options: PerfhoundConfig = {}) {
    this.resolvedConfig = resolveConfig(options);
  }

  async before(
    _capabilities: Capabilities.RequestedStandaloneCapabilities | Capabilities.RequestedMultiremoteCapabilities,
    _specs: string[],
    browser: Browser,
  ): Promise<void> {
    this.adbAvailable = await isAdbAvailable();
    if (!this.adbAvailable) {
      // Edge case: missing adb must degrade gracefully, never crash the host test run.
      console.warn(
        '[perfhound] adb was not found on PATH — FPS/CPU/memory collection is disabled for this run.',
      );
    }

    browser.addCommand('startPerfSample', (label: string) => this.startPerfSample(label));
    browser.addCommand('stopPerfSample', () => this.stopPerfSample());
  }

  private async startPerfSample(label: string): Promise<void> {
    if (this.open) {
      // Edge case: calling startPerfSample twice without a stop must throw, naming the open label.
      throw new Error(
        `[perfhound] startPerfSample("${label}") was called while "${this.open.label}" is still open. ` +
          'Call stopPerfSample() before starting a new sample.',
      );
    }

    const collectors = this.createCollectors();
    // Mark the sample open synchronously, before any await, so a second call made before this
    // one's async collector startup finishes still sees `this.open` and throws (no start/start race).
    this.open = { label, startedAt: Date.now(), collectors };

    // Some collectors (e.g. FpsCollector) do an async baseline read before they start polling.
    await Promise.all(collectors.map((collector) => collector.start()));
  }

  private async stopPerfSample(): Promise<PerfReport> {
    if (!this.open) {
      throw new Error('[perfhound] stopPerfSample() was called with no open startPerfSample() label.');
    }

    const { label, startedAt, collectors } = this.open;
    this.open = undefined;

    for (const collector of collectors) {
      await collector.stop();
    }

    const samplesByMetric: Partial<Record<MetricName, Sample[]>> = {};
    const units: Partial<Record<MetricName, string>> = {};
    for (const collector of collectors) {
      samplesByMetric[collector.name] = collector.flush();
      units[collector.name] = collector.unit;
    }

    const report = buildReport({
      label,
      startedAt,
      stoppedAt: Date.now(),
      samplesByMetric,
      units,
      warnings: this.collectWarnings(),
    });

    await this.writeReport(report);
    return report;
  }

  private createCollectors(): Collector[] {
    if (!this.adbAvailable || !this.resolvedConfig.packageName) {
      return [];
    }

    const shared = { packageName: this.resolvedConfig.packageName, deviceId: this.resolvedConfig.deviceId };
    return [
      new FpsCollector({ ...shared, intervalMs: this.resolvedConfig.sampleIntervalMs }),
      new CpuCollector({ ...shared, intervalMs: this.resolvedConfig.sampleIntervalMs }),
      new MemoryCollector({ ...shared, intervalMs: this.resolvedConfig.sampleIntervalMs }),
    ];
  }

  private collectWarnings(): string[] {
    const warnings: string[] = [];
    if (!this.adbAvailable) {
      warnings.push('adb was unavailable; FPS/CPU/memory were not collected.');
    } else if (!this.resolvedConfig.packageName) {
      warnings.push('perfhound "packageName" was not configured; FPS/CPU/memory were not collected.');
    }
    return warnings;
  }

  private async writeReport(report: PerfReport): Promise<void> {
    await mkdir(this.resolvedConfig.outputDir, { recursive: true });

    const jsonPath = path.join(this.resolvedConfig.outputDir, `${report.label}.json`);
    await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    if (this.resolvedConfig.html) {
      const htmlPath = path.join(this.resolvedConfig.outputDir, `${report.label}.html`);
      await writeFile(htmlPath, renderHtmlReport(report), 'utf-8');
    }
  }
}

export default PerfhoundService;

declare global {
  namespace WebdriverIO {
    interface Browser {
      /** Starts collecting FPS/CPU/memory samples under `label`. Throws if a sample is already open. */
      startPerfSample(label: string): Promise<void>;
      /** Stops the open sample, writes <label>.json (+ optional HTML), and returns the PerfReport. */
      stopPerfSample(): Promise<PerfReport>;
    }
  }
}
