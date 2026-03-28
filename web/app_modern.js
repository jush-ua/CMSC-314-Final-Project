const state = {
  selectedFile: null,
  snapshot: null,
  busyCount: 0,
};

const elements = {
  clockPill: document.getElementById("clock-pill"),
  schedulerPill: document.getElementById("scheduler-pill"),
  runningPill: document.getElementById("running-pill"),
  statTotalProcesses: document.getElementById("stat-total-processes"),
  statReady: document.getElementById("stat-ready"),
  statWaiting: document.getElementById("stat-waiting"),
  statFiles: document.getElementById("stat-files"),
  schedulerSelect: document.getElementById("scheduler-select"),
  customTicks: document.getElementById("custom-ticks"),
  processForm: document.getElementById("process-form"),
  processName: document.getElementById("process-name"),
  processMemory: document.getElementById("process-memory"),
  processCpu: document.getElementById("process-cpu"),
  fileForm: document.getElementById("file-form"),
  fileName: document.getElementById("file-name"),
  fileContent: document.getElementById("file-content"),
  processTable: document.getElementById("process-table"),
  memoryUsed: document.getElementById("memory-used"),
  memoryFree: document.getElementById("memory-free"),
  memoryTotal: document.getElementById("memory-total"),
  memoryBar: document.getElementById("memory-bar"),
  memoryList: document.getElementById("memory-list"),
  fileList: document.getElementById("file-list"),
  previewName: document.getElementById("preview-name"),
  previewMeta: document.getElementById("preview-meta"),
  previewContent: document.getElementById("preview-content"),
  activityLog: document.getElementById("activity-log"),
  flashMessage: document.getElementById("flash-message"),
};

