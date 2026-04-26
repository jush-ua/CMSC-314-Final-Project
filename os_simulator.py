from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil
from typing import Dict, List, Optional


PROCESS_STATES = ("ready", "running", "waiting", "terminated")
PAGE_SIZE_UNITS = 4096
PHYSICAL_FRAME_COUNT = 16
DISK_TRACK_COUNT = 64
DISK_SECTORS_PER_TRACK = 8
DISK_SEEK_INTERVAL_MS = 300


@dataclass
class Process:
    pid: int
    name: str
    memory_required: int
    cpu_time_remaining: int
    state: str = "ready"
    io_ticks_remaining: int = 0
    io_reason: str = ""

    def summary(self) -> str:
        return (
            f"PID={self.pid:<3} "
            f"name={self.name:<12} "
            f"state={self.state:<10} "
            f"memory={self.memory_required:<4} "
            f"cpu_left={self.cpu_time_remaining:<4} "
            f"io_wait={self.io_ticks_remaining}"
        )


@dataclass
class MemoryBlock:
    pid: int
    start: int
    size: int

    @property
    def end(self) -> int:
        return self.start + self.size - 1


@dataclass
class VirtualFile:
    name: str
    content: str = ""
    open_count: int = 0

    @property
    def size(self) -> int:
        return len(self.content)


@dataclass
class PhysicalFrame:
    frame_number: int
    pid: Optional[int] = None
    virtual_page: Optional[int] = None
    last_access_tick: int = -1

    @property
    def status(self) -> str:
        return "FREE" if self.pid is None else "OCCUPIED"


