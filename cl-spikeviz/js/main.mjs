import { DemoStream } from "./demo.mjs";
import { createHeatmapView } from "./heatmap.mjs";
import { createRasterView } from "./raster.mjs";
import {
  addOverviewChunks,
  addSpikes,
  addStims,
  createState,
  getChannelStats,
  recordHealth,
  resetHealth,
  resetStreamState,
  setChannelCount,
} from "./state.mjs";
import { createWaveformView } from "./waveforms.mjs";
import { SpikeVizConnection } from "./ws.mjs";

const params = new URLSearchParams(location.search);
const config = {
  host: params.get("host") || "127.0.0.1",
  port: params.get("port") || "1025",
  demo: params.get("demo") === "1",
  compact: params.get("compact") === "1",
  theme: params.get("theme") === "light" ? "light" : "dark",
  view: ["3d", "split"].includes(params.get("view")) ? params.get("view") : "2d",
  initialChannel: params.has("channel") ? Number(params.get("channel")) : null,
};

const state = createState({ windowSeconds: clampNumber(params.get("window"), 1, 10, 5) });
document.body.classList.toggle("compact", config.compact);
document.body.classList.toggle("light", config.theme === "light");
document.body.classList.toggle("view-3d", config.view === "3d");
document.body.classList.toggle("view-split", config.view === "split");

const elements = {
  form: document.getElementById("connection-form"),
  host: document.getElementById("host-input"),
  port: document.getElementById("port-input"),
  window: document.getElementById("window-input"),
  windowOutput: document.getElementById("window-output"),
  channel: document.getElementById("channel-input"),
  theme: document.getElementById("theme-input"),
  pause: document.getElementById("pause-button"),
  reset: document.getElementById("reset-button"),
  autoChannel: document.getElementById("auto-channel-button"),
  exportCsv: document.getElementById("export-csv-button"),
  exportBundle: document.getElementById("export-bundle-button"),
  copyDebug: document.getElementById("copy-debug-button"),
  copyEmbed: document.getElementById("copy-embed-button"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  statsText: document.getElementById("stats-text"),
  overviewStatus: document.getElementById("overview-status"),
  liveStatus: document.getElementById("live-status"),
  protocolStatus: document.getElementById("protocol-status"),
  healthStatus: document.getElementById("health-status"),
  modeStatus: document.getElementById("mode-status"),
  diagnosticHint: document.getElementById("diagnostic-hint"),
  presets: document.querySelector(".presets"),
  viewSwitch: document.querySelector(".view-switch"),
  fpsText: document.getElementById("fps-text"),
  channelCountText: document.getElementById("channel-count-text"),
  selectedChannelText: document.getElementById("selected-channel-text"),
  threeStatusText: document.getElementById("three-status-text"),
  waveformSubtitle: document.getElementById("waveform-subtitle"),
  rasterReadout: document.getElementById("raster-readout"),
  heatmapReadout: document.getElementById("heatmap-readout"),
  threeReadout: document.getElementById("three-readout"),
  raster: document.getElementById("raster-canvas"),
  heatmap: document.getElementById("heatmap-canvas"),
  waveforms: document.getElementById("waveform-canvas"),
  three: document.getElementById("three-view"),
};

elements.host.value = config.host;
elements.port.value = config.port;
elements.window.value = String(state.windowSeconds);
elements.windowOutput.value = `${state.windowSeconds}s`;
elements.theme.value = config.theme;

const selectChannel = (channel, { manual = true } = {}) => {
  state.selectedChannel = channel;
  if (manual) {
    state.autoSelectActive = false;
    setQueryParams();
  }
  updateUiLabels();
};

const hoverChannel = (channel) => {
  state.hoveredChannel = channel;
  updateUiLabels();
};

const rasterView = createRasterView(elements.raster, { onSelectChannel: selectChannel, onHoverChannel: hoverChannel });
const heatmapView = createHeatmapView(elements.heatmap, { onSelectChannel: selectChannel, onHoverChannel: hoverChannel });
const waveformView = createWaveformView(elements.waveforms);
let threeView = null;
let threeViewPromise = null;
let threeStatusFlashTimer = null;

const connectionHandlers = {
  getConfig: () => config,
  onOverviewReset: ({ channelCount, analysisMs }) => {
    state.analysisMs = analysisMs;
    setChannelCount(state, channelCount);
    if (state.selectedChannel === null && Number.isInteger(config.initialChannel)) {
      state.selectedChannel = Math.min(Math.max(0, config.initialChannel), Math.max(0, channelCount - 1));
    }
    resetStreamState(state, { keepSelection: true });
    updateUiLabels();
  },
  onLiveReset: ({ fps }) => {
    state.fps = fps;
    resetStreamState(state, { keepSelection: true });
    updateUiLabels();
  },
  onOverviewChunks: (chunks) => addOverviewChunks(state, chunks),
  onSpikes: (spikes) => {
    addSpikes(state, spikes);
    updateUiLabels();
  },
  onStims: (stims) => {
    addStims(state, stims);
    updateUiLabels();
  },
  onStatus: (kind, value) => {
    state.connection[kind] = value;
    updateConnectionStatus();
  },
  onHealth: (kind, event) => {
    recordHealth(state, kind, event);
    updateUiLabels();
  },
};

let connection = createConnection();

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  config.host = elements.host.value.trim() || "127.0.0.1";
  config.port = elements.port.value.trim() || "1025";
  config.demo = false;
  setQueryParams();
  setPaused(false);
  resetHealth(state);
  if (connection instanceof DemoStream) {
    connection.disconnect();
    connection = createConnection();
  }
  connection.reconnect();
});

