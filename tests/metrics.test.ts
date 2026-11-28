import { describe, expect, it } from "vitest";
import { DECAY_HALF_LIFE_DAYS, METRICS, type MetricContext, type Round } from "../pipeline/metrics.ts";
import { rankRegions, regionRanks } from "../pipeline/regions.ts";
import { movement } from "../src/data.ts";
import { decodeMulti, formatCentiseconds, formatSingle, type EventInfo } from "../pipeline/units.ts";

const ev = (id: string, format: EventInfo["format"] = "time"): EventInfo => ({ id, name: id, format, rank: 1 });
const E333 = ev("333");
const BLD = ev("333bf");
const FMC = ev("333fm", "number");
const MBLD = ev("333mbf", "multi");

const TODAY = 20_000;
const ctx: MetricContext = { today: TODAY, lastWorldsDay: TODAY - 500 };
const metric = (key: string) => METRICS.find((m) => m.key === key)!;

function round(day: number, attempts: number[], opts: Partial<Round> = {}): Round {
  const ok = attempts.filter((a) => a > 0);
  return {
    day,
    comp: 0,
    roundRank: 0,
    format: "a",
    best: ok.length ? Math.min(...ok) : -1,
    average: 0,
    attempts,
    ...opts,
  };
}

describe("units", () => {
  it("formats times like the WCA", () => {
    expect(formatCentiseconds(987)).toBe("9.87");
    expect(formatCentiseconds(8653)).toBe("1:26.53");
    expect(formatCentiseconds(360000 + 6100)).toBe("1:01:01.00");
  });

  it("decodes new and old style multi-blind", () => {
    // 41/43 in 59:46 (new style): DD = 99 - 39 = 60, MM = 2
    const v = 60_0358_602;
    expect(decodeMulti(600358602)).toEqual({ solved: 41, attempted: 43, seconds: 3586, points: 39 });
    expect(formatSingle(MBLD, v)).toBe("41/43 59:46");
    // Old style 1SSAATTTTT: 10/12 in 3600s -> SS = 89
    expect(decodeMulti(1891203600)).toEqual({ solved: 10, attempted: 12, seconds: 3600, points: 8 });
  });
});

describe("windowed PRs", () => {
  const rounds = [
    round(TODAY - 1000, [900, 1000, 1100, 1200, 1300], { average: 1100 }),
    round(TODAY - 400, [950, 1050, 1150, 1250, 1350], { average: 1150 }),
    round(TODAY - 100, [990, 1090, 1190, 1290, 1390], { average: 1190 }),
  ];
  it("all time, since Worlds and last 12 months", () => {
    expect(metric("prSingle").compute(rounds, E333, ctx)?.display).toBe("9.00");
    expect(metric("worldsSingle").compute(rounds, E333, ctx)?.display).toBe("9.50");
    expect(metric("recentSingle").compute(rounds, E333, ctx)?.display).toBe("9.90");
    expect(metric("recentAverage").compute(rounds, E333, ctx)?.display).toBe("11.90");
  });
  it("is null when nothing falls in the window", () => {
    expect(metric("recentSingle").compute(rounds.slice(0, 2), E333, ctx)).toBeNull();
  });
  it("multi-blind has no average columns", () => {
    expect(metric("prAverage").applies(MBLD)).toBe(false);
    expect(metric("prSingle").applies(MBLD)).toBe(true);
  });
});

