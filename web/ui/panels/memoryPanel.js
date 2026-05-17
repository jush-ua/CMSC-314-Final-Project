import { CONFIG } from "../../config.js?v=20260503c";
import { createMemoryCanvas } from "../canvas/canvasMemory.js?v=20260503c";
import { throttle } from "../../util.js?v=20260503c";

/** Creates the memory panel renderer with frame grid, page tables, and access controls. */
export function createMemoryPanel({ container, memory, scheduler, tooltip, requestRender }) {
  const state = {
    dirty: true,
  };
  const tooltipUpdateHandlers = new Set();

  container.innerHTML = `
    <div class="panel-shell memory-panel">
      <div class="memory-topbar">
        <div class="memory-summary" data-role="summary"></div>
        <div class="memory-access-controls">
          <input class="sf-input" data-field="pid" type="number" min="1" placeholder="PID" />
          <input class="sf-input" data-field="address" type="number" min="0" value="0" placeholder="Virtual address" />
          <button class="sf-button primary" data-role="access" type="button">Access Page</button>
        </div>
      </div>
      <canvas class="memory-pressure-canvas" data-role="canvas"></canvas>
      <div class="memory-frame-grid" data-role="frames"></div>
      <details class="sf-disclosure" open>
        <summary>Page Tables</summary>
        <div class="page-table-list" data-role="page-tables"></div>
      </details>
      <details class="sf-disclosure" open>
        <summary>Event Log</summary>
        <div class="event-log" data-role="events"></div>
      </details>
    </div>
  `;

  const refs = {
    summary: container.querySelector('[data-role="summary"]'),
    pid: container.querySelector('[data-field="pid"]'),
    address: container.querySelector('[data-field="address"]'),
    access: container.querySelector('[data-role="access"]'),
    frames: container.querySelector('[data-role="frames"]'),
    pageTables: container.querySelector('[data-role="page-tables"]'),
    events: container.querySelector('[data-role="events"]'),
    canvas: container.querySelector('[data-role="canvas"]'),
  };

  const canvasRenderer = createMemoryCanvas({ canvas: refs.canvas });

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function pidColor(pid) {
    return CONFIG.memory.palette[(Number(pid) - 1 + CONFIG.memory.palette.length) % CONFIG.memory.palette.length];
  }

  function showTooltip(text, event) {
    tooltip.textContent = text;
    tooltip.classList.remove("hidden");
    tooltip.style.left = `${event.clientX + CONFIG.ui.tooltipOffset}px`;
    tooltip.style.top = `${event.clientY + CONFIG.ui.tooltipOffset}px`;
  }

  function hideTooltip() {
    tooltip.classList.add("hidden");
  }

  function clearTooltipHandlers() {
    tooltipUpdateHandlers.forEach((handler) => handler.cancel?.());
    tooltipUpdateHandlers.clear();
  }

  function bindControls() {
    refs.access.addEventListener("click", () => {
      const pid = Number(refs.pid.value);
      const address = Number(refs.address.value);
      const clock = scheduler.getSnapshot().clock;
      memory.translateAddress(pid, address, clock);
      markDirty();
    });
  }

  /** Initializes the memory panel controls and canvas renderer. */
  function init() {
    bindControls();
  }

  /** Marks the memory panel dirty after memory events. */
  function markDirtyFromBus() {
    markDirty();
  }

  /** Re-renders the memory frame grid, page tables, and event log. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    clearTooltipHandlers();
    hideTooltip();
    const snapshot = memory.getSnapshot();
    canvasRenderer.markDirty(snapshot);
    canvasRenderer.render();
    refs.summary.textContent = `${Math.round(snapshot.used / snapshot.pageSize)} / ${snapshot.frameCount} frames in use | page size ${(snapshot.pageSize / 1024).toFixed(1)} KB`;
    refs.frames.replaceChildren(...snapshot.frames.map((frame) => {
      const card = document.createElement("div");
      card.className = "memory-frame";
      card.classList.toggle("free", frame.pid == null);
      card.classList.toggle("fault-flash", frame.flash === "fault");
      card.classList.toggle("eviction-flash", frame.flash === "eviction");
      card.style.background = frame.pid == null ? "#e5e5ea" : pidColor(frame.pid);
      card.innerHTML = `<strong>F${frame.frameNumber}</strong><span>${frame.pid == null ? "FREE" : `PID ${frame.pid}`}</span><span>${frame.virtualPage == null ? "" : `VP ${frame.virtualPage}`}</span>`;
      const tooltipText = `Frame ${frame.frameNumber} | ${frame.pid == null ? "FREE" : `PID ${frame.pid}, page ${frame.virtualPage}`}`;
      const updateTooltip = throttle((event) => showTooltip(tooltipText, event), CONFIG.ui.tooltipMoveThrottleMs);
      tooltipUpdateHandlers.add(updateTooltip);
      card.addEventListener("mouseenter", updateTooltip);
      card.addEventListener("mousemove", updateTooltip);
      card.addEventListener("mouseleave", () => {
        updateTooltip.cancel?.();
        hideTooltip();
      });
      return card;
    }));
    const pageTableEntries = Object.entries(snapshot.pageTables);
    refs.pageTables.replaceChildren(...(pageTableEntries.length ? pageTableEntries.map(([pid, mappings]) => {
      const card = document.createElement("div");
      card.className = "page-table-card";
      card.innerHTML = `<strong>PID ${pid}</strong><div class="page-table-grid">${mappings.map((entry) => `<span>V${entry.virtualPage}</span><span>F${entry.frameNumber}</span>`).join("") || "<span>No mappings</span>"}</div>`;
      return card;
    }) : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "No page tables loaded." })]));
    refs.events.replaceChildren(...(snapshot.events.length ? snapshot.events.map((entry) => {
      const line = document.createElement("div");
      line.className = `event-line ${entry.type}`;
      line.textContent = entry.message;
      return line;
    }) : [Object.assign(document.createElement("div"), { className: "empty-state-card", textContent: "No memory events yet." })]));
  }

  return {
    init,
    markDirty: markDirtyFromBus,
    render,
  };
}
