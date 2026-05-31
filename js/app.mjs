import { DemoStream } from "./demo.mjs";
import { RecordingReplay, parseRecordingSnapshot, readRecordingFile } from "./recording.mjs";
import { createRasterView }   from "./raster.mjs";
import { createHeatmapView }  from "./heatmap.mjs";
import { createWaveformView } from "./waveforms.mjs";
import { createIsoView }      from "./iso3d.mjs";
import { createElectrodeGridView } from "./electrode-grid.mjs";
import { SpikeVizConnection } from "./ws.mjs";
import {
  addOverviewChunks, addSpikes, addStims, createState, getChannelStats,
  recordHealth, resetHealth, resetStreamState, setChannelCount,
} from "./state.mjs";

const params = new URLSearchParams(location.search);
const config = {
  host:           params.get("host")  || "127.0.0.1",
  port:           params.get("port")  || "1025",
  demo:           params.get("demo")  === "1",
  compact:        params.get("compact") === "1",
  theme:          params.get("theme") === "dark" ? "dark" : "paper",
  view:           ["3d", "split", "grid"].includes(params.get("view")) ? params.get("view") : "2d",
  initialChannel: params.has("channel") ? Number(params.get("channel")) : null,
};

const state = createState({ windowSeconds: clamp(params.get("window"), 1, 10, 5) });
let activeSource = config.demo ? "demo" : "live";
let activeRecording = null;
document.body.classList.toggle("dark", config.theme === "dark");
applyViewClass();

const $ = (id) => document.getElementById(id);
const el = {
  host: $("host-input"), port: $("port-input"), connect: $("connect-btn"),
  window: $("window-input"), windowOut: $("window-output"),
  pause: $("pause-btn"), reset: $("reset-btn"), auto: $("auto-btn"),
  channel: $("channel-input"), theme: $("theme-input"), presets: $("presets"),
  recordingInput: $("recording-input"), recordingBtn: $("recording-btn"),
  sampleRecording: $("sample-recording-btn"), recordingHint: $("recording-hint"),
  statusDot: $("status-dot"), statusText: $("status-text"),
  stats: $("stats-text"), rate: $("rate-text"), clock: $("clock-text"),
  fps: $("fps-text"), chCount: $("ch-count"),
  rasterSub: $("raster-sub"), heatSub: $("heat-sub"), gridSub: $("grid-sub"), waveSub: $("wave-sub"),
  waveCh: $("wave-ch"), heatBanner: $("heat-banner"), isoSub: $("iso-sub"),
  gridStatus: $("grid-status"),
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
el.mMode.textContent = modeLabel();
syncViewTabs();

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
const grid     = createElectrodeGridView($("electrode-grid-canvas"), { onSelectChannel: selectChannel, onHoverChannel: hoverChannel });

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
  if (activeSource === "recording") {
    setPaused(false);
    connection.reconnect();
    toast("recording restarted");
    return;
  }

  config.host = el.host.value.trim() || "127.0.0.1";
  config.port = el.port.value.trim() || "1025";
  setPaused(false);
  recordHealth(state, "any", "reconnect");
  reconnectWithCurrentMode();
  setQuery();
  toast(activeSource === "demo" ? "demo restarted" : `reconnecting · ${config.host}:${config.port}`);
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
el.recordingBtn.addEventListener("click", () => el.recordingInput.click());
el.recordingInput.addEventListener("change", () => loadRecordingFile(el.recordingInput.files?.[0]));
el.sampleRecording.addEventListener("click", () => loadSampleRecording());
el.pause.addEventListener("click",  () => setPaused(!state.paused));
el.reset.addEventListener("click",  () => resetCurrentView());
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
  else if (k === "r")                                 { resetCurrentView(); }
  else if (k === "a")                                 { el.auto.click(); }
  else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); stepChannel(e.key === "ArrowUp" ? -1 : 1); }
});
window.addEventListener("beforeunload", () => connection.disconnect());
window.addEventListener("dragenter", showRecordingDrop);
window.addEventListener("dragover", showRecordingDrop);
window.addEventListener("dragleave", hideRecordingDrop);
window.addEventListener("drop", handleRecordingDrop);

// ---- render loop ----
function drawFrame() {
  if (config.view === "2d" || config.view === "split") {
    raster.draw(state);
    waveform.draw(state);
    if (config.view === "2d") {
      heatmap.draw(state);
    }
  } else if (config.view === "grid") {
    grid.draw(state);
  }
  if (config.view === "3d" || config.view === "split") {
    iso.draw(state);
  }
}
function render() { drawFrame(); requestAnimationFrame(render); }
// Keep painting when tab is backgrounded (rAF pauses while hidden).
setInterval(() => { if (document.hidden) drawFrame(); }, 250);

