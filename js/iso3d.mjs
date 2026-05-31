// Dependency-free isometric MEA array; no external 3D runtime required.
// 8×8 electrodes rise with activity and glow with the brand accent.
// Spikes/stims emit expanding elliptical ground rings.
import { setupCanvas } from "./canvas.mjs";
import { withAlpha } from "./palette.mjs";

const GRID = 8;
const CHANNELS = GRID * GRID;
const PULSE_LIFE = 0.85;

function project(layout, col, row, z = 0) {
  return {
    x: layout.ox + (col - row) * (layout.tw / 2),
    y: layout.oy + (col + row) * (layout.th / 2) - z,
  };
}

export function createIsoView(canvas, { onSelectChannel, onHoverChannel }) {
  let layout = null;
  const padScale = new Array(CHANNELS).fill(0);
  let pulses = [];
  let lastSpikeTotal = 0, lastStimTotal = 0;
  let lastMs = performance.now();

  canvas.addEventListener("mousemove", (e) => onHoverChannel(hit(e)));
  canvas.addEventListener("mouseleave",()  => onHoverChannel(null));
  canvas.addEventListener("click",     (e) => { const ch = hit(e); if (ch !== null) onSelectChannel(ch); });

  function hit(e) {
    if (!layout) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bestD = 30;
    for (let ch = 0; ch < CHANNELS; ch += 1) {
      const col = ch % GRID, row = Math.floor(ch / GRID);
      const p = project(layout, col + 0.5, row + 0.5, layout.baseZ + padScale[ch] * layout.maxZ);
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) { bestD = d; best = ch; }
    }
    return best;
  }

  return {
    draw(state) {
      const { ctx, width, height, pal } = setupCanvas(canvas);
      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - lastMs) / 1000);
      lastMs = nowMs;

      ctx.fillStyle = pal.inset;
      ctx.fillRect(0, 0, width, height);

      const tw = Math.min(width * 0.74 / GRID, 86);
      const th = tw * 0.52;
      const baseZ = 6, maxZ = tw * 1.5;
      layout = {
        ox: width / 2,
        oy: height / 2 - (GRID * th) / 2 + th * 1.2,
        tw, th, baseZ, maxZ,
      };

      drawGroundPlate(ctx, layout, pal);

      if (!state.paused) collectEvents(state);
      drawPulses(ctx, layout, dt, state.paused, pal);

      const order = Array.from({ length: CHANNELS }, (_, i) => i)
        .sort((a, b) => (Math.floor(a / GRID) + (a % GRID)) - (Math.floor(b / GRID) + (b % GRID)));

      for (const ch of order) {
        const col = ch % GRID, row = Math.floor(ch / GRID);
        const enabled = ch < state.channelCount;
        const target  = enabled ? clamp01(state.channelActivity[ch] || 0) : 0;
        padScale[ch] += (target - padScale[ch]) * 0.22;
        const a = padScale[ch];
        drawPad(ctx, layout, col, row, baseZ + a * maxZ, a, {
          stim: enabled && state.channelHasStim[ch],
          selected: ch === state.selectedChannel,
          hovered:  ch === state.hoveredChannel,
          enabled, pal,
        });
      }
    },
  };

  function collectEvents(state) {
    if (state.totals.spikes < lastSpikeTotal || state.totals.stims < lastStimTotal) {
      lastSpikeTotal = state.totals.spikes;
      lastStimTotal  = state.totals.stims;
      pulses = []; return;
    }
    if (state.totals.spikes > lastSpikeTotal) {
      const n = state.totals.spikes - lastSpikeTotal;
      for (const s of state.spikes.slice(-n))
        if (s.channel < CHANNELS) pulses.push({ ch: s.channel, age: 0, stim: false });
      lastSpikeTotal = state.totals.spikes;
    }
    if (state.totals.stims > lastStimTotal) {
      const n = state.totals.stims - lastStimTotal;
      for (const s of state.stims.slice(-n))
        if (s.channel < CHANNELS) pulses.push({ ch: s.channel, age: 0, stim: true });
      lastStimTotal = state.totals.stims;
    }
    if (pulses.length > 120) pulses = pulses.slice(-120);
  }

  function drawPulses(ctx, layout, dt, paused, pal) {
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      const pu = pulses[i];
      if (!paused) pu.age += dt;
      const k = pu.age / PULSE_LIFE;
      if (k >= 1) { pulses.splice(i, 1); continue; }
      const col = pu.ch % GRID, row = Math.floor(pu.ch / GRID);
      const p = project(layout, col, row, layout.baseZ);
      ctx.save();
      ctx.globalAlpha = (1 - k) * (pu.stim ? 0.7 : 0.55);
      ctx.strokeStyle = pu.stim ? pal.stim : pal.accent;
      ctx.lineWidth   = pu.stim ? 2 : 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, (layout.tw / 2) * (0.4 + k * 1.5), (layout.th / 2) * (0.4 + k * 1.5), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawGroundPlate(ctx, layout, pal) {
  ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= GRID; i += 1) {
    const a = project(layout, i, 0, 0), b = project(layout, i, GRID, 0);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    const c = project(layout, 0, i, 0), d = project(layout, GRID, i, 0);
    ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();
  const corners = [
    project(layout, 0, 0, 0), project(layout, GRID, 0, 0),
    project(layout, GRID, GRID, 0), project(layout, 0, GRID, 0),
  ];
  ctx.strokeStyle = withAlpha(pal.ink, 0.28); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y);
  for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y);
  ctx.closePath(); ctx.stroke();
}

