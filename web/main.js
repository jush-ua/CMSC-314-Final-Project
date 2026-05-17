import { CONFIG } from "./config.js?v=20260503c";
import { createMemoryManager } from "./core/memory.js?v=20260503c";
import { createScheduler } from "./core/scheduler.js?v=20260503c";
import { createDiskManager } from "./core/disk.js?v=20260503c";
import { createSpooler } from "./core/spooler.js?v=20260503c";
import { createWindowManager } from "./ui/windowManager.js?v=20260503c";
import { createTaskbar } from "./ui/taskbar.js?v=20260503c";
import { createDesktop } from "./ui/desktop.js?v=20260503c";
import { createLauncher } from "./ui/launcher.js?v=20260503c";
import { createSamples } from "./ui/samples.js?v=20260503c";
import { createProcessPanel } from "./ui/panels/processPanel.js?v=20260503c";
import { createMemoryPanel } from "./ui/panels/memoryPanel.js?v=20260503c";
import { createDiskPanel } from "./ui/panels/diskPanel.js?v=20260503c";
import { createSpoolerPanel } from "./ui/panels/spoolerPanel.js?v=20260503c";
import { createLayoutValidator } from "./layoutValidator.js?v=20260503c";

function createEventBus() {
  const listeners = new Map();
  return {
    on(eventName, listener) {
      const existing = listeners.get(eventName) || [];
      listeners.set(eventName, [...existing, listener]);
    },
    emit(eventName, payload) {
      (listeners.get(eventName) || []).forEach((listener) => listener(payload));
    },
  };
}

function applyThemeVariables() {
  const root = document.documentElement;
  const variables = {
    "--desktop-gradient": CONFIG.theme.desktopGradient,
    "--menu-bar-background": CONFIG.theme.menuBarBackground,
    "--window-background": CONFIG.theme.windowBackground,
    "--title-bar-background": CONFIG.theme.titleBarBackground,
    "--panel-background": CONFIG.theme.panelBackground,
    "--text-primary": CONFIG.theme.primaryText,
    "--text-secondary": CONFIG.theme.secondaryText,
    "--accent-blue": CONFIG.theme.accentBlue,
    "--accent-green": CONFIG.theme.accentGreen,
    "--accent-yellow": CONFIG.theme.accentYellow,
    "--accent-red": CONFIG.theme.accentRed,
    "--selection-highlight": CONFIG.theme.selection,
    "--divider-color": CONFIG.theme.divider,
    "--tooltip-background": CONFIG.theme.tooltipBackground,
    "--dock-background": CONFIG.theme.dockBackground,
    "--dock-border": CONFIG.theme.dockBorder,
    "--inactive-traffic": CONFIG.theme.inactiveTraffic,
    "--shadow-large": CONFIG.theme.shadowLarge,
    "--shadow-inactive": CONFIG.theme.shadowInactive,
    "--context-background": CONFIG.theme.contextBackground,
    "--menu-bar-height": `${CONFIG.ui.menuBarHeight}px`,
    "--dock-height": `${CONFIG.ui.dockHeight}px`,
    "--window-radius": "12px",
    "--card-radius": "8px",
    "--button-radius": "6px",
    "--badge-radius": "4px",
    "--title-bar-height": `${CONFIG.ui.titleBarHeight}px`,
    "--open-duration": `${CONFIG.ui.openAnimationMs}ms`,
    "--close-duration": `${CONFIG.ui.closeAnimationMs}ms`,
    "--minimize-duration": `${CONFIG.ui.minimizeAnimationMs}ms`,
    "--dock-bounce-duration": `${CONFIG.ui.dockBounceMs}ms`,
  };
  Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
}

