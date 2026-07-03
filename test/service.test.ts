import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { PerfhoundService } from '../src/service/index.js';

function fakeBrowser() {
  const commands: Record<string, (...args: unknown[]) => unknown> = {};
  return {
    addCommand(name: string, fn: (...args: unknown[]) => unknown) {
      commands[name] = fn;
    },
    commands,
  };
}

async function makeStartedService() {
  const outputDir = path.join(os.tmpdir(), `perfhound-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const service = new PerfhoundService({ outputDir });
  const browser = fakeBrowser();
  await service.before(undefined as never, [], browser as never);
  return browser;
}

test('startPerfSample throws naming the still-open label, even when the first call has not resolved yet', async () => {
  const browser = await makeStartedService();

  // Regression test: startPerfSample() marks the sample "open" synchronously, before any await,
  // specifically so that a second call made before the first's async collector startup finishes
  // still sees the open sample and throws — rather than racing both calls into "no sample open".
  const first = browser.commands.startPerfSample('first-label');
  await assert.rejects(
    () => Promise.resolve(browser.commands.startPerfSample('second-label')),
    /startPerfSample\("second-label"\) was called while "first-label" is still open/,
  );

  await first;
  await browser.commands.stopPerfSample();
});

test('startPerfSample throws naming the still-open label on a fully-awaited double-start', async () => {
  const browser = await makeStartedService();

  await browser.commands.startPerfSample('checkout-flow');
  await assert.rejects(
    () => Promise.resolve(browser.commands.startPerfSample('another-flow')),
    /startPerfSample\("another-flow"\) was called while "checkout-flow" is still open/,
  );

  await browser.commands.stopPerfSample();
});

test('stopPerfSample throws when no startPerfSample label is open', async () => {
  const browser = await makeStartedService();

  await assert.rejects(
    () => Promise.resolve(browser.commands.stopPerfSample()),
    /stopPerfSample\(\) was called with no open startPerfSample\(\) label/,
  );
});

test('a full startPerfSample/stopPerfSample cycle returns a report and allows sampling again', async () => {
  const browser = await makeStartedService();

  await browser.commands.startPerfSample('flow-a');
  const reportA = await browser.commands.stopPerfSample();
  assert.equal(reportA.label, 'flow-a');

  await browser.commands.startPerfSample('flow-b');
  const reportB = await browser.commands.stopPerfSample();
  assert.equal(reportB.label, 'flow-b');
});
