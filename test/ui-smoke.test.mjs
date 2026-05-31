import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = normalize(join(import.meta.dirname, ".."));
const mimeTypes = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".json", "application/json"],
]);

test("demo mode keeps the default 2D dashboard and does not initialise 3D", async () => {
  await withPage("/?demo=1", async ({ page, errors }) => {
    await page.waitForTimeout(800);

    assert.equal(await page.locator(".viewtabs button[data-view='2d']").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".p-iso").evaluate((node) => getComputedStyle(node).display), "none");
    assert.equal(await page.locator("#iso-canvas").count(), 1);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.deepEqual(errors, []);
  });
});

test("connect button restarts demo mode without switching to live sockets", async () => {
  await withPage("/?demo=1", async ({ page, errors }) => {
    await page.waitForTimeout(800);

    const before = await page.locator("#stats-text").textContent();
    await page.locator("#connect-btn").click();
    await page.waitForTimeout(800);

    const url = new URL(page.url());
    assert.equal(url.searchParams.get("demo"), "1");
    assert.match(await page.locator("#status-text").textContent(), /browser demo/);
    assert.notEqual(await page.locator("#stats-text").textContent(), before);
    assert.equal(await page.locator("#m-mode").textContent(), "demo");
    assert.deepEqual(errors, []);
  });
});

test("sample recording loads and replays through the browser UI", async () => {
  await withPage("/?demo=1", async ({ page, errors }) => {
    await page.locator("#sample-recording-btn").click();
    await page.waitForFunction(() => document.querySelector("#m-mode")?.textContent === "recording");
    await page.waitForFunction(() => document.querySelector("#stats-text")?.textContent !== "0 spk · 0 stm");

    const url = new URL(page.url());
    assert.equal(url.searchParams.has("demo"), false);
    assert.match(await page.locator("#status-text").textContent(), /sample-recording\.json/);
    assert.match(await page.locator("#recording-hint").textContent(), /sample-recording\.json/);
    assert.deepEqual(errors, []);
  });
});

test("recording reset after playback end replays events from the beginning", async () => {
  await withPage("/?demo=1", async ({ page, errors }) => {
    await page.locator("#sample-recording-btn").click();
    await page.waitForFunction(() => document.querySelector("#status-text")?.textContent?.includes("recording ended"));

    await page.locator("#reset-btn").click();
    await page.waitForFunction(() => document.querySelector("#stats-text")?.textContent !== "0 spk · 0 stm");

    assert.match(await page.locator("#status-text").textContent(), /recording ended|replaying/);
    assert.deepEqual(errors, []);
  });
});

test("3D demo mode renders an isometric MEA canvas without console errors", async () => {
  await withPage("/?demo=1&view=3d", async ({ page, errors }) => {
    await page.waitForSelector("#iso-canvas", { state: "visible", timeout: 10000 });

    assert.equal(await page.locator('button[data-view="3d"]').getAttribute("aria-pressed"), "true");
    const box = await page.locator("#iso-canvas").boundingBox();
    assert.ok(box.width > 320);
    assert.ok(box.height > 320);
    assert.equal(await page.locator("#iso-status").textContent(), "8 × 8");
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.deepEqual(errors, []);
  });
});

