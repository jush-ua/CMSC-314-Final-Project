from __future__ import annotations

import json
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from os_simulator import (
    DISK_SEEK_INTERVAL_MS,
    OperatingSystemSimulator,
    run_demo,
)


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
HOST = "127.0.0.1"
PORT = 8000
SCHEDULER_INTERVAL_MS = 500


class SimulatorService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._simulator = OperatingSystemSimulator()
        self._scheduler_stop = threading.Event()
        self._disk_stop = threading.Event()
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, name="web-scheduler", daemon=True)
        self._disk_thread = threading.Thread(target=self._disk_loop, name="web-disk", daemon=True)
        self._cpu_cycles: dict[int, int] = {}
        self._total_cycles = 0
        self._scheduler_running = True
        self._disk_running = True
        self._scheduler_thread.start()
        self._disk_thread.start()

    def _extract_running_pid(self, messages: list[str]) -> int | None:
        for message in messages:
            marker = "running PID "
            if marker in message:
                pid_text = message.split(marker, 1)[1].split(" ", 1)[0]
                try:
                    return int(pid_text)
                except ValueError:
                    return None
        return None

    def _scheduler_loop(self) -> None:
        interval_seconds = SCHEDULER_INTERVAL_MS / 1000
        while not self._scheduler_stop.wait(interval_seconds):
            if not self._scheduler_running:
                continue
            with self._lock:
                messages = self._simulator.tick(1)
                running_pid = self._extract_running_pid(messages)
                if running_pid is not None:
                    self._cpu_cycles[running_pid] = self._cpu_cycles.get(running_pid, 0) + 1
                    self._total_cycles += 1

    def _disk_loop(self) -> None:
        interval_seconds = DISK_SEEK_INTERVAL_MS / 1000
        while not self._disk_stop.wait(interval_seconds):
            if not self._disk_running:
                continue
            with self._lock:
                message = self._simulator.disk_manager.process_seek_step()
                if message != "Disk idle.":
                    self._simulator.log(message)

    def shutdown(self) -> None:
        self._scheduler_stop.set()
        self._disk_stop.set()
        self._scheduler_thread.join(timeout=1)
        self._disk_thread.join(timeout=1)

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_unlocked()

    def reset(self) -> dict:
        with self._lock:
            self._simulator = OperatingSystemSimulator()
            self._cpu_cycles = {}
            self._total_cycles = 0
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

    def set_scheduler_running(self, running: bool) -> dict:
        with self._lock:
            self._scheduler_running = running
            message = "Scheduler running." if running else "Scheduler paused."
            return self._response(message)

    def set_disk_running(self, running: bool) -> dict:
        with self._lock:
            self._disk_running = running
            message = "Disk service running." if running else "Disk service paused."
            return self._response(message)

    def tick(self, steps: int) -> dict:
        with self._lock:
            messages = self._simulator.tick(steps)
            running_pid = self._extract_running_pid(messages)
            if running_pid is not None:
                self._cpu_cycles[running_pid] = self._cpu_cycles.get(running_pid, 0) + 1
                self._total_cycles += 1
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

    def access_memory(self, pid: int, virtual_address: int) -> dict:
        with self._lock:
            physical_address = self._simulator.memory.translate_address(pid, virtual_address, self._simulator.clock)
            if physical_address is None:
                message = f"Memory access failed for PID {pid} at address {virtual_address}."
            else:
                message = (
                    f"Translated PID {pid} virtual address {virtual_address} "
                    f"to physical address {physical_address}."
                )
            return self._response(message)

    def create_disk_file(self, filename: str, size_sectors: int) -> dict:
        with self._lock:
            message = self._simulator.disk_manager.create_file(filename, size_sectors)
            return self._response(message)

    def delete_disk_file(self, filename: str) -> dict:
        with self._lock:
            message = self._simulator.disk_manager.delete_file(filename)
            return self._response(message)

    def read_disk_file(self, filename: str, pid: int) -> dict:
        with self._lock:
            message = self._simulator.disk_manager.read_file(filename, pid)
            return self._response(message)

    def write_disk_file(self, filename: str, pid: int) -> dict:
        with self._lock:
            message = self._simulator.disk_manager.write_file(filename, pid)
            return self._response(message)

    def submit_print_job(self, job_id: str, document_name: str, size_pages: int) -> dict:
        with self._lock:
            message = self._simulator.printer_spooler.submit_print_job(job_id, document_name, size_pages)
            return self._response(message)

    def process_print_job(self) -> dict:
        with self._lock:
            message = self._simulator.printer_spooler.process_print_job()
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
            "runtime": {
                "scheduler_interval_ms": SCHEDULER_INTERVAL_MS,
                "disk_interval_ms": DISK_SEEK_INTERVAL_MS,
                "scheduler_running": self._scheduler_running,
                "disk_running": self._disk_running,
            },
            "memory": {
                "total": simulator.memory.total_memory,
                "used": simulator.memory.used_memory(),
                "free": simulator.memory.free_memory(),
                "page_size": simulator.memory.page_size,
                "frame_count": simulator.memory.frame_count,
                "allocations": [
                    {
                        "pid": block.pid,
                        "start": block.start,
                        "end": block.end,
                        "size": block.size,
                    }
                    for block in simulator.memory.allocations
                ],
                "frames": simulator.memory.frame_snapshot(),
                "page_tables": simulator.memory.page_table_snapshot(),
                "events": simulator.memory.events[-12:],
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
                    "cpu_percent": round(
                        (self._cpu_cycles.get(process.pid, 0) / self._total_cycles) * 100, 1
                    )
                    if self._total_cycles
                    else 0.0,
                    "memory_usage": simulator.memory.process_memory_usage(process.pid),
                }
                for process in processes
            ],
            "disk": {
                "track_count": simulator.disk_manager.track_count,
                "sectors_per_track": simulator.disk_manager.sectors_per_track,
                "current_track": simulator.disk_manager.current_track,
                "current_sector": simulator.disk_manager.current_sector,
                "direction": simulator.disk_manager.direction,
                "queue": simulator.disk_manager.queue_snapshot(),
                "completed": simulator.disk_manager.completed_snapshot(),
                "fat": simulator.disk_manager.fat_snapshot(),
                "seek_history": simulator.disk_manager.seek_history[-20:],
                "movement_log": simulator.disk_manager.movement_log[-12:],
            },
            "printer": {
                "queue": [
                    {
                        "job_id": job.job_id,
                        "document_name": job.document_name,
                        "size_pages": job.size_pages,
                        "status": job.status,
                    }
                    for job in simulator.printer_spooler.print_queue
                ],
                "completed": [
                    {
                        "job_id": job.job_id,
                        "document_name": job.document_name,
                        "size_pages": job.size_pages,
                        "status": job.status,
                    }
                    for job in simulator.printer_spooler.completed_jobs[-12:]
                ],
            },
            "files": [
                {
                    "name": file.name,
                    "size": file.size,
                    "open_count": file.open_count,
                }
                for file in files
            ],
            "event_log": (
                simulator.event_log[-6:]
                + simulator.memory.events[-3:]
                + simulator.disk_manager.movement_log[-3:]
            )[-12:],
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
            "/api/scheduler/run": lambda data: SERVICE.set_scheduler_running(bool(data.get("running", True))),
            "/api/disk/run": lambda data: SERVICE.set_disk_running(bool(data.get("running", True))),
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
            "/api/memory/access": lambda data: SERVICE.access_memory(
                int(data.get("pid", 0)),
                int(data.get("virtual_address", 0)),
            ),
            "/api/disk/file/create": lambda data: SERVICE.create_disk_file(
                str(data.get("filename", "")).strip(),
                int(data.get("size_sectors", 0)),
            ),
            "/api/disk/file/delete": lambda data: SERVICE.delete_disk_file(str(data.get("filename", "")).strip()),
            "/api/disk/file/read": lambda data: SERVICE.read_disk_file(
                str(data.get("filename", "")).strip(),
                int(data.get("pid", 0)),
            ),
            "/api/disk/file/write": lambda data: SERVICE.write_disk_file(
                str(data.get("filename", "")).strip(),
                int(data.get("pid", 0)),
            ),
            "/api/printer/submit": lambda data: SERVICE.submit_print_job(
                str(data.get("job_id", "")).strip(),
                str(data.get("document_name", "")).strip(),
                int(data.get("size_pages", 0)),
            ),
            "/api/printer/process": lambda data: SERVICE.process_print_job(),
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
        SERVICE.shutdown()


if __name__ == "__main__":
    main()
