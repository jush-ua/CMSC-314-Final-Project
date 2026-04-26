const state = {
  snapshot: null,
  windowState: {},
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

function pidColor(pid) {
  const palette = ["#6f9cff", "#5fd2b0", "#f8b464", "#f38ec8", "#8fb8ff", "#9fd37b", "#c091ff"];
  return palette[(Number(pid) || 0) % palette.length];
}

function initWindowSystem() {
  document.querySelectorAll(".desktop-window").forEach((windowNode, index) => {
    const id = windowNode.dataset.window;
    state.windowState[id] = {
      hidden: false,
      maximized: false,
      rect: {
        left: parseInt(windowNode.style.left, 10),
        top: parseInt(windowNode.style.top, 10),
        width: parseInt(windowNode.style.width, 10),
        height: parseInt(windowNode.style.height, 10),
      },
    };
    windowNode.style.zIndex = String(state.highestZ + index);
    windowNode.addEventListener("pointerdown", () => bringToFront(windowNode));

    const titlebar = windowNode.querySelector("[data-drag-handle='true']");
    titlebar.addEventListener("pointerdown", (event) => startDrag(event, windowNode));

    windowNode.querySelectorAll("[data-window-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handleWindowAction(windowNode, button.dataset.windowAction);
      });
    });

    windowNode.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => startResize(event, windowNode, handle.dataset.resize));
    });
  });
  rebuildTaskbar();
}

function bringToFront(windowNode) {
  state.highestZ += 1;
  windowNode.style.zIndex = String(state.highestZ);
  document.querySelectorAll(".desktop-window").forEach((node) => node.classList.remove("active"));
  windowNode.classList.add("active");
}

function rebuildTaskbar() {
  elements.taskbarWindows.innerHTML = "";
  Object.keys(state.windowState).forEach((id) => {
    const node = document.querySelector(`[data-window="${id}"]`);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "taskbar-button";
    if (!state.windowState[id].hidden) {
      button.classList.add("active-task");
    }
    button.textContent = node.querySelector(".window-title span:last-child").textContent;
    button.addEventListener("click", () => toggleWindow(id));
    elements.taskbarWindows.appendChild(button);
  });
}

function toggleWindow(id) {
  const node = document.querySelector(`[data-window="${id}"]`);
  const model = state.windowState[id];
  if (!model.hidden) {
    node.classList.add("hidden-window");
    model.hidden = true;
  } else {
    node.classList.remove("hidden-window");
    model.hidden = false;
    bringToFront(node);
  }
  rebuildTaskbar();
}

function handleWindowAction(windowNode, action) {
  const id = windowNode.dataset.window;
  if (action === "minimize" || action === "close") {
    state.windowState[id].hidden = true;
    windowNode.classList.add("hidden-window");
    rebuildTaskbar();
    return;
  }

  if (action === "maximize") {
    toggleMaximize(windowNode);
  }
}

function toggleMaximize(windowNode) {
  const id = windowNode.dataset.window;
  const model = state.windowState[id];
  const desktopRect = elements.windowLayer.getBoundingClientRect();

  if (!model.maximized) {
    model.rect = {
      left: windowNode.offsetLeft,
      top: windowNode.offsetTop,
      width: windowNode.offsetWidth,
      height: windowNode.offsetHeight,
    };
    windowNode.style.left = "12px";
    windowNode.style.top = "12px";
    windowNode.style.width = `${desktopRect.width - 24}px`;
    windowNode.style.height = `${desktopRect.height - 24}px`;
    model.maximized = true;
  } else {
    windowNode.style.left = `${model.rect.left}px`;
    windowNode.style.top = `${model.rect.top}px`;
    windowNode.style.width = `${model.rect.width}px`;
    windowNode.style.height = `${model.rect.height}px`;
    model.maximized = false;
  }
  bringToFront(windowNode);
}

