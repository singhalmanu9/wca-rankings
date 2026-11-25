import { useEffect, useMemo, useState } from "preact/hooks";
import { EVENT_SHORT, loadMeta, loadRegion, rank, type Cell, type Meta, type RegionFile } from "./data";
import { Flag } from "./flags";

interface Selection {
  event: string;
  region: string;
  metric: string;
}

const DEFAULT_METRICS = ["recentAverage", "recentSingle"];

function parseHash(): Partial<Selection> {
  const [event, region, metric] = location.hash.replace(/^#\/?/, "").split("/");
  return { event: event || undefined, region: region || undefined, metric: metric || undefined };
}

/** Fill in or correct a (possibly partial or stale) selection against meta. */
function resolve(meta: Meta, want: Partial<Selection>): Selection {
  const ev = meta.events.find((e) => e.id === want.event) ?? meta.events[0]!;
  const region = want.region && ev.regions.includes(want.region) ? want.region : "world";
  const metric =
    want.metric && ev.metrics.includes(want.metric)
      ? want.metric
      : DEFAULT_METRICS.find((m) => ev.metrics.includes(m)) ?? ev.metrics[0]!;
  return { event: ev.id, region, metric };
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);

  useEffect(() => {
    loadMeta()
      .then((m) => {
        setMeta(m);
        setSel(resolve(m, parseHash()));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!meta) return;
    const onHash = () => setSel(resolve(meta, parseHash()));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [meta]);

  useEffect(() => {
    if (sel) history.replaceState(null, "", `#/${sel.event}/${sel.region}/${sel.metric}`);
  }, [sel]);

  if (error) return <Shell><p class="error">Couldn't load rankings: {error}</p></Shell>;
  if (!meta || !sel) return <Shell><p class="muted">Loading…</p></Shell>;

  const update = (patch: Partial<Selection>) => setSel(resolve(meta, { ...sel, ...patch }));
  return (
    <Shell meta={meta}>
      <Controls meta={meta} sel={sel} update={update} />
      <Rankings meta={meta} sel={sel} update={update} />
    </Shell>
  );
}

function Shell({ meta, children }: { meta?: Meta; children: preact.ComponentChildren }) {
  const exportDate = meta ? new Date(meta.exportDate).toLocaleDateString(undefined, { dateStyle: "long" }) : null;
  return (
    <div class="page">
      <header>
        <h1>Current-form rankings</h1>
        <p class="muted">
          WCA rankings that care about what you've done lately, not just your all-time PR. Pick an event, a region and a
          ranking system; click any column to sort by it.
        </p>
      </header>
      <main>{children}</main>
      {meta && (
        <footer class="muted">
          <p>
            This information is based on competition results owned and maintained by the World Cube Association,
            published at{" "}
            <a href="https://worldcubeassociation.org/results" target="_blank" rel="noopener">
              worldcubeassociation.org/results
            </a>{" "}
            as of {exportDate}. "Since Worlds" means since {meta.lastWorlds.name} ({meta.lastWorlds.date}).
          </p>
        </footer>
      )}
    </div>
  );
}

function Controls({ meta, sel, update }: { meta: Meta; sel: Selection; update: (p: Partial<Selection>) => void }) {
  const ev = meta.events.find((e) => e.id === sel.event)!;
  const available = new Set(ev.regions);
  return (
    <section class="controls">
      <div class="events" role="tablist" aria-label="Event">
        {meta.events.map((e) => (
          <button
            key={e.id}
            role="tab"
            aria-selected={e.id === sel.event}
            class={e.id === sel.event ? "chip active" : "chip"}
            title={e.name}
            onClick={() => update({ event: e.id })}
          >
            {EVENT_SHORT[e.id] ?? e.id}
          </button>
        ))}
      </div>
      <div class="row">
        <label>
          <span>Region</span>
          <select value={sel.region} onChange={(e) => update({ region: (e.target as HTMLSelectElement).value })}>
            <option value="world">World</option>
            <optgroup label="Continents">
              {meta.continents.filter((c) => available.has(c.key)).map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Countries">
              {meta.countries.filter((c) => available.has(c.key)).map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          <span>Ranked by</span>
          <select value={sel.metric} onChange={(e) => update({ metric: (e.target as HTMLSelectElement).value })}>
            {meta.metrics.filter((m) => ev.metrics.includes(m.key)).map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p class="description">{meta.metrics.find((m) => m.key === sel.metric)?.description}</p>
    </section>
  );
}

interface Tip {
  title: string;
  detail: string;
  x: number;
  y: number;
}

const DAY_MS = 86_400_000;

function describeWhen(date: string): string {
  const then = Date.parse(date + "T00:00:00Z");
  const formatted = new Date(then).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - then) / DAY_MS);
  const ago = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days.toLocaleString()} days ago`;
  return `${formatted} · ${ago}`;
}

function Rankings({ meta, sel, update }: { meta: Meta; sel: Selection; update: (p: Partial<Selection>) => void }) {
  const [file, setFile] = useState<RegionFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setFile(null);
    setTip(null);
    loadRegion(sel.event, sel.region)
      .then((f) => live && setFile(f))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [sel.event, sel.region]);

  // A fixed-position tooltip would drift away from its cell on scroll.
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    addEventListener("scroll", hide, { capture: true, passive: true });
    return () => removeEventListener("scroll", hide, { capture: true });
  }, [tip]);

  const ev = meta.events.find((e) => e.id === sel.event)!;
  // The column being ranked by comes first, right next to the name.
  const all = meta.metrics.filter((m) => ev.metrics.includes(m.key));
  const columns = [...all.filter((m) => m.key === sel.metric), ...all.filter((m) => m.key !== sel.metric)];
  const countryName = useMemo(() => new Map(meta.countries.map((c) => [c.key.toUpperCase(), c.name])), [meta]);
  const ranked = useMemo(() => (file ? rank(file.rows, sel.metric, meta.topN) : []), [file, sel.metric, meta.topN]);

  if (error) return <p class="error">Couldn't load this table: {error}</p>;
  if (!file) return <p class="muted">Loading…</p>;
  if (ranked.length === 0) return <p class="muted">Nobody in this region qualifies for this ranking yet.</p>;

  const showTip = (e: Event, cell: Cell) => {
    if (!cell.c || !cell.t) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ title: file.comps[cell.c] ?? cell.c, detail: describeWhen(cell.t), x: rect.left + rect.width / 2, y: rect.bottom });
  };

  return (
    <>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="rank">#</th>
              <th class="name">Name</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  class={c.key === sel.metric ? "metric sorted" : "metric"}
                  aria-sort={c.key === sel.metric ? "ascending" : undefined}
                >
                  <button title={c.description} onClick={() => update({ metric: c.key })}>
                    {c.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ rank, row }, i) => (
              <tr key={row.id}>
                <td class="rank">{ranked[i - 1]?.rank === rank ? "" : rank}</td>
                <td class="name">
                  <Flag iso2={row.country} name={countryName.get(row.country) ?? row.country} />
                  <a href={`https://www.worldcubeassociation.org/persons/${row.id}`} target="_blank" rel="noopener">
                    {row.name}
                  </a>
                </td>
                {columns.map((c) => {
                  const cell = row.m[c.key];
                  return (
                    <td key={c.key} class={c.key === sel.metric ? "metric sorted" : "metric"}>
                      {cell ? (
                        <>
                          {cell.c ? (
                            <span
                              class="value has-tip"
                              tabIndex={0}
                              onMouseEnter={(e) => showTip(e, cell)}
                              onMouseLeave={() => setTip(null)}
                              onFocus={(e) => showTip(e, cell)}
                              onBlur={() => setTip(null)}
                            >
                              {cell.d}
                            </span>
                          ) : (
                            <span class="value">{cell.d}</span>
                          )}
                          {cell.n && <span class="note">{cell.n}</span>}
                        </>
                      ) : (
                        <span class="none">–</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip && (
        <div
          class="tip"
          role="tooltip"
          style={{ left: `${Math.min(Math.max(tip.x, 130), window.innerWidth - 130)}px`, top: `${tip.y + 6}px` }}
        >
          <strong>{tip.title}</strong>
          <span>{tip.detail}</span>
        </div>
      )}
    </>
  );
}
