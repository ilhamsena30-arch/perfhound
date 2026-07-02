import type { MetricName, MetricStats, PerfReport } from '../types.js';

const METRIC_LABELS: Record<MetricName, string> = {
  fps: 'Frame Rate',
  cpu: 'CPU Usage',
  memory: 'Memory (PSS)',
};

// The asymmetric percentile model: FPS highlights the LOW tail (stutter); CPU/memory highlight the HIGH tail (spikes/leaks).
const HEADLINE_PERCENTILE: Record<MetricName, 'p1' | 'p99'> = {
  fps: 'p1',
  cpu: 'p99',
  memory: 'p99',
};

const HEADLINE_CAPTION: Record<MetricName, string> = {
  fps: '1% Low (stutter)',
  cpu: '1% High (spikes)',
  memory: '1% High (leak risk)',
};

const METRIC_ORDER: MetricName[] = ['fps', 'cpu', 'memory'];

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return 'n/a';
  return `${value.toFixed(1)} ${unit}`.trim();
}

function renderMetricCard(name: MetricName, stats: MetricStats | undefined): string {
  const label = METRIC_LABELS[name];

  if (!stats || !stats.available) {
    return `
      <section class="card card--unavailable">
        <h2>${label}</h2>
        <p class="unavailable">No data collected</p>
      </section>`;
  }

  const headlineKey = HEADLINE_PERCENTILE[name];
  const headlineValue = stats[headlineKey];
  const headlineCaption = HEADLINE_CAPTION[name];

  return `
      <section class="card">
        <h2>${label}</h2>
        <div class="headline">
          <span class="headline-value">${formatValue(headlineValue, stats.unit)}</span>
          <span class="headline-caption">${headlineCaption}</span>
        </div>
        <dl class="stats">
          <dt>avg</dt><dd>${formatValue(stats.avg, stats.unit)}</dd>
          <dt>p1</dt><dd>${formatValue(stats.p1, stats.unit)}</dd>
          <dt>p99</dt><dd>${formatValue(stats.p99, stats.unit)}</dd>
          <dt>samples</dt><dd>${stats.sampleCount}</dd>
        </dl>
      </section>`;
}

/** Pure function: PerfReport in, standalone HTML string out. Never reads from disk or the network. */
export function renderHtmlReport(report: PerfReport): string {
  const cards = METRIC_ORDER.map((name) => renderMetricCard(name, report.metrics[name])).join('\n');

  const warnings = report.warnings.length
    ? `<ul class="warnings">${report.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
    : '';

  const label = escapeHtml(report.label);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>perfhound report — ${label}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; background: #0b0d12; color: #e7e9ee; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .meta { color: #9aa2b1; margin-bottom: 1.5rem; font-size: 0.9rem; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; }
  .card { background: #151822; border: 1px solid #262b3a; border-radius: 8px; padding: 1rem 1.25rem; min-width: 220px; }
  .card--unavailable { opacity: 0.6; }
  .card h2 { margin: 0 0 0.5rem; font-size: 1rem; }
  .headline { margin-bottom: 0.75rem; }
  .headline-value { font-size: 1.8rem; font-weight: 700; display: block; }
  .headline-caption { font-size: 0.75rem; color: #f2a65a; text-transform: uppercase; letter-spacing: 0.04em; }
  .stats { display: grid; grid-template-columns: auto auto; gap: 0.15rem 0.75rem; font-size: 0.85rem; color: #c3c8d4; margin: 0; }
  .stats dt { opacity: 0.6; }
  .unavailable { color: #6b7280; font-size: 0.85rem; }
  .warnings { color: #f2a65a; font-size: 0.85rem; margin-top: 1.5rem; }
</style>
</head>
<body>
  <h1>perfhound — ${label}</h1>
  <p class="meta">${report.platform} · ${report.durationMs}ms · schema v${report.schemaVersion}</p>
  <div class="cards">
    ${cards}
  </div>
  ${warnings}
</body>
</html>
`;
}
