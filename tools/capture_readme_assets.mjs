import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import gifenc from "gifenc";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const { GIFEncoder, applyPalette, quantize } = gifenc;

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ASSETS = join(ROOT, "assets");
const VIEWPORT = { width: 1280, height: 720 };
const STREAM_SOURCE = process.env.CAPTURE_SOURCE === "live" ? "live" : "demo";
const STREAM_HOST = process.env.CAPTURE_HOST || "127.0.0.1";
const STREAM_PORT = process.env.CAPTURE_PORT || "1025";
const STREAM_WARMUP_MS = 10_000;
const GIF_FRAMES = 54;
const GIF_INTERVAL_MS = 140;
const STREAM_WINDOW_SECONDS = 1.5;
const GIF_COLORS = 256;
const GIF_PALETTE_SAMPLE_STRIDE = 4;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const cleanPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      const localPath = join(ROOT, cleanPath === "/" ? "index.html" : cleanPath);

      if (!localPath.startsWith(ROOT) || !existsSync(localPath)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }

      const body = await readFile(localPath);
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-type": MIME_TYPES[extname(localPath)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to start asset capture server");
      }
      resolveServer({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  return { data: png.data, width: png.width, height: png.height };
}

async function capturePngFrame(page) {
  const buffer = await page.screenshot({ type: "png" });
  return decodePng(buffer);
}

function encodeGif(frames, outPath, { delay = 140 } = {}) {
  if (frames.length === 0) {
    throw new Error(`No frames captured for ${outPath}`);
  }

  const palette = createGlobalPalette(frames);
  const gif = GIFEncoder();
  for (const [index, frame] of frames.entries()) {
    const indexed = applyPalette(frame.data, palette, "rgb565");
    gif.writeFrame(indexed, frame.width, frame.height, {
      delay,
      palette: index === 0 ? palette : undefined,
      repeat: index === 0 ? 0 : undefined,
    });
  }
  gif.finish();
  writeFileSync(outPath, gif.bytes());
}

function createGlobalPalette(frames) {
  const sampledPixels = frames.reduce((total, frame) => (
    total + Math.ceil((frame.width * frame.height) / GIF_PALETTE_SAMPLE_STRIDE)
  ), 0);
  const sample = new Uint8Array(sampledPixels * 4);
  let offset = 0;

  for (const frame of frames) {
    for (let pixel = 0; pixel < frame.width * frame.height; pixel += GIF_PALETTE_SAMPLE_STRIDE) {
      const source = pixel * 4;
      sample[offset] = frame.data[source];
      sample[offset + 1] = frame.data[source + 1];
      sample[offset + 2] = frame.data[source + 2];
      sample[offset + 3] = frame.data[source + 3];
      offset += 4;
    }
  }

  return quantize(sample.subarray(0, offset), GIF_COLORS, { format: "rgb565" });
}

async function saveJpeg(page, outPath) {
  await page.screenshot({ path: outPath, type: "jpeg", quality: 82 });
}

async function waitForApp(page) {
  await page.waitForSelector("#status-text", { state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
}

async function captureTimedGif(page, outPath, { frames = 14, interval = 140, beforeFrame } = {}) {
  const captured = [];
  for (let frame = 0; frame < frames; frame += 1) {
    if (beforeFrame) {
      await beforeFrame(frame);
    }
    await page.waitForTimeout(interval);
    captured.push(await capturePngFrame(page));
  }
  encodeGif(captured, outPath, { delay: interval });
}

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  return page;
}

function streamUrl(baseUrl, view = "2d") {
  const params = new URLSearchParams({
    host: STREAM_HOST,
    port: STREAM_PORT,
    window: String(STREAM_WINDOW_SECONDS),
  });
  if (STREAM_SOURCE === "demo") {
    params.set("demo", "1");
  }
  if (view !== "2d") {
    params.set("view", view);
  }
  return `${baseUrl}/?${params.toString()}`;
}

async function warmupStream(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector("#status-text")?.textContent ?? "";
    return status.startsWith("live");
  }, undefined, { timeout: 10000 });
  await page.waitForFunction(() => {
    const stats = document.querySelector("#stats-text")?.textContent ?? "";
    return !stats.startsWith("0 spk");
  }, undefined, { timeout: 15000 });
  await page.waitForTimeout(STREAM_WARMUP_MS);
  await page.locator("#auto-btn").click();
  await page.waitForTimeout(400);
}

async function captureDashboard(browser, baseUrl) {
  const page = await openPage(browser, streamUrl(baseUrl));
  const gifPath = join(ASSETS, "chrome-dashboard-demo.gif");
  const jpgPath = join(ASSETS, "chrome-dashboard-demo.jpg");

  await warmupStream(page);
  await captureTimedGif(page, gifPath, {
    frames: GIF_FRAMES,
    interval: GIF_INTERVAL_MS,
    beforeFrame: (frame) => selectChannelSequence(page, frame, [4, 18, 42]),
  });
  await saveJpeg(page, jpgPath);
  await page.close();
}

