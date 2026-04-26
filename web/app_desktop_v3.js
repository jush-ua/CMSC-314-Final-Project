const CONFIG = {
  pollMs: 500,
  rowHeight: 52,
  rowBuffer: 5,
  printDurationMs: 3000,
  printerRefreshMs: 300,
  compactWidth: 900,
  compactHeight: 720,
};

const state = {
  snapshot: null,
  pendingSnapshot: null,
  renderRequested: false,
  fetchInFlight: false,
  activeWindowId: "",
  clockText: "",
  themeVersion: 0,
  windows: {},
  zStack: [],
  dirty: {
    process: true,
    memory: true,
    disk: true,
    printer: true,
    stats: true,
    taskbar: true,
  },
  process: {
    filter: "",
    sortKey: "pid",
    sortDir: "asc",
    rows: [],
    rowPool: [],
    lastSignature: "",
    needsRowRender: true,
  },
  memory: {
    lastSignature: "",
    eventCursor: [],
    flashes: [],
    resizeObserver: null,
  },
  disk: {
    lastSignature: "",
    displayTrack: 0,
    headFrom: 0,
    headTo: 0,
    headStart: 0,
    headDuration: 300,
  },
  printer: {
    lastSignature: "",
    queuedStartTimes: new Map(),
  },
  ui: {
    selectedIcon: "",
    reducedEffects: false,
  },
  demo: {
    running: false,
    cleaning: false,
    token: 0,
    paused: false,
    skipRequested: false,
    spotlightWindowId: "",
    currentStepIndex: -1,
    currentStepDuration: 0,
    stepStartedAt: 0,
    stepElapsedBeforePause: 0,
    progressRaf: 0,
    markerRaf: 0,
    canvasMarker: null,
    processIds: [],
    pulseCleanups: [],
    priorityOptionInjected: false,
    schedulerPreviewValue: "",
    toastTimer: 0,
  },
};

const elements = {
  desktop: document.getElementById("desktop"),
  launcherOverlay: document.getElementById("launcher-overlay"),
  contextOverlay: document.getElementById("context-overlay"),
  desktopIcons: document.getElementById("desktop-icons"),
  contextMenu: document.getElementById("desktop-context-menu"),
  windowLayer: document.getElementById("window-layer"),
  startMenu: document.getElementById("start-menu"),
  startButton: document.getElementById("start-button"),
  taskbarWindows: document.getElementById("taskbar-windows"),
  themeToggle: document.getElementById("theme-toggle"),
  systemClock: document.getElementById("system-clock"),
  memoryBatteryFill: document.getElementById("memory-battery-fill"),
  statTotalProcesses: document.getElementById("stat-total-processes"),
  statMemory: document.getElementById("stat-memory"),
  statDiskHead: document.getElementById("stat-disk-head"),
  schedulerSelect: document.getElementById("scheduler-select"),
  schedulerToggle: document.getElementById("scheduler-toggle"),
  processName: document.getElementById("process-name"),
  processMemory: document.getElementById("process-memory"),
  processPriority: document.getElementById("process-priority"),
  processCpu: document.getElementById("process-cpu"),
  processFilter: document.getElementById("process-filter"),
  processViewport: document.getElementById("process-viewport"),
  processSpacer: document.getElementById("process-spacer"),
  processRows: document.getElementById("process-rows"),
  memoryPid: document.getElementById("memory-pid"),
  memoryAddress: document.getElementById("memory-address"),
  memorySummary: document.getElementById("memory-summary"),
  memoryFrameGrid: document.getElementById("memory-frame-grid"),
  memoryLegend: document.getElementById("memory-legend"),
  pageTablePanel: document.getElementById("page-table-panel"),
  memoryEvents: document.getElementById("memory-events"),
  diskFileName: document.getElementById("disk-file-name"),
  diskFileSize: document.getElementById("disk-file-size"),
  diskFilePid: document.getElementById("disk-file-pid"),
  diskToggle: document.getElementById("disk-toggle"),
  diskTrackCanvas: document.getElementById("disk-track-canvas"),
  diskQueueTable: document.getElementById("disk-queue-table"),
  diskCompletedTable: document.getElementById("disk-completed-table"),
  fatPanel: document.getElementById("fat-panel"),
  diskMovementLog: document.getElementById("disk-movement-log"),
  seekHistoryCanvas: document.getElementById("seek-history-canvas"),
  printJobId: document.getElementById("print-job-id"),
  printDocument: document.getElementById("print-document"),
  printPages: document.getElementById("print-pages"),
  printerJobs: document.getElementById("printer-jobs"),
  demoButton: document.getElementById("demo-button"),
  presentationOverlay: document.getElementById("presentation-overlay"),
  presentationHud: document.getElementById("presentation-hud"),
  presentationStepCounter: document.getElementById("presentation-step-counter"),
  presentationStepTitle: document.getElementById("presentation-step-title"),
  presentationPause: document.getElementById("presentation-pause"),
  presentationResume: document.getElementById("presentation-resume"),
  presentationSkipStep: document.getElementById("presentation-skip-step"),
  presentationEndDemo: document.getElementById("presentation-end-demo"),
  presentationNarration: document.getElementById("presentation-narration"),
  presentationNarrationText: document.getElementById("presentation-narration-text"),
  presentationPausedLabel: document.getElementById("presentation-paused-label"),
  presentationProgressFill: document.getElementById("presentation-progress-fill"),
  demoToast: document.getElementById("demo-toast"),
};

