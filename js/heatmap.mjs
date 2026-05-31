import { clear, drawNoData, setupCanvas } from "./canvas.mjs";
import { rampColor, withAlpha } from "./palette.mjs";

const GAP = 4, PAD = 14;

export function createHeatmapView(canvas, { onSelectChannel, onHoverChannel }) {
  let layout = null;

  canvas.addEventListener("click",     (e) => { const ch = hit(canvas, layout, e); if (ch !== null) onSelectChannel(ch); });
  canvas.addEventListener("mousemove", (e) => onHoverChannel(hit(canvas, layout, e)));
  canvas.addEventListener("mouseleave",()  => onHoverChannel(null));

  return {
    draw(state) {
      const { ctx, width, height, pal } = setupCanvas(canvas);
      clear(ctx, width, height, pal);

      if (!state.channelCount) {
        layout = null;
        drawNoData(ctx, width, height, pal, "waiting for overview stream");
        return;
      }

      const cols   = Math.ceil(Math.sqrt(state.channelCount));
      const rows   = Math.ceil(state.channelCount / cols);
      const availW = width  - PAD * 2;
      const availH = height - PAD * 2;
      const cell   = Math.max(8, Math.floor(Math.min(
        (availW - GAP * (cols - 1)) / cols,
        (availH - GAP * (rows - 1)) / rows,
      )));
      const pitch = cell + GAP;
      const ox = (width  - (cols * cell + (cols - 1) * GAP)) / 2;
      const oy = (height - (rows * cell + (rows - 1) * GAP)) / 2;
      layout = { cols, pitch, ox, oy, channelCount: state.channelCount };

      const radius = Math.max(1, cell * 0.16);

      for (let ch = 0; ch < state.channelCount; ch += 1) {
        const col = ch % cols, row = Math.floor(ch / cols);
        const x = ox + col * pitch, y = oy + row * pitch;
        const intensity = state.channelActivity[ch] || 0;
        const stim = state.channelHasStim[ch];

        ctx.fillStyle = rampColor(pal.heat, intensity);
        rr(ctx, x, y, cell, cell, radius); ctx.fill();

        ctx.strokeStyle = withAlpha(pal.ink, 0.10); ctx.lineWidth = 1;
        rr(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, radius); ctx.stroke();

        if (stim) {
          ctx.strokeStyle = pal.stim; ctx.lineWidth = 2;
          rr(ctx, x + 1.5, y + 1.5, cell - 3, cell - 3, Math.max(1, radius - 1)); ctx.stroke();
        }
        if (ch === state.selectedChannel) {
          ctx.strokeStyle = pal.accent; ctx.lineWidth = 2;
          rr(ctx, x - 1, y - 1, cell + 2, cell + 2, radius + 1); ctx.stroke();
        } else if (ch === state.hoveredChannel) {
          ctx.strokeStyle = withAlpha(pal.ink, 0.55); ctx.lineWidth = 1.5;
          rr(ctx, x, y, cell, cell, radius); ctx.stroke();
        }
      }
    },
  };
}

function rr(ctx, x, y, w, h, r) {
  const R = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.arcTo(x + w, y,     x + w, y + h, R);
  ctx.arcTo(x + w, y + h, x,     y + h, R);
  ctx.arcTo(x,     y + h, x,     y,     R);
  ctx.arcTo(x,     y,     x + w, y,     R);
  ctx.closePath();
}

function hit(canvas, layout, e) {
  if (!layout) return null;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left - layout.ox;
  const y = e.clientY - rect.top  - layout.oy;
  const col = Math.floor(x / layout.pitch);
  const row = Math.floor(y / layout.pitch);
  const ch  = row * layout.cols + col;
  if (col >= 0 && col < layout.cols && row >= 0 && ch < layout.channelCount) return ch;
  return null;
}
