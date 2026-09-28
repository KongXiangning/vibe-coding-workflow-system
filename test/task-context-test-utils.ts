import { expect } from 'bun:test';
import type { TaskContextBlock } from '../runtime/vnext/src/task-context';

/** Test oracle: reconstruct exact values while rejecting skipped/duplicate records. */
export class ContextBlockCollector {
  readonly values = new Map<string, any>();
  readonly chunks = new Map<string, string>();
  private readonly paths = new Set<string>();
  private readonly offsets = new Map<string, number>();

  private assign(id: string, path: Array<string | number>, value: unknown): void {
    const key = JSON.stringify([id, path]);
    expect(this.paths.has(key)).toBe(false);
    this.paths.add(key);
    if (path.length === 0) { this.values.set(id, value); return; }
    if (!this.values.has(id)) this.values.set(id, typeof path[0] === 'number' ? [] : {});
    let target = this.values.get(id);
    for (let i = 0; i < path.length - 1; i++) {
      target[path[i]!] ??= typeof path[i + 1] === 'number' ? [] : {};
      target = target[path[i]!];
    }
    target[path.at(-1)!] = value;
  }

  add(blocks: TaskContextBlock[]): void {
    for (const block of blocks) {
      if (block.records) {
        expect(block.record_offset).toBe(this.offsets.get(block.id) ?? 0);
        for (const item of block.records) this.assign(block.id, item.path, item.value);
        this.offsets.set(block.id, block.record_offset! + block.records.length);
      } else if (block.text !== undefined) {
        expect(block.record_offset).toBe(this.offsets.get(block.id) ?? 0);
        const key = JSON.stringify([block.id, block.record_path]);
        const previous = this.chunks.get(key) ?? '';
        expect(block.byte_offset).toBe(Buffer.byteLength(previous));
        this.chunks.set(key, previous + block.text);
        if (!block.truncated) {
          expect(Buffer.byteLength(previous + block.text)).toBe(block.total_bytes);
          this.assign(block.id, block.record_path!, JSON.parse(previous + block.text));
          this.offsets.set(block.id, block.record_offset! + 1);
        }
      } else {
        expect(this.values.has(block.id)).toBe(false);
        this.assign(block.id, [], block.value);
      }
    }
  }
}
