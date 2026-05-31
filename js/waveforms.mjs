import { clear, drawGrid, drawNoData, setupCanvas } from "./canvas.mjs";
import { withAlpha } from "./palette.mjs";
import { SAMPLES_PER_SPIKE } from "./protocol.mjs";

const PAD_X = 34, PAD_Y = 20;

export function createWaveformView(canvas) {
  return {
    draw(state) {
      const { ctx, width, height, pal } = setupCanvas(canvas);
      clear(ctx, width, height, pal);
      drawGrid(ctx, PAD_X, PAD_Y, width - PAD_X * 2, height - PAD_Y * 2, pal, 6, 4);

      if (state.selectedChannel === null) {
        drawNoData(ctx, width, height, pal, "select a channel to inspect waveforms"); return;
      }

      const waveforms = state.waveformsByChannel.get(state.selectedChannel) || [];
      if (!waveforms.length) {
        drawNoData(ctx, width, height, pal, `waiting for ch ${state.selectedChannel} waveforms`); return;
      }

      const all    = waveforms.flatMap((w) => Array.from(w.samples));
      const maxAbs = Math.max(20, ...all.map((v) => Math.abs(v)));
      const plotW  = width  - PAD_X * 2;
      const plotH  = height - PAD_Y * 2;
      const cy     = PAD_Y + plotH / 2;

      ctx.strokeStyle = withAlpha(pal.ink, 0.25);
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PAD_X, cy); ctx.lineTo(width - PAD_X, cy); ctx.stroke();
      ctx.setLineDash([]);

      waveforms.forEach((wf, i) => {
        const isLatest = i === waveforms.length - 1;
        const alpha = isLatest ? 1 : 0.10 + ((i + 1) / waveforms.length) * 0.42;
        ctx.strokeStyle = isLatest ? pal.accent : withAlpha(pal.ink, alpha);
        ctx.lineWidth   = isLatest ? 2 : 1;
        ctx.lineJoin    = "round";
        ctx.beginPath();
        for (let s = 0; s < SAMPLES_PER_SPIKE; s += 1) {
          const x = PAD_X + (s / (SAMPLES_PER_SPIKE - 1)) * plotW;
          const y = cy - (wf.samples[s] / maxAbs) * (plotH / 2 - 4);
          s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      ctx.fillStyle = withAlpha(pal.muted, 0.95);
      ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
      ctx.textAlign = "left";  ctx.textBaseline = "top";
      ctx.fillText(`+${maxAbs.toFixed(0)} µV`, PAD_X + 2, 8);
      ctx.textBaseline = "bottom";
      ctx.fillText(`−${maxAbs.toFixed(0)} µV`, PAD_X + 2, height - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${SAMPLES_PER_SPIKE} samples`, width - PAD_X, height - 8);
    },
  };
}
