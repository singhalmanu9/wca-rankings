// Event-specific value handling: decoding raw WCA values, turning them into
// "natural" units that can be averaged, and formatting them for display.

export type EventFormat = "time" | "number" | "multi";

export interface EventInfo {
  id: string;
  name: string;
  format: EventFormat;
  rank: number;
}

/** Events where DNFs are common enough that trimmed averages make no sense. */
export const HIGH_DNF_EVENTS = new Set(["333bf", "444bf", "555bf", "333mbf", "333fm"]);

/**
 * Events whose round-based metrics use each round's best single instead of
 * its average (blindfolded events are traditionally judged by single).
 */
export const BEST_SINGLE_ROUND_EVENTS = new Set(["333bf", "444bf", "555bf", "333mbf"]);

export const DNF = -1;
export const DNS = -2;

export interface MultiResult {
  solved: number;
  attempted: number;
  seconds: number | null;
  points: number;
}

export function decodeMulti(value: number): MultiResult {
  if (value >= 1_000_000_000) {
    // Old style: 1SSAATTTTT
    const ss = Math.floor(value / 10_000_000) % 100;
    const aa = Math.floor(value / 100_000) % 100;
    const t = value % 100_000;
    const solved = 99 - ss;
    return { solved, attempted: aa, seconds: t === 99999 ? null : t, points: solved - (aa - solved) };
  }
  // New style: 0DDTTTTTMM
  const dd = Math.floor(value / 10_000_000) % 100;
  const t = Math.floor(value / 100) % 100_000;
  const missed = value % 100;
  const difference = 99 - dd;
  const solved = difference + missed;
  return { solved, attempted: solved + missed, seconds: t === 99999 ? null : t, points: difference };
}

/**
 * A successful single attempt in units that can be averaged:
 * centiseconds for timed events, moves for FMC, points for Multi-Blind.
 */
export function singleNatural(ev: EventInfo, value: number): number {
  return ev.format === "multi" ? decodeMulti(value).points : value;
}

/** A successful round average in natural units (FMC averages are stored x100). */
export function averageNatural(ev: EventInfo, value: number): number {
  return ev.format === "number" ? value / 100 : value;
}

/** Lower is better everywhere; Multi-Blind points are higher-is-better, so negate. */
export function naturalSortKey(ev: EventInfo, natural: number): number {
  return ev.format === "multi" ? -natural : natural;
}

export function formatCentiseconds(cs: number): string {
  const total = Math.round(cs);
  const hundredths = total % 100;
  const totalSeconds = Math.floor(total / 100);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const frac = String(hundredths).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${frac}`;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${frac}`;
  return `${seconds}.${frac}`;
}

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds / 60) % 60;
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Format a raw single result as the WCA shows it. */
export function formatSingle(ev: EventInfo, value: number): string {
  if (value === DNF) return "DNF";
  if (value === DNS) return "DNS";
  switch (ev.format) {
    case "time":
      return formatCentiseconds(value);
    case "number":
      return String(value);
    case "multi": {
      const m = decodeMulti(value);
      return `${m.solved}/${m.attempted} ${m.seconds === null ? "?:??" : formatClock(m.seconds)}`;
    }
  }
}

/** Format a raw round average as the WCA shows it. */
export function formatAverage(ev: EventInfo, value: number): string {
  if (value === DNF) return "DNF";
  if (ev.format === "number") return (value / 100).toFixed(2);
  return formatCentiseconds(value);
}

/** Format a computed mean that is already in natural units. */
export function formatNatural(ev: EventInfo, natural: number): string {
  switch (ev.format) {
    case "time":
      return formatCentiseconds(natural);
    case "number":
      return natural.toFixed(2);
    case "multi":
      return `${natural.toFixed(2)} pts`;
  }
}
