const MAX_EVENTS = 12000;
const MAX_WAVEFORMS_PER_CHANNEL = 48;

export function createState({ windowSeconds = 5 } = {}) {
  return {
    paused: false,
    windowSeconds,
    fps: null,
    channelCount: 0,
    analysisMs: 5,
    selectedChannel: null,
    hoveredChannel: null,
    autoSelectActive: true,
    firstTimestamp: null,
    latestTimestamp: null,
    spikes: [],
    stims: [],
    waveformsByChannel: new Map(),
    channelActivity: [],
    channelHasStim: [],
    channelSpikeCounts: [],
    channelLastSpikeSeconds: [],
    health: createHealth(),
    totals: {
      spikes: 0,
      stims: 0,
    },
    connection: {
      overview: "waiting",
      live: "waiting",
      message: "waiting for simulator",
    },
  };
}

export function recordHealth(state, kind, event) {
  const now = Date.now();

  if (kind === "overview" && event === "message") {
    state.health.overviewMessages += 1;
    state.health.overviewLastAt = now;
    return;
  }

  if (kind === "live" && event === "message") {
    state.health.liveMessages += 1;
    state.health.liveLastAt = now;
    return;
  }

  if (event === "reconnect") {
    state.health.reconnects += 1;
    return;
  }

  if (event === "protocol_error") {
    state.health.protocolErrors += 1;
    return;
  }

  if (event === "dropped_binary") {
    state.health.droppedBinaryFrames += 1;
  }
}

export function resetHealth(state) {
  state.health = createHealth();
}

export function resetStreamState(state, { keepSelection = false } = {}) {
  state.firstTimestamp = null;
  state.latestTimestamp = null;
  state.spikes = [];
  state.stims = [];
  state.waveformsByChannel.clear();
  state.channelActivity = new Array(state.channelCount).fill(0);
  state.channelHasStim = new Array(state.channelCount).fill(false);
  state.channelSpikeCounts = new Array(state.channelCount).fill(0);
  state.channelLastSpikeSeconds = new Array(state.channelCount).fill(null);
  state.totals.spikes = 0;
  state.totals.stims = 0;
  if (!keepSelection) {
    state.selectedChannel = null;
  }
}

function createHealth() {
  return {
    overviewMessages: 0,
    liveMessages: 0,
    overviewLastAt: null,
    liveLastAt: null,
    reconnects: 0,
    protocolErrors: 0,
    droppedBinaryFrames: 0,
    startedAt: Date.now(),
  };
}

export function setChannelCount(state, channelCount) {
  const nextCount = Math.max(0, Math.min(256, Number(channelCount) || 0));
  if (state.channelCount === nextCount) {
    return;
  }

  state.channelCount = nextCount;
  state.channelActivity = new Array(nextCount).fill(0);
  state.channelHasStim = new Array(nextCount).fill(false);
  state.channelSpikeCounts = new Array(nextCount).fill(0);
  state.channelLastSpikeSeconds = new Array(nextCount).fill(null);
  if (state.selectedChannel !== null && state.selectedChannel >= nextCount) {
    state.selectedChannel = null;
  }
}

export function timestampSeconds(state, timestamp) {
  if (!state.fps) {
    return 0;
  }

  if (state.firstTimestamp === null) {
    state.firstTimestamp = timestamp;
  }

  return Number(timestamp - state.firstTimestamp) / state.fps;
}

export function addSpikes(state, spikes) {
  if (state.paused || !spikes.length) {
    return;
  }

  let strongestChannel = null;
  let strongestActivity = -1;

  for (const spike of spikes) {
    const seconds = timestampSeconds(state, spike.timestamp);
    state.latestTimestamp = spike.timestamp;
    state.spikes.push({ seconds, channel: spike.channel });
    state.totals.spikes += 1;

    if (spike.channel < state.channelCount) {
      const nextCount = (state.channelSpikeCounts[spike.channel] || 0) + 1;
      state.channelSpikeCounts[spike.channel] = nextCount;
      state.channelLastSpikeSeconds[spike.channel] = seconds;
      if (nextCount > strongestActivity) {
        strongestActivity = nextCount;
        strongestChannel = spike.channel;
      }

      const existing = state.waveformsByChannel.get(spike.channel) || [];
      existing.push({ seconds, samples: spike.samples });
      if (existing.length > MAX_WAVEFORMS_PER_CHANNEL) {
        existing.splice(0, existing.length - MAX_WAVEFORMS_PER_CHANNEL);
      }
      state.waveformsByChannel.set(spike.channel, existing);
    }
  }

  if (state.autoSelectActive && strongestChannel !== null) {
    state.selectedChannel = strongestChannel;
  }

  trimEvents(state);
}

