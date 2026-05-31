import { FLAG_HAS_SPIKE, FLAG_HAS_STIM, SAMPLES_PER_SPIKE } from "./protocol.mjs";

export const RECORDING_FORMAT = "cl-spikeviz-recording";
export const RECORDING_VERSION = 1;

export async function readRecordingFile(file) {
  const recording = parseRecordingSnapshot(await file.text(), { name: file.name });
  recording.fileName = file.name;
  recording.fileSize = file.size;
  return recording;
}

export function parseRecordingSnapshot(input, { name = "recording" } = {}) {
  const data = typeof input === "string" ? parseJson(input) : input;
  if (!isObject(data)) {
    throw new TypeError("Recording must be a JSON object.");
  }
  if (data.format !== RECORDING_FORMAT) {
    throw new Error(`Unsupported recording format: ${String(data.format || "missing")}.`);
  }
  if (data.version !== RECORDING_VERSION) {
    throw new Error(`Unsupported recording version: ${String(data.version || "missing")}.`);
  }

  const framesPerSecond = finitePositiveNumber(data.frames_per_second, "frames_per_second");
  const channelCount = integerInRange(data.channel_count, 1, 256, "channel_count");
  const durationMs = finiteNonNegativeNumber(data.duration_ms, "duration_ms");
  if (!Array.isArray(data.events)) {
    throw new TypeError("Recording events must be an array.");
  }

  const events = data.events
    .map((event, index) => normalizeEvent(event, index, { framesPerSecond, channelCount }))
    .sort((a, b) => (a.tMs - b.tMs) || (a.index - b.index))
    .map(({ index, ...event }) => event);
  const lastEventMs = events.length ? events[events.length - 1].tMs : 0;

  return {
    format: RECORDING_FORMAT,
    version: RECORDING_VERSION,
    name,
    framesPerSecond,
    channelCount,
    durationMs: Math.max(durationMs, lastEventMs),
    events,
  };
}

export function createRecordingBatch(recording, events) {
  const overview = Array.from({ length: recording.channelCount }, () => ({ min: 0, max: 0, flags: 0 }));
  const spikes = [];
  const stims = [];

  for (const event of events) {
    if (event.channel >= recording.channelCount) {
      continue;
    }

    const cell = overview[event.channel];
    if (event.type === "spike") {
      const { min, max } = waveformRange(event.samples);
      cell.min = Math.min(cell.min, min);
      cell.max = Math.max(cell.max, max);
      cell.flags |= FLAG_HAS_SPIKE;
      spikes.push({ timestamp: event.timestamp, channel: event.channel, samples: event.samples });
    } else if (event.type === "stim") {
      cell.flags |= FLAG_HAS_STIM;
      stims.push({ timestamp: event.timestamp, channel: event.channel });
    }
  }

  return {
    overviewChunks: events.length ? [overview] : [],
    spikes,
    stims,
  };
}