test("electrode grid demo mode renders a shareable logical channel view", async () => {
  await withPage("/?demo=1&view=grid", async ({ page, errors }) => {
    await page.waitForSelector("#electrode-grid-canvas", { state: "visible", timeout: 10000 });

    assert.equal(await page.locator('button[data-view="grid"]').getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#grid-sub").textContent(), /logical 8 × 8 channels/i);
    const box = await page.locator("#electrode-grid-canvas").boundingBox();
    assert.ok(box.width > 320);
    assert.ok(box.height > 320);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.deepEqual(errors, []);
  });
});

test("electrode grid handles unknown channel count without crashing", async () => {
  await withPage("/?view=grid", async ({ page, errors }) => {
    await page.waitForSelector("#electrode-grid-canvas", { state: "visible", timeout: 10000 });

    assert.equal(await page.locator('button[data-view="grid"]').getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#grid-sub").textContent(), /waiting for channel metadata/i);
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.deepEqual(errors.filter((message) => !isExpectedMissingSimulatorNoise(message)), []);
  });
});

test("electrode grid channel selection updates the shared channel query state", async () => {
  await withPage("/?demo=1&view=grid", async ({ page, errors }) => {
    const canvas = page.locator("#electrode-grid-canvas");
    await canvas.waitFor({ state: "visible", timeout: 10000 });

    const target = await canvas.evaluate((node) => {
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
      return { x: ox + cell / 2, y: oy + cell / 2 };
    });

    await canvas.click({ position: target });
    await page.waitForFunction(() => new URL(location.href).searchParams.get("channel") === "0");

    assert.equal(new URL(page.url()).searchParams.get("channel"), "0");
    assert.equal(await page.locator("#m-channel").textContent(), "0");

    await page.locator("#reset-btn").click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has("channel"));
    await page.waitForTimeout(350);
    assert.equal(new URL(page.url()).searchParams.has("channel"), false);
    assert.equal(await page.locator("#m-channel").textContent(), "—");
    assert.match(await page.locator("#grid-sub").textContent(), /logical 8 × 8 channels/i);

    await canvas.click({ position: target });
    await page.waitForFunction(() => new URL(location.href).searchParams.get("channel") === "0");
    await page.keyboard.press("KeyR");
    await page.waitForFunction(() => !new URL(location.href).searchParams.has("channel"));
    await page.waitForTimeout(350);
    assert.equal(new URL(page.url()).searchParams.has("channel"), false);
    assert.equal(await page.locator("#m-channel").textContent(), "—");
    assert.match(await page.locator("#grid-sub").textContent(), /logical 8 × 8 channels/i);
    assert.deepEqual(errors, []);
  });
});

test("compact split view renders 2D and 3D panels without horizontal overflow", async () => {
  await withPage("/?demo=1&view=split&compact=1", async ({ page, errors }) => {
    await page.waitForSelector("#iso-canvas", { state: "visible", timeout: 10000 });

    assert.equal(await page.locator("body").evaluate((node) => node.classList.contains("view-split")), true);
    assert.equal(await page.locator('button[data-view="split"]').getAttribute("aria-pressed"), "true");
    assert.notEqual(await page.locator(".p-raster").evaluate((node) => getComputedStyle(node).display), "none");
    assert.notEqual(await page.locator(".p-iso").evaluate((node) => getComputedStyle(node).display), "none");
    assert.equal(await hasHorizontalOverflow(page), false);
    assert.deepEqual(errors, []);
  });
});

test("3D channel selection updates the shared channel query state", async () => {
  await withPage("/?demo=1&view=3d", async ({ page, errors }) => {
    await page.waitForSelector("#iso-canvas", { state: "visible", timeout: 10000 });

    const canvas = page.locator("#iso-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    assert.ok(box, "expected 3D canvas bounds");
    await canvas.click({
      position: {
        x: box.width * 0.5,
        y: box.height * 0.64,
      },
    });
    await page.waitForFunction(() => new URL(location.href).searchParams.has("channel"));

    const channel = Number(new URL(page.url()).searchParams.get("channel"));
    assert.ok(Number.isInteger(channel) && channel >= 0 && channel < 64);
    assert.match(await page.locator("#wave-ch").textContent(), /^ch \d+$/);
    assert.deepEqual(errors, []);
  });
});

async function withPage(path, callback) {
  const { server, url } = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const errors = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && !isBrowserGpuNoise(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    await page.goto(`${url}${path}`);
    await page.waitForLoadState("load");
    await callback({ page, errors });
  } finally {
    await browser.close();
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
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      });
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

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

function isBrowserGpuNoise(message) {
  return message.includes("GL Driver Message")
    || message.includes("CONTEXT_LOST_WEBGL");
}

function isExpectedMissingSimulatorNoise(message) {
  return message.includes("WebSocket connection to 'ws://127.0.0.1:1025/_/ws/")
    && message.includes("ERR_CONNECTION_REFUSED");
}
