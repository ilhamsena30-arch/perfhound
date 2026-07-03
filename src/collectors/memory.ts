import { BaseCollector } from './collector.js';
import { adbShell, type AdbOptions } from './adb.js';

export interface MemoryCollectorOptions extends AdbOptions {
  packageName: string;
  /** Polling interval, in ms. Default: 1000 */
  intervalMs?: number;
}

/**
 * Parses `adb shell dumpsys meminfo <package>` output for the process's total PSS, in MB.
 *
 * Verified against a real device — raw shape (whitespace-aligned table, values in KB):
 *
 *   ** MEMINFO in pid 2735 [com.google.android.youtube] **
 *                    Pss  Private  Private  SwapPss     Rss     Heap     Heap     Heap
 *                  Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
 *                  ------   ------   ------   ------   ------   ------   ------   ------
 *      Native Heap     4000     2716     1276    21923     4708    41276    33023     3499
 *      ...
 *          TOTAL    97508     7336    36716    50252    98368    66552    45661    16137
 *   ...
 *    App Summary
 *   ...
 *              TOTAL PSS:    97508            TOTAL RSS:    98368       TOTAL SWAP PSS:    50252
 *
 * There are two "TOTAL"-prefixed lines — the raw table's `TOTAL <Pss Total> ...` row (wanted)
 * and the App Summary's `TOTAL PSS: <n> ...` line (must NOT match). Anchoring on "TOTAL" followed
 * by whitespace then a digit (not "PSS:") disambiguates them.
 *
 * Returns null if no matching TOTAL row is found (e.g. the package isn't running).
 */
export function parseMeminfoPssMb(output: string): number | null {
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^TOTAL\s+(\d+)/);
    if (!match) continue;
    return Number(match[1]) / 1024;
  }
  return null;
}
export class MemoryCollector extends BaseCollector {
  readonly name = 'memory' as const;
  readonly unit = 'MB';

  private timer?: NodeJS.Timeout;

  constructor(private readonly options: MemoryCollectorOptions) {
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
      const output = await adbShell(['dumpsys', 'meminfo', this.options.packageName], {
        deviceId: this.options.deviceId,
      });
      const pssMb = parseMeminfoPssMb(output);
      if (pssMb !== null) {
        this.record({ t: Date.now(), value: pssMb });
      }
    } catch {
      // Swallow: the owning service already warns once when adb is unavailable.
    }
  }
}
