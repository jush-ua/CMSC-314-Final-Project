import { CONFIG } from "../../config.js?v=20260503c";

/** Creates the dirty-flag memory canvas renderer used by the memory panel. */
export function createMemoryCanvas({ canvas }) {
  let isDirty = true;
  let snapshot = null;

  function resizeCanvas() {
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

  /** Marks the memory canvas dirty with the latest memory snapshot. */
  function markDirty(nextSnapshot) {
    snapshot = nextSnapshot;
    isDirty = true;
  }

  /** Re-draws the memory pressure overview only when its dirty flag is set. */
  function render() {
    if (!isDirty || !snapshot) {
      return;
    }
    isDirty = false;
    resizeCanvas();
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);

    const inset = 18;
    const usableWidth = width - (inset * 2);
    const baseline = height - 22;
    const history = snapshot.pressureHistory || [];
    context.lineWidth = 2;
    context.strokeStyle = "rgba(110,110,115,0.25)";
    context.beginPath();
    context.moveTo(inset, baseline);
    context.lineTo(width - inset, baseline);
    context.stroke();

    context.fillStyle = "rgba(0,122,255,0.08)";
    context.beginPath();
    history.forEach((value, index) => {
      const x = inset + ((index / Math.max(history.length - 1, 1)) * usableWidth);
      const y = baseline - (value * (height - 42));
      if (index === 0) {
        context.moveTo(x, baseline);
        context.lineTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.lineTo(width - inset, baseline);
    context.closePath();
    context.fill();

    context.strokeStyle = CONFIG.theme.accentBlue;
    context.beginPath();
    history.forEach((value, index) => {
      const x = inset + ((index / Math.max(history.length - 1, 1)) * usableWidth);
      const y = baseline - (value * (height - 42));
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();

    context.fillStyle = CONFIG.theme.secondaryText;
    context.font = "600 11px -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";
    context.fillText("Memory Pressure", inset, 14);
    context.font = "500 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
    context.fillText(`${Math.round((snapshot.used / snapshot.total) * 100 || 0)}% used`, width - inset - 60, 14);
  }

  return {
    markDirty,
    render,
  };
}
