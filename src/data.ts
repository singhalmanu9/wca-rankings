// Shapes of the files written by pipeline/build.ts.

export interface Meta {
  exportDate: string;
  builtAt: string;
  topN: number;
  lastWorlds: { id: string; name: string; date: string };
  /** The movement arrows compare against rankings as of `since` (YYYY-MM-DD). */
  movement?: { days: number; since: string };
  /** Registrants of the upcoming Worlds, as a pseudo-region (absent when there's none). */
  field?: {
    key: string;
    name: string;
    competition: string;
    competitionName: string;
    /** The podium crowned in the field view: the Worlds before this one. */
    crownsFrom?: { id: string; name: string; date: string };
  };
  metrics: { key: string; label: string; blurb?: string; description: string }[];
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
  /** Rank in this region on the comparison date (absent if they didn't qualify then). */
  pr?: number;
  /** Display value on the comparison date. */
  pd?: string;
}

export interface Row {
  id: string;
  name: string;
  country: string;
  m: Record<string, Cell>;
  /** Field view only: place at the last Worlds (1-3), shown as a crown. */
  w?: number;
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

export interface RecordTag {
  label: string;
  kind: "wr" | "cr" | "nr" | "lead";
}

const CONTINENT_RECORD: Record<string, string> = {
  "c-africa": "AfR",
  "c-asia": "AsR",
  "c-europe": "ER",
  "c-north-america": "NAR",
  "c-oceania": "OcR",
  "c-south-america": "SAR",
};

/** The tag for the best value in a region, like WCA Live's WR / AsR / NR. */
export function recordTag(region: string): RecordTag {
  if (region === "field") return { label: "Leader", kind: "lead" };
  if (region === "world") return { label: "WR", kind: "wr" };
  const cr = CONTINENT_RECORD[region];
  return cr ? { label: cr, kind: "cr" } : { label: "NR", kind: "nr" };
}

/** Best (lowest) sort key per metric among a region file's rows; ties all count. */
export function regionBests(rows: Row[], metrics: string[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const row of rows)
    for (const key of metrics) {
      const s = row.m[key]?.s;
      if (s !== undefined && !(s >= (best.get(key) ?? Infinity))) best.set(key, s);
    }
  return best;
}

export interface Movement {
  kind: "up" | "down" | "same" | "new";
  /** "▲3", "▼2", "–" or "NEW". */
  text: string;
  /** "3 places up since Nov 18" */
  title: string;
  /** "Nov 18: #5 · 4.51 → 4.38 (−0.13)" */
  detail: string;
}

/** Seconds (or moves / points) from a display value; null for multi-blind and others. */
function displayNumber(d: string): number | null {
  const pts = /^(-?[\d.]+) pts$/.exec(d);
  if (pts) return Number(pts[1]);
  const t = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(d);
  if (!t) return null;
  const parts = [t[1], t[2], t[3]].filter((x) => x !== undefined).map(Number);
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

/** "2026-11-18" -> "Nov 18" */
export const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** How a cell's rank changed since `since` ("Nov 18"), power-rankings style. */
export function movement(cell: Cell, rank: number, since: string): Movement {
  if (cell.pr === undefined)
    return { kind: "new", text: "NEW", title: `New since ${since}`, detail: `Not in the rankings on ${since}` };
  const diff = cell.pr - rank;
  let detail = `${since}: #${cell.pr}`;
  if (cell.pd && cell.pd !== cell.d) {
    detail += ` · ${cell.pd} → ${cell.d}`;
    const a = displayNumber(cell.pd);
    const b = displayNumber(cell.d);
    if (a !== null && b !== null) detail += ` (${b >= a ? "+" : "−"}${Math.abs(b - a).toFixed(2)})`;
  } else if (cell.pd) detail += ` · ${cell.d}, unchanged`;
  const places = (n: number) => `${n} place${n === 1 ? "" : "s"}`;
  if (diff > 0) return { kind: "up", text: `▲${diff}`, title: `${places(diff)} up since ${since}`, detail };
  if (diff < 0) return { kind: "down", text: `▼${-diff}`, title: `${places(-diff)} down since ${since}`, detail };
  return { kind: "same", text: "–", title: `No change since ${since}`, detail };
}
