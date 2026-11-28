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

const start = wcif.schedule?.startDate ?? "";
// Once that Worlds has started, its own results take over: no field, empty hash.
if (start && new Date().toISOString().slice(0, 10) >= start) {
  rmSync(".cache/field.json", { force: true });
  console.log("");
  process.exit(0);
}
const text = JSON.stringify({ competition: COMPETITION, name: wcif.name, startDate: start, registrants });
mkdirSync(".cache", { recursive: true });
writeFileSync(".cache/field.json", text);
console.log(createHash("sha256").update(text).digest("hex"));