function buildShell(root) {
  root.innerHTML = `
    <div class="app-shell">
      <header class="menu-bar">
        <div class="menu-left">
          <button id="apple-button" class="menu-icon-button" type="button" aria-label="Apple menu"></button>
          <span id="focused-app-name" class="focused-app-name">OS Simulator</span>
          <div id="menu-labels" class="menu-labels"></div>
        </div>
        <div class="menu-right">
          <button id="menu-wifi" class="menu-icon-button menu-extra-button" type="button" aria-label="Wi-Fi"></button>
          <button id="menu-battery" class="menu-icon-button menu-extra-button" type="button" aria-label="Battery"></button>
          <span id="menu-clock" class="menu-clock">00:00</span>
          <button id="spotlight-button" class="menu-icon-button menu-extra-button" type="button" aria-label="Spotlight"></button>
        </div>
      </header>
      <div id="menu-popover" class="menu-popover"></div>
      <main id="desktop-surface" class="desktop-surface">
        <canvas id="desktop-canvas" class="desktop-canvas" aria-hidden="true"></canvas>
        <div id="desktop-icons" class="desktop-icons"></div>
        <div id="window-layer" class="window-layer"></div>
        <div id="launcher-overlay" class="launcher-overlay hidden"></div>
        <section id="launcher-panel" class="launcher-panel hidden">
          <div class="section-kicker">Applications</div>
          <div id="launcher-grid" class="launcher-grid"></div>
        </section>
        <nav id="desktop-context-menu" class="context-menu hidden"></nav>
        <div id="mac-tooltip" class="mac-tooltip hidden"></div>
      </main>
      <div id="dock-wrapper" class="dock-wrapper">
        <div id="dock" class="dock"></div>
      </div>
      <input id="wallpaper-input" type="file" accept="image/*" hidden />
    </div>
  `;
}

