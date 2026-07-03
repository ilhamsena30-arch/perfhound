import { BaseCollector } from './collector.js';
import { adbShell, type AdbOptions } from './adb.js';

export interface CpuCollectorOptions extends AdbOptions {
  packageName: string;
  /** Polling interval, in ms. Default: 1000 */
  intervalMs?: number;
}

/**
 * Parses `adb shell dumpsys cpuinfo` output for a single process line's CPU %.
 *
 * Verified against a real device — one line per process:
 *
 *   14% 532/system_server: 7.3% user + 6.9% kernel / faults: 410342 minor 24630 major
 *   0.6% 2735/com.google.android.youtube: 0.3% user + 0.2% kernel / faults: 25143 minor 7047 major
 *
 * i.e. `<total%> <pid>/<processName>: <user%> user + <kernel%> kernel / faults: ...`. This is
 * system-wide (all processes) and coarser than /proc/<pid>/stat deltas, but requires no pid
 * lookup or double-poll state — a reasonable v1 tradeoff. A precise per-process alternative is
 * to read `/proc/<pid>/stat` (space-separated fields; utime is field 14, stime is field 15) at
 * two points in time and compute:
 *   ticks = (utime2 + stime2) - (utime1 + stime1)
 *   CPU%  = ticks / ((elapsedMs / 1000) * USER_HZ) * 100   where USER_HZ is typically 100 on Android
 *
 * Returns null if the package has no matching line (e.g. it isn't running, or used <0.1% CPU
 * and cpuinfo omitted it for this window).
 */
export function parseCpuInfo(output: string, packageName: string): number | null {
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^([\d.]+)%\s+\d+\/(\S+):/);
    if (!match) continue;
    if (match[2] !== packageName) continue;
    return Number(match[1]);
  }
  return null;
}
export class CpuCollector extends BaseCollector {
  readonly name = 'cpu' as const;
  readonly unit = '%';

  private timer?: NodeJS.Timeout;

  constructor(private readonly options: CpuCollectorOptions) {
    super();
  }

  start(): void {
    const intervalMs = this.options.intervalMs ?? 1000;
    this.timer = setInterval(() => {
      void this.poll();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    try {
      const output = await adbShell(['dumpsys', 'cpuinfo'], { deviceId: this.options.deviceId });
      const percent = parseCpuInfo(output, this.options.packageName);
      if (percent !== null) {
        this.record({ t: Date.now(), value: percent });
      }
    } catch {
      // Swallow: the owning service already warns once when adb is unavailable.
    }
  }
}
