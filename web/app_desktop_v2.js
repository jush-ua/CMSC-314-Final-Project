const state = {
  snapshot: null,
  windows: {},
  highestZ: 20,
};

const elements = {
  desktop: document.getElementById("desktop"),
  windowLayer: document.getElementById("window-layer"),
  startMenu: document.getElementById("start-menu"),
  startButton: document.getElementById("start-button"),
  startMenuClose: document.getElementById("start-menu-close"),
  taskbarWindows: document.getElementById("taskbar-windows"),
  themeToggle: document.getElementById("theme-toggle"),
  systemClock: document.getElementById("system-clock"),
  memoryBatteryFill: document.getElementById("memory-battery-fill"),
  schedulerSelect: document.getElementById("scheduler-select"),
  schedulerToggle: document.getElementById("scheduler-toggle"),
  processName: document.getElementById("process-name"),
  processMemory: document.getElementById("process-memory"),
  processCpu: document.getElementById("process-cpu"),
  processTable: document.getElementById("process-table"),
  memoryPid: document.getElementById("memory-pid"),
  memoryAddress: document.getElementById("memory-address"),
  memorySummary: document.getElementById("memory-summary"),
  memoryGrid: document.getElementById("memory-grid"),
  pageTablePanel: document.getElementById("page-table-panel"),
  memoryEvents: document.getElementById("memory-events"),
  diskFileName: document.getElementById("disk-file-name"),
  diskFileSize: document.getElementById("disk-file-size"),
  diskFilePid: document.getElementById("disk-file-pid"),
  diskToggle: document.getElementById("disk-toggle"),
  trackStrip: document.getElementById("track-strip"),
  diskQueueTable: document.getElementById("disk-queue-table"),
  diskCompletedTable: document.getElementById("disk-completed-table"),
  fatPanel: document.getElementById("fat-panel"),
  diskMovementLog: document.getElementById("disk-movement-log"),
  seekHistoryCanvas: document.getElementById("seek-history-canvas"),
  printJobId: document.getElementById("print-job-id"),
  printDocument: document.getElementById("print-document"),
  printPages: document.getElementById("print-pages"),
  printerTable: document.getElementById("printer-table"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function updateClock() {
  const now = new Date();
  elements.systemClock.textContent = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getWindowNode(id) {
  return document.querySelector(`[data-window="${id}"]`);
}

function bringToFront(node) {
  state.highestZ += 1;
  node.style.zIndex = String(state.highestZ);
  document.querySelectorAll(".desktop-window").forEach((windowNode) => {
    windowNode.classList.remove("active");
  });
  node.classList.add("active");
}

function rebuildTaskbar() {
  elements.taskbarWindows.innerHTML = "";
  Object.keys(state.windows).forEach((id) => {
    const node = getWindowNode(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "taskbar-button";
    button.textContent = node.querySelector(".window-title span:last-child").textContent;
    if (!state.windows[id].hidden) {
      button.classList.add("active-task");
    }
    button.addEventListener("click", () => toggleWindow(id));
    elements.taskbarWindows.appendChild(button);
  });
}

function openWindow(id) {
  const node = getWindowNode(id);
  state.windows[id].hidden = false;
  node.classList.remove("hidden-window");
  bringToFront(node);
  rebuildTaskbar();
}

function toggleWindow(id) {
  const node = getWindowNode(id);
  const model = state.windows[id];
  if (model.hidden) {
    openWindow(id);
    return;
  }
  model.hidden = true;
  node.classList.add("hidden-window");
  rebuildTaskbar();
}

function applyWindowRect(node, rect) {
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

function toggleMaximize(node) {
  const desktopRect = elements.windowLayer.getBoundingClientRect();
  const model = state.windows[node.dataset.window];
  if (!model.maximized) {
    model.rect = {
      left: node.offsetLeft,
      top: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    applyWindowRect(node, {
      left: 12,
      top: 12,
      width: desktopRect.width - 24,
      height: desktopRect.height - 24,
    });
    model.maximized = true;
  } else {
    applyWindowRect(node, model.rect);
    model.maximized = false;
  }
  bringToFront(node);
}

function closeStartMenu() {
  elements.startMenu.classList.add("hidden");
}

function snapWindow(node, side) {
  const desktopRect = elements.windowLayer.getBoundingClientRect();
  const model = state.windows[node.dataset.window];
  model.rect = {
    left: node.offsetLeft,
    top: node.offsetTop,
    width: node.offsetWidth,
    height: node.offsetHeight,
  };
  applyWindowRect(node, {
    left: side === "left" ? 12 : Math.floor(desktopRect.width / 2) + 3,
    top: 12,
    width: Math.floor((desktopRect.width - 30) / 2),
    height: desktopRect.height - 24,
  });
  model.maximized = false;
}

function startDrag(event, node) {
  const model = state.windows[node.dataset.window];
  if (model.maximized) {
    return;
  }
  bringToFront(node);
  const startX = event.clientX;
  const startY = event.clientY;
  const originLeft = node.offsetLeft;
  const originTop = node.offsetTop;

  const move = (moveEvent) => {
    node.style.left = `${originLeft + moveEvent.clientX - startX}px`;
    node.style.top = `${Math.max(0, originTop + moveEvent.clientY - startY)}px`;
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    const desktopRect = elements.windowLayer.getBoundingClientRect();
    const windowRect = node.getBoundingClientRect();
    if (windowRect.left <= desktopRect.left + 12) {
      snapWindow(node, "left");
    } else if (windowRect.right >= desktopRect.right - 12) {
      snapWindow(node, "right");
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function startResize(event, node, direction) {
  event.stopPropagation();
  bringToFront(node);
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = node.offsetLeft;
  const startTop = node.offsetTop;
  const startWidth = node.offsetWidth;
  const startHeight = node.offsetHeight;

  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (direction.includes("e")) {
      node.style.width = `${Math.max(320, startWidth + dx)}px`;
    }
    if (direction.includes("s")) {
      node.style.height = `${Math.max(220, startHeight + dy)}px`;
    }
    if (direction.includes("w")) {
      const nextWidth = Math.max(320, startWidth - dx);
      node.style.width = `${nextWidth}px`;
      node.style.left = `${startLeft + (startWidth - nextWidth)}px`;
    }
    if (direction.includes("n")) {
      const nextHeight = Math.max(220, startHeight - dy);
      node.style.height = `${nextHeight}px`;
      node.style.top = `${startTop + (startHeight - nextHeight)}px`;
    }
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function initWindowSystem() {
  document.querySelectorAll(".desktop-window").forEach((node, index) => {
    const id = node.dataset.window;
    state.windows[id] = {
      hidden: false,
      maximized: false,
      rect: {
        left: parseInt(node.style.left, 10),
        top: parseInt(node.style.top, 10),
        width: parseInt(node.style.width, 10),
        height: parseInt(node.style.height, 10),
      },
    };
    node.style.zIndex = String(state.highestZ + index);
    node.addEventListener("pointerdown", () => bringToFront(node));
    node.querySelector("[data-drag-handle='true']").addEventListener("pointerdown", (event) => startDrag(event, node));
    node.querySelectorAll("[data-window-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = button.dataset.windowAction;
        if (action === "maximize") {
          toggleMaximize(node);
          return;
        }
        state.windows[id].hidden = true;
        node.classList.add("hidden-window");
        rebuildTaskbar();
      });
    });
    node.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => startResize(event, node, handle.dataset.resize));
    });
  });
  rebuildTaskbar();
}

function renderProcesses(processes) {
  if (!processes.length) {
    elements.processTable.innerHTML = '<tr><td colspan="6">No processes available.</td></tr>';
    return;
  }

  elements.processTable.innerHTML = processes
    .map(
      (process) => `
        <tr>
          <td>${process.pid}</td>
          <td>${escapeHtml(process.name)}</td>
          <td><span class="state-pill state-${process.state}">${process.state}</span></td>
          <td>${Number(process.cpu_percent).toFixed(1)}</td>
          <td>${formatUnits(process.memory_usage)}</td>
          <td>
            <div class="form-inline">
              <button class="tiny-button" data-process-action="block" data-pid="${process.pid}" type="button">Block</button>
              <button class="tiny-button" data-process-action="unblock" data-pid="${process.pid}" type="button">Ready</button>
              <button class="tiny-button danger" data-process-action="kill" data-pid="${process.pid}" type="button">End</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderMemory(memory) {
  const framesUsed = Math.round(memory.used / memory.page_size);
  elements.memorySummary.textContent = `${framesUsed}/${memory.frame_count} frames in use | page size ${formatUnits(memory.page_size)}`;
  elements.memoryGrid.innerHTML = memory.frames
    .map((frame) => {
      const color = frame.pid == null ? "#7d8794" : pidColor(frame.pid);
      return `
        <div class="frame-card ${frame.status === "FREE" ? "free" : ""}" style="border-left: 4px solid ${color}">
          <div class="frame-card-label">Frame ${frame.frame_number}</div>
          <strong>${frame.status}</strong>
          <div>${frame.pid == null ? "FREE" : `PID ${frame.pid}`}</div>
          <div>${frame.virtual_page == null ? "-" : `VPage ${frame.virtual_page}`}</div>
        </div>
      `;
    })
    .join("");

  const tables = Object.entries(memory.page_tables);
  elements.pageTablePanel.innerHTML = tables.length
    ? tables
        .map(
          ([pid, mappings]) => `
            <div class="page-table-card">
              <strong>PID ${pid}</strong>
              <div>${mappings.length ? mappings.map((entry) => `V${entry.virtual_page} -> F${entry.frame_number}`).join(", ") : "No mappings"}</div>
            </div>
          `
        )
        .join("")
    : '<div class="page-table-card">No page tables loaded.</div>';

  elements.memoryEvents.innerHTML = memory.events.length
    ? memory.events.map((entry) => `<div>${escapeHtml(entry)}</div>`).join("")
    : "<div>No memory events yet.</div>";

  const percentage = memory.total ? Math.min(100, (memory.used / memory.total) * 100) : 0;
  elements.memoryBatteryFill.style.width = `${percentage}%`;
}

function drawSeekHistory(history, trackCount) {
  const canvas = elements.seekHistoryCanvas;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = getComputedStyle(document.body).getPropertyValue("--surface-strong");
  context.fillRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(document.body).getPropertyValue("--accent");
  context.lineWidth = 2;
  context.beginPath();
  history.forEach((value, index) => {
    const x = (index / Math.max(history.length - 1, 1)) * (width - 20) + 10;
    const y = height - 14 - (value / Math.max(trackCount - 1, 1)) * (height - 28);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

function renderDisk(disk) {
  elements.trackStrip.innerHTML = "";
  for (let track = 0; track < disk.track_count; track += 1) {
    const node = document.createElement("div");
    node.className = `track-node ${track === disk.current_track ? "active" : ""}`;
    node.title = `Track ${track}`;
    elements.trackStrip.appendChild(node);
  }

  elements.diskQueueTable.innerHTML = disk.queue.length
    ? disk.queue
        .map(
          (request) => `
            <tr>
              <td>${request.request_id}</td>
              <td>${request.track}</td>
              <td>${request.sector}</td>
              <td>${request.operation}</td>
              <td>${request.process_id}</td>
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="5">No pending requests.</td></tr>';

  elements.diskCompletedTable.innerHTML = disk.completed.length
    ? disk.completed
        .map(
          (request) => `
            <tr>
              <td>${request.request_id}</td>
              <td>${request.track}</td>
              <td>${request.sector}</td>
              <td>${request.operation}</td>
              <td>${request.process_id}</td>
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="5">No completed requests yet.</td></tr>';

  elements.fatPanel.innerHTML = Object.keys(disk.fat).length
    ? Object.entries(disk.fat)
        .map(
          ([name, sectors]) => `
            <div class="fat-file">
              <strong>${escapeHtml(name)}</strong>
              <div>${sectors.length} sector(s): ${sectors.map((sector) => `T${sector.track}:S${sector.sector}`).join(", ")}</div>
            </div>
          `
        )
        .join("")
    : '<div class="fat-file">No files allocated on disk.</div>';

  elements.diskMovementLog.innerHTML = disk.movement_log.length
    ? disk.movement_log.map((entry) => `<div>${escapeHtml(entry)}</div>`).join("")
    : "<div>No disk movement logged yet.</div>";

  drawSeekHistory(disk.seek_history, disk.track_count);
}

function renderPrinter(printer) {
  const jobs = [...printer.queue, ...printer.completed];
  elements.printerTable.innerHTML = jobs.length
    ? jobs
        .map(
          (job) => `
            <tr>
              <td>${escapeHtml(job.job_id)}</td>
              <td>${escapeHtml(job.document_name)}</td>
              <td>${job.size_pages}</td>
              <td>${job.status}</td>
            </tr>
          `
        )
        .join("")
    : '<tr><td colspan="4">No print jobs.</td></tr>';
}

function render(snapshot) {
  state.snapshot = snapshot;
  elements.schedulerSelect.value = snapshot.scheduler.toLowerCase();
  elements.schedulerToggle.textContent = snapshot.runtime.scheduler_running ? "Pause Scheduler" : "Resume Scheduler";
  elements.diskToggle.textContent = snapshot.runtime.disk_running ? "Pause Disk" : "Resume Disk";
  renderProcesses(snapshot.processes);
  renderMemory(snapshot.memory);
  renderDisk(snapshot.disk);
  renderPrinter(snapshot.printer);
}

function loadState() {
  return fetch("/api/state")
    .then((response) => response.json())
    .then(render)
    .catch(() => {});
}

function runAction(path, payload = {}) {
  return apiRequest(path, payload).then((data) => {
    render(data.state);
  });
}

function bindActions() {
  elements.startButton.addEventListener("click", () => {
    elements.startMenu.classList.toggle("hidden");
  });
  elements.startMenuClose.addEventListener("click", closeStartMenu);
  elements.startMenu.querySelectorAll("[data-open-window]").forEach((button) => {
    button.addEventListener("click", () => {
      openWindow(button.dataset.openWindow);
      closeStartMenu();
    });
  });

  elements.themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("theme-dark");
    document.body.classList.toggle("theme-light");
    elements.themeToggle.textContent = document.body.classList.contains("theme-dark") ? "Light" : "Dark";
    if (state.snapshot) {
      render(state.snapshot);
    }
  });

  document.getElementById("create-process").addEventListener("click", () => {
    runAction("/api/process/create", {
      name: elements.processName.value.trim(),
      memory: Number(elements.processMemory.value),
      cpu_time: Number(elements.processCpu.value),
    });
  });

  elements.schedulerToggle.addEventListener("click", () => {
    if (!state.snapshot) {
      return;
    }
    runAction("/api/scheduler/run", { running: !state.snapshot.runtime.scheduler_running });
  });

  document.getElementById("apply-scheduler").addEventListener("click", () => {
    runAction("/api/scheduler", { scheduler: elements.schedulerSelect.value });
  });

  elements.processTable.addEventListener("click", (event) => {
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
    runAction("/api/disk/file/delete", {
      filename: elements.diskFileName.value.trim(),
    });
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
    if (!state.snapshot) {
      return;
    }
    runAction("/api/disk/run", { running: !state.snapshot.runtime.disk_running });
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

  document.addEventListener("pointerdown", (event) => {
    if (!elements.startMenu.contains(event.target) && event.target !== elements.startButton) {
      closeStartMenu();
    }
  });
}

initWindowSystem();
bindActions();
updateClock();
setInterval(updateClock, 1000);
loadState();
setInterval(loadState, 400);