class MemoryManager:
    def __init__(
        self,
        total_memory: int = PAGE_SIZE_UNITS * PHYSICAL_FRAME_COUNT,
        page_size: int = PAGE_SIZE_UNITS,
        frame_count: int = PHYSICAL_FRAME_COUNT,
    ) -> None:
        self.page_size = page_size
        self.frame_count = frame_count
        self.total_memory = total_memory
        self.frames: List[PhysicalFrame] = [PhysicalFrame(frame_number=index) for index in range(frame_count)]
        self.page_tables: Dict[int, Dict[int, int]] = {}
        self.process_page_counts: Dict[int, int] = {}
        self.process_sizes: Dict[int, int] = {}
        self.next_access_page: Dict[int, int] = {}
        self.events: List[str] = []

    @property
    def allocations(self) -> List[MemoryBlock]:
        return [
            MemoryBlock(
                pid=frame.pid,
                start=frame.frame_number * self.page_size,
                size=self.page_size,
            )
            for frame in self.frames
            if frame.pid is not None
        ]

    def _append_event(self, message: str) -> None:
        self.events.append(message)
        if len(self.events) > 40:
            self.events.pop(0)

    def pages_required(self, size: int) -> int:
        return max(1, ceil(size / self.page_size))

    def allocate(self, pid: int, size: int, clock: int = 0) -> Optional[MemoryBlock]:
        if size <= 0:
            return None

        page_count = self.pages_required(size)
        if page_count > self.frame_count:
            self._append_event(
                f"Allocation failed: PID {pid} needs {page_count} pages but only {self.frame_count} frames exist."
            )
            return None

        self.page_tables[pid] = {}
        self.process_page_counts[pid] = page_count
        self.process_sizes[pid] = size
        self.next_access_page[pid] = 0

        first_frame: Optional[PhysicalFrame] = None
        for virtual_page in range(page_count):
            frame = self._assign_frame(pid, virtual_page, clock, protected_pid=pid)
            if frame is None:
                self.free(pid)
                self._append_event(f"Allocation failed: PID {pid} could not secure enough frames.")
                return None
            if first_frame is None:
                first_frame = frame

        self._append_event(f"Allocated {page_count} pages to PID {pid}.")
        if first_frame is None:
            return None
        return MemoryBlock(pid=pid, start=first_frame.frame_number * self.page_size, size=size)

    def _assign_frame(
        self,
        pid: int,
        virtual_page: int,
        clock: int,
        protected_pid: Optional[int] = None,
    ) -> Optional[PhysicalFrame]:
        free_frame = next((frame for frame in self.frames if frame.pid is None), None)
        if free_frame is None:
            free_frame = self._evict_lru_frame(clock, protected_pid=protected_pid)
        if free_frame is None:
            return None

        free_frame.pid = pid
        free_frame.virtual_page = virtual_page
        free_frame.last_access_tick = clock
        self.page_tables.setdefault(pid, {})[virtual_page] = free_frame.frame_number
        return free_frame

    def _evict_lru_frame(self, clock: int, protected_pid: Optional[int] = None) -> Optional[PhysicalFrame]:
        candidates = [frame for frame in self.frames if frame.pid is not None and frame.pid != protected_pid]
        if not candidates:
            candidates = [frame for frame in self.frames if frame.pid is not None]
        if not candidates:
            return None

        victim = min(candidates, key=lambda frame: frame.last_access_tick)
        victim_pid = victim.pid
        victim_page = victim.virtual_page
        if victim_pid is not None and victim_page is not None:
            self.page_tables.get(victim_pid, {}).pop(victim_page, None)
            self._append_event(
                f"Page evicted: PID {victim_pid} virtual page {victim_page} -> frame {victim.frame_number} freed"
            )
        victim.pid = None
        victim.virtual_page = None
        victim.last_access_tick = clock
        return victim

    def free(self, pid: int) -> None:
        for frame in self.frames:
            if frame.pid == pid:
                frame.pid = None
                frame.virtual_page = None
                frame.last_access_tick = -1
        self.page_tables.pop(pid, None)
        self.process_page_counts.pop(pid, None)
        self.process_sizes.pop(pid, None)
        self.next_access_page.pop(pid, None)

    def translate_address(self, pid: int, virtual_address: int, clock: int) -> Optional[int]:
        if pid not in self.process_page_counts:
            return None

        virtual_page = virtual_address // self.page_size
        offset = virtual_address % self.page_size
        if virtual_page >= self.process_page_counts[pid]:
            self._append_event(f"Invalid virtual address: PID {pid} address {virtual_address}")
            return None

        page_table = self.page_tables.setdefault(pid, {})
        if virtual_page not in page_table:
            self._append_event(f"Page fault: PID {pid} accessing virtual page {virtual_page}")
            frame = self._assign_frame(pid, virtual_page, clock)
            if frame is None:
                return None

        frame_number = page_table[virtual_page]
        frame = self.frames[frame_number]
        frame.last_access_tick = clock
        return frame.frame_number * self.page_size + offset

    def access_process(self, pid: int, clock: int) -> Optional[int]:
        if pid not in self.process_page_counts:
            return None
        next_page = self.next_access_page.get(pid, 0) % self.process_page_counts[pid]
        self.next_access_page[pid] = next_page + 1
        return self.translate_address(pid, next_page * self.page_size, clock)

    def used_memory(self) -> int:
        return sum(self.page_size for frame in self.frames if frame.pid is not None)

    def free_memory(self) -> int:
        return self.total_memory - self.used_memory()

    def process_memory_usage(self, pid: int) -> int:
        return self.process_sizes.get(pid, 0)

    def frame_snapshot(self) -> List[Dict[str, object]]:
        return [
            {
                "frame_number": frame.frame_number,
                "status": frame.status,
                "pid": frame.pid,
                "virtual_page": frame.virtual_page,
            }
            for frame in self.frames
        ]

    def page_table_snapshot(self) -> Dict[str, List[Dict[str, int]]]:
        return {
            str(pid): [
                {"virtual_page": virtual_page, "frame_number": frame_number}
                for virtual_page, frame_number in sorted(mappings.items())
            ]
            for pid, mappings in sorted(self.page_tables.items())
        }

    def status_lines(self) -> List[str]:
        lines = [
            f"Total memory: {self.total_memory}",
            f"Used memory:  {self.used_memory()}",
            f"Free memory:  {self.free_memory()}",
        ]
        if not self.allocations:
            lines.append("No active allocations.")
            return lines

        lines.append("Frames:")
        for frame in self.frames:
            if frame.pid is None:
                lines.append(f"  Frame {frame.frame_number:<2} -> FREE")
            else:
                lines.append(
                    f"  Frame {frame.frame_number:<2} -> PID {frame.pid:<3} page {frame.virtual_page}"
                )
        return lines


@dataclass
class DiskRequest:
    request_id: str
    track: int
    sector: int
    operation: str
    process_id: int
    status: str = "PENDING"


