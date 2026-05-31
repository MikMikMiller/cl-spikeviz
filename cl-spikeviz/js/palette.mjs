// Reads the live theme palette from CSS variables so canvas drawing
// always matches the active theme (paper / dark).
// Reads from document.body — that's where body.dark overrides live.

function cssVar(name) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette() {
  return {
    ink:   cssVar("--ink"),
    ink2:  cssVar("--ink-2"),
    muted: cssVar("--muted"),
    faint: cssVar("--faint"),
    accent: cssVar("--accent"),
    stim:   cssVar("--stim"),
    grid:   cssVar("--line-canvas"),
    inset:  cssVar("--inset"),
    heat: [
      cssVar("--heat-0"),
      cssVar("--heat-1"),
      cssVar("--heat-2"),
      cssVar("--heat-3"),
      cssVar("--heat-4"),
    ],
  };
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rampColor(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= stops.length - 1) {
    const [r, g, b] = hexToRgb(stops[stops.length - 1]);
    return `rgb(${r},${g},${b})`;
  }
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

export function withAlpha(hex, alpha) {
  if (hex.startsWith("rgb")) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
