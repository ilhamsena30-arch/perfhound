import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, computeStats } from '../src/aggregator/index.js';

test('computeStats computes avg, p1 (low tail), and p99 (high tail) for a known sample set', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  const samples = values.map((value, i) => ({ t: i, value }));

  const stats = computeStats(samples, 'fps');

  assert.equal(stats.available, true);
  assert.equal(stats.sampleCount, 100);
  assert.equal(stats.avg, 50.5);
  assert.equal(stats.p1, 1);
  assert.equal(stats.p99, 99);
  assert.equal(stats.unit, 'fps');
});

test('computeStats is order-independent (sorts before computing percentiles)', () => {
  const shuffled = [42, 5, 91, 17, 3, 99, 1, 60].map((value, i) => ({ t: i, value }));
  const sorted = computeStats(
    [...shuffled].sort((a, b) => a.value - b.value),
    '%',
  );
  const unsorted = computeStats(shuffled, '%');

  assert.deepEqual(unsorted, sorted);
});

test('computeStats reports a metric as unavailable, not NaN, when zero samples were captured', () => {
  const stats = computeStats([], 'fps');

  assert.equal(stats.available, false);
  assert.equal(stats.sampleCount, 0);
  assert.equal(stats.avg, null);
  assert.equal(stats.p1, null);
  assert.equal(stats.p99, null);
});

test('buildReport aggregates multiple metrics into a single canonical PerfReport', () => {
  const report = buildReport({
    label: 'checkout-flow',
    startedAt: 1_000,
    stoppedAt: 6_000,
    samplesByMetric: {
      fps: [
        { t: 0, value: 60 },
        { t: 16, value: 58 },
        { t: 32, value: 12 },
      ],
      cpu: [],
    },
    units: { fps: 'fps', cpu: '%' },
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.label, 'checkout-flow');
  assert.equal(report.platform, 'android');
  assert.equal(report.durationMs, 5_000);
  assert.equal(report.metrics.fps?.available, true);
  assert.equal(report.metrics.fps?.sampleCount, 3);
  assert.equal(report.metrics.cpu?.available, false);
  assert.equal(report.metrics.memory, undefined);
  assert.deepEqual(report.warnings, []);
});

test('buildReport carries warnings through untouched', () => {
  const report = buildReport({
    label: 'no-adb',
    startedAt: 0,
    stoppedAt: 1,
    samplesByMetric: {},
    units: {},
    warnings: ['adb was unavailable; FPS/CPU/memory were not collected.'],
  });

  assert.deepEqual(report.warnings, ['adb was unavailable; FPS/CPU/memory were not collected.']);
});