elements.window.addEventListener("input", () => {
  state.windowSeconds = clampNumber(elements.window.value, 1, 10, 5);
  elements.windowOutput.value = `${state.windowSeconds}s`;
  setQueryParams();
});

elements.channel.addEventListener("change", () => {
  applyChannelInput();
});

elements.channel.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyChannelInput();
  }
});

function applyChannelInput() {
  const raw = elements.channel.value.trim();
  if (!raw) {
    selectChannel(null);
    return;
  }

  const channel = clampNumber(raw, 0, Math.max(0, state.channelCount - 1), 0);
  selectChannel(channel);
}

elements.theme.addEventListener("change", () => {
  config.theme = elements.theme.value === "light" ? "light" : "dark";
  document.body.classList.toggle("light", config.theme === "light");
  setQueryParams();
});

elements.pause.addEventListener("click", () => {
  setPaused(!state.paused);
});

elements.reset.addEventListener("click", () => {
  resetStreamState(state);
  flashThreeStatus("cleared");
  updateUiLabels();
});

elements.autoChannel.addEventListener("click", () => {
  state.autoSelectActive = !state.autoSelectActive;
  if (state.autoSelectActive && state.channelCount) {
    selectChannel(mostActiveChannel(), { manual: false });
  }
  updateUiLabels();
});

elements.copyDebug.addEventListener("click", async () => {
  const debugInfo = createDebugInfo();
  await copyTextWithFeedback(elements.copyDebug, JSON.stringify(debugInfo, null, 2), "Copied", "Logged");
});

elements.copyEmbed.addEventListener("click", async () => {
  const embedUrl = new URL(location.href);
  embedUrl.searchParams.set("compact", "1");
  const iframe = `<iframe src="${embedUrl.href}" width="100%" height="720" title="cl-spikeviz live activity"></iframe>`;
  await copyTextWithFeedback(elements.copyEmbed, iframe, "Copied", "Logged");
});

elements.exportCsv.addEventListener("click", () => {
  downloadText("cl-spikeviz-spikes.csv", createSpikeCsv(), "text/csv");
});

elements.exportBundle.addEventListener("click", () => {
  downloadText("cl-spikeviz-debug.json", JSON.stringify(createDebugInfo(), null, 2), "application/json");
});

elements.presets.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-preset]");
  if (!button) {
    return;
  }
  applyPreset(button.dataset.preset);
});

elements.viewSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) {
    return;
  }
  setView(button.dataset.view);
});

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    setPaused(!state.paused);
  } else if (event.key.toLowerCase() === "r") {
    resetStreamState(state);
    updateUiLabels();
  } else if (event.key.toLowerCase() === "a") {
    state.autoSelectActive = !state.autoSelectActive;
    if (state.autoSelectActive && state.channelCount) {
      selectChannel(mostActiveChannel(), { manual: false });
    }
    updateUiLabels();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    stepSelectedChannel(event.key === "ArrowUp" ? -1 : 1);
  }
});

