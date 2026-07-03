import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFramestats } from '../src/collectors/fps.js';
import { parseCpuInfo } from '../src/collectors/cpu.js';
import { parseMeminfoPssMb } from '../src/collectors/memory.js';

// Hand-crafted, minimal fixtures matching the raw dumpsys shapes documented in each collector's
// doc comment — each is designed to exercise one specific parsing behavior, not to mirror a real
// device dump verbatim. (The parsers were originally validated against real captures from a
// connected emulator; that was a one-time manual sanity check, not something worth committing as
// a permanent, opaque test fixture — see TODO.md.)

const FRAMESTATS_HEADER =
  'Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,' +
  'PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,' +
  'IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,' +
  'GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted,';

function framestatsRow(intendedVsyncNs: number, frameCompletedNs: number): string {
  // IntendedVsync is column 2, FrameCompleted is column 16 — everything else is irrelevant to parsing.
  const cols = new Array(23).fill(0);
  cols[2] = intendedVsyncNs;
  cols[16] = frameCompletedNs;
  return cols.join(',') + ',';
}

test('parseFramestats converts (FrameCompleted - IntendedVsync) into instantaneous fps, by column name not position', () => {
  const output = [
    '---PROFILEDATA---',
    FRAMESTATS_HEADER,
    framestatsRow(1_000_000_000, 1_016_666_666), // 16.666ms -> 60fps
    framestatsRow(1_016_666_666, 1_116_666_666), // 100ms -> 10fps (a stutter)
    '---PROFILEDATA---',
  ].join('\n');

  const frames = parseFramestats(output);

  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.id, 1_000_000_000);
  assert.ok(Math.abs((frames[0]?.sample.value ?? 0) - 60) < 0.01);
  assert.equal(frames[1]?.id, 1_016_666_666);
  assert.ok(Math.abs((frames[1]?.sample.value ?? 0) - 10) < 0.01);
});

test('parseFramestats skips rows where IntendedVsync or FrameCompleted is 0 (not yet populated)', () => {
  const output = [
    '---PROFILEDATA---',
    FRAMESTATS_HEADER,
    framestatsRow(0, 1_016_666_666), // IntendedVsync missing
    framestatsRow(1_016_666_666, 0), // FrameCompleted missing
    '---PROFILEDATA---',
  ].join('\n');

  assert.deepEqual(parseFramestats(output), []);
});

test('parseFramestats returns an empty array for output with no PROFILEDATA block', () => {
  assert.deepEqual(parseFramestats('Applications Graphics Acceleration Info:\nUptime: 1 Realtime: 1\n'), []);
});

const CPUINFO_OUTPUT = [
  'Load: 1.0 / 1.0 / 1.0',
  'CPU usage from 100ms to 0ms ago:',
  '  14% 532/system_server: 7% user + 7% kernel / faults: 1 minor 1 major',
  '  0.6% 2735/com.example.app: 0.3% user + 0.3% kernel / faults: 1 minor 1 major',
  '  0.1% 999/com.example.app:remote: 0.1% user + 0% kernel',
].join('\n');

test('parseCpuInfo matches the "<pid>/<packageName>:" line for the given package', () => {
  assert.equal(parseCpuInfo(CPUINFO_OUTPUT, 'com.example.app'), 0.6);
});

test('parseCpuInfo does not match a ":process"-suffixed secondary process against the base package name', () => {
  assert.equal(parseCpuInfo(CPUINFO_OUTPUT, 'com.example.app'), 0.6); // still the main process, not 0.1
  assert.equal(parseCpuInfo(CPUINFO_OUTPUT, 'com.example.app:remote'), 0.1); // matched by its full name instead
});

test('parseCpuInfo returns null when the package has no line in the dump', () => {
  assert.equal(parseCpuInfo(CPUINFO_OUTPUT, 'com.not.installed'), null);
});

const MEMINFO_OUTPUT = [
  'Applications Memory Usage (in Kilobytes):',
  'Uptime: 1 Realtime: 1',
  '',
  '** MEMINFO in pid 1234 [com.example.app] **',
  '                   Pss  Private  Private  SwapPss     Rss     Heap     Heap     Heap',
  '                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free',
  '                ------   ------   ------   ------   ------   ------   ------   ------',
  '  Native Heap      100       50       50        0      100        0        0        0',
  '        TOTAL    12345     1000     1000        0    12345        0        0        0',
  '',
  ' App Summary',
  '                       Pss(KB)                        Rss(KB)',
  '                        ------                         ------',
  '           Java Heap:      100                            100',
  '',
  '           TOTAL PSS:    99999            TOTAL RSS:    12345       TOTAL SWAP PSS:        0',
].join('\n');

test('parseMeminfoPssMb reads the raw table\'s TOTAL row, not the App Summary "TOTAL PSS:" line', () => {
  // The two rows deliberately have different numbers (12345 vs 99999) so this test would fail
  // if the wrong one were matched.
  assert.equal(parseMeminfoPssMb(MEMINFO_OUTPUT), 12345 / 1024);
});

test('parseMeminfoPssMb returns null when there is no TOTAL row', () => {
  assert.equal(parseMeminfoPssMb('no such row here\n'), null);
});
