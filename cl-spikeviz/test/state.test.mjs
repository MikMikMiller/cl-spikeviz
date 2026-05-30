import test from "node:test";
import assert from "node:assert/strict";
import { addSpikes, createState, resetStreamState, setChannelCount } from "../js/state.mjs";

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
