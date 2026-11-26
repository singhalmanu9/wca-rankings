import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EVENT_SHORT, loadMeta, loadRegion, rank, recordTag, regionBests, type Cell, type Meta, type RegionFile } from "./data";
import { Flag } from "./flags";
import { GraphicDialog, type GraphicData } from "./graphic";

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
        // A shared link's hash is applied once, then dropped so it can't go stale.
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!meta) return;
    const onHash = () => {
      if (!location.hash) return;
      setSel(resolve(meta, parseHash()));
      history.replaceState(null, "", location.pathname + location.search);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [meta]);

  if (error) return <Shell><p class="error">Couldn't load rankings: {error}</p></Shell>;
  if (!meta || !sel) return <Shell><p class="muted">Loading…</p></Shell>;

  const update = (patch: Partial<Selection>) => setSel(resolve(meta, { ...sel, ...patch }));
  return (
    <Shell meta={meta}>
      <Controls meta={meta} sel={sel} update={update} />
      <div class="table-bar">
        <Freshness meta={meta} />
        <GraphicButton meta={meta} sel={sel} />
      </div>
      <Rankings meta={meta} sel={sel} update={update} />
    </Shell>
  );
}

function Shell({ meta, children }: { meta?: Meta; children: preact.ComponentChildren }) {
  const exportDate = meta ? new Date(meta.exportDate).toLocaleDateString(undefined, { dateStyle: "long" }) : null;
  return (
    <div class="page">
      <header>
        <h1>Recency Weighted Rankings</h1>
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
            as of {exportDate}, and refreshed nightly from the WCA export. "Since Worlds" means since {meta.lastWorlds.name} ({meta.lastWorlds.date}).
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
        <MetricInfo metric={meta.metrics.find((m) => m.key === sel.metric)!} />
        <CopyLink sel={sel} />
      </div>
    </section>
  );
}

interface Tip {
  title: string;
  detail: string;
  x: number;
  y: number;
  wide?: boolean;
}

/** Touch screens get the (i) button only; hover tooltips are for mice. */
const canHover = () => matchMedia("(hover: hover)").matches;

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
  const bests = useMemo(() => (file ? regionBests(file.rows, ev.metrics) : new Map<string, number>()), [file, ev]);
  const tag = recordTag(sel.region);
  const ranked = useMemo(() => (file ? rank(file.rows, sel.metric, meta.topN) : []), [file, sel.metric, meta.topN]);

  if (error) return <p class="error">Couldn't load this table: {error}</p>;
  if (!file) return <p class="muted">Loading…</p>;
  if (ranked.length === 0) return <p class="muted">Nobody in this region qualifies for this ranking yet.</p>;

  const showTip = (e: Event, cell: Cell) => {
    if (!cell.c || !cell.t) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ title: file.comps[cell.c] ?? cell.c, detail: describeWhen(cell.t), x: rect.left + rect.width / 2, y: rect.bottom });
  };

  const showHeaderTip = (e: Event, m: { label: string; description: string }) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ title: m.label, detail: m.description, x: rect.left + rect.width / 2, y: rect.bottom, wide: true });
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
                  <button
                    onClick={() => update({ metric: c.key })}
                    onMouseEnter={(e) => canHover() && showHeaderTip(e, c)}
                    onMouseLeave={() => setTip(null)}
                  >
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
                          <span class="line">
                          {bests.get(c.key) === cell.s && (
                            <span class={`rec ${tag.kind}`} title={`Best in this region`}>
                              {tag.label}
                            </span>
                          )}
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
                          </span>
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
          class={tip.wide ? "tip wide" : "tip"}
          role="tooltip"
          style={{ left: `${Math.min(Math.max(tip.x, tip.wide ? 170 : 130), window.innerWidth - (tip.wide ? 170 : 130))}px`, top: `${tip.y + 6}px` }}
        >
          <strong>{tip.title}</strong>
          <span>{tip.detail}</span>
        </div>
      )}
    </>
  );
}