describe("sustained average", () => {
  const twentyRounds = (make: (i: number) => number[]) =>
    Array.from({ length: 20 }, (_, i) => round(TODAY - 200 + i, make(i)));

  it("is a plain mean of the successes, with DNFs counted in the note", () => {
    // 100 attempts: 5 DNFs, 5 x 20.00, 90 x 10.00 -> nothing trimmed, mean of 95 successes
    const rounds = twentyRounds((i) => (i < 5 ? [-1, 1000, 1000, 1000, 2000] : [1000, 1000, 1000, 1000, 1000]));
    const v = metric("sustained").compute(rounds, E333, ctx)!;
    expect(v.display).toBe(formatCentiseconds(Math.round((90 * 1000 + 5 * 2000) / 95)));
    expect(v.note).toBe("5 DNF");
  });

  it("never counts DNS and needs 100 attempts", () => {
    const rounds = twentyRounds(() => [1000, 1000, 1000, 1000, -2]);
    expect(metric("sustained").compute(rounds, E333, ctx)).toBeNull();
    const more = [...Array.from({ length: 5 }, (_, i) => round(TODAY - 300 + i, [2000, 2000, 2000, 2000, 2000])), ...rounds];
    // 80 x 10.00 recent + 20 x 20.00 older -> plain mean 12.00
    expect(metric("sustained").compute(more, E333, ctx)!.display).toBe("12.00");
  });

  it("uses only the most recent 100 attempts", () => {
    const old = Array.from({ length: 10 }, (_, i) => round(TODAY - 600 + i, [5000, 5000, 5000, 5000, 5000]));
    const rounds = [...old, ...twentyRounds(() => [1000, 1000, 1000, 1000, 1000])];
    expect(metric("sustained").compute(rounds, E333, ctx)!.display).toBe("10.00");
  });

  it("mean of successes with accuracy for blindfolded", () => {
    const rounds = Array.from({ length: 34 }, (_, i) => round(TODAY - 300 + i, [i % 2 ? 3000 : -1, 2000, -2]));
    // last 100 attempts: 67 rounds' worth... 34 rounds x 2 non-DNS = 68 attempts -> not enough
    expect(metric("sustained").compute(rounds, BLD, ctx)).toBeNull();
    const enough = Array.from({ length: 50 }, (_, i) => round(TODAY - 300 + i, [-1, 2000, -2]));
    const v = metric("sustained").compute(enough, BLD, ctx)!;
    expect(v.display).toBe("20.00");
    expect(v.note).toBe("50% accuracy");
  });

  it("requires recent activity", () => {
    const rounds = Array.from({ length: 20 }, (_, i) => round(TODAY - 900 + i, [1000, 1000, 1000, 1000, 1000]));
    expect(metric("sustained").compute(rounds, E333, ctx)).toBeNull();
  });
});

describe("last 10 rounds", () => {
  it("averages successful rounds and reports how many counted", () => {
    const rounds = Array.from({ length: 12 }, (_, i) =>
      round(TODAY - 100 + i, [1000, 1000, 1000, 1000, 1000], { average: i === 11 ? -1 : 1000 + (i >= 2 ? 0 : 5000) }),
    );
    const v = metric("last10").compute(rounds, E333, ctx)!;
    expect(v.display).toBe("10.00");
    expect(v.note).toBe("9/10 rounds");
  });

  it("counts a missed cutoff as a failed round and skips best-of rounds", () => {
    const rounds = [
      ...Array.from({ length: 9 }, (_, i) => round(TODAY - 100 + i, [1000, 1000, 1000, 1000, 1000], { average: 1000 })),
      round(TODAY - 50, [3000, 3000, 0, 0, 0], { average: 0 }), // missed cutoff
      round(TODAY - 40, [500, 0, 0, 0, 0], { format: "1", average: 0 }), // best-of-1: skipped
    ];
    expect(metric("last10").compute(rounds, E333, ctx)!.note).toBe("9/10 rounds");
    expect(metric("last10").compute(rounds.slice(1), E333, ctx)).toBeNull(); // only 9 counting rounds left
  });

  it("uses best singles for blindfolded and FMC averages in moves", () => {
    const bld = Array.from({ length: 10 }, (_, i) => round(TODAY - 100 + i, [i < 4 ? -1 : 2000, -1, -1], { format: "3" }));
    expect(metric("last10").compute(bld, BLD, ctx)).toMatchObject({ display: "20.00", note: "6/10 rounds" });
    const fmc = Array.from({ length: 10 }, (_, i) => round(TODAY - 100 + i, [25, 26, 27], { format: "m", average: 2600 }));
    expect(metric("last10").compute(fmc, FMC, ctx)!.display).toBe("26.00");
  });
});

