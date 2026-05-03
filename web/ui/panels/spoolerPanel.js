import { CONFIG } from "../../config.js?v=20260503c";

/** Creates the printer spooler panel renderer and job submission controls. */
export function createSpoolerPanel({ container, spooler, requestRender }) {
  const state = {
    dirty: true,
  };

  container.innerHTML = `
    <div class="panel-shell spooler-panel">
      <div class="panel-toolbar">
        <input class="sf-input" data-field="document" type="text" placeholder="Document name" />
        <input class="sf-input" data-field="pages" type="number" min="1" value="${CONFIG.spooler.defaultPages}" placeholder="Pages" />
        <button class="sf-button primary" data-role="submit" type="button">Submit Job</button>
      </div>
      <div class="printer-job-list" data-role="jobs"></div>
    </div>
  `;

  const refs = {
    document: container.querySelector('[data-field="document"]'),
    pages: container.querySelector('[data-field="pages"]'),
    submit: container.querySelector('[data-role="submit"]'),
    jobs: container.querySelector('[data-role="jobs"]'),
  };

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function bindControls() {
    refs.submit.addEventListener("click", () => {
      const result = spooler.submitJob(refs.document.value, Number(refs.pages.value));
      if (result.ok) {
        refs.document.value = "";
      }
      markDirty();
    });
  }

  /** Initializes the printer spooler controls. */
  function init() {
    bindControls();
  }

  /** Marks the printer panel dirty after queue or progress updates. */
  function markDirtyFromBus() {
    markDirty();
  }

  /** Re-renders the printer job cards and their progress bars. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    const snapshot = spooler.getSnapshot();
    const jobs = [...snapshot.queue, ...snapshot.completed];
    refs.jobs.replaceChildren(...(jobs.length ? jobs.map((job) => {
      const card = document.createElement("div");
      const isPrinting = job.jobId === snapshot.activeJobId || job.status === "PRINTING";
      const isDone = job.status === "DONE";
      card.className = "printer-job-card";
      card.innerHTML = `
        <div class="printer-job-icon">${CONFIG.icons.printerBadge}</div>
        <div class="printer-job-meta">
          <strong>${job.documentName}</strong>
          <span>${job.pages} pages</span>
          <div class="progress-track"><div class="progress-fill" style="width:${isDone ? 100 : job.progress || 0}%"></div></div>
        </div>
        <div class="printer-job-status">
          <span class="job-status ${isDone ? "done" : isPrinting ? "printing" : "queued"}">${isDone ? `${CONFIG.icons.check} DONE` : isPrinting ? "<span class=\"pulse-dot\"></span>PRINTING" : "QUEUED"}</span>
        </div>
      `;
      return card;
    }) : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "No print jobs." })]));
  }

  return {
    init,
    markDirty: markDirtyFromBus,
    render,
  };
}
