const APP_ICONS = {
  process: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="10" y="13" width="44" height="38" rx="12"></rect>
      <path d="M19 24h26M19 32h18M19 40h22"></path>
    </svg>
  `,
  memory: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="12" y="18" width="40" height="28" rx="8"></rect>
      <path d="M20 27h24M20 36h12M18 18V12M28 18V12M36 18V12M46 18V12M18 46v6M28 46v6M36 46v6M46 46v6"></path>
    </svg>
  `,
  disk: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="18" rx="19" ry="9"></ellipse>
      <path d="M13 18v18c0 5 8.5 9 19 9s19-4 19-9V18"></path>
      <path d="M13 30c0 5 8.5 9 19 9s19-4 19-9"></path>
    </svg>
  `,
  spooler: `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M20 22V12h24v10"></path>
      <rect x="16" y="22" width="32" height="18" rx="6"></rect>
      <path d="M22 40h20v12H22z"></path>
      <path d="M24 28h4"></path>
    </svg>
  `,
  apple: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.2 12.6c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3-1.7-1.3-.1-2.4.8-3 .8-.7 0-1.6-.8-2.7-.7-1.4 0-2.6.8-3.3 2-.9 1.5-.2 3.8.6 5 .4.6.9 1.3 1.7 1.2.7 0 1-.5 1.9-.5s1.2.5 1.9.5c.8 0 1.3-.6 1.7-1.2.5-.7.7-1.4.8-1.4-.1 0-2.3-.9-2.3-3Z"></path>
      <path d="M13.8 6.5c.3-.4.5-.9.5-1.5-.5 0-1.1.3-1.5.7-.4.4-.7 1-.6 1.5.6 0 1.2-.3 1.6-.7Z"></path>
    </svg>
  `,
  wifi: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 9.2a13 13 0 0 1 17 0"></path>
      <path d="M6.8 12.5a8.5 8.5 0 0 1 10.4 0"></path>
      <path d="M10.2 15.8a3.5 3.5 0 0 1 3.6 0"></path>
      <circle cx="12" cy="19" r="1.4"></circle>
    </svg>
  `,
  battery: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="7" width="16" height="10" rx="3"></rect>
      <path d="M21 10v4"></path>
      <path d="M6 10h7"></path>
    </svg>
  `,
  spotlight: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5"></circle>
      <path d="M15 15l5 5"></path>
    </svg>
  `,
  search: `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.5"></circle>
      <path d="M12 12l4.2 4.2"></path>
    </svg>
  `,
  printerBadge: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 9V4h10v5"></path>
      <rect x="5" y="9" width="14" height="7" rx="2"></rect>
      <path d="M8 16h8v4H8z"></path>
    </svg>
  `,
  check: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 6.2 12 13 4.5"></path>
    </svg>
  `,
};

export const CONFIG = {
  menus: ["File", "Edit", "View", "Window", "Help"],
  clock: {
    locale: "en-US",
    options: { hour: "2-digit", minute: "2-digit", hour12: false },
    tickMs: 1000,
  },
  wallpaper: {
    storageKey: "os-simulator-custom-wallpaper",
  },
  scheduler: {
    intervalMs: 700,
    timeSlice: 2,
    defaultCpuTime: 6,
    defaultMemoryUnits: 4096,
    defaultPriority: 3,
    minPriority: 1,
    maxPriority: 9,
    maxTimelineEntries: 48,
    maxEventLogEntries: 24,
    blockTicks: 3,
    filterKeys: ["all", "running", "waiting", "terminated"],
    algorithms: [
      { value: "rr", label: "Round Robin" },
      { value: "priority", label: "Priority" },
      { value: "fcfs", label: "FCFS" },
    ],
  },
  memory: {
    pageSize: 4096,
    frameCount: 16,
    flashMs: 600,
    maxEvents: 48,
    pressureHistorySize: 24,
    palette: ["#b8d9ff", "#d2f2c6", "#ffe0b8", "#f9c4e7", "#d6cbff", "#ffd4c8", "#c8f1e8", "#ffe6a7"],
  },
  disk: {
    trackCount: 64,
    sectorsPerTrack: 8,
    seekIntervalMs: 400,
    queueLimit: 64,
    completedLimit: 24,
    movementLogLimit: 48,
    seekHistoryLimit: 40,
    defaultFileSize: 6,
    defaultProcessId: 1,
  },
  spooler: {
    tickMs: 400,
    durationMs: 3200,
    maxCompletedJobs: 20,
    defaultPages: 4,
  },
  ui: {
    titleBarHeight: 28,
    menuBarHeight: 28,
    dockHeight: 76,
    minWindowWidth: 320,
    minWindowHeight: 240,
    resizeBorder: 6,
    desktopIconWidth: 80,
    dockIconSize: 52,
    dockHoverScale: 1.3077,
    dockNeighborScale: 1.1154,
    tooltipOffset: 14,
    contextMenuWidth: 220,
    windowInset: 18,
    openAnimationMs: 320,
    closeAnimationMs: 220,
    minimizeAnimationMs: 380,
    dockBounceMs: 380,
    spotlightFadeMs: 260,
    pulseDurationMs: 1500,
    demoTransitionMs: 360,
    rowHeight: 32,
    memoryCanvasHeight: 92,
    diskSeekCanvasHeight: 160,
    diskHistoryCanvasHeight: 120,
    // 0 = uncapped, >0 caps rendering to this FPS
    renderCapFps: 0,
    // pointer/tooltip throttles are raised automatically on low-end devices
    pointerMoveThrottleMs: 8,
    tooltipMoveThrottleMs: 50,
  },
  theme: {
    desktopGradient: "radial-gradient(ellipse at 60% 40%, #a8c5e8 0%, #7aa8d4 40%, #4a7fb5 100%)",
    menuBarBackground: "rgba(236,236,236,0.85)",
    windowBackground: "rgba(246,246,246,0.98)",
    titleBarBackground: "rgba(235,235,235,0.98)",
    panelBackground: "#ffffff",
    primaryText: "#1d1d1f",
    secondaryText: "#6e6e73",
    accentBlue: "#007aff",
    accentGreen: "#34c759",
    accentYellow: "#ff9f0a",
    accentRed: "#ff3b30",
    selection: "rgba(0,122,255,0.12)",
    divider: "rgba(0,0,0,0.08)",
    tooltipBackground: "rgba(28,28,30,0.88)",
    dockBackground: "rgba(255,255,255,0.25)",
    dockBorder: "rgba(255,255,255,0.4)",
    inactiveTraffic: "#d5d5d5",
    shadowLarge: "0 22px 70px rgba(0,0,0,0.28), 0 8px 20px rgba(0,0,0,0.16)",
    shadowInactive: "0 8px 24px rgba(0,0,0,0.12)",
    contextBackground: "rgba(246,246,246,0.92)",
  },
  apps: [
    {
      id: "process-manager",
      title: "Process Manager",
      appName: "Activity Monitor",
      accent: "#007aff",
      icon: APP_ICONS.process,
      window: { x: 88, y: 74, width: 900, height: 590 },
    },
    {
      id: "memory-manager",
      title: "Memory Map",
      appName: "Memory Pressure",
      accent: "#34c759",
      icon: APP_ICONS.memory,
      window: { x: 340, y: 108, width: 760, height: 620 },
    },
    {
      id: "disk-manager",
      title: "Disk Manager",
      appName: "Disk Utility",
      accent: "#ff9f0a",
      icon: APP_ICONS.disk,
      window: { x: 170, y: 146, width: 960, height: 650 },
    },
    {
      id: "printer-manager",
      title: "Printer Spooler",
      appName: "Print Center",
      accent: "#ff3b30",
      icon: APP_ICONS.spooler,
      window: { x: 420, y: 188, width: 620, height: 520 },
    },
  ],
  icons: APP_ICONS,
};

/** Returns the application configuration for a given app id. */
export function getAppConfig(appId) {
  return CONFIG.apps.find((app) => app.id === appId) || null;
}
