import { clear, drawNoData, drawPanelGrid, setupCanvas } from "./canvas.mjs";
import { rollingWindowEnd } from "./state.mjs";

const LEFT_GUTTER = 42;
const BOTTOM_GUTTER = 22;
const TOP_PAD = 10;
const RIGHT_PAD = 12;

export function createRasterView(canvas, { onSelectChannel, onHoverChannel }) {
  let lastBounds = null;

  canvas.addEventListener("click", (event) => {
    const channel = channelFromEvent(canvas, lastBounds, event);
    if (channel !== null) {
      onSelectChannel(channel);
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    onHoverChannel(channelFromEvent(canvas, lastBounds, event));
  });

  canvas.addEventListener("mouseleave", () => {
    onHoverChannel(null);
  });

  return {
    draw(state) {
      const { ctx, width, height } = setupCanvas(canvas);
      clear(ctx, width, height);
      drawPanelGrid(ctx, width, height - BOTTOM_GUTTER, 6, 4);

      if (!state.channelCount) {
        lastBounds = null;
        drawNoData(ctx, width, height, "waiting for channel metadata");
        return;
      }

      const plotWidth = width - LEFT_GUTTER - RIGHT_PAD;
      const plotHeight = height - TOP_PAD - BOTTOM_GUTTER;
      const end = rollingWindowEnd(state);
      const start = end - state.windowSeconds;
      lastBounds = { height, channelCount: state.channelCount };

      drawAxes(ctx, width, height, state, start, end);
      drawEvents(ctx, state.stims, state, start, plotWidth, plotHeight, "#e5c46b", 6);
      drawEvents(ctx, state.spikes, state, start, plotWidth, plotHeight, "#6ee7b7", 3);

      if (!state.spikes.length && !state.stims.length) {
        const liveAge = state.health.liveLastAt === null ? null : Date.now() - state.health.liveLastAt;
        const text = state.connection.live === "live"
          ? liveAge !== null && liveAge > 5000
            ? "live_streaming connected, no recent messages"
            : "connected, no spikes yet"
          : "waiting for live_streaming";
        drawNoData(ctx, width, height, text);
      }
    },
  };
}

function channelFromEvent(canvas, bounds, event) {
  if (!bounds) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const plotHeight = bounds.height - TOP_PAD - BOTTOM_GUTTER;
  const channel = Math.floor(((y - TOP_PAD) / plotHeight) * bounds.channelCount);

  if (channel >= 0 && channel < bounds.channelCount) {
    return channel;
  }

  return null;
}

function drawEvents(ctx, events, state, start, plotWidth, plotHeight, color, size) {
  ctx.fillStyle = color;
  for (const event of events) {
    if (event.seconds < start || event.channel >= state.channelCount) {
      continue;
    }

    const x = LEFT_GUTTER + ((event.seconds - start) / state.windowSeconds) * plotWidth;
    const y = TOP_PAD + ((event.channel + 0.5) / state.channelCount) * plotHeight;
    ctx.fillRect(Math.round(x), Math.round(y - size / 2), size, size);
  }
}

function drawAxes(ctx, width, height, state, start, end) {
  const plotBottom = height - BOTTOM_GUTTER;
  ctx.strokeStyle = "rgba(197, 215, 209, 0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LEFT_GUTTER, TOP_PAD);
  ctx.lineTo(LEFT_GUTTER, plotBottom);
  ctx.lineTo(width - RIGHT_PAD, plotBottom);
  ctx.stroke();

  ctx.fillStyle = "rgba(220, 233, 229, 0.72)";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("ch 0", LEFT_GUTTER - 8, TOP_PAD + 8);
  ctx.fillText(`ch ${Math.max(0, state.channelCount - 1)}`, LEFT_GUTTER - 8, plotBottom - 8);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`${start.toFixed(1)}s`, LEFT_GUTTER, plotBottom + 6);
  ctx.fillText(`${end.toFixed(1)}s`, width - RIGHT_PAD, plotBottom + 6);

  if (state.selectedChannel !== null) {
    const y = TOP_PAD + ((state.selectedChannel + 0.5) / state.channelCount) * (height - TOP_PAD - BOTTOM_GUTTER);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.beginPath();
    ctx.moveTo(LEFT_GUTTER, y);
    ctx.lineTo(width - RIGHT_PAD, y);
    ctx.stroke();
  }

  if (state.hoveredChannel !== null && state.hoveredChannel !== state.selectedChannel) {
    const y = TOP_PAD + ((state.hoveredChannel + 0.5) / state.channelCount) * (height - TOP_PAD - BOTTOM_GUTTER);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.beginPath();
    ctx.moveTo(LEFT_GUTTER, y);
    ctx.lineTo(width - RIGHT_PAD, y);
    ctx.stroke();
  }
}
