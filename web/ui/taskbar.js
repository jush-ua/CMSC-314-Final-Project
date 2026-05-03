import { CONFIG } from "../config.js?v=20260503c";

/** Creates the interactive menu bar for launch actions, wallpaper controls, and status popovers. */
export function createTaskbar({ bus, elements, windowManager, toggleLauncher, requestRender, actions }) {
  const state = {
    clockText: "",
    dirty: true,
    focusedAppName: "OS Simulator",
    activeMenu: "",
  };

  function markDirty() {
    state.dirty = true;
    requestRender();
  }

  function updateClock() {
    state.clockText = new Intl.DateTimeFormat(CONFIG.clock.locale, CONFIG.clock.options).format(new Date());
    markDirty();
  }

  function menuDefinitions() {
    return {
      File: [
        { label: "Choose Wallpaper...", action: actions.pickWallpaper },
        { label: "Reset Wallpaper", action: actions.resetWallpaper },
      ],
      Edit: [
        { label: "Open Launcher", action: toggleLauncher },
        { label: "Run Scheduler Sample", action: actions.runSampleScheduler },
      ],
      View: [
        { label: "Open Activity Monitor", action: () => actions.openWindow("process-manager") },
        { label: "Open Memory Pressure", action: () => actions.openWindow("memory-manager") },
        { label: "Open Disk Utility", action: () => actions.openWindow("disk-manager") },
        { label: "Open Print Center", action: () => actions.openWindow("printer-manager") },
      ],
      Window: [
        { label: "Show All Windows", action: actions.showAllWindows },
        { label: "Focus Activity Monitor", action: () => actions.openWindow("process-manager") },
      ],
      Help: [
        { label: "Run Memory Sample", action: actions.runSampleMemory },
        { label: "Run Disk Sample", action: actions.runSampleDisk },
        { label: "Run Spooler Sample", action: actions.runSampleSpooler },
        { label: "About OS Simulator", action: actions.showAbout },
      ],
    };
  }

  function popoverItemsForStatus(kind) {
    if (kind === "wifi") {
      return [{ label: "Wi-Fi Connected", action: closeMenu }, { label: "Local Simulator Network", action: closeMenu }];
    }
    if (kind === "battery") {
      return [{ label: "Battery Status: Nominal", action: closeMenu }, { label: "Power Source: Simulated Desktop", action: closeMenu }];
    }
    return [{ label: "Open Launcher", action: toggleLauncher }, { label: "Run Scheduler Sample", action: actions.runSampleScheduler }];
  }

  function closeMenu() {
    state.activeMenu = "";
    markDirty();
  }

  function measurePopoverWidth() {
    return Math.max(220, elements.menuPopover.offsetWidth || 220);
  }

  function openMenu(name, anchor, items, options = {}) {
    state.activeMenu = name;
    elements.menuPopover.innerHTML = "";
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-popover-item";
      button.style.setProperty("--item-index", String(index));
      button.textContent = item.label;
      button.addEventListener("click", () => {
        closeMenu();
        item.action?.();
      });
      elements.menuPopover.appendChild(button);
    });
    const rect = anchor.getBoundingClientRect();
    const width = measurePopoverWidth();
    const alignRight = Boolean(options.alignRight);
    const left = alignRight ? Math.max(8, rect.right - width) : Math.max(8, rect.left);
    elements.menuPopover.style.left = `${left}px`;
    elements.menuPopover.style.top = `${rect.bottom + 6}px`;
    markDirty();
  }

  function buildMenus() {
    const definitions = menuDefinitions();
    elements.menus.replaceChildren(...CONFIG.menus.map((label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-label-button";
      button.textContent = label;
      button.addEventListener("click", () => {
        if (state.activeMenu === label) {
          closeMenu();
          return;
        }
        openMenu(label, button, definitions[label] || [], { alignRight: false });
      });
      return button;
    }));
  }

  function bindStatusButtons() {
    elements.wifi.innerHTML = CONFIG.icons.wifi;
    elements.battery.innerHTML = CONFIG.icons.battery;
    elements.spotlight.innerHTML = CONFIG.icons.spotlight;
    elements.wifi.addEventListener("click", () => openMenu("wifi", elements.wifi, popoverItemsForStatus("wifi"), { alignRight: true }));
    elements.battery.addEventListener("click", () => openMenu("battery", elements.battery, popoverItemsForStatus("battery"), { alignRight: true }));
    elements.spotlight.addEventListener("click", () => openMenu("spotlight", elements.spotlight, popoverItemsForStatus("spotlight"), { alignRight: true }));
  }

  function bind() {
    elements.appleButton.innerHTML = CONFIG.icons.apple;
    elements.appleButton.addEventListener("click", toggleLauncher);
    buildMenus();
    bindStatusButtons();
    updateClock();
    window.setInterval(updateClock, CONFIG.clock.tickMs);
    bus.on("window:focused", ({ id }) => {
      state.focusedAppName = id ? windowManager.getFocusedAppName() : "OS Simulator";
      markDirty();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".menu-label-button") && !event.target.closest(".menu-popover") && !event.target.closest(".menu-extra-button")) {
        closeMenu();
      }
    });
  }

  /** Initializes interactive menu-bar controls and live status widgets. */
  function init() {
    bind();
  }

  /** Re-renders the focused app label, clock, and popover visibility. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    elements.appName.textContent = state.focusedAppName;
    elements.clock.textContent = state.clockText;
    elements.menuPopover.classList.toggle("open", Boolean(state.activeMenu));
    elements.menus.querySelectorAll(".menu-label-button").forEach((button) => {
      button.classList.toggle("active", button.textContent === state.activeMenu);
    });
  }

  return {
    init,
    render,
  };
}
