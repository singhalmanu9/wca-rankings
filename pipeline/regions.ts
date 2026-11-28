export interface RankedEntry {
  person: number;
  sort: number;
}

/** "_North America" -> "c-north-america". Country keys are lowercase ISO2 codes. */
export function regionKeyForContinent(continentId: string): string {
  return "c-" + continentId.replace(/^_/, "").toLowerCase().replace(/\s+/g, "-");
}

/**
 * For each region, the set of people who are in that region's top `topN` for
 * at least one metric (ties at the cutoff are all included). Each region's
 * file then holds everything needed to show its top N for every metric.
 */
export function rankRegions(
  entriesByMetric: Record<string, RankedEntry[]>,
  regionsOf: (person: number) => string[],
  topN: number,
): Map<string, Set<number>> {
  const members = new Map<string, Set<number>>();
  for (const entries of Object.values(entriesByMetric)) {
    const sorted = [...entries].sort((a, b) => a.sort - b.sort);
    const count = new Map<string, number>();
    const lastSort = new Map<string, number>();
    for (const { person, sort } of sorted) {
      for (const region of regionsOf(person)) {
        const c = count.get(region) ?? 0;
        if (c >= topN && lastSort.get(region) !== sort) continue;
        count.set(region, c + 1);
        lastSort.set(region, sort);
        let set = members.get(region);
        if (!set) members.set(region, (set = new Set()));
        set.add(person);
      }
    }
  }
  return members;
}

/**
 * Each listed person's rank in each of their regions (1 + the number of
 * people strictly ahead, so ties share a rank), counted over everyone in
 * `entries`, not just the top N. Only people in `members` are recorded.
 */
export function regionRanks(
  entries: RankedEntry[],
  regionsOf: (person: number) => string[],
  members: Map<string, Set<number>>,
): Map<string, Map<number, number>> {
  const ranks = new Map<string, Map<number, number>>();
  const count = new Map<string, number>();
  const last = new Map<string, { sort: number; rank: number }>();
  for (const { person, sort } of [...entries].sort((a, b) => a.sort - b.sort)) {
    for (const region of regionsOf(person)) {
      const c = (count.get(region) ?? 0) + 1;
      count.set(region, c);
      const prev = last.get(region);
      const rank = prev && prev.sort === sort ? prev.rank : c;
      last.set(region, { sort, rank });
      if (!members.get(region)?.has(person)) continue;
      let m = ranks.get(region);
      if (!m) ranks.set(region, (m = new Map()));
      m.set(person, rank);
    }
  }
  return ranks;
}
