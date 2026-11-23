"""Amostra os cgroups v2 de um único projeto Compose no host Linux do daemon."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

running = True
PROC = Path("/proc")
CGROUPS = Path("/sys/fs/cgroup")


def stop(_signal, _frame):
    global running
    running = False


def fields(path):
    return dict(line.split()[:2] for line in Path(path).read_text().splitlines())


def containers(project):
    rows = subprocess.check_output(
        ["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}"],
        text=True,
    ).split()
    if not rows:
        return []
    data = subprocess.run(
        ["docker", "inspect", "--format",
         '{{.State.Pid}} {{index .Config.Labels "com.docker.compose.service"}}', *rows],
        capture_output=True, text=True,
    )
    return [line.split() for line in data.stdout.splitlines() if len(line.split()) == 2]


def sample(project, output):
    marker = output / "fase"
    with marker.open() as first:
        reading = read_resources(project, first.read().strip())
        with marker.open() as last:
            reading["phase_end"] = last.read().strip()
            # O roteiro publica por rename. O descritor inicial também distingue A → B → A.
            if not os.path.samestat(os.fstat(first.fileno()), os.fstat(last.fileno())):
                reading["phase_changed"] = True
    return reading


def read_resources(project, phase):
    host = fields(PROC / "meminfo")
    sample = {
        "time": time.time(), "phase": phase,
        "host_used_mib": (int(host["MemTotal:"]) - int(host["MemAvailable:"])) / 1024,
        "host_available_mib": int(host["MemAvailable:"]) / 1024,
        "swap_free_mib": int(host["SwapFree:"]) / 1024,
        "host_oom_kill": int(fields(PROC / "vmstat")["oom_kill"]), "containers": [],
    }
    neighbor = os.environ.get("NEIGHBOR_HEALTH_URL")
    if neighbor:
        started = time.monotonic()
        try:
            with urllib.request.urlopen(neighbor, timeout=1) as response:
                sample["neighbor_ok"] = 200 <= response.status < 300
        except OSError:
            sample["neighbor_ok"] = False
        sample["neighbor_ms"] = 1000 * (time.monotonic() - started)
    for pid, service in containers(project):
        try:
            cgroup = next(line[3:] for line in (PROC / pid / "cgroup").read_text().splitlines()
                          if line.startswith("0::"))
            group = CGROUPS / cgroup.lstrip("/")
            current = int((group / "memory.current").read_text())
            try:
                limit = (group / "memory.max").read_text().strip()
            except FileNotFoundError:
                limit = None
            events = fields(group / "memory.events")
        except (FileNotFoundError, ProcessLookupError):
            continue  # O processo pode sair entre docker inspect e a leitura do cgroup.
        sample["containers"].append({
            "service": service, "mib": current / 1048576,
            "limit_mib": int(limit) / 1048576 if limit is not None and limit.isdigit() else None,
            "oom": int(events["oom"]), "oom_kill": int(events["oom_kill"]),
        })
    return sample


if __name__ == "__main__":
    project, directory = sys.argv[1:]
    output = Path(directory)
    signal.signal(signal.SIGTERM, stop)
    with (output / "memoria.jsonl").open("w", buffering=1) as log:
        while running:
            print(json.dumps(sample(project, output)), file=log)
            time.sleep(0.5)
