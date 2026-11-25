import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Stream a WCA export TSV file, calling `onRow` with the split columns and a
 * lookup from column name to index (taken from the header row). Simple and
 * fine for the small tables; use `scanTsv` for the big ones.
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

const TAB = 9;
const LF = 10;
const CR = 13;
const MINUS = 45;
const ZERO = 48;

/** Read access to the current row's wanted fields, by position in the `columns` list. */
export interface RowView {
  /** Parse a field as an integer (no allocation). */
  int(field: number): number;
  /** Decode a field as a string (ASCII/latin1; use for ids, not names). */
  str(field: number): string;
  /**
   * `map.get(str(field))`, but skips decoding when the field's bytes equal
   * the previous row's (consecutive results share competition, event, round...).
   */
  lookup<V>(field: number, map: Map<string, V>): V | undefined;
}

/**
 * Fast scanner for the big tables: works on raw bytes, finds only the wanted
 * columns, and parses integers without creating strings. About 3x faster than
 * readline + split on the 30M-row attempts table.
 */
export async function scanTsv(path: string, columns: string[], onRow: (row: RowView) => void): Promise<void> {
  const want = columns.length;
  // Field position in the file -> slot in `columns` (-1 if not wanted).
  let slotOf: Int32Array | null = null;
  let lastWanted = 0;
  const starts = new Int32Array(want);
  const ends = new Int32Array(want);
  let buf: Buffer = Buffer.alloc(0);
  const prevBytes: (Buffer | null)[] = new Array(want).fill(null);
  const prevValue: unknown[] = new Array(want).fill(undefined);
  const prevMap: (Map<string, unknown> | null)[] = new Array(want).fill(null);

  const row: RowView = {
    lookup<V>(f: number, map: Map<string, V>): V | undefined {
      const s = starts[f]!;
      const e = ends[f]!;
      const prev = prevBytes[f];
      if (prev && prevMap[f] === map && e - s === prev.length) {
        // A JS loop beats a native Buffer.compare call for these short ids.
        let same = true;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== buf[s + i]) {
            same = false;
            break;
          }
        }
        if (same) return prevValue[f] as V | undefined;
      }
      const v = map.get(buf.toString("latin1", s, e));
      prevBytes[f] = Buffer.from(buf.subarray(s, e));
      prevValue[f] = v;
      prevMap[f] = map as Map<string, unknown>;
      return v;
    },
    int(f) {
      let i = starts[f]!;
      const end = ends[f]!;
      let neg = false;
      if (buf[i] === MINUS) {
        neg = true;
        i++;
      }
      let v = 0;
      for (; i < end; i++) v = v * 10 + (buf[i]! - ZERO);
      return neg ? -v : v;
    },
    str(f) {
      return buf.toString("latin1", starts[f]!, ends[f]!);
    },
  };

  const parseHeader = (line: string) => {
    const names = line.replace(/\r$/, "").split("\t");
    slotOf = new Int32Array(names.length).fill(-1);
    for (let s = 0; s < want; s++) {
      const pos = names.indexOf(columns[s]!);
      if (pos < 0) throw new Error(`${path}: no column ${columns[s]}`);
      slotOf[pos] = s;
      lastWanted = Math.max(lastWanted, pos);
    }
  };

  let carry: Buffer | null = null;
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 22 }) as AsyncIterable<Buffer>) {
    buf = carry ? Buffer.concat([carry, chunk]) : chunk;
    let lineStart = 0;
    if (!slotOf) {
      const nl = buf.indexOf(LF);
      if (nl < 0) {
        carry = buf;
        continue;
      }
      parseHeader(buf.toString("utf8", 0, nl));
      lineStart = nl + 1;
    }
    const slots: Int32Array = slotOf!;
    const n = buf.length;
    while (lineStart < n) {
      // Walk the line, recording the wanted fields, until the newline.
      let field = 0;
      let fieldStart = lineStart;
      let i = lineStart;
      for (; i < n; i++) {
        const b = buf[i]!;
        if (b === TAB || b === LF) {
          if (field <= lastWanted) {
            const s = slots[field]!;
            if (s >= 0) {
              starts[s] = fieldStart;
              ends[s] = b === LF && i > fieldStart && buf[i - 1] === CR ? i - 1 : i;
            }
          }
          if (b === LF) break;
          field++;
          fieldStart = i + 1;
        }
      }
      if (i >= n) break; // incomplete last line: keep it for the next chunk
      if (i > lineStart) onRow(row);
      lineStart = i + 1;
    }
    carry = lineStart < n ? buf.subarray(lineStart) : null;
  }
  // A final line without a trailing newline.
  if (carry && carry.length > 0 && slotOf) {
    buf = Buffer.concat([carry, Buffer.from([LF])]);
    carry = null;
    const slots: Int32Array = slotOf;
    let field = 0;
    let fieldStart = 0;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i]!;
      if (b === TAB || b === LF) {
        const s = field < slots.length ? slots[field]! : -1;
        if (s >= 0) {
          starts[s] = fieldStart;
          ends[s] = i;
        }
        field++;
        fieldStart = i + 1;
      }
    }
    onRow(row);
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
