import { CONFIG, getAppConfig } from "../config.js?v=20260503c";
import { throttle } from "../util.js?v=20260503c";

/** Creates the macOS-style window manager with focus, drag, resize, and snap behavior. */
export function createWindowManager({ bus, windowLayer, getDockIconRect, requestRender }) {
  const state = {
    windows: new Map(),
    zOrder: [],
    activeWindowId: "",
    maximizedWindowId: "",
    spotlightWindowId: "",
    interaction: null,
    dirty: true,
  };

  function viewportBounds() {
    const rect = windowLayer.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function clampWindow(model) {
    const bounds = viewportBounds();
    model.width = Math.max(CONFIG.ui.minWindowWidth, Math.min(model.width, Math.max(CONFIG.ui.minWindowWidth, bounds.width - CONFIG.ui.windowInset)));
    model.height = Math.max(CONFIG.ui.minWindowHeight, Math.min(model.height, Math.max(CONFIG.ui.minWindowHeight, bounds.height - CONFIG.ui.windowInset)));
    model.x = Math.max(0, Math.min(model.x, Math.max(0, bounds.width - model.width)));
    model.y = Math.max(0, Math.min(model.y, Math.max(0, bounds.height - model.height)));
  }

  function markDirty() {
    state.dirty = true;
    requestRender();
    bus.emit("window:updated");
  }

  function computeDockVector(id, model) {
    const dockRect = getDockIconRect(id);
    const layerRect = windowLayer.getBoundingClientRect();
    if (!dockRect) {
      return { x: 0, y: 40 };
    }
    const targetX = (dockRect.left - layerRect.left) + (dockRect.width / 2);
    const targetY = (dockRect.top - layerRect.top) + (dockRect.height / 2);
    const sourceX = model.x + (model.width / 2);
    const sourceY = model.y + (model.height / 2);
    return { x: targetX - sourceX, y: targetY - sourceY };
  }

  function animateNode(model, keyframes, options) {
    model.animation?.cancel();
    if (typeof model.node.animate !== "function") {
      model.animation = null;
      return;
    }
    try {
      model.animation = model.node.animate(keyframes, options);
      model.animation.addEventListener("finish", () => {
        model.animation = null;
        // Trigger render after animation completes to ensure final styles are applied
        markDirty();
      }, { once: true });
    } catch {
      model.animation = null;
    }
  }

  function syncActiveWindow(id) {
    state.activeWindowId = id;
    bus.emit("window:focused", { id, appName: getAppConfig(id)?.appName || "OS Simulator" });
  }

  function focusWindow(id) {
    const model = state.windows.get(id);
    if (!model || model.windowState !== "open") {
      return;
    }
    if (state.maximizedWindowId && state.maximizedWindowId !== id) {
      return;
    }
    state.zOrder = state.zOrder.filter((windowId) => windowId !== id);
    state.zOrder.push(id);
    syncActiveWindow(id);
    markDirty();
  }

  function finalizeHiddenState(model, nextState) {
    model.windowState = nextState;
    model.node.hidden = nextState !== "open";
    model.node.style.visibility = nextState === "open" ? "visible" : "hidden";
    model.node.style.pointerEvents = nextState === "open" ? "auto" : "none";
    if (state.maximizedWindowId === model.id && nextState !== "open") {
      state.maximizedWindowId = "";
    }
    if (state.activeWindowId === model.id && nextState !== "open") {
      const nextFocusId = [...state.zOrder].reverse().find((windowId) => state.windows.get(windowId)?.windowState === "open") || "";
      syncActiveWindow(nextFocusId);
    }
    markDirty();
  }

  function openWindow(id, animation = "open") {
    const model = state.windows.get(id);
    if (!model) {
      return;
    }
    model.windowState = "open";
    model.node.hidden = false;
    model.node.style.visibility = "visible";
    model.node.style.pointerEvents = "auto";
    model.node.style.opacity = "1";
    model.node.style.transform = "translate(0px, 0px) scale(1)";
    if (model.maximized) {
      state.maximizedWindowId = id;
    }
    state.zOrder = state.zOrder.filter((windowId) => windowId !== id);
    state.zOrder.push(id);
    syncActiveWindow(id);
    clampWindow(model);
    const vector = computeDockVector(id, model);
    const keyframes = animation === "restore"
      ? [
          { transform: `translate(${vector.x}px, ${vector.y}px) scale(0.7)`, opacity: 0.06, clipPath: "inset(0 0 80% 0 round 12px)" },
          { transform: "translate(0px, 0px) scale(1)", opacity: 1, clipPath: "inset(0 0 0 0 round 12px)" },
        ]
      : [
          { transform: `translate(${vector.x}px, ${vector.y}px) scale(0.84)`, opacity: 0.65 },
          { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
        ];
    animateNode(model, keyframes, {
      duration: animation === "restore" ? CONFIG.ui.minimizeAnimationMs : CONFIG.ui.openAnimationMs,
      easing: animation === "restore" ? "cubic-bezier(0.2,0.9,0.2,1)" : "cubic-bezier(0.18,0.85,0.22,1)",
      fill: "both",
    });
    markDirty();
  }

  function hideWindow(id, nextState) {
    const model = state.windows.get(id);
    if (!model || model.windowState !== "open") {
      return;
    }
    const vector = computeDockVector(id, model);
    const keyframes = nextState === "minimized"
      ? [
          { transform: "translate(0px, 0px) scale(1)", opacity: 1, clipPath: "inset(0 0 0 0 round 12px)" },
          { transform: `translate(${vector.x}px, ${vector.y}px) scale(0.62)`, opacity: 0.08, clipPath: "inset(0 0 74% 0 round 12px)" },
        ]
      : [
          { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
          { transform: `translate(${vector.x * 0.28}px, ${vector.y * 0.28}px) scale(0.9)`, opacity: 0 },
        ];
    animateNode(model, keyframes, {
      duration: nextState === "minimized" ? CONFIG.ui.minimizeAnimationMs : CONFIG.ui.closeAnimationMs,
      easing: nextState === "minimized" ? "cubic-bezier(0.4,0,1,1)" : "cubic-bezier(0.5,0,0.9,0.2)",
      fill: "both",
    });
    window.setTimeout(() => finalizeHiddenState(model, nextState), nextState === "minimized" ? CONFIG.ui.minimizeAnimationMs : CONFIG.ui.closeAnimationMs);
  }

  function toggleMaximize(id) {
    const model = state.windows.get(id);
    if (!model) {
      return;
    }
    const bounds = viewportBounds();
    if (!model.maximized) {
      model.restoreBounds = { x: model.x, y: model.y, width: model.width, height: model.height };
      model.x = 0;
      model.y = 0;
      model.width = bounds.width;
      model.height = bounds.height;
      model.maximized = true;
      state.maximizedWindowId = id;
    } else if (model.restoreBounds) {
      Object.assign(model, model.restoreBounds);
      model.maximized = false;
      if (state.maximizedWindowId === id) {
        state.maximizedWindowId = "";
      }
    }
    clampWindow(model);
    focusWindow(id);
  }

  function applySnap(model) {
    const bounds = viewportBounds();
    const snapThreshold = CONFIG.ui.windowInset;
    if (model.y <= snapThreshold) {
      model.restoreBounds = { x: model.x, y: model.y, width: model.width, height: model.height };
      model.x = 0;
      model.y = 0;
      model.width = bounds.width;
      model.height = bounds.height;
      model.maximized = true;
      state.maximizedWindowId = model.id;
      return;
    }
    if (model.x <= snapThreshold) {
      model.restoreBounds = { x: model.x, y: model.y, width: model.width, height: model.height };
      model.x = 0;
      model.y = CONFIG.ui.windowInset;
      model.width = bounds.width / 2;
      model.height = bounds.height - CONFIG.ui.windowInset;
      model.maximized = false;
      if (state.maximizedWindowId === model.id) {
        state.maximizedWindowId = "";
      }
      return;
    }
    if (model.x + model.width >= bounds.width - snapThreshold) {
      model.restoreBounds = { x: model.x, y: model.y, width: model.width, height: model.height };
      model.x = bounds.width / 2;
      model.y = CONFIG.ui.windowInset;
      model.width = bounds.width / 2;
      model.height = bounds.height - CONFIG.ui.windowInset;
      model.maximized = false;
      if (state.maximizedWindowId === model.id) {
        state.maximizedWindowId = "";
      }
      return;
    }
  }

  function endInteraction() {
    if (!state.interaction) {
      return;
    }
    const { model, type } = state.interaction;
    if (type === "drag") {
      applySnap(model);
      clampWindow(model);
    }
    state.interaction = null;
    markDirty();
  }

  function beginDrag(event, model) {
    if (event.target.closest(".traffic-button")) {
      return;
    }
    if (model.maximized) {
      return;
    }
    focusWindow(model.id);
    state.interaction = {
      type: "drag",
      model,
      startX: event.clientX,
      startY: event.clientY,
      originX: model.x,
      originY: model.y,
    };
  }

  function beginResize(event, model, edge) {
    focusWindow(model.id);
    state.interaction = {
      type: "resize",
      model,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      originX: model.x,
      originY: model.y,
      originWidth: model.width,
      originHeight: model.height,
    };
  }

  function onPointerMove(event) {
    if (!state.interaction) {
      return;
    }
    const { model, type } = state.interaction;
    if (type === "drag") {
      model.x = state.interaction.originX + (event.clientX - state.interaction.startX);
      model.y = state.interaction.originY + (event.clientY - state.interaction.startY);
      clampWindow(model);
      markDirty();
      return;
    }
    const deltaX = event.clientX - state.interaction.startX;
    const deltaY = event.clientY - state.interaction.startY;
    if (state.interaction.edge.includes("e")) {
      model.width = state.interaction.originWidth + deltaX;
    }
    if (state.interaction.edge.includes("s")) {
      model.height = state.interaction.originHeight + deltaY;
    }
    if (state.interaction.edge.includes("w")) {
      model.width = state.interaction.originWidth - deltaX;
      model.x = state.interaction.originX + deltaX;
    }
    if (state.interaction.edge.includes("n")) {
      model.height = state.interaction.originHeight - deltaY;
      model.y = state.interaction.originY + deltaY;
    }
    clampWindow(model);
    markDirty();
  }

  function createResizeHandle(edge, model) {
    const handle = document.createElement("div");
    handle.className = `resize-handle ${edge}`;
    handle.dataset.edge = edge;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      beginResize(event, model, edge);
    });
    return handle;
  }

  function createWindowNode(app) {
    const model = {
      id: app.id,
      title: app.title,
      appName: app.appName,
      accent: app.accent,
      x: app.window.x,
      y: app.window.y,
      width: app.window.width,
      height: app.window.height,
      restoreBounds: null,
      maximized: false,
      windowState: "closed",
      animation: null,
      node: document.createElement("section"),
      contentNode: document.createElement("div"),
    };
    model.node.className = "desktop-window";
    model.node.dataset.windowId = app.id;
    model.node.hidden = true;
    model.node.innerHTML = `
      <header class="window-titlebar" data-drag-handle="true">
        <div class="traffic-lights">
          <button class="traffic-button close" type="button" aria-label="Close"><span>&times;</span></button>
          <button class="traffic-button minimize" type="button" aria-label="Minimize"><span>&minus;</span></button>
          <button class="traffic-button maximize" type="button" aria-label="Maximize"><span>&#10529;</span></button>
        </div>
        <div class="window-title-text">${app.title}</div>
      </header>
    `;
    model.contentNode.className = "window-content";
    model.node.appendChild(model.contentNode);
    ["n", "e", "s", "w", "ne", "nw", "se", "sw"].forEach((edge) => model.node.appendChild(createResizeHandle(edge, model)));
    model.node.querySelector("[data-drag-handle]").addEventListener("pointerdown", (event) => {
      event.preventDefault();
      beginDrag(event, model);
    });
    model.node.addEventListener("pointerdown", () => focusWindow(app.id));
    model.node.querySelector(".traffic-button.close").addEventListener("click", () => hideWindow(app.id, "closed"));
    model.node.querySelector(".traffic-button.minimize").addEventListener("click", () => hideWindow(app.id, "minimized"));
    model.node.querySelector(".traffic-button.maximize").addEventListener("click", () => toggleMaximize(app.id));
    windowLayer.appendChild(model.node);
    state.windows.set(app.id, model);
    state.zOrder.push(app.id);
  }

  /** Registers all application windows declared in the configuration. */
  function registerWindows() {
    CONFIG.apps.filter((app) => app.window).forEach(createWindowNode);
    markDirty();
  }

  /** Opens or focuses a window from the dock or launcher state machine. */
  function activateWindow(id) {
    const model = state.windows.get(id);
    if (!model) {
      return;
    }
    if (model.windowState === "closed") {
      openWindow(id, "open");
      return;
    }
    if (model.windowState === "minimized") {
      openWindow(id, "restore");
      return;
    }
    if (state.activeWindowId === id) {
      hideWindow(id, "minimized");
      return;
    }
    focusWindow(id);
  }

  /** Opens a window directly without dock toggle semantics. */
  function revealWindow(id) {
    const model = state.windows.get(id);
    if (!model) {
      return;
    }
    if (model.windowState === "open") {
      focusWindow(id);
      return;
    }
    openWindow(id, model.windowState === "minimized" ? "restore" : "open");
  }

  /** Sets the focused spotlight window used during demo mode. */
  function setSpotlightWindow(id) {
    state.spotlightWindowId = id || "";
    markDirty();
  }

  /** Returns the content mount node for a given window id. */
  function getContentElement(id) {
    return state.windows.get(id)?.contentNode || null;
  }

  /** Returns the active app name used by the menu bar. */
  function getFocusedAppName() {
    return state.windows.get(state.activeWindowId)?.appName || "OS Simulator";
  }

  /** Returns lightweight window state data for dock indicators and launchers. */
  function getWindowStates() {
    return [...state.windows.values()].map((model) => ({
      id: model.id,
      windowState: model.windowState,
      active: state.activeWindowId === model.id,
      maximized: Boolean(model.maximized),
    }));
  }

  /** Re-renders window positions, focus states, and demo spotlight classes. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    state.windows.forEach((model, key) => {
      clampWindow(model);
      model.node.style.left = `${model.x}px`;
      model.node.style.top = `${model.y}px`;
      model.node.style.width = `${model.width}px`;
      model.node.style.height = `${model.height}px`;
      model.node.style.zIndex = model.maximized ? "1800" : String(100 + state.zOrder.indexOf(model.id));
      model.node.classList.toggle("active", state.activeWindowId === model.id);
      model.node.classList.toggle("inactive", state.activeWindowId !== model.id);
      model.node.classList.toggle("spotlight", Boolean(state.spotlightWindowId) && state.spotlightWindowId === model.id);
      model.node.classList.toggle("dimmed", Boolean(state.spotlightWindowId) && state.spotlightWindowId !== model.id);
      model.node.classList.toggle("maximized", model.maximized);
      model.node.hidden = model.windowState !== "open";
      model.node.style.visibility = model.windowState === "open" ? "visible" : "hidden";
      model.node.style.pointerEvents = model.windowState === "open" ? "auto" : "none";
      const titleText = model.node.querySelector(".window-title-text");
      if (titleText) {
        titleText.style.opacity = model.width < 200 ? "0" : "1";
      }
    });
  }

  window.addEventListener("pointermove", throttle(onPointerMove, CONFIG.ui.pointerMoveThrottleMs));
  window.addEventListener("pointerup", endInteraction);
  window.addEventListener("resize", markDirty);

  return {
    registerWindows,
    activateWindow,
    revealWindow,
    focusWindow,
    getContentElement,
    getFocusedAppName,
    getWindowStates,
    setSpotlightWindow,
    render,
  };
}
