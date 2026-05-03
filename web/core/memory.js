import { CONFIG } from "../config.js?v=20260503c";

/** Creates the memory manager with fixed frames, page tables, and LRU replacement. */
export function createMemoryManager({ bus }) {
  const state = {
    pageSize: CONFIG.memory.pageSize,
    frameCount: CONFIG.memory.frameCount,
    totalMemory: CONFIG.memory.pageSize * CONFIG.memory.frameCount,
    frames: Array.from({ length: CONFIG.memory.frameCount }, (_, frameNumber) => ({
      frameNumber,
      pid: null,
      virtualPage: null,
      lastAccessTick: -1,
      flash: "",
      flashStartedAt: 0,
    })),
    pageTables: new Map(),
    processPageCounts: new Map(),
    processSizes: new Map(),
    nextAccessPage: new Map(),
    events: [],
    pressureHistory: Array.from({ length: CONFIG.memory.pressureHistorySize }, () => 0),
  };

  function appendEvent(type, message) {
    state.events.unshift({ type, message, timestamp: Date.now() });
    state.events = state.events.slice(0, CONFIG.memory.maxEvents);
  }

  function markDirty() {
    updatePressureHistory();
    bus.emit("memory:updated");
  }

  function updatePressureHistory() {
    const ratio = state.totalMemory === 0 ? 0 : usedMemory() / state.totalMemory;
    state.pressureHistory.push(ratio);
    state.pressureHistory = state.pressureHistory.slice(-CONFIG.memory.pressureHistorySize);
  }

  function pagesRequired(size) {
    return Math.max(1, Math.ceil(size / state.pageSize));
  }

  function setFrameFlash(frameNumber, type) {
    const frame = state.frames[frameNumber];
    if (!frame) {
      return;
    }
    frame.flash = type;
    frame.flashStartedAt = Date.now();
  }

  function clearExpiredFlashes() {
    const now = Date.now();
    let changed = false;
    state.frames.forEach((frame) => {
      if (!frame.flash) {
        return;
      }
      if (now - frame.flashStartedAt < CONFIG.memory.flashMs) {
        return;
      }
      frame.flash = "";
      changed = true;
    });
    if (changed) {
      markDirty();
    }
  }

  function evictLruFrame(clock, protectedPid = null) {
    const eligible = state.frames.filter((frame) => frame.pid != null && frame.pid !== protectedPid);
    const candidates = eligible.length ? eligible : state.frames.filter((frame) => frame.pid != null);
    if (!candidates.length) {
      return null;
    }
    const victim = candidates.reduce((lowest, frame) => (frame.lastAccessTick < lowest.lastAccessTick ? frame : lowest));
    const victimPid = victim.pid;
    const victimPage = victim.virtualPage;
    if (victimPid != null && victimPage != null) {
      state.pageTables.get(victimPid)?.delete(victimPage);
      appendEvent("eviction", `Page evicted: PID ${victimPid} virtual page ${victimPage} -> frame ${victim.frameNumber} freed`);
      setFrameFlash(victim.frameNumber, "eviction");
    }
    victim.pid = null;
    victim.virtualPage = null;
    victim.lastAccessTick = clock;
    return victim;
  }

  function assignFrame(pid, virtualPage, clock, protectedPid = null) {
    const freeFrame = state.frames.find((frame) => frame.pid == null) || evictLruFrame(clock, protectedPid);
    if (!freeFrame) {
      return null;
    }
    freeFrame.pid = pid;
    freeFrame.virtualPage = virtualPage;
    freeFrame.lastAccessTick = clock;
    state.pageTables.get(pid)?.set(virtualPage, freeFrame.frameNumber);
    return freeFrame;
  }

  /** Allocates a process address space and its initial resident pages. */
  function allocateProcess(pid, size, clock) {
    if (size <= 0) {
      appendEvent("deallocation", `Allocation failed: PID ${pid} requested a non-positive memory size.`);
      markDirty();
      return null;
    }

    const pageCount = pagesRequired(size);
    if (pageCount > state.frameCount) {
      appendEvent("fault", `Allocation failed: PID ${pid} needs ${pageCount} pages but only ${state.frameCount} frames exist.`);
      markDirty();
      return null;
    }

    state.pageTables.set(pid, new Map());
    state.processPageCounts.set(pid, pageCount);
    state.processSizes.set(pid, size);
    state.nextAccessPage.set(pid, 0);

    let firstFrameNumber = null;
    for (let virtualPage = 0; virtualPage < pageCount; virtualPage += 1) {
      const frame = assignFrame(pid, virtualPage, clock, pid);
      if (!frame) {
        freeProcess(pid);
        appendEvent("fault", `Allocation failed: PID ${pid} could not secure enough frames.`);
        markDirty();
        return null;
      }
      if (firstFrameNumber == null) {
        firstFrameNumber = frame.frameNumber;
      }
    }

    appendEvent("allocation", `Allocated ${pageCount} page(s) to PID ${pid}.`);
    markDirty();
    return {
      pid,
      start: (firstFrameNumber || 0) * state.pageSize,
      size,
      end: ((firstFrameNumber || 0) * state.pageSize) + size - 1,
    };
  }

  /** Frees every frame and mapping belonging to a process id. */
  function freeProcess(pid) {
    let touched = false;
    state.frames.forEach((frame) => {
      if (frame.pid !== pid) {
        return;
      }
      frame.pid = null;
      frame.virtualPage = null;
      frame.lastAccessTick = -1;
      frame.flash = "";
      touched = true;
    });
    state.pageTables.delete(pid);
    state.processPageCounts.delete(pid);
    state.processSizes.delete(pid);
    state.nextAccessPage.delete(pid);
    if (touched) {
      appendEvent("deallocation", `Released memory for PID ${pid}.`);
      markDirty();
    }
  }

  /** Translates a process virtual address into a physical address, faulting pages in as needed. */
  function translateAddress(pid, virtualAddress, clock) {
    if (!state.processPageCounts.has(pid)) {
      appendEvent("fault", `Memory access failed: PID ${pid} has no allocated address space.`);
      markDirty();
      return null;
    }

    const virtualPage = Math.floor(virtualAddress / state.pageSize);
    const offset = virtualAddress % state.pageSize;
    const pageCount = state.processPageCounts.get(pid) || 0;
    if (virtualPage >= pageCount) {
      appendEvent("fault", `Invalid virtual address: PID ${pid} address ${virtualAddress}`);
      markDirty();
      return null;
    }

    const pageTable = state.pageTables.get(pid);
    if (!pageTable.has(virtualPage)) {
      appendEvent("fault", `Page fault: PID ${pid} accessing virtual page ${virtualPage}`);
      const frame = assignFrame(pid, virtualPage, clock);
      if (!frame) {
        markDirty();
        return null;
      }
      setFrameFlash(frame.frameNumber, "fault");
    }

    const frameNumber = pageTable.get(virtualPage);
    const frame = state.frames[frameNumber];
    frame.lastAccessTick = clock;
    markDirty();
    return (frameNumber * state.pageSize) + offset;
  }

  /** Advances a process memory references using a rotating virtual page pattern. */
  function accessProcess(pid, clock) {
    if (!state.processPageCounts.has(pid)) {
      return null;
    }
    const pageCount = state.processPageCounts.get(pid) || 1;
    const nextPage = (state.nextAccessPage.get(pid) || 0) % pageCount;
    state.nextAccessPage.set(pid, nextPage + 1);
    return translateAddress(pid, nextPage * state.pageSize, clock);
  }

  function usedMemory() {
    return state.frames.filter((frame) => frame.pid != null).length * state.pageSize;
  }

  function processMemoryUsage(pid) {
    return state.processSizes.get(pid) || 0;
  }

  /** Returns a serializable snapshot of memory state for the UI. */
  function getSnapshot() {
    clearExpiredFlashes();
    return {
      total: state.totalMemory,
      used: usedMemory(),
      free: state.totalMemory - usedMemory(),
      pageSize: state.pageSize,
      frameCount: state.frameCount,
      frames: state.frames.map((frame) => ({
        frameNumber: frame.frameNumber,
        status: frame.pid == null ? "FREE" : "OCCUPIED",
        pid: frame.pid,
        virtualPage: frame.virtualPage,
        lastAccessTick: frame.lastAccessTick,
        flash: frame.flash,
      })),
      pageTables: Object.fromEntries(
        [...state.pageTables.entries()].map(([pid, mappings]) => [
          String(pid),
          [...mappings.entries()].sort((left, right) => left[0] - right[0]).map(([virtualPage, frameNumber]) => ({
            virtualPage,
            frameNumber,
          })),
        ]),
      ),
      events: state.events.map((entry) => ({ ...entry })),
      pressureHistory: [...state.pressureHistory],
    };
  }

  return {
    allocateProcess,
    freeProcess,
    translateAddress,
    accessProcess,
    processMemoryUsage,
    getSnapshot,
  };
}