export class RecordingReplay {
  constructor({
    recording,
    onOverviewReset,
    onLiveReset,
    onOverviewChunks,
    onSpikes,
    onStims,
    onStatus,
    onHealth,
    onEnded,
    now = () => performance.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    this.kind = "recording";
    this.recording = recording;
    this.onOverviewReset = onOverviewReset;
    this.onLiveReset = onLiveReset;
    this.onOverviewChunks = onOverviewChunks;
    this.onSpikes = onSpikes;
    this.onStims = onStims;
    this.onStatus = onStatus;
    this.onHealth = onHealth;
    this.onEnded = onEnded;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.cursor = 0;
    this.startWallMs = 0;
    this.elapsedBeforePause = 0;
    this.paused = false;
    this.ended = false;
  }

  connect() {
    this.restart({ paused: false });
  }

  disconnect({ silent = false } = {}) {
    this.clearScheduled();
    if (!silent) {
      this.onStatus("overview", "waiting");
      this.onStatus("live", "waiting");
    }
  }

  reconnect() {
    this.restart({ paused: false });
  }

  restart({ paused = this.paused } = {}) {
    this.disconnect({ silent: true });
    this.cursor = 0;
    this.elapsedBeforePause = 0;
    this.paused = Boolean(paused);
    this.ended = false;
    this.emitReset();
    if (!this.paused) {
      this.startWallMs = this.now();
      this.schedule(0);
    }
  }

  setPaused(paused) {
    const nextPaused = Boolean(paused);
    if (this.ended && !nextPaused) {
      this.restart({ paused: false });
      return;
    }
    if (this.paused === nextPaused) {
      return;
    }

    this.paused = nextPaused;
    if (this.paused) {
      this.elapsedBeforePause = this.elapsedMs();
      this.clearScheduled();
      return;
    }

    this.startWallMs = this.now() - this.elapsedBeforePause;
    this.schedule(0);
  }

  emitReset() {
    const channelMean = new Array(this.recording.channelCount).fill(0);
    const channelStddev = new Array(this.recording.channelCount).fill(13);
    this.onStatus("overview", "live");
    this.onStatus("live", "live");
    this.onOverviewReset({
      channelCount: this.recording.channelCount,
      analysisMs: 5,
      channelMean,
      channelStddev,
    });
    this.onLiveReset({ fps: this.recording.framesPerSecond });
    this.onHealth?.("overview", "message");
    this.onHealth?.("live", "message");
  }

  emitDue() {
    this.timer = null;
    if (this.paused) {
      return;
    }

    const elapsed = this.elapsedMs();
    const due = [];
    while (this.cursor < this.recording.events.length && this.recording.events[this.cursor].tMs <= elapsed + 0.5) {
      due.push(this.recording.events[this.cursor]);
      this.cursor += 1;
    }

    if (due.length) {
      const batch = createRecordingBatch(this.recording, due);
      this.onHealth?.("overview", "message");
      this.onHealth?.("live", "message");
      if (batch.overviewChunks.length) this.onOverviewChunks(batch.overviewChunks);
      if (batch.spikes.length) this.onSpikes(batch.spikes);
      if (batch.stims.length) this.onStims(batch.stims);
    }

    if (this.cursor >= this.recording.events.length && elapsed >= this.recording.durationMs) {
      this.finish();
      return;
    }

    this.scheduleNext(elapsed);
  }

  finish() {
    this.clearScheduled();
    this.ended = true;
    this.paused = true;
    this.elapsedBeforePause = this.recording.durationMs;
    this.onStatus("overview", "ended");
    this.onStatus("live", "ended");
    this.onEnded?.();
  }

  scheduleNext(elapsed) {
    const nextEvent = this.recording.events[this.cursor];
    const nextMs = nextEvent ? nextEvent.tMs : this.recording.durationMs;
    this.schedule(Math.max(0, nextMs - elapsed));
  }

  schedule(delayMs) {
    this.clearScheduled();
    this.timer = this.setTimer(() => this.emitDue(), delayMs);
  }

  clearScheduled() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  elapsedMs() {
    return this.paused ? this.elapsedBeforePause : Math.max(0, this.now() - this.startWallMs);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Recording JSON could not be parsed: ${error.message}`);
  }
}

function normalizeEvent(event, index, { framesPerSecond, channelCount }) {
  if (!isObject(event)) {
    throw new TypeError(`Recording event ${index} must be an object.`);
  }

  const type = event.type;
  if (type !== "spike" && type !== "stim") {
    throw new Error(`Recording event ${index} has unsupported type: ${String(type)}.`);
  }

  const tMs = finiteNonNegativeNumber(event.t_ms, `events[${index}].t_ms`);
  const channel = integerInRange(event.channel, 0, channelCount - 1, `events[${index}].channel`);
  const timestamp = BigInt(Math.round((tMs / 1000) * framesPerSecond));

  if (type === "stim") {
    return { index, tMs, timestamp, type, channel };
  }

  return {
    index,
    tMs,
    timestamp,
    type,
    channel,
    samples: normalizeSamples(event.samples, index),
  };
}

function normalizeSamples(samples, index) {
  if (samples === undefined || samples === null) {
    return new Float32Array(SAMPLES_PER_SPIKE);
  }
  if (!Array.isArray(samples) && !(samples instanceof Float32Array)) {
    throw new TypeError(`Recording spike event ${index} samples must be an array.`);
  }
  if (samples.length !== SAMPLES_PER_SPIKE) {
    throw new RangeError(`Recording spike event ${index} must contain exactly ${SAMPLES_PER_SPIKE} samples.`);
  }

  const normalized = new Float32Array(SAMPLES_PER_SPIKE);
  for (let i = 0; i < SAMPLES_PER_SPIKE; i += 1) {
    const value = Number(samples[i]);
    if (!Number.isFinite(value)) {
      throw new TypeError(`Recording spike event ${index} sample ${i} must be a finite number.`);
    }
    normalized[i] = value;
  }
  return normalized;
}

function waveformRange(samples) {
  let min = 0;
  let max = 0;
  for (const sample of samples) {
    min = Math.min(min, Math.round(sample));
    max = Math.max(max, Math.round(sample));
  }
  return {
    min: clampInt16(min),
    max: clampInt16(max),
  };
}

function finitePositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive number.`);
  }
  return number;
}

function finiteNonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${name} must be a non-negative number.`);
  }
  return number;
}

function integerInRange(value, min, max, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function clampInt16(value) {
  return Math.max(-32768, Math.min(32767, value));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
