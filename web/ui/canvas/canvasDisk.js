import { CONFIG } from "../../config.js?v=20260503c";

/** Creates the dirty-flag disk canvas renderer for seek and history visualizations. */
export function createDiskCanvas({ seekCanvas, historyCanvas }) {
  let isDirty = true;
  let snapshot = null;

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
    }
    return false;
  }

  function drawSeekDiagram() {
    resizeCanvas(seekCanvas);
    const context = seekCanvas.getContext("2d");
    const width = seekCanvas.width;
    const height = seekCanvas.height;
    context.clearRect(0, 0, width, height);

    const insetLeft = 38;
    const insetRight = 18;
    const insetTop = 14;
    const insetBottom = 18;
    const usableWidth = width - insetLeft - insetRight;
    const rowCount = Math.min(6, Math.max(snapshot.queue.length, 4));
    const rowGap = (height - insetTop - insetBottom) / rowCount;

    context.strokeStyle = "rgba(0,0,0,0.08)";
    context.lineWidth = 1;
    for (let row = 0; row < rowCount; row += 1) {
      const y = insetTop + (rowGap * row) + (rowGap * 0.5);
      context.beginPath();
      context.moveTo(insetLeft, y);
      context.lineTo(width - insetRight, y);
      context.stroke();
      context.fillStyle = CONFIG.theme.secondaryText;
      context.font = "500 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
      context.fillText(`Q${row + 1}`, 10, y + 4);
    }

    const currentX = insetLeft + ((snapshot.currentTrack / Math.max(snapshot.trackCount - 1, 1)) * usableWidth);
    const gradient = context.createLinearGradient(currentX, 0, currentX + 1, 0);
    gradient.addColorStop(0, "rgba(0,122,255,0)");
    gradient.addColorStop(0.5, "rgba(0,122,255,0.88)");
    gradient.addColorStop(1, "rgba(0,122,255,0)");
    context.strokeStyle = gradient;
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(currentX, insetTop);
    context.lineTo(currentX, height - insetBottom);
    context.stroke();

    snapshot.queue.slice(0, rowCount).forEach((request, index) => {
      const x = insetLeft + ((request.track / Math.max(snapshot.trackCount - 1, 1)) * usableWidth);
      const y = insetTop + (rowGap * index) + (rowGap * 0.5);
      context.fillStyle = request.operation === "WRITE" ? CONFIG.theme.accentYellow : CONFIG.theme.accentBlue;
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    });
  }

  function drawHistoryChart() {
    resizeCanvas(historyCanvas);
    const context = historyCanvas.getContext("2d");
    const width = historyCanvas.width;
    const height = historyCanvas.height;
    context.clearRect(0, 0, width, height);

    const insetLeft = 34;
    const insetRight = 12;
    const insetTop = 12;
    const insetBottom = 24;
    const usableWidth = width - insetLeft - insetRight;
    const usableHeight = height - insetTop - insetBottom;
    const points = snapshot.seekHistory || [0];

    context.strokeStyle = "rgba(0,0,0,0.12)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(insetLeft, insetTop);
    context.lineTo(insetLeft, insetTop + usableHeight);
    context.lineTo(width - insetRight, insetTop + usableHeight);
    context.stroke();

    context.strokeStyle = CONFIG.theme.accentBlue;
    context.lineWidth = 2;
    context.beginPath();
    points.forEach((track, index) => {
      const x = insetLeft + ((index / Math.max(points.length - 1, 1)) * usableWidth);
      const y = insetTop + usableHeight - ((track / Math.max(snapshot.trackCount - 1, 1)) * usableHeight);
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        const previousX = insetLeft + (((index - 1) / Math.max(points.length - 1, 1)) * usableWidth);
        const previousTrack = points[index - 1];
        const previousY = insetTop + usableHeight - ((previousTrack / Math.max(snapshot.trackCount - 1, 1)) * usableHeight);
        const controlX = (previousX + x) / 2;
        context.bezierCurveTo(controlX, previousY, controlX, y, x, y);
      }
    });
    context.stroke();

    context.fillStyle = CONFIG.theme.secondaryText;
    context.font = "500 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
    context.fillText("Time", width - 34, height - 6);
    context.save();
    context.translate(10, insetTop + 26);
    context.rotate(-Math.PI / 2);
    context.fillText("Track", 0, 0);
    context.restore();
  }

  /** Marks both disk canvases dirty with the latest disk snapshot. */
  function markDirty(nextSnapshot) {
    snapshot = nextSnapshot;
    isDirty = true;
  }

  /** Re-draws the seek and history canvases only when their dirty flag is set. */
  function render() {
    if (!isDirty || !snapshot) {
      return;
    }
    isDirty = false;
    drawSeekDiagram();
    drawHistoryChart();
  }

  return {
    markDirty,
    render,
  };
}
