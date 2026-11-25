import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Stream a WCA export TSV file, calling `onRow` with the split columns and a
 * lookup from column name to index (taken from the header row).
 */
export async function readTsv(
  path: string,
  onRow: (cols: string[], col: Record<string, number>) => void,
): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let col: Record<string, number> | null = null;
  for await (const line of rl) {
    if (line === "") continue;
    const cols = line.split("\t");
    if (!col) {
      col = Object.fromEntries(cols.map((name, i) => [name, i]));
      continue;
    }
    onRow(cols, col);
  }
}

/** Growable Int32Array, to hold millions of values without per-row objects. */
export class IntColumn {
  data: Int32Array;
  length = 0;
  constructor(initial = 1 << 20) {
    this.data = new Int32Array(initial);
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  get(i: number): number {
    return this.data[i]!;
  }
}
