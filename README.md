# Operating System Simulator

This project is now a browser-only operating system simulator with a macOS-style desktop shell. It runs as a single webpage and includes:

- process scheduling with Round Robin, Priority, and FCFS
- paged memory management with fixed frames, LRU replacement, and per-process page tables
- disk management with FAT allocation, LOOK disk head scheduling, and seek history
- printer spooler processing with FIFO ordering and live job progress
- an 8-step narrated presentation demo with HUD, spotlight, and pulse annotations

## Run The Simulator

```powershell
python web_server.py
```

Then open `http://127.0.0.1:8000` in your browser.

## Structure

- `web/config.js` centralizes configurable constants
- `web/core/` contains the simulator state machines
- `web/ui/` contains the desktop shell, windows, panels, canvases, and demo controller
- `web/main.js` bootstraps the application
