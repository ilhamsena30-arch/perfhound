import { BaseCollector } from './collector.js';
import { adbShell, type AdbOptions } from './adb.js';

export interface FpsCollectorOptions extends AdbOptions {
  packageName: string;
  /** How often to poll for new frame data, in ms. Default: 1000 */
  intervalMs?: number;
}

/**
 * Event-based: emits one Sample per rendered frame — { t: frame time (ms), value: instantaneous fps }.
 * Low `value`s are what make FPS's 1% LOW tail the headline stat (stutter), unlike CPU/memory.
 *
 * TODO: parse `adb shell dumpsys gfxinfo <package> framestats`.
 *
 * Raw output shape (relevant slice, repeated per profiled window):
 *
 *   ---PROFILEDATA---
 *   Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,
 *   PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameCompleted,SyncQueued,SyncStart,
 *   IssueDrawCommandsStart,SwapBuffers,FrameCompleted
 *   0,1234567890123,1234567890456,0,0,1234567891000,1234567891050,...
 *   0,1234567906789,1234567907012,0,0,1234567907300,1234567907350,...
 *   ---PROFILEDATA---
 *
 * All values after the header row are nanoseconds since boot. For each data row:
 *   durationMs = (FrameCompleted - IntendedVsync) / 1e6
 *   Sample.value = 1000 / durationMs   (instantaneous fps for that frame)
 *   Sample.t     = Date.now() at poll time is an acceptable approximation; a precise wall-clock
 *                  timestamp requires anchoring IntendedVsync (ns since boot) to a boot-time offset.
 * Skip the header row and any row where FrameCompleted or IntendedVsync is 0.
 */
export class FpsCollector extends BaseCollector {
  readonly name = 'fps' as const;
  readonly unit = 'fps';

  private timer?: NodeJS.Timeout;

  constructor(private readonly options: FpsCollectorOptions) {
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
      await adbShell(['dumpsys', 'gfxinfo', this.options.packageName, 'framestats'], {
        deviceId: this.options.deviceId,
      });
      // TODO: parse the framestats CSV rows described above and this.record() one Sample per frame.
    } catch {
      // Swallow: the owning service already warns once when adb is unavailable.
    }
  }
}
