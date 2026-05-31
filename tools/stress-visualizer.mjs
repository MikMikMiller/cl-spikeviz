import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [name, rawValue] = arg.replace(/^--/, "").split("=");
  return [name, rawValue === undefined ? "true" : rawValue];
}));

const durationSeconds = Number.parseInt(args.get("seconds"), 10) || Number.parseInt(args.get("minutes"), 10) * 60 || 600;
const sampleInterval = Number.parseInt(args.get("interval"), 10) || 1000;
const urlPath = args.get("url") || "/?demo=1&view=split&compact=1";
const headful = args.get("headful") === "true";

const root = normalize(new URL("../", import.meta.url).pathname.replace(/\/$/, ""));
const mimeTypes = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
]);

const noiseMessages = [
  "GL Driver Message",
  "CONTEXT_LOST_WEBGL",
];

const stats = {
  samples: 0,
  fpsMin: Number.POSITIVE_INFINITY,
  fpsMax: 0,
  fpsSum: 0,
  heapMin: Number.POSITIVE_INFINITY,
  heapMax: 0,
};

await runStress().catch((error) => {
  console.error(`[stress] failed: ${error.message}`);
  process.exit(1);
});

async function runStress() {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
    throw new Error("duration must be at least 10 seconds");
  }
  if (sampleInterval < 250) {
    throw new Error("interval must be >= 250ms");
  }

  const { server, url: baseUrl } = await startServer();
  const browser = await chromium.launch({ headless: !headful });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && !isNoiseMessage(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}${urlPath}`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => document.body.classList.contains("view-split"), { timeout: 10_000 });

    const isoCanvas = await page.waitForSelector("#iso-canvas", { state: "visible", timeout: 15_000 });
    const isoStatusText = await page.waitForSelector("#iso-status", { timeout: 10_000 });
    const loadedUrl = new URL(page.url());
    if (loadedUrl.searchParams.get("demo") !== "1") {
      throw new Error("stress check requires demo mode to avoid simulator dependency");
    }

    await page.waitForFunction(() => document.querySelector("#iso-status")?.textContent?.trim().length > 0, { timeout: 15_000 });

    const viewBox = await isoCanvas.boundingBox();
    if (!viewBox) {
      throw new Error("3D view bounds are not available");
    }

    const startTime = Date.now();
    const endTime = startTime + durationSeconds * 1000;
    const sampleCountTarget = Math.ceil(durationSeconds * 1000 / sampleInterval);
    const startState = await sampleMetrics(page);

    await setupRafCounter(page);

    let failures = [];
    let lastStatusCheck = Date.now();
    const minSamples = Math.floor(sampleCountTarget * 0.75);

    while (Date.now() < endTime) {
      await page.waitForTimeout(sampleInterval);
      const sample = await sampleMetrics(page);
      stats.samples += 1;
      stats.fpsSum += sample.fps;
      stats.fpsMin = Math.min(stats.fpsMin, sample.fps);
      stats.fpsMax = Math.max(stats.fpsMax, sample.fps);
      if (sample.heapUsed !== null) {
        stats.heapMin = Math.min(stats.heapMin, sample.heapUsed);
        stats.heapMax = Math.max(stats.heapMax, sample.heapUsed);
      }

      const statusText = await isoStatusText.textContent();
      if (statusText === "unavailable" || statusText === "loading") {
        failures.push(`unexpected iso-view status: ${statusText}`);
      }

      if (Date.now() - lastStatusCheck >= 8000) {
        await page.mouse.move(viewBox.x + (viewBox.width * 0.55), viewBox.y + (viewBox.height * 0.55));
        await page.mouse.down();
        await page.mouse.move(viewBox.x + (viewBox.width * 0.25), viewBox.y + (viewBox.height * 0.75));
        await page.mouse.up();
        await page.mouse.click(viewBox.x + (viewBox.width * 0.5), viewBox.y + (viewBox.height * 0.64));
        await page.waitForTimeout(80);
        const afterChannel = await page.evaluate(() => {
          const params = new URLSearchParams(location.search);
          return params.get("channel");
        });
        const hasChannel = afterChannel !== null && Number.isInteger(Number(afterChannel));
        if (!hasChannel) {
          failures.push("3D interaction did not update channel");
          continue;
        }
        lastStatusCheck = Date.now();
      }

      await page.waitForFunction(() => {
        const status = document.querySelector("#iso-status")?.textContent;
        return status !== "unavailable" && status !== "loading";
      }, { timeout: 2000 });
    }

    const endState = await sampleMetrics(page);
    const avgFps = stats.fpsSum / Math.max(1, stats.samples);
    const memGrowthMb = (endState.heapUsed != null && startState.heapUsed != null)
      ? (endState.heapUsed - startState.heapUsed) / (1024 * 1024)
      : null;

    console.log(`[stress] samples=${stats.samples}/${sampleCountTarget} duration=${durationSeconds}s fps(avg=${avgFps.toFixed(2)} min=${stats.fpsMin.toFixed(2)} max=${stats.fpsMax.toFixed(2)})`);
    if (stats.heapMin !== Number.POSITIVE_INFINITY) {
      console.log(`[stress] heapUsedMB(min=${(stats.heapMin / (1024 * 1024)).toFixed(1)} max=${(stats.heapMax / (1024 * 1024)).toFixed(1)})`);
    }
    if (memGrowthMb !== null) {
      console.log(`[stress] heapGrowthMB=${memGrowthMb.toFixed(2)}`);
    }

    if (errors.length) {
      console.error(`[stress] console errors (${errors.length}):`);
      for (const item of errors) {
        console.error(`[stress]   ${item}`);
      }
    }

    if (errors.length > 0) {
      failures.push("runtime emitted console errors");
    }
    if (avgFps < 8) {
      failures.push(`average fps too low: ${avgFps.toFixed(2)}`);
    }
    if (stats.fpsMin < 0.5) {
      failures.push("fps collapsed during run");
    }
    if (stats.samples < Math.max(3, minSamples)) {
      failures.push("did not collect enough samples");
    }
    if (memGrowthMb !== null && memGrowthMb > 500) {
      failures.push(`excessive JS heap growth: +${memGrowthMb.toFixed(2)} MB`);
    }

    if (failures.length) {
      throw new Error(`stress validation failed: ${failures.join("; ")}`);
    }

    console.log(`[stress] PASS ${durationSeconds}s`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = normalize(join(root, pathname));
      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const body = await readFile(filePath);
      const contentType = mimeTypes.get(extname(filePath)) || "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function setupRafCounter(page) {
  await page.evaluate(() => {
    window.__stressFrameState = {
      frames: 0,
      prevSample: performance.now(),
      prevFrames: 0,
      last: performance.now(),
    };

    const onFrame = () => {
      window.__stressFrameState.frames += 1;
      window.requestAnimationFrame(onFrame);
    };
    window.requestAnimationFrame(onFrame);
  });
}

async function sampleMetrics(page) {
  const sample = await page.evaluate(() => {
    const now = performance.now();
    const state = window.__stressFrameState || {};
    const frames = state.frames || 0;
    const last = state.prevSample || now;
    const prevFrames = state.prevFrames || 0;
    const dt = Math.max(1, now - last);
    const fps = ((frames - prevFrames) / (dt / 1000));
    state.prevSample = now;
    state.prevFrames = frames;
    window.__stressFrameState = state;
    const memory = (performance.memory && performance.memory.usedJSHeapSize) || null;
    return {
      fps,
      status: document.querySelector("#iso-status")?.textContent || "",
      heapUsed: memory,
    };
  });

  return {
    fps: Number.isFinite(sample.fps) ? sample.fps : 0,
    heapUsed: sample.heapUsed || null,
    status: sample.status,
  };
}

function isNoiseMessage(message) {
  return noiseMessages.some((noise) => message.includes(noise));
}
