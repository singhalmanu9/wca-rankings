// "Generate graphic": draws the top 10 of the current table onto a fixed
// 1080x1080 template and shows it in a preview with Download / Copy.

import { useEffect, useRef, useState } from "preact/hooks";
import { movement, type RecordTag, type Row } from "./data";
import { flagUrl } from "./flags";

export interface GraphicData {
  event: string;
  region: string;
  metric: string;
  metricKey: string;
  blurb?: string;
  asOf: string;
  rows: { rank: number; row: Row }[];
  fileName: string;
  /** Movement column: "Nov 18" and the window length in days. */
  moveSince: string;
  moveDays: number;
  /** Region best for this metric, tagged like WCA Live. */
  best: number | undefined;
  tag: RecordTag;
}

const SIZE = 1080;
const PAD = 72;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const C = {
  bg: "#0f0f11",
  panel: "#18181b",
  text: "#f4f4f5",
  text2: "#a1a1aa",
  text3: "#71717a",
  accent: "#60a5fa",
  podium: ["#facc15", "#d4d4d8", "#d97706"],
};
const MOVE = { up: "#22c55e", down: "#f87171", same: "#52525b", new: "#60a5fa" } as const;
const TAG = { wr: ["#dc2626", "#ffffff"], cr: ["#facc15", "#422006"], nr: ["#16a34a", "#ffffff"] } as const;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Shortens `text` with an ellipsis until it fits in `max` pixels. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}

