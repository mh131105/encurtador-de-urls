"""Consolida amostras simultâneas e aplica o orçamento e a margem do preflight."""
import json
import math
import sys
from pathlib import Path
from orcamento import limites

directory = Path(sys.argv[1])
budget, margin = limites(*sys.argv[2:])
topology_file = directory / "colocacao.json"
topology = json.loads(topology_file.read_text()) if topology_file.exists() else {"cassandra_mode": "local"}
placed_services = {"api"}
for service, remote_mode in (("cassandra", "externo"), ("redis", "externo"), ("nginx", "existente")):
    mode = topology.get(f"{service}_mode", "local")
    if mode == "local":
        placed_services.add(service)
    elif mode != remote_mode:
        sys.exit(f"Colocação de {service} desconhecida")
failures = []
# Séries antigas registraram a colocação sem listar os serviços.
declared = topology.get("local_services", sorted(placed_services))
if (isinstance(declared, list) and all(isinstance(name, str) for name in declared)
        and len(declared) == len(placed_services) and set(declared) == placed_services):
    services = set(declared)
else:
    failures.append(f"local_services incompatível com a colocação: esperado {', '.join(sorted(placed_services))}")
    services = placed_services
expected_phases = ["partida", "repouso", "uso", "cabecalhos", "reinicio"]
if "cassandra" in services:
    expected_phases.append("compactacao")
phases = {}
phase_transitions = {}
legacy_phase_samples = 0
oom_min = None
oom_max = 0
limits = {}
phases_without_limit = set()
with (directory / "memoria.jsonl").open() as samples:
    for line, row in enumerate(map(json.loads, samples), 1):
        start_phase = row["phase"]
        end_phase = row.get("phase_end")
        if end_phase is None:
            legacy_phase_samples += 1
        crossed = row.get("phase_changed", False) or start_phase != end_phase
        bucket = phase_transitions if crossed else phases
        phase = f"{start_phase} → {end_phase or 'fim desconhecido'}" if crossed else start_phase
        totals = bucket.setdefault(phase, {
            "samples": 0, "complete_samples": 0,
            "observed_limit_sum_peak_mib": None,
            "stack_peak_mib": None, "stack_peak_lower_bound_mib": None, "host_peak_mib": 0,
            "host_min_available_mib": float("inf"), "service_peaks_mib": {},
        })
        if crossed:
            totals.setdefault("lines", []).append(line)
        totals["samples"] += 1
        if "neighbor_ok" in row:
            totals["neighbor_max_ms"] = max(totals.get("neighbor_max_ms", 0), row["neighbor_ms"])
            if not row["neighbor_ok"]:
                failures.append(f"sonda do vizinho falhou em {phase}")
        readings = [c for c in row["containers"] if c["service"] in services]
        if len(readings) != len(row["containers"]):
            failures.append(f"fase {phase}: cgroup fora dos serviços previstos na colocação")
        complete = not crossed and {c["service"] for c in readings} == services
        observed = sum(c["mib"] for c in readings)
        if readings:
            totals["stack_peak_lower_bound_mib"] = max(totals["stack_peak_lower_bound_mib"] or 0, observed)
        if complete:
            totals["complete_samples"] += 1
            totals["stack_peak_mib"] = max(totals["stack_peak_mib"] or 0, observed)
        # Mesmo uma soma parcial é suficiente para demonstrar estouro do orçamento.
        if observed > budget:
            failures.append(f"orçamento ultrapassado em {phase}")
        totals["host_peak_mib"] = max(totals["host_peak_mib"], row["host_used_mib"])
        totals["host_min_available_mib"] = min(totals["host_min_available_mib"], row["host_available_mib"])
        if row["host_available_mib"] < margin:
            failures.append(f"margem do host abaixo do mínimo em {phase}")
        oom_min = row["host_oom_kill"] if oom_min is None else min(oom_min, row["host_oom_kill"])
        oom_max = max(oom_max, row["host_oom_kill"])
        observed_limits = 0
        for c in readings:
            key = c["service"]
            cap = c.get("limit_mib")
            if type(cap) not in (int, float) or not math.isfinite(cap) or cap < 0:
                limits[key] = None
                phases_without_limit.add((crossed, phase))
                failures.append(f"fase {phase}: {key} sem limite rígido verificável (memory.max)")
            else:
                limits[key] = cap
                observed_limits += cap
            peaks = totals["service_peaks_mib"]
            peaks[key] = max(peaks.get(key, 0), c["mib"])
            if c["oom"] or c["oom_kill"]:
                failures.append(f"OOM no cgroup {key} em {phase}")
        if readings:
            totals["observed_limit_sum_peak_mib"] = max(totals["observed_limit_sum_peak_mib"] or 0, observed_limits)
        if observed_limits > budget:
            failures.append(f"fase {phase}: soma dos limites observados de {observed_limits:g} MiB "
                            f"supera o orçamento de {budget:g} MiB")
for crossed, p in phases_without_limit:
    (phase_transitions if crossed else phases)[p]["observed_limit_sum_peak_mib"] = None
for p in expected_phases:
    if p not in phases:
        failures.append(f"sem amostras na fase {p}. Serviços locais sem cobertura: {', '.join(sorted(services))}")
        continue
    measured_peak = phases[p]["stack_peak_mib"]
    lower_bound = phases[p]["stack_peak_lower_bound_mib"]
    if measured_peak is None:
        missing = sorted(services.difference(phases[p]["service_peaks_mib"]))
        reason = f"fase {p} inconclusiva: nenhuma amostra com todos os serviços locais simultaneamente"
        if missing:
            reason += f". Serviços não observados: {', '.join(missing)}"
        failures.append(reason)
    elif lower_bound > measured_peak:
        phases[p]["stack_peak_mib"] = None
        failures.append(f"fase {p} inconclusiva: soma parcial de {lower_bound:g} MiB "
                        f"supera a maior soma completa de {measured_peak:g} MiB")
if oom_min is None or oom_max != oom_min:
    failures.append("contador de OOM global mudou ou está ausente")
if set(limits) != services:
    failures.append("cgroups diferentes dos serviços previstos na colocação")
result = {"topology": topology, "budget_mib": budget, "min_margin_mib": margin, "cgroup_limits_mib": limits,
          "host_oom_kill_delta": None if oom_min is None else oom_max - oom_min,
          "phases": phases, "phase_transitions": phase_transitions, "legacy_phase_samples": legacy_phase_samples,
          "failures": sorted(set(failures))}
report = json.dumps(result, indent=2, ensure_ascii=False)
(directory / "resultado.json").write_text(report + "\n")
print(report)
sys.exit(bool(failures))