/** Data older than this means the nightly update has probably stopped. */
const STALE_AFTER_DAYS = 3;

function Freshness({ meta }: { meta: Meta }) {
  const exported = new Date(meta.exportDate);
  const ageDays = (Date.now() - exported.getTime()) / DAY_MS;
  const when = exported.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const ago =
    ageDays < 1 / 24
      ? "just now"
      : ageDays < 1
        ? `${Math.round(ageDays * 24)} h ago`
        : `${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"} ago`;
  const stale = ageDays > STALE_AFTER_DAYS;
  return (
    <p class={stale ? "freshness stale" : "freshness"} title={`Rankings computed ${new Date(meta.builtAt).toLocaleString()}`}>
      Results as of <strong>{when}</strong> ({ago}) · from the WCA's nightly export
      {stale && " · this is older than usual, so the nightly update may have stopped"}
    </p>
  );
}

/**
 * "What does this mean?" button: hovering, focusing or tapping it shows the
 * current ranking's definition in a popover.
 */
function MetricInfo({ metric }: { metric: { key: string; label: string; description: string } }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Open toward whichever side has room for the popover (max 380px wide).
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAlignRight(r.left + 392 > window.innerWidth);
  };

  // A tap pins it open (touch has no hover); tapping anywhere else closes it.
  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPinned(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  useEffect(() => setPinned(false), [metric.key]);

  const open = hover || pinned;
  return (
    <div
      class="info"
      ref={ref}
      onMouseEnter={() => {
        place();
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        class={open ? "info-btn open" : "info-btn"}
        aria-expanded={open}
        aria-controls="metric-info"
        aria-label={`What does "${metric.label}" mean?`}
        onClick={() => {
          place();
          setPinned((p) => !p);
        }}
        onFocus={() => {
          place();
          setHover(true);
        }}
        onBlur={() => setHover(false)}
      >
        <span class="info-icon" aria-hidden="true">i</span>
        <span class="info-text">What does this mean?</span>
      </button>
      {open && (
        <div class={alignRight ? "popover right" : "popover"} id="metric-info" role="tooltip">
          <strong>{metric.label}</strong>
          <p>{metric.description}</p>
        </div>
      )}
    </div>
  );
}

/** Copies a link to the current view; the address bar itself stays clean. */
function CopyLink({ sel }: { sel: Selection }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [sel]);
  const copy = async () => {
    const url = `${location.origin}${location.pathname}#/${sel.event}/${sel.region}/${sel.metric}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      prompt("Copy this link:", url);
    }
  };
  return (
    <button type="button" class="info-btn copy-btn" onClick={copy}>
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

/** Opens the "top 10 as a PNG" preview for the current view. */
function GraphicButton({ meta, sel }: { meta: Meta; sel: Selection }) {
  const [data, setData] = useState<GraphicData | null>(null);
  const open = async () => {
    const file = await loadRegion(sel.event, sel.region);
    const rows = rank(file.rows, sel.metric, meta.topN).slice(0, 10);
    if (rows.length === 0) return;
    const region =
      sel.region === "world"
        ? "World"
        : ([...meta.continents, ...meta.countries].find((r) => r.key === sel.region)?.name ?? sel.region);
    setData({
      event: meta.events.find((e) => e.id === sel.event)!.name,
      region,
      metric: meta.metrics.find((m) => m.key === sel.metric)!.label,
      metricKey: sel.metric,
      blurb: meta.metrics.find((m) => m.key === sel.metric)!.blurb,
      asOf: new Date(meta.exportDate).toLocaleDateString(undefined, { dateStyle: "medium" }),
      rows,
      best: regionBests(file.rows, [sel.metric]).get(sel.metric),
      tag: recordTag(sel.region),
      fileName: `${sel.event}-${sel.region}-${sel.metric}.png`,
    });
  };
  return (
    <>
      <button type="button" class="info-btn graphic-btn" onClick={open}>
        Generate graphic
      </button>
      {data && <GraphicDialog data={data} onClose={() => setData(null)} />}
    </>
  );
}
