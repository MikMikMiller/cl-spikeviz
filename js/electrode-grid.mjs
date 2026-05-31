import { clear, drawNoData, setupCanvas } from "./canvas.mjs";
import { getChannelWindowMetrics } from "./state.mjs";
import { withAlpha } from "./palette.mjs";

const GAP = 6;
const PAD = 22;
const FOOTER = 42;

export function createElectrodeGridView(canvas, { onSelectChannel, onHoverChannel }) {
  let layout = null;

  canvas.addEventListener("click", (event) => {
    const channel = hit(canvas, layout, event);
    if (channel !== null) {
      onSelectChannel(channel);
    }
  });
  canvas.addEventListener("pointermove", (event) => onHoverChannel(hit(canvas, layout, event)));
  canvas.addEventListener("pointerleave", () => onHoverChannel(null));

  return {
    draw(state) {
      const { ctx, width, height, pal } = setupCanvas(canvas);
      clear(ctx, width, height, pal);

      if (!state.channelCount) {
        layout = null;
        drawNoData(ctx, width, height, pal, "waiting for channel metadata");
        return;
      }

      const metrics = getChannelWindowMetrics(state);
      const grid = logicalGrid(state.channelCount);
      const availW = width - PAD * 2;
      const availH = height - PAD * 2 - FOOTER;
      const cell = Math.max(8, Math.floor(Math.min(
        (availW - GAP * (grid.cols - 1)) / grid.cols,
        (availH - GAP * (grid.rows - 1)) / grid.rows,
      )));
      const pitch = cell + GAP;
      const gridW = grid.cols * cell + (grid.cols - 1) * GAP;
      const gridH = grid.rows * cell + (grid.rows - 1) * GAP;
      const ox = (width - gridW) / 2;
      const oy = Math.max(PAD, (height - FOOTER - gridH) / 2);
      const radius = Math.max(2, Math.min(6, cell * 0.16));
      layout = { ...grid, cell, pitch, ox, oy, channelCount: state.channelCount };

      drawPlate(ctx, ox, oy, gridW, gridH, radius + 3, pal);

      const rateScale = Math.max(1, metrics.maxSpikeRate);
      for (let channel = 0; channel < state.channelCount; channel += 1) {
        const col = channel % grid.cols;
        const row = Math.floor(channel / grid.cols);
        const x = ox + col * pitch;
        const y = oy + row * pitch;
        const rate = metrics.spikeRates[channel] || 0;
        const intensity = Math.max(0, Math.min(1, rate / rateScale));
        const lastEvent = state.channelHasStim[channel]
          ? { type: "stim", seconds: metrics.end }
          : metrics.lastEvents[channel];
        drawCell(ctx, x, y, cell, radius, channel, {
          activity: intensity,
          eventType: lastEvent?.type || null,
          selected: channel === state.selectedChannel,
          hovered: channel === state.hoveredChannel,
          pal,
        });
      }

    },
  };
}

function logicalGrid(channelCount) {
  const cols = Math.ceil(Math.sqrt(channelCount));
  const rows = Math.ceil(channelCount / cols);
  return {
    cols,
    rows,
    isExactSquare: cols === rows && cols * rows === channelCount,
  };
}

function drawPlate(ctx, x, y, w, h, radius, pal) {
  ctx.fillStyle = withAlpha(pal.ink, 0.025);
  rr(ctx, x - 8, y - 8, w + 16, h + 16, radius);
  ctx.fill();
  ctx.strokeStyle = withAlpha(pal.ink, 0.08);
  ctx.lineWidth = 1;
  rr(ctx, x - 8.5, y - 8.5, w + 17, h + 17, radius);
  ctx.stroke();
}

function drawCell(ctx, x, y, cell, radius, channel, { activity, eventType, selected, hovered, pal }) {
  ctx.fillStyle = withAlpha(pal.muted, 0.13);
  rr(ctx, x, y, cell, cell, radius);
  ctx.fill();

  ctx.strokeStyle = withAlpha(pal.ink, 0.12);
  ctx.lineWidth = 1;
  rr(ctx, x + 0.5, y + 0.5, cell - 1, cell - 1, radius);
  ctx.stroke();

  const active = activity > 0 || eventType;
  const fill = eventType === "stim"
    ? pal.stim
    : eventType === "spike" || activity > 0
      ? pal.accent
      : withAlpha(pal.ink, 0.18);
  const size = Math.max(4, cell * (active ? 0.18 + activity * 0.68 : 0.12));
  const cx = x + cell / 2;
  const cy = y + cell / 2;

  ctx.fillStyle = active ? withAlpha(fill, 0.30 + activity * 0.62) : fill;
  if (eventType === "stim") {
    drawDiamond(ctx, cx, cy, size);
  } else {
    rr(ctx, cx - size / 2, cy - size / 2, size, size, Math.max(1, radius * 0.65));
  }
  ctx.fill();

  if (cell >= 31) {
    ctx.fillStyle = active ? withAlpha(pal.ink, 0.78) : withAlpha(pal.muted, 0.75);
    ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(channel), cx, cy);
  }

  if (selected) {
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    rr(ctx, x - 2, y - 2, cell + 4, cell + 4, radius + 2);
    ctx.stroke();
  } else if (hovered) {
    ctx.strokeStyle = withAlpha(pal.ink, 0.58);
    ctx.lineWidth = 1.5;
    rr(ctx, x - 1, y - 1, cell + 2, cell + 2, radius + 1);
    ctx.stroke();
  }
}

function drawDiamond(ctx, cx, cy, size) {
  const r = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function rr(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hit(canvas, layout, event) {
  if (!layout) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left - layout.ox;
  const y = event.clientY - rect.top - layout.oy;
  const col = Math.floor(x / layout.pitch);
  const row = Math.floor(y / layout.pitch);
  const localX = x - col * layout.pitch;
  const localY = y - row * layout.pitch;
  const channel = row * layout.cols + col;

  if (
    col >= 0
    && col < layout.cols
    && row >= 0
    && row < layout.rows
    && localX >= 0
    && localX <= layout.cell
    && localY >= 0
    && localY <= layout.cell
    && channel < layout.channelCount
  ) {
    return channel;
  }

  return null;
}
