import { BaseCollector } from './collector.js';
import { adbShell, type AdbOptions } from './adb.js';

export interface MemoryCollectorOptions extends AdbOptions {
  packageName: string;
  /** Polling interval, in ms. Default: 1000 */
  intervalMs?: number;
}

/**
 * Interval-sampled: emits one Sample per poll — { t: poll time (ms), value: PSS in MB for the app process }.
 * High `value`s are what make memory's 1% HIGH tail the headline stat (leak risk); the low tail is meaningless.
 *
 * TODO: parse `adb shell dumpsys meminfo <package>`.
 *
 * Raw output shape (whitespace-aligned table, values in KB):
 *
 *   ** MEMINFO in pid 1234 [com.example.app] **
 *                    Pss  Private  Private  SwapPss     Rss     Heap     Heap     Heap
 *                  Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
 *                  ------   ------   ------   ------   ------   ------   ------   ------
 *      Native Heap    12345     ...
 *      Dalvik Heap       678     ...
 *      ...
 *             TOTAL    98765      ...
 *
 * Sample.value = the "TOTAL" row's Pss Total column (KB) / 1024, converted to MB.
 */
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
      await adbShell(['dumpsys', 'meminfo', this.options.packageName], {
        deviceId: this.options.deviceId,
      });
      // TODO: parse the TOTAL row's Pss Total column (KB) described above and
      // this.record({ t: Date.now(), value: kb / 1024 }).
    } catch {
      // Swallow: the owning service already warns once when adb is unavailable.
    }
  }
}