function collectElements(root) {
  return {
    appleButton: root.querySelector("#apple-button"),
    appName: root.querySelector("#focused-app-name"),
    menus: root.querySelector("#menu-labels"),
    wifi: root.querySelector("#menu-wifi"),
    battery: root.querySelector("#menu-battery"),
    spotlight: root.querySelector("#spotlight-button"),
    clock: root.querySelector("#menu-clock"),
    menuPopover: root.querySelector("#menu-popover"),
    surface: root.querySelector("#desktop-surface"),
    canvas: root.querySelector("#desktop-canvas"),
    icons: root.querySelector("#desktop-icons"),
    windowLayer: root.querySelector("#window-layer"),
    overlay: root.querySelector("#launcher-overlay"),
    launcher: root.querySelector("#launcher-panel"),
    launcherGrid: root.querySelector("#launcher-grid"),
    contextMenu: root.querySelector("#desktop-context-menu"),
    tooltip: root.querySelector("#mac-tooltip"),
    dockWrapper: root.querySelector("#dock-wrapper"),
    dock: root.querySelector("#dock"),
    wallpaperInput: root.querySelector("#wallpaper-input"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runSelfTest({ root, scheduler, memory, disk, spooler, elements }) {
  const results = {};
  scheduler.setRunning(false);
  const processIds = [
    scheduler.createProcess({ name: "SelfTest-A", memoryRequired: 8192, cpuTime: 5, priority: 4 }).pid,
    scheduler.createProcess({ name: "SelfTest-B", memoryRequired: 12288, cpuTime: 6, priority: 2 }).pid,
    scheduler.createProcess({ name: "SelfTest-C", memoryRequired: 16384, cpuTime: 5, priority: 5 }).pid,
  ];
  scheduler.setAlgorithm("rr");
  scheduler.step(4);
  results.roundRobinTimeline = scheduler.getSnapshot().timeline.length >= 4;

  scheduler.createProcess({ name: "SelfTest-High", memoryRequired: 4096, cpuTime: 4, priority: 1 });
  scheduler.setAlgorithm("priority");
  scheduler.step(2);
  const priorityTimeline = scheduler.getSnapshot().timeline.slice(-2);
  results.priorityScheduling = priorityTimeline.some((entry) => entry.name === "SelfTest-High");

  memory.translateAddress(processIds[0], CONFIG.memory.pageSize, scheduler.getSnapshot().clock);
  memory.translateAddress(processIds[1], CONFIG.memory.pageSize * 2, scheduler.getSnapshot().clock);
  scheduler.createProcess({ name: "SelfTest-D", memoryRequired: 24576, cpuTime: 4, priority: 6 });
  scheduler.createProcess({ name: "SelfTest-E", memoryRequired: 16384, cpuTime: 4, priority: 7 });
  memory.translateAddress(processIds[2], CONFIG.memory.pageSize * 3, scheduler.getSnapshot().clock);
  const memorySnapshot = memory.getSnapshot();
  results.memoryPageTables = Object.keys(memorySnapshot.pageTables).length >= 3;
  results.memoryEvents = memorySnapshot.events.some((entry) => entry.type === "fault" || entry.type === "eviction");

  windowManager.revealWindow("process-manager");
  await sleep(300);
  results.windowRevealWorks = !windowManager.getContentElement("process-manager").closest(".desktop-window").hidden;

  disk.createFile("selftest.bin", 4);
  disk.readFile("selftest.bin", processIds[0]);
  disk.writeFile("selftest.bin", processIds[1]);
  await sleep(1800);
  const diskSnapshot = disk.getSnapshot();
  results.diskQueueOrCompletion = (diskSnapshot.queue.length + diskSnapshot.completed.length) > 0;
  results.diskMovement = diskSnapshot.seekHistory.length > 1;

  spooler.submitJob("Self Test Document", 3);
  await sleep(CONFIG.spooler.durationMs + 800);
  const spoolerSnapshot = spooler.getSnapshot();
  results.spoolerCompletion = spoolerSnapshot.completed.length > 0;

  const output = JSON.stringify(results);
  root.dataset.selfTest = output;
  const pre = document.createElement("pre");
  pre.id = "self-test-results";
  pre.textContent = output;
  document.body.appendChild(pre);
}

async function runWindowRevealTest({ root, windowManager }) {
  windowManager.revealWindow("process-manager");
  await sleep(400);
  const processWindow = windowManager.getContentElement("process-manager")?.closest(".desktop-window");
  const result = JSON.stringify({
    processWindowVisible: Boolean(processWindow) && !processWindow.hidden,
  });
  root.dataset.windowTest = result;
  const pre = document.createElement("pre");
  pre.id = "window-test-results";
  pre.textContent = result;
  document.body.appendChild(pre);
}

function bootstrap() {
  const root = document.getElementById("app");
  const lowEndDevice = Boolean(
    (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4)
      || (typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4)
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  if (lowEndDevice) {
    document.body.classList.add("low-end-device");
    if (!CONFIG.ui.renderCapFps || CONFIG.ui.renderCapFps > 30) {
      CONFIG.ui.renderCapFps = 30;
    }
    CONFIG.ui.pointerMoveThrottleMs = 14;
    CONFIG.ui.tooltipMoveThrottleMs = 80;
  }
  applyThemeVariables();
  buildShell(root);
  const elements = collectElements(root);
  const bus = createEventBus();
  let renderScheduled = false;
  let lastRenderTime = 0;

  function requestRender() {
    if (renderScheduled) {
      return;
    }
    renderScheduled = true;
    window.requestAnimationFrame((ts) => {
      renderScheduled = false;
      const capFps = Math.max(0, Math.floor(Number(CONFIG.ui.renderCapFps || 0)));
      if (capFps > 0 && lastRenderTime) {
        const minInterval = 1000 / capFps;
        const elapsed = ts - lastRenderTime;
        if (elapsed < minInterval) {
          // schedule next attempt after remaining time
          window.setTimeout(() => {
            // allow future requestRender calls
            renderScheduled = false;
            requestRender();
          }, Math.ceil(minInterval - elapsed));
          return;
        }
      }

      renderables.forEach((item) => {
        try {
          item.render?.();
        } catch (error) {
          const message = error?.stack || error?.message || String(error);
          root.dataset.renderError = message;
          let pre = document.getElementById("render-error");
          if (!pre) {
            pre = document.createElement("pre");
            pre.id = "render-error";
            document.body.appendChild(pre);
          }
          pre.textContent = message;
        }
      });
      lastRenderTime = ts;
    });
  }

  const memory = createMemoryManager({ bus });
  const scheduler = createScheduler({ bus, memory });
  const disk = createDiskManager({ bus });
  const spooler = createSpooler({ bus });
  let launcher = { getDockIconRect: () => null, markDirty: () => {}, closeLauncher: () => {}, setDemoRunning: () => {} };
  const windowManager = createWindowManager({
    bus,
    windowLayer: elements.windowLayer,
    getDockIconRect: (appId) => launcher.getDockIconRect(appId),
    requestRender,
  });

  const desktop = createDesktop({
    elements: {
      surface: elements.surface,
      canvas: elements.canvas,
      icons: elements.icons,
      contextMenu: elements.contextMenu,
      fileInput: elements.wallpaperInput,
    },
    windowManager,
    requestRender,
  });

  // create samples helper and wire into the launcher
  const samples = createSamples({ scheduler, memory, disk, spooler, windowManager, requestRender });
  launcher = createLauncher({
    elements: {
      dockWrapper: elements.dockWrapper,
      dock: elements.dock,
      overlay: elements.overlay,
      launcher: elements.launcher,
      launcherGrid: elements.launcherGrid,
    },
    windowManager,
    requestRender,
    samples,
  });

  const taskbar = createTaskbar({
    bus,
    elements: {
      appleButton: elements.appleButton,
      appName: elements.appName,
      menus: elements.menus,
      wifi: elements.wifi,
      battery: elements.battery,
      spotlight: elements.spotlight,
      clock: elements.clock,
      menuPopover: elements.menuPopover,
    },
    windowManager,
    toggleLauncher: launcher.toggleLauncher,
    requestRender,
    actions: {
      pickWallpaper: () => desktop.pickWallpaper(),
      resetWallpaper: () => desktop.resetWallpaper(),
      openWindow: (id) => windowManager.revealWindow(id),
      showAllWindows: () => CONFIG.apps.filter((app) => app.window).forEach((app) => windowManager.revealWindow(app.id)),
      // samples exposed to the taskbar/menu for manual demonstrations
      runSampleScheduler: () => samples.runSchedulerSample(),
      runSampleMemory: () => samples.runMemorySample(),
      runSampleDisk: () => samples.runDiskSample(),
      runSampleSpooler: () => samples.runSpoolerSample(),
      showAbout: () => window.alert("OS Simulator\nSingle-page desktop simulator with scheduling, paging, disk I/O, spooler, and manual samples."),
    },
  });

  windowManager.registerWindows();

  const processPanel = createProcessPanel({
    container: windowManager.getContentElement("process-manager"),
    scheduler,
    requestRender,
  });
  const memoryPanel = createMemoryPanel({
    container: windowManager.getContentElement("memory-manager"),
    memory,
    scheduler,
    tooltip: elements.tooltip,
    requestRender,
  });
  const diskPanel = createDiskPanel({
    container: windowManager.getContentElement("disk-manager"),
    disk,
    requestRender,
  });
  const spoolerPanel = createSpoolerPanel({
    container: windowManager.getContentElement("printer-manager"),
    spooler,
    requestRender,
  });

  // Validate layout and pointer-events at startup
  const validator = createLayoutValidator();
  window.requestAnimationFrame(() => validator.validate());

  const renderables = [desktop, windowManager, taskbar, launcher, processPanel, memoryPanel, diskPanel, spoolerPanel];

  processPanel.init();
  memoryPanel.init();
  diskPanel.init();
  spoolerPanel.init();
  desktop.init();
  launcher.init();
  taskbar.init();

  bus.on("scheduler:updated", () => {
    processPanel.markDirty();
    requestRender();
  });
  bus.on("memory:updated", () => {
    memoryPanel.markDirty();
    requestRender();
  });
  bus.on("disk:updated", () => {
    diskPanel.markDirty();
    requestRender();
  });
  bus.on("spooler:updated", () => {
    spoolerPanel.markDirty();
    requestRender();
  });
  bus.on("window:updated", () => {
    launcher.markDirty();
    requestRender();
  });

  requestRender();
  const params = new URLSearchParams(window.location.search);
  if (params.get("window-test") === "1") {
    void runWindowRevealTest({ root, windowManager });
  }
  if (params.get("self-test") === "1") {
    void runSelfTest({ root, scheduler, memory, disk, spooler, elements });
  }
}

bootstrap();
