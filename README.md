# Operating System Simulator Website

This project now includes a browser-based dashboard for the Python operating system simulator. The site provides a cleaner UI for:

- process management
- CPU scheduling with FCFS and round-robin
- memory allocation tracking
- file creation, writing, deletion, and inspection

## Run The Website

```powershell
python web_server.py
```

Then open `http://127.0.0.1:8000` in your browser.

## Optional CLI Version

The original terminal simulator is still available:

```powershell
python os_simulator.py
```

## Website Features

- top-level system summary cards
- one-click tick controls and scheduler switching
- process creation plus block, unblock, and terminate actions
- memory usage bar with allocation details
- virtual file workspace with preview panel
- recent activity feed for scheduler and file system events

## Notes

- The simulator uses `256` memory units.
- Round-robin uses a `2` tick time slice.
- `Load Demo` seeds the system with sample processes and a file.
- `Reset` clears the simulator back to an empty state.