async function apiRequest(path, payload = {}, options = {}) {
  const response = await fetch(path, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.method === "GET" ? undefined : JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

async function loadState() {
  const response = await fetch("/api/state");
  const data = await response.json();
  render(data);
}

function render(payload) {
  const simState = payload.state ? payload.state : payload;
  state.snapshot = simState;
  renderHeader(simState);
  renderStats(simState);
  renderProcesses(simState.processes);
  renderMemory(simState.memory);
  renderFiles(simState.files);
  renderActivity(simState.event_log);
}

function renderHeader(simState) {
  elements.clockPill.textContent = `Clock ${simState.clock}`;
  elements.schedulerPill.textContent = `Scheduler ${simState.scheduler}`;
  elements.runningPill.textContent = simState.running_pid
    ? `CPU PID ${simState.running_pid}`
    : "CPU Idle";
  elements.schedulerSelect.value = simState.scheduler.toLowerCase();
}

function renderStats(simState) {
  elements.statTotalProcesses.textContent = simState.summary.total_processes;
  elements.statReady.textContent = simState.summary.ready;
  elements.statWaiting.textContent = simState.summary.waiting;
  elements.statFiles.textContent = simState.summary.files;
}

function renderProcesses(processes) {
  if (!processes.length) {
    elements.processTable.innerHTML =
      '<tr><td colspan="7"><div class="empty-state">No processes yet. Create one to start the scheduler.</div></td></tr>';
    return;
  }

  elements.processTable.innerHTML = processes
    .map((process) => {
      const ioLabel =
        process.state === "waiting"
          ? `${process.io_reason || "I/O"} | ${process.io_ticks_remaining} ticks`
          : "Ready";

      return `
        <tr>
          <td>${process.pid}</td>
          <td>${escapeHtml(process.name)}</td>
          <td><span class="state-pill state-${process.state}">${process.state}</span></td>
          <td>${process.memory_required}</td>
          <td>${process.cpu_time_remaining}</td>
          <td>${escapeHtml(ioLabel)}</td>
          <td>
            <div class="row-actions">
              <button class="tiny-button" data-action="block" data-pid="${process.pid}">Block</button>
              <button class="tiny-button" data-action="unblock" data-pid="${process.pid}">Unblock</button>
              <button class="tiny-button danger" data-action="kill" data-pid="${process.pid}">Kill</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderMemory(memory) {
  elements.memoryUsed.textContent = memory.used;
  elements.memoryFree.textContent = memory.free;
  elements.memoryTotal.textContent = memory.total;

  elements.memoryBar.textContent = "";
  const segments = [];
  let cursor = 0;

  memory.allocations.forEach((block) => {
    if (cursor < block.start) {
      segments.push({
        label: "Free",
        size: block.start - cursor,
        type: "free",
      });
    }

    segments.push({
      label: `PID ${block.pid}`,
      size: block.size,
      type: "used",
    });
    cursor = block.end + 1;
  });

  if (cursor < memory.total) {
    segments.push({
      label: "Free",
      size: memory.total - cursor,
      type: "free",
    });
  }

  const fragment = document.createDocumentFragment();
  segments.forEach((segment, index) => {
    const node = document.createElement("div");
    node.className = `memory-segment ${segment.type}`;
    node.style.flexGrow = segment.size;
    node.style.background = segment.type === "free" ? "#e6ebf1" : pickMemoryColor(index);
    node.title = `${segment.label} | ${segment.size} units`;
    fragment.appendChild(node);
  });
  elements.memoryBar.appendChild(fragment);

  if (!memory.allocations.length) {
    elements.memoryList.innerHTML =
      '<div class="empty-state">Memory is fully available. No active allocations.</div>';
    return;
  }

  elements.memoryList.innerHTML = memory.allocations
    .map(
      (block) => `
        <div class="memory-item">
          <strong>PID ${block.pid}</strong>
          <span>Address ${block.start} to ${block.end}</span><br />
          <span>${block.size} memory units</span>
        </div>
      `
    )
    .join("");
}

function renderFiles(files) {
  if (!files.length) {
    elements.fileList.innerHTML =
      '<div class="empty-state">No files created. Use the file workspace to add one.</div>';
    state.selectedFile = null;
    renderPreview(null);
    return;
  }

  if (!state.selectedFile || !files.some((file) => file.name === state.selectedFile)) {
    state.selectedFile = files[0].name;
  }

  elements.fileList.innerHTML = files
    .map(
      (file) => `
        <div class="file-item ${file.name === state.selectedFile ? "active" : ""}" data-file="${escapeAttribute(
          file.name
        )}">
          <strong>${escapeHtml(file.name)}</strong>
          <span class="file-meta">${file.size} bytes</span>
          <div class="file-actions">
            <button class="tiny-button" data-action="select-file" data-file="${escapeAttribute(file.name)}">Open</button>
            <button class="tiny-button danger" data-action="delete-file" data-file="${escapeAttribute(file.name)}">Delete</button>
          </div>
        </div>
      `
    )
    .join("");

  const selected = files.find((file) => file.name === state.selectedFile) || null;
  renderPreview(selected);
}

function renderPreview(file) {
  if (!file) {
    elements.previewName.textContent = "No file selected";
    elements.previewMeta.textContent = "0 bytes";
    elements.previewContent.textContent = "Select a file from the list to view its contents.";
    return;
  }

  elements.previewName.textContent = file.name;
  elements.previewMeta.textContent = `${file.size} bytes`;
  elements.previewContent.textContent = file.content || "(empty file)";
  elements.fileName.value = file.name;
  elements.fileContent.value = file.content;
}

function renderActivity(eventLog) {
  if (!eventLog.length) {
    elements.activityLog.innerHTML = '<div class="empty-state">No events yet.</div>';
    return;
  }

  elements.activityLog.innerHTML = eventLog
    .slice()
    .reverse()
    .map((event) => `<div class="activity-item">${escapeHtml(event)}</div>`)
    .join("");
}

function showFlash(message, extraMessages = []) {
  const parts = [message, ...extraMessages].filter(Boolean);
  if (!parts.length) {
    elements.flashMessage.classList.add("hidden");
    elements.flashMessage.textContent = "";
    return;
  }

  elements.flashMessage.innerHTML = parts.map((part) => `<div>${escapeHtml(part)}</div>`).join("");
  elements.flashMessage.classList.remove("hidden");
}

function pickMemoryColor(index) {
  const palette = ["#2463eb", "#0f9d77", "#f08a24", "#7c5cff"];
  return palette[index % palette.length];
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function setBusy(isBusy) {
  state.busyCount += isBusy ? 1 : -1;
  const disabled = state.busyCount > 0;
  document.querySelectorAll("button, input, select, textarea").forEach((element) => {
    element.disabled = disabled;
  });
}

function selectFile(filename) {
  state.selectedFile = filename;
  if (state.snapshot) {
    renderFiles(state.snapshot.files);
  }
}

async function runAction(path, payload = {}, messageOverride = "") {
  setBusy(true);
  try {
    const data = await apiRequest(path, payload);
    render(data);
    showFlash(messageOverride || data.message, data.messages);
  } catch (error) {
    showFlash(error.message);
  } finally {
    setBusy(false);
  }
}

document.getElementById("set-scheduler").addEventListener("click", async () => {
  await runAction("/api/scheduler", { scheduler: elements.schedulerSelect.value });
});

document.querySelectorAll(".tick-buttons button").forEach((button) => {
  button.addEventListener("click", async () => {
    await runAction("/api/tick", { steps: Number(button.dataset.steps) });
  });
});

document.getElementById("tick-custom").addEventListener("click", async () => {
  await runAction("/api/tick", { steps: Number(elements.customTicks.value || 1) });
});

document.getElementById("load-demo").addEventListener("click", async () => {
  state.selectedFile = "notes.txt";
  await runAction("/api/demo");
});

document.getElementById("reset-sim").addEventListener("click", async () => {
  state.selectedFile = null;
  await runAction("/api/reset");
});

elements.processForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runAction("/api/process/create", {
    name: elements.processName.value.trim(),
    memory: Number(elements.processMemory.value),
    cpu_time: Number(elements.processCpu.value),
  });
  elements.processName.value = "";
  elements.processMemory.value = "32";
  elements.processCpu.value = "5";
});

elements.processTable.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const pid = Number(button.dataset.pid);
  const action = button.dataset.action;

  if (action === "kill") {
    await runAction("/api/process/kill", { pid });
    return;
  }

  if (action === "unblock") {
    await runAction("/api/process/unblock", { pid });
    return;
  }

  if (action === "block") {
    const ticks = Number(window.prompt("Block for how many ticks?", "2"));
    if (!ticks) {
      return;
    }
    const reason = window.prompt("Reason for I/O wait?", "disk") || "I/O";
    await runAction("/api/process/block", { pid, ticks, reason });
  }
});

document.getElementById("create-file").addEventListener("click", async () => {
  const filename = elements.fileName.value.trim();
  if (!filename) {
    showFlash("File name is required.");
    return;
  }
  state.selectedFile = filename;
  await runAction("/api/file/create", { filename });
});

elements.fileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const filename = elements.fileName.value.trim();
  if (!filename) {
    showFlash("File name is required.");
    return;
  }
  state.selectedFile = filename;
  await runAction("/api/file/write", {
    filename,
    content: elements.fileContent.value,
    append: false,
  });
});

document.getElementById("append-file").addEventListener("click", async () => {
  const filename = elements.fileName.value.trim();
  if (!filename) {
    showFlash("File name is required.");
    return;
  }
  state.selectedFile = filename;
  await runAction("/api/file/write", {
    filename,
    content: elements.fileContent.value,
    append: true,
  });
});

elements.fileList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const item = event.target.closest(".file-item[data-file]");

  if (button) {
    const filename = button.dataset.file;
    if (button.dataset.action === "delete-file") {
      if (state.selectedFile === filename) {
        state.selectedFile = null;
      }
      await runAction("/api/file/delete", { filename });
      return;
    }

    if (button.dataset.action === "select-file") {
      selectFile(filename);
      return;
    }
  }

  if (item) {
    selectFile(item.dataset.file);
  }
});

loadState().catch((error) => {
  showFlash(error.message);
});
