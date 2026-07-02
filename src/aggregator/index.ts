import type { MetricName, MetricStats, PerfReport, Platform, Sample } from '../types.js';

export interface AggregatorInput {
  label: string;
  platform?: Platform;
  /** epoch ms when startPerfSample() was called */
  startedAt: number;
  /** epoch ms when stopPerfSample() was called */
  stoppedAt: number;
  samplesByMetric: Partial<Record<MetricName, Sample[]>>;
  units: Partial<Record<MetricName, string>>;
  warnings?: string[];
}

/**
 * Nearest-rank percentile over an ascending-sorted array.
 * p1 on an ascending array is the low tail; p99 is the high tail.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    throw new Error('percentile() requires at least one value');
  }
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[index] as number;
}

export function computeStats(samples: Sample[], unit: string): MetricStats {
  if (samples.length === 0) {
    return { unit, available: false, sampleCount: 0, avg: null, p1: null, p99: null };
  }

  const values = samples.map((s) => s.value).sort((a, b) => a - b);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

  return {
    unit,
    available: true,
    sampleCount: values.length,
    avg,
    p1: percentile(values, 1),
    p99: percentile(values, 99),
  };
}

/** Reconciles raw per-metric samples captured within a [startedAt, stoppedAt] window into the canonical PerfReport. */
export function buildReport(input: AggregatorInput): PerfReport {
  const metrics: PerfReport['metrics'] = {};

  for (const name of Object.keys(input.samplesByMetric) as MetricName[]) {
    const samples = input.samplesByMetric[name] ?? [];
    const unit = input.units[name] ?? '';
    metrics[name] = computeStats(samples, unit);
  }

  return {
    schemaVersion: 1,
    label: input.label,
    platform: input.platform ?? 'android',
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt,
    durationMs: input.stoppedAt - input.startedAt,
    metrics,
    warnings: input.warnings ?? [],
  };
}