describe("decayed mean", () => {
  it("weights recent rounds more", () => {
    const rounds = [
      round(TODAY - 2 * DECAY_HALF_LIFE_DAYS, [0], { average: 2000 }), // weight 0.25
      round(TODAY - DECAY_HALF_LIFE_DAYS, [0], { average: 1500 }), // weight 0.5
      round(TODAY, [0], { average: 1000 }), // weight 1
    ];
    // (0.25*2000 + 0.5*1500 + 1000) / 1.75 = 1285.71
    expect(metric("decayed").compute(rounds, E333, ctx)).toMatchObject({ display: "12.86", note: "3 rounds" });
  });
  it("needs 3 rounds and one in the last year", () => {
    const rounds = [round(TODAY - 800, [0], { average: 1000 }), round(TODAY - 700, [0], { average: 1000 }), round(TODAY - 400, [0], { average: 1000 })];
    expect(metric("decayed").compute(rounds, E333, ctx)).toBeNull();
    expect(metric("decayed").compute(rounds.slice(1), E333, { ...ctx, today: TODAY - 300 })).toBeNull();
  });
  it("ranks multi-blind by points, higher is better", () => {
    const good = Array.from({ length: 3 }, (_, i) => round(TODAY - i, [600358602], { format: "1", best: 600358602 }));
    const v = metric("decayed").compute(good, MBLD, ctx)!;
    expect(v.display).toBe("39.00 pts");
    expect(v.sort).toBe(-39);
  });
});

describe("rankRegions", () => {
  it("keeps the top N per region, including ties at the cutoff", () => {
    const entries = { a: [10, 20, 10, 30, 5].map((sort, person) => ({ person, sort })) };
    const members = rankRegions(entries, (p) => ["world", p % 2 ? "odd" : "even"], 2);
    expect([...members.get("world")!].sort()).toEqual([0, 2, 4]); // 5, then the 10-10 tie for 2nd
    expect([...members.get("even")!].sort()).toEqual([0, 2, 4]);
    expect([...members.get("odd")!].sort()).toEqual([1, 3]);
  });
});

describe("quality-of-life changes", () => {
  it("PR metrics say where and when the result was set (earliest on ties)", () => {
    const rounds = [
      round(TODAY - 300, [1000, 1100, 1200, 1300, 1400], { comp: 7, average: 1200 }),
      round(TODAY - 200, [1000, 1500, 1500, 1500, 1500], { comp: 9, average: 1500 }),
    ];
    expect(metric("prSingle").compute(rounds, E333, ctx)!.at).toEqual({ comp: 7, day: TODAY - 300 });
    expect(metric("prAverage").compute(rounds, E333, ctx)!.at).toEqual({ comp: 7, day: TODAY - 300 });
    expect(metric("decayed").compute([...rounds, rounds[0]!], E333, ctx)!.at).toBeUndefined();
  });

  it("last 10 rounds has no note when all 10 counted", () => {
    const rounds = Array.from({ length: 10 }, (_, i) => round(TODAY - 100 + i, [1000, 1000, 1000, 1000, 1000], { average: 1000 }));
    expect(metric("last10").compute(rounds, E333, ctx)!.note).toBeUndefined();
  });

  it("sustained average uses 50 attempts for 6x6/7x7", () => {
    const E666 = ev("666");
    // 17 mean-of-3 rounds = 51 attempts (the oldest drops off); the last 50 have 3 DNFs, left out of the mean.
    const rounds = Array.from({ length: 17 }, (_, i) => round(TODAY - 100 + i, i >= 1 && i < 4 ? [-1, 10000, 10000] : [10000, 10000, 10000], { format: "m" }));
    const v = metric("sustained").compute(rounds, E666, ctx)!;
    expect(v.display).toBe("1:40.00");
    expect(v.note).toBe("3 DNF");
    // 3x3 still needs 100
    expect(metric("sustained").compute(rounds, E333, ctx)).toBeNull();
  });

  it("FMC sustained average needs only 50 attempts", () => {
    const rounds = Array.from({ length: 25 }, (_, i) => round(TODAY - 100 + i, [26, -1], { format: "2" }));
    expect(metric("sustained").compute(rounds, FMC, ctx)).toMatchObject({ display: "26.00", note: "50% accuracy" });
  });
});

