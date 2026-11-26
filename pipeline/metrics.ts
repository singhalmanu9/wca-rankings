// Ranking systems. Each metric turns one competitor's chronological history in
// one event into a single sortable value (or null when they don't qualify).
// To add a ranking system, add an entry to METRICS; the build and the site pick
// it up automatically.

import {
  BEST_SINGLE_ROUND_EVENTS,
  DNF,
  DNS,
  HIGH_DNF_EVENTS,
  averageNatural,
  formatAverage,
  formatNatural,
  formatSingle,
  naturalSortKey,
  singleNatural,
  type EventInfo,
} from "./units.ts";

export interface Round {
  /** Competition start date, as days since 1970-01-01 (UTC). */
  day: number;
  /** Index of the competition, resolved to an id/name by the build. */
  comp: number;
  /** Order of the round within its competition (round_types.rank). */
  roundRank: number;
  /** formats.id: "1", "2", "3", "5", "a", "m", "h". */
  format: string;
  best: number;
  average: number;
  /** Raw attempt values in attempt order (may include DNF -1, DNS -2, 0 = not done). */
  attempts: number[];
}

export interface MetricContext {
  /** Day of the export: "now" for every recency window. */
  today: number;
  /** Start day of the most recent World Championship on or before today. */
  lastWorldsDay: number;
}

export interface MetricValue {
  /** Lower is better. Ties share a rank. */
  sort: number;
  display: string;
  /** Short extra detail shown next to the value (sample size, accuracy...). */
  note?: string;
  /** Where and when the result was set, for single-result metrics like PRs. */
  at?: { comp: number; day: number };
}

export interface Metric {
  key: string;
  /** Column header. */
  label: string;
  /** One-paragraph explanation shown on the site. */
  description: string;
  applies(ev: EventInfo): boolean;
  compute(rounds: readonly Round[], ev: EventInfo, ctx: MetricContext): MetricValue | null;
}

// ---- Tunable parameters ----------------------------------------------------

export const RECENT_WINDOW_DAYS = 365;
export const DECAY_HALF_LIFE_DAYS = 365.25 / 4;
export const DECAY_MIN_ROUNDS = 3;
export const DECAY_REQUIRE_WITHIN_DAYS = 365;
/** Sustained average: last 100 attempts, or 50 for events with few attempts per competitor. */
export const SUSTAINED_ATTEMPTS = 100;
export const SUSTAINED_ATTEMPTS_SHORT = 50;
export const SUSTAINED_SHORT_EVENTS = new Set(["333fm", "444bf", "555bf", "333mbf", "666", "777"]);
/** Fraction dropped from each end of the trimmed sustained average (rounded up). */
export const SUSTAINED_TRIM_FRACTION = 0.05;
export const LAST_ROUNDS = 10;
/** Rolling metrics only rank people who competed in the event this recently. */
export const ACTIVE_WITHIN_DAYS = 730;

// ---- Shared helpers --------------------------------------------------------

const hasAverage = (ev: EventInfo) => ev.format !== "multi";
const AVERAGE_FORMATS = new Set(["a", "m"]);

/** The earliest round with the lowest positive value of `pick`, on or after `fromDay`. */
function bestRound(rounds: readonly Round[], fromDay: number, pick: (r: Round) => number): Round | null {
  let best: Round | null = null;
  for (const r of rounds) {
    const v = pick(r);
    if (r.day >= fromDay && v > 0 && (!best || v < pick(best))) best = r;
  }
  return best;
}

function bestSingle(rounds: readonly Round[], ev: EventInfo, fromDay: number): MetricValue | null {
  const r = bestRound(rounds, fromDay, (x) => x.best);
  if (!r) return null;
  // Raw values sort correctly for every format, including multi-blind encoding.
  return { sort: r.best, display: formatSingle(ev, r.best), at: { comp: r.comp, day: r.day } };
}

function bestAverage(rounds: readonly Round[], ev: EventInfo, fromDay: number): MetricValue | null {
  const r = bestRound(rounds, fromDay, (x) => x.average);
  if (!r) return null;
  return { sort: averageNatural(ev, r.average), display: formatAverage(ev, r.average), at: { comp: r.comp, day: r.day } };
}

