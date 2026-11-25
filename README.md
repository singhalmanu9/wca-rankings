# WCA Current-Form Rankings

Rankings for every official WCA event that weigh recent results more than old
ones, instead of only all-time PR single and average. Filter by world,
continent or country and sort by any ranking system.

Live at https://singhalmanu9.github.io/wca-rankings/

## Ranking systems

| Column | What it measures |
|---|---|
| PR single / average | All-time bests, as on the official rankings (for reference). Hover any PR-style value for the competition and how long ago it was |
| Single / average since Worlds | Bests at competitions starting on or after the latest World Championship |
| 12-month single / average | Bests at competitions that started in the last 12 months |
| Decayed mean | Weighted mean of every successful round result, weight halving every 3 months; needs 3 rounds and one in the last year |
| Sustained average | Last 100 attempts (50 for 6x6, 7x7, FMC, 4BLD, 5BLD, MBLD): WCA-style trimmed average, 5% dropped each side, DNF = worst, too many DNFs = DNF. FMC and blindfolded: mean of the successes plus accuracy. DNS never counts |
| Last 10 rounds | Mean of the last 10 round results; DNF rounds and missed cutoffs use a slot but aren't averaged, and then the count is shown |

"Round result" is the round average, except for blindfolded events, where it's
the round's best single. Best-of rounds of other events are skipped. The
rolling columns only rank people with a result in the event in the last 2 years.

All parameters live at the top of [pipeline/metrics.ts](pipeline/metrics.ts).
To add a ranking system, add an entry to `METRICS` there; the build and the site
pick it up automatically.

## How it works

Everything is precomputed; the page never calculates rankings itself, it just
loads small JSON files (`public/data/<event>/<region>.json`, the top 100 per
region for every metric).

GitHub Pages only serves static files, so the nightly job runs in GitHub
Actions ([deploy.yml](.github/workflows/deploy.yml)), free for public repos:

1. **Check** (twice a day, 03:15 and 15:15 UTC): compare the WCA export's
   `export_date` with the live site's `meta.json`, and stop if nothing is new.
   The WCA publishes a new export nightly around 00:30 UTC.
2. **Build**: download the [WCA results export](https://www.worldcubeassociation.org/export/results)
   (TSV, format v2), run `pipeline/build.ts`, build the site.
3. **Deploy** to Pages. The page shows "Results as of ..." above the table and
   warns if that's more than 3 days old.

Pushes to `main` always rebuild. GitHub switches off scheduled workflows in
public repos after 60 days without activity, so when the last commit is more
than 50 days old the check job pushes an empty "[skip ci]" commit (about 7 a
year, only while the repo is otherwise idle). A failed run emails the repo
owner, and the page shows a stale-data warning after 3 days.

### Timings (local, 7.1M results / 32.8M attempts)

| Step | Time |
|---|---|
| Download export (389 MB) | ~6 s |
| Unzip the tables we use | ~8 s |
| Load small tables | 0.7 s |
| Load results | 7 s |
| Load attempts | 3 s |
| Group by event and competitor | 0.4 s |
| Compute metrics, rank regions, write ~2,300 files | 10 s |

The big tables are read by a byte-level scanner (`scanTsv`) instead of
line splitting, and rows are grouped with a counting sort; together those took
the pipeline from ~41 s to ~21 s with identical output.

## Local development

```sh
npm install
# Download and unzip the export into .cache/tsv (~390 MB zip)
curl -L -o .cache/export.zip https://www.worldcubeassociation.org/export/results/v2/tsv
unzip -o .cache/export.zip -d .cache/tsv -x WCA_export_scrambles.tsv
npm run data   # ~20 s, writes public/data
npm run dev
npm test
```

This information is based on competition results owned and maintained by the
World Cube Association, published at https://worldcubeassociation.org/results.
