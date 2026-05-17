import { CONFIG } from "../config.js?v=20260503c";

/** Creates the printer spooler with FIFO ordering and real-time job progress. */
export function createSpooler({ bus }) {
  const state = {
    printer: {
      online: true,
      paused: false,
      colorMode: "color",
      duplex: "long-edge",
      paperSize: "A4",
      quality: "standard",
      paperLevel: 260,
      tonerLevel: 92,
    },
    queue: [],
    completed: [],
    activeJobId: "",
    nextJobNumber: 1,
    timerId: window.setInterval(stepQueue, CONFIG.spooler.tickMs),
  };

  function emitUpdate() {
    bus.emit("spooler:updated");
  }

  function activeJob() {
    return state.queue.find((job) => job.jobId === state.activeJobId) || null;
  }

  function computePrinterStatus() {
    if (!state.printer.online) {
      return "OFFLINE";
    }
    if (state.printer.paused) {
      return "PAUSED";
    }
    if (state.activeJobId) {
      return "PRINTING";
    }
    if (state.queue.length) {
      return "QUEUED";
    }
    return "IDLE";
  }

  function normalizeJobInput(documentName, pages, settings = {}) {
    if (typeof documentName === "object" && documentName != null) {
      const payload = documentName;
      return {
        documentName: payload.documentName,
        pages: payload.pages,
        settings: {
          copies: payload.copies,
          colorMode: payload.colorMode,
          duplex: payload.duplex,
          paperSize: payload.paperSize,
          quality: payload.quality,
        },
      };
    }
    return { documentName, pages, settings };
  }

  function ensureActiveJob() {
    if (state.activeJobId || !state.queue.length || !state.printer.online || state.printer.paused) {
      return;
    }
    const nextJob = state.queue[0];
    nextJob.status = "PRINTING";
    if (!nextJob.startedAt) {
      nextJob.startedAt = Date.now();
    }
    state.activeJobId = nextJob.jobId;
  }

  /** Submits a print job to the FIFO queue. */
  function submitJob(documentName, pages, settings = {}) {
    const input = normalizeJobInput(documentName, pages, settings);
    const safeName = String(input.documentName || "").trim();
    const safePages = Number(input.pages);
    const safeCopies = Math.max(1, Math.floor(Number(input.settings?.copies || 1)));
    const safeColorMode = input.settings?.colorMode === "bw" ? "bw" : "color";
    const safeDuplex = input.settings?.duplex === "none" ? "none" : "long-edge";
    const safePaper = String(input.settings?.paperSize || state.printer.paperSize || "A4");
    const safeQuality = ["draft", "standard", "high"].includes(input.settings?.quality)
      ? input.settings.quality
      : "standard";

    if (!safeName) {
      return { ok: false, message: "Document name is required." };
    }
    if (safePages <= 0) {
      return { ok: false, message: "Pages must be positive." };
    }
    const jobId = `JOB-${String(state.nextJobNumber).padStart(3, "0")}`;
    state.nextJobNumber += 1;
    const totalSheets = safePages * safeCopies;
    state.queue.push({
      jobId,
      documentName: safeName,
      pages: safePages,
      copies: safeCopies,
      totalSheets,
      colorMode: safeColorMode,
      duplex: safeDuplex,
      paperSize: safePaper,
      quality: safeQuality,
      status: "QUEUED",
      progress: 0,
      startedAt: 0,
      completedAt: 0,
      queuedAt: Date.now(),
    });
    ensureActiveJob();
    emitUpdate();
    return { ok: true, message: `Queued print job ${jobId}: ${safeName} (${safePages} pages, ${safeCopies} copies).`, jobId };
  }

  /** Advances the current print job progress by one timed spooler step. */
  function stepQueue() {
    if (!state.printer.online || state.printer.paused) {
      return;
    }
    ensureActiveJob();
    if (!state.activeJobId) {
      return;
    }
    const currentJob = activeJob();
    if (!currentJob) {
      state.activeJobId = "";
      emitUpdate();
      return;
    }
    const step = (CONFIG.spooler.tickMs / CONFIG.spooler.durationMs) * 100;
    currentJob.progress = Math.min(100, (currentJob.progress || 0) + step);
    currentJob.status = "PRINTING";
    if (currentJob.progress < 100) {
      emitUpdate();
      return;
    }

    currentJob.status = "DONE";
    currentJob.progress = 100;
    currentJob.completedAt = Date.now();
    state.queue = state.queue.filter((job) => job.jobId !== currentJob.jobId);
    state.completed.unshift(currentJob);
    state.completed = state.completed.slice(0, CONFIG.spooler.maxCompletedJobs);
    state.printer.paperLevel = Math.max(0, state.printer.paperLevel - currentJob.totalSheets);
    state.printer.tonerLevel = Math.max(0, state.printer.tonerLevel - Math.max(1, Math.ceil(currentJob.totalSheets / 8)));
    state.activeJobId = "";
    ensureActiveJob();
    emitUpdate();
  }

  /** Pauses active printing while keeping the queue intact. */
  function pauseQueue() {
    if (!state.printer.online || state.printer.paused) {
      return;
    }
    state.printer.paused = true;
    const currentJob = activeJob();
    if (currentJob) {
      currentJob.status = "PAUSED";
    }
    emitUpdate();
  }

  /** Resumes queue processing if printer is online. */
  function resumeQueue() {
    if (!state.printer.online || !state.printer.paused) {
      return;
    }
    state.printer.paused = false;
    const currentJob = activeJob();
    if (currentJob) {
      currentJob.status = "PRINTING";
    }
    ensureActiveJob();
    emitUpdate();
  }

  /** Sets whether the printer is online. Offline mode stops processing. */
  function setPrinterOnline(isOnline) {
    state.printer.online = Boolean(isOnline);
    if (!state.printer.online) {
      const currentJob = activeJob();
      if (currentJob) {
        currentJob.status = "PAUSED";
      }
    } else {
      ensureActiveJob();
    }
    emitUpdate();
  }

  /** Cancels a queued or active print job by job id. */
  function cancelJob(jobId) {
    const targetId = String(jobId || "");
    if (!targetId) {
      return;
    }
    const removedActive = state.activeJobId === targetId;
    state.queue = state.queue.filter((job) => job.jobId !== targetId);
    if (removedActive) {
      state.activeJobId = "";
      ensureActiveJob();
    }
    emitUpdate();
  }

  /** Clears completed print history entries. */
  function clearCompleted() {
    state.completed = [];
    emitUpdate();
  }

  /** Updates default printer preferences used for new jobs. */
  function updateDefaults(defaults = {}) {
    state.printer.colorMode = defaults.colorMode === "bw" ? "bw" : state.printer.colorMode;
    state.printer.duplex = defaults.duplex === "none" ? "none" : state.printer.duplex;
    state.printer.paperSize = defaults.paperSize ? String(defaults.paperSize) : state.printer.paperSize;
    if (["draft", "standard", "high"].includes(defaults.quality)) {
      state.printer.quality = defaults.quality;
    }
    emitUpdate();
  }

  /** Returns a serializable snapshot of the printer spooler state. */
  function getSnapshot() {
    return {
      printer: {
        ...state.printer,
        status: computePrinterStatus(),
      },
      queue: state.queue.map((job) => ({ ...job })),
      completed: state.completed.map((job) => ({ ...job })),
      activeJobId: state.activeJobId,
    };
  }

  return {
    submitJob,
    pauseQueue,
    resumeQueue,
    setPrinterOnline,
    cancelJob,
    clearCompleted,
    updateDefaults,
    getSnapshot,
  };
}
