import { clear, drawNoData, drawPanelGrid, setupCanvas } from "./canvas.mjs";
import { SAMPLES_PER_SPIKE } from "./protocol.mjs";

const PAD_X = 28;
const PAD_Y = 18;

export function createWaveformView(canvas) {
  return {
    draw(state) {
      const { ctx, width, height } = setupCanvas(canvas);
      clear(ctx, width, height);
      drawPanelGrid(ctx, width, height, 5, 4);

      if (state.selectedChannel === null) {
        drawNoData(ctx, width, height, "click a channel");
        return;
      }

      const waveforms = state.waveformsByChannel.get(state.selectedChannel) || [];
      if (!waveforms.length) {
        drawNoData(ctx, width, height, `waiting for channel ${state.selectedChannel} waveforms`);
        return;
      }

      const samples = waveforms.flatMap((waveform) => Array.from(waveform.samples));
      const maxAbs = Math.max(20, ...samples.map((value) => Math.abs(value)));
      const plotWidth = width - PAD_X * 2;
      const plotHeight = height - PAD_Y * 2;
      const centerY = PAD_Y + plotHeight / 2;

      ctx.strokeStyle = "rgba(229, 196, 107, 0.4)";
      ctx.beginPath();
      ctx.moveTo(PAD_X, centerY);
      ctx.lineTo(width - PAD_X, centerY);
      ctx.stroke();

      waveforms.forEach((waveform, index) => {
        const alpha = 0.14 + ((index + 1) / waveforms.length) * 0.72;
        ctx.strokeStyle = `rgba(110, 231, 183, ${alpha.toFixed(3)})`;
        ctx.lineWidth = index === waveforms.length - 1 ? 2 : 1;
        ctx.beginPath();

        for (let i = 0; i < SAMPLES_PER_SPIKE; i += 1) {
          const x = PAD_X + (i / (SAMPLES_PER_SPIKE - 1)) * plotWidth;
          const y = centerY - (waveform.samples[i] / maxAbs) * (plotHeight / 2);
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      });

      drawScale(ctx, width, height, maxAbs);
    },
  };
}

function drawScale(ctx, width, height, maxAbs) {
  ctx.fillStyle = "rgba(220, 233, 229, 0.68)";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`+${maxAbs.toFixed(0)} µV`, 8, 8);
  ctx.textBaseline = "bottom";
  ctx.fillText(`-${maxAbs.toFixed(0)} µV`, 8, height - 8);
  ctx.textAlign = "right";
  ctx.fillText("75 samples", width - 8, height - 8);
}
