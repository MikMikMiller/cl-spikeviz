// NOTE: Only change from original repo:
// 1. Constructor now stores onStims (was missing — stims never reached the UI).
// 2. emitBatch advances by real elapsed time for accurate rolling window.
// 3. Occasional stim events so stim rings are visible in demo mode.

import { FLAG_HAS_SPIKE, FLAG_HAS_STIM, SAMPLES_PER_SPIKE } from "./protocol.mjs";

const DEFAULT_CHANNELS  = 64;
const DEFAULT_FPS       = 25000;
const BATCH_FRAMES      = 1250;
const CHUNKS_PER_BATCH  = 10;

export class DemoStream {
  constructor({ onOverviewReset, onLiveReset, onOverviewChunks, onSpikes, onStims, onStatus, onHealth }) {
    this.onOverviewReset  = onOverviewReset;
    this.onLiveReset      = onLiveReset;
    this.onOverviewChunks = onOverviewChunks;
    this.onSpikes         = onSpikes;
    this.onStims          = onStims;   // ← was missing in original
    this.onStatus         = onStatus;
    this.onHealth         = onHealth;
    this.timer     = null;
    this.timestamp = 0n;
    this.tick      = 0;
    this.lastEmit  = null;
  }

  connect() {
    this.disconnect();
    this.onStatus("overview", "live");
    this.onStatus("live", "live");
    this.onOverviewReset({
      channelCount: DEFAULT_CHANNELS,
      analysisMs: 5,
      channelMean:   new Array(DEFAULT_CHANNELS).fill(0),
      channelStddev: new Array(DEFAULT_CHANNELS).fill(13),
    });
    this.onLiveReset({ fps: DEFAULT_FPS });
    this.timer = setInterval(() => this.emitBatch(), 50);
  }

  disconnect() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  reconnect() { this.connect(); }

  emitBatch() {
    // Advance by real elapsed time so rolling window is accurate whether the
    // tab is foregrounded (50 ms) or throttled in the background (~1 s).
    const now = performance.now();
    const dtMs = this.lastEmit ? Math.min(1200, Math.max(20, now - this.lastEmit)) : 50;
    this.lastEmit = now;
    const spanFrames = Math.max(1, Math.round((dtMs / 1000) * DEFAULT_FPS));

    const batch = createDemoBatch({
      channelCount: DEFAULT_CHANNELS,
      fps: DEFAULT_FPS,
      timestamp: this.timestamp,
      tick: this.tick,
      spanFrames,
    });
    this.timestamp += BigInt(spanFrames);
    this.tick += 1;

    this.onHealth?.("overview", "message");
    this.onHealth?.("live",     "message");
    this.onOverviewChunks(batch.overviewChunks);
    this.onSpikes(batch.spikes);
    if (batch.stims.length) this.onStims?.(batch.stims);
  }
}

export function createDemoBatch({
  channelCount = DEFAULT_CHANNELS,
  fps          = DEFAULT_FPS,
  timestamp    = 0n,
  tick         = 0,
  spanFrames   = BATCH_FRAMES,
} = {}) {
  const activeA = tick % channelCount;
  const activeB = (tick * 7 + 11) % channelCount;
  const activeC = (tick * 13 + 5) % channelCount;
  const activeChannels = [activeA, activeB, activeC];

  const overviewChunks = [];
  const spikes = [];
  const stims  = [];
  const framesPerChunk = spanFrames / CHUNKS_PER_BATCH;
  const stimChannel = (tick % 9 === 0) ? (tick * 5 + 3) % channelCount : null;

  for (let chunk = 0; chunk < CHUNKS_PER_BATCH; chunk += 1) {
    const channels = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      const isActive = activeChannels.includes(channel) && (chunk + channel + tick) % 3 !== 0;
      const isStim   = channel === stimChannel && chunk === 0;
      const noise    = Math.round(Math.sin((tick + chunk + channel) * 0.37) * 12);

      channels.push({
        min:   -28 + noise - (isActive ? 38 : 0),
        max:    30 + noise + (isActive ? 55 : 0),
        flags: (isActive ? FLAG_HAS_SPIKE : 0) | (isStim ? FLAG_HAS_STIM : 0),
      });

      if (isStim) {
        stims.push({ timestamp: timestamp + BigInt(Math.round(chunk * framesPerChunk)), channel });
      }
      if (isActive) {
        spikes.push({
          timestamp: timestamp + BigInt(Math.round(chunk * framesPerChunk + (channel % 17))),
          channel,
          samples: createDemoWaveform(channel, tick + chunk),
        });
      }
    }
    overviewChunks.push(channels);
  }

  return { overviewChunks, spikes, stims };
}

function createDemoWaveform(channel, phase) {
  const samples = new Float32Array(SAMPLES_PER_SPIKE);
  for (let i = 0; i < SAMPLES_PER_SPIKE; i += 1) {
    const x  = (i - 25) / 9;
    const nx = (i - 42) / 13;
    samples[i] =
      -72 * Math.exp(-(x  * x))  +   // negative spike peak
       28 * Math.exp(-(nx * nx)) +   // rebound
       Math.sin((i + phase + channel) * 0.48) * 4; // noise
  }
  return samples;
}
