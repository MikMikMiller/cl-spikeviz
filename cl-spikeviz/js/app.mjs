import { DemoStream } from "./demo.mjs";
import { createRasterView }   from "./raster.mjs";
import { createHeatmapView }  from "./heatmap.mjs";
import { createWaveformView } from "./waveforms.mjs";
import { createIsoView }      from "./iso3d.mjs";
import { SpikeVizConnection } from "./ws.mjs";
import {
  addOverviewChunks, addSpikes, addStims, createState, getChannelStats,
  recordHealth, resetStreamState, setChannelCount,
} from "./state.mjs";

const params = new URLSearchParams(location.search);
const config = {
  host:           params.get("host")  || "127.0.0.1",
  port:           params.get("port")  || "1025",
  demo:           params.get("demo")  === "1",
  compact:        params.get("compact") === "1",
  theme:          params.get("theme") === "dark" ? "dark" : "paper",
  view:           ["3d", "split"].includes(params.get("view")) ? params.get("view") : "2d",
  initialChannel: params.has("channel") ? Number(params.get("channel")) : null,
};

const state = createState({ windowSeconds: clamp(params.get("window"), 1, 10, 5) });
document.body.classList.toggle("dark", config.theme === "dark");
applyViewClass();

const $ = (id) => document.getElementById(id);
const el = {
  host: $("host-input"), port: $("port-input"), connect: $("connect-btn"),
  window: $("window-input"), windowOut: $("window-output"),
  pause: $("pause-btn"), reset: $("reset-btn"), auto: $("auto-btn"),
  channel: $("channel-input"), theme: $("theme-input"), presets: $("presets"),
  statusDot: $("status-dot"), statusText: $("status-text"),
  stats: $("stats-text"), rate: $("rate-text"), clock: $("clock-text"),
  fps: $("fps-text"), chCount: $("ch-count"),
  rasterSub: $("raster-sub"), heatSub: $("heat-sub"), waveSub: $("wave-sub"),
  waveCh: $("wave-ch"), heatBanner: $("heat-banner"), isoSub: $("iso-sub"),
  mCh: $("m-channel"), mAct: $("m-activity"), mSpk: $("m-spikes"), mLast: $("m-last"),
  epOverview: $("ep-overview"), epLive: $("ep-live"),
  mOvRate: $("m-ov-rate"), mLvRate: $("m-lv-rate"), mRecon: $("m-recon"), mMode: $("m-mode"),
  diagHint: $("diag-hint"),
  debug: $("debug-btn"), embed: $("embed-btn"), csv: $("csv-btn"), bundle: $("bundle-btn"),
  toast: $("toast"), viewtabs: document.querySelector(".viewtabs"),
};

el.host.value     = config.host;
el.port.value     = config.port;
el.window.value   = String(state.windowSeconds);
el.windowOut.textContent = `${state.windowSeconds.toFixed(1)} s`;
el.theme.value    = config.theme;
el.mMode.textContent = config.demo ? "demo" : "live";

const startedAt = Date.now();

const selectChannel = (ch, { manual = true } = {}) => {
  state.selectedChannel = ch;
  if (manual) { state.autoSelectActive = false; updateAutoButton(); setQuery(); }
  updateLabels();
};
const hoverChannel = (ch) => { state.hoveredChannel = ch; updateLabels(); };

const raster   = createRasterView(  $("raster-canvas"),   { onSelectChannel: selectChannel, onHoverChannel: hoverChannel });
const heatmap  = createHeatmapView( $("heatmap-canvas"),  { onSelectChannel: selectChannel, onHoverChannel: hoverChannel });
const waveform = createWaveformView($("waveform-canvas"));
const iso      = createIsoView(     $("iso-canvas"),      { onSelectChannel: selectChannel, onHoverChannel: hoverChannel });