describe("peak Mo5R since Worlds", () => {
  const avg = (day: number, average: number, comp = 0) => round(day, [average, average, average, average, average], { average, comp });
  const m = metric("peakMo5r");

  it("finds the best window of 5 consecutive rounds since Worlds", () => {
    const rounds = [
      avg(TODAY - 600, 500), // before Worlds, ignored
      ...[1000, 900, 800, 700, 600, 1500].map((a, i) => avg(TODAY - 400 + i, a, i + 1)),
    ];
    // Windows: 1000..600 = 8.00, 900..1500 = 9.00
    const v = m.compute(rounds, E333, ctx);
    expect(v?.display).toBe("8.00");
    expect(v?.at).toEqual({ comp: 5, day: TODAY - 396 });
  });

  it("a DNF round makes every window containing it a DNF", () => {
    const dnf = round(TODAY - 395, [-1, -1, 1000, 1000, 1000], { average: -1 });
    const rounds = [1000, 900, 800, 700, 600].map((a, i) => avg(TODAY - 400 + i, a));
    expect(m.compute([...rounds, dnf], E333, ctx)?.display).toBe("8.00");
    expect(m.compute([...rounds.slice(0, 4), dnf, rounds[4]!], E333, ctx)).toBeNull();
  });

  it("needs 5 rounds since Worlds", () => {
    const rounds = [1000, 900, 800, 700].map((a, i) => avg(TODAY - 400 + i, a));
    expect(m.compute(rounds, E333, ctx)).toBeNull();
  });
});

describe("week-over-week movement", () => {
  it("ranks over everyone in the region, ties sharing a rank", () => {
    const entries = [
      { person: 1, sort: 500 },
      { person: 2, sort: 400 },
      { person: 3, sort: 400 },
      { person: 4, sort: 300 },
    ];
    const regionsOf = (p: number) => (p === 4 ? ["world", "us"] : ["world", "cn"]);
    const members = new Map([["world", new Set([1, 2, 3])], ["cn", new Set([1])]]);
    const ranks = regionRanks(entries, regionsOf, members);
    expect([...ranks.get("world")!]).toEqual([[2, 2], [3, 2], [1, 4]]);
    expect(ranks.get("cn")!.get(1)).toBe(3);
    expect(ranks.has("us")).toBe(false);
  });

  it("describes the change like power rankings", () => {
    expect(movement({ s: 1, d: "4.38", pr: 5, pd: "4.51" }, 2)).toMatchObject({
      kind: "up",
      text: "▲3",
      detail: "Last week: #5 · 4.51 → 4.38 (−0.13)",
    });
    expect(movement({ s: 1, d: "1:02.00", pr: 1, pd: "1:01.50" }, 3)).toMatchObject({ kind: "down", text: "▼2" });
    expect(movement({ s: 1, d: "1:02.00", pr: 1, pd: "1:01.50" }, 3).detail).toContain("(+0.50)");
    expect(movement({ s: 1, d: "4.38", pr: 2, pd: "4.38" }, 2)).toMatchObject({ kind: "same", text: "–" });
    expect(movement({ s: 1, d: "4.38" }, 7)).toMatchObject({ kind: "new", text: "NEW" });
  });
});