function formatUnits(value) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} units`;
}

function pidColor(pid) {
  const palette = ["#6f9cff", "#5fd2b0", "#f8b464", "#f38ec8", "#8fb8ff", "#9fd37b", "#c091ff"];
  return palette[(Number(pid) || 0) % palette.length];
}

function apiRequest(path, payload = {}, method = "POST") {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(payload),
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  });
}

function queueRender() {
  if (state.renderRequested) {
    return;
  }
  state.renderRequested = true;
  window.requestAnimationFrame(renderFrame);
}

function isCompactViewport() {
  return window.innerWidth <= CONFIG.compactWidth || window.innerHeight <= CONFIG.compactHeight;
}

function detectReducedEffects() {
  const lowCoreCount = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
  const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  state.ui.reducedEffects = Boolean(lowCoreCount || lowMemory || reducedMotion);
  document.body.classList.toggle("reduced-effects", state.ui.reducedEffects);
}

function getCanvasScale() {
  return Math.min(window.devicePixelRatio || 1, state.ui.reducedEffects ? 1.25 : 2);
}

function getThemeValue(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function getWindowNode(id) {
  return document.querySelector(`[data-window="${id}"]`);
}

function getWindowRect(model) {
  return { x: model.x, y: model.y, width: model.width, height: model.height };
}

function getWindowBounds() {
  const bounds = elements.windowLayer.getBoundingClientRect();
  return {
    width: Math.max(0, Math.floor(bounds.width)),
    height: Math.max(0, Math.floor(bounds.height)),
  };
}

function getWindowMargin() {
  return isCompactViewport() ? 8 : 12;
}

function clampWindow(model, options = {}) {
  const bounds = getWindowBounds();
  if (!bounds.width || !bounds.height) {
    return;
  }
  const margin = getWindowMargin();
  const minWidth = Math.min(320, Math.max(220, bounds.width - margin * 2));
  const minHeight = Math.min(240, Math.max(180, bounds.height - margin * 2));
  const maxWidth = Math.max(minWidth, bounds.width - margin * 2);
  const maxHeight = Math.max(minHeight, bounds.height - margin * 2);

  if (options.preferFullscreen) {
    model.x = margin;
    model.y = margin;
    model.width = maxWidth;
    model.height = maxHeight;
    return;
  }

  model.width = Math.min(Math.max(model.width, minWidth), maxWidth);
  model.height = Math.min(Math.max(model.height, minHeight), maxHeight);
  model.x = Math.min(Math.max(model.x, 0), Math.max(0, bounds.width - model.width));
  model.y = Math.min(Math.max(model.y, 0), Math.max(0, bounds.height - model.height));
}

function setWindowRect(node, model) {
  node.style.setProperty("--win-x", `${model.x}px`);
  node.style.setProperty("--win-y", `${model.y}px`);
  node.style.setProperty("--win-width", `${model.width}px`);
  node.style.setProperty("--win-height", `${model.height}px`);
  updateWindowOffscreen(node, model);
}

function updateWindowOffscreen(node, model) {
  const bounds = getWindowBounds();
  const hidden = model.x + model.width < 0 || model.y + model.height < 0 || model.x > bounds.width || model.y > bounds.height;
  node.classList.toggle("is-offscreen", hidden);
}

function syncWindowVisibility(model) {
  const { node, windowState } = model;
  const isOpen = windowState === "open";
  node.classList.toggle("hidden-window", !isOpen);
  node.style.display = isOpen ? "flex" : "none";
  node.style.visibility = isOpen ? "visible" : "hidden";
  node.style.pointerEvents = isOpen ? "" : "none";
  if (!isOpen) {
    node.style.zIndex = "0";
  }
}

function updateWindowActiveClasses() {
  document.querySelectorAll(".desktop-window").forEach((windowNode) => {
    windowNode.classList.toggle("active", windowNode.dataset.window === state.activeWindowId);
  });
}

function applyDemoWindowPresentation() {
  const orderedOpenWindows = state.zStack.filter((id) => state.windows[id]?.windowState === "open");
  orderedOpenWindows.forEach((id, index) => {
    const model = state.windows[id];
    const isSpotlight = state.demo.spotlightWindowId && state.demo.spotlightWindowId === id;
    model.node.style.zIndex = String(isSpotlight ? 980 : 920 + index);
    model.node.classList.toggle("demo-window-dimmed", Boolean(state.demo.spotlightWindowId) && !isSpotlight);
    model.node.classList.toggle("demo-spotlight", isSpotlight);
  });
  Object.values(state.windows).forEach((model) => {
    if (model.windowState === "open") {
      return;
    }
    model.node.style.zIndex = "0";
    model.node.classList.remove("demo-window-dimmed", "demo-spotlight");
  });
}

function reassignZIndices() {
  if (state.demo.running || state.demo.cleaning) {
    applyDemoWindowPresentation();
    return;
  }
  const orderedOpenWindows = state.zStack.filter((id) => state.windows[id]?.windowState === "open");
  orderedOpenWindows.forEach((id, index) => {
    state.windows[id].node.style.zIndex = String(100 + index);
    state.windows[id].node.classList.remove("demo-window-dimmed", "demo-spotlight");
  });
  Object.values(state.windows).forEach((model) => {
    if (model.windowState !== "open") {
      model.node.style.zIndex = "0";
      model.node.classList.remove("demo-window-dimmed", "demo-spotlight");
    }
  });
}

function blurWindows() {
  state.activeWindowId = "";
  updateWindowActiveClasses();
  state.dirty.taskbar = true;
}

function focusWindow(id) {
  const model = state.windows[id];
  if (!model || model.windowState !== "open") {
    return;
  }
  state.zStack = state.zStack.filter((windowId) => windowId !== id);
  state.zStack.push(id);
  state.activeWindowId = id;
  reassignZIndices();
  updateWindowActiveClasses();
  state.dirty.taskbar = true;
}

function rebuildTaskbar() {
  const fragment = document.createDocumentFragment();
  Object.values(state.windows)
    .filter((model) => model.windowState !== "closed")
    .sort((left, right) => state.zStack.indexOf(left.id) - state.zStack.indexOf(right.id))
    .forEach((model) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "taskbar-button";
      button.textContent = model.title;
      button.dataset.window = model.id;
      button.dataset.tooltip = model.title;
      if (model.windowState === "minimized") {
        button.classList.add("minimized-task");
      } else if (state.activeWindowId === model.id) {
        button.classList.add("active-task");
      } else {
        button.classList.add("inactive-task");
      }
      fragment.appendChild(button);
    });
  elements.taskbarWindows.replaceChildren(fragment);
}

function cancelHideWindow(model) {
  if (model.hideCleanup) {
    model.hideCleanup();
    model.hideCleanup = null;
  }
  if (model.hideTimer) {
    window.clearTimeout(model.hideTimer);
    model.hideTimer = 0;
  }
}

function setWindowState(id, nextState, animationClass = "is-restoring") {
  const model = state.windows[id];
  if (!model) {
    return;
  }
  const node = model.node;
  cancelHideWindow(model);
  if (model.windowState === nextState) {
    if (nextState === "open") {
      focusWindow(id);
    }
    return;
  }

  if (nextState === "open") {
    model.windowState = "open";
    model.hidden = false;
    clampWindow(model, { preferFullscreen: isCompactViewport() && !model.maximized });
    syncWindowVisibility(model);
    node.classList.remove("is-closing", "is-minimizing");
    node.classList.add(animationClass);
    setWindowRect(node, model);
    focusWindow(id);
    window.setTimeout(() => node.classList.remove(animationClass), 180);
    closeStartMenu();
    state.dirty.taskbar = true;
    return;
  }

  model.windowState = nextState;
  model.hidden = true;
  node.classList.remove("is-opening", "is-restoring");
  node.classList.add(nextState === "closed" ? "is-closing" : "is-minimizing");
  const finalize = () => {
    cancelHideWindow(model);
    node.classList.remove("is-closing", "is-minimizing");
    syncWindowVisibility(model);
    if (state.activeWindowId === id) {
      const nextFocusId = [...state.zStack].reverse().find((windowId) => state.windows[windowId]?.windowState === "open") || "";
      state.activeWindowId = nextFocusId;
    }
    reassignZIndices();
    updateWindowActiveClasses();
    state.dirty.taskbar = true;
  };
  const handleTransitionEnd = (event) => {
    if (event.target === node) {
      finalize();
    }
  };
  node.addEventListener("transitionend", handleTransitionEnd);
  model.hideCleanup = () => node.removeEventListener("transitionend", handleTransitionEnd);
  model.hideTimer = window.setTimeout(finalize, state.ui.reducedEffects ? 0 : 220);
  state.dirty.taskbar = true;
  queueRender();
}

function openWindow(id, animationClass = "is-restoring") {
  setWindowState(id, "open", animationClass);
}

function minimizeWindow(id) {
  setWindowState(id, "minimized");
}

function closeWindow(id) {
  setWindowState(id, "closed");
}

function toggleTaskbarWindow(id) {
  const model = state.windows[id];
  if (!model) {
    return;
  }
  if (model.windowState === "minimized") {
    openWindow(id);
  } else if (model.windowState === "open" && state.activeWindowId === id) {
    minimizeWindow(id);
  } else if (model.windowState === "open") {
    focusWindow(id);
  }
}

function focusOrOpenWindow(id, animationClass = "is-opening") {
  const model = state.windows[id];
  if (!model) {
    return;
  }
  if (model.windowState === "closed" || model.windowState === "minimized") {
    openWindow(id, animationClass);
  } else {
    focusWindow(id);
  }
}

function openStartMenu() {
  elements.startMenu.classList.remove("hidden");
  elements.launcherOverlay.classList.remove("hidden");
  elements.startButton.classList.add("is-active");
}

function closeStartMenu() {
  elements.startMenu.classList.add("hidden");
  elements.launcherOverlay.classList.add("hidden");
  elements.startButton.classList.remove("is-active");
}

function openContextMenu(x, y) {
  elements.contextMenu.style.left = `${x}px`;
  elements.contextMenu.style.top = `${y}px`;
  elements.contextMenu.classList.remove("hidden");
  elements.contextOverlay.classList.remove("hidden");
}

function closeContextMenu() {
  elements.contextMenu.classList.add("hidden");
  elements.contextOverlay.classList.add("hidden");
}

function setDesktopSelection(iconId) {
  state.ui.selectedIcon = iconId;
  document.querySelectorAll(".desktop-icon").forEach((icon) => {
    icon.classList.toggle("selected", icon.dataset.iconId === iconId);
  });
}

function initProcessRowPool() {
  const visibleCount = Math.ceil(elements.processViewport.clientHeight / CONFIG.rowHeight) + CONFIG.rowBuffer * 2;
  if (state.process.rowPool.length >= visibleCount) {
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let index = state.process.rowPool.length; index < visibleCount; index += 1) {
    const row = document.createElement("div");
    row.className = "process-row";
    row.innerHTML = `
      <div class="process-row-cell" data-field="pid"></div>
      <div class="process-row-cell" data-field="name"></div>
      <div class="process-row-cell" data-field="state"></div>
      <div class="process-row-cell" data-field="cpu_percent"></div>
      <div class="process-row-cell" data-field="memory_usage"></div>
      <div class="process-row-cell" data-field="actions">
        <div class="form-inline">
          <button class="tiny-button" data-process-action="block" type="button">Block</button>
          <button class="tiny-button" data-process-action="unblock" type="button">Ready</button>
          <button class="tiny-button danger" data-process-action="kill" type="button">End</button>
        </div>
      </div>
    `;
    state.process.rowPool.push(row);
    fragment.appendChild(row);
  }
  elements.processRows.appendChild(fragment);
}

function sortProcesses(processes) {
  const direction = state.process.sortDir === "asc" ? 1 : -1;
  return [...processes].sort((left, right) => {
    const leftValue = left[state.process.sortKey];
    const rightValue = right[state.process.sortKey];
    if (leftValue === rightValue) {
      return left.pid - right.pid;
    }
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * direction;
    }
    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function filterProcesses(processes) {
  const term = state.process.filter.trim().toLowerCase();
  if (!term) {
    return processes;
  }
  return processes.filter((process) => `${process.pid} ${process.name} ${process.state}`.toLowerCase().includes(term));
}

function prepareProcessData(processes) {
  state.process.rows = sortProcesses(filterProcesses(processes));
  elements.processSpacer.style.height = `${state.process.rows.length * CONFIG.rowHeight}px`;
}

function updateProcessSortButtons() {
  document.querySelectorAll(".process-header-button").forEach((button) => {
    button.classList.toggle("sort-asc", button.dataset.sortKey === state.process.sortKey && state.process.sortDir === "asc");
    button.classList.toggle("sort-desc", button.dataset.sortKey === state.process.sortKey && state.process.sortDir === "desc");
  });
}

function makeStateBadge(status) {
  const badge = document.createElement("span");
  badge.className = `state-pill state-${status}`;
  badge.textContent = status.toUpperCase();
  return badge;
}

function renderProcessRows() {
  initProcessRowPool();
  const startIndex = Math.max(0, Math.floor(elements.processViewport.scrollTop / CONFIG.rowHeight) - CONFIG.rowBuffer);
  state.process.rowPool.forEach((row, poolIndex) => {
    const dataIndex = startIndex + poolIndex;
    const process = state.process.rows[dataIndex];
    if (!process) {
      row.style.display = "none";
      return;
    }
    row.style.display = "grid";
    row.style.transform = `translateY(${dataIndex * CONFIG.rowHeight}px)`;
    row.classList.toggle("is-even", dataIndex % 2 === 1);
    row.dataset.pid = String(process.pid);
    row.querySelector('[data-field="pid"]').textContent = String(process.pid);
    row.querySelector('[data-field="name"]').textContent = process.name;
    const stateCell = row.querySelector('[data-field="state"]');
    stateCell.replaceChildren(makeStateBadge(process.state));
    row.querySelector('[data-field="cpu_percent"]').textContent = Number(process.cpu_percent).toFixed(1);
    row.querySelector('[data-field="memory_usage"]').textContent = formatUnits(process.memory_usage);
    row.querySelectorAll("[data-process-action]").forEach((button) => {
      button.dataset.pid = String(process.pid);
    });
  });
  state.process.needsRowRender = false;
}

function resizeCanvas(canvas) {
  const dpr = getCanvasScale();
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function collectMemoryFlashes(memory, snapshot) {
  const previous = new Set(state.memory.eventCursor);
  const current = [];
  memory.events.forEach((event) => {
    current.push(event);
    if (previous.has(event)) {
      return;
    }
    const evictionMatch = /frame (\d+) freed/i.exec(event);
    if (evictionMatch) {
      state.memory.flashes.push({ frame: Number(evictionMatch[1]), type: "eviction", start: performance.now() });
      return;
    }
    const faultMatch = /PID (\d+) accessing virtual page (\d+)/i.exec(event);
    if (!faultMatch) {
      return;
    }
    const pid = faultMatch[1];
    const virtualPage = Number(faultMatch[2]);
    const frame = (snapshot.memory.page_tables[pid] || []).find((item) => item.virtual_page === virtualPage)?.frame_number;
    if (frame != null) {
      state.memory.flashes.push({ frame, type: "fault", start: performance.now() });
    }
  });
  state.memory.eventCursor = current;
}

function updatePrinterProgressTracking(printer) {
  const now = performance.now();
  const queueIds = new Set(printer.queue.map((job) => job.job_id));
  state.printer.queuedStartTimes.forEach((value, key) => {
    if (!queueIds.has(key)) {
      state.printer.queuedStartTimes.delete(key);
    }
  });
  if (printer.queue[0] && !state.printer.queuedStartTimes.has(printer.queue[0].job_id)) {
    state.printer.queuedStartTimes.set(printer.queue[0].job_id, now);
  }
}

function updateSnapshot(snapshot) {
  const processSignature = JSON.stringify([snapshot.processes, snapshot.runtime.scheduler_running, snapshot.scheduler]);
  const memorySignature = JSON.stringify([snapshot.memory.frames, snapshot.memory.page_tables, snapshot.memory.events, snapshot.memory.used, snapshot.memory.total]);
  const diskSignature = JSON.stringify([snapshot.disk.current_track, snapshot.disk.current_sector, snapshot.disk.queue, snapshot.disk.completed, snapshot.disk.fat, snapshot.disk.movement_log]);
  const printerSignature = JSON.stringify([snapshot.printer.queue, snapshot.printer.completed]);

  state.dirty.process ||= processSignature !== state.process.lastSignature;
  state.dirty.memory ||= memorySignature !== state.memory.lastSignature;
  state.dirty.disk ||= diskSignature !== state.disk.lastSignature;
  state.dirty.printer ||= printerSignature !== state.printer.lastSignature;
  state.dirty.stats = true;

  state.process.lastSignature = processSignature;
  state.memory.lastSignature = memorySignature;
  state.disk.lastSignature = diskSignature;
  state.printer.lastSignature = printerSignature;

  if (snapshot.disk.current_track !== state.disk.headTo) {
    state.disk.headFrom = state.disk.displayTrack;
    state.disk.headTo = snapshot.disk.current_track;
    state.disk.headStart = performance.now();
    state.disk.headDuration = snapshot.runtime.disk_interval_ms || 300;
  }

  collectMemoryFlashes(snapshot.memory, snapshot);
  updatePrinterProgressTracking(snapshot.printer);
  state.snapshot = snapshot;
}

function renderStats() {
  if (!state.snapshot) {
    return;
  }
  const { summary, memory, disk } = state.snapshot;
  elements.systemClock.textContent = state.clockText;
  elements.statTotalProcesses.textContent = String(summary.total_processes);
  elements.statMemory.textContent = `${formatUnits(memory.used)} / ${formatUnits(memory.total)}`;
  elements.statDiskHead.textContent = `T${disk.current_track}:S${disk.current_sector}`;
  const percentage = memory.total ? Math.min(100, (memory.used / memory.total) * 100) : 0;
  elements.memoryBatteryFill.style.width = `${percentage}%`;
}

function renderProcessPanel() {
  const snapshot = state.snapshot;
  elements.schedulerSelect.value = state.demo.schedulerPreviewValue || snapshot.scheduler.toLowerCase();
  elements.schedulerToggle.textContent = snapshot.runtime.scheduler_running ? "Pause Scheduler" : "Resume Scheduler";
  prepareProcessData(snapshot.processes);
  updateProcessSortButtons();
  renderProcessRows();
}

function renderMemoryPanel(now) {
  const memory = state.snapshot.memory;
  elements.memorySummary.textContent = `${Math.round(memory.used / memory.page_size)}/${memory.frame_count} frames in use | page size ${formatUnits(memory.page_size)}`;

  const legendFragment = document.createDocumentFragment();
  const usedPids = [...new Set(memory.frames.filter((frame) => frame.pid != null).map((frame) => frame.pid))];
  if (!usedPids.length) {
    const empty = document.createElement("div");
    empty.className = "memory-legend-item";
    empty.textContent = "No active pages loaded";
    legendFragment.appendChild(empty);
  } else {
    usedPids.forEach((pid) => {
      const item = document.createElement("div");
      item.className = "memory-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "memory-legend-swatch";
      swatch.style.background = pidColor(pid);
      const label = document.createElement("span");
      label.textContent = `PID ${pid}`;
      item.append(swatch, label);
      legendFragment.appendChild(item);
    });
  }
  elements.memoryLegend.replaceChildren(legendFragment);

  const pageTableFragment = document.createDocumentFragment();
  const pageTables = Object.entries(memory.page_tables);
  if (!pageTables.length) {
    const empty = document.createElement("div");
    empty.className = "page-table-card";
    empty.textContent = "No page tables loaded.";
    pageTableFragment.appendChild(empty);
  } else {
    pageTables.forEach(([pid, mappings]) => {
      const card = document.createElement("div");
      card.className = "page-table-card";
      const title = document.createElement("strong");
      title.textContent = `PID ${pid}`;
      const body = document.createElement("div");
      body.textContent = mappings.length ? mappings.map((entry) => `V${entry.virtual_page} -> F${entry.frame_number}`).join(", ") : "No mappings";
      card.append(title, body);
      pageTableFragment.appendChild(card);
    });
  }
  elements.pageTablePanel.replaceChildren(pageTableFragment);

  const eventFragment = document.createDocumentFragment();
  if (!memory.events.length) {
    const line = document.createElement("div");
    line.textContent = "No memory events yet.";
    eventFragment.appendChild(line);
  } else {
    memory.events.forEach((entry) => {
      const line = document.createElement("div");
      line.textContent = entry;
      eventFragment.appendChild(line);
    });
  }
  elements.memoryEvents.replaceChildren(eventFragment);

  renderMemoryFrames(memory, now);
}

function renderMemoryFrames(memory, now) {
  state.memory.flashes = state.memory.flashes.filter((flash) => now - flash.start < 550);
  const flashMap = new Map(state.memory.flashes.map((flash) => [flash.frame, flash.type]));
  const fragment = document.createDocumentFragment();
  memory.frames.forEach((frame) => {
    const card = document.createElement("div");
    card.className = "memory-frame";
    if (frame.pid == null) {
      card.classList.add("is-free");
    }
    const flashType = flashMap.get(frame.frame_number);
    if (flashType) {
      card.classList.add(flashType === "fault" ? "is-fault" : "is-eviction");
    }
    card.style.borderColor = frame.pid == null ? "" : pidColor(frame.pid);
    card.innerHTML = `
      <strong>F${frame.frame_number}</strong>
      <span>${frame.pid == null ? "FREE" : `PID ${frame.pid}`}</span>
      <span>${frame.virtual_page == null ? "VP -" : `VP ${frame.virtual_page}`}</span>
    `;
    fragment.appendChild(card);
  });
  elements.memoryFrameGrid.replaceChildren(fragment);

  if (state.memory.flashes.length) {
    queueRender();
  }
}

function drawDiskHeadCanvas(disk, now) {
  const canvas = elements.diskTrackCanvas;
  const resized = resizeCanvas(canvas);
  const context = canvas.getContext("2d");
  const dpr = getCanvasScale();
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = getThemeValue("--surface-strong");
  context.fillRect(0, 0, width, height);

  const padding = 24;
  const lineY = height / 2;
  context.strokeStyle = "rgba(255,255,255,0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(padding, lineY);
  context.lineTo(width - padding, lineY);
  context.stroke();

  for (let track = 0; track < disk.track_count; track += 1) {
    const x = padding + (track / Math.max(disk.track_count - 1, 1)) * (width - padding * 2);
    context.strokeStyle = "rgba(255,255,255,0.12)";
    context.beginPath();
    context.moveTo(x, lineY - 10);
    context.lineTo(x, lineY + 10);
    context.stroke();
  }

  const elapsed = Math.min(1, (now - state.disk.headStart) / Math.max(state.disk.headDuration, 1));
  state.disk.displayTrack = state.disk.headFrom + (state.disk.headTo - state.disk.headFrom) * elapsed;
  const headX = padding + (state.disk.displayTrack / Math.max(disk.track_count - 1, 1)) * (width - padding * 2);
  context.strokeStyle = getThemeValue("--accent");
  context.shadowColor = getThemeValue("--accent");
  context.shadowBlur = 16;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(headX, 18);
  context.lineTo(headX, height - 18);
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = getThemeValue("--text");
  context.font = "600 12px Segoe UI";
  context.fillText(`Head: T${disk.current_track}:S${disk.current_sector}`, 20, 20);

  if (resized || elapsed < 1) {
    queueRender();
  }
}

function drawSeekHistory(history, trackCount) {
  const canvas = elements.seekHistoryCanvas;
  resizeCanvas(canvas);
  const context = canvas.getContext("2d");
  const dpr = getCanvasScale();
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = getThemeValue("--surface-strong");
  context.fillRect(0, 0, width, height);

  const left = 42;
  const right = width - 16;
  const top = 18;
  const bottom = height - 26;
  context.strokeStyle = "rgba(255,255,255,0.16)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.lineTo(right, bottom);
  context.stroke();
  context.fillStyle = getThemeValue("--muted");
  context.font = "11px Segoe UI";
  context.fillText("Track", 8, top + 6);
  context.fillText("Time", right - 28, height - 8);

  if (!history.length) {
    return;
  }
  const points = history.map((value, index) => ({
    x: left + (index / Math.max(history.length - 1, 1)) * (right - left),
    y: bottom - (value / Math.max(trackCount - 1, 1)) * (bottom - top),
  }));
  context.strokeStyle = getThemeValue("--accent");
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    context.bezierCurveTo(midX, current.y, midX, next.y, next.x, next.y);
  }
  context.stroke();
}

function renderDiskTables(disk) {
  const queueFragment = document.createDocumentFragment();
  if (!disk.queue.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="5">No pending requests.</td>';
    queueFragment.appendChild(row);
  } else {
    disk.queue.forEach((request) => {
      const row = document.createElement("tr");
      row.className = request.operation === "READ" ? "op-read" : "op-write";
      ["request_id", "track", "sector", "operation", "process_id"].forEach((field) => {
        const cell = document.createElement("td");
        cell.textContent = String(request[field]);
        row.appendChild(cell);
      });
      queueFragment.appendChild(row);
    });
  }
  elements.diskQueueTable.replaceChildren(queueFragment);

  const completedFragment = document.createDocumentFragment();
  if (!disk.completed.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="5">No completed requests yet.</td>';
    completedFragment.appendChild(row);
  } else {
    disk.completed.forEach((request) => {
      const row = document.createElement("tr");
      row.className = request.operation === "READ" ? "op-read" : "op-write";
      ["request_id", "track", "sector", "operation", "process_id"].forEach((field) => {
        const cell = document.createElement("td");
        cell.textContent = String(request[field]);
        row.appendChild(cell);
      });
      completedFragment.appendChild(row);
    });
  }
  elements.diskCompletedTable.replaceChildren(completedFragment);

  const fatFragment = document.createDocumentFragment();
  const fatEntries = Object.entries(disk.fat);
  if (!fatEntries.length) {
    const empty = document.createElement("div");
    empty.className = "fat-file";
    empty.textContent = "No files allocated on disk.";
    fatFragment.appendChild(empty);
  } else {
    fatEntries.forEach(([name, sectors]) => {
      const item = document.createElement("div");
      item.className = "fat-file";
      const title = document.createElement("strong");
      title.textContent = name;
      const detail = document.createElement("div");
      detail.textContent = `${sectors.length} sector(s): ${sectors.map((sector) => `T${sector.track}:S${sector.sector}`).join(", ")}`;
      item.append(title, detail);
      fatFragment.appendChild(item);
    });
  }
  elements.fatPanel.replaceChildren(fatFragment);

  const logFragment = document.createDocumentFragment();
  if (!disk.movement_log.length) {
    const empty = document.createElement("div");
    empty.textContent = "No disk movement logged yet.";
    logFragment.appendChild(empty);
  } else {
    disk.movement_log.forEach((line) => {
      const item = document.createElement("div");
      item.textContent = line;
      logFragment.appendChild(item);
    });
  }
  elements.diskMovementLog.replaceChildren(logFragment);
}

function renderDiskPanel(now) {
  const disk = state.snapshot.disk;
  elements.diskToggle.textContent = state.snapshot.runtime.disk_running ? "Pause Disk" : "Resume Disk";
  drawDiskHeadCanvas(disk, now);
  drawSeekHistory(disk.seek_history, disk.track_count);
  renderDiskTables(disk);
}

function renderPrinterPanel(now) {
  const printer = state.snapshot.printer;
  const fragment = document.createDocumentFragment();
  const printingId = printer.queue[0]?.job_id || "";
  const jobs = [...printer.queue, ...printer.completed];

  if (!jobs.length) {
    const empty = document.createElement("div");
    empty.className = "printer-job";
    empty.textContent = "No print jobs.";
    fragment.appendChild(empty);
  } else {
    jobs.forEach((job) => {
      const card = document.createElement("div");
      card.className = "printer-job";
      const header = document.createElement("div");
      header.className = "printer-job-header";
      const meta = document.createElement("div");
      meta.className = "printer-meta";
      const title = document.createElement("strong");
      title.textContent = job.document_name;
      const detail = document.createElement("span");
      detail.textContent = `${job.job_id} | ${job.size_pages} pages`;
      meta.append(title, detail);

      const badge = document.createElement("span");
      let progress = 0;
      if (printer.completed.some((completed) => completed.job_id === job.job_id)) {
        badge.className = "job-badge done";
        badge.textContent = "DONE";
        progress = 100;
      } else if (job.job_id === printingId) {
        badge.className = "job-badge printing";
        const dot = document.createElement("span");
        dot.className = "pulse-dot";
        badge.append(dot, document.createTextNode("PRINTING"));
        const start = state.printer.queuedStartTimes.get(job.job_id) || now;
        progress = Math.min(95, ((now - start) / CONFIG.printDurationMs) * 100);
      } else {
        badge.className = "job-badge queued";
        badge.textContent = "QUEUED";
      }

      header.append(meta, badge);
      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      fill.style.width = `${progress}%`;
      track.appendChild(fill);
      card.append(header, track);
      fragment.appendChild(card);
    });
  }
  elements.printerJobs.replaceChildren(fragment);
}

function renderFrame(now) {
  state.renderRequested = false;
  if (state.pendingSnapshot) {
    updateSnapshot(state.pendingSnapshot);
    state.pendingSnapshot = null;
  }
  if (!state.snapshot) {
    return;
  }

  if (state.dirty.taskbar) {
    rebuildTaskbar();
    state.dirty.taskbar = false;
  }
  if (state.dirty.stats) {
    renderStats();
    state.dirty.stats = false;
  }
  if (state.dirty.process) {
    renderProcessPanel();
    state.dirty.process = false;
  } else if (state.process.needsRowRender) {
    renderProcessRows();
  }
  if (state.dirty.memory || state.memory.flashes.length) {
    renderMemoryPanel(now);
    state.dirty.memory = false;
  }
  if (state.dirty.disk || now - state.disk.headStart < state.disk.headDuration) {
    renderDiskPanel(now);
    state.dirty.disk = false;
  }
  if (state.dirty.printer) {
    renderPrinterPanel(now);
    state.dirty.printer = false;
  }
}

function initCanvasObservers() {
  if (typeof ResizeObserver === "undefined") {
    return;
  }
  const observer = new ResizeObserver(() => {
    state.dirty.disk = true;
    queueRender();
  });
  [elements.diskTrackCanvas.parentElement, elements.seekHistoryCanvas.parentElement]
    .filter(Boolean)
    .forEach((node) => observer.observe(node));
  state.memory.resizeObserver = observer;
}

function applySnapshot(snapshot) {
  state.pendingSnapshot = snapshot;
  queueRender();
  return snapshot;
}

function loadState() {
  if (document.hidden || state.fetchInFlight) {
    return Promise.resolve(state.snapshot);
  }
  state.fetchInFlight = true;
  return fetch("/api/state")
    .then((response) => response.json())
    .then((snapshot) => {
      applySnapshot(snapshot);
      return snapshot;
    })
    .catch(() => {})
    .finally(() => {
      state.fetchInFlight = false;
    });
}

function runAction(path, payload = {}) {
  return apiRequest(path, payload).then((data) => {
    applySnapshot(data.state);
    return data;
  });
}

function setDemoBadgeHost(host) {
  if (!state.demo.activeBadge) {
    return;
  }
  host.appendChild(state.demo.activeBadge);
}

function positionDemoBadge() {
  if (!state.demo.activeBadge) {
    return;
  }
  const currentWindow = state.demo.activeBadge.dataset.windowId;
  if (currentWindow && state.windows[currentWindow]) {
    state.windows[currentWindow].node.appendChild(state.demo.activeBadge);
  }
}

function showDemoBadge(message, windowId = "") {
  if (!state.demo.activeBadge) {
    state.demo.activeBadge = document.createElement("div");
    state.demo.activeBadge.className = "window-step-badge";
  }
  state.demo.activeBadge.textContent = message;
  state.demo.activeBadge.dataset.windowId = windowId;
  if (windowId && state.windows[windowId]) {
    setDemoBadgeHost(state.windows[windowId].node);
  } else {
    setDemoBadgeHost(elements.desktop);
  }
}

function clearDemoBadge() {
  if (state.demo.activeBadge?.parentNode) {
    state.demo.activeBadge.parentNode.removeChild(state.demo.activeBadge);
  }
}

function showDemoToast(message, durationMs = 3000) {
  window.clearTimeout(state.demo.toastTimer);
  elements.demoToast.textContent = message;
  elements.demoToast.classList.remove("hidden");
  state.demo.toastTimer = window.setTimeout(() => {
    elements.demoToast.classList.add("hidden");
  }, durationMs);
}

function clearDemoToast() {
  window.clearTimeout(state.demo.toastTimer);
  elements.demoToast.classList.add("hidden");
}

function stopDemo() {
  if (!state.demo.running) {
    return;
  }
  state.demo.token += 1;
  state.demo.running = false;
  elements.skipDemoButton.classList.add("hidden");
  clearDemoBadge();
  clearDemoToast();
}

function ensureDemoActive(token) {
  if (!state.demo.running || state.demo.token !== token) {
    throw new Error("demo-stopped");
  }
}

function demoWait(ms, token) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    function tick() {
      try {
        ensureDemoActive(token);
      } catch (error) {
        reject(error);
        return;
      }
      if (performance.now() - start >= ms) {
        resolve();
        return;
      }
      window.setTimeout(tick, Math.min(120, ms));
    }
    tick();
  });
}

async function waitForCondition(check, timeoutMs, intervalMs, token) {
  const start = performance.now();
  while (performance.now() - start <= timeoutMs) {
    ensureDemoActive(token);
    if (await check()) {
      return true;
    }
    await demoWait(intervalMs, token);
  }
  return false;
}

function tileDemoWindows() {
  const bounds = getWindowBounds();
  const margin = 8;
  const width = Math.floor(bounds.width * 0.48);
  const height = Math.floor(bounds.height * 0.46);
  const positions = [
    { id: "process-manager", x: margin, y: margin },
    { id: "memory-manager", x: bounds.width - width - margin, y: margin },
    { id: "disk-manager", x: margin, y: bounds.height - height - margin },
    { id: "printer-manager", x: bounds.width - width - margin, y: bounds.height - height - margin },
  ];
  positions.forEach(({ id, x, y }) => {
    const model = state.windows[id];
    model.maximized = false;
    model.x = x;
    model.y = y;
    model.width = width;
    model.height = height;
    clampWindow(model);
    setWindowRect(model.node, model);
  });
  state.dirty.process = true;
  state.process.needsRowRender = true;
  state.dirty.memory = true;
  state.dirty.disk = true;
  state.dirty.printer = true;
  queueRender();
}

async function startDemo() {
  if (state.demo.running) {
    return;
  }
  state.demo.running = true;
  state.demo.token += 1;
  state.demo.processIds = [];
  elements.skipDemoButton.classList.remove("hidden");
  clearDemoToast();
  closeStartMenu();
  const token = state.demo.token;
  try {
    showDemoBadge("Opening all module windows");
    ["process-manager", "memory-manager", "disk-manager", "printer-manager"].forEach((id) => openWindow(id, "is-opening"));
    tileDemoWindows();
    focusWindow("process-manager");
    await demoWait(800, token);

    showDemoBadge("Creating processes — scheduler running in real time", "process-manager");
    const demoProcesses = [
      { name: "SystemInit", memory: 2048, priority: 1, cpu: 4 },
      { name: "UserApp", memory: 4096, priority: 3, cpu: 6 },
      { name: "BackgroundSync", memory: 1024, priority: 2, cpu: 5 },
      { name: "NetworkDaemon", memory: 3072, priority: 2, cpu: 5 },
    ];
    for (const entry of demoProcesses) {
      ensureDemoActive(token);
      elements.processName.value = entry.name;
      elements.processMemory.value = String(entry.memory);
      elements.processPriority.value = String(entry.priority);
      const response = await runAction("/api/process/create", {
        name: entry.name,
        memory: entry.memory,
        cpu_time: entry.cpu,
      });
      const created = response.state.processes.find((process) => process.name === entry.name);
      if (created) {
        state.demo.processIds.push(created.pid);
      }
      await demoWait(200, token);
    }
    await demoWait(2000, token);

    const latestSnapshot = (await loadState()) || state.snapshot;
    showDemoBadge("Accessing memory pages — LRU page replacement active", "memory-manager");
    for (const pid of state.demo.processIds) {
      ensureDemoActive(token);
      await runAction("/api/memory/access", {
        pid,
        virtual_address: 0,
      });
      await demoWait(500, token);
    }
    const processOne = latestSnapshot?.processes.find((process) => process.pid === state.demo.processIds[0]);
    const invalidAddress = processOne
      ? Math.ceil(processOne.memory_required / latestSnapshot.memory.page_size) * latestSnapshot.memory.page_size
      : 999999;
    await runAction("/api/memory/access", {
      pid: state.demo.processIds[0] || 1,
      virtual_address: invalidAddress,
    });
    await demoWait(1200, token);

    showDemoBadge("Creating and accessing disk files — LOOK algorithm scheduling requests", "disk-manager");
    await runAction("/api/disk/file/create", { filename: "demo.txt", size_sectors: 6 });
    await runAction("/api/disk/file/read", { filename: "demo.txt", pid: state.demo.processIds[0] || 1 });
    await runAction("/api/disk/file/write", { filename: "demo.txt", pid: state.demo.processIds[1] || 2 });
    await waitForCondition(async () => {
      const snapshot = await loadState();
      return Boolean(snapshot && snapshot.disk.queue.length === 0);
    }, 20000, 300, token);

    showDemoBadge("Queuing print jobs — spooler processing in order", "printer-manager");
    const jobs = [
      { job_id: "JOB-DEMO-1", document_name: "Report.pdf", size_pages: 4 },
      { job_id: "JOB-DEMO-2", document_name: "Presentation.pptx", size_pages: 12 },
      { job_id: "JOB-DEMO-3", document_name: "Invoice.docx", size_pages: 1 },
    ];
    for (const job of jobs) {
      ensureDemoActive(token);
      await runAction("/api/printer/submit", job);
      await demoWait(150, token);
    }
    for (let index = 0; index < jobs.length; index += 1) {
      await demoWait(CONFIG.printDurationMs, token);
      await runAction("/api/printer/process", {});
    }

    clearDemoBadge();
    showDemoToast("Demo complete — all systems operational");
  } catch (error) {
    if (error.message !== "demo-stopped") {
      throw error;
    }
  } finally {
    if (state.demo.token === token) {
      state.demo.running = false;
      elements.skipDemoButton.classList.add("hidden");
      clearDemoBadge();
    }
  }
}

function showDemoToast(message, durationMs = 4000) {
  window.clearTimeout(state.demo.toastTimer);
  elements.demoToast.textContent = message;
  elements.demoToast.classList.remove("hidden");
  window.requestAnimationFrame(() => elements.demoToast.classList.add("is-visible"));
  state.demo.toastTimer = window.setTimeout(() => {
    elements.demoToast.classList.remove("is-visible");
    window.setTimeout(() => elements.demoToast.classList.add("hidden"), state.ui.reducedEffects ? 0 : 300);
  }, durationMs);
}

function clearDemoToast() {
  window.clearTimeout(state.demo.toastTimer);
  elements.demoToast.classList.remove("is-visible");
  elements.demoToast.classList.add("hidden");
}

function ensureDemoActive(token) {
  if (!state.demo.running || state.demo.token !== token) {
    throw new Error("demo-stopped");
  }
}

function getDemoElapsedMs() {
  if (!state.demo.currentStepDuration) {
    return 0;
  }
  if (state.demo.paused) {
    return state.demo.stepElapsedBeforePause;
  }
  return state.demo.stepElapsedBeforePause + Math.max(0, performance.now() - state.demo.stepStartedAt);
}

function stopDemoProgress(complete = false) {
  if (state.demo.progressRaf) {
    window.cancelAnimationFrame(state.demo.progressRaf);
    state.demo.progressRaf = 0;
  }
  if (complete && state.demo.currentStepDuration) {
    elements.presentationProgressFill.style.width = "100%";
  }
}

function tickDemoProgress() {
  if (!state.demo.running || state.demo.paused || !state.demo.currentStepDuration) {
    state.demo.progressRaf = 0;
    return;
  }
  const progress = Math.min(1, getDemoElapsedMs() / state.demo.currentStepDuration);
  elements.presentationProgressFill.style.width = `${progress * 100}%`;
  state.demo.progressRaf = window.requestAnimationFrame(tickDemoProgress);
}

function startDemoProgress(durationMs) {
  stopDemoProgress();
  state.demo.currentStepDuration = durationMs;
  state.demo.stepElapsedBeforePause = 0;
  state.demo.stepStartedAt = performance.now();
  elements.presentationProgressFill.style.width = "0%";
  state.demo.progressRaf = window.requestAnimationFrame(tickDemoProgress);
}

function updatePresentationControls() {
  elements.presentationPause.classList.toggle("hidden", state.demo.paused);
  elements.presentationResume.classList.toggle("hidden", !state.demo.paused);
  elements.presentationPausedLabel.classList.toggle("hidden", !state.demo.paused);
}

function setPresentationOverlay(alpha) {
  elements.presentationOverlay.style.background = `rgba(0, 0, 0, ${alpha})`;
}

function showPresentationShell() {
  elements.presentationOverlay.classList.remove("hidden");
  elements.presentationHud.classList.remove("hidden");
  elements.presentationNarration.classList.remove("hidden");
  updatePresentationControls();
  window.requestAnimationFrame(() => {
    elements.presentationOverlay.classList.add("is-visible");
    elements.presentationHud.classList.add("is-visible");
  });
}

async function hidePresentationShell() {
  elements.presentationNarration.classList.remove("is-visible");
  elements.presentationHud.classList.remove("is-visible");
  elements.presentationOverlay.classList.remove("is-visible");
  await new Promise((resolve) => window.setTimeout(resolve, state.ui.reducedEffects ? 0 : 600));
  elements.presentationNarration.classList.add("hidden");
  elements.presentationHud.classList.add("hidden");
  elements.presentationOverlay.classList.add("hidden");
}

async function fadeOutNarration(token) {
  if (elements.presentationNarration.classList.contains("hidden") || !elements.presentationNarration.classList.contains("is-visible")) {
    return;
  }
  elements.presentationNarration.classList.remove("is-visible");
  await demoWait(state.ui.reducedEffects ? 0 : 200, token, { allowSkip: false });
}

async function fadeInNarration(token) {
  elements.presentationNarration.classList.remove("hidden");
  window.requestAnimationFrame(() => elements.presentationNarration.classList.add("is-visible"));
  await demoWait(state.ui.reducedEffects ? 0 : 300, token, { allowSkip: false });
}

function clearPulseHighlights() {
  while (state.demo.pulseCleanups.length) {
    const cleanup = state.demo.pulseCleanups.pop();
    cleanup();
  }
  hideDiskHeadMarker();
}

function pulseElement(element, durationMs = 1500) {
  if (!element) {
    return () => {};
  }
  let cleared = false;
  let timeoutId = 0;
  element.classList.add("demo-pulse-highlight");
  const cleanup = () => {
    if (cleared) {
      return;
    }
    cleared = true;
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    element.classList.remove("demo-pulse-highlight");
  };
  state.demo.pulseCleanups.push(cleanup);
  if (durationMs > 0) {
    timeoutId = window.setTimeout(cleanup, durationMs);
  }
  return cleanup;
}

function ensureDiskHeadMarker() {
  if (!state.demo.canvasMarker) {
    const marker = document.createElement("div");
    marker.className = "demo-canvas-marker hidden";
    elements.diskTrackCanvas.parentElement.appendChild(marker);
    state.demo.canvasMarker = marker;
  }
  return state.demo.canvasMarker;
}

function positionDiskHeadMarker() {
  if (!state.snapshot?.disk) {
    return;
  }
  const marker = ensureDiskHeadMarker();
  const hostRect = elements.diskTrackCanvas.parentElement.getBoundingClientRect();
  const canvasRect = elements.diskTrackCanvas.getBoundingClientRect();
  const padding = 24;
  const ratio = state.disk.displayTrack / Math.max(state.snapshot.disk.track_count - 1, 1);
  const x = (canvasRect.left - hostRect.left) + padding + ratio * Math.max(0, canvasRect.width - padding * 2);
  const y = (canvasRect.top - hostRect.top) + (canvasRect.height / 2);
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
}

function hideDiskHeadMarker() {
  if (state.demo.markerRaf) {
    window.cancelAnimationFrame(state.demo.markerRaf);
    state.demo.markerRaf = 0;
  }
  if (state.demo.canvasMarker) {
    state.demo.canvasMarker.classList.add("hidden");
  }
}

function showDiskHeadMarker() {
  const marker = ensureDiskHeadMarker();
  marker.classList.remove("hidden");
  const tick = () => {
    if (!state.demo.running && !state.demo.cleaning) {
      state.demo.markerRaf = 0;
      return;
    }
    positionDiskHeadMarker();
    state.demo.markerRaf = window.requestAnimationFrame(tick);
  };
  tick();
}

function setSpotlightWindow(windowId = "") {
  state.demo.spotlightWindowId = windowId;
  if (windowId) {
    focusWindow(windowId);
  } else {
    blurWindows();
  }
  reassignZIndices();
}

function removePriorityDemoOption() {
  const option = elements.schedulerSelect.querySelector('option[value="priority-demo"]');
  if (option) {
    option.remove();
  }
  state.demo.priorityOptionInjected = false;
  state.demo.schedulerPreviewValue = "";
}

function ensurePriorityDemoOption() {
  if (elements.schedulerSelect.querySelector('option[value="priority-demo"]')) {
    return;
  }
  const option = document.createElement("option");
  option.value = "priority-demo";
  option.textContent = "Priority Scheduling";
  elements.schedulerSelect.appendChild(option);
  state.demo.priorityOptionInjected = true;
}

async function demoWait(ms, token, options = {}) {
  const { allowSkip = true } = options;
  let remaining = ms;
  let last = performance.now();
  while (remaining > 0) {
    ensureDemoActive(token);
    if (allowSkip && state.demo.skipRequested) {
      return false;
    }
    if (state.demo.paused) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      last = performance.now();
      continue;
    }
    const slice = Math.min(remaining, 90);
    await new Promise((resolve) => window.setTimeout(resolve, slice));
    const now = performance.now();
    remaining -= now - last;
    last = now;
  }
  return true;
}

async function waitForCondition(check, timeoutMs, intervalMs, token) {
  let remaining = timeoutMs;
  while (remaining >= 0) {
    ensureDemoActive(token);
    if (await check()) {
      return true;
    }
    const continued = await demoWait(Math.min(intervalMs, Math.max(remaining, 0)), token);
    if (!continued) {
      return false;
    }
    remaining -= intervalMs;
  }
  return false;
}

function tileDemoWindows() {
  const bounds = getWindowBounds();
  const margin = 8;
  const width = Math.floor(bounds.width * 0.48);
  const height = Math.floor(bounds.height * 0.46);
  const positions = [
    { id: "process-manager", x: margin, y: margin },
    { id: "memory-manager", x: bounds.width - width - margin, y: margin },
    { id: "disk-manager", x: margin, y: bounds.height - height - margin },
    { id: "printer-manager", x: bounds.width - width - margin, y: bounds.height - height - margin },
  ];
  positions.forEach(({ id, x, y }) => {
    const model = state.windows[id];
    model.maximized = false;
    model.x = x;
    model.y = y;
    model.width = width;
    model.height = height;
    clampWindow(model);
    setWindowRect(model.node, model);
  });
  state.dirty.process = true;
  state.process.needsRowRender = true;
  state.dirty.memory = true;
  state.dirty.disk = true;
  state.dirty.printer = true;
  queueRender();
}

function preparePresentationWindows() {
  ["process-manager", "memory-manager", "disk-manager", "printer-manager"].forEach((id) => openWindow(id, "is-opening"));
  tileDemoWindows();
}

function queryWindowElement(windowId, selector) {
  return state.windows[windowId]?.node.querySelector(selector) || null;
}

function findPageTableCard(pid) {
  return [...elements.pageTablePanel.querySelectorAll(".page-table-card")]
    .find((card) => card.querySelector("strong")?.textContent === `PID ${pid}`) || null;
}

function setPresentationStep(step, index, total) {
  state.demo.currentStepIndex = index;
  elements.presentationStepCounter.textContent = `Step ${index + 1} of ${total}`;
  elements.presentationStepTitle.textContent = step.title;
  elements.presentationNarrationText.textContent = step.narration;
}

async function beginPresentationStep(step, index, total, token) {
  state.demo.skipRequested = false;
  await fadeOutNarration(token);
  clearPulseHighlights();
  setPresentationOverlay(step.overlayAlpha ?? 0.45);
  setPresentationStep(step, index, total);
  setSpotlightWindow(step.spotlightWindowId || "");
  await demoWait(state.ui.reducedEffects ? 0 : 400, token, { allowSkip: false });
  updatePresentationControls();
  await fadeInNarration(token);
  startDemoProgress(step.durationMs);
}

function pauseDemo() {
  if (!state.demo.running || state.demo.paused) {
    return;
  }
  state.demo.stepElapsedBeforePause = getDemoElapsedMs();
  state.demo.paused = true;
  stopDemoProgress();
  updatePresentationControls();
}

function resumeDemo() {
  if (!state.demo.running || !state.demo.paused) {
    return;
  }
  state.demo.paused = false;
  state.demo.stepStartedAt = performance.now();
  updatePresentationControls();
  state.demo.progressRaf = window.requestAnimationFrame(tickDemoProgress);
}

function requestSkipStep() {
  if (!state.demo.running) {
    return;
  }
  state.demo.skipRequested = true;
  stopDemoProgress(true);
}

async function finishDemoPresentation(options = {}) {
  if (state.demo.cleaning) {
    return;
  }
  state.demo.cleaning = true;
  stopDemoProgress();
  clearPulseHighlights();
  setSpotlightWindow("");
  removePriorityDemoOption();
  elements.presentationPausedLabel.classList.add("hidden");
  state.demo.paused = false;
  await hidePresentationShell();
  state.demo.cleaning = false;
  reassignZIndices();
  if (options.toastMessage) {
    showDemoToast(options.toastMessage, options.toastDurationMs || 4000);
  }
  if (state.snapshot) {
    elements.schedulerSelect.value = state.snapshot.scheduler.toLowerCase();
  }
}

function endDemo() {
  if (!state.demo.running) {
    return;
  }
  const currentToken = state.demo.token;
  state.demo.running = false;
  state.demo.token += 1;
  state.demo.skipRequested = false;
  finishDemoPresentation().finally(() => {
    if (state.demo.token === currentToken + 1) {
      state.demo.currentStepIndex = -1;
      state.demo.currentStepDuration = 0;
    }
  });
}

async function createDemoProcess(entry) {
  elements.processName.value = entry.name;
  elements.processMemory.value = String(entry.memory);
  elements.processPriority.value = String(entry.priority);
  elements.processCpu.value = String(entry.cpu);
  const response = await runAction("/api/process/create", {
    name: entry.name,
    memory: entry.memory,
    cpu_time: entry.cpu,
  });
  const created = response.state.processes
    .filter((process) => process.name === entry.name)
    .sort((left, right) => right.pid - left.pid)[0];
  if (created && !state.demo.processIds.includes(created.pid)) {
    state.demo.processIds.push(created.pid);
  }
}

function getPrimaryDemoPid(position, fallback) {
  return state.demo.processIds[position] || fallback;
}

async function applySchedulerMode(mode) {
  if (mode === "priority-demo") {
    ensurePriorityDemoOption();
    state.demo.schedulerPreviewValue = "priority-demo";
    elements.schedulerSelect.value = "priority-demo";
    return;
  }
  state.demo.schedulerPreviewValue = "";
  elements.schedulerSelect.value = mode;
  await runAction("/api/scheduler", { scheduler: mode });
}

async function ensureDiskFile(filename, sizeSectors) {
  const snapshot = state.snapshot || await loadState();
  if (snapshot?.disk?.fat?.[filename]) {
    return snapshot;
  }
  try {
    const response = await runAction("/api/disk/file/create", { filename, size_sectors: sizeSectors });
    return response.state;
  } catch (error) {
    const latest = await loadState();
    if (latest?.disk?.fat?.[filename]) {
      return latest;
    }
    throw error;
  }
}

async function runWelcomeStep(token) {
  preparePresentationWindows();
  await demoWait(4000, token);
}

async function runProcessSchedulerStep(token) {
  const createButton = document.getElementById("create-process");
  pulseElement(createButton, 1500);
  const processes = [
    { name: "SystemInit", memory: 2048, priority: 1, cpu: 4 },
    { name: "UserApp", memory: 4096, priority: 3, cpu: 6 },
    { name: "BackgroundSync", memory: 1024, priority: 2, cpu: 5 },
    { name: "NetworkDaemon", memory: 3072, priority: 2, cpu: 5 },
  ];
  let index = 0;
  for (; index < processes.length; index += 1) {
    await createDemoProcess(processes[index]);
    if (index < processes.length - 1) {
      const continued = await demoWait(1000, token);
      if (!continued) {
        break;
      }
    }
  }
  if (state.demo.skipRequested) {
    for (let remainder = index + 1; remainder < processes.length; remainder += 1) {
      await createDemoProcess(processes[remainder]);
    }
    return;
  }
  const keptRunning = await demoWait(4000, token);
  if (!keptRunning) {
    return;
  }
  pulseElement(queryWindowElement("process-manager", '[data-sort-key="state"]'), 1500);
  pulseElement(queryWindowElement("process-manager", '[data-sort-key="cpu_percent"]'), 1500);
  await demoWait(1500, token);
}

async function runSchedulingAlgorithmsStep(token) {
  pulseElement(elements.schedulerSelect, 1500);
  await applySchedulerMode("rr");
  if (!(await demoWait(2000, token))) {
    await applySchedulerMode("fcfs");
    return;
  }
  await applySchedulerMode("priority-demo");
  if (!(await demoWait(2000, token))) {
    await applySchedulerMode("fcfs");
    return;
  }
  await applySchedulerMode("fcfs");
  await demoWait(2000, token);
}

async function runMemoryManagementStep(token) {
  pulseElement(elements.memoryFrameGrid, 1500);
  let index = 0;
  for (; index < 4; index += 1) {
    const pid = getPrimaryDemoPid(index, index + 1);
    await runAction("/api/memory/access", {
      pid,
      virtual_address: 0,
    });
    if (index < 3 && !(await demoWait(600, token))) {
      break;
    }
  }
  const pageSize = Number(state.snapshot?.memory?.page_size || 1024);
  if (state.demo.skipRequested) {
    for (let remainder = index + 1; remainder < 4; remainder += 1) {
      await runAction("/api/memory/access", {
        pid: getPrimaryDemoPid(remainder, remainder + 1),
        virtual_address: 0,
      });
    }
  }
  await runAction("/api/memory/access", {
    pid: getPrimaryDemoPid(0, 1),
    virtual_address: pageSize * 99,
  });
  if (state.demo.skipRequested) {
    return;
  }
  await waitForCondition(
    () => Promise.resolve(Boolean(elements.memoryFrameGrid.querySelector(".memory-frame.is-eviction"))),
    1800,
    90,
    token,
  );
  pulseElement(elements.memoryFrameGrid.querySelector(".memory-frame.is-eviction"), 1000);
  elements.memoryEvents.closest("details").open = true;
  elements.memoryEvents.scrollIntoView({ block: "nearest" });
  pulseElement(elements.memoryEvents, 1800);
  await demoWait(4200, token);
}

async function runPageTableInspectionStep(token) {
  elements.pageTablePanel.closest("details").open = true;
  const pid = state.snapshot?.memory?.page_tables?.["1"] ? 1 : getPrimaryDemoPid(0, 1);
  await waitForCondition(() => Promise.resolve(Boolean(findPageTableCard(pid))), 1200, 90, token);
  pulseElement(findPageTableCard(pid), 3000);
  await demoWait(6000, token);
}

async function runDiskManagementStep(token) {
  pulseElement(elements.diskFileName, 1500);
  pulseElement(document.getElementById("disk-create-file"), 1500);
  elements.diskFileName.value = "report.txt";
  elements.diskFileSize.value = "6";
  elements.diskFilePid.value = String(getPrimaryDemoPid(0, 1));
  await ensureDiskFile("report.txt", 6);
  pulseElement(elements.fatPanel, 1500);
  await demoWait(1000, token);
  await runAction("/api/disk/file/read", {
    filename: "report.txt",
    pid: getPrimaryDemoPid(0, 1),
  });
  await runAction("/api/disk/file/write", {
    filename: "report.txt",
    pid: getPrimaryDemoPid(1, 2),
  });
  pulseElement(elements.diskTrackCanvas.parentElement, 1800);
  showDiskHeadMarker();
  await waitForCondition(
    async () => {
      const snapshot = await loadState();
      return Boolean(snapshot && snapshot.disk.seek_history.length >= 5);
    },
    8000,
    200,
    token,
  );
  pulseElement(elements.seekHistoryCanvas.parentElement, 1500);
  await waitForCondition(
    async () => {
      const snapshot = await loadState();
      return Boolean(snapshot && snapshot.disk.queue.length === 0);
    },
    12000,
    240,
    token,
  );
}

async function runPrinterSpoolerStep(token) {
  pulseElement(queryWindowElement("printer-manager", ".window-toolbar"), 1500);
  const baseStamp = Date.now();
  const jobs = [
    { job_id: `DEMO-AR-${baseStamp}`, document_name: "AnnualReport.pdf", size_pages: 8 },
    { job_id: `DEMO-PS-${baseStamp + 1}`, document_name: "ProjectSlides.pptx", size_pages: 15 },
    { job_id: `DEMO-SM-${baseStamp + 2}`, document_name: "Summary.docx", size_pages: 2 },
  ];
  let index = 0;
  for (; index < jobs.length; index += 1) {
    await runAction("/api/printer/submit", jobs[index]);
    if (index < jobs.length - 1 && !(await demoWait(800, token))) {
      break;
    }
  }
  if (state.demo.skipRequested) {
    for (let remainder = index + 1; remainder < jobs.length; remainder += 1) {
      await runAction("/api/printer/submit", jobs[remainder]);
    }
  }
  pulseElement(elements.printerJobs, 1800);
  if (state.demo.skipRequested) {
    await runAction("/api/printer/process", {});
    return;
  }
  await demoWait(1200, token);
  await demoWait(CONFIG.printDurationMs, token);
  await runAction("/api/printer/process", {});
  await waitForCondition(
    () => Promise.resolve(Boolean([...elements.printerJobs.querySelectorAll(".job-badge.done")].length)),
    1200,
    90,
    token,
  );
  const firstDone = elements.printerJobs.querySelector(".job-badge.done")?.closest(".printer-job");
  pulseElement(firstDone, 1200);
  await demoWait(2400, token);
}

async function runSummaryStep(token) {
  setPresentationOverlay(0.25);
  setSpotlightWindow("");
  await demoWait(5000, token);
}

async function startDemo() {
  if (state.demo.running || state.demo.cleaning) {
    return;
  }
  state.demo.running = true;
  state.demo.token += 1;
  state.demo.paused = false;
  state.demo.skipRequested = false;
  state.demo.processIds = [];
  state.demo.currentStepIndex = -1;
  clearDemoToast();
  closeStartMenu();
  showPresentationShell();
  const token = state.demo.token;
  const steps = [
    {
      title: "Welcome",
      durationMs: 4000,
      spotlightWindowId: "",
      narration: "Welcome to the OS Simulator - a browser-based demonstration of how a real operating system manages processes, memory, disk I/O, and printing. Use the HUD controls to pause or skip at any time.",
      run: runWelcomeStep,
    },
    {
      title: "Process Scheduler",
      durationMs: 10000,
      spotlightWindowId: "process-manager",
      narration: "The Process Scheduler manages all running programs. Here we are creating four processes - each is assigned a name, memory requirement, and priority. The scheduler cycles through them in real time, updating their state and CPU usage automatically.",
      run: runProcessSchedulerStep,
    },
    {
      title: "Scheduling Algorithms",
      durationMs: 8000,
      spotlightWindowId: "process-manager",
      narration: "The simulator supports multiple scheduling algorithms. Switching between Round Robin, Priority Scheduling, and First-Come-First-Served changes how the CPU is allocated to each process - you can see the process order and state update immediately.",
      run: runSchedulingAlgorithmsStep,
    },
    {
      title: "Memory Management",
      durationMs: 12000,
      spotlightWindowId: "memory-manager",
      narration: "Memory Management divides physical RAM into fixed frames. Each process is assigned pages that map to physical frames. When all frames are full and a new page is needed, the LRU algorithm evicts the least recently used page - this is called a page fault. Watch the event log for eviction and fault events.",
      run: runMemoryManagementStep,
    },
    {
      title: "Page Table Inspection",
      durationMs: 6000,
      spotlightWindowId: "memory-manager",
      narration: "Each process has its own page table - a map from virtual page numbers to physical frame numbers. This is how processes are isolated from each other: every process sees its own address space, and the OS translates addresses behind the scenes.",
      run: runPageTableInspectionStep,
    },
    {
      title: "Disk Management",
      durationMs: 12000,
      spotlightWindowId: "disk-manager",
      narration: "The Disk Manager simulates a physical hard drive with tracks and sectors. Files are allocated across sectors in a file allocation table. Read and write operations queue disk requests - the LOOK scheduling algorithm moves the disk head efficiently back and forth to service them, minimizing seek time.",
      run: runDiskManagementStep,
    },
    {
      title: "Printer Spooler",
      durationMs: 10000,
      spotlightWindowId: "printer-manager",
      narration: "The I/O Spooler simulates a printer queue. Print jobs are submitted and processed in order - first in, first out. Each job shows its progress in real time. While one document prints, others wait in the queue, exactly like a real OS print spooler.",
      run: runPrinterSpoolerStep,
    },
    {
      title: "Summary",
      durationMs: 5000,
      spotlightWindowId: "",
      overlayAlpha: 0.25,
      narration: "That completes the OS Simulator demonstration. You have seen the Process Scheduler, Memory Management with LRU paging, Disk Management with LOOK scheduling, and the Printer Spooler - all running live in the browser. Use the module windows to explore further.",
      run: runSummaryStep,
    },
  ];

  try {
    for (let index = 0; index < steps.length; index += 1) {
      ensureDemoActive(token);
      await beginPresentationStep(steps[index], index, steps.length, token);
      await steps[index].run(token);
      stopDemoProgress(true);
      if (state.demo.skipRequested) {
        state.demo.skipRequested = false;
        await demoWait(500, token, { allowSkip: false });
      }
    }
    if (state.demo.token === token) {
      state.demo.running = false;
      await finishDemoPresentation({
        toastMessage: "Presentation complete - thank you",
        toastDurationMs: 4000,
      });
      state.demo.currentStepIndex = -1;
      state.demo.currentStepDuration = 0;
    }
  } catch (error) {
    if (error.message !== "demo-stopped") {
      state.demo.running = false;
      await finishDemoPresentation();
      throw error;
    }
  } finally {
    state.demo.paused = false;
    updatePresentationControls();
  }
}

function updateClockModel() {
  const now = new Date();
  const nextClockText = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (nextClockText === state.clockText) {
    return;
  }
  state.clockText = nextClockText;
  elements.systemClock.textContent = nextClockText;
}

function toggleMaximize(model) {
  const bounds = getWindowBounds();
  const margin = getWindowMargin();
  if (!model.maximized) {
    model.restoreRect = getWindowRect(model);
    model.x = margin;
    model.y = margin;
    model.width = bounds.width - margin * 2;
    model.height = bounds.height - margin * 2;
    model.maximized = true;
  } else if (model.restoreRect) {
    Object.assign(model, model.restoreRect);
    model.maximized = false;
  }
  clampWindow(model);
  setWindowRect(model.node, model);
  focusWindow(model.id);
}

function snapWindow(model, side) {
  const bounds = getWindowBounds();
  model.restoreRect = getWindowRect(model);
  const margin = getWindowMargin();
  model.x = side === "left" ? margin : Math.floor(bounds.width / 2) + 3;
  model.y = margin;
  model.width = Math.floor((bounds.width - margin * 2 - 6) / 2);
  model.height = bounds.height - margin * 2;
  model.maximized = false;
  clampWindow(model);
  setWindowRect(model.node, model);
}

function createPointerRaf(apply) {
  let nextEvent = null;
  let scheduled = false;
  return {
    enqueue(event) {
      nextEvent = event;
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        apply(nextEvent);
      });
    },
  };
}

function startDrag(event, model) {
  if (model.maximized || model.windowState !== "open" || event.target.closest("[data-window-action]")) {
    return;
  }
  focusWindow(model.id);
  const originX = model.x;
  const originY = model.y;
  const startX = event.clientX;
  const startY = event.clientY;
  const updater = createPointerRaf((moveEvent) => {
    model.x = originX + moveEvent.clientX - startX;
    model.y = Math.max(0, originY + moveEvent.clientY - startY);
    setWindowRect(model.node, model);
  });
  const move = (moveEvent) => updater.enqueue(moveEvent);
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    clampWindow(model);
    setWindowRect(model.node, model);
    const bounds = getWindowBounds();
    const rect = { left: model.x, right: model.x + model.width };
    if (rect.left <= 12) {
      snapWindow(model, "left");
    } else if (rect.right >= bounds.width - 12) {
      snapWindow(model, "right");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function startResize(event, model, direction) {
  event.stopPropagation();
  focusWindow(model.id);
  const origin = getWindowRect(model);
  const startX = event.clientX;
  const startY = event.clientY;
  const updater = createPointerRaf((moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    let nextX = origin.x;
    let nextY = origin.y;
    let nextWidth = origin.width;
    let nextHeight = origin.height;

    if (direction.includes("e")) {
      nextWidth = Math.max(220, origin.width + dx);
    }
    if (direction.includes("s")) {
      nextHeight = Math.max(180, origin.height + dy);
    }
    if (direction.includes("w")) {
      nextWidth = Math.max(220, origin.width - dx);
      nextX = origin.x + (origin.width - nextWidth);
    }
    if (direction.includes("n")) {
      nextHeight = Math.max(180, origin.height - dy);
      nextY = origin.y + (origin.height - nextHeight);
    }

    model.x = nextX;
    model.y = nextY;
    model.width = nextWidth;
    model.height = nextHeight;
    setWindowRect(model.node, model);
  });
  const move = (moveEvent) => updater.enqueue(moveEvent);
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    clampWindow(model);
    setWindowRect(model.node, model);
    state.dirty.process = true;
    state.process.needsRowRender = true;
    state.dirty.memory = true;
    state.dirty.disk = true;
    queueRender();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function initWindowSystem() {
  document.querySelectorAll(".desktop-window").forEach((node, index) => {
    const id = node.dataset.window;
    const model = {
      id,
      node,
      title: node.dataset.title,
      x: Number(node.dataset.x),
      y: Number(node.dataset.y),
      width: Number(node.dataset.width),
      height: Number(node.dataset.height),
      hidden: true,
      windowState: node.dataset.startHidden === "false" ? "open" : "closed",
      maximized: false,
      restoreRect: null,
      hideCleanup: null,
      hideTimer: 0,
    };
    state.windows[id] = model;
    state.zStack.push(id);
    clampWindow(model);
    setWindowRect(node, model);
    model.hidden = model.windowState !== "open";
    syncWindowVisibility(model);
    node.addEventListener("pointerdown", () => focusWindow(id));
    node.querySelector("[data-drag-handle='true']").addEventListener("pointerdown", (event) => startDrag(event, model));
    node.querySelectorAll("[data-window-action]").forEach((button) => {
      button.textContent = "";
      const action = button.dataset.windowAction;
      button.setAttribute("aria-label", `${action[0].toUpperCase()}${action.slice(1)} window`);
      const icon = document.createElement("span");
      if (action === "minimize") {
        icon.className = "window-min-icon";
      }
      if (action === "maximize") {
        icon.className = "window-max-icon";
      } else if (action === "close") {
        icon.className = "window-close-icon";
        button.classList.add("window-close");
      }
      button.appendChild(icon);
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (action === "maximize") {
          toggleMaximize(model);
          return;
        }
        if (action === "close") {
          closeWindow(id);
          return;
        }
        minimizeWindow(id);
      });
    });
    node.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => startResize(event, model, handle.dataset.resize));
    });
  });
  reassignZIndices();
  updateWindowActiveClasses();
  state.dirty.taskbar = true;
  queueRender();
}

function bindActions() {
  elements.startButton.addEventListener("click", () => {
    if (elements.startMenu.classList.contains("hidden")) {
      openStartMenu();
    } else {
      closeStartMenu();
    }
  });
  elements.launcherOverlay.addEventListener("click", closeStartMenu);
  elements.contextOverlay.addEventListener("click", closeContextMenu);

  elements.startMenu.querySelectorAll("[data-open-window]").forEach((button) => {
    button.addEventListener("click", () => {
      openWindow(button.dataset.openWindow, "is-opening");
      closeStartMenu();
    });
  });
  elements.desktopIcons.querySelectorAll("[data-open-window]").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.matchMedia("(pointer: coarse)").matches || isCompactViewport()) {
        focusOrOpenWindow(button.dataset.openWindow, "is-opening");
        return;
      }
      setDesktopSelection(button.dataset.iconId);
    });
    button.addEventListener("dblclick", () => focusOrOpenWindow(button.dataset.openWindow, "is-opening"));
  });
  elements.taskbarWindows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (button) {
      toggleTaskbarWindow(button.dataset.window);
    }
  });
  elements.contextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    closeContextMenu();
    if (button.dataset.contextAction === "refresh") {
      loadState();
      return;
    }
    if (button.dataset.openWindow) {
      focusOrOpenWindow(button.dataset.openWindow, "is-opening");
    }
  });
  elements.desktop.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".desktop-window") || event.target.closest(".taskbar")) {
      return;
    }
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStartMenu();
      closeContextMenu();
      blurWindows();
    }
  });

  elements.themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("theme-dark");
    document.body.classList.toggle("theme-light");
    elements.themeToggle.textContent = document.body.classList.contains("theme-dark") ? "Light" : "Dark";
    state.dirty.memory = true;
    state.dirty.disk = true;
    queueRender();
  });

  document.getElementById("create-process").addEventListener("click", () => {
    runAction("/api/process/create", {
      name: elements.processName.value.trim(),
      memory: Number(elements.processMemory.value),
      cpu_time: Number(elements.processCpu.value),
    });
  });
  elements.processFilter.addEventListener("input", () => {
    state.process.filter = elements.processFilter.value;
    state.dirty.process = true;
    state.process.needsRowRender = true;
    queueRender();
  });
  document.querySelectorAll(".process-header-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.process.sortKey === button.dataset.sortKey) {
        state.process.sortDir = state.process.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.process.sortKey = button.dataset.sortKey;
        state.process.sortDir = "asc";
      }
      state.dirty.process = true;
      state.process.needsRowRender = true;
      queueRender();
    });
  });
  elements.processViewport.addEventListener("scroll", () => {
    state.process.needsRowRender = true;
    queueRender();
  });
  elements.processRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-process-action]");
    if (!button) {
      return;
    }
    const pid = Number(button.dataset.pid);
    if (button.dataset.processAction === "kill") {
      runAction("/api/process/kill", { pid });
      return;
    }
    if (button.dataset.processAction === "unblock") {
      runAction("/api/process/unblock", { pid });
      return;
    }
    const ticks = Number(window.prompt("Block for how many ticks?", "2"));
    if (!ticks) {
      return;
    }
    const reason = window.prompt("Reason?", "I/O") || "I/O";
    runAction("/api/process/block", { pid, ticks, reason });
  });

  elements.schedulerToggle.addEventListener("click", () => {
    if (state.snapshot) {
      runAction("/api/scheduler/run", { running: !state.snapshot.runtime.scheduler_running });
    }
  });
  document.getElementById("apply-scheduler").addEventListener("click", () => {
    runAction("/api/scheduler", { scheduler: elements.schedulerSelect.value });
  });
  document.getElementById("memory-access").addEventListener("click", () => {
    runAction("/api/memory/access", {
      pid: Number(elements.memoryPid.value),
      virtual_address: Number(elements.memoryAddress.value),
    });
  });

  document.getElementById("disk-create-file").addEventListener("click", () => {
    runAction("/api/disk/file/create", {
      filename: elements.diskFileName.value.trim(),
      size_sectors: Number(elements.diskFileSize.value),
    });
  });
  document.getElementById("disk-delete-file").addEventListener("click", () => {
    runAction("/api/disk/file/delete", { filename: elements.diskFileName.value.trim() });
  });
  document.getElementById("disk-read-file").addEventListener("click", () => {
    runAction("/api/disk/file/read", {
      filename: elements.diskFileName.value.trim(),
      pid: Number(elements.diskFilePid.value),
    });
  });
  document.getElementById("disk-write-file").addEventListener("click", () => {
    runAction("/api/disk/file/write", {
      filename: elements.diskFileName.value.trim(),
      pid: Number(elements.diskFilePid.value),
    });
  });
  elements.diskToggle.addEventListener("click", () => {
    if (state.snapshot) {
      runAction("/api/disk/run", { running: !state.snapshot.runtime.disk_running });
    }
  });

  document.getElementById("print-submit").addEventListener("click", () => {
    runAction("/api/printer/submit", {
      job_id: elements.printJobId.value.trim(),
      document_name: elements.printDocument.value.trim(),
      size_pages: Number(elements.printPages.value),
    });
  });
  document.getElementById("print-process").addEventListener("click", () => {
    runAction("/api/printer/process", {});
  });

  elements.demoButton.addEventListener("click", startDemo);
  elements.presentationPause.addEventListener("click", pauseDemo);
  elements.presentationResume.addEventListener("click", resumeDemo);
  elements.presentationSkipStep.addEventListener("click", requestSkipStep);
  elements.presentationEndDemo.addEventListener("click", endDemo);

  document.addEventListener("pointerdown", (event) => {
    if (!elements.startMenu.classList.contains("hidden")
      && !event.target.closest("#start-menu")
      && !event.target.closest("#start-button")) {
      closeStartMenu();
    }
    if (!event.target.closest(".desktop-window")
      && !event.target.closest(".taskbar")
      && !event.target.closest("#start-menu")
      && !event.target.closest(".context-menu")
      && !event.target.closest(".desktop-icon")) {
      blurWindows();
    }
  });

  window.addEventListener("resize", () => {
    Object.values(state.windows).forEach((model) => {
      clampWindow(model);
      setWindowRect(model.node, model);
    });
    positionDemoBadge();
    state.dirty.process = true;
    state.process.needsRowRender = true;
    state.dirty.memory = true;
    state.dirty.disk = true;
    state.dirty.printer = true;
    queueRender();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      state.dirty.process = true;
      state.process.needsRowRender = true;
      state.dirty.memory = true;
      state.dirty.disk = true;
      state.dirty.printer = true;
      loadState();
    }
  });
}

detectReducedEffects();
initWindowSystem();
bindActions();
initCanvasObservers();
updateClockModel();
loadState();
window.setInterval(updateClockModel, 1000);
window.setInterval(loadState, CONFIG.pollMs);
window.setInterval(() => {
  if (!document.hidden && state.snapshot?.printer.queue.length) {
    state.dirty.printer = true;
    queueRender();
  }
}, CONFIG.printerRefreshMs);