class DiskManager:
    def __init__(
        self,
        track_count: int = DISK_TRACK_COUNT,
        sectors_per_track: int = DISK_SECTORS_PER_TRACK,
    ) -> None:
        self.track_count = track_count
        self.sectors_per_track = sectors_per_track
        self.total_sectors = track_count * sectors_per_track
        self.current_track = 0
        self.current_sector = 0
        self.direction = 1
        self.pending_requests: List[DiskRequest] = []
        self.completed_requests: List[DiskRequest] = []
        self.seek_history: List[int] = [0]
        self.movement_log: List[str] = []
        self.files: Dict[str, List[tuple[int, int]]] = {}
        self.sectors: List[Optional[str]] = [None] * self.total_sectors
        self.next_request_id = 1

    def _append_log(self, message: str) -> None:
        self.movement_log.append(message)
        if len(self.movement_log) > 40:
            self.movement_log.pop(0)

    def _sector_index(self, track: int, sector: int) -> int:
        return track * self.sectors_per_track + sector

    def _track_sector(self, index: int) -> tuple[int, int]:
        return index // self.sectors_per_track, index % self.sectors_per_track

    def _request_id(self) -> str:
        request_id = f"REQ-{self.next_request_id:03d}"
        self.next_request_id += 1
        return request_id

    def create_file(self, name: str, size_sectors: int) -> str:
        if not name:
            return "File name is required."
        if name in self.files:
            return f"File '{name}' already exists."
        if size_sectors <= 0:
            return "File size must be positive."

        free_indices = [index for index, owner in enumerate(self.sectors) if owner is None]
        if len(free_indices) < size_sectors:
            return f"Not enough free disk sectors to create '{name}'."

        allocation: List[int] = []
        run_start = -1
        run_length = 0
        for index, owner in enumerate(self.sectors):
            if owner is None:
                if run_start == -1:
                    run_start = index
                    run_length = 1
                else:
                    run_length += 1
                if run_length >= size_sectors:
                    allocation = list(range(run_start, run_start + size_sectors))
                    break
            else:
                run_start = -1
                run_length = 0

        if not allocation:
            allocation = free_indices[:size_sectors]

        sectors = [self._track_sector(index) for index in allocation]
        for index in allocation:
            self.sectors[index] = name
        self.files[name] = sectors
        message = f"Created file '{name}' using {size_sectors} sector(s)."
        self._append_log(message)
        return message

    def delete_file(self, name: str) -> str:
        if name not in self.files:
            return f"File '{name}' does not exist."

        for track, sector in self.files[name]:
            self.sectors[self._sector_index(track, sector)] = None
        del self.files[name]
        message = f"Deleted file '{name}'."
        self._append_log(message)
        return message

    def submit_disk_request(self, track: int, sector: int, operation: str, process_id: int) -> DiskRequest:
        request = DiskRequest(
            request_id=self._request_id(),
            track=track,
            sector=sector,
            operation=operation.upper(),
            process_id=process_id,
        )
        self.pending_requests.append(request)
        self._append_log(
            f"Queued {request.operation} request {request.request_id} for PID {process_id} at T{track}:S{sector}"
        )
        return request

    def read_file(self, name: str, process_id: int) -> str:
        if name not in self.files:
            return f"File '{name}' does not exist."
        for track, sector in self.files[name]:
            self.submit_disk_request(track, sector, "READ", process_id)
        return f"Queued READ requests for '{name}' from PID {process_id}."

    def write_file(self, name: str, process_id: int) -> str:
        if name not in self.files:
            return f"File '{name}' does not exist."
        for track, sector in self.files[name]:
            self.submit_disk_request(track, sector, "WRITE", process_id)
        return f"Queued WRITE requests for '{name}' from PID {process_id}."

    def _peek_service_order(self) -> List[DiskRequest]:
        if not self.pending_requests:
            return []

        requests = list(self.pending_requests)
        if self.direction >= 0:
            forward = sorted(
                [request for request in requests if request.track >= self.current_track],
                key=lambda item: (item.track, item.sector),
            )
            backward = sorted(
                [request for request in requests if request.track < self.current_track],
                key=lambda item: (item.track, item.sector),
                reverse=True,
            )
            return forward + backward if forward else backward

        backward = sorted(
            [request for request in requests if request.track <= self.current_track],
            key=lambda item: (item.track, item.sector),
            reverse=True,
        )
        forward = sorted(
            [request for request in requests if request.track > self.current_track],
            key=lambda item: (item.track, item.sector),
        )
        return backward + forward if backward else forward

    def process_seek_step(self) -> str:
        if not self.pending_requests:
            return "Disk idle."

        target = self._peek_service_order()[0]
        if target.track > self.current_track:
            self.direction = 1
            self.current_track += 1
            self.current_sector = target.sector if self.current_track == target.track else self.current_sector
            self.seek_history.append(self.current_track)
            self.seek_history = self.seek_history[-20:]
            message = f"Head moved to track {self.current_track}"
            self._append_log(message)
            return message

        if target.track < self.current_track:
            self.direction = -1
            self.current_track -= 1
            self.current_sector = target.sector if self.current_track == target.track else self.current_sector
            self.seek_history.append(self.current_track)
            self.seek_history = self.seek_history[-20:]
            message = f"Head moved to track {self.current_track}"
            self._append_log(message)
            return message

        self.current_sector = target.sector
        target.status = "COMPLETED"
        self.pending_requests = [request for request in self.pending_requests if request.request_id != target.request_id]
        self.completed_requests.append(target)
        self.seek_history.append(self.current_track)
        self.seek_history = self.seek_history[-20:]
        message = (
            f"Serviced {target.operation} request {target.request_id} for PID {target.process_id} "
            f"at T{target.track}:S{target.sector}"
        )
        self._append_log(message)
        return message

    def queue_snapshot(self) -> List[Dict[str, object]]:
        return [
            {
                "request_id": request.request_id,
                "track": request.track,
                "sector": request.sector,
                "operation": request.operation,
                "process_id": request.process_id,
                "status": request.status,
            }
            for request in self._peek_service_order()
        ]

    def completed_snapshot(self) -> List[Dict[str, object]]:
        return [
            {
                "request_id": request.request_id,
                "track": request.track,
                "sector": request.sector,
                "operation": request.operation,
                "process_id": request.process_id,
                "status": request.status,
            }
            for request in self.completed_requests[-20:]
        ]

    def fat_snapshot(self) -> Dict[str, List[Dict[str, int]]]:
        return {
            name: [{"track": track, "sector": sector} for track, sector in sectors]
            for name, sectors in sorted(self.files.items())
        }

    def sector_snapshot(self) -> List[Dict[str, object]]:
        snapshot: List[Dict[str, object]] = []
        for index, owner in enumerate(self.sectors):
            track, sector = self._track_sector(index)
            snapshot.append(
                {
                    "track": track,
                    "sector": sector,
                    "filename": owner,
                    "status": "FREE" if owner is None else "OCCUPIED",
                }
            )
        return snapshot

    def show_disk_queue(self) -> List[str]:
        if not self.pending_requests:
            return ["No pending disk requests."]
        return [
            f"{request.request_id} PID {request.process_id} {request.operation} T{request.track}:S{request.sector}"
            for request in self._peek_service_order()
        ]


