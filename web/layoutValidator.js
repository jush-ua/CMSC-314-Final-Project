/**
 * Runtime validation for critical layout and pointer-event assumptions.
 * Logs warnings to console if issues are detected.
 */
export function createLayoutValidator() {
  const issues = [];

  function check(condition, message) {
    if (!condition) {
      issues.push(message);
      console.warn(`[LayoutValidator] ${message}`);
    }
  }

  function validate() {
    issues.length = 0;
    const app = document.getElementById("app");
    const windowLayer = document.getElementById("window-layer");

    // Check #app dimensions
    if (app) {
      const computedHeight = window.getComputedStyle(app).height;
      const heightValue = parseFloat(computedHeight);
      check(heightValue > 0, `#app has zero or invalid height: ${computedHeight}`);
    } else {
      check(false, "#app element not found");
    }

    // Check window-layer pointer-events
    if (windowLayer) {
      const pointerEvents = window.getComputedStyle(windowLayer).pointerEvents;
      check(pointerEvents === "none", `#window-layer pointer-events is "${pointerEvents}" (should be "none")`);
    } else {
      check(false, "#window-layer element not found");
    }

    // Check pointer-events only for windows that are currently open/interactive
    const openWindows = [...document.querySelectorAll(".desktop-window")].filter((node) => !node.hidden);
    openWindows.forEach((openWindow) => {
      const pointerEvents = window.getComputedStyle(openWindow).pointerEvents;
      check(pointerEvents === "auto", `.desktop-window pointer-events is "${pointerEvents}" (should be "auto")`);
    });

    return issues;
  }

  return { validate, getIssues: () => [...issues] };
}
