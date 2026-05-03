import { CONFIG } from "../config.js?v=20260503c";

/** Creates the process scheduler with RR, FCFS, and Priority modes. */
export function createScheduler({ bus, memory }) {
  const state = {
    processes: new Map(),
    readyQueue: [],
    runningPid: null,
    nextPid: 1,
    clock: 0,
    algorithm: "rr",
    running: true,
    sliceRemaining: CONFIG.scheduler.timeSlice,
    cpuCycles: new Map(),
    totalCpuCycles: 0,
    timeline: [],
    eventLog: [],
    timerId: window.setInterval(tick, CONFIG.scheduler.intervalMs),
  };

  function appendLog(message) {
    state.eventLog.unshift({ timestamp: state.clock, message });
    state.eventLog = state.eventLog.slice(0, CONFIG.scheduler.maxEventLogEntries);
  }

  function emitUpdate() {
    bus.emit("scheduler:updated");
  }

  function sortPriorityReadyQueue() {
    state.readyQueue.sort((leftPid, rightPid) => {
      const left = state.processes.get(leftPid);
      const right = state.processes.get(rightPid);
      if (!left || !right) {
        return leftPid - rightPid;
      }
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.createdAt - right.createdAt;
    });
  }

  function removeFromReadyQueue(pid) {
    state.readyQueue = state.readyQueue.filter((queuedPid) => queuedPid !== pid);
  }

  function terminateProcessInternal(pid, reason = "terminated") {
    const process = state.processes.get(pid);
    if (!process || process.state === "terminated") {
      return null;
    }
    if (state.runningPid === pid) {
      state.runningPid = null;
      state.sliceRemaining = CONFIG.scheduler.timeSlice;
    }
    removeFromReadyQueue(pid);
    process.state = "terminated";
    process.ioTicksRemaining = 0;
    process.ioReason = "";
    memory.freeProcess(pid);
    appendLog(`Terminated process ${pid} ('${process.name}') via ${reason}.`);
    return process;
  }

  function enqueueReady(pid) {
    if (state.readyQueue.includes(pid)) {
      return;
    }
    state.readyQueue.push(pid);
    if (state.algorithm === "priority") {
      sortPriorityReadyQueue();
    }
  }

  function chooseNextPid() {
    if (!state.readyQueue.length) {
      return null;
    }
    if (state.algorithm === "priority") {
      sortPriorityReadyQueue();
    }
    return state.readyQueue.shift() ?? null;
  }

  function maybePreemptForPriority() {
    if (state.algorithm !== "priority" || state.runningPid == null || !state.readyQueue.length) {
      return;
    }
    const running = state.processes.get(state.runningPid);
    sortPriorityReadyQueue();
    const next = state.processes.get(state.readyQueue[0]);
    if (!running || !next || next.priority >= running.priority) {
      return;
    }
    running.state = "ready";
    enqueueReady(running.pid);
    state.runningPid = null;
    state.sliceRemaining = CONFIG.scheduler.timeSlice;
    appendLog(`Priority preemption moved PID ${running.pid} back to ready state.`);
  }

  function scheduleNext() {
    if (state.runningPid != null) {
      return;
    }
    const nextPid = chooseNextPid();
    if (nextPid == null) {
      return;
    }
    const process = state.processes.get(nextPid);
    if (!process || process.state !== "ready") {
      scheduleNext();
      return;
    }
    process.state = "running";
    state.runningPid = nextPid;
    state.sliceRemaining = CONFIG.scheduler.timeSlice;
    appendLog(`CPU scheduled PID ${process.pid} ('${process.name}').`);
  }

  function updateWaitingProcesses() {
    state.processes.forEach((process) => {
      if (process.state !== "waiting") {
        return;
      }
      process.ioTicksRemaining -= 1;
      if (process.ioTicksRemaining > 0) {
        return;
      }
      process.state = "ready";
      process.ioTicksRemaining = 0;
      process.ioReason = "";
      enqueueReady(process.pid);
      appendLog(`Process ${process.pid} finished I/O and is ready.`);
    });
  }

  function recordCpuCycle(pid, name) {
    state.cpuCycles.set(pid, (state.cpuCycles.get(pid) || 0) + 1);
    state.totalCpuCycles += 1;
    state.timeline.push({ clock: state.clock, pid, name });
    state.timeline = state.timeline.slice(-CONFIG.scheduler.maxTimelineEntries);
  }

  function recordIdleCycle() {
    state.timeline.push({ clock: state.clock, pid: null, name: "Idle" });
    state.timeline = state.timeline.slice(-CONFIG.scheduler.maxTimelineEntries);
  }

  function runCurrentProcess() {
    if (state.runningPid == null) {
      recordIdleCycle();
      appendLog(`Tick ${state.clock}: CPU idle.`);
      return;
    }

    const process = state.processes.get(state.runningPid);
    if (!process) {
      state.runningPid = null;
      recordIdleCycle();
      return;
    }

    memory.accessProcess(process.pid, state.clock);
    process.cpuTimeRemaining -= 1;
    state.sliceRemaining -= 1;
    process.cpuPercent = 0;
    recordCpuCycle(process.pid, process.name);
    appendLog(`Tick ${state.clock}: running PID ${process.pid} ('${process.name}'), cpu_left=${process.cpuTimeRemaining}.`);

    if (process.cpuTimeRemaining <= 0) {
      const finished = terminateProcessInternal(process.pid, "completion");
      if (finished) {
        appendLog(`Process ${finished.pid} ('${finished.name}') completed.`);
      }
      return;
    }

    if (state.algorithm === "rr" && state.sliceRemaining <= 0) {
      process.state = "ready";
      enqueueReady(process.pid);
      state.runningPid = null;
      state.sliceRemaining = CONFIG.scheduler.timeSlice;
      appendLog(`Time slice expired for PID ${process.pid}; returned to ready queue.`);
      scheduleNext();
    }
  }

  /** Advances the scheduler by one real-time tick when the loop is running. */
  function tick() {
    if (!state.running) {
      return;
    }
    state.clock += 1;
    updateWaitingProcesses();
    maybePreemptForPriority();
    scheduleNext();
    runCurrentProcess();
    emitUpdate();
  }

  /** Creates a new process and allocates its virtual memory footprint. */
  function createProcess({ name, memoryRequired, cpuTime, priority }) {
    const safeName = String(name || "").trim();
    const requestedMemory = Number(memoryRequired);
    const requestedCpu = Number(cpuTime);
    const requestedPriority = Number(priority);
    if (!safeName) {
      return { ok: false, message: "Process name is required." };
    }
    if (requestedMemory <= 0 || requestedCpu <= 0) {
      return { ok: false, message: "Memory and CPU time must be positive." };
    }
    const pid = state.nextPid;
    const allocation = memory.allocateProcess(pid, requestedMemory, state.clock);
    if (!allocation) {
      return { ok: false, message: `Failed to create process '${safeName}': not enough memory.` };
    }

    const process = {
      pid,
      name: safeName,
      memoryRequired: requestedMemory,
      cpuTimeRemaining: requestedCpu,
      totalCpuTime: requestedCpu,
      priority: Math.min(CONFIG.scheduler.maxPriority, Math.max(CONFIG.scheduler.minPriority, requestedPriority || CONFIG.scheduler.defaultPriority)),
      state: "ready",
      ioTicksRemaining: 0,
      ioReason: "",
      createdAt: Date.now(),
    };
    state.processes.set(pid, process);
    enqueueReady(pid);
    state.nextPid += 1;
    appendLog(`Created process ${pid} ('${safeName}') using ${requestedMemory} units and ${requestedCpu} CPU ticks.`);
    emitUpdate();
    return { ok: true, pid, message: `Created process PID ${pid}.` };
  }

  /** Terminates a process and releases its resources. */
  function terminateProcess(pid) {
    const process = state.processes.get(Number(pid));
    if (!process) {
      return { ok: false, message: `Process ${pid} does not exist.` };
    }
    if (process.state === "terminated") {
      return { ok: false, message: `Process ${pid} is already terminated.` };
    }
    terminateProcessInternal(process.pid);
    emitUpdate();
    return { ok: true, message: `Terminated process ${pid}.` };
  }

  /** Blocks a process for a fixed number of ticks and moves it to the waiting state. */
  function blockProcess(pid, ticks = CONFIG.scheduler.blockTicks, reason = "I/O") {
    const process = state.processes.get(Number(pid));
    if (!process || process.state === "terminated") {
      return { ok: false, message: `Process ${pid} does not exist.` };
    }
    if (Number(ticks) <= 0) {
      return { ok: false, message: "I/O wait time must be positive." };
    }
    if (state.runningPid === process.pid) {
      state.runningPid = null;
      state.sliceRemaining = CONFIG.scheduler.timeSlice;
    }
    removeFromReadyQueue(process.pid);
    process.state = "waiting";
    process.ioTicksRemaining = Number(ticks);
    process.ioReason = reason;
    appendLog(`Process ${process.pid} blocked for ${ticks} ticks due to ${reason}.`);
    emitUpdate();
    return { ok: true, message: `Process ${process.pid} is waiting on ${reason} for ${ticks} ticks.` };
  }

  /** Unblocks a waiting process and places it back into the ready queue. */
  function unblockProcess(pid) {
    const process = state.processes.get(Number(pid));
    if (!process || process.state === "terminated") {
      return { ok: false, message: `Process ${pid} does not exist.` };
    }
    if (process.state !== "waiting") {
      return { ok: false, message: `Process ${pid} is not waiting.` };
    }
    process.state = "ready";
    process.ioTicksRemaining = 0;
    process.ioReason = "";
    enqueueReady(process.pid);
    appendLog(`Process ${process.pid} manually unblocked.`);
    emitUpdate();
    return { ok: true, message: `Process ${process.pid} moved to ready state.` };
  }

  /** Sets the active scheduling algorithm used by the scheduler loop. */
  function setAlgorithm(algorithm) {
    const nextAlgorithm = String(algorithm || "").toLowerCase();
    if (!CONFIG.scheduler.algorithms.some((item) => item.value === nextAlgorithm)) {
      return { ok: false, message: "Scheduler must be RR, Priority, or FCFS." };
    }
    state.algorithm = nextAlgorithm;
    state.sliceRemaining = CONFIG.scheduler.timeSlice;
    if (state.algorithm === "priority") {
      maybePreemptForPriority();
      sortPriorityReadyQueue();
    }
    appendLog(`Scheduler set to ${nextAlgorithm.toUpperCase()}.`);
    emitUpdate();
    return { ok: true, message: `Scheduler changed to ${nextAlgorithm.toUpperCase()}.` };
  }

  /** Pauses or resumes the real-time scheduler interval loop. */
  function setRunning(isRunning) {
    state.running = Boolean(isRunning);
    appendLog(state.running ? "Scheduler running." : "Scheduler paused.");
    emitUpdate();
    return { ok: true, message: state.running ? "Scheduler running." : "Scheduler paused." };
  }

  /** Advances the simulation a fixed number of ticks even when paused. */
  function step(steps = 1) {
    const safeSteps = Math.max(1, Number(steps) || 1);
    for (let index = 0; index < safeSteps; index += 1) {
      state.clock += 1;
      updateWaitingProcesses();
      maybePreemptForPriority();
      scheduleNext();
      runCurrentProcess();
    }
    emitUpdate();
  }

  function computeCpuPercent(pid) {
    if (!state.totalCpuCycles) {
      return 0;
    }
    return Number((((state.cpuCycles.get(pid) || 0) / state.totalCpuCycles) * 100).toFixed(1));
  }

  /** Returns a serializable snapshot of scheduler and process state. */
  function getSnapshot() {
    const processes = [...state.processes.values()]
      .sort((left, right) => left.pid - right.pid)
      .map((process) => ({
        pid: process.pid,
        name: process.name,
        state: process.state,
        memoryRequired: process.memoryRequired,
        memoryUsage: memory.processMemoryUsage(process.pid),
        cpuTimeRemaining: process.cpuTimeRemaining,
        priority: process.priority,
        ioTicksRemaining: process.ioTicksRemaining,
        ioReason: process.ioReason,
        cpuPercent: computeCpuPercent(process.pid),
      }));
    return {
      clock: state.clock,
      algorithm: state.algorithm,
      running: state.running,
      runningPid: state.runningPid,
      readyQueue: [...state.readyQueue],
      timeSlice: CONFIG.scheduler.timeSlice,
      sliceRemaining: state.sliceRemaining,
      processes,
      timeline: [...state.timeline],
      eventLog: state.eventLog.map((entry) => ({ ...entry })),
      summary: {
        totalProcesses: processes.length,
        running: processes.filter((process) => process.state === "running").length,
        ready: processes.filter((process) => process.state === "ready").length,
        waiting: processes.filter((process) => process.state === "waiting").length,
        terminated: processes.filter((process) => process.state === "terminated").length,
      },
    };
  }

  return {
    createProcess,
    terminateProcess,
    blockProcess,
    unblockProcess,
    setAlgorithm,
    setRunning,
    step,
    getSnapshot,
  };
}