@dataclass
class PrintJob:
    job_id: str
    document_name: str
    size_pages: int
    status: str = "QUEUED"


class PrinterSpooler:
    def __init__(self) -> None:
        self.print_queue: List[PrintJob] = []
        self.completed_jobs: List[PrintJob] = []

    def submit_print_job(self, job_id: str, document_name: str, size_pages: int) -> str:
        job = PrintJob(job_id=job_id, document_name=document_name, size_pages=size_pages)
        self.print_queue.append(job)
        return f"Queued print job {job_id}: {document_name} ({size_pages} pages)."

    def process_print_job(self) -> str:
        if not self.print_queue:
            return "No pending print jobs."

        job = self.print_queue.pop(0)
        job.status = "COMPLETED"
        self.completed_jobs.append(job)
        return f"Printing: {job.document_name}, {job.size_pages} pages"

    def show_print_queue(self) -> List[str]:
        if not self.print_queue:
            return ["No pending print jobs."]
        return [
            f"job_id={job.job_id} document_name={job.document_name} size_pages={job.size_pages}"
            for job in self.print_queue
        ]



@dataclass
class FileSystem:
    files: Dict[str, VirtualFile] = field(default_factory=dict)

    def create(self, filename: str) -> str:
        if filename in self.files:
            return f"File '{filename}' already exists."
        self.files[filename] = VirtualFile(name=filename)
        return f"Created file '{filename}'."

    def write(self, filename: str, content: str, append: bool = False) -> str:
        file = self.files.get(filename)
        if not file:
            return f"File '{filename}' does not exist."
        file.content = file.content + content if append else content
        return f"Wrote {len(content)} characters to '{filename}'."

    def read(self, filename: str) -> str:
        file = self.files.get(filename)
        if not file:
            return f"File '{filename}' does not exist."
        return file.content if file.content else "(empty file)"

    def delete(self, filename: str) -> str:
        if filename not in self.files:
            return f"File '{filename}' does not exist."
        del self.files[filename]
        return f"Deleted file '{filename}'."

    def list_files(self) -> List[str]:
        if not self.files:
            return ["No files in virtual file system."]
        lines = ["Files:"]
        for file in sorted(self.files.values(), key=lambda item: item.name):
            lines.append(
                f"  {file.name:<16} size={file.size:<4} open_handles={file.open_count}"
            )
        return lines


