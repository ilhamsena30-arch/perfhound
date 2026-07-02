import type { Collector, MetricName, Sample } from '../types.js';

export type { Collector };

/**
 * Shared sample-buffering behavior for every collector. FPS, CPU, and memory collectors
 * all extend this and only differ in how they gather raw data (event-based vs. interval-sampled).
 */
export abstract class BaseCollector implements Collector {
  abstract readonly name: MetricName;
  abstract readonly unit: string;

  protected samples: Sample[] = [];

  abstract start(): void | Promise<void>;
  abstract stop(): void | Promise<void>;

  protected record(sample: Sample): void {
    this.samples.push(sample);
  }

  flush(): Sample[] {
    const flushed = this.samples;
    this.samples = [];
    return flushed;
  }
}
