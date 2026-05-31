import {
  parseJsonMessage,
  parseOverviewPayload,
  parseSpikePayload,
  parseStimPayload,
} from "./protocol.mjs";

const INITIAL_RECONNECT_MS = 350;
const MAX_RECONNECT_MS = 2500;

export class SpikeVizConnection {
  constructor({ getConfig, onOverviewReset, onLiveReset, onOverviewChunks, onSpikes, onStims, onStatus, onHealth }) {
    this.getConfig = getConfig;
    this.onOverviewReset = onOverviewReset;
    this.onLiveReset = onLiveReset;
    this.onOverviewChunks = onOverviewChunks;
    this.onSpikes = onSpikes;
    this.onStims = onStims;
    this.onStatus = onStatus;
    this.onHealth = onHealth;
    this.overview = null;
    this.live = null;
    this.overviewBackoff = INITIAL_RECONNECT_MS;
    this.liveBackoff = INITIAL_RECONNECT_MS;
    this.overviewTimer = null;
    this.liveTimer = null;
    this.channelCount = 0;
    this.pendingLiveHeader = null;
    this.stopped = false;
  }

  connect() {
    this.stopped = false;
    this.connectOverview();
    this.connectLive();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.overviewTimer);
    clearTimeout(this.liveTimer);
    this.overviewTimer = null;
    this.liveTimer = null;
    this.closeSocket("overview");
    this.closeSocket("live");
    this.setStatus("overview", "waiting");
    this.setStatus("live", "waiting");
  }

  reconnect() {
    this.disconnect();
    this.stopped = false;
    this.overviewBackoff = INITIAL_RECONNECT_MS;
    this.liveBackoff = INITIAL_RECONNECT_MS;
    this.connect();
  }

  connectOverview() {
    if (this.stopped || isOpenOrConnecting(this.overview)) {
      return;
    }

    const ws = new WebSocket(`${this.baseUrl()}/_/ws/overview`);
    this.overview = ws;
    ws.binaryType = "arraybuffer";
    this.setStatus("overview", "connecting");

    ws.onopen = () => {
      this.overviewBackoff = INITIAL_RECONNECT_MS;
      this.setStatus("overview", "live");
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.recordHealth("overview", "message");
        if (!this.channelCount) {
          return;
        }
        try {
          this.onOverviewChunks(parseOverviewPayload(event.data, this.channelCount));
        } catch (error) {
          this.recordHealth("overview", "protocol_error");
          this.setStatus("overview", "protocol error");
          console.warn(error);
        }
        return;
      }

      const message = parseJsonMessage(event.data);
      if (message) {
        this.recordHealth("overview", "message");
      }
      if (message?.status === "reset") {
        this.channelCount = Array.isArray(message.channel_mean) ? message.channel_mean.length : 0;
        this.onOverviewReset({
          channelCount: this.channelCount,
          analysisMs: Number(message.analysisMs) || 5,
          channelMean: message.channel_mean || [],
          channelStddev: message.channel_stddev || [],
        });
      }
    };

    ws.onclose = () => {
      if (this.overview === ws) {
        this.overview = null;
      }
      this.scheduleOverviewReconnect();
    };

    ws.onerror = () => {
      this.setStatus("overview", "waiting");
      ws.close();
    };
  }

  connectLive() {
    if (this.stopped || isOpenOrConnecting(this.live)) {
      return;
    }

    const ws = new WebSocket(`${this.baseUrl()}/_/ws/live_streaming`);
    this.live = ws;
    ws.binaryType = "arraybuffer";
    this.pendingLiveHeader = null;
    this.setStatus("live", "connecting");

    ws.onopen = () => {
      this.liveBackoff = INITIAL_RECONNECT_MS;
      this.setStatus("live", "live");
      this.subscribe(ws, "cl_spikes");
      this.subscribe(ws, "cl_stims");
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.recordHealth("live", "message");
        this.handleLiveBinary(event.data);
        return;
      }

      const message = parseJsonMessage(event.data);
      if (!message) {
        return;
      }
      this.recordHealth("live", "message");

      if (message.status === "reset") {
        this.pendingLiveHeader = null;
        this.onLiveReset({ fps: Number(message.frames_per_second) || null });
        return;
      }

      if (message.status === "cl_spikes" || message.status === "cl_stims") {
        this.pendingLiveHeader = message;
      }
    };

    ws.onclose = () => {
      if (this.live === ws) {
        this.live = null;
      }
      this.pendingLiveHeader = null;
      this.scheduleLiveReconnect();
    };

    ws.onerror = () => {
      this.setStatus("live", "waiting");
      ws.close();
    };
  }

  handleLiveBinary(buffer) {
    const header = this.pendingLiveHeader;
    this.pendingLiveHeader = null;
    if (!header) {
      this.recordHealth("live", "dropped_binary");
      return;
    }

    try {
      if (header.status === "cl_spikes") {
        this.onSpikes(parseSpikePayload(buffer, Number(header.spike_count) || 0));
      } else if (header.status === "cl_stims") {
        this.onStims(parseStimPayload(buffer, Number(header.stim_count) || 0));
      }
    } catch (error) {
      this.recordHealth("live", "protocol_error");
      this.setStatus("live", "protocol error");
      console.warn(error);
    }
  }

  subscribe(ws, name) {
    ws.send(JSON.stringify({ action: "subscribe", type: "data_stream", name }));
  }

  baseUrl() {
    const { host, port } = this.getConfig();
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${host}:${port}`;
  }

  scheduleOverviewReconnect() {
    if (this.stopped || this.overviewTimer) {
      return;
    }
    this.setStatus("overview", "reconnecting");
    this.recordHealth("overview", "reconnect");
    const delay = this.overviewBackoff;
    this.overviewBackoff = Math.min(MAX_RECONNECT_MS, Math.round(this.overviewBackoff * 1.4));
    this.overviewTimer = setTimeout(() => {
      this.overviewTimer = null;
      this.connectOverview();
    }, delay);
  }

  scheduleLiveReconnect() {
    if (this.stopped || this.liveTimer) {
      return;
    }
    this.setStatus("live", "reconnecting");
    this.recordHealth("live", "reconnect");
    const delay = this.liveBackoff;
    this.liveBackoff = Math.min(MAX_RECONNECT_MS, Math.round(this.liveBackoff * 1.4));
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      this.connectLive();
    }, delay);
  }

  closeSocket(kind) {
    const socket = this[kind];
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      this[kind] = null;
    }
  }

  setStatus(kind, value) {
    this.onStatus(kind, value);
  }

  recordHealth(kind, event) {
    if (this.onHealth) {
      this.onHealth(kind, event);
    }
  }
}

function isOpenOrConnecting(socket) {
  return socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
}