window.addEventListener("beforeunload", () => connection.disconnect());

function render() {
  if (document.hidden) {
    requestAnimationFrame(render);
    return;
  }
  if (config.view !== "3d") {
    rasterView.draw(state);
    if (config.view === "2d") {
      heatmapView.draw(state);
    }
    waveformView.draw(state);
  }
  if (config.view !== "2d" && threeView) {
    threeView.draw(state);
  }
  requestAnimationFrame(render);
}

function updateConnectionStatus() {
  const overview = state.connection.overview;
  const live = state.connection.live;
  const isLive = overview === "live" && live === "live";
  const isProtocolError = overview === "protocol error" || live === "protocol error";
  const label = isProtocolError
    ? "protocol error"
    : isLive
      ? "live"
      : overview === "connecting" || live === "connecting"
        ? "connecting"
        : "waiting for simulator";

  elements.statusText.textContent = config.demo ? `${label} · browser demo` : `${label} · ${config.host}:${config.port}`;
  elements.statusDot.className = `status-dot ${isLive ? "live" : isProtocolError ? "error" : "waiting"}`;
  elements.overviewStatus.textContent = `overview ${endpointLabel(overview)}`;
  elements.liveStatus.textContent = `live_streaming ${endpointLabel(live)}`;
  elements.overviewStatus.className = `endpoint-pill ${statusClass(overview)}`;
  elements.liveStatus.className = `endpoint-pill ${statusClass(live)}`;
  elements.protocolStatus.textContent = "Protocol: cl-sdk live_streaming + overview";
  elements.healthStatus.textContent = healthLabel();
  elements.modeStatus.textContent = config.demo ? "demo mode" : "live mode";
  elements.modeStatus.className = `endpoint-pill ${config.demo ? "live" : ""}`;
  elements.diagnosticHint.textContent = diagnosticHint({ overview, live, isLive, isProtocolError });
}

function updateUiLabels() {
  elements.statsText.textContent = `${state.totals.spikes} spikes · ${state.totals.stims} stims`;
  elements.fpsText.textContent = state.fps ? `${state.fps} fps` : "fps unknown";
  elements.channelCountText.textContent = `${state.channelCount} ch`;
  elements.selectedChannelText.textContent = state.selectedChannel === null ? "none" : `ch ${state.selectedChannel}`;
  if (document.activeElement !== elements.channel) {
    elements.channel.value = state.selectedChannel === null ? "" : String(state.selectedChannel);
  }
  elements.autoChannel.textContent = state.autoSelectActive ? "Auto on" : "Auto";
  elements.autoChannel.setAttribute("aria-pressed", String(state.autoSelectActive));
  elements.rasterReadout.textContent = readoutForChannel(state.hoveredChannel, "Hover raster rows or click to select.");
  elements.heatmapReadout.textContent = readoutForChannel(state.hoveredChannel, "Recent per-channel activity");
  elements.threeReadout.textContent = readoutForChannel(state.hoveredChannel, "64 electrodes · height and glow show recent activity.");
  updateThreeStatusLabel();
  elements.waveformSubtitle.textContent = state.selectedChannel === null
    ? "Click a channel"
    : waveformReadout(state.selectedChannel);
  elements.healthStatus.textContent = healthLabel();
  elements.diagnosticHint.textContent = diagnosticHint({
    overview: state.connection.overview,
    live: state.connection.live,
    isLive: state.connection.overview === "live" && state.connection.live === "live",
    isProtocolError: state.connection.overview === "protocol error" || state.connection.live === "protocol error",
  });
}

function setPaused(paused) {
  state.paused = paused;
  elements.pause.textContent = state.paused ? "Resume" : "Pause";
  elements.pause.setAttribute("aria-pressed", String(state.paused));
  updateThreeStatusLabel();
}

function setQueryParams() {
  const next = new URLSearchParams(location.search);
  next.set("host", config.host);
  next.set("port", config.port);
  next.set("window", String(state.windowSeconds));
  setOptionalParam(next, "demo", config.demo);
  setOptionalParam(next, "compact", config.compact);
  if (config.theme === "light") {
    next.set("theme", "light");
  } else {
    next.delete("theme");
  }
  if (config.view !== "2d") {
    next.set("view", config.view);
  } else {
    next.delete("view");
  }
  if (state.selectedChannel !== null) {
    next.set("channel", String(state.selectedChannel));
  } else {
    next.delete("channel");
  }
  history.replaceState(null, "", `${location.pathname}?${next.toString()}`);
}

