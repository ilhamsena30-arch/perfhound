import { BaseCollector } from './collector.js';
import { adbShell, type AdbOptions } from './adb.js';
import type { Sample } from '../types.js';

export interface FpsCollectorOptions extends AdbOptions {
  packageName: string;
  /** How often to poll for new frame data, in ms. Default: 1000 */
  intervalMs?: number;
}

/**
 * Parses `adb shell dumpsys gfxinfo <package> framestats` output into per-frame Samples.
 *
 * Verified against a real device (Android 14 emulator) — the header/column layout below is
 * captured ground truth, not the idealized docs. Column order varies across Android versions
 * (older versions lack FrameTimelineVsyncId/InputEventId/FrameStartTime/DequeueBufferDuration),
 * so this looks up columns by name via the header row rather than hardcoding indices.
 *
 * Raw output shape (relevant slice, one block per profiled window):
 *
 *   ---PROFILEDATA---
 *   Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,
 *   PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,
 *   IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,
 *   GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted,
 *   1,12107,60992690934,61742690904,0,61757361487,...,62240967028,...
 *   ---PROFILEDATA---
 *
 * All values after the header row are nanoseconds since boot. For each data row:
 *   durationMs = (FrameCompleted - IntendedVsync) / 1e6
 *   value      = 1000 / durationMs   (instantaneous fps for that frame)
 * Skip rows where IntendedVsync or FrameCompleted is 0 (frame stats not yet populated).
 *
 * Caveat (confirmed against a real device): framestats is a ROLLING BUFFER of the app's last
 * ~120 frames — each poll re-reads it from the start, not "frames since the last poll". Polling
 * it naively double-counts the same frames across multiple polls and also picks up frames that
 * rendered before sampling even started. Callers must de-duplicate using `id` (IntendedVsync,
 * monotonically increasing per frame) — see FpsCollector, which seeds a baseline on start() and
 * only records frames with `id` greater than the highest one already seen.
 */
export interface FramestatsFrame {
  /** IntendedVsync (ns since boot) — monotonically increasing, used to de-duplicate across polls. */
  id: number;
  sample: Sample;
}

export function parseFramestats(output: string): FramestatsFrame[] {
  const frames: FramestatsFrame[] = [];
  let header: string[] | undefined;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === '---PROFILEDATA---') {
      header = undefined; // reset: the next non-empty line starts a new block's header
      continue;
    }
    if (!header) {
      header = line.split(',');
      continue;
    }

    const cols = line.split(',').map(Number);
    const intendedVsync = cols[header.indexOf('IntendedVsync')];
    const frameCompleted = cols[header.indexOf('FrameCompleted')];
    if (!intendedVsync || !frameCompleted) continue;

    const durationMs = (frameCompleted - intendedVsync) / 1e6;
    if (durationMs > 0) {
      frames.push({ id: intendedVsync, sample: { t: Date.now(), value: 1000 / durationMs } });
    }
  }

  return frames;
}

export class FpsCollector extends BaseCollector {
  readonly name = 'fps' as const;
  readonly unit = 'fps';

  private timer?: NodeJS.Timeout;
  /** Highest frame id already seen — everything at/below this predates the sampling window or a prior poll. */
  private lastSeenFrameId = -Infinity;

  constructor(private readonly options: FpsCollectorOptions) {
    super();
  }

  /**
   * Seeds `lastSeenFrameId` from whatever is currently in the framestats ring buffer BEFORE
   * starting to poll, so frames that rendered before this sampling window began are never
   * recorded (see the de-duplication caveat on parseFramestats above).
   */
  async start(): Promise<void> {
    await this.consumeNewFrames({ recordSamples: false });

    const intervalMs = this.options.intervalMs ?? 1000;
    this.timer = setInterval(() => {
      void this.consumeNewFrames({ recordSamples: true });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async consumeNewFrames({ recordSamples }: { recordSamples: boolean }): Promise<void> {
    try {
      const output = await adbShell(['dumpsys', 'gfxinfo', this.options.packageName, 'framestats'], {
        deviceId: this.options.deviceId,
      });

      for (const frame of parseFramestats(output)) {
        if (recordSamples && frame.id > this.lastSeenFrameId) {
          this.record(frame.sample);
        }
        if (frame.id > this.lastSeenFrameId) {
          this.lastSeenFrameId = frame.id;
        }
      }
    } catch {
      // Swallow: the owning service already warns once when adb is unavailable.
    }
  }
}
