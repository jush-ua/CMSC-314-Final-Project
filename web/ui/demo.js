import { CONFIG } from "../config.js?v=20260503c";

/** Creates the presentation demo controller with narration, spotlight, and pulse annotations. */
export function createDemoController({ scheduler, memory, disk, spooler, windowManager, launcher, elements, requestRender }) {
  const state = {
    running: false,
    paused: false,
    skipRequested: false,
    token: 0,
    stepIndex: -1,
    stepTitle: "",
    narration: "",
    progress: 0,
    stepDurationMs: 0,
    stepStartedAt: 0,
    elapsedBeforePause: 0,
    progressRaf: 0,
    pulseTimeouts: [],
    dirty: true,
  };

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function queryWindowElement(windowId, selector) {
    const host = windowManager.getContentElement(windowId);
    return selector ? host?.querySelector(selector) || null : host;
  }

  function clearPulses() {
    state.pulseTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    state.pulseTimeouts = [];
    document.querySelectorAll(".demo-pulse").forEach((node) => node.classList.remove("demo-pulse"));
  }

  function pulseElement(element) {
    if (!element) {
      return;
    }
    element.classList.add("demo-pulse");
    const timeoutId = window.setTimeout(() => element.classList.remove("demo-pulse"), CONFIG.ui.pulseDurationMs);
    state.pulseTimeouts.push(timeoutId);
  }

  function stopProgress() {
    if (state.progressRaf) {
      window.cancelAnimationFrame(state.progressRaf);
      state.progressRaf = 0;
    }
  }

  function tickProgress() {
    if (!state.running || state.paused || !state.stepDurationMs) {
      state.progressRaf = 0;
      return;
    }
    const elapsed = state.elapsedBeforePause + Math.max(0, performance.now() - state.stepStartedAt);
    state.progress = Math.min(1, elapsed / state.stepDurationMs);
    markDirty();
    state.progressRaf = window.requestAnimationFrame(tickProgress);
  }

  function startProgress(durationMs) {
    state.stepDurationMs = durationMs;
    state.stepStartedAt = performance.now();
    state.elapsedBeforePause = 0;
    state.progress = 0;
    stopProgress();
    state.progressRaf = window.requestAnimationFrame(tickProgress);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitFor(ms, token) {
    let remaining = ms;
    while (remaining > 0) {
      if (!state.running || state.token !== token) {
        throw new Error("demo-stopped");
      }
      if (state.skipRequested) {
        state.skipRequested = false;
        return false;
      }
      if (state.paused) {
        await sleep(CONFIG.demo.pausePollMs);
        continue;
      }
      const slice = Math.min(CONFIG.demo.pausePollMs, remaining);
      await sleep(slice);
      remaining -= slice;
    }
    return true;
  }

  function ensureProcess({ name, memoryRequired, cpuTime, priority }) {
    const existing = scheduler.getSnapshot().processes.find((process) => process.name === name && process.state !== "terminated");
    if (existing) {
      return existing.pid;
    }
    return scheduler.createProcess({ name, memoryRequired, cpuTime, priority }).pid;
  }

  function ensureDiskFile(name, size) {
    const existing = disk.getSnapshot().files.find((file) => file.name === name);
    if (!existing) {
      disk.createFile(name, size);
    }
  }

  function setStep(step, index) {
    state.stepIndex = index;
    state.stepTitle = step.title;
    state.narration = step.narration;
    windowManager.setSpotlightWindow(step.spotlightWindowId || "");
    startProgress(step.durationMs);
    markDirty();
  }

  function buildSteps() {
    return [
      {
        title: "Desktop Overview",
        spotlightWindowId: "",
        durationMs: 4200,
        narration: "Welcome to the OS Simulator. This single-page desktop shows live process scheduling, virtual memory paging, disk head movement, printer spooler progress, and a narrated presentation layer running entirely in the browser.",
        run: async (token) => {
          await waitFor(600, token);
        },
      },
      {
        title: "Process Scheduler",
        spotlightWindowId: "process-manager",
        durationMs: 5200,
        narration: "The scheduler creates processes with CPU time, memory demand, and priority. Real-time ticks update state, ready queues, and CPU percentages while the table responds immediately to every scheduling decision.",
        run: async (token) => {
          windowManager.revealWindow("process-manager");
          await waitFor(500, token);
          ensureProcess({ name: "SystemInit", memoryRequired: 4096, cpuTime: 7, priority: 1 });
          ensureProcess({ name: "UserApp", memoryRequired: 8192, cpuTime: 9, priority: 3 });
          ensureProcess({ name: "BackgroundSync", memoryRequired: 12288, cpuTime: 8, priority: 4 });
          ensureProcess({ name: "NetworkDaemon", memoryRequired: 16384, cpuTime: 10, priority: 2 });
          pulseElement(queryWindowElement("process-manager", '[data-role="toggle-form"]'));
          pulseElement(queryWindowElement("process-manager", ".process-table-body"));
          await waitFor(700, token);
        },
      },
      {
        title: "Scheduling Algorithms",
        spotlightWindowId: "process-manager",
        durationMs: 5400,
        narration: "Round Robin, Priority, and FCFS are all available. Changing the algorithm alters who runs next, whether time slicing applies, and how higher-priority work can preempt lower-priority execution.",
        run: async (token) => {
          windowManager.revealWindow("process-manager");
          scheduler.setAlgorithm("rr");
          pulseElement(queryWindowElement("process-manager", '[data-role="algorithm"]'));
          await waitFor(1400, token);
          scheduler.setAlgorithm("priority");
          await waitFor(1400, token);
          scheduler.setAlgorithm("fcfs");
          await waitFor(1400, token);
          scheduler.setAlgorithm("rr");
        },
      },
      {
        title: "Memory Pressure",
        spotlightWindowId: "memory-manager",
        durationMs: 5600,
        narration: "Physical memory is divided into sixteen fixed frames. As process pages fill memory, the LRU policy evicts the least recently used pages. Faults and evictions are highlighted live in the frame map and event log.",
        run: async (token) => {
          windowManager.revealWindow("memory-manager");
          await waitFor(400, token);
          const cachePid = ensureProcess({ name: "CacheWarmer", memoryRequired: 24576, cpuTime: 9, priority: 5 });
          const renderPid = ensureProcess({ name: "RenderDaemon", memoryRequired: 8192, cpuTime: 7, priority: 2 });
          memory.translateAddress(cachePid, 0, scheduler.getSnapshot().clock);
          memory.translateAddress(cachePid, CONFIG.memory.pageSize * 3, scheduler.getSnapshot().clock);
          memory.translateAddress(renderPid, 0, scheduler.getSnapshot().clock);
          memory.translateAddress(renderPid, CONFIG.memory.pageSize, scheduler.getSnapshot().clock);
          pulseElement(queryWindowElement("memory-manager", ".memory-frame-grid"));
          await waitFor(1200, token);
        },
      },
      {
        title: "Page Tables",
        spotlightWindowId: "memory-manager",
        durationMs: 4600,
        narration: "Each process owns a separate virtual address space. Page tables map virtual pages to physical frames so the scheduler can run isolated workloads while the memory manager translates addresses behind the scenes.",
        run: async (token) => {
          windowManager.revealWindow("memory-manager");
          const firstActive = scheduler.getSnapshot().processes.find((process) => process.state !== "terminated");
          if (firstActive) {
            memory.translateAddress(firstActive.pid, CONFIG.memory.pageSize * 2, scheduler.getSnapshot().clock);
          }
          pulseElement(queryWindowElement("memory-manager", ".page-table-list"));
          await waitFor(900, token);
        },
      },
      {
        title: "Disk Scheduling",
        spotlightWindowId: "disk-manager",
        durationMs: 5600,
        narration: "The disk manager allocates sectors through a FAT, queues read and write requests, and services them with the LOOK algorithm. The head moves in the current direction until it reaches the farthest request, then reverses efficiently.",
        run: async (token) => {
          windowManager.revealWindow("disk-manager");
          await waitFor(400, token);
          ensureDiskFile("demo.bin", 6);
          ensureDiskFile("logs.sys", 4);
          disk.readFile("demo.bin", 1);
          disk.writeFile("logs.sys", 2);
          pulseElement(queryWindowElement("disk-manager", ".disk-seek-canvas"));
          pulseElement(queryWindowElement("disk-manager", ".fat-list"));
          await waitFor(1200, token);
        },
      },
      {
        title: "Printer Queue",
        spotlightWindowId: "printer-manager",
        durationMs: 5400,
        narration: "The spooler accepts print jobs in FIFO order. One job prints at a time, its progress bar advances in real time, and completed work is moved into the done list while later jobs wait in the queue.",
        run: async (token) => {
          windowManager.revealWindow("printer-manager");
          spooler.submitJob("Architecture Brief", 6);
          await waitFor(500, token);
          spooler.submitJob("Queue Report", 4);
          await waitFor(500, token);
          spooler.submitJob("Diagnostics", 3);
          pulseElement(queryWindowElement("printer-manager", ".printer-job-list"));
          await waitFor(800, token);
        },
      },
      {
        title: "Simulation Complete",
        spotlightWindowId: "",
        durationMs: 4200,
        narration: "This concludes the walkthrough. The scheduler, memory manager, disk service, printer spooler, and macOS-style desktop shell remain live, so you can continue experimenting with the simulator directly.",
        run: async (token) => {
          windowManager.setSpotlightWindow("");
          await waitFor(700, token);
        },
      },
    ];
  }

  async function runSequence(token) {
    const steps = buildSteps();
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      setStep(step, index);
      const startedAt = performance.now();
      await step.run(token);
      const remaining = Math.max(0, step.durationMs - (performance.now() - startedAt));
      await waitFor(remaining, token);
    }
  }

  function cleanup() {
    clearPulses();
    stopProgress();
    state.progress = 0;
    state.stepDurationMs = 0;
    state.stepTitle = "";
    state.narration = "";
    state.stepIndex = -1;
    state.paused = false;
    state.skipRequested = false;
    launcher.setDemoRunning(false);
    windowManager.setSpotlightWindow("");
    markDirty();
  }

  /** Starts the 8-step narrated demo sequence if it is not already running. */
  async function start() {
    if (state.running) {
      return;
    }
    state.running = true;
    state.token += 1;
    const token = state.token;
    launcher.closeLauncher();
    launcher.setDemoRunning(true);
    markDirty();
    try {
      await runSequence(token);
    } catch (error) {
      if (error.message !== "demo-stopped") {
        throw error;
      }
    } finally {
      state.running = false;
      cleanup();
    }
  }

  /** Stops the active demo sequence and clears its HUD and spotlight state. */
  function stop() {
    if (!state.running) {
      cleanup();
      return;
    }
    state.running = false;
    state.token += 1;
    cleanup();
  }

  function togglePause() {
    if (!state.running) {
      return;
    }
    if (!state.paused) {
      state.elapsedBeforePause += Math.max(0, performance.now() - state.stepStartedAt);
      state.paused = true;
      stopProgress();
    } else {
      state.paused = false;
      state.stepStartedAt = performance.now();
      state.progressRaf = window.requestAnimationFrame(tickProgress);
    }
    markDirty();
  }

  function nextStep() {
    if (!state.running) {
      return;
    }
    state.skipRequested = true;
  }

  /** Initializes HUD controls for the presentation demo. */
  function init() {
    elements.pause.addEventListener("click", togglePause);
    elements.next.addEventListener("click", nextStep);
    elements.end.addEventListener("click", stop);
  }

  /** Re-renders the demo HUD, narration card, and progress indicator. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    elements.overlay.classList.toggle("hidden", !state.running);
    elements.hud.classList.toggle("hidden", !state.running);
    elements.stepCounter.textContent = state.stepIndex >= 0 ? `Step ${state.stepIndex + 1} of ${CONFIG.demo.stepCounterTotal}` : "";
    elements.title.textContent = state.stepTitle;
    elements.narration.textContent = state.narration;
    elements.pause.textContent = state.paused ? "Resume" : "Pause";
    elements.progress.style.width = `${state.progress * 100}%`;
  }

  return {
    init,
    start,
    stop,
    render,
    /** Returns the current demo controller state for diagnostics and testing. */
    getState() {
      return {
        running: state.running,
        paused: state.paused,
        stepIndex: state.stepIndex,
        stepTitle: state.stepTitle,
        narration: state.narration,
      };
    },
  };
}
