import { CONFIG } from "../config.js?v=20260503c";

/** Creates the App Launcher and Dock interactions for the desktop shell. */
export function createLauncher({ elements, windowManager, requestRender, samples }) {
  const state = {
    dirty: true,
    launcherOpen: false,
    demoRunning: false,
    dockButtons: new Map(),
  };

  function renderLauncherGrid() {
    const fragment = document.createDocumentFragment();
    CONFIG.apps.filter((app) => app.id !== "demo").forEach((app) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "launcher-tile";
      button.innerHTML = `<span class="launcher-tile-icon" style="--app-accent:${app.accent}">${app.icon}</span><span>${app.title}</span>`;
      button.addEventListener("click", () => {
        closeLauncher();
        windowManager.revealWindow(app.id);
      });
      fragment.appendChild(button);
    });
    elements.launcherGrid.replaceChildren(fragment);
    // samples area
    if (samples) {
      const samplesContainer = document.createElement("div");
      samplesContainer.className = "launcher-samples";
      const sampleTitle = document.createElement("div");
      sampleTitle.className = "section-kicker";
      sampleTitle.textContent = "Samples";
      samplesContainer.appendChild(sampleTitle);
      const sampleButtons = document.createElement("div");
      sampleButtons.className = "launcher-sample-buttons";
      const btn = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sf-button";
        b.textContent = label;
        b.addEventListener("click", () => fn());
        return b;
      };
      sampleButtons.appendChild(btn("Scheduler", samples.runSchedulerSample));
      sampleButtons.appendChild(btn("Memory", samples.runMemorySample));
      sampleButtons.appendChild(btn("Disk", samples.runDiskSample));
      sampleButtons.appendChild(btn("Spooler", samples.runSpoolerSample));
      samplesContainer.appendChild(sampleButtons);
      elements.launcher.appendChild(samplesContainer);
    }
  }

  function dockButtonFor(app) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dock-icon-button";
    button.dataset.appId = app.id;
    button.style.setProperty("--app-accent", app.accent);
    button.innerHTML = `<span class="dock-icon-art">${app.icon}</span><span class="dock-indicator"></span>`;
    button.addEventListener("click", () => {
      windowManager.activateWindow(app.id);
    });
    state.dockButtons.set(app.id, button);
    return button;
  }

  function renderDock() {
    const appButtons = CONFIG.apps.filter((app) => app.window).map(dockButtonFor);
    elements.dock.replaceChildren(...appButtons);
  }

  function closeLauncher() {
    state.launcherOpen = false;
    markDirty();
  }

  function openLauncher() {
    state.launcherOpen = true;
    markDirty();
  }

  function toggleLauncher() {
    state.launcherOpen = !state.launcherOpen;
    markDirty();
  }

  function handleOverlayClick() {
    elements.overlay.addEventListener("click", closeLauncher);
  }

  /** Initializes the launcher and dock shell controls. */
  function init() {
    renderLauncherGrid();
    renderDock();
    handleOverlayClick();
  }

  /** Sets whether the demo button should display an active running indicator. */
  function setDemoRunning(isRunning) {
    state.demoRunning = Boolean(isRunning);
    markDirty();
  }

  /** Marks the launcher and dock dirty for the next UI render pass. */
  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  /** Returns the dock icon bounds for window animation origins. */
  function getDockIconRect(appId) {
    return state.dockButtons.get(appId)?.getBoundingClientRect() || null;
  }

  /** Re-renders launcher visibility and dock active indicators. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    const windowStates = windowManager.getWindowStates();
    const dockBehindWindows = windowStates.some((item) => item.active || item.maximized);
    elements.dockWrapper?.classList.toggle("behind-windows", dockBehindWindows);
    windowStates.forEach((item) => {
      const button = state.dockButtons.get(item.id);
      if (!button) {
        return;
      }
      button.classList.toggle("is-active", item.windowState !== "closed");
      button.classList.toggle("is-focused", item.active);
    });
    state.dockButtons.get("demo")?.classList.toggle("is-active", state.demoRunning);
    elements.overlay.classList.toggle("hidden", !state.launcherOpen);
    elements.launcher.classList.toggle("hidden", !state.launcherOpen);
  }

  return {
    init,
    render,
    toggleLauncher,
    closeLauncher,
    setDemoRunning,
    getDockIconRect,
    markDirty,
  };
}