export function addStims(state, stims) {
  if (state.paused || !stims.length) {
    return;
  }

  for (const stim of stims) {
    const seconds = timestampSeconds(state, stim.timestamp);
    state.latestTimestamp = stim.timestamp;
    state.stims.push({ seconds, channel: stim.channel });
    state.totals.stims += 1;
  }

  trimEvents(state);
}

export function addOverviewChunks(state, chunks) {
  if (state.paused || !chunks.length || !state.channelCount) {
    return;
  }

  const decay = 0.72;
  for (let channel = 0; channel < state.channelCount; channel += 1) {
    state.channelActivity[channel] = (state.channelActivity[channel] || 0) * decay;
    state.channelHasStim[channel] = false;
  }

  for (const chunk of chunks) {
    for (let channel = 0; channel < chunk.length; channel += 1) {
      const cell = chunk[channel];
      const spread = Math.min(1, Math.abs(cell.max - cell.min) / 900);
      const spikeBoost = (cell.flags & 1) ? 0.75 : 0;
      state.channelActivity[channel] = Math.min(1, Math.max(state.channelActivity[channel] || 0, spread + spikeBoost));
      if (cell.flags & 2) {
        state.channelHasStim[channel] = true;
      }
    }
  }
}

export function rollingWindowEnd(state) {
  if (!state.spikes.length && !state.stims.length) {
    return state.windowSeconds;
  }

  const spikeEnd = state.spikes.length ? state.spikes[state.spikes.length - 1].seconds : 0;
  const stimEnd = state.stims.length ? state.stims[state.stims.length - 1].seconds : 0;
  return Math.max(state.windowSeconds, spikeEnd, stimEnd);
}

export function getChannelWindowMetrics(state) {
  const channelCount = state.channelCount || 0;
  const spikeCounts = new Array(channelCount).fill(0);
  const spikeRates = new Array(channelCount).fill(0);
  const lastEvents = new Array(channelCount).fill(null);
  const end = rollingWindowEnd(state);
  const start = end - state.windowSeconds;

  for (const spike of state.spikes) {
    if (!isChannelEventInWindow(spike, state, start)) {
      continue;
    }

    spikeCounts[spike.channel] += 1;
    setLastEvent(lastEvents, spike.channel, "spike", spike.seconds);
  }

  for (const stim of state.stims) {
    if (!isChannelEventInWindow(stim, state, start)) {
      continue;
    }

    setLastEvent(lastEvents, stim.channel, "stim", stim.seconds);
  }

  const windowSeconds = Math.max(0.001, state.windowSeconds);
  let maxSpikeRate = 0;
  let maxSpikeCount = 0;
  for (let channel = 0; channel < channelCount; channel += 1) {
    spikeRates[channel] = spikeCounts[channel] / windowSeconds;
    maxSpikeRate = Math.max(maxSpikeRate, spikeRates[channel]);
    maxSpikeCount = Math.max(maxSpikeCount, spikeCounts[channel]);
  }

  return {
    start,
    end,
    spikeCounts,
    spikeRates,
    maxSpikeRate,
    maxSpikeCount,
    lastEvents,
  };
}

export function getChannelStats(state, channel) {
  if (channel === null || channel < 0 || channel >= state.channelCount) {
    return null;
  }

  const waveforms = state.waveformsByChannel.get(channel) || [];
  const metrics = getChannelWindowMetrics(state);
  const lastEvent = metrics.lastEvents[channel];
  return {
    channel,
    activity: state.channelActivity[channel] || 0,
    hasStim: Boolean(state.channelHasStim[channel]),
    spikeCount: state.channelSpikeCounts[channel] || 0,
    windowSpikeCount: metrics.spikeCounts[channel] || 0,
    spikeRateHz: metrics.spikeRates[channel] || 0,
    lastEventType: lastEvent?.type || null,
    lastEventSeconds: lastEvent?.seconds ?? null,
    lastSpikeSeconds: state.channelLastSpikeSeconds[channel],
    waveformCount: waveforms.length,
  };
}

function isChannelEventInWindow(event, state, start) {
  return event.seconds >= start
    && event.channel >= 0
    && event.channel < state.channelCount;
}

function setLastEvent(lastEvents, channel, type, seconds) {
  const existing = lastEvents[channel];
  if (!existing || seconds >= existing.seconds) {
    lastEvents[channel] = { type, seconds };
  }
}

function trimEvents(state) {
  const end = rollingWindowEnd(state);
  const cutoff = end - state.windowSeconds;

  while (state.spikes.length > MAX_EVENTS || (state.spikes.length && state.spikes[0].seconds < cutoff)) {
    state.spikes.shift();
  }

  while (state.stims.length > MAX_EVENTS || (state.stims.length && state.stims[0].seconds < cutoff)) {
    state.stims.shift();
  }
}
