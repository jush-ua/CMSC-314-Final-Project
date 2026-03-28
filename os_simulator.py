from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


PROCESS_STATES = ("ready", "running", "waiting", "terminated")


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
class MemoryManager:
    total_memory: int
    allocations: List[MemoryBlock] = field(default_factory=list)

    def allocate(self, pid: int, size: int) -> Optional[MemoryBlock]:
        if size <= 0 or size > self.total_memory:
            return None

        self.allocations.sort(key=lambda block: block.start)
        cursor = 0
        for block in self.allocations:
            if cursor + size <= block.start:
                new_block = MemoryBlock(pid=pid, start=cursor, size=size)
                self.allocations.append(new_block)
                self.allocations.sort(key=lambda item: item.start)
                return new_block
            cursor = block.end + 1

        if cursor + size <= self.total_memory:
            new_block = MemoryBlock(pid=pid, start=cursor, size=size)
            self.allocations.append(new_block)
            self.allocations.sort(key=lambda item: item.start)
            return new_block

        return None

    def free(self, pid: int) -> None:
        self.allocations = [block for block in self.allocations if block.pid != pid]

    def used_memory(self) -> int:
        return sum(block.size for block in self.allocations)

    def free_memory(self) -> int:
        return self.total_memory - self.used_memory()

    def status_lines(self) -> List[str]:
        lines = [
            f"Total memory: {self.total_memory}",
            f"Used memory:  {self.used_memory()}",
            f"Free memory:  {self.free_memory()}",
        ]
        if not self.allocations:
            lines.append("No active allocations.")
            return lines

        lines.append("Allocations:")
        for block in sorted(self.allocations, key=lambda item: item.start):
            lines.append(
                f"  PID {block.pid:<3} -> address {block.start:>3} to {block.end:>3} ({block.size} units)"
            )
        return lines


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
    def __init__(self, total_memory: int = 256, time_slice: int = 2) -> None:
        self.memory = MemoryManager(total_memory=total_memory)
        self.file_system = FileSystem()
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
        block = self.memory.allocate(pid=pid, size=memory_required)
        if block is None:
            return (
                f"Failed to create process '{name}': not enough contiguous memory "
                f"for {memory_required} units."
            )

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
        os_sim.create_process("shell", 32, 5),
        os_sim.create_process("editor", 48, 4),
        os_sim.create_process("backup", 64, 6),
        os_sim.file_system.create("notes.txt"),
        os_sim.file_system.write("notes.txt", "OS simulator demo file."),
        os_sim.block_process(2, 2, "disk"),
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
