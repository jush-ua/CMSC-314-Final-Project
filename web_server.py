from __future__ import annotations

import json
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from os_simulator import OperatingSystemSimulator, run_demo


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
HOST = "127.0.0.1"
PORT = 8000


class SimulatorService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._simulator = OperatingSystemSimulator()

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_unlocked()

    def reset(self) -> dict:
        with self._lock:
            self._simulator = OperatingSystemSimulator()
            message = "Simulator reset to a clean state."
            return self._response(message)

    def demo(self) -> dict:
        with self._lock:
            messages = run_demo(self._simulator)
            return self._response("Loaded demo workload.", messages)

    def set_scheduler(self, scheduler: str) -> dict:
        with self._lock:
            message = self._simulator.set_scheduler(scheduler)
            return self._response(message)

    def tick(self, steps: int) -> dict:
        with self._lock:
            messages = self._simulator.tick(steps)
            summary = f"Advanced clock by {steps} tick{'s' if steps != 1 else ''}."
            return self._response(summary, messages)

    def create_process(self, name: str, memory: int, cpu_time: int) -> dict:
        with self._lock:
            if not name:
                return self._response("Process name is required.")
            message = self._simulator.create_process(name, memory, cpu_time)
            return self._response(message)

    def kill_process(self, pid: int) -> dict:
        with self._lock:
            message = self._simulator.terminate_process(pid)
            return self._response(message)

    def block_process(self, pid: int, ticks: int, reason: str) -> dict:
        with self._lock:
            message = self._simulator.block_process(pid, ticks, reason)
            return self._response(message)

    def unblock_process(self, pid: int) -> dict:
        with self._lock:
            message = self._simulator.unblock_process(pid)
            return self._response(message)

    def create_file(self, filename: str) -> dict:
        with self._lock:
            if not filename:
                return self._response("File name is required.")
            message = self._simulator.file_system.create(filename)
            return self._response(message)

    def write_file(self, filename: str, content: str, append: bool) -> dict:
        with self._lock:
            if not filename:
                return self._response("File name is required.")
            message = self._simulator.file_system.write(filename, content, append=append)
            return self._response(message)

    def delete_file(self, filename: str) -> dict:
        with self._lock:
            if not filename:
                return self._response("File name is required.")
            message = self._simulator.file_system.delete(filename)
            return self._response(message)

    def _response(self, message: str, messages: list[str] | None = None) -> dict:
        return {
            "message": message,
            "messages": messages or [],
            "state": self._snapshot_unlocked(),
        }

    def _snapshot_unlocked(self) -> dict:
        simulator = self._simulator
        processes = sorted(simulator.processes.values(), key=lambda item: item.pid)
        files = sorted(simulator.file_system.files.values(), key=lambda item: item.name)
        running = [process for process in processes if process.state == "running"]
        ready = [process for process in processes if process.state == "ready"]
        waiting = [process for process in processes if process.state == "waiting"]
        terminated = [process for process in processes if process.state == "terminated"]

        return {
            "clock": simulator.clock,
            "scheduler": simulator.scheduler.upper(),
            "running_pid": simulator.running_pid,
            "ready_queue": simulator.ready_queue[:],
            "time_slice": simulator.time_slice,
            "slice_remaining": simulator.slice_remaining,
            "summary": {
                "total_processes": len(processes),
                "running": len(running),
                "ready": len(ready),
                "waiting": len(waiting),
                "terminated": len(terminated),
                "files": len(files),
            },
            "memory": {
                "total": simulator.memory.total_memory,
                "used": simulator.memory.used_memory(),
                "free": simulator.memory.free_memory(),
                "allocations": [
                    {
                        "pid": block.pid,
                        "start": block.start,
                        "end": block.end,
                        "size": block.size,
                    }
                    for block in simulator.memory.allocations
                ],
            },
            "processes": [
                {
                    "pid": process.pid,
                    "name": process.name,
                    "memory_required": process.memory_required,
                    "cpu_time_remaining": process.cpu_time_remaining,
                    "state": process.state,
                    "io_ticks_remaining": process.io_ticks_remaining,
                    "io_reason": process.io_reason,
                }
                for process in processes
            ],
            "files": [
                {
                    "name": file.name,
                    "content": file.content,
                    "size": file.size,
                    "open_count": file.open_count,
                }
                for file in files
            ],
            "event_log": simulator.event_log[-12:],
        }


SERVICE = SimulatorService()


class SimulatorRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self._send_json(SERVICE.snapshot())
            return
        if path in {"/", ""}:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        payload = self._read_json_body()

        routes = {
            "/api/reset": lambda data: SERVICE.reset(),
            "/api/demo": lambda data: SERVICE.demo(),
            "/api/scheduler": lambda data: SERVICE.set_scheduler(str(data.get("scheduler", "rr"))),
            "/api/tick": lambda data: SERVICE.tick(int(data.get("steps", 1))),
            "/api/process/create": lambda data: SERVICE.create_process(
                str(data.get("name", "")).strip(),
                int(data.get("memory", 0)),
                int(data.get("cpu_time", 0)),
            ),
            "/api/process/kill": lambda data: SERVICE.kill_process(int(data.get("pid", 0))),
            "/api/process/block": lambda data: SERVICE.block_process(
                int(data.get("pid", 0)),
                int(data.get("ticks", 0)),
                str(data.get("reason", "I/O")).strip() or "I/O",
            ),
            "/api/process/unblock": lambda data: SERVICE.unblock_process(int(data.get("pid", 0))),
            "/api/file/create": lambda data: SERVICE.create_file(str(data.get("filename", "")).strip()),
            "/api/file/write": lambda data: SERVICE.write_file(
                str(data.get("filename", "")).strip(),
                str(data.get("content", "")),
                bool(data.get("append", False)),
            ),
            "/api/file/delete": lambda data: SERVICE.delete_file(str(data.get("filename", "")).strip()),
        }

        handler = routes.get(path)
        if handler is None:
            self._send_json({"error": "Unknown API route."}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            response = handler(payload)
        except (TypeError, ValueError):
            self._send_json({"error": "Invalid request payload."}, status=HTTPStatus.BAD_REQUEST)
            return

        self._send_json(response)

    def log_message(self, format: str, *args) -> None:
        return

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), SimulatorRequestHandler)
    print(f"OS Simulator web server running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
