// Reads the WCA results export (TSV, format v2) and writes the precomputed
// rankings the site loads: public/data/meta.json and
// public/data/<event>/<region>.json.
//
//   WCA_EXPORT_DIR=.cache/tsv npm run data

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS, type MetricContext, type MetricValue, type Round } from "./metrics.ts";
import { IntColumn, readTsv, scanTsv } from "./tsv.ts";
import type { EventFormat, EventInfo } from "./units.ts";
import { regionKeyForContinent, rankRegions, regionRanks, type RankedEntry } from "./regions.ts";

const EXPORT_DIR = process.env.WCA_EXPORT_DIR ?? ".cache/tsv";
const OUT_DIR = process.env.OUT_DIR ?? "public/data";
const TOP_N = Number(process.env.TOP_N ?? 100);
/** Registrants of the upcoming Worlds, from pipeline/fetch-field.mjs (optional). */
const FIELD_FILE = process.env.FIELD_FILE ?? ".cache/field.json";
/** Region key of the "Worlds field" pseudo-region. */
const FIELD = "field";
const FINAL_ROUNDS = new Set(["f", "c"]);
const SUPPORTED_MAJOR = "v2";

const table = (name: string) => join(EXPORT_DIR, `WCA_export_${name}.tsv`);
const dayOf = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const log = (msg: string) => console.log(`[${(performance.now() / 1000).toFixed(1)}s] ${msg}`);

