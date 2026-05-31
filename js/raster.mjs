import { clear, drawGrid, drawNoData, setupCanvas } from "./canvas.mjs";
import { withAlpha } from "./palette.mjs";
import { rollingWindowEnd } from "./state.mjs";

const LEFT = 46, BOTTOM = 24, TOP = 12, RIGHT = 14;

export function createRasterView(canvas, { onSelectChannel, onHoverChannel }) {
  let bounds = null;

  canvas.addEventListener("click",     (e) => { const ch = hit(canvas, bounds, e); if (ch !== null) onSelectChannel(ch); });
  canvas.addEventListener("mousemove", (e) => onHoverChannel(hit(canvas, bounds, e)));
  canvas.addEventListener("mouseleave",()  => onHoverChannel(null));

  return {
    draw(state) {
      const { ctx, width, height, pal } = setupCanvas(canvas);
      clear(ctx, width, height, pal);
      const plotW = width - LEFT - RIGHT;
      const plotH = height - TOP - BOTTOM;
      drawGrid(ctx, LEFT, TOP, plotW, plotH, pal, 8, 4);

      if (!state.channelCount) {
        bounds = null;
        drawNoData(ctx, width, height, pal, "waiting for channel metadata");
        return;
      }

      const end   = rollingWindowEnd(state);
      const start = end - state.windowSeconds;
      bounds = { height, channelCount: state.channelCount };
      const rowH = plotH / state.channelCount;

      if (state.selectedChannel !== null) {
        ctx.fillStyle = withAlpha(pal.accent, 0.10);
        ctx.fillRect(LEFT, TOP + state.selectedChannel * rowH, plotW, rowH);
      }
      if (state.hoveredChannel !== null && state.hoveredChannel !== state.selectedChannel) {
        ctx.fillStyle = withAlpha(pal.ink, 0.06);
        ctx.fillRect(LEFT, TOP + state.hoveredChannel * rowH, plotW, rowH);
      }

      ctx.strokeStyle = withAlpha(pal.ink, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LEFT + 0.5, TOP); ctx.lineTo(LEFT + 0.5, TOP + plotH);
      ctx.lineTo(width - RIGHT, TOP + plotH);
      ctx.stroke();

      drawEvents(ctx, state.stims,  state, start, plotW, plotH, rowH, pal.stim,   true);
      drawEvents(ctx, state.spikes, state, start, plotW, plotH, rowH, pal.accent, false);

      ctx.fillStyle = withAlpha(pal.muted, 0.95);
      ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("ch 0",                    LEFT - 8, TOP + 6);
      ctx.fillText(`ch ${state.channelCount - 1}`, LEFT - 8, TOP + plotH - 6);
      ctx.textAlign = "left";  ctx.textBaseline = "top";
      ctx.fillText(`${start.toFixed(1)}s`, LEFT + 2, TOP + plotH + 7);
      ctx.textAlign = "right";
      ctx.fillText(`${end.toFixed(1)}s`, width - RIGHT, TOP + plotH + 7);
      ctx.textAlign = "center";
      ctx.fillText("time", LEFT + plotW / 2, TOP + plotH + 7);

      if (!state.spikes.length && !state.stims.length) {
        const age = state.health.liveLastAt === null ? null : Date.now() - state.health.liveLastAt;
        const msg = state.connection.live === "live"
          ? (age !== null && age > 5000 ? "connected · no recent messages" : "connected · no spikes yet")
          : "waiting for live_streaming";
        drawNoData(ctx, width, height, pal, msg);
      }
    },
  };
}

function drawEvents(ctx, events, state, start, plotW, plotH, rowH, color, isStim) {
  ctx.fillStyle = color;
  const tickH = Math.max(3, Math.min(rowH * (isStim ? 0.95 : 0.7), isStim ? 12 : 8));
  const w = isStim ? 2 : 1.6;
  for (const ev of events) {
    if (ev.seconds < start || ev.channel >= state.channelCount) continue;
    const x  = LEFT + ((ev.seconds - start) / state.windowSeconds) * plotW;
    const cy = TOP  + (ev.channel + 0.5) * rowH;
    ctx.fillRect(x - w / 2, cy - tickH / 2, w, tickH);
  }
}

function hit(canvas, bounds, e) {
  if (!bounds) return null;
  const rect = canvas.getBoundingClientRect();
  const y    = e.clientY - rect.top;
  const plotH = bounds.height - TOP - BOTTOM;
  const ch   = Math.floor(((y - TOP) / plotH) * bounds.channelCount);
  return ch >= 0 && ch < bounds.channelCount ? ch : null;
}
