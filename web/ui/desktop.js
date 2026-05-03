import { CONFIG } from "../config.js?v=20260503c";

/** Creates the desktop wallpaper, icon grid, and context menu interactions. */
export function createDesktop({ elements, windowManager, requestRender }) {
  const state = {
    dirty: true,
    selectedIconId: "",
    wallpaperUrl: "",
    wallpaperImage: null,
  };

  function saveWallpaper(url) {
    try {
      if (url) {
        window.localStorage.setItem(CONFIG.wallpaper.storageKey, url);
      } else {
        window.localStorage.removeItem(CONFIG.wallpaper.storageKey);
      }
      return true;
    } catch {
      return false;
    }
  }

  function finishWallpaperDraw(context, rect) {
    const glow = context.createRadialGradient(rect.width * 0.62, rect.height * 0.35, 40, rect.width * 0.62, rect.height * 0.35, rect.width * 0.7);
    glow.addColorStop(0, "rgba(255,255,255,0.42)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, rect.width, rect.height);
    context.fillStyle = "rgba(255,255,255,0.08)";
    context.beginPath();
    context.arc(rect.width * 0.22, rect.height * 0.18, 130, 0, Math.PI * 2);
    context.fill();
  }

  function drawDefaultWallpaper(context, rect) {
    const gradient = context.createLinearGradient(0, 0, rect.width, rect.height);
    gradient.addColorStop(0, "#a8c5e8");
    gradient.addColorStop(0.4, "#7aa8d4");
    gradient.addColorStop(1, "#4a7fb5");
    context.fillStyle = gradient;
    context.fillRect(0, 0, rect.width, rect.height);
    finishWallpaperDraw(context, rect);
  }

  function drawWallpaper() {
    const canvas = elements.canvas;
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
    const height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.clearRect(0, 0, rect.width, rect.height);
    if (state.wallpaperUrl) {
      elements.surface.style.backgroundImage = `url("${state.wallpaperUrl}")`;
      elements.surface.style.backgroundPosition = "center";
      elements.surface.style.backgroundSize = "cover";
      elements.surface.style.backgroundRepeat = "no-repeat";
      context.fillStyle = "rgba(255,255,255,0.1)";
      context.fillRect(0, 0, rect.width, rect.height);
      finishWallpaperDraw(context, rect);
      return;
    }
    elements.surface.style.backgroundImage = "";
    drawDefaultWallpaper(context, rect);
  }

  function closeContextMenu() {
    elements.contextMenu.classList.add("hidden");
  }

  function selectIcon(iconId) {
    state.selectedIconId = iconId;
    state.dirty = true;
    requestRender();
  }

  function renderIcons() {
    const fragment = document.createDocumentFragment();
    CONFIG.apps.filter((app) => app.window).forEach((app) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "desktop-icon";
      button.dataset.iconId = app.id;
      button.innerHTML = `<span class="desktop-icon-art" style="--app-accent:${app.accent}">${app.icon}</span><span class="desktop-icon-label">${app.title}</span>`;
      button.addEventListener("click", () => {
        selectIcon(app.id);
        windowManager.revealWindow(app.id);
      });
      fragment.appendChild(button);
    });
    elements.icons.replaceChildren(fragment);
  }

  function renderContextMenu() {
    const fragment = document.createDocumentFragment();
    const chooseWallpaper = document.createElement("button");
    chooseWallpaper.type = "button";
    chooseWallpaper.className = "context-menu-item";
    chooseWallpaper.textContent = "Choose Wallpaper...";
    chooseWallpaper.addEventListener("click", () => {
      closeContextMenu();
      pickWallpaper();
    });
    fragment.appendChild(chooseWallpaper);
    const resetWallpaperButton = document.createElement("button");
    resetWallpaperButton.type = "button";
    resetWallpaperButton.className = "context-menu-item";
    resetWallpaperButton.textContent = "Reset Wallpaper";
    resetWallpaperButton.addEventListener("click", () => {
      closeContextMenu();
      resetWallpaper();
    });
    fragment.appendChild(resetWallpaperButton);
    const firstDivider = document.createElement("div");
    firstDivider.className = "context-menu-divider";
    fragment.appendChild(firstDivider);
    CONFIG.apps.filter((app) => app.window).forEach((app) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "context-menu-item";
      item.textContent = `Open ${app.title}`;
      item.addEventListener("click", () => {
        closeContextMenu();
        windowManager.revealWindow(app.id);
      });
      fragment.appendChild(item);
    });
    const divider = document.createElement("div");
    divider.className = "context-menu-divider";
    fragment.appendChild(divider);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "context-menu-item";
    refresh.textContent = "Refresh Desktop";
    refresh.addEventListener("click", () => {
      closeContextMenu();
      drawWallpaper();
    });
    fragment.appendChild(refresh);
    elements.contextMenu.replaceChildren(fragment);
  }

  function bindDesktopEvents() {
    elements.surface.addEventListener("click", (event) => {
      if (!event.target.closest(".desktop-icon")) {
        selectIcon("");
      }
      closeContextMenu();
    });
    elements.surface.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".desktop-window")) {
        return;
      }
      event.preventDefault();
      elements.contextMenu.style.left = `${event.clientX}px`;
      elements.contextMenu.style.top = `${event.clientY}px`;
      elements.contextMenu.classList.remove("hidden");
    });
    window.addEventListener("resize", () => {
      drawWallpaper();
      state.dirty = true;
      requestRender();
    });
    elements.fileInput.addEventListener("change", async () => {
      const file = elements.fileInput.files?.[0];
      if (!file) {
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      await applyWallpaper(objectUrl);
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") {
          saveWallpaper(reader.result);
        }
      }, { once: true });
      reader.readAsDataURL(file);
      elements.fileInput.value = "";
    });
  }

  async function loadWallpaperImage(url) {
    if (!url) {
      state.wallpaperUrl = "";
      state.wallpaperImage = null;
      saveWallpaper("");
      drawWallpaper();
      return;
    }
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
    image.src = url;
    await loaded;
    state.wallpaperUrl = url;
    state.wallpaperImage = image;
    drawWallpaper();
  }

  /** Opens the native file picker for selecting a custom wallpaper image. */
  function pickWallpaper() {
    elements.fileInput.click();
  }

  /** Applies a custom wallpaper data URL and persists it locally. */
  async function applyWallpaper(url) {
    if (!url) {
      return;
    }
    await loadWallpaperImage(url);
    state.dirty = true;
    requestRender();
  }

  /** Resets the wallpaper back to the built-in macOS-style default. */
  function resetWallpaper() {
    void loadWallpaperImage("");
    state.dirty = true;
    requestRender();
  }

  /** Initializes desktop icons, context menus, and the wallpaper canvas. */
  function init() {
    renderIcons();
    renderContextMenu();
    bindDesktopEvents();
    const savedWallpaper = window.localStorage.getItem(CONFIG.wallpaper.storageKey) || "";
    if (savedWallpaper) {
      void loadWallpaperImage(savedWallpaper).catch(() => {
        resetWallpaper();
      });
    } else {
      drawWallpaper();
    }
  }

  /** Re-renders desktop icon selection state. */
  function render() {
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    elements.icons.querySelectorAll(".desktop-icon").forEach((icon) => {
      icon.classList.toggle("selected", icon.dataset.iconId === state.selectedIconId);
    });
  }

  return {
    init,
    render,
    drawWallpaper,
    pickWallpaper,
    resetWallpaper,
  };
}
