export function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

export function clear(ctx, width, height, color = "#091014") {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

export function drawNoData(ctx, width, height, text) {
  ctx.fillStyle = "rgba(220, 233, 229, 0.58)";
  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}

export function drawPanelGrid(ctx, width, height, xLines = 5, yLines = 4) {
  ctx.strokeStyle = "rgba(145, 171, 163, 0.12)";
  ctx.lineWidth = 1;

  for (let i = 1; i < xLines; i += 1) {
    const x = (width * i) / xLines;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let i = 1; i < yLines; i += 1) {
    const y = (height * i) / yLines;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}