class OperatingSystemSimulator:
    def __init__(
        self,
        total_memory: int = PAGE_SIZE_UNITS * PHYSICAL_FRAME_COUNT,
        time_slice: int = 2,
    ) -> None:
        self.memory = MemoryManager(total_memory=total_memory)
        self.file_system = FileSystem()
        self.disk_manager = DiskManager()
        self.printer_spooler = PrinterSpooler()
        self.processes: Dict[int, Process] = {}
        self.ready_queue: List[int] = []
        self.running_pid: Optional[int] = None
        self.next_pid = 1
        self.clock = 0
        self.scheduler = "rr"
        self.time_slice = time_slice
        self.slice_remaining = time_slice
        self.event_log: List[str] = []

    def log(self, message: str) -> None:
        entry = f"[time={self.clock}] {message}"
        self.event_log.append(entry)
        if len(self.event_log) > 20:
            self.event_log.pop(0)

    def create_process(self, name: str, memory_required: int, cpu_time: int) -> str:
        if memory_required <= 0 or cpu_time <= 0:
            return "Memory and CPU time must both be positive integers."

        pid = self.next_pid
        block = self.memory.allocate(pid=pid, size=memory_required, clock=self.clock)
        if block is None:
            return f"Failed to create process '{name}': not enough memory for {memory_required} units."

        process = Process(
            pid=pid,
            name=name,
            memory_required=memory_required,
            cpu_time_remaining=cpu_time,
        )
        self.processes[pid] = process
        self.ready_queue.append(pid)
        self.next_pid += 1
        self.log(
            f"Created process {pid} ('{name}') using {memory_required} memory units and {cpu_time} CPU ticks."
        )
        return f"Created process PID {pid}."

    def terminate_process(self, pid: int) -> str:
        process = self.processes.get(pid)
        if not process:
            return f"Process {pid} does not exist."
        if process.state == "terminated":
            return f"Process {pid} is already terminated."

        if self.running_pid == pid:
            self.running_pid = None
            self.slice_remaining = self.time_slice

        process.state = "terminated"
        process.io_ticks_remaining = 0
        self.memory.free(pid)
        self.ready_queue = [queued_pid for queued_pid in self.ready_queue if queued_pid != pid]
        self.log(f"Terminated process {pid} ('{process.name}').")
        return f"Terminated process {pid}."

    def block_process(self, pid: int, ticks: int, reason: str = "I/O") -> str:
        process = self.processes.get(pid)
        if not process or process.state == "terminated":
            return f"Process {pid} does not exist."
        if ticks <= 0:
            return "I/O wait time must be positive."

        if self.running_pid == pid:
            self.running_pid = None
            self.slice_remaining = self.time_slice

        self.ready_queue = [queued_pid for queued_pid in self.ready_queue if queued_pid != pid]
        process.state = "waiting"
        process.io_ticks_remaining = ticks
        process.io_reason = reason
        self.log(f"Process {pid} blocked for {ticks} ticks due to {reason}.")
        return f"Process {pid} is waiting on {reason} for {ticks} ticks."

    def unblock_process(self, pid: int) -> str:
        process = self.processes.get(pid)
        if not process or process.state == "terminated":
            return f"Process {pid} does not exist."
        if process.state != "waiting":
            return f"Process {pid} is not waiting."

        process.state = "ready"
        process.io_ticks_remaining = 0
        process.io_reason = ""
        if pid not in self.ready_queue:
            self.ready_queue.append(pid)
        self.log(f"Process {pid} manually unblocked.")
        return f"Process {pid} moved to ready state."

    def set_scheduler(self, scheduler_name: str) -> str:
        scheduler_name = scheduler_name.lower()
        if scheduler_name not in {"fcfs", "rr"}:
            return "Scheduler must be 'fcfs' or 'rr'."
        self.scheduler = scheduler_name
        self.slice_remaining = self.time_slice
        self.log(f"Scheduler set to {scheduler_name.upper()}.")
        return f"Scheduler changed to {scheduler_name.upper()}."

    def schedule_next(self) -> None:
        if self.running_pid is not None:
            return

        while self.ready_queue:
            pid = self.ready_queue.pop(0)
            process = self.processes.get(pid)
            if not process or process.state != "ready":
                continue
            process.state = "running"
            self.running_pid = pid
            self.slice_remaining = self.time_slice
            self.log(f"CPU scheduled process {pid} ('{process.name}').")
            return

    def tick(self, steps: int = 1) -> List[str]:
        if steps <= 0:
            return ["Tick count must be positive."]

        messages: List[str] = []
        for _ in range(steps):
            self.clock += 1
            self._update_waiting_processes(messages)
            self.schedule_next()
            self._run_current_process(messages)
        return messages

    def _update_waiting_processes(self, messages: List[str]) -> None:
        for process in self.processes.values():
            if process.state != "waiting":
                continue
            process.io_ticks_remaining -= 1
            if process.io_ticks_remaining <= 0:
                process.state = "ready"
                process.io_reason = ""
                process.io_ticks_remaining = 0
                if process.pid not in self.ready_queue:
                    self.ready_queue.append(process.pid)
                note = f"Process {process.pid} finished I/O and is ready."
                messages.append(note)
                self.log(note)

    def _run_current_process(self, messages: List[str]) -> None:
        if self.running_pid is None:
            messages.append(f"Tick {self.clock}: CPU idle.")
            return

        process = self.processes[self.running_pid]
        self.memory.access_process(process.pid, self.clock)
        process.cpu_time_remaining -= 1
        self.slice_remaining -= 1
        messages.append(
            f"Tick {self.clock}: running PID {process.pid} ('{process.name}'), cpu_left={process.cpu_time_remaining}."
        )

        if process.cpu_time_remaining <= 0:
            finished_pid = process.pid
            finished_name = process.name
            self.terminate_process(finished_pid)
            messages.append(f"Process {finished_pid} ('{finished_name}') completed.")
            return

        if self.scheduler == "rr" and self.slice_remaining <= 0:
            process.state = "ready"
            self.ready_queue.append(process.pid)
            self.running_pid = None
            self.slice_remaining = self.time_slice
            self.log(f"Time slice expired for process {process.pid}; returned to ready queue.")
            messages.append(f"Time slice expired for process {process.pid}.")
            self.schedule_next()

    def process_lines(self) -> List[str]:
        if not self.processes:
            return ["No processes created."]
        lines = ["Processes:"]
        for process in sorted(self.processes.values(), key=lambda item: item.pid):
            lines.append(f"  {process.summary()}")
        return lines

    def system_status(self) -> List[str]:
        running = self.running_pid if self.running_pid is not None else "idle"
        lines = [
            f"Clock: {self.clock}",
            f"Scheduler: {self.scheduler.upper()}",
            f"Running PID: {running}",
            f"Ready queue: {self.ready_queue if self.ready_queue else 'empty'}",
            "",
        ]
        lines.extend(self.memory.status_lines())
        lines.append("")
        lines.extend(self.process_lines())
        lines.append("")
        lines.extend(self.file_system.list_files())
        lines.append("")
        lines.append("Recent events:")
        if self.event_log:
            lines.extend(f"  {entry}" for entry in self.event_log[-8:])
        else:
            lines.append("  No events yet.")
        return lines


