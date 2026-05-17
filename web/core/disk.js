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
    // files keyed by full path (e.g. /docs/readme.txt)
    files: new Map(),
    // set of directory paths (always contains '/')
    directories: new Set(['/']),
    // file contents stored by filename
    // each file entry will include a `content` string property
    sectors: Array.from({ length: CONFIG.disk.trackCount * CONFIG.disk.sectorsPerTrack }, () => null),
    nextRequestId: 1,
    running: true,
    timerId: window.setInterval(processSeekStep, CONFIG.disk.seekIntervalMs),
  };
  const BYTES_PER_SECTOR = 512;

  // Helper utilities for path handling
  function normalizePath(p) {
    if (!p) return '/';
    let path = String(p).trim();
    if (!path) return '/';
    // convert simple filename to root path
    if (!path.startsWith('/')) path = '/' + path;
    // normalize backslashes to forward slashes and collapse duplicates
    path = path.replace(/\\/g, '/');
    path = path.replace(/\/+/g, '/');
    // remove trailing slash except for root
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function dirname(path) {
    path = normalizePath(path);
    if (path === '/') return '/';
    const parts = path.split('/');
    parts.pop();
    const dir = parts.join('/') || '/';
    return dir;
  }

  function basename(path) {
    path = normalizePath(path);
    if (path === '/') return '/';
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  function appendLog(message) {
    state.movementLog.unshift({ timestamp: Date.now(), message });
    state.movementLog = state.movementLog.slice(0, CONFIG.disk.movementLogLimit);
    bus.emit("disk:updated");
  }

  function inferIcon(name) {
    if (!name) return 'file';
    const ext = String(name).split('.').pop().toLowerCase();
    if (ext === name) return 'file';
    const map = { md: 'markdown', txt: 'text', js: 'code', json: 'code', html: 'web', css: 'web', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bin: 'binary' };
    return map[ext] || 'file';
  }

  function humanSize(bytes) {
    if (!Number.isFinite(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

  /** Creates a disk file (at path) and allocates sectors in the FAT. */
  function createFile(path, sizeSectors) {
    const fullPath = normalizePath(path);
    const name = basename(fullPath);
    const parent = dirname(fullPath);
    let safeSize = Number(sizeSectors);
    if (!Number.isFinite(safeSize) || safeSize <= 0) safeSize = Number(CONFIG.disk.defaultFileSize || 6);
    if (!name || name === '/') {
      return { ok: false, message: 'File name is required.' };
    }
    if (!state.directories.has(parent)) {
      return { ok: false, message: `Directory '${parent}' does not exist.` };
    }
    if (state.files.has(fullPath)) {
      return { ok: false, message: `File '${fullPath}' already exists.` };
    }
    if (safeSize <= 0) {
      return { ok: false, message: 'File size must be positive.' };
    }
    const allocation = allocateSectors(fullPath, safeSize);
    if (!allocation) return { ok: false, message: `Not enough free disk sectors to create '${fullPath}'.` };
    const sectors = allocation.map((index) => trackSector(index));
    allocation.forEach((index) => { state.sectors[index] = fullPath; });
    state.files.set(fullPath, {
      path: fullPath,
      name,
      sizeSectors: safeSize,
      sectors,
      content: '',
      version: 1,
      lastReadBy: null,
      lastWrittenBy: null,
      operationCount: 0,
    });
    appendLog(`Created file '${fullPath}' using ${safeSize} sector(s).`);
    emitUpdate();
    return { ok: true, message: `Created file '${fullPath}' using ${safeSize} sector(s).` };
  }

  /** Deletes a file or directory. Directories are removed recursively. */
  function deletePath(path) {
    const fullPath = normalizePath(path);
    if (fullPath === '/') return { ok: false, message: 'Cannot delete root.' };
    if (state.files.has(fullPath)) {
      const file = state.files.get(fullPath);
      file.sectors.forEach(({ track, sector }) => { state.sectors[sectorIndex(track, sector)] = null; });
      state.files.delete(fullPath);
      appendLog(`Deleted file '${fullPath}'.`);
      emitUpdate();
      return { ok: true, message: `Deleted file '${fullPath}'.` };
    }
    // directory removal (recursive)
    if (state.directories.has(fullPath)) {
      // collect files and directories to remove
      const filesToRemove = [...state.files.keys()].filter((k) => k === fullPath || k.startsWith(fullPath + '/'));
      filesToRemove.forEach((k) => {
        const f = state.files.get(k);
        f.sectors.forEach(({ track, sector }) => { state.sectors[sectorIndex(track, sector)] = null; });
        state.files.delete(k);
      });
      const dirsToRemove = [...state.directories].filter((d) => d === fullPath || d.startsWith(fullPath + '/'));
      dirsToRemove.forEach((d) => state.directories.delete(d));
      appendLog(`Deleted directory '${fullPath}' and ${filesToRemove.length} file(s).`);
      emitUpdate();
      return { ok: true, message: `Deleted directory '${fullPath}'.` };
    }
    return { ok: false, message: `Path '${fullPath}' does not exist.` };
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
  function readFile(path, processId) {
    const fullPath = normalizePath(path);
    const file = state.files.get(fullPath);
    if (!file) return { ok: false, message: `File '${fullPath}' does not exist.` };
    file.lastReadBy = Number(processId);
    file.operationCount += 1;
    file.sectors.forEach(({ track, sector }) => { queueDiskRequest(track, sector, 'READ', processId, file.path); });
    emitUpdate();
    return { ok: true, message: `Queued READ requests for '${file.path}' from PID ${processId}.` };
  }

  // If `content` is provided, update the stored file content before queueing writes.
  function writeFile(path, processId, content) {
    const fullPath = normalizePath(path);
    const file = state.files.get(fullPath);
    if (!file) return { ok: false, message: `File '${fullPath}' does not exist.` };
    if (content !== undefined) file.content = String(content);
    file.lastWrittenBy = Number(processId);
    file.operationCount += 1;
    file.version += 1;
    // Recalculate required sector count from content length and attempt to resize allocation if needed.
    try {
      const bytes = String(file.content || '').length;
      const required = Math.max(1, Math.ceil(bytes / BYTES_PER_SECTOR));
      if (required !== file.sizeSectors) {
        // try to allocate a fresh contiguous allocation for the new size
        const allocation = allocateSectors(fullPath, required);
        if (allocation) {
          // free old sectors
          file.sectors.forEach(({ track, sector }) => { state.sectors[sectorIndex(track, sector)] = null; });
          // assign new sectors
          const sectors = allocation.map((index) => trackSector(index));
          allocation.forEach((index) => { state.sectors[index] = fullPath; });
          file.sectors = sectors;
          file.sizeSectors = required;
          appendLog(`Resized '${fullPath}' to ${required} sector(s) (${bytes} bytes).`);
        } else {
          appendLog(`Unable to resize '${fullPath}' to ${required} sector(s); keeping existing allocation.`);
        }
      }
    } catch (e) {
      // ignore resizing errors
    }
    file.sectors.forEach(({ track, sector }) => { queueDiskRequest(track, sector, 'WRITE', processId, file.path); });
    appendLog(`Queued WRITE requests for '${file.path}' from PID ${processId}.`);
    emitUpdate();
    return { ok: true, message: `Queued WRITE requests for '${file.path}' from PID ${processId}.` };
  }

  /** Returns the textual contents of a file (for editor/viewer). */
  function getFileContent(name) {
    const file = state.files.get(String(name || "").trim());
    if (!file) {
      return { ok: false, message: `File '${name}' does not exist.` };
    }
    file.lastReadBy = null;
    file.operationCount += 1;
    return { ok: true, content: String(file.content || "") };
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
      fat: Object.fromEntries([...state.files.entries()].map(([path, file]) => [path, {
        path: file.path,
        name: file.name,
        sizeSectors: file.sizeSectors,
        version: file.version,
        lastReadBy: file.lastReadBy,
        lastWrittenBy: file.lastWrittenBy,
        operationCount: file.operationCount,
        sectors: file.sectors.map((sector) => ({ ...sector })),
      }])),
      sectorMap: state.sectors.map((filename, index) => ({
        ...trackSector(index),
        filename,
        status: filename == null ? "FREE" : "OCCUPIED",
      })),
      seekHistory: [...state.seekHistory],
      movementLog: state.movementLog.map((entry) => ({ ...entry })),
      files: [...state.files.values()].map((file) => ({
        path: file.path,
        name: file.name,
        sizeSectors: file.sizeSectors,
        sizeBytes: String(file.content || '').length,
        sizeDisplay: humanSize(String(file.content || '').length),
        icon: inferIcon(file.name),
        version: file.version,
        lastReadBy: file.lastReadBy,
        lastWrittenBy: file.lastWrittenBy,
        operationCount: file.operationCount,
        sectors: file.sectors.map((sector) => ({ ...sector })),
      })),
      directories: [...state.directories],
    };
  }

  /** Create a directory at path (parents must exist or be '/'). */
  function createDirectory(path) {
    const fullPath = normalizePath(path);
    if (state.directories.has(fullPath)) return { ok: false, message: `Directory '${fullPath}' already exists.` };
    const parent = dirname(fullPath);
    if (!state.directories.has(parent)) return { ok: false, message: `Parent directory '${parent}' does not exist.` };
    state.directories.add(fullPath);
    appendLog(`Created directory '${fullPath}'.`);
    emitUpdate();
    return { ok: true, message: `Created directory '${fullPath}'.` };
  }

  /** Lists contents of a directory: { dirs: [], files: [] } */
  function listDir(path) {
    const fullPath = normalizePath(path);
    if (!state.directories.has(fullPath)) return { ok: false, message: `Directory '${fullPath}' does not exist.` };
    const prefix = fullPath === '/' ? '/' : fullPath + '/';
    const dirs = [...state.directories].filter((d) => d !== fullPath && d.startsWith(prefix) && d.slice(prefix.length).indexOf('/') === -1).map((d) => ({ path: d, name: basename(d) }));
    const files = [...state.files.values()].filter((f) => dirname(f.path) === fullPath).map((f) => ({ path: f.path, name: f.name, sizeSectors: f.sizeSectors, version: f.version }));
    const filesMeta = files.map((it) => {
      const f = state.files.get(it.path);
      return {
        path: it.path,
        name: it.name,
        sizeSectors: it.sizeSectors,
        sizeBytes: String(f.content || '').length,
        sizeDisplay: humanSize(String(f.content || '').length),
        icon: inferIcon(it.name),
        version: it.version,
      };
    });
    return { ok: true, dirs, files: filesMeta };
  }

  /** Rename a file or directory (preserves recursive structure for directories). */
  function renamePath(oldPath, newPath) {
    const a = normalizePath(oldPath);
    const b = normalizePath(newPath);
    if (a === '/' || b === '/') return { ok: false, message: 'Cannot rename root.' };
    if (state.files.has(a)) {
      if (state.files.has(b)) return { ok: false, message: `Target '${b}' already exists.` };
      const file = state.files.get(a);
      // update sectors owner name
      file.sectors.forEach(({ track, sector }) => { state.sectors[sectorIndex(track, sector)] = b; });
      state.files.delete(a);
      file.path = b;
      file.name = basename(b);
      state.files.set(b, file);
      appendLog(`Renamed file '${a}' → '${b}'.`);
      emitUpdate();
      return { ok: true };
    }
    if (state.directories.has(a)) {
      if (state.directories.has(b)) return { ok: false, message: `Target directory '${b}' already exists.` };
      // move directories
      const toMoveDirs = [...state.directories].filter((d) => d === a || d.startsWith(a + '/'));
      toMoveDirs.forEach((d) => {
        const rel = d.slice(a.length);
        state.directories.add(b + rel);
        state.directories.delete(d);
      });
      // move files
      const toMoveFiles = [...state.files.keys()].filter((k) => k === a || k.startsWith(a + '/'));
      toMoveFiles.forEach((k) => {
        const f = state.files.get(k);
        const rel = k.slice(a.length);
        const newKey = b + rel;
        // update sectors owner
        f.sectors.forEach(({ track, sector }) => { state.sectors[sectorIndex(track, sector)] = newKey; });
        state.files.delete(k);
        f.path = newKey;
        f.name = basename(newKey);
        state.files.set(newKey, f);
      });
      appendLog(`Renamed directory '${a}' → '${b}'.`);
      emitUpdate();
      return { ok: true };
    }
    return { ok: false, message: `Path '${a}' does not exist.` };
  }

  /** Returns the textual contents of a file (for editor/viewer). */
  function getFileContent(path) {
    const fullPath = normalizePath(path);
    const file = state.files.get(fullPath);
    if (!file) return { ok: false, message: `File '${fullPath}' does not exist.` };
    file.lastReadBy = null;
    file.operationCount += 1;
    return { ok: true, content: String(file.content || '') };
  }

  return {
    createFile,
    createDirectory,
    listDir,
    deletePath,
    renamePath,
    readFile,
    writeFile,
    getFileContent,
    setRunning,
    getSnapshot,
  };
}
