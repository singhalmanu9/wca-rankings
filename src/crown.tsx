// Crown for last Worlds' podium in the Worlds-field view: gold for the
// champion, silver for 2nd, bronze for 3rd. The same shape is drawn on the
// generated graphic.

/** 24x24 crown outline (points and band). */
export const CROWN_PATH = "M2.5 8.5 7 12l5-7.5 5 7.5 4.5-3.5L19.5 18h-15zM4.5 19.5h15V21h-15z";
export const CROWN_COLORS = ["#facc15", "#cbd5e1", "#c2703d"] as const;

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : "3rd");

export function crownTitle(place: number, worldsDate: string): string {
  const year = worldsDate.slice(0, 4);
  return place === 1 ? `Defending champion (Worlds ${year})` : `${ordinal(place)} at Worlds ${year}`;
}

export function Crown({ place, worlds }: { place: number; worlds: { date: string } }) {
  const title = crownTitle(place, worlds.date);
  return (
    <svg class="crown" viewBox="0 0 24 24" width="14" height="14" role="img" aria-label={title}>
      <title>{title}</title>
      <path d={CROWN_PATH} fill={CROWN_COLORS[place - 1]} />
    </svg>
  );
}