async function capture3d(browser, baseUrl) {
  const page = await openPage(browser, streamUrl(baseUrl, "3d"));
  const gifPath = join(ASSETS, "chrome-3d-demo.gif");
  const jpgPath = join(ASSETS, "chrome-3d-demo.jpg");

  await warmupStream(page);
  await captureTimedGif(page, gifPath, {
    frames: GIF_FRAMES,
    interval: GIF_INTERVAL_MS,
    beforeFrame: (frame) => clickIsoSequence(page, frame, [5, 27, 48]),
  });
  await saveJpeg(page, jpgPath);
  await page.close();
}

async function captureGrid(browser, baseUrl) {
  const page = await openPage(browser, streamUrl(baseUrl, "grid"));
  const gifPath = join(ASSETS, "chrome-grid-demo.gif");
  const jpgPath = join(ASSETS, "chrome-grid-demo.jpg");

  await warmupStream(page);
  await captureTimedGif(page, gifPath, {
    frames: GIF_FRAMES,
    interval: GIF_INTERVAL_MS,
    beforeFrame: (frame) => clickGridSequence(page, frame, [0, 21, 45]),
  });
  await saveJpeg(page, jpgPath);
  await page.close();
}

async function captureSplit(browser, baseUrl) {
  const page = await openPage(browser, streamUrl(baseUrl, "split"));
  const gifPath = join(ASSETS, "chrome-split-demo.gif");
  const jpgPath = join(ASSETS, "chrome-split-demo.jpg");

  await warmupStream(page);
  await captureTimedGif(page, gifPath, {
    frames: GIF_FRAMES,
    interval: GIF_INTERVAL_MS,
    beforeFrame: (frame) => clickIsoSequence(page, frame, [9, 36, 54]),
  });
  await saveJpeg(page, jpgPath);
  await page.close();
}

async function main() {
  const { server, baseUrl } = await startServer();
  const browser = await chromium.launch();
  try {
    await captureDashboard(browser, baseUrl);
    await captureGrid(browser, baseUrl);
    await capture3d(browser, baseUrl);
    await captureSplit(browser, baseUrl);
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function selectChannelSequence(page, frame, channels) {
  if (frame % 18 !== 0) {
    return;
  }
  await page.locator("#channel-input").fill(String(channels[(frame / 18) % channels.length]));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
}

async function clickGridSequence(page, frame, channels) {
  if (frame % 18 !== 0) {
    return;
  }
  const target = await gridTarget(page, channels[(frame / 18) % channels.length]);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(80);
}

async function clickIsoSequence(page, frame, channels) {
  if (frame % 18 !== 0) {
    return;
  }
  const target = await isoTarget(page, channels[(frame / 18) % channels.length]);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(80);
}

async function gridTarget(page, channel) {
  return page.locator("#electrode-grid-canvas").evaluate((node, ch) => {
    const rect = node.getBoundingClientRect();
    const gap = 6;
    const pad = 22;
    const footer = 42;
    const cols = 8;
    const rows = 8;
    const cell = Math.max(8, Math.floor(Math.min(
      (rect.width - pad * 2 - gap * (cols - 1)) / cols,
      (rect.height - pad * 2 - footer - gap * (rows - 1)) / rows,
    )));
    const gridW = cols * cell + (cols - 1) * gap;
    const gridH = rows * cell + (rows - 1) * gap;
    const ox = (rect.width - gridW) / 2;
    const oy = Math.max(pad, (rect.height - footer - gridH) / 2);
    const col = ch % cols;
    const row = Math.floor(ch / cols);
    return {
      x: rect.left + ox + col * (cell + gap) + cell / 2,
      y: rect.top + oy + row * (cell + gap) + cell / 2,
    };
  }, channel);
}

async function isoTarget(page, channel) {
  return page.locator("#iso-canvas").evaluate((node, ch) => {
    const grid = 8;
    const rect = node.getBoundingClientRect();
    const col = ch % grid;
    const row = Math.floor(ch / grid);
    const tw = Math.min(rect.width * 0.74 / grid, 86);
    const th = tw * 0.52;
    const baseZ = 6;
    const maxZ = tw * 1.5;
    const ox = rect.width / 2;
    const oy = rect.height / 2 - (grid * th) / 2 + th * 1.2;
    return {
      x: rect.left + ox + ((col + 0.5) - (row + 0.5)) * (tw / 2),
      y: rect.top + oy + ((col + 0.5) + (row + 0.5)) * (th / 2) - (baseZ + maxZ * 0.5),
    };
  }, channel);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