function createConnection() {
  return config.demo
    ? new DemoStream(connectionHandlers)
    : new SpikeVizConnection(connectionHandlers);
}

function statusClass(status) {
  return String(status).replace(/\s+/g, "-");
}

function endpointLabel(status) {
  return status === "live" ? "connected" : status;
}

function diagnosticHint({ overview, live, isLive, isProtocolError }) {
  if (config.demo) {
    return "Demo data is generated in the browser. Remove demo=1 to use cl-sdk.";
  }
  if (isProtocolError) {
    return "Protocol mismatch. Capture fixtures and compare parser offsets.";
  }
  if (isLive) {
    if (state.totals.spikes === 0) {
      return "live_streaming connected but no spikes yet. Check cl_spikes subscription or simulator activity.";
    }
    return "Both WebSocket endpoints are live.";
  }
  if (overview === "live" && live !== "live") {
    return "overview connected; live_streaming missing or still reconnecting.";
  }
  if (live === "live" && overview !== "live") {
    return "live_streaming connected; overview missing or still reconnecting.";
  }
  return "Simulator not running. Start tools/run_simulator.py or add ?demo=1 for a browser-only preview.";
}

function createDebugInfo() {
  return {
    url: location.href,
    mode: config.demo ? "demo" : "live",
    host: config.host,
    port: config.port,
    view: config.view,
    windowSeconds: state.windowSeconds,
    paused: state.paused,
    connection: { ...state.connection },
    fps: state.fps,
    channelCount: state.channelCount,
    selectedChannel: state.selectedChannel,
    totals: { ...state.totals },
    health: {
      ...state.health,
      overviewLastAgeMs: ageMs(state.health.overviewLastAt),
      liveLastAgeMs: ageMs(state.health.liveLastAt),
      overviewMessagesPerSecond: messagesPerSecond(state.health.overviewMessages),
      liveMessagesPerSecond: messagesPerSecond(state.health.liveMessages),
    },
    recentEvents: {
      spikes: state.spikes.slice(-200),
      stims: state.stims.slice(-200),
    },
    userAgent: navigator.userAgent,
  };
}

function healthLabel() {
  const overviewAge = ageMs(state.health.overviewLastAt);
  const liveAge = ageMs(state.health.liveLastAt);
  const overviewRate = messagesPerSecond(state.health.overviewMessages);
  const liveRate = messagesPerSecond(state.health.liveMessages);
  const overviewText = overviewAge === null ? "overview --" : `overview ${overviewRate.toFixed(1)}/s ${formatAge(overviewAge)}`;
  const liveText = liveAge === null ? "live --" : `live ${liveRate.toFixed(1)}/s ${formatAge(liveAge)}`;
  return `${overviewText} · ${liveText} · reconnects ${state.health.reconnects}`;
}

function ageMs(timestamp) {
  return timestamp === null ? null : Math.max(0, Date.now() - timestamp);
}

function messagesPerSecond(count) {
  const elapsedSeconds = Math.max(1, (Date.now() - state.health.startedAt) / 1000);
  return count / elapsedSeconds;
}

function formatAge(ms) {
  if (ms < 1000) {
    return "now";
  }
  return `${(ms / 1000).toFixed(1)}s ago`;
}

function readoutForChannel(channel, fallback) {
  const stats = getChannelStats(state, channel);
  if (!stats) {
    return fallback;
  }
  const activity = Math.round(stats.activity * 100);
  const last = stats.lastSpikeSeconds === null ? "no recent spike" : `last ${stats.lastSpikeSeconds.toFixed(2)}s`;
  return `ch ${stats.channel} · ${stats.spikeCount} spikes · ${activity}% activity · ${last}`;
}

function waveformReadout(channel) {
  const stats = getChannelStats(state, channel);
  if (!stats) {
    return `Last waveforms for channel ${channel}`;
  }
  const last = stats.lastSpikeSeconds === null ? "waiting for spikes" : `last spike ${stats.lastSpikeSeconds.toFixed(2)}s`;
  return `ch ${channel} · ${stats.waveformCount} waveforms · ${last}`;
}

