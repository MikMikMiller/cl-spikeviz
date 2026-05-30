import { FLAG_HAS_SPIKE, SAMPLES_PER_SPIKE } from "./protocol.mjs";

const DEFAULT_CHANNELS = 64;
const DEFAULT_FPS = 25000;
const BATCH_FRAMES = 1250;
const CHUNKS_PER_BATCH = 10;

export class DemoStream {
  constructor({ onOverviewReset, onLiveReset, onOverviewChunks, onSpikes, onStatus, onHealth }) {
    this.onOverviewReset = onOverviewReset;
    this.onLiveReset = onLiveReset;
    this.onOverviewChunks = onOverviewChunks;
    this.onSpikes = onSpikes;
    this.onStatus = onStatus;
    this.onHealth = onHealth;
    this.timer = null;
    this.timestamp = 0n;
    this.tick = 0;
  }

  connect() {
    this.disconnect();
    this.onStatus("overview", "live");
    this.onStatus("live", "live");
    this.onOverviewReset({
      channelCount: DEFAULT_CHANNELS,
      analysisMs: 5,
      channelMean: new Array(DEFAULT_CHANNELS).fill(0),
      channelStddev: new Array(DEFAULT_CHANNELS).fill(13),
    });
    this.onLiveReset({ fps: DEFAULT_FPS });
    this.timer = setInterval(() => this.emitBatch(), 50);
  }

  disconnect() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reconnect() {
    this.connect();
  }

  emitBatch() {
    const batch = createDemoBatch({
      channelCount: DEFAULT_CHANNELS,
      fps: DEFAULT_FPS,
      timestamp: this.timestamp,
      tick: this.tick,
    });
    this.timestamp += BigInt(BATCH_FRAMES);
    this.tick += 1;
    this.onHealth?.("overview", "message");
    this.onHealth?.("live", "message");
    this.onOverviewChunks(batch.overviewChunks);
    this.onSpikes(batch.spikes);
  }
}

export function createDemoBatch({ channelCount = DEFAULT_CHANNELS, fps = DEFAULT_FPS, timestamp = 0n, tick = 0 } = {}) {
  const activeA = tick % channelCount;
  const activeB = (tick * 7 + 11) % channelCount;
  const activeC = (tick * 13 + 5) % channelCount;
  const activeChannels = [activeA, activeB, activeC];
  const overviewChunks = [];
  const spikes = [];
  const framesPerChunk = Math.floor(fps * 0.005);

  for (let chunk = 0; chunk < CHUNKS_PER_BATCH; chunk += 1) {
    const channels = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      const isActive = activeChannels.includes(channel) && (chunk + channel + tick) % 3 !== 0;
      const noise = Math.round(Math.sin((tick + chunk + channel) * 0.37) * 12);
      channels.push({
        min: -28 + noise - (isActive ? 38 : 0),
        max: 30 + noise + (isActive ? 55 : 0),
        flags: isActive ? FLAG_HAS_SPIKE : 0,
      });

      if (isActive) {
        spikes.push({
          timestamp: timestamp + BigInt(chunk * framesPerChunk + (channel % 17)),
          channel,
          samples: createDemoWaveform(channel, tick + chunk),
        });
      }
    }
    overviewChunks.push(channels);
  }

  return { overviewChunks, spikes };
}

function createDemoWaveform(channel, phase) {
  const samples = new Float32Array(SAMPLES_PER_SPIKE);
  for (let i = 0; i < SAMPLES_PER_SPIKE; i += 1) {
    const x = (i - 25) / 9;
    const negativePeak = -72 * Math.exp(-(x * x));
    const reboundX = (i - 42) / 13;
    const rebound = 28 * Math.exp(-(reboundX * reboundX));
    const ripple = Math.sin((i + phase + channel) * 0.48) * 4;
    samples[i] = negativePeak + rebound + ripple;
  }
  return samples;
}
