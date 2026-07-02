import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedAvailability: boolean | undefined;

/** Checks once (and caches) whether `adb` is reachable on PATH. Never throws. */
export async function isAdbAvailable(): Promise<boolean> {
  if (cachedAvailability !== undefined) {
    return cachedAvailability;
  }
  try {
    await execFileAsync('adb', ['version']);
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

/** Exposed for tests only; production code should never need to reset the cached check. */
export function _resetAdbAvailabilityCache(): void {
  cachedAvailability = undefined;
}

export interface AdbOptions {
  /** adb -s <deviceId>. Omit to let adb pick the sole connected device. */
  deviceId?: string;
}

/** Runs `adb [-s <deviceId>] shell <args>` and returns stdout. Rejects on failure — callers decide how to degrade. */
export async function adbShell(args: string[], options: AdbOptions = {}): Promise<string> {
  const fullArgs = options.deviceId
    ? ['-s', options.deviceId, 'shell', ...args]
    : ['shell', ...args];
  const { stdout } = await execFileAsync('adb', fullArgs, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}
