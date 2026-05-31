import test from "node:test";
import assert from "node:assert/strict";
import {
  addSpikes,
  addStims,
  createState,
  getChannelStats,
  getChannelWindowMetrics,
  resetStreamState,
  setChannelCount,
} from "../js/state.mjs";

test("auto channel selection uses current spike batch counts, not stale activity", () => {
  const state = createState({ windowSeconds: 5 });
  setChannelCount(state, 4);
  state.fps = 1000;
  state.autoSelectActive = true;
  state.channelActivity = [0.18, 0.9, 0.03, 0.2];

  addSpikes(state, [
    { timestamp: 1000n, channel: 0, samples: new Float32Array(75) },
    { timestamp: 2000n, channel: 2, samples: new Float32Array(75) },
    { timestamp: 3000n, channel: 2, samples: new Float32Array(75) },
  ]);

  assert.equal(state.selectedChannel, 2);
  assert.equal(state.channelSpikeCounts[2], 2);
});

test("paused stream ignores incoming spikes and does not update selection", () => {
  const state = createState({ windowSeconds: 5 });
  setChannelCount(state, 4);
  state.fps = 1000;
  state.autoSelectActive = true;
  state.paused = true;
  state.selectedChannel = 0;
  addSpikes(state, [
    { timestamp: 1000n, channel: 3, samples: new Float32Array(75) },
  ]);

  assert.equal(state.channelSpikeCounts[3], 0);
  assert.equal(state.selectedChannel, 0);
});

test("channel resets clear spike counters and channel selection when requested", () => {
  const state = createState({ windowSeconds: 5 });
  setChannelCount(state, 2);
  state.fps = 1000;
  state.totals.spikes = 4;
  state.channelSpikeCounts = [2, 2];
  state.channelLastSpikeSeconds = [0.5, 1.5];
  state.selectedChannel = 1;

  resetStreamState(state);
  assert.equal(state.totals.spikes, 0);
  assert.equal(state.channelSpikeCounts[1], 0);
  assert.equal(state.channelLastSpikeSeconds[1], null);
});

test("channel window metrics report rolling spike rate and latest event type", () => {
  const state = createState({ windowSeconds: 2 });
  setChannelCount(state, 3);
  state.fps = 1000;

  addSpikes(state, [
    { timestamp: 0n, channel: 1, samples: new Float32Array(75) },
    { timestamp: 1000n, channel: 1, samples: new Float32Array(75) },
    { timestamp: 3000n, channel: 2, samples: new Float32Array(75) },
    { timestamp: 3500n, channel: 2, samples: new Float32Array(75) },
  ]);
  addStims(state, [
    { timestamp: 3600n, channel: 2 },
  ]);

  const metrics = getChannelWindowMetrics(state);
  assert.equal(metrics.spikeCounts[1], 0);
  assert.equal(metrics.spikeCounts[2], 2);
  assert.equal(metrics.spikeRates[2], 1);
  assert.equal(metrics.lastEvents[2].type, "stim");

  const stats = getChannelStats(state, 2);
  assert.equal(stats.windowSpikeCount, 2);
  assert.equal(stats.spikeRateHz, 1);
  assert.equal(stats.lastEventType, "stim");
  assert.equal(stats.lastEventSeconds, 3.6);
});
