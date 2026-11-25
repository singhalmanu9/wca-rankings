// Reads the WCA results export (TSV, format v2) and writes the precomputed
// rankings the site loads: public/data/meta.json and
// public/data/<event>/<region>.json.
//
//   WCA_EXPORT_DIR=.cache/tsv npm run data

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS, type MetricContext, type MetricValue, type Round } from "./metrics.ts";
import { IntColumn, readTsv } from "./tsv.ts";
import type { EventFormat, EventInfo } from "./units.ts";
import { regionKeyForContinent, rankRegions, type RankedEntry } from "./regions.ts";

const EXPORT_DIR = process.env.WCA_EXPORT_DIR ?? ".cache/tsv";
const OUT_DIR = process.env.OUT_DIR ?? "public/data";
const TOP_N = Number(process.env.TOP_N ?? 100);
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

  let lastWorlds: { id: string; name: string; day: number } | null = null;
  await readTsv(table("championships"), (c, k) => {
    if (c[k.championship_type!] !== "world") return;
    const id = c[k.competition_id!]!;
    const i = compIndex.get(id);
    if (i === undefined || compDay[i]! > today) return;
    if (!lastWorlds || compDay[i]! > lastWorlds.day) lastWorlds = { id, name: compName[i]!, day: compDay[i]! };
  });
  if (!lastWorlds) throw new Error("No past World Championship found");
  const worlds: { id: string; name: string; day: number } = lastWorlds;

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
  log(`${events.length} events, ${compDay.length} competitions, ${personId.length} persons; last Worlds ${worlds.name}`);

  // ---- Results (columnar, millions of rows) ----
  const FORMATS = ["1", "2", "3", "5", "a", "m", "h"];
  const formatCode = new Map(FORMATS.map((f, i) => [f, i]));
  const rId = new IntColumn(), rPerson = new IntColumn(), rEvent = new IntColumn(), rDay = new IntColumn();
  const rRound = new IntColumn(), rFormat = new IntColumn(), rBest = new IntColumn(), rAvg = new IntColumn();
  const rComp = new IntColumn();
  let skipped = 0;
  await readTsv(table("results"), (c, k) => {
    const ev = eventIndex.get(c[k.event_id!]!);
    if (ev === undefined) return;
    const p = personIndex.get(c[k.person_id!]!);
    const comp = compIndex.get(c[k.competition_id!]!);
    const fmt = formatCode.get(c[k.format_id!]!);
    const rr = roundRank.get(c[k.round_type_id!]!);
    if (p === undefined || comp === undefined || fmt === undefined || rr === undefined) {
      skipped++;
      return;
    }
    rId.push(Number(c[k.id!]));
    rPerson.push(p);
    rEvent.push(ev);
    rDay.push(compDay[comp]!);
    rComp.push(comp);
    rRound.push(rr);
    rFormat.push(fmt);
    rBest.push(Number(c[k.best!]));
    rAvg.push(Number(c[k.average!]));
  });
  const n = rId.length;
  log(`${n} results loaded (${skipped} skipped with unknown references)`);

  let maxId = 0;
  for (let i = 0; i < n; i++) maxId = Math.max(maxId, rId.get(i));
  const rowOfId = new Int32Array(maxId + 1).fill(-1);
  for (let i = 0; i < n; i++) rowOfId[rId.get(i)] = i;

  const MAX_ATTEMPTS = 5;
  const attempts = new Int32Array(n * MAX_ATTEMPTS);
  await readTsv(table("result_attempts"), (c, k) => {
    const id = Number(c[k.result_id!]);
    const num = Number(c[k.attempt_number!]);
    const row = id <= maxId ? rowOfId[id]! : -1;
    if (row < 0 || num < 1 || num > MAX_ATTEMPTS) return;
    attempts[row * MAX_ATTEMPTS + num - 1] = Number(c[k.value!]);
  });
  log("attempts loaded");

  // ---- Group by event, person, then chronologically ----
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const ev = rEvent.data, pe = rPerson.data, dy = rDay.data, rd = rRound.data;
  order.sort((a, b) => ev[a]! - ev[b]! || pe[a]! - pe[b]! || dy[a]! - dy[b]! || rd[a]! - rd[b]!);
  log("sorted");

  const ctx: MetricContext = { today, lastWorldsDay: worlds.day };
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const personRegions = (p: number): string[] => {
    const country = countries.get(personCountry[p]!);
    if (!country) return ["world"];
    return ["world", regionKeyForContinent(country.continent), country.iso2.toLowerCase()];
  };

  const eventMeta: { id: string; name: string; metrics: string[]; regions: string[] }[] = [];
  const usedRegions = new Set<string>();
  let i = 0;
  for (let e = 0; e < events.length; e++) {
    const event = events[e]!;
    const metrics = METRICS.filter((m) => m.applies(event));
    const values = new Map<number, Record<string, MetricValue>>();
    const entries: Record<string, RankedEntry[]> = Object.fromEntries(metrics.map((m) => [m.key, []]));

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
      if (any) values.set(p, mine);
    }

    if (values.size === 0) {
      log(`${event.id}: no results yet, left out`);
      continue;
    }

    // Everyone in the top N of any metric, per region.
    const members = rankRegions(entries, personRegions, TOP_N);
    const regions: string[] = [];
    mkdirSync(join(OUT_DIR, event.id), { recursive: true });
    for (const [region, people] of members) {
      const comps: Record<string, string> = {};
      const cell = (v: MetricValue) => {
        const c: { s: number; d: string; n?: string; c?: string; t?: string } = { s: round4(v.sort), d: v.display };
        if (v.note) c.n = v.note;
        if (v.at) {
          const id = compIds[v.at.comp]!;
          comps[id] = compName[v.at.comp]!;
          c.c = id;
          c.t = isoDay(v.at.day);
        }
        return c;
      };
      const rows = [...people].map((p) => ({
        id: personId[p],
        name: personName[p],
        country: countries.get(personCountry[p]!)?.iso2 ?? "",
        m: Object.fromEntries(Object.entries(values.get(p) ?? {}).map(([key, v]) => [key, cell(v)])),
      }));
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
    lastWorlds: { id: worlds.id, name: worlds.name, date: isoDay(worlds.day) },
    metrics: METRICS.map(({ key, label, description }) => ({ key, label, description })),
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

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const isoDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
