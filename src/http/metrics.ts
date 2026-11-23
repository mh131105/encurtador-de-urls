import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const bounds = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 30000];
function histogram() {
  return { count: 0, errors: 0, totalMs: 0, buckets: Array<number>(bounds.length + 1).fill(0) };
}
type Operation = 'create' | 'resolve' | 'cqlRead' | 'cqlWrite';

export class Metrics {
  readonly operations = { create: histogram(), resolve: histogram(), cqlRead: histogram(), cqlWrite: histogram() };
  cacheHits = 0;
  private readonly processId = randomUUID();
  private readonly start = performance.now();
  private readonly delay = monitorEventLoopDelay({ resolution: 20 });

  constructor() { this.delay.enable(); }
  close() { this.delay.disable(); }
  observe(op: Operation, started: number, failed: boolean) {
    const ms = performance.now() - started;
    const entry = this.operations[op];
    entry.count++;
    entry.errors += Number(failed);
    entry.totalMs += ms;
    const index = bounds.findIndex(bound => ms <= bound);
    entry.buckets[index < 0 ? bounds.length : index]++;
  }
  async measure<T>(op: Operation, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await run();
      this.observe(op, start, false);
      return result;
    } catch (err) {
      this.observe(op, start, true);
      throw err;
    }
  }
  snapshot(localIds: bigint) {
    const uptimeSeconds = (performance.now() - this.start) / 1000;
    return {
      processId: this.processId, uptimeSeconds, latencyUpperBoundsMs: bounds, operations: this.operations,
      cacheHits: this.cacheHits, localIds: String(localIds),
      memoryBytes: process.memoryUsage(),
      eventLoopP99Ms: this.delay.percentile(99) / 1e6,
    };
  }
}
