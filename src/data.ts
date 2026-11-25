// Shapes of the files written by pipeline/build.ts.

export interface Meta {
  exportDate: string;
  builtAt: string;
  topN: number;
  lastWorlds: { id: string; name: string; date: string };
  metrics: { key: string; label: string; description: string }[];
  events: { id: string; name: string; metrics: string[]; regions: string[] }[];
  continents: { key: string; name: string }[];
  countries: { key: string; name: string; continent: string }[];
}

export interface Cell {
  /** Sort key, lower is better. */
  s: number;
  /** Display value. */
  d: string;
  /** Optional note (sample size, accuracy...). */
  n?: string;
  /** Competition id where the result was set (PR-style metrics). */
  c?: string;
  /** Date of that competition, YYYY-MM-DD. */
  t?: string;
}

export interface Row {
  id: string;
  name: string;
  country: string;
  m: Record<string, Cell>;
}

export interface RegionFile {
  /** Competition id -> name, for every competition a cell refers to. */
  comps: Record<string, string>;
  rows: Row[];
}

const base = import.meta.env.BASE_URL;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadMeta = () => getJson<Meta>("meta.json");

const cache = new Map<string, Promise<RegionFile>>();
export function loadRegion(event: string, region: string): Promise<RegionFile> {
  const key = `${event}/${region}`;
  let p = cache.get(key);
  if (!p) {
    p = getJson<RegionFile>(`${key}.json`);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface Ranked {
  rank: number;
  row: Row;
}

/** The top N rows for one metric, with shared ranks for ties. */
export function rank(rows: Row[], metric: string, topN: number): Ranked[] {
  const sorted = rows.filter((r) => r.m[metric]).sort((a, b) => a.m[metric]!.s - b.m[metric]!.s || a.name.localeCompare(b.name));
  const out: Ranked[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    const prev = out[i - 1];
    const r = prev && prev.row.m[metric]!.s === row.m[metric]!.s ? prev.rank : i + 1;
    if (r > topN) break;
    out.push({ rank: r, row });
  }
  return out;
}

export const EVENT_SHORT: Record<string, string> = {
  "333": "3x3",
  "222": "2x2",
  "444": "4x4",
  "555": "5x5",
  "666": "6x6",
  "777": "7x7",
  "333bf": "3BLD",
  "333fm": "FMC",
  "333oh": "OH",
  clock: "Clock",
  minx: "Mega",
  pyram: "Pyra",
  skewb: "Skewb",
  sq1: "SQ-1",
  "444bf": "4BLD",
  "555bf": "5BLD",
  "333mbf": "MBLD",
  fto: "FTO",
};