const handlers = {
  getConfig: () => config,
  onOverviewReset: ({ channelCount, analysisMs }) => {
    state.analysisMs = analysisMs;
    setChannelCount(state, channelCount);
    if (state.selectedChannel === null && Number.isInteger(config.initialChannel))
      state.selectedChannel = Math.min(Math.max(0, config.initialChannel), Math.max(0, channelCount - 1));
    resetStreamState(state, { keepSelection: true });
    updateLabels();
  },
  onLiveReset: ({ fps }) => { state.fps = fps; resetStreamState(state, { keepSelection: true }); updateLabels(); },
  onOverviewChunks: (c) => addOverviewChunks(state, c),
  onSpikes: (s) => { addSpikes(state, s); updateLabels(); },
  onStims:  (s) => { addStims(state, s);  updateLabels(); },
  onStatus: (kind, value) => { state.connection[kind] = value; updateStatus(); },
  onHealth: (kind, ev)    => { recordHealth(state, kind, ev); },
};
let connection = createConnection();

// ---- controls ----
el.connect.addEventListener("click", () => {
  config.host = el.host.value.trim() || "127.0.0.1";
  config.port = el.port.value.trim() || "1025";
  config.demo = false;
  setPaused(false);
  recordHealth(state, "any", "reconnect");
  reconnectWithCurrentMode();
  setQuery();
  toast(`reconnecting · ${config.host}:${config.port}`);
});
el.window.addEventListener("input", () => {
  state.windowSeconds = clamp(el.window.value, 1, 10, 5);
  el.windowOut.textContent = `${state.windowSeconds.toFixed(1)} s`;
  setQuery();
});
el.channel.addEventListener("change", applyChannelInput);
el.channel.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyChannelInput(); } });
function applyChannelInput() {
  const raw = el.channel.value.trim();
  if (!raw) { selectChannel(null); return; }
  selectChannel(clamp(raw, 0, Math.max(0, state.channelCount - 1), 0));
}
el.theme.addEventListener("change", () => {
  config.theme = el.theme.value === "dark" ? "dark" : "paper";
  document.body.classList.toggle("dark", config.theme === "dark");
  setQuery();
});
el.pause.addEventListener("click",  () => setPaused(!state.paused));
el.reset.addEventListener("click",  () => { resetStreamState(state); updateLabels(); toast("view reset"); });
el.auto.addEventListener("click",   () => {
  state.autoSelectActive = !state.autoSelectActive;
  if (state.autoSelectActive && state.channelCount) selectChannel(mostActive(), { manual: false });
  updateAutoButton(); updateLabels();
});
el.presets.addEventListener("click", (e) => { const b = e.target.closest("button[data-preset]"); if (b) applyPreset(b.dataset.preset); });
el.viewtabs.addEventListener("click",(e) => { const b = e.target.closest("button[data-view]");   if (b) setView(b.dataset.view); });
el.debug.addEventListener("click",  () => copyText(JSON.stringify(debugInfo(), null, 2), "debug copied"));
el.embed.addEventListener("click",  () => {
  const u = new URL(location.href); u.searchParams.set("compact", "1");
  copyText(`<iframe src="${u.href}" width="100%" height="720" title="cl-spikeviz"></iframe>`, "iframe snippet copied");
});
el.csv.addEventListener("click",    () => download("cl-spikeviz-spikes.csv", spikeCsv(), "text/csv"));
el.bundle.addEventListener("click", () => download("cl-spikeviz-debug.json", JSON.stringify(debugInfo(), null, 2), "application/json"));

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (e.code === "Space")                             { e.preventDefault(); setPaused(!state.paused); }
  else if (k === "r")                                 { resetStreamState(state); updateLabels(); }
  else if (k === "a")                                 { el.auto.click(); }
  else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); stepChannel(e.key === "ArrowUp" ? -1 : 1); }
});
window.addEventListener("beforeunload", () => connection.disconnect());

// ---- render loop ----
function drawFrame() {
  if (config.view !== "3d") {
    raster.draw(state);
    waveform.draw(state);
    if (config.view === "2d") heatmap.draw(state);
  }
  if (config.view !== "2d") iso.draw(state);
}
function render() { drawFrame(); requestAnimationFrame(render); }
// Keep painting when tab is backgrounded (rAF pauses while hidden).
setInterval(() => { if (document.hidden) drawFrame(); }, 250);

