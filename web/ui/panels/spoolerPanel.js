import { CONFIG } from "../../config.js?v=20260503c";

/** Creates the printer spooler panel renderer and job submission controls. */
export function createSpoolerPanel({ container, spooler, requestRender }) {
  const state = {
    dirty: true,
  };

  container.innerHTML = `
    <div class="panel-shell printer-panel">
      <div class="printer-overview-card">
        <div class="printer-overview-header">
          <div>
            <div class="section-kicker">Printer</div>
            <strong data-role="printer-name">Office Printer</strong>
          </div>
          <span class="job-status" data-role="device-status">IDLE</span>
        </div>
        <div class="printer-metrics" data-role="metrics"></div>
        <div class="panel-toolbar">
          <button class="sf-button" data-role="toggle-online" type="button">Go Offline</button>
          <button class="sf-button" data-role="toggle-pause" type="button">Pause Queue</button>
          <button class="sf-button" data-role="clear-completed" type="button">Clear History</button>
        </div>
      </div>

      <div class="printer-compose-card">
        <div class="section-kicker">Print Document</div>
        <div class="printer-compose-grid">
          <input class="sf-input" data-field="document" type="text" placeholder="Document name" />
          <input class="sf-input" data-field="pages" type="number" min="1" value="${CONFIG.spooler.defaultPages}" placeholder="Pages" />
          <input class="sf-input" data-field="copies" type="number" min="1" value="1" placeholder="Copies" />
          <select class="sf-select" data-field="colorMode">
            <option value="color">Color</option>
            <option value="bw">Black & White</option>
          </select>
          <select class="sf-select" data-field="duplex">
            <option value="long-edge">Two-Sided</option>
            <option value="none">One-Sided</option>
          </select>
          <select class="sf-select" data-field="paperSize">
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
          </select>
          <select class="sf-select" data-field="quality">
            <option value="draft">Draft</option>
            <option value="standard" selected>Standard</option>
            <option value="high">High</option>
          </select>
          <button class="sf-button primary" data-role="submit" type="button">Print</button>
        </div>
      </div>

      <section class="printer-section-card">
        <div class="printer-section-title">Print Queue</div>
        <div class="printer-job-list" data-role="jobs"></div>
      </section>

      <section class="printer-section-card">
        <div class="printer-section-title">Completed Jobs</div>
        <div class="printer-job-list" data-role="history"></div>
      </section>
    </div>
  `;

  const refs = {
    document: container.querySelector('[data-field="document"]'),
    pages: container.querySelector('[data-field="pages"]'),
    copies: container.querySelector('[data-field="copies"]'),
    colorMode: container.querySelector('[data-field="colorMode"]'),
    duplex: container.querySelector('[data-field="duplex"]'),
    paperSize: container.querySelector('[data-field="paperSize"]'),
    quality: container.querySelector('[data-field="quality"]'),
    deviceStatus: container.querySelector('[data-role="device-status"]'),
    metrics: container.querySelector('[data-role="metrics"]'),
    toggleOnline: container.querySelector('[data-role="toggle-online"]'),
    togglePause: container.querySelector('[data-role="toggle-pause"]'),
    clearCompleted: container.querySelector('[data-role="clear-completed"]'),
    submit: container.querySelector('[data-role="submit"]'),
    jobs: container.querySelector('[data-role="jobs"]'),
    history: container.querySelector('[data-role="history"]'),
  };

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function bindControls() {
    const syncDefaults = () => {
      spooler.updateDefaults({
        colorMode: refs.colorMode.value,
        duplex: refs.duplex.value,
        paperSize: refs.paperSize.value,
        quality: refs.quality.value,
      });
      markDirty();
    };

    refs.submit.addEventListener("click", () => {
      const result = spooler.submitJob({
        documentName: refs.document.value,
        pages: Number(refs.pages.value),
        copies: Number(refs.copies.value),
        colorMode: refs.colorMode.value,
        duplex: refs.duplex.value,
        paperSize: refs.paperSize.value,
        quality: refs.quality.value,
      });
      if (result.ok) {
        refs.document.value = "";
      }
      markDirty();
    });

    refs.toggleOnline.addEventListener("click", () => {
      const snapshot = spooler.getSnapshot();
      spooler.setPrinterOnline(!snapshot.printer.online);
      markDirty();
    });

    refs.togglePause.addEventListener("click", () => {
      const snapshot = spooler.getSnapshot();
      if (snapshot.printer.paused) {
        spooler.resumeQueue();
      } else {
        spooler.pauseQueue();
      }
      markDirty();
    });

    refs.clearCompleted.addEventListener("click", () => {
      spooler.clearCompleted();
      markDirty();
    });

    refs.colorMode.addEventListener("change", syncDefaults);
    refs.duplex.addEventListener("change", syncDefaults);
    refs.paperSize.addEventListener("change", syncDefaults);
    refs.quality.addEventListener("change", syncDefaults);
  }

  /** Initializes the printer spooler controls. */
  function init() {
    bindControls();
  }

  /** Marks the printer panel dirty after queue or progress updates. */
  function markDirtyFromBus() {
    markDirty();
  }

  function statusClass(status) {
    if (status === "PRINTING") return "printing";
    if (status === "DONE") return "done";
    if (status === "PAUSED") return "paused";
    if (status === "OFFLINE") return "offline";
    return "queued";
  }

  function buildJobCard(job, activeJobId) {
    const card = document.createElement("div");
    const isPrinting = job.jobId === activeJobId || job.status === "PRINTING";
    const isDone = job.status === "DONE";
    const resolvedStatus = isDone ? "DONE" : (isPrinting ? "PRINTING" : job.status || "QUEUED");
    const metaLine = `${job.pages} pages • ${job.copies || 1} copies • ${job.paperSize || "A4"}`;
    const modeLine = `${(job.colorMode || "color").toUpperCase()} • ${job.duplex === "none" ? "One-Sided" : "Two-Sided"} • ${(job.quality || "standard").toUpperCase()}`;
    card.className = "printer-job-card";
    card.innerHTML = `
      <div class="printer-job-icon">${CONFIG.icons.printerBadge}</div>
      <div class="printer-job-meta">
        <strong>${job.documentName}</strong>
        <span>${metaLine}</span>
        <span>${modeLine}</span>
        <div class="progress-track"><div class="progress-fill" style="width:${isDone ? 100 : job.progress || 0}%"></div></div>
      </div>
      <div class="printer-job-status">
        <span class="job-status ${statusClass(resolvedStatus)}">${resolvedStatus === "DONE" ? `${CONFIG.icons.check} DONE` : resolvedStatus === "PRINTING" ? "<span class=\"pulse-dot\"></span>PRINTING" : resolvedStatus}</span>
      </div>
    `;

    return card;
  }

  /** Re-renders the printer job cards and their progress bars. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    const snapshot = spooler.getSnapshot();
    const { printer } = snapshot;
    refs.deviceStatus.className = `job-status ${statusClass(printer.status)}`;
    refs.deviceStatus.textContent = printer.status;
    refs.toggleOnline.textContent = printer.online ? "Go Offline" : "Go Online";
    refs.togglePause.textContent = printer.paused ? "Resume Queue" : "Pause Queue";
    refs.metrics.innerHTML = `
      <span class="state-badge ready">Queue: ${snapshot.queue.length}</span>
      <span class="state-badge running">Paper: ${printer.paperLevel} sheets</span>
      <span class="state-badge waiting">Toner: ${printer.tonerLevel}%</span>
    `;

    refs.jobs.replaceChildren(...(snapshot.queue.length
      ? snapshot.queue.map((job) => buildJobCard(job, snapshot.activeJobId))
      : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "Queue is empty." })]));

    refs.history.replaceChildren(...(snapshot.completed.length
      ? snapshot.completed.map((job) => buildJobCard(job, snapshot.activeJobId))
      : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "No completed print jobs." })]));
  }

  return {
    init,
    markDirty: markDirtyFromBus,
    render,
  };
}