function mostActiveChannel() {
  let channel = 0;
  let best = -1;
  for (let i = 0; i < state.channelCount; i += 1) {
    const score = (state.channelActivity[i] || 0) + (state.channelSpikeCounts[i] || 0) / Math.max(1, state.totals.spikes);
    if (score > best) {
      best = score;
      channel = i;
    }
  }
  return channel;
}

async function copyTextWithFeedback(button, text, successLabel, fallbackLabel) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = successLabel;
  } catch {
    console.log(text);
    button.textContent = fallbackLabel;
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

function createSpikeCsv() {
  const lines = ["time_s,channel,type"];
  for (const spike of state.spikes) {
    lines.push(`${spike.seconds.toFixed(6)},${spike.channel},spike`);
  }
  for (const stim of state.stims) {
    lines.push(`${stim.seconds.toFixed(6)},${stim.channel},stim`);
  }
  return `${lines.join("\n")}\n`;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function applyPreset(preset) {
  if (preset === "live") {
    config.demo = false;
    config.compact = false;
    config.theme = "dark";
    config.view = "2d";
  } else if (preset === "compact") {
    config.compact = true;
  } else if (preset === "demo") {
    config.demo = true;
    config.compact = true;
  } else if (preset === "light") {
    config.theme = "light";
  }

  document.body.classList.toggle("compact", config.compact);
  document.body.classList.toggle("light", config.theme === "light");
  applyViewClass();
  elements.theme.value = config.theme;
  updateViewButtons();
  ensureThreeView();
  setQueryParams();

  const nextConnection = createConnection();
  connection.disconnect();
  connection = nextConnection;
  resetHealth(state);
  resetStreamState(state, { keepSelection: true });
  connection.connect();
  updateConnectionStatus();
  updateUiLabels();
}

function setView(view, { updateQuery = true } = {}) {
  config.view = ["3d", "split"].includes(view) ? view : "2d";
  applyViewClass();
  updateViewButtons();
  ensureThreeView();
  updateUiLabels();
  if (updateQuery) {
    setQueryParams();
  }
}

function applyViewClass() {
  document.body.classList.toggle("view-3d", config.view === "3d");
  document.body.classList.toggle("view-split", config.view === "split");
}

function updateViewButtons() {
  for (const button of elements.viewSwitch.querySelectorAll("button[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === config.view));
  }
}

function updateThreeStatusLabel() {
  if (threeStatusFlashTimer || threeViewPromise) {
    return;
  }
  if (!threeView) {
    elements.threeStatusText.textContent = "standby";
    return;
  }
  elements.threeStatusText.textContent = state.paused ? "paused" : `${state.channelCount || 64} ch`;
}

function flashThreeStatus(label) {
  clearTimeout(threeStatusFlashTimer);
  elements.threeStatusText.textContent = label;
  threeStatusFlashTimer = setTimeout(() => {
    threeStatusFlashTimer = null;
    updateThreeStatusLabel();
  }, 700);
}

function ensureThreeView() {
  if (config.view === "2d" || threeView || threeViewPromise) {
    return;
  }
  elements.threeStatusText.textContent = "loading";
  threeViewPromise = import("./three-view.mjs")
    .then(({ createThreeMeaView }) => createThreeMeaView(elements.three, {
      onSelectChannel: selectChannel,
      onHoverChannel: hoverChannel,
      onStatus: (status) => {
        elements.threeStatusText.textContent = status;
      },
    }))
    .then((view) => {
      threeView = view;
      updateThreeStatusLabel();
    })
    .catch((error) => {
      console.error("3D view failed to initialise", error);
      elements.three.innerHTML = '<p class="webgl-fallback">3D view failed to initialise. The 2D dashboard remains available.</p>';
      elements.threeStatusText.textContent = "unavailable";
    })
    .finally(() => {
      threeViewPromise = null;
    });
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function stepSelectedChannel(delta) {
  if (!state.channelCount) {
    return;
  }
  const current = state.selectedChannel ?? 0;
  const next = Math.min(state.channelCount - 1, Math.max(0, current + delta));
  selectChannel(next);
}

function setOptionalParam(searchParams, key, enabled) {
  if (enabled) {
    searchParams.set(key, "1");
  } else {
    searchParams.delete(key);
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

updateConnectionStatus();
updateUiLabels();
setView(config.view, { updateQuery: false });
connection.connect();
requestAnimationFrame(render);