export type RoundOutcome = { kind: "success"; natural: number; day: number } | { kind: "fail"; day: number };

/**
 * The single value a round contributes to round-based metrics, or null when
 * the round doesn't count at all. Average-based events use the round average
 * (a missed cutoff or DNF average counts as a failed round; best-of rounds are
 * skipped); blindfolded events use the round's best single.
 */
export function roundOutcome(r: Round, ev: EventInfo): RoundOutcome | null {
  if (BEST_SINGLE_ROUND_EVENTS.has(ev.id)) {
    if (r.best > 0) return { kind: "success", natural: singleNatural(ev, r.best), day: r.day };
    if (r.best === DNF) return { kind: "fail", day: r.day };
    return null; // DNS or nothing recorded
  }
  if (!AVERAGE_FORMATS.has(r.format)) return null;
  if (r.average > 0) return { kind: "success", natural: averageNatural(ev, r.average), day: r.day };
  if (r.average === DNS || r.attempts.every((a) => a === DNS || a === 0)) return null; // never competed
  return { kind: "fail", day: r.day };
}

function latestDay(rounds: readonly Round[]): number {
  return rounds.length === 0 ? -Infinity : rounds[rounds.length - 1]!.day;
}

// ---- The ranking systems ---------------------------------------------------

export const METRICS: Metric[] = [
  {
    key: "prSingle",
    label: "PR single",
    description: "All-time best single, exactly as on the official WCA rankings. Shown for reference.",
    applies: () => true,
    compute: (rounds, ev) => bestSingle(rounds, ev, -Infinity),
  },
  {
    key: "prAverage",
    label: "PR average",
    description: "All-time best average, exactly as on the official WCA rankings. Shown for reference.",
    applies: hasAverage,
    compute: (rounds, ev) => bestAverage(rounds, ev, -Infinity),
  },
  {
    key: "worldsSingle",
    label: "Single since Worlds",
    description:
      "Best single at competitions starting on or after the most recent WCA World Championship (that championship included).",
    applies: () => true,
    compute: (rounds, ev, ctx) => bestSingle(rounds, ev, ctx.lastWorldsDay),
  },
  {
    key: "worldsAverage",
    label: "Average since Worlds",
    description:
      "Best average at competitions starting on or after the most recent WCA World Championship (that championship included).",
    applies: hasAverage,
    compute: (rounds, ev, ctx) => bestAverage(rounds, ev, ctx.lastWorldsDay),
  },
  {
    key: "recentSingle",
    label: "12-month peak single",
    description: "Best single at competitions that started in the last 12 months (a peak, not an average over the year).",
    applies: () => true,
    compute: (rounds, ev, ctx) => bestSingle(rounds, ev, ctx.today - RECENT_WINDOW_DAYS),
  },
  {
    key: "recentAverage",
    label: "12-month peak average",
    description: "Best average at competitions that started in the last 12 months (a peak, not an average over the year).",
    applies: hasAverage,
    compute: (rounds, ev, ctx) => bestAverage(rounds, ev, ctx.today - RECENT_WINDOW_DAYS),
  },
  {
    key: "decayed",
    label: "XP weighted mean",
    description:
      "XP = exponential. Weighted mean of every successful round result (the round average; the best single for blindfolded events), where a result's weight halves every 3 months. " +
      "DNF rounds and missed cutoffs are left out. Requires at least 3 such rounds and one in the last 12 months.",
    applies: () => true,
    compute(rounds, ev, ctx) {
      let weightSum = 0;
      let total = 0;
      let count = 0;
      let last = -Infinity;
      for (const r of rounds) {
        const o = roundOutcome(r, ev);
        if (o?.kind !== "success") continue;
        const w = Math.pow(0.5, (ctx.today - o.day) / DECAY_HALF_LIFE_DAYS);
        weightSum += w;
        total += w * o.natural;
        count++;
        last = Math.max(last, o.day);
      }
      if (count < DECAY_MIN_ROUNDS || last < ctx.today - DECAY_REQUIRE_WITHIN_DAYS) return null;
      const mean = total / weightSum;
      return { sort: naturalSortKey(ev, mean), display: formatNatural(ev, mean), note: `${count} rounds` };
    },
  },
  {
    key: "sustained",
    label: "Sustained average",
    description:
      "Speed over a long stretch: the last 100 official attempts (last 50 for 6x6, 7x7, FMC, 4BLD, 5BLD and Multi-Blind), never counting DNS. " +
      "For most events this is a WCA-style trimmed average: the best and worst 5% are dropped, DNFs count as worst, and more DNFs than can be trimmed makes it a DNF. " +
      "For FMC and blindfolded events it's the mean of the successes among those attempts, with the accuracy shown. " +
      "Requires the full number of attempts and a result in the last 2 years.",
    applies: () => true,
    compute(rounds, ev, ctx) {
      if (latestDay(rounds) < ctx.today - ACTIVE_WITHIN_DAYS) return null;
      const want = SUSTAINED_SHORT_EVENTS.has(ev.id) ? SUSTAINED_ATTEMPTS_SHORT : SUSTAINED_ATTEMPTS;
      const attempts: number[] = [];
      for (let i = rounds.length - 1; i >= 0 && attempts.length < want; i--) {
        const a = rounds[i]!.attempts;
        for (let j = a.length - 1; j >= 0 && attempts.length < want; j--) {
          const v = a[j]!;
          if (v > 0 || v === DNF) attempts.push(v);
        }
      }
      if (attempts.length < want) return null;

      if (HIGH_DNF_EVENTS.has(ev.id)) {
        const ok = attempts.filter((v) => v > 0).map((v) => singleNatural(ev, v));
        if (ok.length === 0) return null;
        const mean = ok.reduce((s, v) => s + v, 0) / ok.length;
        return {
          sort: naturalSortKey(ev, mean),
          display: formatNatural(ev, mean),
          note: `${Math.round((ok.length / attempts.length) * 100)}% accuracy`,
        };
      }

      const trim = Math.ceil(want * SUSTAINED_TRIM_FRACTION);
      const dnfs = attempts.filter((v) => v === DNF).length;
      if (dnfs > trim) return null; // a DNF average isn't ranked
      const sorted = attempts
        .map((v) => (v === DNF ? Infinity : singleNatural(ev, v)))
        .sort((a, b) => a - b)
        .slice(trim, want - trim);
      const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      return { sort: naturalSortKey(ev, mean), display: formatNatural(ev, mean), note: dnfs ? `${dnfs} DNF` : undefined };
    },
  },
  {
    key: "last10",
    label: "Last 10 rounds",
    description:
      "Plain mean of the results of the last 10 rounds (the round average; the best single for blindfolded events; best-of rounds of other events are skipped). " +
      "DNF rounds and missed cutoffs still use up one of the 10 but are left out of the mean; when that happens, the note shows how many rounds counted. " +
      "Requires 10 rounds and a result in the last 2 years.",
    applies: () => true,
    compute(rounds, ev, ctx) {
      if (latestDay(rounds) < ctx.today - ACTIVE_WITHIN_DAYS) return null;
      const outcomes: RoundOutcome[] = [];
      for (let i = rounds.length - 1; i >= 0 && outcomes.length < LAST_ROUNDS; i--) {
        const o = roundOutcome(rounds[i]!, ev);
        if (o) outcomes.push(o);
      }
      if (outcomes.length < LAST_ROUNDS) return null;
      const ok = outcomes.flatMap((o) => (o.kind === "success" ? [o.natural] : []));
      if (ok.length === 0) return null;
      const mean = ok.reduce((s, v) => s + v, 0) / ok.length;
      return { sort: naturalSortKey(ev, mean), display: formatNatural(ev, mean), note: ok.length < LAST_ROUNDS ? `${ok.length}/${LAST_ROUNDS} rounds` : undefined };
    },
  },
];