// ---- UI helpers ----
function setPaused(p) {
  state.paused = p;
  el.pause.textContent = p ? "Resume" : "Pause";
  el.pause.setAttribute("aria-pressed", String(p));
  el.pause.classList.toggle("is-active", p);
}
function updateAutoButton() {
  el.auto.textContent = state.autoSelectActive ? "Auto ✓" : "Auto";
  el.auto.setAttribute("aria-pressed", String(state.autoSelectActive));
  el.auto.classList.toggle("is-active", state.autoSelectActive);
}
function updateStatus() {
  const ov = state.connection.overview, lv = state.connection.live;
  const live = ov === "live" && lv === "live";
  const err  = ov === "protocol error" || lv === "protocol error";
  const lbl  = err ? "protocol error" : live ? "live" : (ov === "connecting" || lv === "connecting") ? "connecting" : "waiting";
  el.statusText.textContent = config.demo ? `${lbl} · browser demo` : `${lbl} · ${config.host}:${config.port}`;
  el.statusDot.className = `dot ${live ? "live" : err ? "error" : "waiting"}`;
  setEp(el.epOverview, ov); setEp(el.epLive, lv);
  el.diagHint.innerHTML = diagHint({ ov, lv, live, err });
}
function setEp(node, status) {
  node.className = `endpoint ${String(status).replace(/\s+/g, "-")}`;
  node.querySelector(".ep-state").textContent = status === "live" ? "connected" : status;
}
function updateLabels() {
  el.stats.textContent  = `${state.totals.spikes} spk · ${state.totals.stims} stm`;
  el.fps.textContent    = state.fps ? `${(state.fps / 1000).toFixed(0)}k fps` : "— fps";
  el.chCount.textContent = `${state.channelCount} ch`;
  el.isoSub.textContent  = readout(state.hoveredChannel, "64 electrodes · height & glow show activity");

  const sel = state.selectedChannel;
  el.waveCh.textContent  = sel === null ? "ch —" : `ch ${sel}`;
  el.waveSub.textContent = sel === null ? "select a channel" : waveReadout(sel);
  el.rasterSub.textContent = readout(state.hoveredChannel, "spikes & stims · rolling window");
  el.heatSub.textContent   = readout(state.hoveredChannel, "per-channel activity");

  const focus = state.hoveredChannel ?? sel;
  const st    = getChannelStats(state, focus);
  el.mCh.textContent   = focus === null ? "—" : String(focus);
  el.mAct.textContent  = st ? `${Math.round(st.activity * 100)}%` : "—";
  el.mSpk.textContent  = st ? String(st.spikeCount) : "0";
  el.mLast.textContent = st ? (st.lastSpikeSeconds === null ? "—" : `${st.lastSpikeSeconds.toFixed(2)}s`) : "—";
  el.heatBanner.innerHTML = sel === null ? "" : `selected <b>ch ${sel}</b>`;

  el.mOvRate.textContent = msgRate(state.health.overviewMessages).toFixed(1);
  el.mLvRate.textContent = msgRate(state.health.liveMessages).toFixed(1);
  el.mRecon.textContent  = String(state.health.reconnects);
  el.rate.textContent    = `${(msgRate(state.health.overviewMessages) + msgRate(state.health.liveMessages)).toFixed(1)} /s`;
}
function tickClock() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  el.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  updateLabels();
}
function readout(ch, fallback) {
  const st = getChannelStats(state, ch); if (!st) return fallback;
  const last = st.lastSpikeSeconds === null ? "no recent spike" : `last ${st.lastSpikeSeconds.toFixed(2)}s`;
  return `ch ${st.channel} · ${st.spikeCount} spikes · ${Math.round(st.activity * 100)}% · ${last}`;
}
function waveReadout(ch) {
  const st = getChannelStats(state, ch); if (!st) return `last waveforms · ch ${ch}`;
  const last = st.lastSpikeSeconds === null ? "waiting" : `last ${st.lastSpikeSeconds.toFixed(2)}s`;
  return `${st.waveformCount} waveforms · ${last}`;
}
function mostActive() {
  let ch = 0, best = -1;
  for (let i = 0; i < state.channelCount; i += 1) {
    const score = (state.channelActivity[i] || 0) + (state.channelSpikeCounts[i] || 0) / Math.max(1, state.totals.spikes);
    if (score > best) { best = score; ch = i; }
  }
  return ch;
}
function stepChannel(d) {
  if (!state.channelCount) return;
  const cur = state.selectedChannel ?? 0;
  selectChannel(Math.min(state.channelCount - 1, Math.max(0, cur + d)));
}
function msgRate(count) { return count / Math.max(1, (Date.now() - state.health.startedAt) / 1000); }
function diagHint({ ov, lv, live, err }) {
  if (config.demo) return "Demo data generated in-browser. Add <code>?demo=0</code> &amp; connect to cl-sdk for live.";
  if (err)  return "Protocol mismatch. Capture fixtures and compare parser offsets.";
  if (live) return state.totals.spikes === 0 ? "Connected · no spikes yet. Check subscription." : "Both endpoints live.";
  if (ov === "live") return "overview connected · live_streaming reconnecting.";
  if (lv === "live") return "live_streaming connected · overview reconnecting.";
  return "Simulator not running. Start <code>run_simulator.py</code> or use <code>?demo=1</code>.";
}
function applyPreset(p) {
  const previousDemo = config.demo;
  if (p === "live")    { config.demo = false; config.compact = false; config.theme = "paper"; setView("2d"); }
  else if (p === "compact") { config.compact = true; toast("compact embed mode"); }
  else if (p === "demo")    { config.demo = true; }
  else if (p === "paper")   { config.theme = config.theme === "dark" ? "paper" : "dark"; }
  document.body.classList.toggle("dark", config.theme === "dark");
  el.theme.value = config.theme;
  el.mMode.textContent = config.demo ? "demo" : "live";
  if (config.demo !== previousDemo) reconnectWithCurrentMode();
  setQuery(); updateStatus(); updateLabels();
}
function setView(view) {
  config.view = ["3d", "split"].includes(view) ? view : "2d";
  applyViewClass();
  for (const b of el.viewtabs.querySelectorAll("button[data-view]")) {
    const on = b.dataset.view === config.view;
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("is-active", on);
  }
  setQuery();
}
function applyViewClass() {
  document.body.classList.toggle("view-3d",    config.view === "3d");
  document.body.classList.toggle("view-split", config.view === "split");
}
function setQuery() {
  const n = new URLSearchParams(location.search);
  n.set("host", config.host); n.set("port", config.port);
  n.set("window", String(state.windowSeconds));
  config.demo             ? n.set("demo", "1") : n.delete("demo");
  config.theme === "dark" ? n.set("theme", "dark") : n.delete("theme");
  config.view !== "2d"    ? n.set("view", config.view) : n.delete("view");
  config.compact          ? n.set("compact", "1") : n.delete("compact");
  state.selectedChannel !== null ? n.set("channel", String(state.selectedChannel)) : n.delete("channel");
  history.replaceState(null, "", `${location.pathname}?${n.toString()}`);
}
function debugInfo() {
  return {
    url: location.href, mode: config.demo ? "demo" : "live",
    host: config.host, port: config.port, view: config.view,
    windowSeconds: state.windowSeconds, paused: state.paused,
    connection: { ...state.connection }, fps: state.fps,
    channelCount: state.channelCount, selectedChannel: state.selectedChannel,
    totals: { ...state.totals },
    health: { ...state.health,
      overviewMsgPerSec: msgRate(state.health.overviewMessages),
      liveMsgPerSec:     msgRate(state.health.liveMessages) },
    recentEvents: { spikes: state.spikes.slice(-200), stims: state.stims.slice(-200) },
    userAgent: navigator.userAgent,
  };
}
function spikeCsv() {
  const lines = ["time_s,channel,type"];
  for (const s of state.spikes) lines.push(`${s.seconds.toFixed(6)},${s.channel},spike`);
  for (const s of state.stims)  lines.push(`${s.seconds.toFixed(6)},${s.channel},stim`);
  return `${lines.join("\n")}\n`;
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url); toast(`${name} downloaded`);
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { console.log(text); toast("logged to console"); }
}
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg; el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1600);
}
function clamp(v, min, max, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v); if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function createConnection() {
  return config.demo ? new DemoStream(handlers) : new SpikeVizConnection(handlers);
}

function reconnectWithCurrentMode() {
  connection.disconnect();
  connection = createConnection();
  resetStreamState(state, { keepSelection: true });
  connection.connect();
}

// ---- boot ----
updateAutoButton(); updateStatus(); updateLabels();
connection.connect();
setInterval(tickClock, 1000);
requestAnimationFrame(render);
