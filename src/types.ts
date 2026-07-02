/**
 * Canonical data contract shared by every part of perfhound.
 *
 * Collectors and the aggregator only ever exchange Sample[].
 * The aggregator and every report renderer only ever exchange PerfReport.
 * Collection and presentation never talk to each other directly.
 */

export type Platform = 'android';

export type MetricName = 'fps' | 'cpu' | 'memory';

/** One raw measurement. FPS collectors emit one per frame; CPU/memory collectors emit one per poll. */
export interface Sample {
  /** epoch ms */
  t: number;
  value: number;
}

export interface MetricStats {
  unit: string;
  /** false when zero samples were captured for the window (e.g. no frames rendered) */
  available: boolean;
  sampleCount: number;
  avg: number | null;
  /** 1st percentile (low tail) */
  p1: number | null;
  /** 99th percentile (high tail) */
  p99: number | null;
}

/** The canonical, versioned JSON artifact. HTML (and any future renderer) is just a reader of this. */
export interface PerfReport {
  schemaVersion: 1;
  label: string;
  platform: Platform;
  startedAt: number;
  stoppedAt: number;
  durationMs: number;
  metrics: Partial<Record<MetricName, MetricStats>>;
  warnings: string[];
}

/**
 * Shared shape for every metric collector. FPS is event-based (one sample per frame);
 * CPU/memory are interval-sampled (one sample per poll) — both conform to this same interface.
 */
export interface Collector {
  readonly name: MetricName;
  readonly unit: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  /** Returns and clears all samples buffered since the last flush(). */
  flush(): Sample[];
}

export interface PerfhoundConfig {
  /** Directory reports are written to. Default: './perfhound-report' */
  outputDir?: string;
  /** Whether to also render an HTML report alongside the JSON. Default: true */
  html?: boolean;
  /** adb -s <deviceId>. Omit to let adb pick the sole connected device. */
  deviceId?: string;
  /** Android package under test. Required for CPU/memory collection. */
  packageName?: string;
  /** Poll interval for CPU/memory/FPS sampling, in ms. Default: 1000 */
  sampleIntervalMs?: number;
}

export interface ResolvedPerfhoundConfig {
  outputDir: string;
  html: boolean;
  deviceId?: string;
  packageName?: string;
  sampleIntervalMs: number;
}

export const DEFAULT_CONFIG: Omit<ResolvedPerfhoundConfig, 'deviceId' | 'packageName'> = {
  outputDir: './perfhound-report',
  html: true,
  sampleIntervalMs: 1000,
};

export function resolveConfig(config: PerfhoundConfig = {}): ResolvedPerfhoundConfig {
  return { ...DEFAULT_CONFIG, ...config };
}
