import { CONFIG } from "../config.js?v=20260503c";

/** Creates the printer spooler with FIFO ordering and real-time job progress. */
export function createSpooler({ bus }) {
  const state = {
    queue: [],
    completed: [],
    activeJobId: "",
    nextJobNumber: 1,
    timerId: window.setInterval(stepQueue, CONFIG.spooler.tickMs),
  };

  function emitUpdate() {
    bus.emit("spooler:updated");
  }

  function ensureActiveJob() {
    if (state.activeJobId || !state.queue.length) {
      return;
    }
    const nextJob = state.queue[0];
    nextJob.status = "PRINTING";
    nextJob.startedAt = Date.now();
    state.activeJobId = nextJob.jobId;
  }

  /** Submits a print job to the FIFO queue. */
  function submitJob(documentName, pages) {
    const safeName = String(documentName || "").trim();
    const safePages = Number(pages);
    if (!safeName) {
      return { ok: false, message: "Document name is required." };
    }
    if (safePages <= 0) {
      return { ok: false, message: "Pages must be positive." };
    }
    const jobId = `JOB-${String(state.nextJobNumber).padStart(3, "0")}`;
    state.nextJobNumber += 1;
    state.queue.push({
      jobId,
      documentName: safeName,
      pages: safePages,
      status: "QUEUED",
      progress: 0,
      startedAt: 0,
      completedAt: 0,
    });
    ensureActiveJob();
    emitUpdate();
    return { ok: true, message: `Queued print job ${jobId}: ${safeName} (${safePages} pages).`, jobId };
  }

  /** Advances the current print job progress by one timed spooler step. */
  function stepQueue() {
    ensureActiveJob();
    if (!state.activeJobId) {
      return;
    }
    const activeJob = state.queue.find((job) => job.jobId === state.activeJobId);
    if (!activeJob) {
      state.activeJobId = "";
      emitUpdate();
      return;
    }
    const elapsed = Date.now() - activeJob.startedAt;
    activeJob.progress = Math.min(100, (elapsed / CONFIG.spooler.durationMs) * 100);
    if (activeJob.progress < 100) {
      emitUpdate();
      return;
    }
    activeJob.status = "DONE";
    activeJob.progress = 100;
    activeJob.completedAt = Date.now();
    state.queue = state.queue.filter((job) => job.jobId !== activeJob.jobId);
    state.completed.unshift(activeJob);
    state.completed = state.completed.slice(0, CONFIG.spooler.maxCompletedJobs);
    state.activeJobId = "";
    ensureActiveJob();
    emitUpdate();
  }

  /** Returns a serializable snapshot of the printer spooler state. */
  function getSnapshot() {
    return {
      queue: state.queue.map((job) => ({ ...job })),
      completed: state.completed.map((job) => ({ ...job })),
      activeJobId: state.activeJobId,
    };
  }

  return {
    submitJob,
    getSnapshot,
  };
}