async function main() {
  // ---- Metadata ----
  const metadata = JSON.parse(readFileSync(join(EXPORT_DIR, "metadata.json"), "utf8")) as {
    export_format_version: string;
    export_date: string;
  };
  if (!metadata.export_format_version.startsWith(SUPPORTED_MAJOR + ".")) {
    throw new Error(`Unsupported export format ${metadata.export_format_version}; expected ${SUPPORTED_MAJOR}.x`);
  }
  const exportDate = new Date(metadata.export_date.replace(" UTC", "Z").replace(" ", "T"));
  if (Number.isNaN(exportDate.getTime())) throw new Error(`Unreadable export_date ${metadata.export_date}`);
  const today = dayOf(exportDate.getUTCFullYear(), exportDate.getUTCMonth() + 1, exportDate.getUTCDate());

  // ---- Small tables ----
  const events: EventInfo[] = [];
  await readTsv(table("events"), (c, k) => {
    const rank = Number(c[k.rank!]);
    if (rank < 900) events.push({ id: c[k.id!]!, name: c[k.name!]!, format: c[k.format!] as EventFormat, rank });
  });
  events.sort((a, b) => a.rank - b.rank);
  const eventIndex = new Map(events.map((e, i) => [e.id, i]));

  const continents = new Map<string, string>();
  await readTsv(table("continents"), (c, k) => continents.set(c[k.id!]!, c[k.name!]!));

  const countries = new Map<string, { iso2: string; name: string; continent: string }>();
  await readTsv(table("countries"), (c, k) =>
    countries.set(c[k.id!]!, { iso2: c[k.iso2!]!, name: c[k.name!]!, continent: c[k.continent_id!]! }),
  );

  const roundRank = new Map<string, number>();
  await readTsv(table("round_types"), (c, k) => roundRank.set(c[k.id!]!, Number(c[k.rank!])));

  const compIndex = new Map<string, number>();
  const compDay: number[] = [];
  const compName: string[] = [];
  const compIds: string[] = [];
  await readTsv(table("competitions"), (c, k) => {
    compIndex.set(c[k.id!]!, compDay.length);
    compIds.push(c[k.id!]!);
    compDay.push(dayOf(Number(c[k.year!]), Number(c[k.month!]), Number(c[k.day!])));
    compName.push(c[k.name!]!);
  });

  // World Championships that have started. Which one is "the last Worlds" is
  // decided after the results scan: only one whose results are posted counts,
  // so the "since Worlds" columns don't go empty during Worlds itself.
  type Worlds = { id: string; name: string; day: number; comp: number };
  const worldsByComp = new Map<number, Worlds>();
  await readTsv(table("championships"), (c, k) => {
    if (c[k.championship_type!] !== "world") return;
    const id = c[k.competition_id!]!;
    const i = compIndex.get(id);
    if (i === undefined || compDay[i]! > today) return;
    worldsByComp.set(i, { id, name: compName[i]!, day: compDay[i]!, comp: i });
  });

  const personIndex = new Map<string, number>();
  const personId: string[] = [];
  const personName: string[] = [];
  const personCountry: string[] = [];
  await readTsv(table("persons"), (c, k) => {
    if (c[k.sub_id!] !== "1") return;
    personIndex.set(c[k.wca_id!]!, personId.length);
    personId.push(c[k.wca_id!]!);
    personName.push(c[k.name!]!);
    personCountry.push(c[k.country_id!]!);
  });
  log(`${events.length} events, ${compDay.length} competitions, ${personId.length} persons`);

  // ---- Upcoming Worlds registrants (optional) ----
  // person -> events they're registered for. Kept until a week after that
  // Worlds ends (fetch-field.mjs writes the cutoff), for reference during it.
  let field: {
    competition: string;
    name: string;
    hash: string;
    year: string;
    startDay: number;
    byPerson: Map<number, Set<string>>;
  } | null = null;
  if (existsSync(FIELD_FILE)) {
    const text = readFileSync(FIELD_FILE, "utf8");
    const f = JSON.parse(text) as {
      competition: string;
      name: string;
      startDate: string;
      until?: string;
      registrants: [string, string[]][];
    };
    const isoToDay = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return dayOf(y!, m!, d!);
    };
    if (!f.until || today <= isoToDay(f.until)) {
      const byPerson = new Map<number, Set<string>>();
      for (const [wcaId, evs] of f.registrants) {
        const p = personIndex.get(wcaId);
        if (p !== undefined) byPerson.set(p, new Set(evs));
      }
      const hash = createHash("sha256").update(text).digest("hex");
      const startDay = f.startDate ? isoToDay(f.startDate) : Infinity;
      field = { competition: f.competition, name: f.name, hash, year: f.startDate.slice(0, 4), startDay, byPerson };
      log(`${f.competition}: ${byPerson.size} registered competitors`);
    }
  }

  // ---- Results (columnar, millions of rows) ----
  const FORMATS = ["1", "2", "3", "5", "a", "m", "h"];
  const formatCode = new Map(FORMATS.map((f, i) => [f, i]));
  const rId = new IntColumn(), rPerson = new IntColumn(), rEvent = new IntColumn(), rDay = new IntColumn();
  const rRound = new IntColumn(), rFormat = new IntColumn(), rBest = new IntColumn(), rAvg = new IntColumn();
  const rComp = new IntColumn();
  let skipped = 0;
  // Every started Worlds: whether it has results, and each event final's podium
  // (pos 1-3): competition -> event index -> person -> place.
  const worldsWithResults = new Set<number>();
  const podiums = new Map<number, Map<number, Map<number, number>>>();
  // Field order for scanTsv: 0 id, 1 best, 2 average, 3 competition, 4 round type, 5 event, 6 person, 7 format, 8 pos
  await scanTsv(
    table("results"),
    ["id", "best", "average", "competition_id", "round_type_id", "event_id", "person_id", "format_id", "pos"],
    (r) => {
    const ev = r.lookup(5, eventIndex);
    if (ev === undefined) return;
    const p = personIndex.get(r.str(6));
    const comp = r.lookup(3, compIndex);
    if (comp !== undefined && worldsByComp.has(comp)) {
      worldsWithResults.add(comp);
      const pos = r.int(8);
      if (p !== undefined && FINAL_ROUNDS.has(r.str(4)) && pos >= 1 && pos <= 3 && r.int(1) > 0) {
        let byEvent = podiums.get(comp);
        if (!byEvent) podiums.set(comp, (byEvent = new Map()));
        let m = byEvent.get(ev);
        if (!m) byEvent.set(ev, (m = new Map()));
        m.set(p, pos);
      }
    }
    const fmt = r.lookup(7, formatCode);
    const rr = r.lookup(4, roundRank);
    if (p === undefined || comp === undefined || fmt === undefined || rr === undefined) {
      skipped++;
      return;
    }
    rId.push(r.int(0));
    rPerson.push(p);
    rEvent.push(ev);
    rDay.push(compDay[comp]!);
    rComp.push(comp);
    rRound.push(rr);
    rFormat.push(fmt);
    rBest.push(r.int(1));
    rAvg.push(r.int(2));
    },
  );
  const n = rId.length;
  log(`${n} results loaded (${skipped} skipped with unknown references)`);

  let maxId = 0;
  for (let i = 0; i < n; i++) maxId = Math.max(maxId, rId.get(i));
  const rowOfId = new Int32Array(maxId + 1).fill(-1);
  for (let i = 0; i < n; i++) rowOfId[rId.get(i)] = i;

  const MAX_ATTEMPTS = 5;
  const attempts = new Int32Array(n * MAX_ATTEMPTS);
  await scanTsv(table("result_attempts"), ["value", "attempt_number", "result_id"], (r) => {
    const id = r.int(2);
    const num = r.int(1);
    const row = id <= maxId ? rowOfId[id]! : -1;
    if (row < 0 || num < 1 || num > MAX_ATTEMPTS) return;
    attempts[row * MAX_ATTEMPTS + num - 1] = r.int(0);
  });
  log("attempts loaded");

  const posted = [...worldsByComp.values()].filter((w) => worldsWithResults.has(w.comp)).sort((a, b) => a.day - b.day);
  const worlds = posted[posted.length - 1];
  if (!worlds) throw new Error("No World Championship with results found");
  const worldsDays = posted.map((w) => w.day);
  // Crowns in the field view: the podium of the Worlds before the field's one,
  // i.e. the defending podium, even after the new Worlds' results are posted.
  const fieldStart = field?.startDay ?? Infinity;
  const crownWorlds = field ? [...posted].reverse().find((w) => w.day < fieldStart) : undefined;
  const podium = (crownWorlds && podiums.get(crownWorlds.comp)) ?? new Map<number, Map<number, number>>();
  log(`last Worlds with results: ${worlds.name}${crownWorlds ? `; crowns from ${crownWorlds.name}` : ""}`);

  // ---- Group by event, person, then chronologically ----
  const ev = rEvent.data, pe = rPerson.data, dy = rDay.data, rd = rRound.data;
  const order = groupChronologically(n, events.length, personId.length, ev, pe, dy, rd);
  log("sorted");

  const ctx: MetricContext = { today, lastWorldsDay: worlds.day };
  // The same rankings as of MOVEMENT_DAYS ago, for the movement arrows: only
  // competitions that started by then, and "today" moved back too.
  const compareDay = today - MOVEMENT_DAYS;
  const prevCtx: MetricContext = {
    today: compareDay,
    lastWorldsDay: Math.max(...worldsDays.filter((d) => d <= compareDay)),
  };
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // Region keys per person, built once (looked up for every ranked entry).
  const regionsByCountry = new Map<string, string[]>();
  for (const [id, c] of countries) {
    regionsByCountry.set(id, ["world", regionKeyForContinent(c.continent), c.iso2.toLowerCase()]);
  }
  const worldOnly = ["world"];
  const personRegionList = personCountry.map((c) => regionsByCountry.get(c) ?? worldOnly);
  const personRegions = (p: number): string[] => personRegionList[p]!;

  const eventMeta: { id: string; name: string; metrics: string[]; regions: string[] }[] = [];
  const usedRegions = new Set<string>();
  let i = 0;
  for (let e = 0; e < events.length; e++) {
    const event = events[e]!;
    const metrics = METRICS.filter((m) => m.applies(event));
    // Registered competitors also belong to the Worlds field region, per event.
    const fieldRegions = new Map<number, string[]>();
    if (field) {
      for (const [p, evs] of field.byPerson) if (evs.has(event.id)) fieldRegions.set(p, [...personRegions(p), FIELD]);
    }
    const regionsOf = fieldRegions.size ? (p: number) => fieldRegions.get(p) ?? personRegions(p) : personRegions;
    const values = new Map<number, Record<string, MetricValue>>();
    const entries: Record<string, RankedEntry[]> = Object.fromEntries(metrics.map((m) => [m.key, []]));
    const prevValues = new Map<number, Record<string, MetricValue>>();
    const prevEntries: Record<string, RankedEntry[]> = Object.fromEntries(metrics.map((m) => [m.key, []]));

    while (i < n && ev[order[i]!] === e) {
      const p = pe[order[i]!]!;
      const rounds: Round[] = [];
      while (i < n && ev[order[i]!] === e && pe[order[i]!] === p) {
        const row = order[i]!;
        const a: number[] = [];
        for (let j = 0; j < MAX_ATTEMPTS; j++) a.push(attempts[row * MAX_ATTEMPTS + j]!);
        rounds.push({
          day: dy[row]!,
          comp: rComp.get(row),
          roundRank: rd[row]!,
          format: FORMATS[rFormat.get(row)]!,
          best: rBest.get(row),
          average: rAvg.get(row),
          attempts: a,
        });
        i++;
      }
      const mine: Record<string, MetricValue> = {};
      let any = false;
      for (const m of metrics) {
        const v = m.compute(rounds, event, ctx);
        if (!v) continue;
        mine[m.key] = v;
        entries[m.key]!.push({ person: p, sort: v.sort });
        any = true;
      }
      if (!any) continue;
      values.set(p, mine);
      let k = rounds.length;
      while (k > 0 && rounds[k - 1]!.day > compareDay) k--;
      const before = k === rounds.length ? rounds : rounds.slice(0, k);
      const prev: Record<string, MetricValue> = {};
      for (const m of metrics) {
        const v = m.compute(before, event, prevCtx);
        if (!v) continue;
        prev[m.key] = v;
        prevEntries[m.key]!.push({ person: p, sort: v.sort });
      }
      prevValues.set(p, prev);
    }

    if (values.size === 0) {
      log(`${event.id}: no results yet, left out`);
      continue;
    }

    // Everyone in the top N of any metric, per region.
    const members = rankRegions(entries, regionsOf, TOP_N);
    const prevRanks = Object.fromEntries(
      metrics.map((m) => [m.key, regionRanks(prevEntries[m.key]!, regionsOf, members)]),
    );
    const regions: string[] = [];
    mkdirSync(join(OUT_DIR, event.id), { recursive: true });
    for (const [region, people] of members) {
      const comps: Record<string, string> = {};
      const cell = (p: number, key: string, v: MetricValue) => {
        const c: { s: number; d: string; n?: string; c?: string; t?: string; pr?: number; pd?: string } = {
          s: round4(v.sort),
          d: v.display,
        };
        const pr = prevRanks[key]!.get(region)?.get(p);
        if (pr !== undefined) {
          c.pr = pr;
          c.pd = prevValues.get(p)![key]!.display;
        }
        if (v.note) c.n = v.note;
        if (v.at) {
          const id = compIds[v.at.comp]!;
          comps[id] = compName[v.at.comp]!;
          c.c = id;
          c.t = isoDay(v.at.day);
        }
        return c;
      };
      const eventPodium = region === FIELD ? podium.get(e) : undefined;
      const rows = [...people].map((p) => {
        const row: { id: string; name: string; country: string; m: object; w?: number } = {
          id: personId[p]!,
          name: personName[p]!,
          country: countries.get(personCountry[p]!)?.iso2 ?? "",
          m: Object.fromEntries(Object.entries(values.get(p) ?? {}).map(([key, v]) => [key, cell(p, key, v)])),
        };
        // Last Worlds' podium gets a crown in the field view (1 gold, 2 silver, 3 bronze).
        const place = eventPodium?.get(p);
        if (place) row.w = place;
        return row;
      });
      writeFileSync(join(OUT_DIR, event.id, `${region}.json`), JSON.stringify({ comps, rows }));
      regions.push(region);
      usedRegions.add(region);
    }
    eventMeta.push({ id: event.id, name: event.name, metrics: metrics.map((m) => m.key), regions });
    log(`${event.id}: ${values.size} competitors, ${regions.length} region files`);
  }

  const meta = {
    exportDate: exportDate.toISOString(),
    builtAt: new Date().toISOString(),
    topN: TOP_N,
    movement: { days: MOVEMENT_DAYS, since: isoDay(compareDay) },
    lastWorlds: { id: worlds.id, name: worlds.name, date: isoDay(worlds.day) },
    field: field && usedRegions.has(FIELD)
      ? {
          key: FIELD,
          name: `Worlds ${field.year} field`,
          competition: field.competition,
          competitionName: field.name,
          hash: field.hash,
          crownsFrom: crownWorlds ? { id: crownWorlds.id, name: crownWorlds.name, date: isoDay(crownWorlds.day) } : undefined,
        }
      : undefined,
    metrics: METRICS.map(({ key, label, blurb, description }) => ({ key, label, blurb, description })),
    events: eventMeta,
    continents: [...continents]
      .map(([id, name]) => ({ key: regionKeyForContinent(id), name }))
      .filter((c) => usedRegions.has(c.key)),
    countries: [...countries.values()]
      .map((c) => ({ key: c.iso2.toLowerCase(), name: c.name, continent: regionKeyForContinent(c.continent) }))
      .filter((c) => usedRegions.has(c.key))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 1));
  log("done");
}