HELP_TEXT = """
Available commands:
  help
  status
  tick [count]
  scheduler set <rr|fcfs>

Process management:
  process create <name> <memory> <cpu_ticks>
  process kill <pid>
  process block <pid> <ticks> [reason]
  process unblock <pid>
  process list

Memory:
  memory status

Disk:
  disk queue

Files and I/O:
  file create <name>
  file write <name> <content>
  file append <name> <content>
  file read <name>
  file delete <name>
  file list

Other:
  demo
  exit

Notes:
  - Round-robin uses a 2-tick time slice.
  - 'tick' advances the system clock and runs the scheduler.
  - 'process block' simulates a device or file I/O wait.
""".strip()


def run_demo(os_sim: OperatingSystemSimulator) -> List[str]:
    demo_output = [
        os_sim.create_process("shell", PAGE_SIZE_UNITS * 2, 5),
        os_sim.create_process("editor", PAGE_SIZE_UNITS * 3, 4),
        os_sim.create_process("backup", PAGE_SIZE_UNITS * 5, 6),
        os_sim.disk_manager.create_file("report.bin", 6),
        os_sim.disk_manager.write_file("report.bin", 2),
        os_sim.printer_spooler.submit_print_job("JOB-1", "report.bin", 8),
    ]
    demo_output.extend(os_sim.tick(6))
    demo_output.extend(os_sim.system_status())
    return demo_output


