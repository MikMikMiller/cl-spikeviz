import { clear, drawNoData, setupCanvas } from "./canvas.mjs";

const GAP = 3;

export function createHeatmapView(canvas, { onSelectChannel, onHoverChannel }) {
  let layout = null;

  canvas.addEventListener("click", (event) => {
    const channel = channelFromEvent(canvas, layout, event);
    if (channel !== null) {
      onSelectChannel(channel);
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    onHoverChannel(channelFromEvent(canvas, layout, event));
  });

  canvas.addEventListener("mouseleave", () => {
    onHoverChannel(null);
  });

  return {
    draw(state) {
      const { ctx, width, height } = setupCanvas(canvas);
      clear(ctx, width, height);

      if (!state.channelCount) {
        layout = null;
        drawNoData(ctx, width, height, "waiting for overview stream");
        return;
      }

      const cols = Math.ceil(Math.sqrt(state.channelCount));
      const rows = Math.ceil(state.channelCount / cols);
      const cell = Math.max(8, Math.floor(Math.min((width - GAP * (cols - 1)) / cols, (height - GAP * (rows - 1)) / rows)));
      const pitch = cell + GAP;
      const gridWidth = cols * cell + (cols - 1) * GAP;
      const gridHeight = rows * cell + (rows - 1) * GAP;
      const offsetX = Math.max(0, (width - gridWidth) / 2);
      const offsetY = Math.max(0, (height - gridHeight) / 2);
      layout = { cols, pitch, offsetX, offsetY, channelCount: state.channelCount };

      for (let channel = 0; channel < state.channelCount; channel += 1) {
        const col = channel % cols;
        const row = Math.floor(channel / cols);
        const x = offsetX + col * pitch;
        const y = offsetY + row * pitch;
        const intensity = state.channelActivity[channel] || 0;

        ctx.fillStyle = heatColor(intensity, state.channelHasStim[channel]);
        ctx.fillRect(x, y, cell, cell);

        if (channel === state.selectedChannel) {
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
        }

        if (channel === state.hoveredChannel && channel !== state.selectedChannel) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        }
      }
    },
  };
}

function channelFromEvent(canvas, layout, event) {
  if (!layout) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left - layout.offsetX;
  const y = event.clientY - rect.top - layout.offsetY;
  const col = Math.floor(x / layout.pitch);
  const row = Math.floor(y / layout.pitch);
  const channel = row * layout.cols + col;

  if (col >= 0 && col < layout.cols && row >= 0 && channel < layout.channelCount) {
    return channel;
  }

  return null;
}

function heatColor(value, hasStim) {
  if (hasStim) {
    return "#e5c46b";
  }

  const t = Math.max(0, Math.min(1, value));
  const r = Math.round(18 + t * 70);
  const g = Math.round(40 + t * 210);
  const b = Math.round(44 + t * 160);
  return `rgb(${r}, ${g}, ${b})`;
}
