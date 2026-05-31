import { palette, withAlpha } from "./palette.mjs";

export function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width  = Math.max(1, Math.floor(rect.width  * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width  = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height, pal: palette() };
}

export function clear(ctx, width, height, pal) {
  ctx.fillStyle = pal.inset;
  ctx.fillRect(0, 0, width, height);
}

export function drawNoData(ctx, width, height, pal, text) {
  ctx.fillStyle = withAlpha(pal.muted, 0.85);
  ctx.font = "12px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}

export function drawGrid(ctx, x0, y0, w, h, pal, cols = 8, rows = 4) {
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < cols; i += 1) {
    const x = Math.round(x0 + (w * i) / cols) + 0.5;
    ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h);
  }
  for (let j = 1; j < rows; j += 1) {
    const y = Math.round(y0 + (h * j) / rows) + 0.5;
    ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y);
  }
  ctx.stroke();
}