function foot(layout, col, row, z) {
  const cx = col + 0.5, cy = row + 0.5, s = 0.34;
  return {
    n: project(layout, cx,     cy - s, z),
    e: project(layout, cx + s, cy,     z),
    s: project(layout, cx,     cy + s, z),
    w: project(layout, cx - s, cy,     z),
  };
}

function drawPad(ctx, layout, col, row, z, a, { stim, selected, hovered, enabled, pal }) {
  const top = foot(layout, col, row, z);
  const bot = foot(layout, col, row, layout.baseZ);

  if (enabled && a > 0.05) {
    const g = project(layout, col + 0.5, row + 0.5, layout.baseZ);
    const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, layout.tw * 0.7);
    gr.addColorStop(0, withAlpha(stim ? pal.stim : pal.accent, 0.28 * a));
    gr.addColorStop(1, withAlpha(stim ? pal.stim : pal.accent, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, layout.tw * 0.7, layout.th * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const ac     = stim ? pal.stim : pal.accent;
  const topCol = enabled ? mix(pal.inset, ac, 0.12 + a * 0.72) : withAlpha(pal.ink, 0.06);

  quad(ctx, top.w, top.s, bot.s, bot.w); // left face
  ctx.fillStyle = shade(topCol, -0.22); ctx.fill();
  quad(ctx, top.s, top.e, bot.e, bot.s); // right face
  ctx.fillStyle = shade(topCol, -0.40); ctx.fill();

  ctx.fillStyle = topCol;
  ctx.beginPath();
  ctx.moveTo(top.n.x, top.n.y); ctx.lineTo(top.e.x, top.e.y);
  ctx.lineTo(top.s.x, top.s.y); ctx.lineTo(top.w.x, top.w.y);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = (enabled && a > 0.3) ? withAlpha("#ffffff", 0.22) : withAlpha(pal.ink, 0.18);
  ctx.lineWidth = 1; ctx.stroke();

  if (selected) {
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.stroke();
    const p = project(layout, col + 0.5, row + 0.5, layout.baseZ);
    ctx.save(); ctx.globalAlpha = 0.9; ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, layout.tw * 0.42, layout.th * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke(); ctx.restore();
  } else if (hovered) {
    ctx.strokeStyle = withAlpha(pal.ink, 0.6); ctx.lineWidth = 1.5; ctx.stroke();
  }
}

function quad(ctx, a, b, c, d) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
}
function parse(c) {
  if (c.startsWith("#")) {
    const h = c.slice(1), v = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(",").map(Number); return [p[0], p[1], p[2]]; }
  return [128, 128, 128];
}
function mix(c1, c2, t) {
  const a = parse(c1), b = parse(c2);
  return `rgb(${Math.round(a[0]+(b[0]-a[0])*t)},${Math.round(a[1]+(b[1]-a[1])*t)},${Math.round(a[2]+(b[2]-a[2])*t)})`;
}
function shade(c, amt) {
  const a = parse(c), f = amt < 0 ? 0 : 255, t = Math.abs(amt);
  return `rgb(${Math.round(a[0]+(f-a[0])*t)},${Math.round(a[1]+(f-a[1])*t)},${Math.round(a[2]+(f-a[2])*t)})`;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
