import { BaseCollector } from './collector.js';
import { adbShell, type AdbOptions } from './adb.js';

export interface CpuCollectorOptions extends AdbOptions {
  packageName: string;
  /** Polling interval, in ms. Default: 1000 */
  intervalMs?: number;
}

/**
 * Interval-sampled: emits one Sample per poll — { t: poll time (ms), value: CPU % for the app process }.
 * High `value`s are what make CPU's 1% HIGH tail the headline stat (spikes); the low tail is meaningless.
 *
 * TODO: parse `adb shell cat /proc/<pid>/stat` deltas (preferred, per-process, precise), or fall back
 * to `adb shell dumpsys cpuinfo` (system-wide, coarser, no per-process pid lookup required).
 *
 * dumpsys cpuinfo shape (one line per process):
 *   9.9% 1234:com.example.app/u0a123: 5.2% user + 4.7% kernel
 *
 * /proc/<pid>/stat shape (space-separated fields, 1-indexed per `man proc`):
 *   pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt
 *   utime(14) stime(15) cutime cstime priority nice num_threads itrealvalue starttime(22) ...
 *
 * CPU% between two polls at utime/stime pairs (u1,s1) and (u2,s2), elapsedMs apart:
 *   ticks    = (u2 + s2) - (u1 + s1)
 *   CPU%     = ticks / ((elapsedMs / 1000) * USER_HZ) * 100   where USER_HZ is typically 100 on Android
 */
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
      await adbShell(['dumpsys', 'cpuinfo'], { deviceId: this.options.deviceId });
      // TODO: locate this.options.packageName's line (or /proc/<pid>/stat deltas), parse the
      // percentage described above, and this.record({ t: Date.now(), value: percent }).
    } catch {
      // Swallow: the owning service already warns once when adb is unavailable.
    }
  }
}
