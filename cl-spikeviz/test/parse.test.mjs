import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDemoBatch } from "../js/demo.mjs";
import {
  SAMPLES_PER_SPIKE,
  channelPadding,
  parseOverviewPayload,
  parseSpikePayload,
  parseStimPayload,
} from "../js/protocol.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("parseSpikePayload reads uint64 timestamps, uint8 channels, padding, and 75 float32 samples", () => {
  const spikeCount = 3;
  const payload = makeSpikePayload(spikeCount);
  const spikes = parseSpikePayload(payload, spikeCount);

  assert.equal(channelPadding(spikeCount), 5);
  assert.equal(spikes.length, spikeCount);
  assert.equal(spikes[0].timestamp, 9007199254740000n);
  assert.equal(spikes[1].timestamp, 9007199254740125n);
  assert.equal(spikes[2].timestamp, 9007199254740250n);
  assert.deepEqual(spikes.map((spike) => spike.channel), [2, 17, 63]);
  assert.equal(spikes[0].samples.length, SAMPLES_PER_SPIKE);
  assert.equal(spikes[1].samples[0], 1000);
  assert.equal(spikes[2].samples[74], 2074);

  const wrongSamplesOffset = spikeCount * 8 + spikeCount;
  const wrongFirstSample = new DataView(payload).getFloat32(wrongSamplesOffset + SAMPLES_PER_SPIKE * 4, true);
  assert.notEqual(wrongFirstSample, spikes[1].samples[0]);
});

test("parseStimPayload reads timestamp and channel sections", () => {
  const stimCount = 2;
  const padding = channelPadding(stimCount);
  const buffer = new ArrayBuffer(stimCount * 8 + stimCount + padding);
  const view = new DataView(buffer);

  view.setBigUint64(0, 1234n, true);
  view.setBigUint64(8, 5678n, true);
  view.setUint8(16, 5);
  view.setUint8(17, 9);

  assert.deepEqual(parseStimPayload(buffer, stimCount), [
    { timestamp: 1234n, channel: 5 },
    { timestamp: 5678n, channel: 9 },
  ]);
});

test("parseStimPayload tolerates cl-sdk source-compatible trailing channel padding", () => {
  const stimCount = 9;
  const buffer = new ArrayBuffer(stimCount * 8 + stimCount + channelPadding(stimCount));
  const view = new DataView(buffer);

  for (let i = 0; i < stimCount; i += 1) {
    view.setBigUint64(i * 8, 7000n + BigInt(i), true);
    view.setUint8(stimCount * 8 + i, i + 10);
  }

  const stims = parseStimPayload(buffer, stimCount);
  assert.equal(stims.length, stimCount);
  assert.deepEqual(stims.at(-1), { timestamp: 7008n, channel: 18 });
});

test("parseOverviewPayload reads int16 min max flags chunks", () => {
  const channelCount = 2;
  const chunkCount = 2;
  const buffer = new ArrayBuffer(chunkCount * channelCount * 3 * 2);
  const view = new DataView(buffer);
  const values = [-10, 30, 1, -5, 20, 0, -40, 70, 3, -2, 9, 2];
  values.forEach((value, index) => view.setInt16(index * 2, value, true));

  assert.deepEqual(parseOverviewPayload(buffer, channelCount), [
    [
      { min: -10, max: 30, flags: 1 },
      { min: -5, max: 20, flags: 0 },
    ],
    [
      { min: -40, max: 70, flags: 3 },
      { min: -2, max: 9, flags: 2 },
    ],
  ]);
});

test("parse captured cl-sdk simulator fixtures", () => {
  const liveRecords = JSON.parse(readFileSync(join(__dirname, "fixtures/live_streaming.json"), "utf8"));
  const spikeRecord = liveRecords.find((record) => record.type === "binary" && record.status === "cl_spikes");
  assert.ok(spikeRecord, "expected a captured cl_spikes binary record");

  const spikeBuffer = readFixture(spikeRecord.file);
  const spikes = parseSpikePayload(spikeBuffer, spikeRecord.header.spike_count);
  assert.equal(spikes.length, spikeRecord.header.spike_count);
  assert.equal(spikes[0].samples.length, SAMPLES_PER_SPIKE);
  assert.equal(typeof spikes[0].channel, "number");
  assert.equal(typeof spikes[0].timestamp, "bigint");

  const overviewRecords = JSON.parse(readFileSync(join(__dirname, "fixtures/overview.json"), "utf8"));
  const resetRecord = overviewRecords.find((record) => record.type === "text" && record.message.status === "reset");
  const overviewRecord = overviewRecords.find((record) => record.type === "binary");
  assert.ok(resetRecord, "expected an overview reset record");
  assert.ok(overviewRecord, "expected a captured overview binary record");

  const overviewBuffer = readFixture(overviewRecord.file);
  const chunks = parseOverviewPayload(overviewBuffer, resetRecord.message.channel_mean.length);
  assert.equal(chunks.length, 10);
  assert.equal(chunks[0].length, resetRecord.message.channel_mean.length);
});

test("createDemoBatch produces parser-compatible demo events", () => {
  const batch = createDemoBatch({ channelCount: 8, fps: 25000, timestamp: 1000n, tick: 3 });

  assert.equal(batch.overviewChunks.length, 10);
  assert.equal(batch.overviewChunks[0].length, 8);
  assert.ok(batch.spikes.length > 0);
  assert.equal(typeof batch.spikes[0].timestamp, "bigint");
  assert.equal(batch.spikes[0].samples.length, SAMPLES_PER_SPIKE);
  assert.ok(batch.spikes.every((spike) => spike.channel >= 0 && spike.channel < 8));
});

function makeSpikePayload(spikeCount) {
  const padding = channelPadding(spikeCount);
  const samplesOffset = spikeCount * 8 + spikeCount + padding;
  const buffer = new ArrayBuffer(samplesOffset + spikeCount * SAMPLES_PER_SPIKE * 4);
  const view = new DataView(buffer);
  const timestamps = [9007199254740000n, 9007199254740125n, 9007199254740250n];
  const channels = [2, 17, 63];

  timestamps.forEach((timestamp, index) => view.setBigUint64(index * 8, timestamp, true));
  channels.forEach((channel, index) => view.setUint8(spikeCount * 8 + index, channel));

  for (let spike = 0; spike < spikeCount; spike += 1) {
    for (let sample = 0; sample < SAMPLES_PER_SPIKE; sample += 1) {
      view.setFloat32(samplesOffset + (spike * SAMPLES_PER_SPIKE + sample) * 4, spike * 1000 + sample, true);
    }
  }

  return buffer;
}

function readFixture(file) {
  const buffer = readFileSync(join(__dirname, "fixtures", file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