def execute_command(os_sim: OperatingSystemSimulator, command: str) -> List[str]:
    parts = command.strip().split()
    if not parts:
        return []

    main = parts[0].lower()

    if main == "help":
        return [HELP_TEXT]
    if main == "status":
        return os_sim.system_status()
    if main == "tick":
        steps = int(parts[1]) if len(parts) > 1 else 1
        return os_sim.tick(steps)
    if main == "scheduler" and len(parts) == 3 and parts[1].lower() == "set":
        return [os_sim.set_scheduler(parts[2])]
    if main == "process":
        if len(parts) >= 2 and parts[1] == "create" and len(parts) == 5:
            return [os_sim.create_process(parts[2], int(parts[3]), int(parts[4]))]
        if len(parts) == 3 and parts[1] == "kill":
            return [os_sim.terminate_process(int(parts[2]))]
        if len(parts) >= 4 and parts[1] == "block":
            reason = " ".join(parts[4:]) if len(parts) > 4 else "I/O"
            return [os_sim.block_process(int(parts[2]), int(parts[3]), reason)]
        if len(parts) == 3 and parts[1] == "unblock":
            return [os_sim.unblock_process(int(parts[2]))]
        if len(parts) == 2 and parts[1] == "list":
            return os_sim.process_lines()
        return ["Invalid process command. Type 'help' for usage."]
    if main == "memory" and len(parts) == 2 and parts[1] == "status":
        return os_sim.memory.status_lines()
    if main == "disk" and len(parts) == 2 and parts[1] == "queue":
        return os_sim.disk_manager.show_disk_queue()
    if main == "file":
        if len(parts) == 3 and parts[1] == "create":
            return [os_sim.file_system.create(parts[2])]
        if len(parts) >= 4 and parts[1] in {"write", "append"}:
            content = " ".join(parts[3:])
            return [os_sim.file_system.write(parts[2], content, append=parts[1] == "append")]
        if len(parts) == 3 and parts[1] == "read":
            return [os_sim.file_system.read(parts[2])]
        if len(parts) == 3 and parts[1] == "delete":
            return [os_sim.file_system.delete(parts[2])]
        if len(parts) == 2 and parts[1] == "list":
            return os_sim.file_system.list_files()
        return ["Invalid file command. Type 'help' for usage."]
    if main == "demo":
        return run_demo(os_sim)
    if main == "exit":
        raise SystemExit

    return ["Unknown command. Type 'help' for usage."]


def main() -> None:
    os_sim = OperatingSystemSimulator()
    print("Simple Operating System Simulator")
    print("Type 'help' to see commands.")

    while True:
        try:
            command = input("os-sim> ")
        except EOFError:
            print("\nExiting simulator.")
            break

        try:
            for line in execute_command(os_sim, command):
                print(line)
        except ValueError:
            print("Invalid numeric value. Type 'help' for usage.")
        except SystemExit:
            print("Exiting simulator.")
            break


if __name__ == "__main__":
    main()
