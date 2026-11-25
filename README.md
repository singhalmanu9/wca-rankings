# WCA Current-Form Rankings

Rankings for every official WCA event that weigh recent results more than old
ones, instead of only all-time PR single and average. Filter by world,
continent or country and sort by any ranking system.

Live at https://singhalmanu9.github.io/wca-rankings/

## Ranking systems

| Column | What it measures |
|---|---|
| PR single / average | All-time bests, as on the official rankings (for reference) |
| Single / average since Worlds | Bests at competitions starting on or after the latest World Championship |
| 12-month single / average | Bests at competitions that started in the last 12 months |
| Decayed mean | Weighted mean of every successful round result, weight halving every 6 months; needs 3 rounds and one in the last year |
| Last 100 solves | WCA-style trimmed average of the last 100 attempts (5 dropped each side, DNF = worst, >5 DNFs = DNF). FMC and blindfolded: mean of the successes plus accuracy. DNS never counts |
| Last 10 rounds | Mean of the last 10 round results; DNF rounds and missed cutoffs use a slot but aren't averaged, and the count is shown |

"Round result" is the round average, except for blindfolded events, where it's
the round's best single. Best-of rounds of other events are skipped. The
rolling columns only rank people with a result in the event in the last 2 years.

All parameters live at the top of [pipeline/metrics.ts](pipeline/metrics.ts).
To add a ranking system, add an entry to `METRICS` there; the build and the site
pick it up automatically.

## How it works

A GitHub Action runs daily: it downloads the official
[WCA results export](https://www.worldcubeassociation.org/export/results)
(TSV, format v2), runs `pipeline/build.ts` to compute every metric for every
competitor and event, and writes the top 100 per region as small JSON files
(`public/data/<event>/<region>.json`). The Preact site just loads those.

## Local development

```sh
npm install
# Download and unzip the export into .cache/tsv (~390 MB zip)
curl -L -o .cache/export.zip https://www.worldcubeassociation.org/export/results/v2/tsv
unzip -o .cache/export.zip -d .cache/tsv
npm run data   # ~40 s, writes public/data
npm run dev
npm test
```

This information is based on competition results owned and maintained by the
World Cube Association, published at https://worldcubeassociation.org/results.