/** How far back the movement arrows compare. Longer than a week so a weekend
 * competition still counts while its results take a few days to be posted. */
const MOVEMENT_DAYS = 10;

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * Row order grouped by (event, person), chronological within each group.
 * A counting sort on the (event, person) bucket is linear; each bucket is a
 * single competitor's history in one event, small enough to insertion-sort.
 */
function groupChronologically(
  n: number,
  eventCount: number,
  personCount: number,
  ev: Int32Array,
  pe: Int32Array,
  dy: Int32Array,
  rd: Int32Array,
): Uint32Array {
  const buckets = eventCount * personCount;
  const start = new Int32Array(buckets + 1);
  for (let i = 0; i < n; i++) start[ev[i]! * personCount + pe[i]! + 1]!++;
  for (let b = 0; b < buckets; b++) start[b + 1]! += start[b]!;
  const fill = start.slice(0, buckets);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[fill[ev[i]! * personCount + pe[i]!]!++] = i;
  const before = (a: number, b: number) => dy[a]! - dy[b]! || rd[a]! - rd[b]!;
  for (let b = 0; b < buckets; b++) {
    const lo = start[b]!, hi = start[b + 1]!;
    for (let i = lo + 1; i < hi; i++) {
      const x = order[i]!;
      let j = i - 1;
      while (j >= lo && before(order[j]!, x) > 0) {
        order[j + 1] = order[j]!;
        j--;
      }
      order[j + 1] = x;
    }
  }
  return order;
}
const isoDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
