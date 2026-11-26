// "Generate graphic": draws the top 10 of the current table onto a fixed
// 1080x1080 template and shows it in a preview with Download / Copy.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Row } from "./data";
import { flagUrl } from "./flags";

export interface GraphicData {
  event: string;
  region: string;
  metric: string;
  metricKey: string;
  asOf: string;
  rows: { rank: number; row: Row }[];
  fileName: string;
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
  ctx.fillStyle = C.text2;
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(`Top 10 · results as of ${g.asOf}`, PAD, 230);

  // Rows
  const top = 282;
  const rowH = 66;
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

    const fx = PAD + 66;
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
  ctx.font = `400 22px ${FONT}`;
  ctx.fillStyle = C.text3;
  ctx.textAlign = "left";
  const site = (location.host + import.meta.env.BASE_URL).replace(/\/$/, "");
  ctx.fillText(`Recency Weighted Rankings · ${site}`, PAD, SIZE - 44);
  ctx.textAlign = "right";
  ctx.fillText("Data: World Cube Association", SIZE - PAD, SIZE - 44);

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
