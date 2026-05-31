import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addOverviewChunks,
  addSpikes,
  addStims,
  createState,
  resetStreamState,
  setChannelCount,
} from "../js/state.mjs";
import { FLAG_HAS_SPIKE, FLAG_HAS_STIM, SAMPLES_PER_SPIKE } from "../js/protocol.mjs";
import { createRecordingBatch, parseRecordingSnapshot } from "../js/recording.mjs";

test("parseRecordingSnapshot validates and normalizes snapshot replay events", () => {
  const recording = parseRecordingSnapshot(JSON.stringify({
    format: "cl-spikeviz-recording",
    version: 1,
    frames_per_second: 25000,
    channel_count: 4,
    duration_ms: 20,
    events: [
      { t_ms: 4, type: "stim", channel: 2 },
      {
        t_ms: 0,
        type: "spike",
        channel: 1,
        samples: Array.from({ length: SAMPLES_PER_SPIKE }, (_, index) => index - 37),
      },
    ],
  }));

  assert.equal(recording.framesPerSecond, 25000);
  assert.equal(recording.channelCount, 4);
  assert.equal(recording.durationMs, 20);
  assert.deepEqual(recording.events.map((event) => event.type), ["spike", "stim"]);
  assert.equal(recording.events[0].timestamp, 0n);
  assert.equal(recording.events[1].timestamp, 100n);
  assert.equal(recording.events[0].samples.length, SAMPLES_PER_SPIKE);
  assert.ok(recording.events[0].samples instanceof Float32Array);
});

test("parseRecordingSnapshot rejects unsupported or malformed recording files", () => {
  assert.throws(
    () => parseRecordingSnapshot({ format: "cl-sdk-hdf5", version: 1, events: [] }),
    /unsupported recording format/i,
  );

  assert.throws(
    () => parseRecordingSnapshot({
      format: "cl-spikeviz-recording",
      version: 1,
      frames_per_second: 25000,
      channel_count: 4,
      duration_ms: 1,
      events: [{ t_ms: 0, type: "spike", channel: 5 }],
    }),
    /channel/i,
  );

  assert.throws(
    () => parseRecordingSnapshot({
      format: "cl-spikeviz-recording",
      version: 1,
      frames_per_second: 25000,
      channel_count: 4,
      duration_ms: 1,
      events: [{ t_ms: 0, type: "spike", channel: 2, samples: [1, 2, 3] }],
    }),
    /75 samples/i,
  );
});

test("recording batches flow into the same state handlers as demo and live streams", () => {
  const recording = parseRecordingSnapshot({
    format: "cl-spikeviz-recording",
    version: 1,
    frames_per_second: 25000,
    channel_count: 4,
    duration_ms: 20,
    events: [
      {
        t_ms: 0,
        type: "spike",
        channel: 1,
        samples: Array.from({ length: SAMPLES_PER_SPIKE }, (_, index) => -30 + index),
      },
      { t_ms: 1, type: "stim", channel: 2 },
    ],
  });
  const state = createState({ windowSeconds: 5 });

  setChannelCount(state, recording.channelCount);
  state.fps = recording.framesPerSecond;
  resetStreamState(state, { keepSelection: true });

  const batch = createRecordingBatch(recording, recording.events);
  addOverviewChunks(state, batch.overviewChunks);
  addSpikes(state, batch.spikes);
  addStims(state, batch.stims);

  assert.equal(state.totals.spikes, 1);
  assert.equal(state.totals.stims, 1);
  assert.equal(state.channelSpikeCounts[1], 1);
  assert.equal(state.channelHasStim[2], true);
  assert.ok(state.channelActivity[1] > 0);
  assert.equal(batch.overviewChunks[0][1].flags & FLAG_HAS_SPIKE, FLAG_HAS_SPIKE);
  assert.equal(batch.overviewChunks[0][2].flags & FLAG_HAS_STIM, FLAG_HAS_STIM);
});

test("committed sample recording uses the supported snapshot schema", () => {
  const sample = parseRecordingSnapshot(readFileSync(new URL("../assets/sample-recording.json", import.meta.url), "utf8"));
  const channelsWithEvents = new Set(sample.events.map((event) => event.channel));
  const typeCounts = sample.events.reduce((counts, event) => {
    counts[event.type] = (counts[event.type] || 0) + 1;
    return counts;
  }, {});

  assert.equal(sample.channelCount, 64);
  assert.ok(sample.durationMs >= 30_000);
  assert.ok(sample.events.length >= 3_000);
  assert.ok(channelsWithEvents.size >= 48);
  assert.ok(typeCounts.spike > 0);
  assert.ok(typeCounts.stim > 0);
  assert.ok(sample.events.every((event) => event.timestamp >= 0n));
});
