from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from os_simulator import OperatingSystemSimulator


SCHEDULER_INTERVAL_MS = 500
APP_WIDTH = 1440
APP_HEIGHT = 920
TASKBAR_HEIGHT = 52
WINDOW_MIN_WIDTH = 320
WINDOW_MIN_HEIGHT = 220


class DesktopWindow(tk.Frame):
    def __init__(
        self,
        parent: tk.Widget,
        app: "OSDesktopApp",
        title: str,
        x: int,
        y: int,
        width: int,
        height: int,
    ) -> None:
        super().__init__(parent, bg="#f7f9fc", highlightthickness=1, highlightbackground="#ccd5e0")
        self.app = app
        self.title = title
        self.default_geometry = (x, y, width, height)
        self.saved_geometry = (x, y, width, height)
        self.minimized = False
        self.maximized = False
        self.closed = False
        self.drag_origin: tuple[int, int, int, int] | None = None
        self.resize_origin: tuple[int, int, int, int] | None = None

        self.titlebar = tk.Frame(self, bg="#eef3fb", height=34)
        self.titlebar.pack(fill="x")
        self.titlebar.pack_propagate(False)
        self.titlebar.bind("<Button-1>", self.start_move)
        self.titlebar.bind("<B1-Motion>", self.on_move)
        self.titlebar.bind("<ButtonRelease-1>", self.end_move)

        self.title_label = tk.Label(
            self.titlebar,
            text=title,
            bg="#eef3fb",
            fg="#1b2635",
            font=("Segoe UI", 10, "bold"),
        )
        self.title_label.pack(side="left", padx=12)
        self.title_label.bind("<Button-1>", self.start_move)
        self.title_label.bind("<B1-Motion>", self.on_move)
        self.title_label.bind("<ButtonRelease-1>", self.end_move)

        controls = tk.Frame(self.titlebar, bg="#eef3fb")
        controls.pack(side="right", padx=6)
        for label, handler in (("_", self.toggle_minimize), ("[ ]", self.toggle_maximize), ("X", self.close_window)):
            button = tk.Button(
                controls,
                text=label,
                width=3,
                command=handler,
                bg="#eef3fb",
                fg="#364254",
                relief="flat",
                bd=0,
                activebackground="#dce6f4",
            )
            button.pack(side="left", padx=1, pady=4)

        self.body = ttk.Frame(self, padding=12)
        self.body.pack(fill="both", expand=True)

        self.resize_handle = tk.Frame(self, bg="#d3d9e4", cursor="size_nw_se", width=14, height=14)
        self.resize_handle.place(relx=1.0, rely=1.0, anchor="se")
        self.resize_handle.bind("<Button-1>", self.start_resize)
        self.resize_handle.bind("<B1-Motion>", self.on_resize)
        self.resize_handle.bind("<ButtonRelease-1>", self.end_resize)

        self.bind("<Button-1>", lambda _event: self.lift())
        self.place(x=x, y=y, width=width, height=height)

    def set_content(self, builder) -> None:
        builder(self.body)

    def toggle_minimize(self) -> None:
        if self.closed:
            return
        if not self.minimized:
            width = self.winfo_width()
            x = self.winfo_x()
            y = self.winfo_y()
            self.saved_geometry = (x, y, width, self.winfo_height())
            self.body.pack_forget()
            self.resize_handle.place_forget()
            self.place_configure(height=36)
            self.minimized = True
        else:
            x, y, width, height = self.saved_geometry
            self.place_configure(x=x, y=y, width=width, height=height)
            self.body.pack(fill="both", expand=True)
            self.resize_handle.place(relx=1.0, rely=1.0, anchor="se")
            self.minimized = False
        self.lift()

    def toggle_maximize(self) -> None:
        if self.closed:
            return
        self.app.desktop.update_idletasks()
        if not self.maximized:
            self.saved_geometry = (self.winfo_x(), self.winfo_y(), self.winfo_width(), self.winfo_height())
            self.place_configure(x=12, y=12, width=self.app.desktop.winfo_width() - 24, height=self.app.desktop.winfo_height() - 24)
            if self.minimized:
                self.toggle_minimize()
            self.maximized = True
        else:
            x, y, width, height = self.saved_geometry
            self.place_configure(x=x, y=y, width=width, height=height)
            self.maximized = False
        self.lift()

    def close_window(self) -> None:
        self.closed = True
        self.place_forget()
        self.app.register_closed_window(self)

    def reopen(self) -> None:
        if not self.closed:
            self.lift()
            return
        x, y, width, height = self.saved_geometry if self.saved_geometry else self.default_geometry
        self.place(x=x, y=y, width=width, height=height)
        if self.minimized:
            self.toggle_minimize()
        self.closed = False
        self.maximized = False
        self.app.clear_closed_window(self)
        self.lift()

    def start_move(self, event: tk.Event) -> None:
        if self.maximized:
            return
        self.drag_origin = (event.x_root, event.y_root, self.winfo_x(), self.winfo_y())
        self.lift()

    def on_move(self, event: tk.Event) -> None:
        if not self.drag_origin or self.maximized:
            return
        start_x, start_y, origin_x, origin_y = self.drag_origin
        delta_x = event.x_root - start_x
        delta_y = event.y_root - start_y
        self.place_configure(x=origin_x + delta_x, y=max(0, origin_y + delta_y))

    def end_move(self, _event: tk.Event) -> None:
        self.drag_origin = None

    def start_resize(self, event: tk.Event) -> None:
        self.resize_origin = (event.x_root, event.y_root, self.winfo_width(), self.winfo_height())
        self.lift()

    def on_resize(self, event: tk.Event) -> None:
        if not self.resize_origin or self.maximized or self.minimized:
            return
        start_x, start_y, width, height = self.resize_origin
        delta_x = event.x_root - start_x
        delta_y = event.y_root - start_y
        new_width = max(WINDOW_MIN_WIDTH, width + delta_x)
        new_height = max(WINDOW_MIN_HEIGHT, height + delta_y)
        self.place_configure(width=new_width, height=new_height)

    def end_resize(self, _event: tk.Event) -> None:
        self.resize_origin = None


class OSDesktopApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("OS Simulator Desktop")
        self.geometry(f"{APP_WIDTH}x{APP_HEIGHT}")
        self.configure(bg="#dbe5f1")
        self.minsize(1100, 720)

        self.sim = OperatingSystemSimulator()
        self.sim_lock = threading.Lock()
        self.scheduler_stop = threading.Event()
        self.scheduler_thread: threading.Thread | None = None
        self.ui_queue: queue.Queue[dict] = queue.Queue()
        self.closed_windows: dict[str, DesktopWindow] = {}
        self.cpu_cycles: dict[int, int] = {}
        self.total_cycles = 0

        self.style = ttk.Style(self)
        self.style.theme_use("clam")
        self.style.configure("Treeview", rowheight=28, fieldbackground="#ffffff", background="#ffffff", foreground="#1b2635")
        self.style.configure("Treeview.Heading", background="#eef3fb", foreground="#223246", relief="flat")
        self.style.configure("TButton", padding=6)

        self.desktop = tk.Frame(self, bg="#dbe5f1")
        self.desktop.pack(fill="both", expand=True)

        self.taskbar = tk.Frame(self, bg="#eef3fb", height=TASKBAR_HEIGHT, highlightthickness=1, highlightbackground="#ccd5e0")
        self.taskbar.pack(fill="x", side="bottom")
        self.taskbar.pack_propagate(False)

        self.start_button = tk.Button(
            self.taskbar,
            text="Start",
            command=self.toggle_start_menu,
            bg="#ffffff",
            fg="#1d2d3d",
            relief="flat",
            bd=0,
            padx=14,
        )
        self.start_button.pack(side="left", padx=12, pady=10)

        self.status_var = tk.StringVar(value="GUI ready")
        self.status_label = tk.Label(self.taskbar, textvariable=self.status_var, bg="#eef3fb", fg="#405166")
        self.status_label.pack(side="left", padx=10)

        self.clock_var = tk.StringVar(value="")
        self.clock_label = tk.Label(self.taskbar, textvariable=self.clock_var, bg="#eef3fb", fg="#1d2d3d", font=("Segoe UI", 10, "bold"))
        self.clock_label.pack(side="right", padx=16)

        self.start_menu = tk.Frame(self.desktop, bg="#ffffff", highlightthickness=1, highlightbackground="#ccd5e0")
        self.start_menu_visible = False

        self.process_rows: dict[str, ttk.Treeview] = {}
        self.process_tree: ttk.Treeview | None = None
        self.memory_canvas: tk.Canvas | None = None
        self.memory_legend: tk.Frame | None = None
        self.memory_summary_var = tk.StringVar(value="")
        self.disk_tree: ttk.Treeview | None = None
        self.printer_tree: ttk.Treeview | None = None

        self.windows: dict[str, DesktopWindow] = {}
        self.create_windows()
        self.refresh_start_menu()
        self.update_clock()
        self.process_ui_updates()
        self.push_snapshot("Simulator ready")
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def create_windows(self) -> None:
        self.windows["Process Manager"] = DesktopWindow(self.desktop, self, "Process Manager", 22, 20, 620, 320)
        self.windows["Process Manager"].set_content(self.build_process_window)

        self.windows["Memory Map"] = DesktopWindow(self.desktop, self, "Memory Map", 660, 20, 420, 320)
        self.windows["Memory Map"].set_content(self.build_memory_window)

        self.windows["Disk Manager"] = DesktopWindow(self.desktop, self, "Disk Manager", 1100, 20, 320, 320)
        self.windows["Disk Manager"].set_content(self.build_disk_window)

        self.windows["Printer Spooler"] = DesktopWindow(self.desktop, self, "I/O / Printer Spooler", 160, 370, 640, 300)
        self.windows["Printer Spooler"].set_content(self.build_printer_window)

    def build_process_window(self, parent: ttk.Frame) -> None:
        toolbar = ttk.Frame(parent)
        toolbar.pack(fill="x", pady=(0, 10))

        ttk.Button(toolbar, text="Add Process", command=self.add_process).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Terminate Selected", command=self.terminate_selected_process).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Start Scheduler", command=self.start_scheduler).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Stop Scheduler", command=self.stop_scheduler).pack(side="left")

        columns = ("pid", "name", "state", "cpu", "memory")
        tree = ttk.Treeview(parent, columns=columns, show="headings")
        tree.heading("pid", text="PID")
        tree.heading("name", text="Name")
        tree.heading("state", text="State")
        tree.heading("cpu", text="CPU %")
        tree.heading("memory", text="Memory")
        tree.column("pid", width=60, anchor="center")
        tree.column("name", width=150)
        tree.column("state", width=110, anchor="center")
        tree.column("cpu", width=90, anchor="center")
        tree.column("memory", width=120, anchor="center")
        tree.pack(fill="both", expand=True)
        self.process_tree = tree

    def build_memory_window(self, parent: ttk.Frame) -> None:
        toolbar = ttk.Frame(parent)
        toolbar.pack(fill="x", pady=(0, 10))

        ttk.Button(toolbar, text="Refresh", command=lambda: self.push_snapshot("Memory refreshed")).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Allocate Memory", command=self.allocate_memory_for_process).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Free Selected PID", command=self.free_selected_process_memory).pack(side="left")

        summary = ttk.Label(parent, textvariable=self.memory_summary_var)
        summary.pack(fill="x", pady=(0, 8))

        canvas = tk.Canvas(parent, height=140, bg="#f7f9fc", highlightthickness=0)
        canvas.pack(fill="x")
        self.memory_canvas = canvas

        legend = tk.Frame(parent, bg="#f7f9fc")
        legend.pack(fill="both", expand=True, pady=(10, 0))
        self.memory_legend = legend

    def build_disk_window(self, parent: ttk.Frame) -> None:
        toolbar = ttk.Frame(parent)
        toolbar.pack(fill="x", pady=(0, 10))

        ttk.Button(toolbar, text="Add Request", command=self.add_disk_request).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Process Next", command=self.process_disk_request).pack(side="left")

        columns = ("request_id", "pid", "operation", "status")
        tree = ttk.Treeview(parent, columns=columns, show="headings")
        tree.heading("request_id", text="Request ID")
        tree.heading("pid", text="PID")
        tree.heading("operation", text="Operation")
        tree.heading("status", text="Status")
        tree.column("request_id", width=90, anchor="center")
        tree.column("pid", width=60, anchor="center")
        tree.column("operation", width=160)
        tree.column("status", width=90, anchor="center")
        tree.pack(fill="both", expand=True)
        self.disk_tree = tree

    def build_printer_window(self, parent: ttk.Frame) -> None:
        toolbar = ttk.Frame(parent)
        toolbar.pack(fill="x", pady=(0, 10))

        ttk.Button(toolbar, text="Submit Print Job", command=self.submit_print_job).pack(side="left", padx=(0, 8))
        ttk.Button(toolbar, text="Process Next", command=self.process_print_job).pack(side="left")

        columns = ("job_id", "document", "pages", "status")
        tree = ttk.Treeview(parent, columns=columns, show="headings")
        tree.heading("job_id", text="Job ID")
        tree.heading("document", text="Document")
        tree.heading("pages", text="Pages")
        tree.heading("status", text="Status")
        tree.column("job_id", width=90, anchor="center")
        tree.column("document", width=220)
        tree.column("pages", width=80, anchor="center")
        tree.column("status", width=100, anchor="center")
        tree.pack(fill="both", expand=True)
        self.printer_tree = tree

    def register_closed_window(self, window: DesktopWindow) -> None:
        self.closed_windows[window.title] = window
        self.refresh_start_menu()

    def clear_closed_window(self, window: DesktopWindow) -> None:
        self.closed_windows.pop(window.title, None)
        self.refresh_start_menu()

    def toggle_start_menu(self) -> None:
        if self.start_menu_visible:
            self.start_menu.place_forget()
            self.start_menu_visible = False
            return
        self.refresh_start_menu()
        self.start_menu.place(x=12, y=max(12, self.desktop.winfo_height() - 230), width=220, height=200)
        self.start_menu_visible = True

    def refresh_start_menu(self) -> None:
        for child in self.start_menu.winfo_children():
            child.destroy()

        title = tk.Label(self.start_menu, text="Windows", bg="#ffffff", fg="#1d2d3d", font=("Segoe UI", 10, "bold"))
        title.pack(anchor="w", padx=12, pady=(10, 8))

        for name, window in self.windows.items():
            label = f"Reopen {name}" if window.closed else f"Focus {name}"
            button = tk.Button(
                self.start_menu,
                text=label,
                anchor="w",
                command=lambda win=window: self.open_window_from_menu(win),
                bg="#ffffff",
                fg="#314154",
                relief="flat",
                bd=0,
                padx=12,
            )
            button.pack(fill="x", pady=2)

    def open_window_from_menu(self, window: DesktopWindow) -> None:
        if window.closed:
            window.reopen()
        else:
            window.lift()
        self.start_menu.place_forget()
        self.start_menu_visible = False

    def update_clock(self) -> None:
        self.clock_var.set(time.strftime("%I:%M:%S %p"))
        self.after(1000, self.update_clock)

    def push_snapshot(self, status_message: str = "") -> None:
        with self.sim_lock:
            snapshot = self.build_snapshot()
        if status_message:
            snapshot["status_message"] = status_message
        self.ui_queue.put(snapshot)

    def build_snapshot(self) -> dict:
        processes = []
        for process in sorted(self.sim.processes.values(), key=lambda item: item.pid):
            cpu_percent = 0.0
            if self.total_cycles:
                cpu_percent = round((self.cpu_cycles.get(process.pid, 0) / self.total_cycles) * 100, 1)
            processes.append(
                {
                    "pid": process.pid,
                    "name": process.name,
                    "state": process.state,
                    "cpu_percent": cpu_percent,
                    "memory_required": process.memory_required,
                }
            )

        segments = []
        cursor = 0
        for block in sorted(self.sim.memory.allocations, key=lambda item: item.start):
            if cursor < block.start:
                segments.append({"pid": None, "label": "FREE", "size": block.start - cursor})
            segments.append({"pid": block.pid, "label": f"PID {block.pid}", "size": block.size})
            cursor = block.end + 1
        if cursor < self.sim.memory.total_memory:
            segments.append({"pid": None, "label": "FREE", "size": self.sim.memory.total_memory - cursor})

        disk_rows = [
            {
                "request_id": request.request_id,
                "process_id": request.process_id,
                "operation": request.operation,
                "status": request.status,
            }
            for request in self.sim.disk_manager.pending_requests + self.sim.disk_manager.completed_requests
        ]

        printer_rows = [
            {
                "job_id": job.job_id,
                "document_name": job.document_name,
                "size_pages": job.size_pages,
                "status": job.status,
            }
            for job in self.sim.printer_spooler.print_queue + self.sim.printer_spooler.completed_jobs
        ]

        return {
            "processes": processes,
            "memory_total": self.sim.memory.total_memory,
            "memory_used": self.sim.memory.used_memory(),
            "memory_free": self.sim.memory.free_memory(),
            "memory_segments": segments,
            "disk_rows": disk_rows,
            "printer_rows": printer_rows,
        }

    def process_ui_updates(self) -> None:
        latest_snapshot = None
        while True:
            try:
                latest_snapshot = self.ui_queue.get_nowait()
            except queue.Empty:
                break

        if latest_snapshot is not None:
            self.render_snapshot(latest_snapshot)
        self.after(100, self.process_ui_updates)

    def render_snapshot(self, snapshot: dict) -> None:
        if self.process_tree is not None:
            self.process_tree.delete(*self.process_tree.get_children())
            for process in snapshot["processes"]:
                self.process_tree.insert(
                    "",
                    "end",
                    iid=str(process["pid"]),
                    values=(
                        process["pid"],
                        process["name"],
                        process["state"].upper(),
                        f"{process['cpu_percent']:.1f}",
                        f"{process['memory_required']} units",
                    ),
                )

        self.memory_summary_var.set(
            f"Used: {snapshot['memory_used']}   Free: {snapshot['memory_free']}   Total: {snapshot['memory_total']}"
        )
        self.render_memory_map(snapshot["memory_segments"], snapshot["memory_total"])

        if self.disk_tree is not None:
            self.disk_tree.delete(*self.disk_tree.get_children())
            for row in snapshot["disk_rows"]:
                self.disk_tree.insert(
                    "",
                    "end",
                    values=(row["request_id"], row["process_id"], row["operation"], row["status"]),
                )

        if self.printer_tree is not None:
            self.printer_tree.delete(*self.printer_tree.get_children())
            for row in snapshot["printer_rows"]:
                self.printer_tree.insert(
                    "",
                    "end",
                    values=(row["job_id"], row["document_name"], row["size_pages"], row["status"]),
                )

        status_message = snapshot.get("status_message")
        if status_message:
            self.status_var.set(status_message)

    def render_memory_map(self, segments: list[dict], total_memory: int) -> None:
        if self.memory_canvas is None or self.memory_legend is None:
            return

        self.memory_canvas.delete("all")
        for child in self.memory_legend.winfo_children():
            child.destroy()

        width = max(self.memory_canvas.winfo_width(), 360)
        bar_height = 80
        offset_x = 12
        usable_width = width - 24
        colors = ["#7aa6ff", "#73c1a7", "#f3ad55", "#d98ad1", "#82c7e6", "#96b375"]

        current_x = offset_x
        color_index = 0
        for segment in segments:
            segment_width = max(20, int((segment["size"] / total_memory) * usable_width))
            color = "#cfd5dd" if segment["pid"] is None else colors[color_index % len(colors)]
            if segment["pid"] is not None:
                color_index += 1
            self.memory_canvas.create_rectangle(
                current_x,
                18,
                current_x + segment_width,
                18 + bar_height,
                fill=color,
                outline="#ffffff",
            )
            label = f"{segment['label']}\n{segment['size']} units"
            self.memory_canvas.create_text(
                current_x + segment_width / 2,
                18 + bar_height / 2,
                text=label,
                fill="#1f2e3c",
                font=("Segoe UI", 9, "bold"),
                width=max(segment_width - 8, 30),
            )
            legend_label = tk.Label(
                self.memory_legend,
                text=label.replace("\n", " | "),
                bg=self.memory_legend["bg"],
                fg="#314154",
                anchor="w",
            )
            legend_label.pack(fill="x", pady=1)
            current_x += segment_width

    def start_scheduler(self) -> None:
        if self.scheduler_thread and self.scheduler_thread.is_alive():
            self.status_var.set("Scheduler is already running")
            return

        self.scheduler_stop.clear()
        self.scheduler_thread = threading.Thread(target=self.scheduler_loop, name="gui-scheduler", daemon=True)
        self.scheduler_thread.start()
        self.status_var.set("Scheduler started")

    def stop_scheduler(self) -> None:
        self.scheduler_stop.set()
        if self.scheduler_thread:
            self.scheduler_thread.join(timeout=SCHEDULER_INTERVAL_MS / 1000 + 0.25)
        self.status_var.set("Scheduler stopped")

    def scheduler_loop(self) -> None:
        interval_seconds = SCHEDULER_INTERVAL_MS / 1000
        while not self.scheduler_stop.is_set():
            with self.sim_lock:
                messages = self.sim.tick(1)
                running_pid = self.extract_running_pid(messages)
                if running_pid is not None:
                    self.cpu_cycles[running_pid] = self.cpu_cycles.get(running_pid, 0) + 1
                    self.total_cycles += 1
                snapshot = self.build_snapshot()
            snapshot["status_message"] = "Scheduler cycle completed"
            self.ui_queue.put(snapshot)
            if self.scheduler_stop.wait(interval_seconds):
                break

    def extract_running_pid(self, messages: list[str]) -> int | None:
        for message in messages:
            marker = "running PID "
            if marker in message:
                pid_text = message.split(marker, 1)[1].split(" ", 1)[0]
                try:
                    return int(pid_text)
                except ValueError:
                    return None
        return None

    def add_process(self) -> None:
        name = simpledialog.askstring("Add Process", "Process name:", parent=self)
        if not name:
            return
        memory = simpledialog.askinteger("Add Process", "Memory required:", parent=self, minvalue=1)
        if memory is None:
            return
        cpu_time = simpledialog.askinteger("Add Process", "CPU ticks required:", parent=self, minvalue=1)
        if cpu_time is None:
            return

        with self.sim_lock:
            message = self.sim.create_process(name, memory, cpu_time)
            snapshot = self.build_snapshot()
        snapshot["status_message"] = message
        self.ui_queue.put(snapshot)

    def terminate_selected_process(self) -> None:
        if self.process_tree is None:
            return
        selection = self.process_tree.selection()
        if not selection:
            self.status_var.set("Select a process first")
            return
        pid = int(selection[0])
        with self.sim_lock:
            message = self.sim.terminate_process(pid)
            snapshot = self.build_snapshot()
        snapshot["status_message"] = message
        self.ui_queue.put(snapshot)

    def allocate_memory_for_process(self) -> None:
        pid = simpledialog.askinteger("Allocate Memory", "Process ID:", parent=self, minvalue=1)
        if pid is None:
            return
        size = simpledialog.askinteger("Allocate Memory", "Size:", parent=self, minvalue=1)
        if size is None:
            return

        with self.sim_lock:
            if pid not in self.sim.processes:
                message = f"Process {pid} does not exist."
            elif any(block.pid == pid for block in self.sim.memory.allocations):
                message = f"Process {pid} already has allocated memory."
            else:
                block = self.sim.memory.allocate(pid, size)
                message = (
                    f"Allocated {size} units to process {pid}."
                    if block is not None
                    else f"Failed to allocate {size} units to process {pid}."
                )
            snapshot = self.build_snapshot()
        snapshot["status_message"] = message
        self.ui_queue.put(snapshot)

    def free_selected_process_memory(self) -> None:
        if self.process_tree is None:
            return
        selection = self.process_tree.selection()
        if not selection:
            self.status_var.set("Select a process first")
            return
        pid = int(selection[0])
        with self.sim_lock:
            self.sim.memory.free(pid)
            snapshot = self.build_snapshot()
        snapshot["status_message"] = f"Freed memory for process {pid}"
        self.ui_queue.put(snapshot)

    def add_disk_request(self) -> None:
        request_id = simpledialog.askstring("Disk Request", "Request ID:", parent=self)
        if not request_id:
            return
        pid = simpledialog.askinteger("Disk Request", "Process ID:", parent=self, minvalue=1)
        if pid is None:
            return
        operation = simpledialog.askstring("Disk Request", "Operation:", parent=self)
        if not operation:
            return

        with self.sim_lock:
            self.sim.disk_manager.submit_disk_request(request_id, pid, operation)
            snapshot = self.build_snapshot()
        snapshot["status_message"] = f"Queued disk request {request_id}"
        self.ui_queue.put(snapshot)

    def process_disk_request(self) -> None:
        with self.sim_lock:
            message = self.sim.disk_manager.process_disk_request()
            snapshot = self.build_snapshot()
        snapshot["status_message"] = message
        self.ui_queue.put(snapshot)

    def submit_print_job(self) -> None:
        job_id = simpledialog.askstring("Print Job", "Job ID:", parent=self)
        if not job_id:
            return
        document_name = simpledialog.askstring("Print Job", "Document name:", parent=self)
        if not document_name:
            return
        size_pages = simpledialog.askinteger("Print Job", "Page count:", parent=self, minvalue=1)
        if size_pages is None:
            return

        with self.sim_lock:
            message = self.sim.printer_spooler.submit_print_job(job_id, document_name, size_pages)
            snapshot = self.build_snapshot()
        snapshot["status_message"] = message
        self.ui_queue.put(snapshot)

    def process_print_job(self) -> None:
        with self.sim_lock:
            message = self.sim.printer_spooler.process_print_job()
            snapshot = self.build_snapshot()
        snapshot["status_message"] = message
        self.ui_queue.put(snapshot)

    def on_close(self) -> None:
        self.stop_scheduler()
        self.destroy()


def main() -> None:
    app = OSDesktopApp()
    app.mainloop()


if __name__ == "__main__":
    main()
