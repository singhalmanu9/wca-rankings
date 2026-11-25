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