// ---- UI helpers ----
function setPaused(p, { syncSource = true } = {}) {
  state.paused = p;
  el.pause.textContent = p ? "Resume" : "Pause";
  el.pause.setAttribute("aria-pressed", String(p));
  el.pause.classList.toggle("is-active", p);
  if (syncSource && typeof connection.setPaused === "function") {
    connection.setPaused(p);
  }
  updateStatus();
}
function updateAutoButton() {
  el.auto.textContent = state.autoSelectActive ? "Auto ✓" : "Auto";
  el.auto.setAttribute("aria-pressed", String(state.autoSelectActive));
  el.auto.classList.toggle("is-active", state.autoSelectActive);
}
function updateStatus() {
  const ov = state.connection.overview, lv = state.connection.live;
  const recording = activeSource === "recording";
  const ended = ov === "ended" && lv === "ended";
  const live = ov === "live" && lv === "live";
  const err  = ov === "protocol error" || lv === "protocol error";
  const lbl  = err ? "protocol error" : ended ? "ended" : live ? "live" : (ov === "connecting" || lv === "connecting") ? "connecting" : "waiting";
  if (recording) {
    const replayState = err ? "recording error" : ended ? "recording ended" : state.paused ? "recording paused" : "replaying";
    el.statusText.textContent = `${replayState} · ${recordingName()}`;
  } else {
    el.statusText.textContent = activeSource === "demo" ? `${lbl} · browser demo` : `${lbl} · ${config.host}:${config.port}`;
  }
  el.statusDot.className = `dot ${live && !ended ? "live" : err ? "error" : "waiting"}`;
  setEp(el.epOverview, ov); setEp(el.epLive, lv);
  refreshDiagHint();
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
  el.gridStatus.textContent = gridStatus();

  const sel = state.selectedChannel;
  el.waveCh.textContent  = sel === null ? "ch —" : `ch ${sel}`;
  el.waveSub.textContent = sel === null ? "select a channel" : waveReadout(sel);
  el.rasterSub.textContent = readout(state.hoveredChannel, "spikes & stims · rolling window");
  el.heatSub.textContent   = readout(state.hoveredChannel, "per-channel activity");
  el.gridSub.textContent    = gridReadout(state.hoveredChannel ?? sel);

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
  el.mMode.textContent = modeLabel();
  el.rate.textContent    = `${(msgRate(state.health.overviewMessages) + msgRate(state.health.liveMessages)).toFixed(1)} /s`;
  refreshDiagHint();
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
function gridReadout(ch) {
  const st = getChannelStats(state, ch);
  if (!st) {
    return gridSummary();
  }
  const event = st.hasStim ? "last stim" : st.lastEventType ? `last ${st.lastEventType}` : "no recent event";
  return `ch ${st.channel} · ${st.windowSpikeCount} spikes in window · ${st.spikeRateHz.toFixed(2)} Hz · ${event}`;
}
function gridSummary() {
  if (!state.channelCount) {
    return "waiting for channel metadata";
  }
  const layout = logicalChannelLayout(state.channelCount);
  if (layout.isExactSquare) {
    return `logical ${layout.cols} × ${layout.rows} channels · size shows spike rate`;
  }
  return `logical ${layout.cols} × ${layout.rows} layout, not physical electrode geometry`;
}
function gridStatus() {
  if (!state.channelCount) {
    return "0 ch";
  }
  const layout = logicalChannelLayout(state.channelCount);
  return `${layout.cols} × ${layout.rows}`;
}
function logicalChannelLayout(channelCount) {
  const cols = Math.ceil(Math.sqrt(channelCount));
  const rows = Math.ceil(channelCount / cols);
  return {
    cols,
    rows,
    isExactSquare: cols === rows && cols * rows === channelCount,
  };
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
function refreshDiagHint() {
  const ov = state.connection.overview, lv = state.connection.live;
  const live = ov === "live" && lv === "live";
  const err = ov === "protocol error" || lv === "protocol error";
  el.diagHint.innerHTML = diagHint({ ov, lv, live, err });
}
function diagHint({ ov, lv, live, err }) {
  if (activeSource === "recording") {
    if (ov === "ended" && lv === "ended") return "Recording finished. Press <code>R</code> or Reset to replay from the start.";
    return "Snapshot replay is local to the browser and uses the same parsed event state as live mode.";
  }
  if (activeSource === "demo") return "Demo data generated in-browser. Add <code>?demo=0</code> &amp; connect to cl-sdk for live.";
  if (err)  return "Protocol mismatch. Capture fixtures and compare parser offsets.";
  if (live) return state.totals.spikes === 0 ? "Connected · no spikes yet. Check subscription." : "Both endpoints live.";
  if (ov === "live") return "overview connected · live_streaming reconnecting.";
  if (lv === "live") return "live_streaming connected · overview reconnecting.";
  return "Simulator not running. Start <code>run_simulator.py</code> or use <code>?demo=1</code>.";
}
function applyPreset(p) {
  const previousSource = activeSource;
  if (p === "live")    { activeSource = "live"; activeRecording = null; config.demo = false; config.compact = false; config.theme = "paper"; setView("2d"); }
  else if (p === "compact") { config.compact = true; toast("compact embed mode"); }
  else if (p === "demo")    { activeSource = "demo"; activeRecording = null; config.demo = true; }
  else if (p === "paper")   { config.theme = config.theme === "dark" ? "paper" : "dark"; }
  document.body.classList.toggle("dark", config.theme === "dark");
  el.theme.value = config.theme;
  el.mMode.textContent = modeLabel();
  if (activeSource !== previousSource) {
    resetHealth(state);
    setPaused(false, { syncSource: false });
    reconnectWithCurrentMode();
  }
  setQuery(); updateStatus(); updateLabels();
}
function setView(view) {
  config.view = ["3d", "split", "grid"].includes(view) ? view : "2d";
  applyViewClass();
  syncViewTabs();
  setQuery();
}
function syncViewTabs() {
  for (const b of el.viewtabs.querySelectorAll("button[data-view]")) {
    const on = b.dataset.view === config.view;
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("is-active", on);
  }
}
function applyViewClass() {
  document.body.classList.toggle("view-3d",    config.view === "3d");
  document.body.classList.toggle("view-split", config.view === "split");
  document.body.classList.toggle("view-grid",  config.view === "grid");
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
    url: location.href, mode: modeLabel(),
    host: config.host, port: config.port, view: config.view,
    windowSeconds: state.windowSeconds, paused: state.paused,
    recording: activeRecording ? {
      name: recordingName(),
      durationMs: activeRecording.durationMs,
      events: activeRecording.events.length,
      fileSize: activeRecording.fileSize || null,
    } : null,
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
  if (activeSource === "recording" && activeRecording) {
    return new RecordingReplay({
      recording: activeRecording,
      ...handlers,
      onEnded: () => {
        setPaused(true, { syncSource: false });
        toast("recording ended");
        updateStatus();
      },
    });
  }

  return activeSource === "demo" ? new DemoStream(handlers) : new SpikeVizConnection(handlers);
}

function reconnectWithCurrentMode() {
  connection.disconnect();
  connection = createConnection();
  resetStreamState(state, { keepSelection: true });
  connection.connect();
}

function resetCurrentView() {
  if (activeSource === "recording" && typeof connection.restart === "function") {
    const replayEnded = state.connection.overview === "ended" && state.connection.live === "ended";
    setPaused(replayEnded ? false : state.paused, { syncSource: false });
    connection.restart({ paused: state.paused });
    updateLabels();
    toast("recording reset");
    return;
  }

  resetStreamState(state);
  updateLabels();
  setQuery();
  toast("view reset");
}

async function loadRecordingFile(file) {
  if (!file) {
    return;
  }

  try {
    startRecording(await readRecordingFile(file));
  } catch (error) {
    showRecordingMessage(`Rejected: ${error.message}`, true);
    toast("recording rejected");
  } finally {
    el.recordingInput.value = "";
  }
}

async function loadSampleRecording() {
  try {
    const response = await fetch("./assets/sample-recording.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`sample returned HTTP ${response.status}`);
    const text = await response.text();
    const recording = parseRecordingSnapshot(text, { name: "sample-recording.json" });
    recording.fileName = "sample-recording.json";
    recording.fileSize = text.length;
    startRecording(recording);
  } catch (error) {
    showRecordingMessage(`Sample unavailable: ${error.message}`, true);
    toast("sample unavailable");
  }
}

function startRecording(recording) {
  activeSource = "recording";
  activeRecording = recording;
  config.demo = false;
  resetHealth(state);
  setPaused(false, { syncSource: false });
  reconnectWithCurrentMode();
  setQuery();
  showRecordingMessage(`${recordingName()} · ${(recording.durationMs / 1000).toFixed(2)}s · ${recording.events.length} events`);
  toast("recording loaded");
}

function showRecordingMessage(message, isError = false) {
  el.recordingHint.textContent = message;
  el.recordingHint.classList.toggle("error", isError);
}

function showRecordingDrop(event) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  document.body.classList.add("is-dragging-file");
}

function hideRecordingDrop(event) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.type === "dragleave" && event.relatedTarget !== null) return;
  document.body.classList.remove("is-dragging-file");
}

function handleRecordingDrop(event) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  document.body.classList.remove("is-dragging-file");
  const file = Array.from(event.dataTransfer.files).find((item) => item.name.endsWith(".json")) || event.dataTransfer.files[0];
  loadRecordingFile(file);
}

function hasFiles(event) {
  return event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files");
}

function modeLabel() {
  return activeSource === "recording" ? "recording" : activeSource === "demo" ? "demo" : "live";
}

function recordingName() {
  return activeRecording?.fileName || activeRecording?.name || "recording";
}

// ---- boot ----
updateAutoButton(); updateStatus(); updateLabels();
connection.connect();
setInterval(tickClock, 1000);
requestAnimationFrame(render);