/** Splits `text` into at most `lines` lines of `max` pixels; the last one is shortened if needed. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
  if (lines >= 2 && out.length === 2) {
    // Split two lines near the middle instead of leaving one word on its own.
    const words = text.split(" ");
    let best = out;
    let bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const w = Math.max(...pair.map((l) => ctx.measureText(l).width));
      if (w <= max && w < bestW) [best, bestW] = [pair, w];
    }
    return best;
  }
  if (out.length <= lines) return out;
  return [...out.slice(0, lines - 1), fit(ctx, out.slice(lines - 1).join(" "), max)];
}

export async function renderGraphic(g: GraphicData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  await document.fonts.ready;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const glow = ctx.createRadialGradient(SIZE, 0, 0, SIZE, 0, SIZE * 0.9);
  glow.addColorStop(0, "rgba(96,165,250,0.18)");
  glow.addColorStop(1, "rgba(96,165,250,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Header
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.accent;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(`${g.event} · ${g.region}`.toUpperCase(), PAD, 112);
  ctx.fillStyle = C.text;
  ctx.font = `700 60px ${FONT}`;
  ctx.fillText(fit(ctx, g.metric, SIZE - 2 * PAD), PAD, 184);
  let y = 230;
  if (g.blurb) {
    ctx.fillStyle = C.text;
    ctx.font = `400 28px ${FONT}`;
    for (const line of wrap(ctx, g.blurb, SIZE - 2 * PAD, 2)) {
      ctx.fillText(line, PAD, y);
      y += 38;
    }
  }
  ctx.fillStyle = C.text2;
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText(`Top 10 · results as of ${g.asOf}`, PAD, y);

  // Rows
  const top = y + 52;
  // Label over the movement column.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.text3;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(`${g.moveDays}-DAY CHANGE`, PAD + 60, top - 6);
  // Rows shrink a little when a two-line blurb takes their space.
  const rowH = Math.min(66, (SIZE - 92 - top) / 10);
  const flags = await Promise.all(
    g.rows.map(({ row }) => {
      const url = flagUrl(row.country);
      return url ? loadImage(url) : Promise.resolve(null);
    }),
  );
  g.rows.forEach(({ rank, row }, i) => {
    const y = top + i * rowH;
    const mid = y + rowH / 2;
    if (i % 2 === 0) {
      ctx.fillStyle = C.panel;
      ctx.beginPath();
      ctx.roundRect(PAD - 16, y + 3, SIZE - 2 * PAD + 32, rowH - 6, 12);
      ctx.fill();
    }
    ctx.textBaseline = "middle";

    const shownRank = g.rows[i - 1]?.rank === rank ? "" : String(rank);
    ctx.textAlign = "right";
    ctx.fillStyle = C.podium[rank - 1] ?? C.text2;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(shownRank, PAD + 46, mid);

    // Movement since last week, like the table's ± column.
    const move = movement(row.m[g.metricKey]!, rank, g.moveSince);
    ctx.textAlign = "left";
    ctx.fillStyle = MOVE[move.kind];
    ctx.font = move.kind === "new" ? `700 16px ${FONT}` : `700 22px ${FONT}`;
    ctx.fillText(move.text, PAD + 60, mid + 1);

    const fx = PAD + 128;
    const flag = flags[i];
    if (flag) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(fx, mid - 18, 48, 36, 4);
      ctx.clip();
      ctx.drawImage(flag, fx, mid - 18, 48, 36);
      ctx.restore();
    } else {
      ctx.textAlign = "left";
      ctx.fillStyle = C.text3;
      ctx.font = `600 20px ${FONT}`;
      ctx.fillText(row.country, fx, mid);
    }

    const cell = row.m[g.metricKey]!;
    const vx = SIZE - PAD;
    ctx.textAlign = "right";
    ctx.fillStyle = C.accent;
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(cell.d, vx, mid);
    let left = vx - ctx.measureText(cell.d).width;
    if (cell.s === g.best) {
      ctx.font = `700 20px ${FONT}`;
      const w = ctx.measureText(g.tag.label).width + 16;
      const [bg, fg] = TAG[g.tag.kind];
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(left - 12 - w, mid - 15, w, 30, 6);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.fillText(g.tag.label, left - 12 - w / 2, mid + 1);
      ctx.textAlign = "right";
      left -= 12 + w;
    }
    if (cell.n) {
      ctx.fillStyle = C.text3;
      ctx.font = `400 20px ${FONT}`;
      ctx.fillText(cell.n, left - 14, mid + 2);
      left -= 14 + ctx.measureText(cell.n).width;
    }

    const nx = fx + 66;
    ctx.textAlign = "left";
    ctx.fillStyle = C.text;
    ctx.font = `500 32px ${FONT}`;
    ctx.fillText(fit(ctx, row.name, left - 28 - nx), nx, mid);
  });

  // Footer
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.textAlign = "left";
  const site = (location.host + import.meta.env.BASE_URL).replace(/\/$/, "");
  const credit = "Data: World Cube Association";
  const room = SIZE - 2 * PAD - ctx.measureText(credit).width - 24;
  ctx.fillText(fit(ctx, `Recency Weighted Rankings · ${site}`, room), PAD, SIZE - 44);
  ctx.textAlign = "right";
  ctx.fillText(credit, SIZE - PAD, SIZE - 44);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image"))), "image/png"),
  );
}

const canCopyImage = () => typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

export function GraphicDialog({ data, onClose }: { data: GraphicData; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    let live = true;
    let made: string | null = null;
    renderGraphic(data)
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch((e: Error) => live && setStatus(e.message));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [data]);

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = data.fileName;
    a.click();
  };

  const copy = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Copying isn't allowed here; use Download instead");
    }
  };

  return (
    <dialog
      ref={ref}
      class="graphic-dialog"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      <div class="graphic-body">
        {url ? (
          <img src={url} alt={`Top 10: ${data.metric}, ${data.event}, ${data.region}`} />
        ) : (
          <div class="graphic-loading">Drawing…</div>
        )}
        <div class="graphic-actions">
          <span class="muted">{status}</span>
          <button type="button" class="btn" onClick={() => ref.current?.close()}>
            Close
          </button>
          {canCopyImage() && (
            <button type="button" class="btn" disabled={!blob} onClick={copy}>
              Copy
            </button>
          )}
          <button type="button" class="btn primary" disabled={!url} onClick={download}>
            Download
          </button>
        </div>
      </div>
    </dialog>
  );
}
