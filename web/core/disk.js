import { CONFIG } from "../config.js?v=20260503c";

/** Creates the disk manager with FAT allocation, LOOK ordering, and seek history. */
export function createDiskManager({ bus }) {
  const state = {
    trackCount: CONFIG.disk.trackCount,
    sectorsPerTrack: CONFIG.disk.sectorsPerTrack,
    totalSectors: CONFIG.disk.trackCount * CONFIG.disk.sectorsPerTrack,
    currentTrack: 0,
    currentSector: 0,
    direction: 1,
    pendingRequests: [],
    completedRequests: [],
    seekHistory: [0],
    movementLog: [],
    files: new Map(),
    sectors: Array.from({ length: CONFIG.disk.trackCount * CONFIG.disk.sectorsPerTrack }, () => null),
    nextRequestId: 1,
    running: true,
    timerId: window.setInterval(processSeekStep, CONFIG.disk.seekIntervalMs),
  };

  function appendLog(message) {
    state.movementLog.unshift({ timestamp: Date.now(), message });
    state.movementLog = state.movementLog.slice(0, CONFIG.disk.movementLogLimit);
    bus.emit("disk:updated");
  }

  function requestId() {
    const request = `REQ-${String(state.nextRequestId).padStart(3, "0")}`;
    state.nextRequestId += 1;
    return request;
  }

  function sectorIndex(track, sector) {
    return (track * state.sectorsPerTrack) + sector;
  }

  function trackSector(index) {
    return {
      track: Math.floor(index / state.sectorsPerTrack),
      sector: index % state.sectorsPerTrack,
    };
  }

  function emitUpdate() {
    bus.emit("disk:updated");
  }

  function allocateSectors(name, sizeSectors) {
    const freeIndices = state.sectors.flatMap((owner, index) => (owner == null ? [index] : []));
    if (freeIndices.length < sizeSectors) {
      return null;
    }

    let contiguous = [];
    let runStart = -1;
    let runLength = 0;
    for (let index = 0; index < state.sectors.length; index += 1) {
      if (state.sectors[index] == null) {
        runStart = runStart === -1 ? index : runStart;
        runLength += 1;
        if (runLength >= sizeSectors) {
          contiguous = Array.from({ length: sizeSectors }, (_, offset) => runStart + offset);
          break;
        }
      } else {
        runStart = -1;
        runLength = 0;
      }
    }

    return contiguous.length ? contiguous : freeIndices.slice(0, sizeSectors);
  }

  /** Creates a disk file and allocates sectors in the FAT. */
  function createFile(name, sizeSectors) {
    const safeName = String(name || "").trim();
    const safeSize = Number(sizeSectors);
    if (!safeName) {
      return { ok: false, message: "File name is required." };
    }
    if (state.files.has(safeName)) {
      return { ok: false, message: `File '${safeName}' already exists.` };
    }
    if (safeSize <= 0) {
      return { ok: false, message: "File size must be positive." };
    }
    const allocation = allocateSectors(safeName, safeSize);
    if (!allocation) {
      return { ok: false, message: `Not enough free disk sectors to create '${safeName}'.` };
    }
    const sectors = allocation.map((index) => trackSector(index));
    allocation.forEach((index) => {
      state.sectors[index] = safeName;
    });
    state.files.set(safeName, {
      name: safeName,
      sizeSectors: safeSize,
      sectors,
      version: 1,
      lastReadBy: null,
      lastWrittenBy: null,
      operationCount: 0,
    });
    appendLog(`Created file '${safeName}' using ${safeSize} sector(s).`);
    emitUpdate();
    return { ok: true, message: `Created file '${safeName}' using ${safeSize} sector(s).` };
  }

  /** Deletes a disk file and frees each of its sectors. */
  function deleteFile(name) {
    const safeName = String(name || "").trim();
    const file = state.files.get(safeName);
    if (!file) {
      return { ok: false, message: `File '${safeName}' does not exist.` };
    }
    file.sectors.forEach(({ track, sector }) => {
      state.sectors[sectorIndex(track, sector)] = null;
    });
    state.files.delete(safeName);
    appendLog(`Deleted file '${safeName}'.`);
    emitUpdate();
    return { ok: true, message: `Deleted file '${safeName}'.` };
  }

  function queueDiskRequest(track, sector, operation, processId, filename) {
    if (state.pendingRequests.length >= CONFIG.disk.queueLimit) {
      return null;
    }
    const request = {
      requestId: requestId(),
      track,
      sector,
      operation: operation.toUpperCase(),
      processId: Number(processId),
      filename,
      status: "PENDING",
      queuedAt: Date.now(),
    };
    state.pendingRequests.push(request);
    appendLog(`Queued ${request.operation} request ${request.requestId} for PID ${processId} at T${track}:S${sector}`);
    return request;
  }

  /** Queues READ requests for every sector belonging to a disk file. */
  function readFile(name, processId) {
    const file = state.files.get(String(name || "").trim());
    if (!file) {
      return { ok: false, message: `File '${name}' does not exist.` };
    }
    file.lastReadBy = Number(processId);
    file.operationCount += 1;
    file.sectors.forEach(({ track, sector }) => {
      queueDiskRequest(track, sector, "READ", processId, file.name);
    });
    emitUpdate();
    return { ok: true, message: `Queued READ requests for '${file.name}' from PID ${processId}.` };
  }

  /** Queues WRITE requests for every sector belonging to a disk file. */
  function writeFile(name, processId) {
    const file = state.files.get(String(name || "").trim());
    if (!file) {
      return { ok: false, message: `File '${name}' does not exist.` };
    }
    file.lastWrittenBy = Number(processId);
    file.operationCount += 1;
    file.version += 1;
    file.sectors.forEach(({ track, sector }) => {
      queueDiskRequest(track, sector, "WRITE", processId, file.name);
    });
    emitUpdate();
    return { ok: true, message: `Queued WRITE requests for '${file.name}' from PID ${processId}.` };
  }

  function peekServiceOrder() {
    if (!state.pendingRequests.length) {
      return [];
    }
    const requests = [...state.pendingRequests];
    if (state.direction >= 0) {
      const forward = requests
        .filter((request) => request.track >= state.currentTrack)
        .sort((left, right) => left.track - right.track || left.sector - right.sector);
      const backward = requests
        .filter((request) => request.track < state.currentTrack)
        .sort((left, right) => right.track - left.track || right.sector - left.sector);
      return forward.length ? [...forward, ...backward] : backward;
    }
    const backward = requests
      .filter((request) => request.track <= state.currentTrack)
      .sort((left, right) => right.track - left.track || right.sector - left.sector);
    const forward = requests
      .filter((request) => request.track > state.currentTrack)
      .sort((left, right) => left.track - right.track || left.sector - right.sector);
    return backward.length ? [...backward, ...forward] : forward;
  }

  /** Processes a single LOOK disk seek step when the loop is running. */
  function processSeekStep() {
    if (!state.running || !state.pendingRequests.length) {
      return;
    }
    const target = peekServiceOrder()[0];
    if (!target) {
      return;
    }
    if (target.track > state.currentTrack) {
      state.direction = 1;
      state.currentTrack += 1;
      state.seekHistory.push(state.currentTrack);
      state.seekHistory = state.seekHistory.slice(-CONFIG.disk.seekHistoryLimit);
      appendLog(`Head moved to track ${state.currentTrack}`);
      emitUpdate();
      return;
    }
    if (target.track < state.currentTrack) {
      state.direction = -1;
      state.currentTrack -= 1;
      state.seekHistory.push(state.currentTrack);
      state.seekHistory = state.seekHistory.slice(-CONFIG.disk.seekHistoryLimit);
      appendLog(`Head moved to track ${state.currentTrack}`);
      emitUpdate();
      return;
    }

    state.currentSector = target.sector;
    target.status = "COMPLETED";
    state.pendingRequests = state.pendingRequests.filter((request) => request.requestId !== target.requestId);
    state.completedRequests.unshift(target);
    state.completedRequests = state.completedRequests.slice(0, CONFIG.disk.completedLimit);
    state.seekHistory.push(state.currentTrack);
    state.seekHistory = state.seekHistory.slice(-CONFIG.disk.seekHistoryLimit);
    appendLog(`Serviced ${target.operation} request ${target.requestId} for PID ${target.processId} at T${target.track}:S${target.sector}`);
    emitUpdate();
  }

  /** Pauses or resumes the real-time disk service loop. */
  function setRunning(isRunning) {
    state.running = Boolean(isRunning);
    appendLog(state.running ? "Disk service running." : "Disk service paused.");
    emitUpdate();
    return { ok: true, message: state.running ? "Disk service running." : "Disk service paused." };
  }

  /** Returns a serializable snapshot of disk state for the UI. */
  function getSnapshot() {
    return {
      trackCount: state.trackCount,
      sectorsPerTrack: state.sectorsPerTrack,
      totalSectors: state.totalSectors,
      currentTrack: state.currentTrack,
      currentSector: state.currentSector,
      direction: state.direction,
      running: state.running,
      queue: peekServiceOrder().map((request) => ({ ...request })),
      completed: state.completedRequests.map((request) => ({ ...request })),
      fat: Object.fromEntries(
        [...state.files.entries()].map(([name, file]) => [
          name,
          {
            name,
            sizeSectors: file.sizeSectors,
            version: file.version,
            lastReadBy: file.lastReadBy,
            lastWrittenBy: file.lastWrittenBy,
            operationCount: file.operationCount,
            sectors: file.sectors.map((sector) => ({ ...sector })),
          },
        ]),
      ),
      sectorMap: state.sectors.map((filename, index) => ({
        ...trackSector(index),
        filename,
        status: filename == null ? "FREE" : "OCCUPIED",
      })),
      seekHistory: [...state.seekHistory],
      movementLog: state.movementLog.map((entry) => ({ ...entry })),
      files: [...state.files.values()].map((file) => ({
        name: file.name,
        sizeSectors: file.sizeSectors,
        version: file.version,
        lastReadBy: file.lastReadBy,
        lastWrittenBy: file.lastWrittenBy,
        operationCount: file.operationCount,
        sectors: file.sectors.map((sector) => ({ ...sector })),
      })),
    };
  }

  return {
    createFile,
    deleteFile,
    readFile,
    writeFile,
    setRunning,
    getSnapshot,
  };
}
