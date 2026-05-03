import { CONFIG } from "../../config.js?v=20260503c";

/** Creates the process manager panel renderer and interactions. */
export function createProcessPanel({ container, scheduler, requestRender }) {
  const state = {
    dirty: true,
    filterKey: "all",
    searchTerm: "",
    sortKey: "pid",
    sortDir: "asc",
    selectedPid: 0,
    formOpen: false,
  };
  const ganttTickWidth = 20;
  const ganttPalette = ["#007aff", "#34c759", "#ff9f0a", "#ff3b30", "#5856d6", "#5ac8fa"];

  container.innerHTML = `
    <div class="panel-shell process-panel">
      <aside class="panel-sidebar">
        <div class="sidebar-title">Filters</div>
        <div class="sidebar-filter-list"></div>
      </aside>
      <section class="panel-main">
        <div class="panel-toolbar">
          <label class="search-field">
            <span class="search-icon">${CONFIG.icons.search}</span>
            <input type="search" data-role="search" placeholder="Search processes" />
          </label>
          <button class="sf-button primary" data-role="toggle-form" type="button">+ New Process</button>
          <select class="sf-select" data-role="algorithm"></select>
          <button class="sf-button" data-role="apply-algorithm" type="button">Apply</button>
          <button class="sf-button" data-role="toggle-run" type="button">Pause</button>
        </div>
        <div class="process-creator hidden" data-role="form">
          <input class="sf-input" data-field="name" type="text" placeholder="Process name" />
          <input class="sf-input" data-field="memory" type="number" min="1" value="${CONFIG.scheduler.defaultMemoryUnits}" placeholder="Memory" />
          <input class="sf-input" data-field="cpu" type="number" min="1" value="${CONFIG.scheduler.defaultCpuTime}" placeholder="CPU ticks" />
          <input class="sf-input" data-field="priority" type="number" min="${CONFIG.scheduler.minPriority}" max="${CONFIG.scheduler.maxPriority}" value="${CONFIG.scheduler.defaultPriority}" placeholder="Priority" />
          <button class="sf-button primary" data-role="create-process" type="button">Create</button>
        </div>
        <section class="process-gantt-card">
          <div class="process-gantt-header">
            <div>
              <div class="section-kicker">CPU Timeline</div>
              <div class="process-gantt-caption">Recent execution slices grouped by process.</div>
            </div>
            <div class="process-gantt-legend" data-role="gantt-legend"></div>
          </div>
          <div class="process-gantt-empty hidden" data-role="gantt-empty">No scheduler history yet.</div>
          <div class="process-gantt-scroll" data-role="gantt"></div>
        </section>
        <div class="process-table-shell">
          <div class="process-table-header"></div>
          <div class="process-table-body"></div>
        </div>
      </section>
    </div>
  `;

  const refs = {
    filterList: container.querySelector(".sidebar-filter-list"),
    search: container.querySelector('[data-role="search"]'),
    algorithm: container.querySelector('[data-role="algorithm"]'),
    applyAlgorithm: container.querySelector('[data-role="apply-algorithm"]'),
    toggleRun: container.querySelector('[data-role="toggle-run"]'),
    toggleForm: container.querySelector('[data-role="toggle-form"]'),
    form: container.querySelector('[data-role="form"]'),
    header: container.querySelector(".process-table-header"),
    body: container.querySelector(".process-table-body"),
    gantt: container.querySelector('[data-role="gantt"]'),
    ganttLegend: container.querySelector('[data-role="gantt-legend"]'),
    ganttEmpty: container.querySelector('[data-role="gantt-empty"]'),
  };

  function badgeClass(process) {
    return `state-badge ${process.state}`;
  }

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function sortedProcesses(processes) {
    const direction = state.sortDir === "asc" ? 1 : -1;
    return [...processes].sort((left, right) => {
      const leftValue = left[state.sortKey];
      const rightValue = right[state.sortKey];
      if (leftValue === rightValue) {
        return left.pid - right.pid;
      }
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    });
  }

  function filteredProcesses(processes) {
    return sortedProcesses(processes.filter((process) => {
      const matchesFilter = state.filterKey === "all" || process.state === state.filterKey;
      const haystack = `${process.pid} ${process.name} ${process.state}`.toLowerCase();
      const matchesSearch = !state.searchTerm || haystack.includes(state.searchTerm);
      return matchesFilter && matchesSearch;
    }));
  }

  function buildHeader() {
    const columns = [
      ["pid", "PID"],
      ["name", "Name"],
      ["state", "State"],
      ["cpuPercent", "CPU%"],
      ["memoryUsage", "Memory"],
      ["priority", "Priority"],
    ];
    refs.header.replaceChildren(...columns.map(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-header-button";
      button.textContent = label;
      button.dataset.sortKey = key;
      button.addEventListener("click", () => {
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = "asc";
        }
        markDirty();
      });
      return button;
    }), Object.assign(document.createElement("div"), { className: "table-header-static", textContent: "Actions" }));
  }

  function buildFilters() {
    refs.filterList.replaceChildren(...CONFIG.scheduler.filterKeys.map((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-filter";
      button.textContent = key === "all" ? "All Processes" : `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      button.dataset.filterKey = key;
      button.addEventListener("click", () => {
        state.filterKey = key;
        markDirty();
      });
      return button;
    }));
  }

  function bindControls() {
    CONFIG.scheduler.algorithms.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      refs.algorithm.appendChild(option);
    });
    refs.search.addEventListener("input", () => {
      state.searchTerm = refs.search.value.trim().toLowerCase();
      markDirty();
    });
    refs.toggleForm.addEventListener("click", () => {
      state.formOpen = !state.formOpen;
      markDirty();
    });
    refs.applyAlgorithm.addEventListener("click", () => {
      scheduler.setAlgorithm(refs.algorithm.value);
      markDirty();
    });
    refs.toggleRun.addEventListener("click", () => {
      const running = scheduler.getSnapshot().running;
      scheduler.setRunning(!running);
      markDirty();
    });
    refs.form.querySelector('[data-role="create-process"]').addEventListener("click", () => {
      const result = scheduler.createProcess({
        name: refs.form.querySelector('[data-field="name"]').value,
        memoryRequired: Number(refs.form.querySelector('[data-field="memory"]').value),
        cpuTime: Number(refs.form.querySelector('[data-field="cpu"]').value),
        priority: Number(refs.form.querySelector('[data-field="priority"]').value),
      });
      if (result.ok) {
        refs.form.querySelector('[data-field="name"]').value = "";
        state.formOpen = false;
      }
      markDirty();
    });
  }

  function processColor(pid, index) {
    if (pid == null) {
      return "rgba(110, 110, 115, 0.58)";
    }
    return ganttPalette[index % ganttPalette.length];
  }

  function buildGanttSegments(timeline, lanes) {
    const laneSegments = new Map(lanes.map((lane) => [lane.key, []]));
    timeline.forEach((entry, index) => {
      const laneKey = entry.pid == null ? "idle" : String(entry.pid);
      const segmentList = laneSegments.get(laneKey);
      if (!segmentList) {
        return;
      }
      const previous = segmentList[segmentList.length - 1];
      if (previous && previous.pid === entry.pid && previous.end === index) {
        previous.end += 1;
        previous.length += 1;
        return;
      }
      segmentList.push({
        pid: entry.pid,
        name: entry.name,
        start: index,
        end: index + 1,
        length: 1,
        clock: entry.clock,
      });
    });
    return laneSegments;
  }

  function renderGantt(snapshot) {
    const timeline = snapshot.timeline || [];
    const processLanes = snapshot.processes.map((process) => ({
      key: String(process.pid),
      label: `PID ${process.pid} · ${process.name}`,
      pid: process.pid,
    }));
    const lanes = [...processLanes, { key: "idle", label: "Idle", pid: null }];
    const segmentsByLane = buildGanttSegments(timeline, lanes);

    refs.ganttLegend.replaceChildren(...processLanes.slice(0, 6).map((lane, index) => {
      const item = document.createElement("div");
      item.className = "process-gantt-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "process-gantt-legend-swatch";
      swatch.style.background = processColor(lane.pid, index);
      const label = document.createElement("span");
      label.textContent = lane.label;
      item.append(swatch, label);
      return item;
    }));

    if (!timeline.length) {
      refs.gantt.classList.add("hidden");
      refs.ganttEmpty.classList.remove("hidden");
      refs.gantt.replaceChildren();
      return;
    }

    refs.gantt.classList.remove("hidden");
    refs.ganttEmpty.classList.add("hidden");

    const ganttTrack = document.createElement("div");
    ganttTrack.className = "process-gantt-track";
    ganttTrack.style.setProperty("--gantt-width", `${Math.max(timeline.length, 1) * ganttTickWidth}px`);

    const ruler = document.createElement("div");
    ruler.className = "process-gantt-ruler";
    ruler.style.width = `calc(${Math.max(timeline.length, 1) * ganttTickWidth}px + 140px)`;
    for (let tick = 0; tick < timeline.length; tick += 1) {
      if (tick % 4 !== 0 && tick !== timeline.length - 1) {
        continue;
      }
      const marker = document.createElement("span");
      marker.className = "process-gantt-tick";
      marker.style.left = `calc(140px + ${tick * ganttTickWidth}px)`;
      marker.textContent = `T${timeline[tick].clock}`;
      ruler.appendChild(marker);
    }
    ganttTrack.appendChild(ruler);

    lanes.forEach((lane, laneIndex) => {
      const row = document.createElement("div");
      row.className = "process-gantt-row";
      const label = document.createElement("div");
      label.className = "process-gantt-row-label";
      label.textContent = lane.label;
      const laneBar = document.createElement("div");
      laneBar.className = "process-gantt-row-bars";
      laneBar.style.setProperty("--gantt-width", `${Math.max(timeline.length, 1) * ganttTickWidth}px`);
      laneBar.style.setProperty("--gantt-tick-width", `${ganttTickWidth}px`);
      const segments = segmentsByLane.get(lane.key) || [];
      segments.forEach((segment) => {
        const bar = document.createElement("div");
        bar.className = `process-gantt-segment ${segment.pid == null ? "idle" : "running"}`;
        bar.style.left = `${segment.start * ganttTickWidth}px`;
        bar.style.width = `${segment.length * ganttTickWidth}px`;
        bar.style.background = processColor(segment.pid, laneIndex);
        bar.textContent = segment.pid == null ? "Idle" : `P${segment.pid}`;
        bar.title = `${segment.name || "Idle"} | ticks ${segment.start} to ${segment.end - 1}`;
        laneBar.appendChild(bar);
      });
      row.append(label, laneBar);
      ganttTrack.appendChild(row);
    });

    refs.gantt.replaceChildren(ganttTrack);
  }

  /** Initializes the process panel DOM and event handlers. */
  function init() {
    buildHeader();
    buildFilters();
    bindControls();
  }

  /** Marks the process panel dirty after scheduler updates. */
  function markDirtyFromBus() {
    markDirty();
  }

  /** Re-renders the process list, filters, and toolbar state. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    const snapshot = scheduler.getSnapshot();
    refs.algorithm.value = snapshot.algorithm;
    refs.toggleRun.textContent = snapshot.running ? "Pause" : "Resume";
    refs.form.classList.toggle("hidden", !state.formOpen);
    refs.filterList.querySelectorAll(".sidebar-filter").forEach((button) => {
      button.classList.toggle("active", button.dataset.filterKey === state.filterKey);
    });
    refs.header.querySelectorAll(".table-header-button").forEach((button) => {
      button.classList.toggle("sort-asc", button.dataset.sortKey === state.sortKey && state.sortDir === "asc");
      button.classList.toggle("sort-desc", button.dataset.sortKey === state.sortKey && state.sortDir === "desc");
    });
    renderGantt(snapshot);
    const rows = filteredProcesses(snapshot.processes);
    const fragment = document.createDocumentFragment();
    rows.forEach((process, index) => {
      const row = document.createElement("div");
      row.className = "process-row";
      row.classList.toggle("alt", index % 2 === 1);
      row.classList.toggle("selected", process.pid === state.selectedPid);
      row.addEventListener("click", () => {
        state.selectedPid = process.pid;
        markDirty();
      });
      row.innerHTML = `
        <div>${process.pid}</div>
        <div>${process.name}</div>
        <div><span class="${badgeClass(process)}">${process.state.toUpperCase()}</span></div>
        <div>${process.cpuPercent.toFixed(1)}</div>
        <div>${(process.memoryUsage / 1024).toFixed(1)} KB</div>
        <div>${process.priority}</div>
      `;
      const actionCell = document.createElement("div");
      actionCell.className = "row-actions";
      [
        ["Block", () => scheduler.blockProcess(process.pid, CONFIG.scheduler.blockTicks, "I/O")],
        ["Ready", () => scheduler.unblockProcess(process.pid)],
        ["End", () => scheduler.terminateProcess(process.pid), "danger"],
      ].forEach(([label, handler, extraClass]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `tiny-button ${extraClass || ""}`.trim();
        button.textContent = label;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          handler();
          markDirty();
        });
        actionCell.appendChild(button);
      });
      row.appendChild(actionCell);
      fragment.appendChild(row);
    });
    refs.body.replaceChildren(fragment);
  }

  return {
    init,
    markDirty: markDirtyFromBus,
    render,
  };
}
