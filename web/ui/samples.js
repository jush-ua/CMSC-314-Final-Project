import { CONFIG } from "../config.js?v=20260503c";

/** Creates a set of manual sample functions to demonstrate features on demand. */
export function createSamples({ scheduler, memory, disk, spooler, windowManager, requestRender }) {
  async function runSchedulerSample() {
    windowManager.revealWindow("process-manager");
    // create a handful of sample processes
    scheduler.createProcess({ name: "Sample-A", memoryRequired: 4096, cpuTime: 6, priority: 3 });
    scheduler.createProcess({ name: "Sample-B", memoryRequired: 8192, cpuTime: 8, priority: 4 });
    scheduler.createProcess({ name: "Sample-C", memoryRequired: 16384, cpuTime: 5, priority: 2 });
    // step the scheduler a few times to show activity
    for (let i = 0; i < 6; i += 1) {
      scheduler.step(1);
      await new Promise((r) => setTimeout(r, 120));
    }
    requestRender();
  }

  async function runMemorySample() {
    windowManager.revealWindow("memory-manager");
    const pid = scheduler.createProcess({ name: "Memory-Sample", memoryRequired: CONFIG.memory.pageSize * 8, cpuTime: 6, priority: 5 }).pid;
    // touch several addresses to populate page tables
    memory.translateAddress(pid, 0, scheduler.getSnapshot().clock);
    memory.translateAddress(pid, CONFIG.memory.pageSize * 1, scheduler.getSnapshot().clock);
    memory.translateAddress(pid, CONFIG.memory.pageSize * 3, scheduler.getSnapshot().clock);
    requestRender();
  }

  async function runDiskSample() {
    windowManager.revealWindow("disk-manager");
    disk.createFile("sample.bin", 6);
    disk.readFile("sample.bin", CONFIG.disk.defaultProcessId);
    disk.writeFile("sample.bin", CONFIG.disk.defaultProcessId + 1);
    requestRender();
  }

  async function runSpoolerSample() {
    windowManager.revealWindow("printer-manager");
    spooler.submitJob("Sample Document A", 3);
    spooler.submitJob("Sample Document B", 4);
    requestRender();
  }

  return {
    runSchedulerSample,
    runMemorySample,
    runDiskSample,
    runSpoolerSample,
  };
}
