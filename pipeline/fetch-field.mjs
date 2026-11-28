// Fetches the accepted registrants of the upcoming World Championship from the
// WCA API and writes them to .cache/field.json for the build ("Worlds field"
// region). Prints a hash of the file so the nightly check can tell whether the
// list changed. Plain Node, no dependencies, so the check job can run it
// without `npm ci`.
//
//   node pipeline/fetch-field.mjs

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

/** The upcoming Worlds. Change this when the next one is announced. */
const COMPETITION = "WC2027";

const res = await fetch(`https://www.worldcubeassociation.org/api/v0/competitions/${COMPETITION}/wcif/public`);
if (!res.ok) throw new Error(`WCA API: HTTP ${res.status}`);
const wcif = await res.json();

const registrants = wcif.persons
  .filter((p) => p.wcaId && p.registration?.status === "accepted" && p.registration.isCompeting)
  .map((p) => [p.wcaId, [...p.registration.eventIds].sort()])
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));

/** Days after that Worlds ends that the field stays up, for reference during and just after it. */
const KEEP_DAYS = 7;
const start = wcif.schedule?.startDate ?? "";
const days = wcif.schedule?.numberOfDays ?? 1;
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const until = start ? addDays(start, days - 1 + KEEP_DAYS) : "";
// Past the cutoff: no field, empty hash.
if (until && new Date().toISOString().slice(0, 10) > until) {
  rmSync(".cache/field.json", { force: true });
  console.log("");
  process.exit(0);
}
const text = JSON.stringify({ competition: COMPETITION, name: wcif.name, startDate: start, until, registrants });
mkdirSync(".cache", { recursive: true });
writeFileSync(".cache/field.json", text);
console.log(createHash("sha256").update(text).digest("hex"));
