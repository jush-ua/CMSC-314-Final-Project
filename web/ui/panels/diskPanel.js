import { CONFIG } from "../../config.js?v=20260503c";
import { createDiskCanvas } from "../canvas/canvasDisk.js?v=20260503c";

/** Creates the disk manager panel renderer with canvases, queues, and FAT views. */
export function createDiskPanel({ container, disk, requestRender }) {
  const state = {
    dirty: true,
  };

  container.innerHTML = `
    <div class="panel-shell disk-panel">
      <div class="disk-toolbar">
        <div class="disk-toolbar-row">
          <input class="sf-input" data-field="filename" type="text" placeholder="Filename" />
          <input class="sf-input" data-field="size" type="number" min="1" value="${CONFIG.disk.defaultFileSize}" placeholder="Size" />
          <button class="sf-button primary" data-role="create" type="button">Create File</button>
          <button class="sf-button" data-role="delete" type="button">Delete File</button>
        </div>
        <div class="disk-toolbar-row">
          <input class="sf-input" data-field="pid" type="number" min="1" value="${CONFIG.disk.defaultProcessId}" placeholder="PID" />
          <button class="sf-button" data-role="read" type="button">Read File</button>
          <button class="sf-button" data-role="write" type="button">Write File</button>
          <button class="sf-button" data-role="toggle" type="button">Pause Disk</button>
        </div>
      </div>
      <canvas class="disk-seek-canvas" data-role="seek-canvas"></canvas>
      <canvas class="disk-history-canvas" data-role="history-canvas"></canvas>
      <div class="disk-lower-grid">
        <div class="disk-table-stack">
          <section class="disk-card">
            <div class="section-kicker">Request Queue</div>
            <div class="disk-table" data-role="queue"></div>
          </section>
          <section class="disk-card">
            <div class="section-kicker">Completed Requests</div>
            <div class="disk-table" data-role="completed"></div>
          </section>
        </div>
        <div class="disk-detail-stack">
          <details class="sf-disclosure" open>
            <summary>FAT</summary>
            <div class="fat-list" data-role="fat"></div>
          </details>
          <details class="sf-disclosure" open>
            <summary>Head Movement Log</summary>
            <div class="event-log" data-role="log"></div>
          </details>
        </div>
      </div>
    </div>
  `;

  const refs = {
    filename: container.querySelector('[data-field="filename"]'),
    size: container.querySelector('[data-field="size"]'),
    pid: container.querySelector('[data-field="pid"]'),
    create: container.querySelector('[data-role="create"]'),
    del: container.querySelector('[data-role="delete"]'),
    read: container.querySelector('[data-role="read"]'),
    write: container.querySelector('[data-role="write"]'),
    toggle: container.querySelector('[data-role="toggle"]'),
    queue: container.querySelector('[data-role="queue"]'),
    completed: container.querySelector('[data-role="completed"]'),
    fat: container.querySelector('[data-role="fat"]'),
    log: container.querySelector('[data-role="log"]'),
    seekCanvas: container.querySelector('[data-role="seek-canvas"]'),
    historyCanvas: container.querySelector('[data-role="history-canvas"]'),
  };

  const canvasRenderer = createDiskCanvas({ seekCanvas: refs.seekCanvas, historyCanvas: refs.historyCanvas });

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function callDiskAction(action) {
    const filename = refs.filename.value.trim();
    const size = Number(refs.size.value);
    const pid = Number(refs.pid.value);
    if (action === "create") {
      disk.createFile(filename, size);
    } else if (action === "delete") {
      disk.deleteFile(filename);
    } else if (action === "read") {
      disk.readFile(filename, pid);
    } else if (action === "write") {
      disk.writeFile(filename, pid);
    }
    markDirty();
  }

  function bindControls() {
    refs.create.addEventListener("click", () => callDiskAction("create"));
    refs.del.addEventListener("click", () => callDiskAction("delete"));
    refs.read.addEventListener("click", () => callDiskAction("read"));
    refs.write.addEventListener("click", () => callDiskAction("write"));
    refs.toggle.addEventListener("click", () => {
      const snapshot = disk.getSnapshot();
      disk.setRunning(!snapshot.running);
      markDirty();
    });
  }

  function renderRows(host, rows) {
    host.replaceChildren(...(rows.length ? rows.map((request) => {
      const row = document.createElement("div");
      row.className = "disk-table-row";
      row.innerHTML = `<span>${request.requestId}</span><span>${request.operation}</span><span>PID ${request.processId}</span><span>T${request.track}:S${request.sector}</span>`;
      return row;
    }) : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "No requests." })]));
  }

  /** Initializes disk panel controls and canvas renderers. */
  function init() {
    bindControls();
  }

  /** Marks the disk panel dirty after disk queue updates. */
  function markDirtyFromBus() {
    markDirty();
  }

  /** Re-renders the disk canvases, queue tables, FAT panel, and movement log. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    const snapshot = disk.getSnapshot();
    canvasRenderer.markDirty(snapshot);
    canvasRenderer.render();
    refs.toggle.textContent = snapshot.running ? "Pause Disk" : "Resume Disk";
    renderRows(refs.queue, snapshot.queue);
    renderRows(refs.completed, snapshot.completed);
    refs.fat.replaceChildren(...(snapshot.files.length ? snapshot.files.map((file) => {
      const card = document.createElement("div");
      card.className = "fat-card";
      card.innerHTML = `<strong>${file.name}</strong><div>${file.sizeSectors} sectors | v${file.version}</div><div>${file.sectors.map((sector) => `T${sector.track}:S${sector.sector}`).join(", ")}</div>`;
      return card;
    }) : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "No files allocated." })]));
    refs.log.replaceChildren(...(snapshot.movementLog.length ? snapshot.movementLog.map((entry) => {
      const line = document.createElement("div");
      line.className = "event-line neutral";
      line.textContent = entry.message;
      return line;
    }) : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "Disk idle." })]));
  }

  return {
    init,
    markDirty: markDirtyFromBus,
    render,
  };
}
