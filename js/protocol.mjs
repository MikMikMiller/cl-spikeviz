export const SAMPLES_PER_SPIKE = 75;
export const FLAG_HAS_SPIKE = 1 << 0;
export const FLAG_HAS_STIM = 1 << 1;

const TIMESTAMP_BYTES = 8;
const CHANNEL_BYTES = 1;
const FLOAT32_BYTES = 4;

export function channelPadding(count) {
  return (TIMESTAMP_BYTES - ((count * CHANNEL_BYTES) & (TIMESTAMP_BYTES - 1))) & (TIMESTAMP_BYTES - 1);
}

export function parseJsonMessage(data) {
  if (typeof data !== "string") {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function parseSpikePayload(buffer, spikeCount) {
  if (!buffer || spikeCount <= 0) {
    return [];
  }

  const minimumBytes = spikeCount * TIMESTAMP_BYTES + spikeCount * CHANNEL_BYTES + channelPadding(spikeCount);
  const samplesOffset = minimumBytes;
  const expectedBytes = samplesOffset + spikeCount * SAMPLES_PER_SPIKE * FLOAT32_BYTES;

  if (buffer.byteLength < expectedBytes) {
    throw new RangeError(`cl_spikes payload is ${buffer.byteLength} bytes, expected at least ${expectedBytes}`);
  }

  const view = new DataView(buffer);
  const spikes = new Array(spikeCount);
  const channelsOffset = spikeCount * TIMESTAMP_BYTES;

  for (let i = 0; i < spikeCount; i += 1) {
    const timestamp = view.getBigUint64(i * TIMESTAMP_BYTES, true);
    const channel = view.getUint8(channelsOffset + i);
    const sampleStart = samplesOffset + i * SAMPLES_PER_SPIKE * FLOAT32_BYTES;
    const samples = new Float32Array(buffer, sampleStart, SAMPLES_PER_SPIKE);

    spikes[i] = {
      timestamp,
      channel,
      samples: new Float32Array(samples),
    };
  }

  return spikes;
}

export function parseStimPayload(buffer, stimCount) {
  if (!buffer || stimCount <= 0) {
    return [];
  }

  const expectedBytes = stimCount * TIMESTAMP_BYTES + stimCount * CHANNEL_BYTES;
  if (buffer.byteLength < expectedBytes) {
    throw new RangeError(`cl_stims payload is ${buffer.byteLength} bytes, expected at least ${expectedBytes}`);
  }

  const view = new DataView(buffer);
  const channelsOffset = stimCount * TIMESTAMP_BYTES;
  const stims = new Array(stimCount);

  for (let i = 0; i < stimCount; i += 1) {
    stims[i] = {
      timestamp: view.getBigUint64(i * TIMESTAMP_BYTES, true),
      channel: view.getUint8(channelsOffset + i),
    };
  }

  return stims;
}

export function parseOverviewPayload(buffer, channelCount) {
  if (!buffer || channelCount <= 0) {
    return [];
  }

  const valuesPerChannel = 3;
  const bytesPerValue = 2;
  const bytesPerChunk = channelCount * valuesPerChannel * bytesPerValue;

  if (buffer.byteLength % bytesPerChunk !== 0) {
    throw new RangeError(`overview payload size ${buffer.byteLength} is not divisible by chunk size ${bytesPerChunk}`);
  }

  const view = new DataView(buffer);
  const chunkCount = buffer.byteLength / bytesPerChunk;
  const chunks = new Array(chunkCount);
  let offset = 0;

  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const channels = new Array(channelCount);
    for (let channel = 0; channel < channelCount; channel += 1) {
      channels[channel] = {
        min: view.getInt16(offset, true),
        max: view.getInt16(offset + 2, true),
        flags: view.getInt16(offset + 4, true),
      };
      offset += 6;
    }
    chunks[chunk] = channels;
  }

  return chunks;
}