function startDrag(event, windowNode) {
  const id = windowNode.dataset.window;
  if (state.windowState[id].maximized) {
    return;
  }
  bringToFront(windowNode);
  const startX = event.clientX;
  const startY = event.clientY;
  const originLeft = windowNode.offsetLeft;
  const originTop = windowNode.offsetTop;

  const move = (moveEvent) => {
    windowNode.style.left = `${originLeft + moveEvent.clientX - startX}px`;
    windowNode.style.top = `${Math.max(0, originTop + moveEvent.clientY - startY)}px`;
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    const desktopRect = elements.windowLayer.getBoundingClientRect();
    if (windowNode.getBoundingClientRect().left <= desktopRect.left + 12) {
      snapWindow(windowNode, "left");
    } else if (windowNode.getBoundingClientRect().right >= desktopRect.right - 12) {
      snapWindow(windowNode, "right");
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function snapWindow(windowNode, side) {
  const id = windowNode.dataset.window;
  const model = state.windowState[id];
  const desktopRect = elements.windowLayer.getBoundingClientRect();
  model.rect = {
    left: windowNode.offsetLeft,
    top: windowNode.offsetTop,
    width: windowNode.offsetWidth,
    height: windowNode.offsetHeight,
  };
  windowNode.style.top = "12px";
  windowNode.style.height = `${desktopRect.height - 24}px`;
  windowNode.style.width = `${Math.floor((desktopRect.width - 30) / 2)}px`;
  windowNode.style.left = side === "left" ? "12px" : `${Math.floor(desktopRect.width / 2) + 3}px`;
  model.maximized = false;
}

function startResize(event, windowNode, direction) {
  event.stopPropagation();
  bringToFront(windowNode);
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = windowNode.offsetLeft;
  const startTop = windowNode.offsetTop;
  const startWidth = windowNode.offsetWidth;
  const startHeight = windowNode.offsetHeight;

  const move = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (direction.includes("e")) {
      windowNode.style.width = `${Math.max(320, startWidth + dx)}px`;
    }
    if (direction.includes("s")) {
      windowNode.style.height = `${Math.max(220, startHeight + dy)}px`;
    }
    if (direction.includes("w")) {
      const nextWidth = Math.max(320, startWidth - dx);
      windowNode.style.width = `${nextWidth}px`;
      windowNode.style.left = `${startLeft + (startWidth - nextWidth)}px`;
    }
    if (direction.includes("n")) {
      const nextHeight = Math.max(220, startHeight - dy);
      windowNode.style.height = `${nextHeight}px`;
      windowNode.style.top = `${startTop + (startHeight - nextHeight)}px`;
    }
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function openWindow(id) {
  const node = document.querySelector(`[data-window="${id}"]`);
  node.classList.remove("hidden-window");
  state.windowState[id].hidden = false;
  bringToFront(node);
  rebuildTaskbar();
}

function closeStartMenu() {
  elements.startMenu.classList.add("hidden");
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
          <td>${process.cpu_percent.toFixed(1)}</td>
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
  elements.memorySummary.textContent = `${memory.used / memory.page_size}/${memory.frame_count} frames in use • page size ${formatUnits(memory.page_size)}`;
  elements.memoryGrid.innerHTML = memory.frames
    .map((frame) => {
      const color = frame.pid == null ? "#7d8794" : pidColor(frame.pid);
      return `
        <div class="frame-card ${frame.status === "FREE" ? "free" : ""}" style="border-left: 4px solid ${color}">
          <div class="frame-card-label">Frame ${frame.frame_number}</div>
          <strong>${frame.status}</strong>
          <div>${frame.pid == null ? "FREE" : `PID ${frame.pid}`}</div>
          <div>${frame.virtual_page == null ? "—" : `VPage ${frame.virtual_page}`}</div>
        </div>
      `;
    })
    .join("");

  const pageTables = Object.entries(memory.page_tables);
  elements.pageTablePanel.innerHTML = pageTables.length
    ? pageTables
        .map(
          ([pid, mappings]) => `
            <div class="page-table-card">
              <strong>PID ${pid}</strong>
              <div>${mappings.length ? mappings.map((entry) => `V${entry.virtual_page} → F${entry.frame_number}`).join(", ") : "No mappings"}</div>
            </div>
          `
        )
        .join("")
    : '<div class="page-table-card">No page tables loaded.</div>';

  elements.memoryEvents.innerHTML = memory.events.length
    ? memory.events.map((event) => `<div>${escapeHtml(event)}</div>`).join("")
    : "<div>No memory events yet.</div>";

  const percentage = memory.total ? Math.min(100, (memory.used / memory.total) * 100) : 0;
  elements.memoryBatteryFill.style.width = `${percentage}%`;
}

function renderDisk(disk) {
  elements.trackStrip.innerHTML = "";
  for (let index = 0; index < disk.track_count; index += 1) {
    const node = document.createElement("div");
    node.className = `track-node ${index === disk.current_track ? "active" : ""}`;
    node.title = `Track ${index}`;
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

  drawSeekHistory(disk.seek_history, disk.track_count);
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

function formatUnits(value) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} units`;
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
    const running = !state.snapshot.runtime.scheduler_running;
    runAction("/api/scheduler/run", { running });
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
    const running = !state.snapshot.runtime.disk_running;
    runAction("/api/disk/run", { running });
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
